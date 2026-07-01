import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createConversationController, DEFAULT_ALLOWED_TOOLS } from "../lib/conversation-controller.mjs";

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

test("extension package manifest and native commands are wired", async () => {
  const [pkgRaw, source] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../extensions/natural-conversation.ts", import.meta.url), "utf8"),
  ]);
  const pkg = JSON.parse(pkgRaw);

  assert.deepEqual(pkg.pi.extensions, ["./extensions/natural-conversation.ts"]);
  assert.match(source, /COMMAND_NAMES = \["talk", "voice", "conversation"\]/);
  assert.match(source, /pi\.on\("tool_call"/);
  assert.match(source, /pi\.on\("before_agent_start"/);
  assert.match(source, /pi\.on\("user_bash"/);
});
