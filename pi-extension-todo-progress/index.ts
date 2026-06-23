import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { extractChecklist, stripChecklistLines, type ChecklistItem, type ChecklistStatus } from "@firstpick/pi-utils";

type TodoStatus = ChecklistStatus;
type TodoItem = ChecklistItem;
type TodoState = {
  visible: boolean;
  items: TodoItem[];
  offset: number;
  goal?: string;
  awaitingGoalCheck: boolean;
};
type PersistedTodoState = TodoState & { version: 1 };

const KEY = "todo-progress";
const STATE_KEY = "todo-progress-state";
const CONTEXT_KEY = "todo-progress-context";
const MAX_ROWS = 5;
const MAX_ITEMS = 12;

const TODO_POLICY = [
  "",
  "",
  "[TODO PROGRESS POLICY] For multi-step work:",
  "- First formulate a concise one-sentence `Goal: ...` before creating a todo list or starting execution.",
  "- Create concise, agent-authored checklists with 2-6 short items. Keep the goal separate; the todo list does not need to contain the goal.",
  "- Emit markdown checklist lines exactly like `- [ ] item`, `- [-] item`, or `- [x] item` only when starting a list or when item status/text changes; do not re-emit unchanged checklist items before every tool call.",
  "- Do not copy raw user-prompt lines as todos; rewrite them into clear action items.",
  "- Update checklist markers as work changes. Mark the active/current step `[-]` when useful and completed steps `[x]`; emitting only the changed checklist line(s) is enough.",
  "- When every item in the current list is `[x]`, explicitly check whether the goal is reached before doing more work.",
  "- If the goal is reached, stop creating todo lists and produce the final output. If the goal is not reached, create a new short checklist before the next execution step.",
  "- Multiple todo lists may be created during one session; each new list replaces the previous list in the progress widget.",
  "- Todo checklists are session progress: still emit `[x]` updates when possible; after a normal final assistant response the extension clears the widget automatically so stale partial lists do not persist.",
].join("\n");

function statusLabel(status: TodoStatus): string {
  if (status === "done") return "[x]";
  if (status === "partial") return "[-]";
  return "[ ]";
}

function isDoneList(items: TodoItem[]): boolean {
  return items.length > 0 && items.every((item) => item.status === "done");
}

function lastAssistantMessage(messages: any[]): any | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") return message;
  }
  return undefined;
}

function assistantText(message: any): string {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
}

function assistantHasToolCalls(message: any): boolean {
  return Array.isArray(message?.content) && message.content.some((part: any) => part?.type === "toolCall");
}

function shouldAutoClearOnAgentEnd(messages: any[], s: TodoState): boolean {
  if (s.items.length === 0) return false;

  const finalAssistant = lastAssistantMessage(messages);
  if (!finalAssistant) return false;

  // Do not erase active progress for interrupted, failed, truncated, or tool-use
  // terminal states. A normal final assistant text means the run has handed the
  // result back to the user, so stale partial markers should not remain visible.
  if (["aborted", "error", "length", "toolUse"].includes(finalAssistant.stopReason)) return false;
  if (assistantHasToolCalls(finalAssistant)) return false;

  return assistantText(finalAssistant).length > 0 || isDoneList(s.items);
}

function extractChecklistBlocks(text: string): TodoItem[][] {
  const blocks: TodoItem[][] = [];
  let current: TodoItem[] = [];
  let inFence = false;

  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      continue;
    }

    const item = inFence ? undefined : extractChecklist(line)[0];
    if (item) {
      current.push(item);
      continue;
    }

    if (current.length > 0) {
      blocks.push(current);
      current = [];
    }
  }

  if (current.length > 0) blocks.push(current);
  return blocks;
}

function normalizeTodoText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function todoItemKey(item: TodoItem): string {
  return normalizeTodoText(item.text);
}

function sameTodoItems(a: TodoItem[], b: TodoItem[]): boolean {
  return a.length === b.length && a.every((item, index) => item.status === b[index]?.status && item.text === b[index]?.text);
}

