import { WorkflowCancelledError, WorkflowValidationError, errorMessage } from "./errors.ts";
import {
  WORKFLOW_PERSISTENCE_SCHEMA_VERSION,
  sha256,
  type WorkflowCallRecordV1,
  type WorkflowEventRecordV1,
  type WorkflowResultRecordV1,
  type WorkflowRunRecordV1,
  type WorkflowUsageRecordV1,
} from "./persistence-schema.ts";
import type { WorkflowRunStorage } from "./run-storage.ts";
import { canTransitionWorkflowRun, transitionWorkflowRun } from "./run-status.ts";
import { globalWorkflowAgentScheduler, type WorkflowAgentScheduler } from "./scheduler.ts";
import type { TaskRun, WorkflowRun, WorkflowRunStatus, WorkflowUsage } from "./types.ts";

export const WORKFLOW_REQUEST_MESSAGE_TYPE = "workflow-request";
export const WORKFLOW_RESULT_MESSAGE_TYPE = "workflow-result";

export type WorkflowRunLaunch = {
  run: WorkflowRun;
  storage: WorkflowRunStorage;
  projectId: string;
  scriptSnapshot?: { source: string; hash: string };
  policySnapshot: unknown;
  scheduler?: WorkflowAgentScheduler;
  execute(signal: AbortSignal, onRunUpdate: (run: WorkflowRun) => void): Promise<WorkflowRun>;
};

export type WorkflowRunLaunchReceipt = {
  runId: string;
  taskId: string;
  status: "async_launched";
  summary: string;
  scriptPath?: string;
  completion: Promise<WorkflowRun>;
};

export type WorkflowRunManagerOptions = {
  shutdownTimeoutMs?: number;
  onRequest?: (run: WorkflowRun) => void;
  onResult?: (run: WorkflowRun) => void;
  onPersistenceError?: (run: WorkflowRun, error: unknown) => void;
};

type ManagedRun = {
  run: WorkflowRun;
  storage: WorkflowRunStorage;
  controller: AbortController;
  scheduler: WorkflowAgentScheduler;
  completion: Promise<WorkflowRun>;
  resolveCompletion: (run: WorkflowRun) => void;
  sequence: number;
  writeQueue: Promise<void>;
  persistedCalls: Map<string, string>;
  persistedUsage: Set<string>;
};

function runRecord(run: WorkflowRun, storage: WorkflowRunStorage): WorkflowRunRecordV1 {
  if (!run.projectId) throw new WorkflowValidationError([`run ${run.runId} is missing projectId.`]);
  return {
    schemaVersion: WORKFLOW_PERSISTENCE_SCHEMA_VERSION,
    kind: "run",
    runId: run.runId,
    sessionId: storage.sessionId,
    projectId: run.projectId,
    workflowName: run.workflowName,
    sourceType: run.sourceType ?? "json",
    status: run.status,
    ...(run.scriptHash ? { scriptHash: run.scriptHash } : {}),
    ...(run.policyHash ? { policyHash: run.policyHash } : {}),
    ...(run.snapshotPath ? { snapshotPath: run.snapshotPath } : {}),
    ...(run.resumedFromRunId ? { resumedFromRunId: run.resumedFromRunId } : {}),
    input: structuredClone(run.input),
    startedAt: run.startedAt,
    updatedAt: run.updatedAt ?? run.startedAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
  };
}

export function workflowCallId(phaseId: string, task: TaskRun): string {
  return `call-${sha256(`${phaseId}\0${task.callIndex ?? 0}\0${task.fingerprint ?? task.taskId}`).slice(0, 32)}`;
}

