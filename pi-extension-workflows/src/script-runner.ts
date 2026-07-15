import { WorkflowCancelledError, WorkflowTaskError, errorMessage, isCancellation } from "./errors.ts";
import { hashWorkflowPolicy, sha256, workflowProjectIdentity } from "./persistence-schema.ts";
import type { WorkflowRunStorage } from "./run-storage.ts";
import { transitionWorkflowRun } from "./run-status.ts";
import { globalWorkflowAgentScheduler, type WorkflowAgentScheduler } from "./scheduler.ts";
import { effectiveWorkflowPolicy } from "./script-schema.ts";
import { executeWorkflowScript, type WorkflowAgentRequest, type WorkflowPhaseEvent } from "./script-runtime.ts";
import type {
  PhaseRun,
  TaskContext,
  TaskRun,
  TaskRunner,
  WorkflowInput,
  WorkflowJavaScriptSource,
  WorkflowPhase,
  WorkflowRun,
  WorkflowScriptDefinition,
  WorkflowTask,
} from "./types.ts";
import type { WorkflowStateStore } from "./state.ts";
import { renderWorkflowRun, renderWorkflowSubprocessEvent, renderWorkflowSubprocessWidget, type WorkflowUIContext } from "./ui.ts";
import { createRunId, formatDuration } from "./utils.ts";

export type JavaScriptWorkflowRunnerOptions = {
  cwd: string;
  taskRunner: TaskRunner;
  state: WorkflowStateStore;
  storage?: WorkflowRunStorage;
  scheduler?: WorkflowAgentScheduler;
  run?: WorkflowRun;
  onRunUpdate?: (run: WorkflowRun) => void;
  signal?: AbortSignal;
};

function persistAndRender(run: WorkflowRun, ctx: WorkflowUIContext, options: JavaScriptWorkflowRunnerOptions): void {
  run.updatedAt = new Date().toISOString();
  options.state.persistRun(run);
  options.onRunUpdate?.(run);
  renderWorkflowRun(ctx, run);
  renderWorkflowSubprocessWidget(ctx, run);
}

function inputForRun(args: unknown): WorkflowInput {
  return typeof args === "object" && args !== null && !Array.isArray(args)
    ? args as WorkflowInput
    : { value: args };
}

export function createJavaScriptRun(source: WorkflowJavaScriptSource, args: unknown): WorkflowRun {
  const now = new Date().toISOString();
  return {
    runId: createRunId(),
    workflowKey: source.script.meta.name,
    workflowName: source.script.meta.description,
    sourcePath: source.path,
    sourceType: "javascript",
    scriptHash: source.script.sourceHash,
    status: "queued",
    input: inputForRun(args),
    phases: [],
    startedAt: now,
    updatedAt: now,
  };
}

function phaseId(path: string[]): string {
  return path.map((part) => part.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "phase").join("/");
}

function ensurePhaseRun(run: WorkflowRun, path: string[]): PhaseRun {
  const id = phaseId(path.length > 0 ? path : ["root"]);
  let phase = run.phases.find((candidate) => candidate.phaseId === id);
  if (!phase) {
    phase = { phaseId: id, name: path.at(-1) ?? "Workflow", status: "queued", tasks: [] };
    run.phases.push(phase);
  }
  return phase;
}

function applyPhaseEvent(run: WorkflowRun, event: WorkflowPhaseEvent): void {
  const phase = ensurePhaseRun(run, event.path);
  if (event.type === "start") {
    phase.status = "running";
    phase.startedAt ??= event.timestamp;
  } else {
    phase.status = event.type === "complete" ? "completed" : "failed";
    phase.finishedAt = event.timestamp;
    if (event.error) phase.error = event.error;
  }
}

function taskIdentity(request: WorkflowAgentRequest): { taskId: string; name: string } {
  const label = request.options.label?.trim();
  return {
    taskId: label || `agent-${request.callIndex}`,
    name: label || `Agent ${request.callIndex}`,
  };
}

function workflowPhase(path: string[]): WorkflowPhase {
  const id = phaseId(path.length > 0 ? path : ["root"]);
  return { id, name: path.at(-1) ?? "Workflow", mode: "sequential", tasks: [] };
}

function schemaPrompt(schema: unknown): string {
  if (schema === undefined) return "";
  return [
    "",
    "Return only JSON matching this schema. Do not wrap it in Markdown fences:",
    JSON.stringify(schema, null, 2),
  ].join("\n");
}