function bestChecklistBlock(blocks: TodoItem[][], previousItems: TodoItem[]): TodoItem[] {
  if (blocks.length === 0) return [];
  const previousKeys = new Set(previousItems.map(todoItemKey));
  let best = blocks[0].slice(0, MAX_ITEMS);
  let bestScore = [-1, best.length, 0];

  blocks.forEach((block, index) => {
    const items = block.slice(0, MAX_ITEMS);
    const overlap = items.filter((item) => previousKeys.has(todoItemKey(item))).length;
    const score = previousKeys.size > 0 ? [overlap, items.length, index] : [items.length, items.length, index];
    if (score[0] > bestScore[0] || (score[0] === bestScore[0] && (score[1] > bestScore[1] || (score[1] === bestScore[1] && score[2] > bestScore[2])))) {
      best = items;
      bestScore = score;
    }
  });

  return best;
}

function extractBestChecklist(texts: string[], previousItems: TodoItem[]): TodoItem[] {
  return bestChecklistBlock(texts.flatMap((text) => extractChecklistBlocks(text)), previousItems);
}

function shouldAcceptInitialList(incomingItems: TodoItem[]): boolean {
  // A single non-todo line such as `- [-] Verify build` is usually a status
  // delta emitted without the full list. Do not let it become a new one-item
  // canonical list that later expands unpredictably.
  return incomingItems.length > 1 || incomingItems[0]?.status === "todo";
}

function shouldReplaceList(previousItems: TodoItem[], incomingItems: TodoItem[], overlap: number): boolean {
  if (incomingItems.length === 0) return false;

  // New lists are allowed once the prior list is complete and the model has
  // checked the goal. While work is active, unrelated or low-overlap blocks are
  // treated as stray status output instead of replacing the canonical list.
  if (isDoneList(previousItems)) return shouldAcceptInitialList(incomingItems);
  if (overlap === 0 || incomingItems.length < previousItems.length) return false;

  const previousOverlapRatio = overlap / previousItems.length;
  const incomingOverlapRatio = overlap / incomingItems.length;
  return previousOverlapRatio >= 0.75 && incomingOverlapRatio >= 0.5;
}

function mergeChecklistItems(previousItems: TodoItem[], incomingItems: TodoItem[]): TodoItem[] {
  if (incomingItems.length === 0) return previousItems.slice(0, MAX_ITEMS);
  if (previousItems.length === 0) return shouldAcceptInitialList(incomingItems) ? incomingItems.slice(0, MAX_ITEMS) : [];

  const previousByKey = new Map(previousItems.map((item) => [todoItemKey(item), item]));
  const incomingByKey = new Map(incomingItems.map((item) => [todoItemKey(item), item]));
  const overlap = incomingItems.filter((item) => previousByKey.has(todoItemKey(item))).length;

  if (shouldReplaceList(previousItems, incomingItems, overlap)) return incomingItems.slice(0, MAX_ITEMS);

  // Otherwise only apply status/text changes for existing items. Do not append
  // new unrelated items during active progress; that was the source of one-item
  // status deltas expanding into a different list mid-run.
  return previousItems.map((item) => incomingByKey.get(todoItemKey(item)) ?? item).slice(0, MAX_ITEMS);
}

function cleanGoalText(value: string | undefined): string | undefined {
  const goal = value
    ?.replace(/^\s*(?:`+|\*+|_+)+/, "")
    .replace(/(?:`+|\*+|_+)+\s*$/, "")
    .trim()
    .replace(/\s+/g, " ");
  return goal || undefined;
}

function extractGoal(text: string): string | undefined {
  let inFence = false;

  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^\s*(?:[-*+]\s*)?(?:>\s*)?(?:\*\*|__)?\s*Goal\s*(?:\*\*|__)?\s*[:：—–-]\s*(.+)$/i.exec(line);
    const goal = cleanGoalText(match?.[1]);
    if (goal) return goal;
  }

  return undefined;
}

function fallbackGoalFromPrompt(prompt: string): string | undefined {
  const explicit = extractGoal(prompt);
  if (explicit) return explicit;

  const firstMeaningfulLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("/") && !line.startsWith("[TODO PROGRESS CONTEXT]"));

  return cleanGoalText(firstMeaningfulLine)?.slice(0, 160);
}

function clear(ctx: ExtensionContext, s: TodoState, options: { keepGoal?: boolean } = {}) {
  const hadWidget = s.visible || s.items.length > 0;
  const goal = s.goal;
  s.visible = false;
  s.items = [];
  s.offset = 0;
  s.goal = options.keepGoal ? goal : undefined;
  s.awaitingGoalCheck = false;
  if (ctx.hasUI && hadWidget) ctx.ui.setWidget(KEY, undefined);
}