function callRecord(run: WorkflowRun, phaseId: string, task: TaskRun): WorkflowCallRecordV1 | undefined {
  if (!task.callIndex || !task.prompt || !task.promptHash || !task.fingerprint) return undefined;
  const label = task.label?.trim();
  return {
    schemaVersion: 1,
    kind: "call",
    runId: run.runId,
    callId: workflowCallId(phaseId, task),
    callIndex: task.callIndex,
    phasePath: phaseId.split("/").filter(Boolean),
    ...(label ? { label } : {}),
    prompt: task.prompt,
    promptHash: task.promptHash,
    fingerprint: task.fingerprint,
    ...(task.pipelineKey ? { pipelineKey: task.pipelineKey } : {}),
    status: task.status,
    options: structuredClone(task.options ?? {}),
    ...("result" in task
      ? { result: structuredClone(task.result) }
      : task.output !== undefined
        ? { result: task.output }
        : {}),
    ...(task.usage ? { usage: structuredClone(task.usage) } : {}),
    ...(task.recentEvents?.length ? { recentEvents: structuredClone(task.recentEvents) as Array<Record<string, unknown>> } : {}),
    ...(task.worktree ? { worktree: structuredClone(task.worktree) } : {}),
    ...(task.startedAt ? { startedAt: task.startedAt } : {}),
    ...(task.finishedAt ? { finishedAt: task.finishedAt } : {}),
    ...(task.error ? { error: task.error } : {}),
    ...(task.errorKind ? { errorKind: task.errorKind } : {}),
  };
}

function addUsage(target: WorkflowUsage, usage: WorkflowUsage): void {
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "cost", "turns"] as const) {
    if (usage[key] !== undefined) target[key] = (target[key] ?? 0) + Number(usage[key]);
  }
  if (usage.contextTokens !== undefined) target.contextTokens = Math.max(target.contextTokens ?? 0, usage.contextTokens);
}

function aggregateUsage(run: WorkflowRun): WorkflowUsage {
  const usage: WorkflowUsage = {};
  for (const phase of run.phases) for (const task of phase.tasks) if (task.usage) addUsage(usage, task.usage);
  return usage;
}

function phaseUsage(run: WorkflowRun, phaseId: string): WorkflowUsage {
  const usage: WorkflowUsage = {};
  const phase = run.phases.find((candidate) => candidate.phaseId === phaseId);
  for (const task of phase?.tasks ?? []) if (task.usage) addUsage(usage, task.usage);
  return usage;
}

function hasUsage(usage: WorkflowUsage): boolean {
  return Object.keys(usage).length > 0;
}

function resultMarkdown(run: WorkflowRun): string {
  const value = run.result;
  const rendered = typeof value === "string"
    ? value
    : value === undefined
      ? run.summary ?? ""
      : `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
  return [
    `# Workflow Result: ${run.workflowKey}`,
    "",
    `Status: ${run.status}`,
    `Run: ${run.runId}`,
    "",
    rendered,
    run.error ? `\nError: ${run.error}` : "",
  ].join("\n").trim();
}

