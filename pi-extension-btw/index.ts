import { randomUUID } from "node:crypto";
import { stream, type Message } from "@earendil-works/pi-ai";
import {
  buildSessionContext,
  convertToLlm,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { truncate as truncatePlain } from "@firstpick/pi-utils";

const WEBUI_STATUS_KEY = "btw-webui";
const WEBUI_OUTPUT_WIDGET_KEY = "btw:output";
const WEBUI_FOOTER_WIDGET_KEY = "btw:footer";
const WEBUI_WIDGET_PAYLOAD_PREFIX = "BTW_WEBUI_PAYLOAD ";
const WEBUI_PAYLOAD_TYPE = "firstpick.pi-extension-btw.output";
const WEBUI_PAYLOAD_VERSION = 2;
const SIDE_SYSTEM_PROMPT = `\n\n[/btw SIDE QUESTION MODE]\nAnswer the user's /btw side question using only the session transcript included in the request.\nDo not call tools, ask to inspect files, run commands, or search. You have no tool access in this side request.\nKeep the answer concise unless the question explicitly asks for detail.\nThis question and answer are ephemeral and must not assume they will be remembered in the main conversation.`;
const TRANSFER_SUMMARY_SYSTEM_PROMPT = `\n\n[/btw TRANSFER SUMMARY MODE]\nSummarize a /btw side question and side answer for transfer back into the main agent conversation as steering context.\nReturn only a concise steering summary. Preserve actionable facts, decisions, constraints, caveats, and requested behavior relevant to the main task.\nDo not add new facts, do not call tools, and do not re-answer the original side question.`;
const MAX_TOOL_ARGS_CHARS = 2000;
const WEBUI_UPDATE_INTERVAL_MS = 90;

type BtwStatus = "loading" | "streaming" | "done" | "error" | "aborted";
type BtwOverlayResult = "dismiss" | "abort";
type BtwTransferMode = "full" | "summary";

type BtwTransferPayload = {
  question?: string;
  answer?: string;
  summary?: string;
  status?: BtwStatus;
  model?: string;
  generatedAt?: number;
  updatedAt?: number;
  transferMode?: BtwTransferMode;
};

let activeWebuiBtwId = "";

type WebuiPayload = {
  type: typeof WEBUI_PAYLOAD_TYPE;
  version: typeof WEBUI_PAYLOAD_VERSION;
  id: string;
  question: string;
  answer: string;
  status: BtwStatus;
  error?: string;
  model?: string;
  generatedAt: number;
  updatedAt: number;
  open: boolean;
};

function safeStringify(value: unknown, maxChars = MAX_TOOL_ARGS_CHARS): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (!text) return "{}";
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function textFromContent(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part?.type === "text") return String(part.text || "");
      if (part?.type === "image") return `[image omitted: ${part.mimeType || "image"}]`;
      if (part?.type === "toolCall") return `[tool call: ${part.name || "tool"} ${safeStringify(part.arguments)}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function transcriptLineForMessage(message: Message): string {
  if (message.role === "user") {
    return `User:\n${textFromContent(message.content)}`;
  }
  if (message.role === "assistant") {
    return `Assistant:\n${textFromContent(message.content)}`;
  }
  if (message.role === "toolResult") {
    return `Tool result (${message.toolName || "tool"}):\n${textFromContent(message.content)}`;
  }
  return "";
}

function buildTranscript(ctx: ExtensionCommandContext): string {
  const sessionContext = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
  const messages = convertToLlm(sessionContext.messages).map(transcriptLineForMessage).filter((line) => line.trim());
  return messages.length > 0 ? messages.join("\n\n---\n\n") : "No prior session transcript is available.";
}

function buildSideQuestionMessages(ctx: ExtensionCommandContext, question: string): Message[] {
  const transcript = buildTranscript(ctx);
  return [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Current session transcript:\n\n${transcript}\n\n---\n\n/btw side question:\n${question}`,
        },
      ],
      timestamp: Date.now(),
    },
  ];
}