function hideWidget(ctx: ExtensionContext) {
  if (ctx.hasUI) ctx.ui.setWidget(KEY, undefined);
}

function snapshotState(s: TodoState): PersistedTodoState {
  return {
    version: 1,
    visible: s.visible,
    items: s.items.map((item) => ({ ...item })),
    offset: s.offset,
    goal: s.goal,
    awaitingGoalCheck: s.awaitingGoalCheck,
  };
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return value === "todo" || value === "partial" || value === "done";
}

function restoreSnapshot(data: unknown): TodoState | undefined {
  if (!data || typeof data !== "object") return undefined;
  const snapshot = data as Partial<PersistedTodoState>;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.items)) return undefined;

  const items = snapshot.items.flatMap((item: any) => {
    if (!item || typeof item.text !== "string" || !isTodoStatus(item.status)) return [];
    return [{ text: item.text, status: item.status }];
  });

  return {
    visible: Boolean(snapshot.visible) && items.length > 0,
    items: items.slice(0, MAX_ITEMS),
    offset: Math.max(0, Math.min(Number(snapshot.offset) || 0, Math.max(0, items.length - MAX_ROWS))),
    goal: typeof snapshot.goal === "string" && snapshot.goal.trim() ? snapshot.goal : undefined,
    awaitingGoalCheck: Boolean(snapshot.awaitingGoalCheck),
  };
}

function render(ctx: ExtensionContext, s: TodoState) {
  if (!ctx.hasUI) return;
  if (!s.visible || s.items.length === 0) {
    ctx.ui.setWidget(KEY, undefined);
    return;
  }

  const done = s.items.filter((i) => i.status === "done").length;
  const partial = s.items.filter((i) => i.status === "partial").length;
  const allDone = done === s.items.length;
  const top = s.items.slice(s.offset, s.offset + MAX_ROWS);
  const title = allDone
    ? `Todo ${done}/${s.items.length} done · check goal`
    : `Todo ${done}/${s.items.length} done${partial ? `, ${partial} partial` : ""}`;
  const lines = [ctx.ui.theme.fg("accent", `Goal: ${s.goal ?? "not formulated yet"}`)];
  lines.push(ctx.ui.theme.fg(allDone ? "success" : "accent", title));
  for (const item of top) lines.push(`${statusLabel(item.status)} ${item.text}`);
  if (s.items.length > MAX_ROWS) lines.push(ctx.ui.theme.fg("dim", `Scroll ${s.offset + 1}-${Math.min(s.offset + MAX_ROWS, s.items.length)} of ${s.items.length}`));
  ctx.ui.setWidget(KEY, lines);
}

function buildInjectedContext(s: TodoState): string {
  const lines = ["[TODO PROGRESS CONTEXT]"];
  lines.push(s.goal ? `Goal: ${s.goal}` : "Goal: not formulated yet. Formulate `Goal: ...` before creating the first checklist or starting work.");

  if (s.items.length > 0) {
    lines.push("", "Current todo list injected before the next step:");
    for (const item of s.items) lines.push(`- ${statusLabel(item.status)} ${item.text}`);
  }

  if (s.awaitingGoalCheck || isDoneList(s.items)) {
    lines.push(
      "",
      "The current todo list is complete. Before any additional tool call or execution step, check whether the goal is reached.",
      "If the goal is reached, produce the final output and stop creating todo lists. If not, create a new 2-6 item checklist first.",
    );
  } else if (s.items.length > 0) {
    lines.push(
      "",
      "Before the next execution step or tool call, emit checklist lines only for items whose status/text changed. If the checklist did not change, do not re-emit unchanged checklist lines.",
    );
  }

  return lines.join("\n");
}