function isTerminal(status: WorkflowRunStatus): status is "completed" | "failed" | "cancelled" {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export class WorkflowRunManager {
  readonly #runs = new Map<string, ManagedRun>();
  readonly #restored = new Map<string, WorkflowRunRecordV1>();
  readonly #options: Required<Pick<WorkflowRunManagerOptions, "shutdownTimeoutMs">> & WorkflowRunManagerOptions;

  constructor(options: WorkflowRunManagerOptions = {}) {
    this.#options = { shutdownTimeoutMs: options.shutdownTimeoutMs ?? 10_000, ...options };
  }

  get(runId: string): WorkflowRun | undefined {
    return this.#runs.get(runId)?.run;
  }

  getRecord(runId: string): WorkflowRunRecordV1 | undefined {
    const managed = this.#runs.get(runId);
    return managed ? runRecord(managed.run, managed.storage) : this.#restored.get(runId);
  }

  list(): WorkflowRunRecordV1[] {
    const current = [...this.#runs.values()].map((managed) => runRecord(managed.run, managed.storage));
    const ids = new Set(current.map((record) => record.runId));
    return [...current, ...[...this.#restored.values()].filter((record) => !ids.has(record.runId))]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  active(): WorkflowRun[] {
    return [...this.#runs.values()].map((managed) => managed.run).filter((run) => !isTerminal(run.status));
  }

  #enqueue(managed: ManagedRun, write: () => Promise<void>): void {
    managed.writeQueue = managed.writeQueue.then(write).catch((error) => {
      try { this.#options.onPersistenceError?.(managed.run, error); } catch { /* observer failures cannot break manager cleanup */ }
    });
  }

  #persistUpdate(managed: ManagedRun, eventType = "run.updated"): void {
    const snapshot = structuredClone(managed.run);
    const sequence = managed.sequence++;
    this.#enqueue(managed, async () => {
      await managed.storage.writeRun(runRecord(snapshot, managed.storage));
      const event: WorkflowEventRecordV1 = {
        schemaVersion: 1,
        kind: "event",
        runId: snapshot.runId,
        sequence,
        timestamp: snapshot.updatedAt ?? new Date().toISOString(),
        eventType,
        data: { status: snapshot.status, phases: snapshot.phases.length },
      };
      await managed.storage.appendEvent(event);

      for (const phase of snapshot.phases) {
        for (const task of phase.tasks) {
          const call = callRecord(snapshot, phase.phaseId, task);
          if (!call) continue;
          const fingerprint = JSON.stringify(call);
          if (managed.persistedCalls.get(call.callId) !== fingerprint) {
            await managed.storage.writeCall(call);
            managed.persistedCalls.set(call.callId, fingerprint);
          }
          if (task.usage && task.finishedAt) {
            const usageKey = `${call.callId}:${task.finishedAt}`;
            if (!managed.persistedUsage.has(usageKey)) {
              const usage: WorkflowUsageRecordV1 = {
                schemaVersion: 1,
                kind: "usage",
                runId: snapshot.runId,
                scope: "agent",
                scopeId: call.callId,
                usage: task.usage,
                recordedAt: task.finishedAt,
              };
              await managed.storage.appendUsage(usage);
              managed.persistedUsage.add(usageKey);
            }
          }
        }
      }
    });
  }

  update(runId: string, run: WorkflowRun, eventType = "run.updated"): void {
    const managed = this.#runs.get(runId);
    if (!managed || managed.run !== run) throw new WorkflowValidationError([`unknown or mismatched managed run '${runId}'.`]);
    this.#persistUpdate(managed, eventType);
  }

  async launch(launch: WorkflowRunLaunch): Promise<WorkflowRunLaunchReceipt> {
    const run = launch.run;
    if (this.#runs.has(run.runId) || this.#restored.has(run.runId)) throw new WorkflowValidationError([`duplicate workflow run ID '${run.runId}'.`]);
    if (run.status !== "queued") throw new WorkflowValidationError(["new managed runs must begin in queued status."]);
    run.projectId = launch.projectId;
    run.updatedAt ??= run.startedAt;

    const controller = new AbortController();
    let resolveCompletion!: (run: WorkflowRun) => void;
    const completion = new Promise<WorkflowRun>((resolve) => { resolveCompletion = resolve; });
    const managed: ManagedRun = {
      run,
      storage: launch.storage,
      controller,
      scheduler: launch.scheduler ?? globalWorkflowAgentScheduler,
      completion,
      resolveCompletion,
      sequence: 0,
      writeQueue: Promise.resolve(),
      persistedCalls: new Map(),
      persistedUsage: new Set(),
    };
    this.#runs.set(run.runId, managed);

    try {
      if (launch.scriptSnapshot) {
        const snapshot = await launch.storage.snapshotScript(run.runId, launch.scriptSnapshot.source, launch.scriptSnapshot.hash);
        run.scriptHash = snapshot.scriptHash;
        run.snapshotPath = snapshot.scriptPath;
      } else await launch.storage.runDirectory(run.runId);
      await launch.storage.writePolicy(run.runId, launch.policySnapshot);
      await launch.storage.writeRun(runRecord(run, launch.storage));
      await launch.storage.appendEvent({
        schemaVersion: 1, kind: "event", runId: run.runId, sequence: managed.sequence++, timestamp: run.updatedAt, eventType: "run.accepted", data: { workflowKey: run.workflowKey },
      });
    } catch (error) {
      this.#runs.delete(run.runId);
      throw error;
    }

    try { this.#options.onRequest?.(run); } catch { /* launch remains valid after durable acceptance */ }
    queueMicrotask(() => {
      void (async () => {
        try {
          const completed = await launch.execute(controller.signal, (updated) => this.update(run.runId, updated));
          if (completed !== run) throw new WorkflowValidationError([`runner replaced managed run object '${run.runId}'.`]);
          if (!isTerminal(run.status)) transitionWorkflowRun(run, "completed");
        } catch (error) {
          if (!isTerminal(run.status)) {
            const next = controller.signal.aborted ? "cancelled" : "failed";
            if (canTransitionWorkflowRun(run.status, next)) transitionWorkflowRun(run, next);
          }
          run.error ??= errorMessage(error);
          run.finishedAt ??= new Date().toISOString();
        } finally {
          managed.scheduler.resumeRun(run.runId);
          run.usage = aggregateUsage(run);
          this.#persistUpdate(managed, "run.finished");
          this.#enqueue(managed, async () => {
            for (const phase of run.phases) {
              const usage = phaseUsage(run, phase.phaseId);
              if (hasUsage(usage)) {
                await managed.storage.appendUsage({ schemaVersion: 1, kind: "usage", runId: run.runId, scope: "phase", scopeId: phase.phaseId, usage, recordedAt: phase.finishedAt ?? run.finishedAt ?? new Date().toISOString() });
              }
            }
            if (hasUsage(run.usage ?? {})) {
              await managed.storage.appendUsage({ schemaVersion: 1, kind: "usage", runId: run.runId, scope: "run", scopeId: run.runId, usage: run.usage ?? {}, recordedAt: run.finishedAt ?? new Date().toISOString() });
            }
            const status = isTerminal(run.status) ? run.status : "failed";
            const result: WorkflowResultRecordV1 = {
              schemaVersion: 1,
              kind: "result",
              runId: run.runId,
              status,
              finishedAt: run.finishedAt ?? new Date().toISOString(),
              ...(run.summary ? { summary: run.summary } : {}),
              ...(run.result !== undefined ? { result: run.result } : {}),
              ...(run.error ? { error: run.error } : {}),
              ...(run.errorKind ? { errorKind: run.errorKind } : {}),
            };
            await managed.storage.writeResult(result, resultMarkdown(run));
          });
          await managed.writeQueue;
          try { this.#options.onResult?.(run); } catch { /* completion must always settle even if UI/session delivery is unavailable */ }
          managed.resolveCompletion(run);
        }
      })();
    });

    return {
      runId: run.runId,
      taskId: `workflow-task-${run.runId}`,
      status: "async_launched",
      summary: run.workflowName,
      scriptPath: run.snapshotPath,
      completion,
    };
  }

  pause(runId: string): boolean {
    const managed = this.#runs.get(runId);
    if (!managed || managed.run.status !== "running") return false;
    managed.scheduler.pauseRun(runId);
    transitionWorkflowRun(managed.run, "paused");
    this.#persistUpdate(managed, "run.paused");
    return true;
  }

  resume(runId: string): boolean {
    const managed = this.#runs.get(runId);
    if (!managed || managed.run.status !== "paused") return false;
    transitionWorkflowRun(managed.run, "running");
    managed.scheduler.resumeRun(runId);
    this.#persistUpdate(managed, "run.resumed");
    return true;
  }

  abort(runId: string, reason = "Workflow abort requested."): boolean {
    const managed = this.#runs.get(runId);
    if (!managed || isTerminal(managed.run.status)) return false;
    managed.scheduler.resumeRun(runId);
    managed.controller.abort(new WorkflowCancelledError(reason));
    return true;
  }

  async restore(storage: WorkflowRunStorage): Promise<WorkflowRunRecordV1[]> {
    const records = await storage.listRuns();
    for (const record of records) {
      if (!isTerminal(record.status)) {
        record.status = "failed";
        record.finishedAt = new Date().toISOString();
        record.updatedAt = record.finishedAt;
        await storage.writeRun(record);
        await storage.appendEvent({ schemaVersion: 1, kind: "event", runId: record.runId, sequence: Number.MAX_SAFE_INTEGER, timestamp: record.updatedAt, eventType: "run.interrupted", data: { reason: "host restarted before workflow completion" } });
      }
      this.#restored.set(record.runId, record);
    }
    return records;
  }

  async shutdown(reason = "Workflow host is shutting down."): Promise<void> {
    const active = [...this.#runs.values()].filter((managed) => !isTerminal(managed.run.status));
    for (const managed of active) managed.controller.abort(new WorkflowCancelledError(reason));
    if (active.length === 0) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled(active.map((managed) => managed.completion)),
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, this.#options.shutdownTimeoutMs); }),
    ]);
    if (timeout) clearTimeout(timeout);
    for (const managed of active) {
      if (!isTerminal(managed.run.status) && canTransitionWorkflowRun(managed.run.status, "cancelled")) {
        transitionWorkflowRun(managed.run, "cancelled");
        managed.run.error = reason;
        this.#persistUpdate(managed, "run.shutdown-timeout");
      }
    }
    await Promise.allSettled(active.map((managed) => managed.writeQueue));
  }
}
