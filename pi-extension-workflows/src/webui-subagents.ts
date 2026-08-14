import { sha256 } from "./persistence-schema.ts";
import { workflowCallId, type WorkflowRunManager } from "./run-manager.ts";
import type { TaskRun, WorkflowRun } from "./types.ts";

export const WORKFLOW_SUBAGENTS_EVENT = "firstpick:workflow-subagents:v1";
export const WEBUI_AGENT_RUNS_EVENT = "firstpick:webui-agent-runs:v1";
export const WORKFLOW_SUBAGENTS_VERSION = 1 as const;

export const WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS = {
  runs: 32,
  agentsPerRun: 32,
  nameBytes: 160,
  activityBytes: 80,
  recentOutputLines: 8,
  recentOutputLineBytes: 500,
  // Keep provider IDs at or below the protocol's common unchanged-ID threshold.
  runIdentifierBytes: 120,
  agentIdentifierBytes: 120,
} as const;

export type WorkflowSubagentSnapshotAgent = {
  id: string;
  name: string;
  status: "running" | "done" | "failed" | "cancelled";
  index: number;
  activityState?: string;
  model?: string;
  recentOutput?: string[];
};

export type WorkflowSubagentSnapshotRun = {
  id: string;
  source: "workflow";
  name: string;
  status: WorkflowRun["status"];
  startedAt: string;
  agents: WorkflowSubagentSnapshotAgent[];
};

export type WorkflowSubagentsSnapshot = {
  version: typeof WORKFLOW_SUBAGENTS_VERSION;
  updatedAt: string;
  runs: WorkflowSubagentSnapshotRun[];
};

type WorkflowRunSource = Pick<WorkflowRunManager, "active"> & Partial<Pick<WorkflowRunManager, "list" | "get">>;

function boundedText(value: unknown, maxBytes: number): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  const suffix = "…";
  let end = Math.min(text.length, maxBytes);
  while (end > 0 && Buffer.byteLength(text.slice(0, end) + suffix, "utf8") > maxBytes) end--;
  return `${text.slice(0, end)}${suffix}`;
}

function boundedIdentifier(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const suffix = `-${sha256(value).slice(0, 12)}`;
  let end = Math.min(value.length, maxBytes - Buffer.byteLength(suffix, "utf8"));
  while (end > 0 && Buffer.byteLength(value.slice(0, end) + suffix, "utf8") > maxBytes) end--;
  return `${value.slice(0, end)}${suffix}`;
}

function workflowRunSnapshotId(run: WorkflowRun): string {
  return boundedIdentifier(`workflow:${run.runId}`, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.runIdentifierBytes);
}

function workflowAgentSnapshotId(run: WorkflowRun, phaseId: string, task: TaskRun): string {
  return boundedIdentifier(
    `workflow:${run.runId}:phase:${phaseId}:call:${workflowCallId(phaseId, task)}`,
    WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.agentIdentifierBytes,
  );
}

function recentOutput(task: TaskRun): string[] | undefined {
  const lines = (task.recentEvents ?? [])
    // Start events include the full child command, including the workflow prompt.
    // The snapshot must never publish it.
    .filter((event) => event.type !== "start" && typeof event.line === "string")
    .map((event) => boundedText(event.line, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.recentOutputLineBytes))
    .filter(Boolean)
    .slice(-WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.recentOutputLines);
  return lines.length ? lines : undefined;
}

function activityState(task: TaskRun): string | undefined {
  const event = task.recentEvents?.at(-1);
  if (!event) return task.status === "running" ? "starting" : undefined;
  const state = event.type === "event" && event.eventType ? event.eventType : event.type;
  return boundedText(state, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.activityBytes) || undefined;
}

function canonicalTaskStatus(status: TaskRun["status"]): WorkflowSubagentSnapshotAgent["status"] {
  if (status === "completed") return "done";
  if (status === "failed" || status === "cancelled") return status;
  return "running";
}

function snapshotAgent(run: WorkflowRun, phaseId: string, task: TaskRun, index: number): WorkflowSubagentSnapshotAgent {
  const model = typeof task.options?.model === "string"
    ? boundedText(task.options.model, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.nameBytes)
    : "";
  const output = recentOutput(task);
  const activity = activityState(task);
  return {
    id: workflowAgentSnapshotId(run, phaseId, task),
    name: boundedText(task.label ?? task.name ?? task.taskId, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.nameBytes) || "Workflow agent",
    status: canonicalTaskStatus(task.status),
    index,
    ...(activity ? { activityState: activity } : {}),
    ...(model ? { model } : {}),
    ...(output ? { recentOutput: output } : {}),
  };
}

