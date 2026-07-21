import type { WorkflowRun, WorkflowSubprocessEvent } from "./types.ts";
import { formatDuration } from "./utils.ts";

const STATUS_KEY = "workflow";
const WIDGET_KEY = "workflow";
const SUBPROCESS_WIDGET_KEY = "workflow:subprocess";
const SUBPROCESS_PAYLOAD_TYPE = "firstpick.pi-extension-workflows.subprocess";
const SUBPROCESS_PAYLOAD_VERSION = 1;
const SUBPROCESS_PAYLOAD_PREFIX = "WORKFLOW_WEBUI_PAYLOAD ";
const MAX_SUBPROCESS_LINES = 260;
const MAX_SUBPROCESS_LINE_CHARS = 1800;

export { SUBPROCESS_PAYLOAD_PREFIX as WORKFLOW_WEBUI_PAYLOAD_PREFIX };

type ThemeLike = {
  fg?: (color: string, text: string) => string;
};

type UILike = {
  setStatus?: (key: string, value: string) => void;
  setWidget?: (key: string, value: string[] | undefined, options?: unknown) => void;
  notify?: (message: string, level?: "info" | "warning" | "error" | "success") => void;
  select?: (title: string, options: string[]) => Promise<string | undefined>;
  confirm?: (title: string, message: string) => Promise<boolean>;
  editor?: (title: string, prefill?: string) => Promise<string | undefined>;
  theme?: ThemeLike;
};

export type WorkflowUIContext = {
  hasUI?: boolean;
  mode?: "tui" | "rpc" | "json" | "print";
  ui?: UILike;
};

type WorkflowSubprocessTaskSnapshot = {
  taskId: string;
  name: string;
  phaseId: string;
  phaseName: string;
  status: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
};

type WorkflowSubprocessPayload = {
  type: typeof SUBPROCESS_PAYLOAD_TYPE;
  version: typeof SUBPROCESS_PAYLOAD_VERSION;
  runId: string;
  workflowKey: string;
  workflowName: string;
  sourcePath?: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
  activePhase: string;
  taskCounts: ReturnType<typeof countTasks>;
  tasks: WorkflowSubprocessTaskSnapshot[];
  lines: string[];
  truncated: boolean;
};

const subprocessPayloads = new Map<string, WorkflowSubprocessPayload>();

function color(ctx: WorkflowUIContext, name: string, text: string): string {
  return ctx.ui?.theme?.fg?.(name, text) ?? text;
}

function countTasks(run: WorkflowRun): { total: number; queued: number; running: number; completed: number; failed: number; cancelled: number } {
  const counts = { total: 0, queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const phase of run.phases) {
    for (const task of phase.tasks) {
      counts.total++;
      counts[task.status]++;
    }
  }
  return counts;
}

function activePhaseLine(run: WorkflowRun): string {
  const currentIndex = run.phases.findIndex((phase) => phase.status === "running");
  if (currentIndex >= 0) {
    return `Phase ${currentIndex + 1}/${run.phases.length}: ${run.phases[currentIndex].name}`;
  }
  const failedIndex = run.phases.findIndex((phase) => phase.status === "failed" || phase.status === "cancelled");
  if (failedIndex >= 0) return `Phase ${failedIndex + 1}/${run.phases.length}: ${run.phases[failedIndex].name}`;
  return `Phases: ${run.phases.filter((phase) => phase.status === "completed").length}/${run.phases.length}`;
}

function taskSnapshots(run: WorkflowRun): WorkflowSubprocessTaskSnapshot[] {
  const tasks: WorkflowSubprocessTaskSnapshot[] = [];
  for (const phase of run.phases) {
    for (const task of phase.tasks) {
      tasks.push({
        taskId: task.taskId,
        name: task.name,
        phaseId: phase.phaseId,
        phaseName: phase.name,
        status: task.status,
        error: task.error,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
      });
    }
  }
  return tasks;
}

function syncPayloadFromRun(payload: WorkflowSubprocessPayload, run: WorkflowRun, updatedAt = new Date().toISOString()): void {
  payload.workflowKey = run.workflowKey;
  payload.workflowName = run.workflowName;
  payload.sourcePath = run.sourcePath;
  payload.status = run.status;
  payload.startedAt = run.startedAt;
  payload.finishedAt = run.finishedAt;
  payload.updatedAt = updatedAt;
  payload.activePhase = activePhaseLine(run);
  payload.taskCounts = countTasks(run);
  payload.tasks = taskSnapshots(run);
}

function payloadForRun(run: WorkflowRun, updatedAt = new Date().toISOString()): WorkflowSubprocessPayload {
  let payload = subprocessPayloads.get(run.runId);
  if (!payload) {
    payload = {
      type: SUBPROCESS_PAYLOAD_TYPE,
      version: SUBPROCESS_PAYLOAD_VERSION,
      runId: run.runId,
      workflowKey: run.workflowKey,
      workflowName: run.workflowName,
      sourcePath: run.sourcePath,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      updatedAt,
      activePhase: activePhaseLine(run),
      taskCounts: countTasks(run),
      tasks: taskSnapshots(run),
      lines: [],
      truncated: false,
    };
    subprocessPayloads.set(run.runId, payload);
  } else {
    syncPayloadFromRun(payload, run, updatedAt);
  }
  return payload;
}

