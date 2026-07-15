import { WorkflowValidationError } from "./errors.ts";
import type { WorkflowRun, WorkflowRunStatus } from "./types.ts";

const TRANSITIONS: Readonly<Record<WorkflowRunStatus, ReadonlySet<WorkflowRunStatus>>> = {
  queued: new Set(["validating", "running", "cancelled", "failed"]),
  validating: new Set(["awaiting_approval", "running", "cancelled", "failed"]),
  awaiting_approval: new Set(["queued", "running", "cancelled", "failed"]),
  running: new Set(["paused", "completed", "failed", "cancelled"]),
  paused: new Set(["queued", "running", "cancelled", "failed"]),
  completed: new Set(),
  failed: new Set(["queued"]),
  cancelled: new Set(["queued"]),
};

export function canTransitionWorkflowRun(from: WorkflowRunStatus, to: WorkflowRunStatus): boolean {
  return from === to || TRANSITIONS[from].has(to);
}

export function transitionWorkflowRun(run: WorkflowRun, next: WorkflowRunStatus, timestamp = new Date().toISOString()): void {
  if (!canTransitionWorkflowRun(run.status, next)) {
    throw new WorkflowValidationError([`invalid workflow run transition '${run.status}' -> '${next}' for ${run.runId}.`]);
  }
  run.status = next;
  run.updatedAt = timestamp;
  if (next === "completed" || next === "failed" || next === "cancelled") run.finishedAt ??= timestamp;
}