function stripJsonFence(output: string): string {
  const trimmed = output.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function typeMatches(value: unknown, expected: string): boolean {
  if (expected === "null") return value === null;
  if (expected === "array") return Array.isArray(value);
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  return typeof value === expected;
}

function validateSchemaValue(value: unknown, schema: unknown, path = "$", issues: string[] = []): string[] {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return issues;
  const rule = schema as Record<string, unknown>;
  if (typeof rule.type === "string" && !typeMatches(value, rule.type)) {
    issues.push(`${path} must be ${rule.type}.`);
    return issues;
  }
  if (Array.isArray(rule.enum) && !rule.enum.some((item) => Object.is(item, value))) issues.push(`${path} is not an allowed enum value.`);
  if (Array.isArray(value) && rule.items !== undefined) {
    value.forEach((item, index) => validateSchemaValue(item, rule.items, `${path}[${index}]`, issues));
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Array.isArray(rule.required)) {
      for (const required of rule.required) {
        if (typeof required === "string" && !(required in record)) issues.push(`${path}.${required} is required.`);
      }
    }
    if (typeof rule.properties === "object" && rule.properties !== null && !Array.isArray(rule.properties)) {
      for (const [key, childSchema] of Object.entries(rule.properties as Record<string, unknown>)) {
        if (key in record) validateSchemaValue(record[key], childSchema, `${path}.${key}`, issues);
      }
    }
  }
  return issues;
}

function structuredOutput(output: string, schema: unknown): unknown {
  if (schema === undefined) return output;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(output)) as unknown;
  } catch (error) {
    throw new WorkflowTaskError("structured-output", `Agent returned invalid JSON: ${errorMessage(error)}`);
  }
  const issues = validateSchemaValue(parsed, schema);
  if (issues.length > 0) throw new WorkflowTaskError("structured-output", `Agent output failed schema validation: ${issues.join(" ")}`);
  return parsed;
}

function resultSummary(run: WorkflowRun): string {
  const tasks = run.phases.flatMap((phase) => phase.tasks);
  const completed = tasks.filter((task) => task.status === "completed").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  return [
    "# JavaScript Workflow Run",
    "",
    `Workflow: ${run.workflowKey}`,
    `Status: ${run.status}`,
    `Duration: ${formatDuration(run.startedAt, run.finishedAt)}`,
    `Agents: ${completed}/${tasks.length} completed${failed ? `, ${failed} failed` : ""}`,
    run.error ? `Error: ${run.error}` : undefined,
  ].filter((line) => line !== undefined).join("\n");
}

export function effectiveScript(script: WorkflowScriptDefinition): WorkflowScriptDefinition {
  return {
    ...script,
    meta: {
      ...script.meta,
      pi: effectiveWorkflowPolicy(script.meta.pi, {
        maxConcurrency: 8,
        maxAgents: 100,
        timeoutMs: script.meta.pi.timeoutMs,
        permissions: { write: false, shell: false, network: false },
      }),
    },
  };
}

