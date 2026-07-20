import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir, normalizeTimestampMs, resolvePathFromAgentDir } from "@firstpick/pi-utils";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { matchesKey } from "@earendil-works/pi-tui";

type FileSnapshot = {
  absPath: string;
  previousExists: boolean;
  previousContent?: string;
};

type UndoOperation = {
  id: string;
  toolName: "write" | "edit";
  timestamp: number;
  files: FileSnapshot[];
};

type SessionUndoState = {
  stack: UndoOperation[];
};

const EXTENSION_ID = "reverse-last";
const MAX_STACK = 100;

function resolveToolPath(cwd: string, inputPath: string): string {
  return path.isAbsolute(inputPath) ? path.normalize(inputPath) : path.resolve(cwd, inputPath);
}

function getStateDir(): string {
  const configured = process.env.PI_REVERSE_LAST_STATE_DIR?.trim();
  if (configured) return resolvePathFromAgentDir(configured);

  return path.join(getAgentDir(), "state", "reverse-last");
}

function getStatePath(sessionId: string): string {
  return path.join(getStateDir(), `${sessionId}.json`);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function readTextFile(absPath: string): string | undefined {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return undefined;
  }
}

function loadState(sessionId: string): SessionUndoState {
  const statePath = getStatePath(sessionId);
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw) as SessionUndoState;
    if (!parsed || !Array.isArray(parsed.stack)) return { stack: [] };
    return { stack: parsed.stack.filter((x) => x && Array.isArray(x.files)).slice(-MAX_STACK) };
  } catch {
    return { stack: [] };
  }
}

function saveState(sessionId: string, state: SessionUndoState): void {
  const dir = getStateDir();
  ensureDir(dir);
  const statePath = getStatePath(sessionId);
  fs.writeFileSync(statePath, JSON.stringify({ stack: state.stack.slice(-MAX_STACK) }), "utf8");
}

