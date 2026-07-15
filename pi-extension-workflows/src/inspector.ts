import { WorkflowValidationError } from "./errors.ts";
import type { WorkflowCallRecordV1, WorkflowRunRecordV1, WorkflowUsageRecordV1 } from "./persistence-schema.ts";
import { workflowCallId, type WorkflowRunManager } from "./run-manager.ts";
import type { WorkflowRunStorage } from "./run-storage.ts";
import type { PhaseRun, TaskRun, WorkflowModeState, WorkflowRun, WorkflowRunStatus, WorkflowUsage } from "./types.ts";

export const WORKFLOW_INSPECTOR_PAYLOAD_TYPE = "firstpick.pi-extension-workflows.inspector";
export const WORKFLOW_INSPECTOR_PAYLOAD_VERSION = 1 as const;
export const WORKFLOW_INSPECTOR_WIDGET_KEY = "workflow:rpc";
export const WORKFLOW_INSPECTOR_PAYLOAD_PREFIX = "WORKFLOW_RPC_PAYLOAD ";

export type WorkflowInspectorAgent = {
  callId: string;
  callIndex: number;
  taskId: string;
  label?: string;
  name: string;
  status: string;
  prompt: string;
  pipelineKey?: string;
  options: Record<string, unknown>;
  recentEvents: Array<Record<string, unknown>>;
  worktree?: Record<string, unknown>;
  result?: unknown;
  usage?: WorkflowUsage;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
};

export type WorkflowInspectorPhase = {
  phaseId: string;
  name: string;
  status: string;
  usage?: WorkflowUsage;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  agents: WorkflowInspectorAgent[];
};

export type WorkflowInspectorRun = {
  runId: string;
  workflowKey: string;
  workflowName: string;
  status: WorkflowRunStatus;
  sourceType: "json" | "javascript";
  sourcePath?: string;
  snapshotPath?: string;
  resumedFromRunId?: string;
  input?: Record<string, unknown>;
  script?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  phases: WorkflowInspectorPhase[];
  usage?: WorkflowUsage;
  result?: unknown;
  summary?: string;
  error?: string;
  controls: { canPause: boolean; canResume: boolean; canAbort: boolean; canRetry: boolean; canSave: boolean };
};

export type WorkflowInspectorPayload = {
  type: typeof WORKFLOW_INSPECTOR_PAYLOAD_TYPE;
  version: typeof WORKFLOW_INSPECTOR_PAYLOAD_VERSION;
  updatedAt: string;
  mode: Pick<WorkflowModeState, "enabled" | "behavior" | "phase">;
  runs: WorkflowInspectorRun[];
};

function controls(status: WorkflowRunStatus, sourceType: "json" | "javascript") {
  const terminal = status === "completed" || status === "failed" || status === "cancelled";
  return {
    canPause: status === "running",
    canResume: status === "paused" || (terminal && sourceType === "javascript"),
    canAbort: !terminal,
    canRetry: terminal && sourceType === "javascript",
    canSave: terminal && sourceType === "javascript",
  };
}

function addUsage(target: WorkflowUsage, usage: WorkflowUsage): void {
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "cost", "turns"] as const) {
    if (usage[key] !== undefined) target[key] = (target[key] ?? 0) + Number(usage[key]);
  }
  if (usage.contextTokens !== undefined) target.contextTokens = Math.max(target.contextTokens ?? 0, usage.contextTokens);
}

function phaseUsage(phase: PhaseRun): WorkflowUsage | undefined {
  const usage: WorkflowUsage = {};
  for (const task of phase.tasks) if (task.usage) addUsage(usage, task.usage);
  return Object.keys(usage).length ? usage : undefined;
}

