import { WorkflowCancelledError, WorkflowPhaseError, errorMessage, isCancellation } from "./errors.ts";
import { effectiveMaxConcurrency } from "./schema.ts";
import { sha256 } from "./persistence-schema.ts";
import { transitionWorkflowRun } from "./run-status.ts";
import { globalWorkflowAgentScheduler, type WorkflowAgentScheduler } from "./scheduler.ts";
import { createWorkflowRun, type WorkflowStateStore } from "./state.ts";
import type { TaskContext, TaskRunner, WorkflowDefinition, WorkflowInput, WorkflowJsonSource, WorkflowPhase, WorkflowRun, WorkflowTask, TaskRun, PhaseRun } from "./types.ts";
import { renderWorkflowRun, renderWorkflowSubprocessEvent, renderWorkflowSubprocessWidget, type WorkflowUIContext } from "./ui.ts";
import { formatDuration, interpolateTemplate, mapWithConcurrencyLimit } from "./utils.ts";

export type WorkflowRunnerOptions = {
  cwd: string;
  taskRunner: TaskRunner;
  state: WorkflowStateStore;
  scheduler?: WorkflowAgentScheduler;
  run?: WorkflowRun;
  onRunUpdate?: (run: WorkflowRun) => void;
  signal?: AbortSignal;
};

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new WorkflowCancelledError();
}

function findPhaseRun(run: WorkflowRun, phaseId: string): PhaseRun {
  const phaseRun = run.phases.find((phase) => phase.phaseId === phaseId);
  if (!phaseRun) throw new WorkflowPhaseError(phaseId, `Run state is missing phase '${phaseId}'.`);
  return phaseRun;
}

function taskRunAt(phaseRun: PhaseRun, index: number, task: WorkflowTask): TaskRun {
  const taskRun = phaseRun.tasks[index];
  if (!taskRun || taskRun.taskId !== task.id) {
    throw new WorkflowPhaseError(phaseRun.phaseId, `Run state is missing task '${task.id}'.`);
  }
  return taskRun;
}

function persistAndRender(run: WorkflowRun, ctx: WorkflowUIContext, options: WorkflowRunnerOptions): void {
  options.state.persistRun(run);
  options.onRunUpdate?.(run);
  renderWorkflowRun(ctx, run);
  renderWorkflowSubprocessWidget(ctx, run);
}

function completedTaskOutputs(run: WorkflowRun): string {
  const chunks: string[] = [];
  for (const phase of run.phases) {
    for (const task of phase.tasks) {
      if (task.status === "completed" && task.output) {
        chunks.push(`## ${phase.name} / ${task.name}\n\n${task.output}`);
      }
    }
  }
  return chunks.join("\n\n---\n\n");
}

function buildTaskPrompt(task: WorkflowTask, input: WorkflowInput, priorOutputs: string): string {
  const rendered = interpolateTemplate(task.prompt, input);
  const inputJson = JSON.stringify(input, null, 2);
  return [
    `You are executing a Pi workflow task.${task.agent ? ` Requested agent role: ${task.agent}.` : ""}`,
    "",
    `Task: ${task.name}`,
    "",
    "Workflow input:",
    "```json",
    inputJson,
    "```",
    "",
    priorOutputs ? `Prior completed task outputs:\n\n${priorOutputs}` : "Prior completed task outputs: none.",
    "",
    "Task instructions:",
    rendered,
  ].join("\n");
}

async function runOneTask(
  definition: WorkflowDefinition,
  run: WorkflowRun,
  phase: WorkflowPhase,
  phaseRun: PhaseRun,
  task: WorkflowTask,
  index: number,
  priorOutputs: string,
  ctx: WorkflowUIContext,
  options: WorkflowRunnerOptions,
): Promise<TaskRun> {
  assertNotAborted(options.signal);
  const taskRun = taskRunAt(phaseRun, index, task);
  taskRun.status = "running";
  taskRun.startedAt = new Date().toISOString();

  const taskForRunner = {
    ...task,
    prompt: buildTaskPrompt(task, run.input, priorOutputs),
  };
  taskRun.promptHash = sha256(taskForRunner.prompt);
  taskRun.options = {
    ...(taskForRunner.model ? { model: taskForRunner.model } : {}),
    ...(taskForRunner.tools ? { tools: [...taskForRunner.tools] } : {}),
    ...(taskForRunner.cwd ? { cwd: taskForRunner.cwd } : {}),
  };
  persistAndRender(run, ctx, options);

  const taskContext: TaskContext = {
    cwd: options.cwd,
    input: run.input,
    run,
    phase,
    priorOutputs,
    signal: options.signal,
    onSubprocessEvent: (event) => renderWorkflowSubprocessEvent(ctx, run, event),
  };

  try {
    const scheduler = options.scheduler ?? globalWorkflowAgentScheduler;
    const result = await scheduler.schedule({ signal: options.signal, runId: run.runId, callId: task.id }, async (scheduledSignal) => {
      return await options.taskRunner.runTask(taskForRunner, { ...taskContext, signal: scheduledSignal });
    });
    taskRun.output = result.output;
    taskRun.usage = result.usage;
    if (result.ok) {
      taskRun.status = "completed";
    } else {
      taskRun.status = options.signal?.aborted ? "cancelled" : "failed";
      taskRun.error = result.error || "Task failed.";
    }
  } catch (error) {
    taskRun.status = isCancellation(error) || options.signal?.aborted ? "cancelled" : "failed";
    taskRun.error = errorMessage(error);
  } finally {
    taskRun.finishedAt = new Date().toISOString();
    persistAndRender(run, ctx, options);
  }

  if (taskRun.status === "cancelled") throw new WorkflowCancelledError(taskRun.error);
  return taskRun;
}

