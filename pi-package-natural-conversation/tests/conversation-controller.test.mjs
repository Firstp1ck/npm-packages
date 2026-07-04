import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CONVERSATION_STYLES, createConversationController, DEFAULT_ALLOWED_TOOLS } from "../lib/conversation-controller.mjs";

class MockPi {
  constructor() {
    this.activeTools = ["read", "bash", "write", "edit", "grep", "find", "ls"];
    this.thinkingLevel = "high";
    this.allTools = ["read", "bash", "write", "edit", "grep", "find", "ls"].map((name) => ({ name }));
  }

  getActiveTools() {
    return [...this.activeTools];
  }

  setActiveTools(names) {
    this.activeTools = [...names];
  }

  getAllTools() {
    return [...this.allTools];
  }

  getThinkingLevel() {
    return this.thinkingLevel;
  }

  setThinkingLevel(level) {
    this.thinkingLevel = level;
  }
}

function mockCtx() {
  const statuses = new Map();
  const notifications = [];
  return {
    hasUI: true,
    statuses,
    notifications,
    ui: {
      theme: { fg: (_name, value) => value },
      setStatus(key, value) {
        statuses.set(key, value);
      },
      notify(message, level) {
        notifications.push({ message, level });
      },
    },
  };
}

test("default allowlist is read-only and nondestructive", () => {
  assert.deepEqual([...DEFAULT_ALLOWED_TOOLS], ["read", "grep", "find", "ls"]);
});

test("enable stores previous settings and applies conversation constraints", () => {
  const pi = new MockPi();
  const ctx = mockCtx();
  const controller = createConversationController(pi);

  const result = controller.enable(ctx);

  assert.equal(result.changed, true);
  assert.equal(pi.thinkingLevel, "off");
  assert.deepEqual(pi.activeTools, ["read", "grep", "find", "ls"]);
  assert.equal(controller.getState().previousThinkingLevel, "high");
  assert.deepEqual(controller.getState().previousActiveTools, ["read", "bash", "write", "edit", "grep", "find", "ls"]);
  assert.equal(ctx.statuses.get("natural-conversation"), "Voice: listening");
});

test("disable restores previous thinking level and active tools", () => {
  const pi = new MockPi();
  const ctx = mockCtx();
  const controller = createConversationController(pi);

  controller.enable(ctx);
  const result = controller.disable(ctx);

  assert.equal(result.changed, true);
  assert.equal(pi.thinkingLevel, "high");
  assert.deepEqual(pi.activeTools, ["read", "bash", "write", "edit", "grep", "find", "ls"]);
  assert.equal(controller.isEnabled(), false);
  assert.equal(ctx.statuses.get("natural-conversation"), undefined);
});

test("tool-call guard blocks non-allowlisted tools while enabled", () => {
  const pi = new MockPi();
  const controller = createConversationController(pi);

  assert.equal(controller.handleToolCall({ toolName: "bash" }), undefined);
  controller.enable(mockCtx());

  assert.equal(controller.handleToolCall({ toolName: "read" }), undefined);
  const blocked = controller.handleToolCall({ toolName: "bash" });
  assert.equal(blocked?.block, true);
  assert.match(blocked?.reason ?? "", /read-only/);
});

test("prompt guidance is appended only while enabled", () => {
  const pi = new MockPi();
  const controller = createConversationController(pi);

  assert.equal(controller.buildSystemPrompt("base"), "base");
  controller.enable(mockCtx());
  assert.match(controller.buildSystemPrompt("base"), /NATURAL CONVERSATION MODE ACTIVE/);
  assert.match(controller.buildSystemPrompt("base"), /read-only/);
  // Written-report rules from other prompts (confidence lines etc.) must be
  // explicitly suspended, or TTS reads them aloud.
  assert.match(controller.buildSystemPrompt("base"), /SUSPENDED/);
  assert.match(controller.buildSystemPrompt("base"), /Confidence: 80%/);
});

test("style presets shape the spoken prompt and can be switched live", () => {
  const pi = new MockPi();
  const controller = createConversationController(pi);

  // Default "natural" adds the base guidance but no extra style block.
  controller.enable(mockCtx());
  assert.equal(controller.getStyle(), "natural");
  assert.doesNotMatch(controller.buildSystemPrompt("base"), /\nStyle:/);

  // Presets append exactly one style instruction after the base prompt.
  controller.setStyle("concise");
  const concise = controller.buildSystemPrompt("base");
  assert.match(concise, /NATURAL CONVERSATION MODE ACTIVE/);
  assert.match(concise, /Style: be brief/);
  controller.setStyle("quiet");
  assert.match(controller.buildSystemPrompt("base"), /Style: minimal/);

  // Unknown presets are rejected without changing state.
  assert.equal(controller.setStyle("shakespearean"), undefined);
  assert.equal(controller.getStyle(), "quiet");

  // enable() overrides accept a preset; invalid overrides keep the current one.
  controller.disable(mockCtx());
  controller.enable(mockCtx(), { stylePreset: "casual" });
  assert.equal(controller.getStyle(), "casual");
  assert.match(controller.buildSystemPrompt("base"), /Style: relaxed/);

  // Every catalog entry must produce a valid prompt (empty allowed).
  for (const [id, style] of Object.entries(CONVERSATION_STYLES)) {
    assert.equal(typeof style.label, "string", id);
    assert.equal(typeof style.prompt, "string", id);
  }
});

