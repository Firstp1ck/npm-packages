import type { WorkflowDefinition, WorkflowInput, WorkflowRun } from "./types.ts";
import { createRunId } from "./utils.ts";

export const WORKFLOW_RUN_ENTRY_TYPE = "workflow-run";

type EntryLike = {
  type?: string;
  customType?: string;
  data?: unknown;
};

type AppendEntry = (customType: string, data?: unknown) => void;

export type WorkflowStateStore = {
  getActiveRun(): WorkflowRun | undefined;
  getActiveRuns(): WorkflowRun[];
  getRun(runId: string): WorkflowRun | undefined;
  getLastRun(): WorkflowRun | undefined;
  setActiveRun(run: WorkflowRun | undefined): void;
  removeActiveRun(runId: string): void;
  setLastRun(run: WorkflowRun | undefined): void;
  persistRun(run: WorkflowRun): void;
  restoreFromEntries(entries: EntryLike[]): WorkflowRun | undefined;
};

function snapshotRun(run: WorkflowRun): WorkflowRun {
  return JSON.parse(JSON.stringify(run)) as WorkflowRun;
}

function isWorkflowRun(value: unknown): value is WorkflowRun {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const run = value as Partial<WorkflowRun>;
  return typeof run.runId === "string" && typeof run.workflowKey === "string" && typeof run.status === "string";
}

export function createWorkflowRun(definition: WorkflowDefinition, input: WorkflowInput, sourcePath?: string): WorkflowRun {
  const now = new Date().toISOString();
  return {
    runId: createRunId(),
    workflowKey: definition.key,
    workflowName: definition.name,
    sourcePath,
    status: "queued",
    input,
    phases: definition.phases.map((phase) => ({
      phaseId: phase.id,
      name: phase.name,
      status: "queued",
      tasks: phase.tasks.map((task) => ({
        taskId: task.id,
        name: task.name,
        status: "queued",
      })),
    })),
    startedAt: now,
  };
}

export function latestWorkflowRunFromEntries(entries: EntryLike[]): WorkflowRun | undefined {
  let latest: WorkflowRun | undefined;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== WORKFLOW_RUN_ENTRY_TYPE) continue;
    if (isWorkflowRun(entry.data)) latest = entry.data;
  }
  return latest;
}

export function createWorkflowStateStore(pi?: { appendEntry?: AppendEntry }): WorkflowStateStore {
  const activeRuns = new Map<string, WorkflowRun>();
  let lastRun: WorkflowRun | undefined;

  return {
    getActiveRun() {
      return [...activeRuns.values()].at(-1);
    },
    getActiveRuns() {
      return [...activeRuns.values()];
    },
    getRun(runId) {
      return activeRuns.get(runId) ?? (lastRun?.runId === runId ? lastRun : undefined);
    },
    getLastRun() {
      return lastRun;
    },
    setActiveRun(run) {
      if (run) {
        activeRuns.set(run.runId, run);
        lastRun = run;
      } else activeRuns.clear();
    },
    removeActiveRun(runId) {
      activeRuns.delete(runId);
    },
    setLastRun(run) {
      lastRun = run;
    },
    persistRun(run) {
      const snapshot = snapshotRun(run);
      lastRun = snapshot;
      try {
        pi?.appendEntry?.(WORKFLOW_RUN_ENTRY_TYPE, snapshot);
      } catch {
        // Session persistence is best-effort. The in-memory state remains authoritative for this process.
      }
    },
    restoreFromEntries(entries) {
      const restored = latestWorkflowRunFromEntries(entries);
      if (restored) lastRun = restored;
      return restored;
    },
  };
}