export async function runJavaScriptWorkflow(
  source: WorkflowJavaScriptSource,
  args: unknown,
  ctx: WorkflowUIContext,
  options: JavaScriptWorkflowRunnerOptions,
): Promise<WorkflowRun> {
  const run = options.run ?? createJavaScriptRun(source, args);
  const script = effectiveScript(source.script);
  options.state.setActiveRun(run);
  transitionWorkflowRun(run, "validating");
  persistAndRender(run, ctx, options);

  try {
    run.projectId = await workflowProjectIdentity(options.cwd);
    run.policyHash = hashWorkflowPolicy(script.meta.pi);
    if (options.storage) {
      const snapshot = await options.storage.snapshotScript(run.runId, source.script.source, source.script.sourceHash);
      run.snapshotPath = snapshot.scriptPath;
      run.scriptHash = snapshot.scriptHash;
    }
    transitionWorkflowRun(run, "running");
    persistAndRender(run, ctx, options);

    const execution = await executeWorkflowScript(script, args, {
      onPhaseEvent(event) {
        applyPhaseEvent(run, event);
        persistAndRender(run, ctx, options);
      },
      onPipelineEvent(event) {
        run.pipelineItems ??= [];
        let item = run.pipelineItems.find((candidate) => candidate.pipelineId === event.pipelineId && candidate.index === event.index);
        if (!item) {
          item = { pipelineId: event.pipelineId, index: event.index, key: event.key, status: "running", startedAt: event.timestamp };
          run.pipelineItems.push(item);
        } else if (item.key !== event.key) {
          throw new WorkflowTaskError(event.pipelineId, `Pipeline item ${event.index} changed key from '${item.key}' to '${event.key}'.`);
        }
        item.status = event.type === "start" ? "running" : event.type === "complete" ? "completed" : "failed";
        if (event.type !== "start") item.finishedAt = event.timestamp;
        if (event.error) item.error = event.error;
        persistAndRender(run, ctx, options);
      },
      async agent(request, signal) {
        const phasePath = request.phasePath.length > 0 ? request.phasePath : ["root"];
        const phaseRun = ensurePhaseRun(run, phasePath);
        if (phaseRun.status === "queued") {
          phaseRun.status = "running";
          phaseRun.startedAt = new Date().toISOString();
        }
        const identity = taskIdentity(request);
        const taskRun: TaskRun = {
          taskId: identity.taskId,
          name: identity.name,
          status: "running",
          promptHash: sha256(request.prompt),
          options: structuredClone(request.options as Record<string, unknown>),
          startedAt: new Date().toISOString(),
        };
        phaseRun.tasks.push(taskRun);
        persistAndRender(run, ctx, options);

        const task: WorkflowTask = {
          id: identity.taskId,
          name: identity.name,
          prompt: `${request.prompt}${schemaPrompt(request.options.schema)}`,
          ...(request.options.model ? { model: request.options.model } : {}),
          ...(request.options.tools ? { tools: request.options.tools } : {}),
          ...(request.options.cwd ? { cwd: request.options.cwd } : {}),
          ...(request.options.timeoutMs ? { timeoutMs: Math.min(request.options.timeoutMs, script.meta.pi.timeoutMs) } : {}),
        };
        const phase = workflowPhase(phasePath);
        const taskContext: TaskContext = {
          cwd: options.cwd,
          input: run.input,
          run,
          phase,
          priorOutputs: "",
          signal,
          onSubprocessEvent: (event) => renderWorkflowSubprocessEvent(ctx, run, event),
        };

        try {
          const scheduler = options.scheduler ?? globalWorkflowAgentScheduler;
          const result = await scheduler.schedule({
            signal,
            timeoutMs: task.timeoutMs,
            runId: run.runId,
            callId: identity.taskId,
          }, async (scheduledSignal) => await options.taskRunner.runTask(task, { ...taskContext, signal: scheduledSignal }));
          taskRun.output = result.output;
          taskRun.usage = result.usage;
          if (!result.ok) throw new WorkflowTaskError(identity.taskId, result.error || "Agent task failed.");
          const value = structuredOutput(result.output, request.options.schema);
          taskRun.status = "completed";
          return value;
        } catch (error) {
          taskRun.status = isCancellation(error) || signal.aborted ? "cancelled" : "failed";
          taskRun.error = errorMessage(error);
          throw error;
        } finally {
          taskRun.finishedAt = new Date().toISOString();
          persistAndRender(run, ctx, options);
        }
      },
    }, {
      signal: options.signal,
      timeoutMs: script.meta.pi.timeoutMs,
    });
    run.result = execution.result;
    transitionWorkflowRun(run, "completed");
  } catch (error) {
    if (isCancellation(error) || options.signal?.aborted) {
      transitionWorkflowRun(run, "cancelled");
      run.error = errorMessage(error instanceof Error ? error : new WorkflowCancelledError());
    } else {
      transitionWorkflowRun(run, "failed");
      run.error = errorMessage(error);
    }
    for (const phase of run.phases) {
      if (phase.status === "queued" || phase.status === "running") {
        phase.status = run.status === "cancelled" ? "cancelled" : "failed";
        phase.finishedAt = new Date().toISOString();
        phase.error ??= run.error;
      }
    }
  } finally {
    run.finishedAt = new Date().toISOString();
    run.updatedAt = run.finishedAt;
    run.summary = resultSummary(run);
    options.state.setLastRun(run);
    options.state.removeActiveRun(run.runId);
    persistAndRender(run, ctx, options);
  }

  return run;
}