function snapshotRun(run: WorkflowRun): WorkflowSubagentSnapshotRun {
  const agents = run.phases
    .flatMap((phase) => phase.tasks
      .filter((task) => task.status === "running" || task.status === "completed" || task.status === "failed" || task.status === "cancelled")
      .map((task) => ({ phaseId: phase.phaseId, task })))
    .slice(0, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.agentsPerRun)
    .map(({ phaseId, task }, index) => snapshotAgent(run, phaseId, task, index));
  return {
    id: workflowRunSnapshotId(run),
    source: "workflow",
    name: boundedText(run.workflowName || run.workflowKey, WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.nameBytes) || "Workflow",
    status: run.status,
    startedAt: run.startedAt,
    agents,
  };
}

/**
 * Returns a bounded projection for the WebUI subagent monitor. Current manager
 * implementations retain terminal runs in memory, so settled calls remain
 * inspectable until the normal manager/session retention boundary.
 */
export function buildWorkflowSubagentsSnapshot(manager: WorkflowRunSource, now = new Date()): WorkflowSubagentsSnapshot {
  const byId = new Map(manager.active().map((run) => [run.runId, run]));
  if (manager.list && manager.get) for (const record of manager.list()) {
    const run = manager.get(record.runId);
    if (run) byId.set(run.runId, run);
  }
  const runs = [...byId.values()]
    .filter((run) => run.phases.some((phase) => phase.tasks.some((task) => ["running", "completed", "failed", "cancelled"].includes(task.status))))
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.runId.localeCompare(right.runId))
    .slice(-WORKFLOW_SUBAGENT_SNAPSHOT_LIMITS.runs)
    .map(snapshotRun);
  return {
    version: WORKFLOW_SUBAGENTS_VERSION,
    updatedAt: now.toISOString(),
    runs,
  };
}

function timestamp(value: string | undefined, fallback: number): number {
  const parsed = Date.parse(value || "");
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function buildWorkflowAgentRunsSnapshot(manager: WorkflowRunSource, now = new Date()) {
  const legacy = buildWorkflowSubagentsSnapshot(manager, now);
  const parentByRun = new Map(manager.list?.().map((record) => [record.runId, record.sessionId]) || []);
  const nowMs = now.getTime();
  return {
    version: 1 as const,
    producerId: "workflow-run",
    complete: true,
    instances: legacy.runs.flatMap((run) => run.agents.map((agent) => {
      const startedAt = timestamp(run.startedAt, nowMs);
      const sourceUpdatedAt = timestamp(run.endedAt || run.startedAt, startedAt);
      const terminal = agent.status !== "running";
      return {
        version: 1 as const,
        instanceId: agent.id,
        runId: run.id,
        parentSessionId: parentByRun.get(run.id.slice("workflow:".length)) || null,
        launcher: "workflow",
        provider: "workflow-run",
        origin: "workflow_run",
        name: agent.name,
        status: agent.status,
        startedAt,
        updatedAt: sourceUpdatedAt,
        endedAt: terminal ? sourceUpdatedAt : null,
        ...(agent.model ? { model: agent.model } : {}),
        ...(agent.activityState ? { activityState: agent.activityState } : {}),
        capabilities: { open: true, refresh: true, cancel: false, steer: false },
        outputRef: { kind: "none" as const },
      };
    })),
    removals: [],
  };
}

export function publishWorkflowSubagentsSnapshot(
  manager: WorkflowRunSource,
  emit: (event: string, snapshot: WorkflowSubagentsSnapshot | ReturnType<typeof buildWorkflowAgentRunsSnapshot>) => void,
): WorkflowSubagentsSnapshot {
  const now = new Date();
  const snapshot = buildWorkflowSubagentsSnapshot(manager, now);
  emit(WORKFLOW_SUBAGENTS_EVENT, snapshot);
  emit(WEBUI_AGENT_RUNS_EVENT, buildWorkflowAgentRunsSnapshot(manager, now));
  return snapshot;
}