function buildTransferSummaryMessages(payload: BtwTransferPayload): Message[] {
  const question = String(payload.question || "").trim();
  const answer = String(payload.answer || "").trim();
  return [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "Create a concise steering summary from this /btw side thread.",
            "Return only the summary text; no preamble.",
            "",
            "Side question:",
            question || "(empty)",
            "",
            "Side answer:",
            answer || "(empty)",
            "",
            "Summary requirements:",
            "- Prefer 3-6 short bullets, or one short paragraph if that is clearer.",
            "- Preserve concrete decisions, constraints, caveats, file names, commands, and next actions.",
            "- Omit irrelevant chatter and do not add facts that are not present above.",
          ].join("\n"),
        },
      ],
      timestamp: Date.now(),
    },
  ];
}

function assistantText(message: { content?: any[] } | undefined): string {
  return (message?.content || [])
    .filter((part): part is { type: "text"; text: string } => part?.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function modelLabel(ctx: ExtensionCommandContext): string | undefined {
  return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
}

function decodeTransferPayload(args: string): BtwTransferPayload {
  const encoded = args.trim();
  if (!encoded) throw new Error("Missing transfer payload.");
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid transfer payload: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeTransferMode(value: unknown): BtwTransferMode {
  return value === "summary" ? "summary" : "full";
}

function formatTransferredContext(payload: BtwTransferPayload, summaryText = ""): string {
  const question = String(payload.question || "").trim();
  const answer = String(payload.answer || "").trim();
  const summary = String(summaryText || payload.summary || "").trim();
  const mode = normalizeTransferMode(payload.transferMode);
  const intro = mode === "summary"
    ? "The following /btw side-thread summary was explicitly transferred as steering context. Treat it as user steering for the main task and incorporate it at the next safe point."
    : "The following /btw side-question context was explicitly transferred as steering context. Treat it as user steering for the main task and incorporate it at the next safe point.";
  const lines = [
    mode === "summary" ? "[/btw transferred steering summary]" : "[/btw transferred context]",
    intro,
    payload.model ? `Model: ${payload.model}` : "",
    payload.status ? `Status: ${payload.status}` : "",
    "",
  ];
  if (mode === "summary") {
    lines.push("Steering summary:", summary || "(empty)", "", "Original side question:", question || "(empty)");
  } else {
    lines.push("Side question:", question || "(empty)", "", "Side answer:", answer || "(empty)");
  }
  return lines.filter((line, index, allLines) => line || allLines[index - 1] !== "").join("\n");
}

function webuiStatusLabel(status: BtwStatus): string {
  switch (status) {
    case "done": return "done";
    case "error": return "error";
    case "aborted": return "aborted";
    case "streaming": return "answering";
    default: return "starting";
  }
}

function createWebuiPublisher(ctx: ExtensionCommandContext, id: string, question: string) {
  let answer = "";
  let status: BtwStatus = "loading";
  let error = "";
  let lastEmitAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const generatedAt = Date.now();
  if (ctx.mode === "rpc") activeWebuiBtwId = id;

  const emit = () => {
    if (ctx.mode === "rpc" && activeWebuiBtwId !== id) return;
    lastEmitAt = Date.now();
    const payload: WebuiPayload = {
      type: WEBUI_PAYLOAD_TYPE,
      version: WEBUI_PAYLOAD_VERSION,
      id,
      question,
      answer,
      status,
      ...(error ? { error } : {}),
      ...(modelLabel(ctx) ? { model: modelLabel(ctx) } : {}),
      generatedAt,
      updatedAt: Date.now(),
      open: true,
    };
    const outputText = error || answer || (status === "loading" ? "Starting side request…" : "Waiting for model output…");
    const outputLines = String(outputText || "").replace(/\r\n?/g, "\n").split("\n");
    ctx.ui.setStatus(WEBUI_STATUS_KEY, undefined);
    ctx.ui.setWidget(WEBUI_OUTPUT_WIDGET_KEY, [
      `${WEBUI_WIDGET_PAYLOAD_PREFIX}${JSON.stringify(payload)}`,
      ...outputLines,
    ], { placement: "aboveEditor" });
    ctx.ui.setWidget(WEBUI_FOOTER_WIDGET_KEY, [
      `btw: ${webuiStatusLabel(status)} · ${truncatePlain(question, 90)}${modelLabel(ctx) ? ` · ${modelLabel(ctx)}` : ""}`,
      "Ephemeral side answer · not appended to main transcript · continue chatting while it streams",
    ], { placement: "belowEditor" });
  };

  const schedule = (force = false) => {
    if (ctx.mode !== "rpc") return;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    const elapsed = Date.now() - lastEmitAt;
    if (force || elapsed >= WEBUI_UPDATE_INTERVAL_MS) {
      emit();
      return;
    }
    timer = setTimeout(emit, WEBUI_UPDATE_INTERVAL_MS - elapsed);
    timer.unref?.();
  };

  return {
    update(nextStatus: BtwStatus, nextAnswer: string, nextError = "", force = false) {
      status = nextStatus;
      answer = nextAnswer;
      error = nextError;
      schedule(force);
    },
    dispose() {
      if (timer) clearTimeout(timer);
    },
  };
}

function padded(text: string, width: number): string {
  const truncated = truncateToWidth(text, width, "…", true);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function wrapBlock(text: string, width: number): string[] {
  const source = String(text || "").replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  const wrapped = lines.flatMap((line) => wrapTextWithAnsi(line || " ", Math.max(1, width)));
  return wrapped.length > 0 ? wrapped : [""];
}

class BtwOverlayComponent {
  private scroll = 0;
  private answer = "";
  private status: BtwStatus = "loading";
  private error = "";
  private requestRender: (() => void) | undefined;
  private readonly theme: Theme;
  private readonly question: string;
  private readonly model: string | undefined;
  private readonly done: (result: BtwOverlayResult) => void;

  constructor(theme: Theme, question: string, model: string | undefined, done: (result: BtwOverlayResult) => void) {
    this.theme = theme;
    this.question = question;
    this.model = model;
    this.done = done;
  }

  setRequestRender(requestRender: () => void) {
    this.requestRender = requestRender;
  }

  update(status: BtwStatus, answer: string, error = "") {
    this.status = status;
    this.answer = answer;
    this.error = error;
    this.requestRender?.();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done(this.status === "loading" || this.status === "streaming" ? "abort" : "dismiss");
      return;
    }
    if (matchesKey(data, "return") || matchesKey(data, "space")) {
      this.done(this.status === "loading" || this.status === "streaming" ? "abort" : "dismiss");
      return;
    }
    if (matchesKey(data, "up")) {
      this.scroll = Math.max(0, this.scroll - 1);
      this.requestRender?.();
      return;
    }
    if (matchesKey(data, "down")) {
      this.scroll += 1;
      this.requestRender?.();
      return;
    }
    if (matchesKey(data, "pageup")) {
      this.scroll = Math.max(0, this.scroll - 8);
      this.requestRender?.();
      return;
    }
    if (matchesKey(data, "pagedown")) {
      this.scroll += 8;
      this.requestRender?.();
      return;
    }
    if (matchesKey(data, "home")) {
      this.scroll = 0;
      this.requestRender?.();
      return;
    }
    if (matchesKey(data, "end")) {
      this.scroll = Number.MAX_SAFE_INTEGER;
      this.requestRender?.();
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    const innerWidth = Math.max(12, width - 2);
    const contentWidth = Math.max(8, innerWidth - 2);
    const maxAnswerLines = 18;
    const title = " /btw side question ";
    const titleText = th.fg("accent", title);
    const titleWidth = visibleWidth(title);
    const leftRule = "─".repeat(Math.max(0, Math.floor((innerWidth - titleWidth) / 2)));
    const rightRule = "─".repeat(Math.max(0, innerWidth - titleWidth - leftRule.length));
    const border = (value: string) => th.fg("border", value);
    const row = (value = "") => `${border("│")}${padded(` ${value}`, innerWidth)}${border("│")}`;

    const statusLabel = this.error
      ? th.fg("error", "error")
      : this.status === "done"
        ? th.fg("success", "done")
        : this.status === "aborted"
          ? th.fg("warning", "aborted")
          : th.fg("warning", "thinking…");
    const model = this.model ? th.fg("dim", ` · ${this.model}`) : "";
    const questionLines = wrapBlock(this.question, contentWidth).slice(0, 4);
    const answerText = this.error || this.answer || (this.status === "loading" ? "Starting side request…" : "Waiting for model output…");
    const answerLines = wrapBlock(answerText, contentWidth);
    const maxScroll = Math.max(0, answerLines.length - maxAnswerLines);
    this.scroll = Math.min(Math.max(0, this.scroll), maxScroll);
    const visibleAnswer = answerLines.slice(this.scroll, this.scroll + maxAnswerLines);
    const scrollInfo = answerLines.length > maxAnswerLines
      ? th.fg("dim", ` lines ${this.scroll + 1}-${Math.min(answerLines.length, this.scroll + maxAnswerLines)} of ${answerLines.length}`)
      : "";

    const lines = [`${border("╭" + leftRule)}${titleText}${border(rightRule + "╮")}`];
    lines.push(row(`${statusLabel}${model}${scrollInfo}`));
    lines.push(row(th.fg("dim", "Question")));
    for (const line of questionLines) lines.push(row(th.fg("text", line)));
    lines.push(row(""));
    lines.push(row(th.fg("dim", "Answer")));
    for (const line of visibleAnswer) lines.push(row(line));
    lines.push(row(""));
    lines.push(row(th.fg("dim", "↑↓/Pg scroll · Enter/Esc close (aborts while running)")));
    lines.push(`${border("╰" + "─".repeat(innerWidth) + "╯")}`);
    return lines.map((line) => truncateToWidth(line, width, "", true));
  }

  invalidate(): void {}
}

async function summarizeTransferPayload(ctx: ExtensionCommandContext, payload: BtwTransferPayload): Promise<string> {
  const providedSummary = String(payload.summary || "").trim();
  if (providedSummary) return providedSummary;
  const question = String(payload.question || "").trim();
  const answer = String(payload.answer || "").trim();
  if (!question && !answer) return "";
  if (!ctx.model) throw new Error("No model selected for /btw transfer summary.");
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  if (!auth.ok) throw new Error(auth.error);

  const responseStream = stream(
    ctx.model,
    {
      systemPrompt: `${ctx.getSystemPrompt()}${TRANSFER_SUMMARY_SYSTEM_PROMPT}`,
      messages: buildTransferSummaryMessages(payload),
    },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      maxTokens: 1024,
      cacheRetention: "short",
      sessionId: `btw-transfer:${ctx.sessionManager.getSessionId()}`,
    },
  );

  let summary = "";
  for await (const event of responseStream) {
    if (event.type === "text_delta") {
      summary += event.delta;
    } else if (event.type === "done") {
      summary = assistantText(event.message) || summary;
    } else if (event.type === "error") {
      throw new Error(event.error.errorMessage || "Transfer summary failed.");
    }
  }

  const final = await responseStream.result().catch(() => undefined);
  return (assistantText(final) || summary || answer || question).trim();
}

async function runSideQuestion(
  ctx: ExtensionCommandContext,
  question: string,
  signal: AbortSignal,
  onUpdate: (status: BtwStatus, answer: string, error?: string, force?: boolean) => void,
): Promise<string> {
  if (!ctx.model) throw new Error("No model selected.");
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  if (!auth.ok) throw new Error(auth.error);

  const responseStream = stream(
    ctx.model,
    {
      systemPrompt: `${ctx.getSystemPrompt()}${SIDE_SYSTEM_PROMPT}`,
      messages: buildSideQuestionMessages(ctx, question),
    },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      signal,
      maxTokens: 2048,
      cacheRetention: "short",
      sessionId: `btw:${ctx.sessionManager.getSessionId()}`,
    },
  );

  let answer = "";
  onUpdate("streaming", answer, undefined, true);
  for await (const event of responseStream) {
    if (event.type === "text_delta") {
      answer += event.delta;
      onUpdate("streaming", answer);
    } else if (event.type === "done") {
      answer = assistantText(event.message) || answer;
    } else if (event.type === "error") {
      throw new Error(event.error.errorMessage || (event.reason === "aborted" ? "Side question aborted." : "Side question failed."));
    }
  }

  const final = await responseStream.result().catch(() => undefined);
  answer = assistantText(final) || answer;
  return answer.trim();
}

async function handleBtw(args: string, ctx: ExtensionCommandContext) {
  const question = args.trim();
  if (!question) {
    ctx.ui.notify("Usage: /btw <side question>", "warning");
    return;
  }
  if (!ctx.model) {
    ctx.ui.notify("/btw needs a selected model.", "error");
    return;
  }

  const id = randomUUID();
  const controller = new AbortController();
  const webuiPublisher = createWebuiPublisher(ctx, id, question);
  const publish = (status: BtwStatus, answer: string, error = "", force = false) => {
    webuiPublisher.update(status, answer, error, force);
  };

  if (ctx.mode === "tui") {
    let component: BtwOverlayComponent | undefined;
    let sidePromise: Promise<void> | undefined;
    let overlayOpen = true;
    let finished = false;
    const updateComponent = (status: BtwStatus, answer: string, error = "") => {
      if (overlayOpen) component?.update(status, answer, error);
    };

    const overlayResult = await ctx.ui.custom<BtwOverlayResult>((tui, theme, _keybindings, done) => {
      component = new BtwOverlayComponent(theme, question, modelLabel(ctx), done);
      component.setRequestRender(() => tui.requestRender());
      updateComponent("loading", "");
      publish("loading", "", "", true);

      sidePromise = runSideQuestion(ctx, question, controller.signal, (status, answer, error, force) => {
        updateComponent(status, answer, error || "");
        publish(status, answer, error || "", force);
      })
        .then((answer) => {
          finished = true;
          updateComponent("done", answer || "(no text answer)");
          publish("done", answer || "(no text answer)", "", true);
        })
        .catch((error) => {
          finished = true;
          const aborted = controller.signal.aborted;
          const message = aborted ? "Side question aborted." : error instanceof Error ? error.message : String(error);
          updateComponent(aborted ? "aborted" : "error", "", message);
          publish(aborted ? "aborted" : "error", "", message, true);
        });

      return component;
    }, {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "72%",
        minWidth: 48,
        maxHeight: "82%",
        margin: 1,
      },
    });

    overlayOpen = false;
    if ((overlayResult === "abort" || !finished) && !controller.signal.aborted) controller.abort();
    await sidePromise?.catch(() => undefined);
    webuiPublisher.dispose();
    return;
  }

  if (ctx.mode === "rpc") {
    publish("loading", "", "", true);
    void runSideQuestion(ctx, question, controller.signal, publish)
      .then((answer) => publish("done", answer || "(no text answer)", "", true))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        publish("error", "", message, true);
      })
      .finally(() => webuiPublisher.dispose());
    return;
  }

  publish("loading", "", "", true);
  try {
    const answer = await runSideQuestion(ctx, question, controller.signal, publish);
    publish("done", answer || "(no text answer)", "", true);
    ctx.ui.notify(answer || "(no text answer)", "info");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    publish("error", "", message, true);
    ctx.ui.notify(`/btw failed: ${message}`, "error");
  } finally {
    webuiPublisher.dispose();
  }
}