export default function reverseLastExtension(pi: ExtensionAPI) {
  const pending = new Map<string, UndoOperation>();

  let activeSessionId = "";
  let state: SessionUndoState = { stack: [] };

  const reloadForSession = (sessionId: string) => {
    activeSessionId = sessionId;
    pending.clear();
    state = loadState(sessionId);
  };

  pi.on("session_start", async (_event, ctx) => {
    reloadForSession(ctx.sessionManager.getSessionId());
  });

  pi.on("session_shutdown", async () => {
    if (!activeSessionId) return;
    saveState(activeSessionId, state);
  });

  pi.on("tool_call", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (!activeSessionId) reloadForSession(sessionId);
    if (sessionId !== activeSessionId) reloadForSession(sessionId);

    if (isToolCallEventType("write", event)) {
      const absPath = resolveToolPath(ctx.cwd, event.input.path);
      const before = readTextFile(absPath);
      pending.set(event.toolCallId, {
        id: event.toolCallId,
        toolName: "write",
        timestamp: Date.now(),
        files: [
          {
            absPath,
            previousExists: before !== undefined,
            previousContent: before,
          },
        ],
      });
      return;
    }

    if (isToolCallEventType("edit", event)) {
      const absPath = resolveToolPath(ctx.cwd, event.input.path);
      const before = readTextFile(absPath);
      pending.set(event.toolCallId, {
        id: event.toolCallId,
        toolName: "edit",
        timestamp: Date.now(),
        files: [
          {
            absPath,
            previousExists: before !== undefined,
            previousContent: before,
          },
        ],
      });
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    const op = pending.get(event.toolCallId);
    if (!op) return;

    pending.delete(event.toolCallId);
    if (event.isError) return;

    const changedFiles = op.files.filter((f) => {
      const after = readTextFile(f.absPath);
      if (!f.previousExists) return after !== undefined;
      return after !== f.previousContent;
    });

    if (changedFiles.length === 0) return;

    state.stack.push({
      ...op,
      files: changedFiles,
      timestamp: Date.now(),
    });
    state.stack = state.stack.slice(-MAX_STACK);

    const sessionId = ctx.sessionManager.getSessionId();
    if (sessionId !== activeSessionId) {
      reloadForSession(sessionId);
    }
    if (activeSessionId) saveState(activeSessionId, state);

    pi.appendEntry(EXTENSION_ID, {
      type: "capture",
      at: Date.now(),
      toolName: op.toolName,
      count: changedFiles.length,
      files: changedFiles.map((f) => path.relative(ctx.cwd, f.absPath) || f.absPath),
    });
  });

  const restoreOperationFiles = (cwd: string, op: UndoOperation, restored: string[]) => {
    for (const file of op.files) {
      if (file.previousExists) {
        ensureDir(path.dirname(file.absPath));
        fs.writeFileSync(file.absPath, file.previousContent ?? "", "utf8");
        restored.push(path.relative(cwd, file.absPath) || file.absPath);
      } else {
        if (fs.existsSync(file.absPath)) {
          fs.unlinkSync(file.absPath);
        }
        restored.push(`${path.relative(cwd, file.absPath) || file.absPath} (deleted)`);
      }
    }

    pi.appendEntry(EXTENSION_ID, {
      type: "undo",
      at: Date.now(),
      toolName: op.toolName,
      count: op.files.length,
      files: op.files.map((f) => path.relative(cwd, f.absPath) || f.absPath),
    });
  };

  const ensureCurrentSessionState = (ctx: { sessionManager: { getSessionId(): string } }) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (!activeSessionId || sessionId !== activeSessionId) {
      reloadForSession(sessionId);
    }
  };

  const undoChanges = (ctx: { cwd: string; sessionManager: { getSessionId(): string } }, count: number) => {
    ensureCurrentSessionState(ctx);

    if (state.stack.length === 0) {
      return { steps: 0, restored: [] as string[] };
    }

    const steps = Math.min(count, state.stack.length);
    const restored: string[] = [];

    for (let i = 0; i < steps; i++) {
      const op = state.stack.pop();
      if (!op) break;
      restoreOperationFiles(ctx.cwd, op, restored);
    }

    if (activeSessionId) saveState(activeSessionId, state);
    return { steps, restored };
  };

  const lastUserMessageTimestamp = (ctx: { sessionManager: { getEntries(): any[] } }): number | null => {
    const entries = ctx.sessionManager.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry?.type !== "message") continue;
      if (entry?.message?.role !== "user") continue;

      const ts = entry?.message?.timestamp;
      if (typeof ts === "number" && Number.isFinite(ts)) return normalizeTimestampMs(ts);

      const parsed = Date.parse(String(entry?.timestamp ?? ""));
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };

  const getSelectionCandidates = (ctx: { sessionManager: { getEntries(): any[]; getSessionId(): string } }) => {
    ensureCurrentSessionState(ctx);
    if (state.stack.length === 0) return [] as UndoOperation[];

    const lastUserTs = lastUserMessageTimestamp(ctx);
    if (lastUserTs === null) return [...state.stack].reverse();

    const filtered = state.stack.filter((op) => op.timestamp >= lastUserTs);
    if (filtered.length === 0) return [...state.stack].reverse();
    return filtered.reverse();
  };

  const undoSelectedChanges = (
    ctx: { cwd: string; sessionManager: { getSessionId(): string } },
    selectedIds: Set<string>,
  ) => {
    ensureCurrentSessionState(ctx);
    if (state.stack.length === 0 || selectedIds.size === 0) {
      return { steps: 0, restored: [] as string[] };
    }

    const indexed = state.stack
      .map((op, idx) => ({ op, idx }))
      .filter(({ op }) => selectedIds.has(op.id))
      .sort((a, b) => b.idx - a.idx);

    if (indexed.length === 0) return { steps: 0, restored: [] as string[] };

    const restored: string[] = [];
    for (const { idx } of indexed) {
      const op = state.stack[idx];
      if (!op) continue;
      state.stack.splice(idx, 1);
      restoreOperationFiles(ctx.cwd, op, restored);
    }

    if (activeSessionId) saveState(activeSessionId, state);
    return { steps: indexed.length, restored };
  };

  const formatCandidateLabel = (cwd: string, op: UndoOperation) => {
    const stamp = new Date(op.timestamp).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const sample = op.files
      .slice(0, 2)
      .map((f) => path.relative(cwd, f.absPath) || f.absPath)
      .join(", ");
    const suffix = op.files.length > 2 ? ` +${op.files.length - 2} more` : "";
    return `${stamp} ${op.toolName} (${op.files.length} file${op.files.length === 1 ? "" : "s"}) ${sample}${suffix}`;
  };

  const selectOperationsFromUI = async (
    ctx: {
      cwd: string;
      hasUI: boolean;
      ui: {
        setWidget: (key: string, content: string[] | undefined) => void;
        onTerminalInput?: (handler: (data: string) => { consume?: boolean } | void) => () => void;
      };
    },
    operations: UndoOperation[],
  ): Promise<Set<string> | undefined> => {
    if (!ctx.hasUI || !ctx.ui.onTerminalInput) return undefined;

    const widgetKey = "reverse-last-picker";
    const selected = operations.map(() => false);
    let cursor = 0;

    return await new Promise((resolve) => {
      const render = () => {
        const lines = [
          "Select changes to reverse (since last user message).",
          "Space toggle • a select all/none • Enter apply • Esc cancel",
          "",
          ...operations.map((op, i) => `${i === cursor ? ">" : " "} ${selected[i] ? "[x]" : "[ ]"} ${formatCandidateLabel(ctx.cwd, op)}`),
        ];
        ctx.ui.setWidget(widgetKey, lines);
      };

      const finish = (value: Set<string> | undefined) => {
        unsubscribe();
        ctx.ui.setWidget(widgetKey, undefined);
        resolve(value);
      };

      render();

      const unsubscribe = ctx.ui.onTerminalInput?.((data) => {
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
          finish(undefined);
          return { consume: true };
        }
        if (matchesKey(data, "enter") || matchesKey(data, "return")) {
          const ids = new Set<string>();
          for (let i = 0; i < operations.length; i++) {
            if (selected[i]) ids.add(operations[i].id);
          }
          finish(ids);
          return { consume: true };
        }
        if (data === " ") {
          selected[cursor] = !selected[cursor];
          render();
          return { consume: true };
        }
        if (data === "a" || data === "A") {
          const allSelected = selected.every(Boolean);
          for (let i = 0; i < selected.length; i++) selected[i] = !allSelected;
          render();
          return { consume: true };
        }
        if (matchesKey(data, "up") || data === "k") {
          cursor = cursor > 0 ? cursor - 1 : operations.length - 1;
          render();
          return { consume: true };
        }
        if (matchesKey(data, "down") || data === "j") {
          cursor = cursor < operations.length - 1 ? cursor + 1 : 0;
          render();
          return { consume: true };
        }
        return undefined;
      }) ?? (() => {});
    });
  };

  pi.registerCommand("reverse-last", {
    description: "Undo last Pi file changes. Usage: /reverse-last [count]",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      if (pending.size > 0) {
        ctx.ui.notify("reverse-last is temporarily unavailable while file changes are still being captured", "warning");
        return;
      }

      const trimmed = args.trim();

      if (!trimmed && ctx.hasUI && ctx.ui.onTerminalInput) {
        const candidates = getSelectionCandidates(ctx);
        if (candidates.length === 0) {
          ctx.ui.notify("Nothing to undo in this session yet.", "info");
          return;
        }

        const selectedIds = await selectOperationsFromUI(ctx as any, candidates);
        if (selectedIds === undefined) {
          ctx.ui.notify("Reverse-last cancelled.", "info");
          return;
        }
        if (selectedIds.size === 0) {
          ctx.ui.notify("No changes selected.", "warning");
          return;
        }

        const { steps, restored } = undoSelectedChanges(ctx, selectedIds);
        if (steps === 0) {
          ctx.ui.notify("Nothing to undo in this session yet.", "info");
          return;
        }

        ctx.ui.notify(
          `Reverted ${steps} selected change${steps === 1 ? "" : "s"}.\n${restored.slice(0, 12).join("\n")}${restored.length > 12 ? `\n...and ${restored.length - 12} more` : ""}`,
          "info",
        );
        return;
      }

      const count = trimmed ? Number.parseInt(trimmed, 10) : 1;
      if (!Number.isFinite(count) || count <= 0) {
        ctx.ui.notify("Usage: /reverse-last [count]  (count must be a positive integer)", "warning");
        return;
      }

      const { steps, restored } = undoChanges(ctx, count);
      if (steps === 0) {
        ctx.ui.notify("Nothing to undo in this session yet.", "info");
        return;
      }

      ctx.ui.notify(
        `Reverted ${steps} change${steps === 1 ? "" : "s"}.\n${restored.slice(0, 12).join("\n")}${restored.length > 12 ? `\n...and ${restored.length - 12} more` : ""}`,
        "info",
      );
    },
  });

  pi.registerTool({
    name: "reverse_last",
    label: "Reverse Last",
    description: "Undo the most recent write/edit file changes captured in this session",
    parameters: Type.Object({
      count: Type.Optional(Type.Number({ minimum: 1, maximum: 20, description: "How many captured change steps to undo" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (pending.size > 0) {
        throw new Error("reverse_last is temporarily unavailable while file changes are still being captured");
      }

      const count = typeof params.count === "number" ? Math.max(1, Math.min(20, Math.trunc(params.count))) : 1;
      const { steps, restored } = undoChanges(ctx, count);

      if (steps === 0) {
        return {
          content: [{ type: "text", text: "Nothing to undo in this session yet." }],
          details: { steps: 0, restored: [] },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Reverted ${steps} change${steps === 1 ? "" : "s"}.\n${restored.slice(0, 20).join("\n")}${restored.length > 20 ? `\n...and ${restored.length - 20} more` : ""}`,
          },
        ],
        details: { steps, restored },
      };
    },
  });
}