function markUnfinishedTasks(phaseRun: PhaseRun, status: "failed" | "cancelled", error?: string): void {
  for (const task of phaseRun.tasks) {
    if (task.status === "queued" || task.status === "running") {
      task.status = status;
      task.error = error;
      task.finishedAt = new Date().toISOString();
    }
  }
}

async function runPhase(
  definition: WorkflowDefinition,
  run: WorkflowRun,
  phase: WorkflowPhase,
  ctx: WorkflowUIContext,
  options: WorkflowRunnerOptions,
): Promise<void> {
  assertNotAborted(options.signal);
  const phaseRun = findPhaseRun(run, phase.id);
  phaseRun.status = "running";
  phaseRun.startedAt = new Date().toISOString();
  persistAndRender(run, ctx, options);

  try {
    if (phase.mode === "parallel") {
      const phasePriorOutputs = completedTaskOutputs(run);
      const concurrency = effectiveMaxConcurrency(phase.maxConcurrency ?? definition.defaults?.maxConcurrency);
      await mapWithConcurrencyLimit(phase.tasks, concurrency, async (task, index) => {
        return await runOneTask(definition, run, phase, phaseRun, task, index, phasePriorOutputs, ctx, options);
      });
    } else {
      for (const [index, task] of phase.tasks.entries()) {
        const taskRun = await runOneTask(definition, run, phase, phaseRun, task, index, completedTaskOutputs(run), ctx, options);
        if (taskRun.status === "failed") throw new WorkflowPhaseError(phase.id, taskRun.error || `Task '${task.id}' failed.`);
      }
    }

    const failed = phaseRun.tasks.find((task) => task.status === "failed");
    if (failed) throw new WorkflowPhaseError(phase.id, failed.error || `Task '${failed.taskId}' failed.`);

    phaseRun.status = "completed";
  } catch (error) {
    if (isCancellation(error) || options.signal?.aborted) {
      phaseRun.status = "cancelled";
      phaseRun.error = errorMessage(error);
      markUnfinishedTasks(phaseRun, "cancelled", phaseRun.error);
      throw new WorkflowCancelledError(phaseRun.error);
    }
    phaseRun.status = "failed";
    phaseRun.error = errorMessage(error);
    markUnfinishedTasks(phaseRun, "failed", phaseRun.error);
    throw error;
  } finally {
    phaseRun.finishedAt = new Date().toISOString();
    persistAndRender(run, ctx, options);
  }
}

export function summarizeRun(run: WorkflowRun): string {
  const lines = [
    "# Workflow Run Summary",
    "",
    `Workflow: ${run.workflowKey}`,
    `Status: ${run.status}`,
    `Duration: ${formatDuration(run.startedAt, run.finishedAt)}`,
    "",
    "## Phases",
    "",
  ];

  for (const phase of run.phases) {
    lines.push(`### ${phase.name}`);
    lines.push(`Status: ${phase.status}`);
    if (phase.error) lines.push(`Error: ${phase.error}`);
    for (const task of phase.tasks) {
      lines.push(`- ${task.name}: ${task.status}${task.error ? ` — ${task.error}` : ""}`);
    }
    lines.push("");
  }

  const outputs = completedTaskOutputs(run);
  if (outputs) {
    lines.push("## Outputs", "", outputs);
  }

  return lines.join("\n").trim();
}

export async function runWorkflow(
  source: WorkflowJsonSource,
  input: WorkflowInput,
  ctx: WorkflowUIContext,
  options: WorkflowRunnerOptions,
): Promise<WorkflowRun> {
  const definition = source.definition;
  const run = options.run ?? createWorkflowRun(definition, input, source.path);
  options.state.setActiveRun(run);
  transitionWorkflowRun(run, "running");
  persistAndRender(run, ctx, options);

  try {
    for (const phase of definition.phases) {
      await runPhase(definition, run, phase, ctx, options);
    }
    transitionWorkflowRun(run, "completed");
  } catch (error) {
    if (isCancellation(error) || options.signal?.aborted) {
      transitionWorkflowRun(run, "cancelled");
      run.error = errorMessage(error);
      for (const phase of run.phases) {
        if (phase.status === "queued" || phase.status === "running") {
          phase.status = "cancelled";
          phase.error = run.error;
          phase.finishedAt = new Date().toISOString();
          markUnfinishedTasks(phase, "cancelled", run.error);
        }
      }
    } else {
      transitionWorkflowRun(run, "failed");
      run.error = errorMessage(error);
      for (const phase of run.phases) {
        if (phase.status === "queued") {
          phase.status = "failed";
          phase.error = run.error;
          phase.finishedAt = new Date().toISOString();
          markUnfinishedTasks(phase, "failed", run.error);
        }
      }
    }
  } finally {
    run.finishedAt = new Date().toISOString();
    run.summary = summarizeRun(run);
    options.state.setLastRun(run);
    options.state.removeActiveRun(run.runId);
    persistAndRender(run, ctx, options);
  }

  return run;
}