function liveAgent(phaseId: string, task: TaskRun): WorkflowInspectorAgent {
  return {
    callId: workflowCallId(phaseId, task),
    callIndex: task.callIndex ?? 0,
    taskId: task.taskId,
    ...(task.label ? { label: task.label } : {}),
    name: task.name,
    status: task.status,
    prompt: task.prompt ?? "",
    ...(task.pipelineKey ? { pipelineKey: task.pipelineKey } : {}),
    options: structuredClone(task.options ?? {}),
    recentEvents: structuredClone(task.recentEvents ?? []) as Array<Record<string, unknown>>,
    ...(task.worktree ? { worktree: structuredClone(task.worktree) as unknown as Record<string, unknown> } : {}),
    ...("result" in task ? { result: structuredClone(task.result) } : {}),
    ...(task.usage ? { usage: structuredClone(task.usage) } : {}),
    ...(task.error ? { error: task.error } : {}),
    ...(task.startedAt ? { startedAt: task.startedAt } : {}),
    ...(task.finishedAt ? { finishedAt: task.finishedAt } : {}),
  };
}

function liveRun(run: WorkflowRun, script?: string): WorkflowInspectorRun {
  return {
    runId: run.runId,
    workflowKey: run.workflowKey,
    workflowName: run.workflowName,
    status: run.status,
    sourceType: run.sourceType ?? "json",
    ...(run.sourcePath ? { sourcePath: run.sourcePath } : {}),
    ...(run.snapshotPath ? { snapshotPath: run.snapshotPath } : {}),
    ...(run.resumedFromRunId ? { resumedFromRunId: run.resumedFromRunId } : {}),
    input: structuredClone(run.input),
    ...(script ? { script } : {}),
    startedAt: run.startedAt,
    updatedAt: run.updatedAt ?? run.startedAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    phases: run.phases.map((phase) => ({
      phaseId: phase.phaseId,
      name: phase.name,
      status: phase.status,
      ...(phaseUsage(phase) ? { usage: phaseUsage(phase) } : {}),
      ...(phase.error ? { error: phase.error } : {}),
      ...(phase.startedAt ? { startedAt: phase.startedAt } : {}),
      ...(phase.finishedAt ? { finishedAt: phase.finishedAt } : {}),
      agents: phase.tasks.map((task) => liveAgent(phase.phaseId, task)),
    })),
    ...(run.usage ? { usage: structuredClone(run.usage) } : {}),
    ...("result" in run ? { result: structuredClone(run.result) } : {}),
    ...(run.summary ? { summary: run.summary } : {}),
    ...(run.error ? { error: run.error } : {}),
    controls: controls(run.status, run.sourceType ?? "json"),
  };
}

function usageMap(records: WorkflowUsageRecordV1[]): Map<string, WorkflowUsage> {
  return new Map(records.map((record) => [`${record.scope}:${record.scopeId}`, record.usage]));
}

function historicalPhases(calls: WorkflowCallRecordV1[], usage: Map<string, WorkflowUsage>): WorkflowInspectorPhase[] {
  const phases = new Map<string, WorkflowInspectorPhase>();
  for (const call of calls.sort((a, b) => a.callIndex - b.callIndex)) {
    const phaseId = call.phasePath.join("/") || "root";
    let phase = phases.get(phaseId);
    if (!phase) {
      phase = { phaseId, name: call.phasePath.at(-1) ?? "Workflow", status: "completed", usage: usage.get(`phase:${phaseId}`), agents: [] };
      phases.set(phaseId, phase);
    }
    if (call.status === "failed" || call.status === "cancelled") phase.status = call.status;
    else if (call.status === "running" && phase.status === "completed") phase.status = "running";
    phase.agents.push({
      callId: call.callId,
      callIndex: call.callIndex,
      taskId: call.label ?? `agent-${call.callIndex}`,
      ...(call.label ? { label: call.label } : {}),
      name: call.label ?? `Agent ${call.callIndex}`,
      status: call.status,
      prompt: call.prompt,
      ...(call.pipelineKey ? { pipelineKey: call.pipelineKey } : {}),
      options: structuredClone(call.options),
      recentEvents: structuredClone(call.recentEvents ?? []),
      ...(call.worktree ? { worktree: structuredClone(call.worktree) as unknown as Record<string, unknown> } : {}),
      ...("result" in call ? { result: structuredClone(call.result) } : {}),
      ...(usage.get(`agent:${call.callId}`) ? { usage: usage.get(`agent:${call.callId}`) } : {}),
      ...(call.error ? { error: call.error } : {}),
      ...(call.startedAt ? { startedAt: call.startedAt } : {}),
      ...(call.finishedAt ? { finishedAt: call.finishedAt } : {}),
    });
  }
  return [...phases.values()];
}