export default function btwExtension(pi: ExtensionAPI) {
  pi.registerCommand("btw", {
    description: "Ask an ephemeral side question without adding it to the main conversation. Usage: /btw <question>",
    handler: handleBtw,
  });

  pi.registerCommand("btw-transfer", {
    description: "Transfer a /btw side answer, optionally summarized, into the main conversation context.",
    handler: async (args, ctx) => {
      const payload = decodeTransferPayload(args);
      const transferMode = normalizeTransferMode(payload.transferMode);
      const summary = transferMode === "summary" ? await summarizeTransferPayload(ctx, payload) : "";
      const details: BtwTransferPayload = { ...payload, transferMode, ...(summary ? { summary } : {}) };
      const content = formatTransferredContext(details, summary);
      const isIdle = ctx.isIdle();
      pi.sendMessage({
        customType: "btw-transfer",
        content,
        display: true,
        details,
      }, { deliverAs: "steer" });
      ctx.ui.notify(isIdle
        ? (transferMode === "summary" ? "/btw summary transferred as steering context." : "/btw context transferred as steering context.")
        : (transferMode === "summary" ? "/btw summary sent as live steering; it will be injected after the next agent action." : "/btw context sent as live steering; it will be injected after the next agent action."), "info");
    },
  });

  pi.registerCommand("btw-status", {
    description: "Show /btw extension status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`/btw loaded · mode ${ctx.mode} · model ${modelLabel(ctx) || "none"} · transcript ${truncatePlain(ctx.sessionManager.getSessionFile() || ctx.sessionManager.getSessionId())}`, "info");
    },
  });
}
