import { workflowCallFingerprint } from "./call-fingerprint.ts";
import { WorkflowCancelledError, WorkflowError, WorkflowTaskError, errorMessage, isCancellation } from "./errors.ts";
import { hashWorkflowPolicy, sha256, workflowProjectIdentity } from "./persistence-schema.ts";
import type { WorkflowReplayCache } from "./replay.ts";
import type { WorkflowRunStorage } from "./run-storage.ts";
import { transitionWorkflowRun } from "./run-status.ts";
import { DEFAULT_ALLOWED_TOOLS } from "./schema.ts";
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
  WorkflowScriptPolicy,
  WorkflowTask,
  WorkflowUsage,
} from "./types.ts";
import type { WorkflowStateStore } from "./state.ts";
import { renderWorkflowRun, renderWorkflowSubprocessEvent, renderWorkflowSubprocessWidget, type WorkflowUIContext } from "./ui.ts";
import { createRunId, formatDuration } from "./utils.ts";
import { captureWorkflowWorktree, createWorkflowWorktree } from "./worktree.ts";

export type JavaScriptWorkflowRunnerOptions = {
  cwd: string;
  taskRunner: TaskRunner;
  state: WorkflowStateStore;
  storage?: WorkflowRunStorage;
  scheduler?: WorkflowAgentScheduler;
  run?: WorkflowRun;
  replay?: WorkflowReplayCache;
  policy?: WorkflowScriptPolicy;
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

function usageTokens(usage: WorkflowUsage | undefined): number {
  return (usage?.input ?? 0) + (usage?.output ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0);
}

function usageCost(usage: WorkflowUsage | undefined): number {
  return usage?.cost ?? 0;
}

function budgetUsage(tasks: TaskRun[]): { tokens: number; cost: number } {
  return tasks.reduce((total, task) => ({ tokens: total.tokens + usageTokens(task.usage), cost: total.cost + usageCost(task.usage) }), { tokens: 0, cost: 0 });
}

function enforceBudgets(run: WorkflowRun, phase: PhaseRun, policy: WorkflowScriptPolicy): void {
  const runBudget = policy.budgets?.run;
  const phaseBudget = policy.budgets?.phase;
  const allTasks = run.phases.flatMap((item) => item.tasks);
  const runUsage = budgetUsage(allTasks);
  const currentUsage = budgetUsage(phase.tasks);
  const checks: Array<[boolean, string]> = [
    [Boolean(runBudget?.maxAgents && allTasks.length > runBudget.maxAgents), `run agent budget exceeded ${runBudget?.maxAgents}`],
    [Boolean(phaseBudget?.maxAgents && phase.tasks.length > phaseBudget.maxAgents), `phase '${phase.name}' agent budget exceeded ${phaseBudget?.maxAgents}`],
    [Boolean(runBudget?.maxTokens && runUsage.tokens > runBudget.maxTokens), `run token budget exceeded ${runBudget?.maxTokens}`],
    [Boolean(phaseBudget?.maxTokens && currentUsage.tokens > phaseBudget.maxTokens), `phase '${phase.name}' token budget exceeded ${phaseBudget?.maxTokens}`],
    [Boolean(runBudget?.maxCostUsd !== undefined && runUsage.cost > runBudget.maxCostUsd), `run cost budget exceeded $${runBudget?.maxCostUsd}`],
    [Boolean(phaseBudget?.maxCostUsd !== undefined && currentUsage.cost > phaseBudget.maxCostUsd), `phase '${phase.name}' cost budget exceeded $${phaseBudget?.maxCostUsd}`],
    [Boolean(runBudget?.maxTimeMs && Date.now() - Date.parse(run.startedAt) > runBudget.maxTimeMs), `run time budget exceeded ${runBudget?.maxTimeMs}ms`],
    [Boolean(phaseBudget?.maxTimeMs && phase.startedAt && Date.now() - Date.parse(phase.startedAt) > phaseBudget.maxTimeMs), `phase '${phase.name}' time budget exceeded ${phaseBudget?.maxTimeMs}ms`],
  ];
  const failure = checks.find(([exceeded]) => exceeded);
  if (failure) throw new WorkflowError("budget_exhausted", failure[1]);
}

function transientTaskFailure(message: string): boolean {
  return /(?:429|408|5\d\d|rate.?limit|timeout|temporar|overload|network|econnreset|eai_again)/i.test(message);
}

async function retryDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => { clearTimeout(timer); reject(signal.reason ?? new WorkflowCancelledError()); };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
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

export function effectiveScript(script: WorkflowScriptDefinition, ceiling: Partial<WorkflowScriptPolicy> = {}): WorkflowScriptDefinition {
  return {
    ...script,
    meta: {
      ...script.meta,
      pi: effectiveWorkflowPolicy(script.meta.pi, {
        maxConcurrency: 8,
        maxAgents: 100,
        timeoutMs: script.meta.pi.timeoutMs,
        permissions: ceiling.permissions ?? { write: false, shell: false, network: false },
        shellAllowlist: ceiling.shellAllowlist,
        networkAllowlist: ceiling.networkAllowlist,
        verificationCommands: ceiling.verificationCommands,
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
  const script = options.policy
    ? { ...source.script, meta: { ...source.script.meta, pi: structuredClone(options.policy) } }
    : effectiveScript(source.script);
  if (options.replay) run.resumedFromRunId = options.replay.sourceRunId;
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
        const fingerprint = workflowCallFingerprint({
          phasePath,
          label: request.options.label,
          prompt: request.prompt,
          options: request.options,
          pipelineKey: request.pipelineKey,
        });
        const taskRun: TaskRun = {
          taskId: identity.taskId,
          name: identity.name,
          ...(request.options.label?.trim() ? { label: request.options.label.trim() } : {}),
          callIndex: request.callIndex,
          status: "running",
          prompt: request.prompt,
          promptHash: sha256(request.prompt),
          fingerprint,
          ...(request.pipelineKey ? { pipelineKey: request.pipelineKey } : {}),
          options: structuredClone(request.options as Record<string, unknown>),
          startedAt: new Date().toISOString(),
        };
        if (options.replay) {
          run.resumeWarnings ??= [];
          if (!request.options.label?.trim()) {
            const warning = request.pipelineKey
              ? `Unlabeled resumed call at ${phasePath.join("/")} (${request.pipelineKey}); add a stable label to make edits easier to diagnose.`
              : `Unlabeled resumed call at ${phasePath.join("/")}; add a stable label and pipeline key to make replay deterministic.`;
            if (!run.resumeWarnings.includes(warning)) run.resumeWarnings.push(warning);
          }
          if (request.pipelineKey?.includes(":index:")) {
            const warning = `Pipeline call at ${phasePath.join("/")} uses an index-derived key (${request.pipelineKey}); provide pipeline(..., { key }) before reordering items.`;
            if (!run.resumeWarnings.includes(warning)) run.resumeWarnings.push(warning);
          }
        }
        phaseRun.tasks.push(taskRun);
        persistAndRender(run, ctx, options);

        const requestedTools = request.options.tools?.length ? request.options.tools : [...DEFAULT_ALLOWED_TOOLS];
        const allowedTools = new Set<string>(DEFAULT_ALLOWED_TOOLS);
        if (script.meta.pi.permissions.write) for (const tool of ["write", "edit", "apply_patch"]) allowedTools.add(tool);
        if (script.meta.pi.permissions.shell) allowedTools.add("bash");
        if (script.meta.pi.permissions.network) for (const tool of ["fetch_content", "web_search", "brave_search"]) allowedTools.add(tool);
        const deniedTool = requestedTools.find((tool) => !allowedTools.has(tool));
        const needsWriteIsolation = requestedTools.some((tool) => ["write", "edit", "apply_patch"].includes(tool));
        const policyDescription = `\n\nWorkflow agent policy: root all filesystem operations inside the assigned cwd. Write=${script.meta.pi.permissions.write}; shell=${script.meta.pi.permissions.shell}; network=${script.meta.pi.permissions.network}.`;
        const task: WorkflowTask = {
          id: identity.taskId,
          name: identity.name,
          prompt: `${request.prompt}${schemaPrompt(request.options.schema)}${policyDescription}`,
          ...(request.options.model ? { model: request.options.model } : {}),
          tools: requestedTools,
          ...(request.options.cwd ? { cwd: request.options.cwd } : {}),
          ...(request.options.timeoutMs ? { timeoutMs: Math.min(request.options.timeoutMs, script.meta.pi.timeoutMs) } : {}),
        };
        const phase = workflowPhase(phasePath);
        let taskRoot = options.cwd;

        try {
          if (deniedTool) throw new WorkflowTaskError(identity.taskId, `Workflow policy denied requested tool '${deniedTool}'.`);
          enforceBudgets(run, phaseRun, script.meta.pi);
          const cached = options.replay?.take(fingerprint);
          if (cached) {
            taskRun.status = "completed";
            taskRun.result = structuredClone(cached.result);
            taskRun.output = typeof cached.result === "string" ? cached.result : JSON.stringify(cached.result);
            taskRun.usage = cached.usage ? structuredClone(cached.usage) : undefined;
            enforceBudgets(run, phaseRun, script.meta.pi);
            return structuredClone(cached.result);
          }
          if (needsWriteIsolation) {
            if (!options.storage) throw new WorkflowTaskError(identity.taskId, "Write agents require durable run storage for isolated worktrees.");
            const runDir = await options.storage.runDirectory(run.runId);
            taskRun.worktree = await createWorkflowWorktree({ repoCwd: options.cwd, runDir, runId: run.runId, callId: `${identity.taskId}-${request.callIndex}` });
            taskRoot = taskRun.worktree.worktreePath;
            persistAndRender(run, ctx, options);
          }
          const taskContext: TaskContext = {
            cwd: taskRoot,
            input: run.input,
            run,
            phase,
            priorOutputs: "",
            signal,
            agentPolicy: {
              root: taskRoot,
              permissions: script.meta.pi.permissions,
              allowedTools: [...allowedTools],
              shellAllowlist: script.meta.pi.shellAllowlist ?? [],
              networkAllowlist: script.meta.pi.networkAllowlist ?? [],
            },
            onSubprocessEvent: (event) => {
              taskRun.recentEvents ??= [];
              taskRun.recentEvents.push(structuredClone(event));
              if (taskRun.recentEvents.length > 20) taskRun.recentEvents.splice(0, taskRun.recentEvents.length - 20);
              persistAndRender(run, ctx, options);
              renderWorkflowSubprocessEvent(ctx, run, event);
            },
          };
          const scheduler = options.scheduler ?? globalWorkflowAgentScheduler;
          const retry = script.meta.pi.retry ?? { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, jitter: 0 };
          const attempts = needsWriteIsolation ? 1 : retry.maxAttempts;
          let result: Awaited<ReturnType<TaskRunner["runTask"]>> | undefined;
          for (let attempt = 1; attempt <= attempts; attempt++) {
            const runRemaining = script.meta.pi.budgets?.run?.maxTimeMs === undefined ? Number.POSITIVE_INFINITY : script.meta.pi.budgets.run.maxTimeMs - (Date.now() - Date.parse(run.startedAt));
            const phaseRemaining = script.meta.pi.budgets?.phase?.maxTimeMs === undefined || !phaseRun.startedAt ? Number.POSITIVE_INFINITY : script.meta.pi.budgets.phase.maxTimeMs - (Date.now() - Date.parse(phaseRun.startedAt));
            const timeoutMs = Math.max(1, Math.min(task.timeoutMs ?? script.meta.pi.timeoutMs, runRemaining, phaseRemaining));
            result = await scheduler.schedule({
              signal,
              timeoutMs,
              runId: run.runId,
              callId: identity.taskId,
            }, async (scheduledSignal) => await options.taskRunner.runTask(task, { ...taskContext, signal: scheduledSignal }));
            if (result.ok) break;
            const failure = result.error || "Agent task failed.";
            if (attempt >= attempts || !transientTaskFailure(failure)) throw new WorkflowTaskError(identity.taskId, failure);
            const exponential = Math.min(retry.maxDelayMs, retry.baseDelayMs * (2 ** (attempt - 1)));
            const jitter = exponential * retry.jitter * ((Math.random() * 2) - 1);
            const delayMs = Math.max(0, Math.round(exponential + jitter));
            taskRun.recentEvents ??= [];
            taskRun.recentEvents.push({ type: "event", timestamp: new Date().toISOString(), phaseId: phase.id, phaseName: phase.name, taskId: task.id, taskName: task.name, eventType: "workflow_retry", line: `transient failure; retry ${attempt + 1}/${attempts} in ${delayMs}ms: ${failure}` });
            persistAndRender(run, ctx, options);
            await retryDelay(delayMs, signal);
          }
          if (!result) throw new WorkflowTaskError(identity.taskId, "Agent task produced no result.");
          taskRun.output = result.output;
          taskRun.usage = result.usage;
          if (!result.ok) throw new WorkflowTaskError(identity.taskId, result.error || "Agent task failed.");
          const value = structuredOutput(result.output, request.options.schema);
          if (taskRun.worktree) taskRun.worktree = await captureWorkflowWorktree(taskRun.worktree);
          taskRun.status = "completed";
          taskRun.result = structuredClone(value);
          enforceBudgets(run, phaseRun, script.meta.pi);
          return value;
        } catch (error) {
          if (taskRun.worktree) {
            try { taskRun.worktree = await captureWorkflowWorktree(taskRun.worktree); } catch (captureError) { taskRun.error = `Worktree capture failed: ${errorMessage(captureError)}`; }
          }
          taskRun.status = isCancellation(error) || signal.aborted ? "cancelled" : "failed";
          taskRun.error ??= errorMessage(error);
          if (error instanceof WorkflowError) taskRun.errorKind = error.kind;
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
    const categorizedTask = run.phases.flatMap((phase) => phase.tasks).find((task) => task.errorKind);
    if (error instanceof WorkflowError) run.errorKind = categorizedTask?.errorKind ?? error.kind;
    else if (categorizedTask?.errorKind) run.errorKind = categorizedTask.errorKind;
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