function payloadLine(payload: WorkflowSubprocessPayload): string {
  return `${SUBPROCESS_PAYLOAD_PREFIX}${JSON.stringify(payload)}`;
}

function publishSubprocessPayload(ctx: WorkflowUIContext, payload: WorkflowSubprocessPayload): void {
  if (ctx.hasUI === false || !ctx.ui || (ctx.mode !== undefined && ctx.mode !== "rpc")) return;
  ctx.ui.setWidget?.(SUBPROCESS_WIDGET_KEY, [payloadLine(payload)]);
}

function clockTime(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return "--:--:--";
  return new Date(parsed).toISOString().slice(11, 19);
}

function shortenLine(line: string): string {
  const text = String(line ?? "").replace(/\r/g, "");
  if (text.length <= MAX_SUBPROCESS_LINE_CHARS) return text;
  return `${text.slice(0, MAX_SUBPROCESS_LINE_CHARS - 1)}…`;
}

function appendSubprocessLine(payload: WorkflowSubprocessPayload, line: string): void {
  payload.lines.push(shortenLine(line));
  while (payload.lines.length > MAX_SUBPROCESS_LINES) {
    payload.lines.shift();
    payload.truncated = true;
  }
}

function formatSubprocessLine(event: WorkflowSubprocessEvent): string {
  const prefix = `[${clockTime(event.timestamp)}] [${event.taskName || event.taskId}]`;
  if (event.type === "start") return `${prefix} $ ${event.command || event.line || "pi subprocess"}`;
  if (event.type === "stderr") return `${prefix} STDERR ${event.line || ""}`.trimEnd();
  if (event.type === "exit") {
    const detail = event.line || (event.exitCode === 0 ? "subprocess completed" : `subprocess exited with code ${event.exitCode ?? "unknown"}`);
    return `${prefix} ${detail}`;
  }
  return `${prefix} ${event.line || event.eventType || event.type}`.trimEnd();
}

export function renderWorkflowRun(ctx: WorkflowUIContext, run: WorkflowRun | undefined): void {
  if (ctx.hasUI === false || !ctx.ui) return;

  if (!run) {
    ctx.ui.setStatus?.(STATUS_KEY, "");
    ctx.ui.setWidget?.(WIDGET_KEY, undefined);
    return;
  }

  const statusText = run.status === "running" || run.status === "queued"
    ? color(ctx, "accent", "Workflow")
    : run.status === "failed"
      ? color(ctx, "error", "Workflow")
      : run.status === "cancelled"
        ? color(ctx, "warning", "Workflow")
        : "";
  ctx.ui.setStatus?.(STATUS_KEY, statusText);

  const tasks = countTasks(run);
  const lines = [
    `Workflow: ${run.workflowKey}`,
    `Status: ${run.status}`,
    activePhaseLine(run),
    `Tasks: ${tasks.completed}/${tasks.total} done, ${tasks.running} running, ${tasks.failed} failed, ${tasks.cancelled} cancelled`,
  ];

  if (run.finishedAt) lines.push(`Duration: ${formatDuration(run.startedAt, run.finishedAt)}`);
  for (const warning of run.warnings ?? []) lines.push(`Warning: ${warning}`);
  if (run.error) lines.push(`Error: ${run.error}`);
  ctx.ui.setWidget?.(WIDGET_KEY, lines);
}

export function renderWorkflowSubprocessEvent(ctx: WorkflowUIContext, run: WorkflowRun, event: WorkflowSubprocessEvent): void {
  if (ctx.hasUI === false || !ctx.ui) return;
  const payload = payloadForRun(run, event.timestamp);
  appendSubprocessLine(payload, formatSubprocessLine(event));
  syncPayloadFromRun(payload, run, event.timestamp);
  publishSubprocessPayload(ctx, payload);
}

export function renderWorkflowSubprocessWidget(ctx: WorkflowUIContext, run: WorkflowRun): void {
  if (ctx.hasUI === false || !ctx.ui) return;
  const payload = subprocessPayloads.get(run.runId);
  if (!payload) return;
  syncPayloadFromRun(payload, run);
  publishSubprocessPayload(ctx, payload);
}

export function notifyWorkflow(ctx: WorkflowUIContext, message: string, level: "info" | "warning" | "error" | "success" = "info"): void {
  if (ctx.hasUI === false || !ctx.ui) return;
  ctx.ui.notify?.(message, level);
}

export function clearWorkflowUI(ctx: WorkflowUIContext): void {
  if (ctx.hasUI === false || !ctx.ui) return;
  subprocessPayloads.clear();
  ctx.ui.setStatus?.(STATUS_KEY, "");
  ctx.ui.setWidget?.(WIDGET_KEY, undefined);
  ctx.ui.setWidget?.(SUBPROCESS_WIDGET_KEY, undefined);
}