async function historicalRun(record: WorkflowRunRecordV1, storage: WorkflowRunStorage): Promise<WorkflowInspectorRun> {
  const [calls, usageRecords, result, script] = await Promise.all([
    storage.readCalls(record.runId), storage.readUsage(record.runId), storage.readResult(record.runId), storage.readScript(record.runId),
  ]);
  const usage = usageMap(usageRecords);
  return {
    runId: record.runId,
    workflowKey: record.workflowName,
    workflowName: record.workflowName,
    status: record.status,
    sourceType: record.sourceType,
    ...(record.snapshotPath ? { snapshotPath: record.snapshotPath } : {}),
    ...(record.resumedFromRunId ? { resumedFromRunId: record.resumedFromRunId } : {}),
    ...(record.input ? { input: structuredClone(record.input) } : {}),
    ...(script ? { script } : {}),
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
    phases: historicalPhases(calls, usage),
    ...(usage.get(`run:${record.runId}`) ? { usage: usage.get(`run:${record.runId}`) } : {}),
    ...(result && "result" in result ? { result: structuredClone(result.result) } : {}),
    ...(result?.summary ? { summary: result.summary } : {}),
    ...(result?.error ? { error: result.error } : {}),
    controls: controls(record.status, record.sourceType),
  };
}

export async function buildWorkflowInspectorPayload(input: {
  manager: WorkflowRunManager;
  storage: WorkflowRunStorage;
  mode: WorkflowModeState;
}): Promise<WorkflowInspectorPayload> {
  const runs: WorkflowInspectorRun[] = [];
  for (const record of input.manager.list()) {
    const live = input.manager.get(record.runId);
    const script = await input.storage.readScript(record.runId);
    runs.push(live ? liveRun(live, script) : await historicalRun(record, input.storage));
  }
  return validateWorkflowInspectorPayload({
    type: WORKFLOW_INSPECTOR_PAYLOAD_TYPE,
    version: WORKFLOW_INSPECTOR_PAYLOAD_VERSION,
    updatedAt: new Date().toISOString(),
    mode: { enabled: input.mode.enabled, behavior: input.mode.behavior, phase: input.mode.phase },
    runs,
  });
}

export function validateWorkflowInspectorPayload(value: unknown): WorkflowInspectorPayload {
  const payload = value as Partial<WorkflowInspectorPayload> | null;
  const issues: string[] = [];
  if (!payload || typeof payload !== "object") issues.push("payload must be an object.");
  else {
    if (payload.type !== WORKFLOW_INSPECTOR_PAYLOAD_TYPE) issues.push("payload type is invalid.");
    if (payload.version !== WORKFLOW_INSPECTOR_PAYLOAD_VERSION) issues.push("payload version is unsupported.");
    if (!Array.isArray(payload.runs)) issues.push("runs must be an array.");
    else for (const run of payload.runs) {
      if (!run || typeof run.runId !== "string" || !Array.isArray(run.phases) || !run.controls) issues.push("run payload is invalid.");
      else for (const phase of run.phases) if (!Array.isArray(phase.agents)) issues.push(`phase '${phase.phaseId}' agents must be an array.`);
    }
    if (!payload.mode || typeof payload.mode.enabled !== "boolean") issues.push("mode payload is invalid.");
    if (typeof payload.updatedAt !== "string" || !Number.isFinite(Date.parse(payload.updatedAt))) issues.push("updatedAt must be an ISO date-time.");
  }
  if (issues.length) throw new WorkflowValidationError(issues);
  return value as WorkflowInspectorPayload;
}

export function workflowInspectorPayloadLine(payload: WorkflowInspectorPayload): string {
  return `${WORKFLOW_INSPECTOR_PAYLOAD_PREFIX}${JSON.stringify(validateWorkflowInspectorPayload(payload))}`;
}