test("extra read-only tools can be allowed live and are enforced by the guard", () => {
  const pi = new MockPi();
  pi.allTools.push({ name: "brave_search" });
  const ctx = mockCtx();
  const controller = createConversationController(pi);

  controller.enable(ctx, { allowedTools: [...DEFAULT_ALLOWED_TOOLS, "brave_search"] });
  assert.equal(controller.handleToolCall({ toolName: "brave_search" }), undefined, "allowed extra tool passes the guard");
  assert.ok(pi.activeTools.includes("brave_search"));
  assert.equal(controller.handleToolCall({ toolName: "bash" })?.block, true, "everything else stays blocked");

  // Live update (e.g. /talk tools deny) re-applies constraints immediately.
  controller.setAllowedTools([...DEFAULT_ALLOWED_TOOLS]);
  assert.equal(controller.handleToolCall({ toolName: "brave_search" })?.block, true);
  assert.ok(!pi.activeTools.includes("brave_search"));

  // Empty list falls back to the read-only defaults, never to nothing.
  controller.setAllowedTools([]);
  assert.deepEqual(controller.getState().allowedTools, [...DEFAULT_ALLOWED_TOOLS]);
});

test("user bash is blocked while enabled", () => {
  const pi = new MockPi();
  const controller = createConversationController(pi);

  assert.equal(controller.handleUserBash(), undefined);
  controller.enable(mockCtx());
  const blocked = controller.handleUserBash();
  assert.equal(blocked?.result.exitCode, 126);
  assert.match(blocked?.result.output ?? "", /blocks/);
});

test("silence events arm only on questions and fire exactly once", () => {
  const pi = new MockPi();
  const controller = createConversationController(pi);
  controller.enable(mockCtx(), { silenceTimeoutMs: 8000 });

  // A statement never arms the timer.
  assert.equal(controller.handleConversationSilence({ phase: "arm", assistantText: "All done." }).action, "ignored");
  assert.equal(controller.handleConversationSilence({ phase: "fire" }).action, "ignored");

  // A question arms it; firing produces the exact WebUI-parity wording once.
  const armed = controller.handleConversationSilence({ phase: "arm", assistantText: "Should I continue?" });
  assert.equal(armed.action, "armed");
  assert.equal(armed.timeoutMs, 8000);
  const fired = controller.handleConversationSilence({ phase: "fire" });
  assert.equal(fired.action, "send-silence-event");
  assert.equal(
    fired.message,
    "[Conversation mode: the user stayed silent for 8s after your question. Treat the silence as possible confusion, discomfort, missing context, or an unneeded question; reframe, explain why you asked, or continue without pressuring the user. Do not invent intent from the silence.]",
  );
  assert.equal(controller.getState().uiState, "silence");
  assert.equal(controller.handleConversationSilence({ phase: "fire" }).action, "ignored", "one event per question");
});

test("silence events can be cancelled and respect disabled mode", () => {
  const pi = new MockPi();
  const controller = createConversationController(pi);

  // Disabled mode never arms.
  assert.equal(controller.handleConversationSilence({ phase: "arm", assistantText: "Ready?" }).action, "ignored");

  controller.enable(mockCtx());
  controller.handleConversationSilence({ phase: "arm", assistantText: "Ready?" });
  assert.equal(controller.handleConversationSilence({ phase: "cancel" }).action, "cancelled");
  assert.equal(controller.handleConversationSilence({ phase: "fire" }).action, "ignored");

  // silenceEnabled=false blocks arming entirely.
  controller.disable(mockCtx());
  controller.enable(mockCtx(), { silenceEnabled: false });
  assert.equal(controller.handleConversationSilence({ phase: "arm", assistantText: "Ready?" }).action, "ignored");
});

test("extension package manifest and native commands are wired", async () => {
  const [pkgRaw, source] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../extensions/natural-conversation.ts", import.meta.url), "utf8"),
  ]);
  const pkg = JSON.parse(pkgRaw);

  assert.deepEqual(pkg.pi.extensions, ["./extensions/natural-conversation.ts"]);
  assert.match(source, /COMMAND_NAMES = \["talk", "voice", "conversation"\]/);
  assert.match(source, /@firstpick\/pi-package-natural-conversation\/controller/);
  assert.match(source, /@firstpick\/pi-package-natural-conversation\/native-audio-loop/);
  assert.match(source, /@firstpick\/pi-package-natural-conversation\/setup-wizard/);
  assert.doesNotMatch(source, /\.\.\/lib\/conversation-controller\.mjs/);
  assert.match(source, /pi\.on\("tool_call"/);
  assert.match(source, /pi\.on\("before_agent_start"/);
  assert.match(source, /pi\.on\("user_bash"/);
  assert.match(source, /pi\.on\("agent_start"/);
  assert.match(source, /pi\.on\("agent_end"/);
  assert.match(source, /pi\.on\("message_update"/);
  assert.match(source, /pi\.on\("tool_execution_start"/);

  // Safety-critical teardown ordering: the companion must die before
  // tools/thinking are restored, in both /talk off and session_shutdown.
  assert.match(source, /await loop\.stop\(ctx, \{ notify: false \}\);\n\s*controller\.disable\(ctx\);/);
  assert.match(source, /await loop\.stop\(ctx, \{ notify: false \}\);\n\s*controller\.shutdown\(ctx\);/);

  // New exports must resolve for the extension imports.
  assert.equal(pkg.exports["./native-audio-loop"], "./lib/native-audio-loop.mjs");
  assert.equal(pkg.exports["./setup-wizard"], "./lib/setup-wizard.mjs");
  assert.equal(pkg.exports["./voice-config"], "./lib/voice-config.mjs");
});