export default function todoProgress(pi: ExtensionAPI) {
  const state: TodoState = { visible: false, items: [], offset: 0, awaitingGoalCheck: false };

  function persistState() {
    pi.appendEntry(STATE_KEY, snapshotState(state));
  }

  function restoreState(ctx: ExtensionContext) {
    const entries = ctx.sessionManager.getBranch();
    const saved = entries
      .filter((entry: any) => entry.type === "custom" && entry.customType === STATE_KEY)
      .map((entry: any) => restoreSnapshot(entry.data))
      .filter((snapshot): snapshot is TodoState => Boolean(snapshot))
      .at(-1);

    if (!saved) {
      clear(ctx, state);
      return;
    }

    state.visible = saved.visible;
    state.items = saved.items;
    state.offset = saved.offset;
    state.goal = saved.goal;
    state.awaitingGoalCheck = saved.awaitingGoalCheck;
    render(ctx, state);
  }

  pi.on("before_agent_start", async (event, ctx) => {
    clear(ctx, state);
    state.goal = fallbackGoalFromPrompt(event.prompt);
    persistState();
    return { systemPrompt: event.systemPrompt + TODO_POLICY };
  });

  pi.on("context", async (event) => {
    const messages = event.messages.filter((message: any) => message?.customType !== CONTEXT_KEY);
    if (!state.goal && state.items.length === 0) {
      return messages.length === event.messages.length ? undefined : { messages };
    }

    return {
      messages: [
        ...messages,
        {
          role: "custom",
          customType: CONTEXT_KEY,
          content: buildInjectedContext(state),
          display: false,
          timestamp: Date.now(),
        } as any,
      ],
    };
  });

  pi.on("input", async (event, ctx) => {
    if (!event.text.startsWith("/")) {
      clear(ctx, state);
      persistState();
    }
    return { action: "continue" as const };
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;

    const textParts = event.message.content.filter((c: any) => c.type === "text");
    const texts = textParts.map((c: any) => c.text);
    const previousGoal = state.goal;
    const previousItems = state.items.map((item) => ({ ...item }));
    const goal = texts.map(extractGoal).find(Boolean);
    if (goal) state.goal = goal;

    const checklist = extractBestChecklist(texts, previousItems);
    if (checklist.length === 0) {
      if (state.goal !== previousGoal && state.visible && state.items.length > 0) {
        render(ctx, state);
        persistState();
      }
      return;
    }

    const nextItems = mergeChecklistItems(previousItems, checklist);
    const nextAwaitingGoalCheck = isDoneList(nextItems);
    const nextOffset = Math.min(state.offset, Math.max(0, nextItems.length - MAX_ROWS));
    const changed = state.goal !== previousGoal || !sameTodoItems(state.items, nextItems) || state.awaitingGoalCheck !== nextAwaitingGoalCheck || state.offset !== nextOffset || !state.visible;

    if (changed) {
      state.items = nextItems;
      state.awaitingGoalCheck = nextAwaitingGoalCheck;
      state.offset = nextOffset;
      state.visible = true;
      render(ctx, state);
      persistState();
    }

    return {
      message: {
        ...event.message,
        content: event.message.content.map((c: any) => (c.type === "text" ? { ...c, text: stripChecklistLines(c.text) } : c)),
      },
    };
  });

  pi.on("agent_end", async (event, ctx) => {
    if (shouldAutoClearOnAgentEnd(event.messages, state)) {
      clear(ctx, state);
      persistState();
      return;
    }

    // Keep active progress visible for interrupted/failed/tool-use terminal states.
    render(ctx, state);
    persistState();
  });

  pi.on("session_shutdown", async () => persistState());
  pi.on("session_before_switch", async (_event, ctx) => {
    persistState();
    hideWidget(ctx);
    return undefined;
  });
  pi.on("session_before_fork", async (_event, ctx) => {
    persistState();
    hideWidget(ctx);
    return undefined;
  });
  pi.on("session_tree", async (_event, ctx) => restoreState(ctx));

  pi.registerShortcut("ctrl+alt+x", {
    description: "Dismiss completed todo widget",
    handler: async (ctx) => {
      clear(ctx, state);
      persistState();
      ctx.ui.notify("Todo widget dismissed", "info");
    },
  });

  pi.registerShortcut("ctrl+alt+j", { description: "Todo scroll down", handler: async (ctx) => { state.offset = Math.min(Math.max(0, state.items.length - MAX_ROWS), state.offset + 1); render(ctx, state); persistState(); } });
  pi.registerShortcut("ctrl+alt+k", { description: "Todo scroll up", handler: async (ctx) => { state.offset = Math.max(0, state.offset - 1); render(ctx, state); persistState(); } });

  pi.registerCommand("todo-progress-status", {
    description: "Show todo-progress widget extension status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`todo-progress loaded · visible ${state.visible ? "yes" : "no"} · items ${state.items.length} · goal ${state.goal ? "yes" : "no"}`, "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => restoreState(ctx));
}
