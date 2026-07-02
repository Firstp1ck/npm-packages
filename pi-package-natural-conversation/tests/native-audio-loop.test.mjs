import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createNativeAudioLoop } from "../lib/native-audio-loop.mjs";
import { createConversationController } from "../lib/conversation-controller.mjs";
import { defaultVoiceConfig } from "../lib/voice-config.mjs";

class MockPi {
  constructor() {
    this.activeTools = ["read", "bash", "write", "grep", "find", "ls"];
    this.thinkingLevel = "high";
    this.allTools = this.activeTools.map((name) => ({ name }));
    this.sentMessages = [];
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

  sendUserMessage(content, options) {
    this.sentMessages.push({ content, options });
  }
}

function mockCtx() {
  const notifications = [];
  const widgets = new Map();
  const statuses = new Map();
  return {
    hasUI: true,
    notifications,
    widgets,
    statuses,
    ui: {
      theme: { fg: (_n, v) => v },
      notify: (message, level) => notifications.push({ message, level }),
      setStatus: (key, value) => statuses.set(key, value),
      setWidget: (key, content) => widgets.set(key, content),
    },
  };
}

/** Fake companion child: parses JSONL on stdin, responds per script. */
class FakeChild extends EventEmitter {
  constructor({ respondToShutdown = true } = {}) {
    super();
    this.pid = 4242;
    this.exitCode = null;
    this.killed = false;
    this.received = [];
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.respondToShutdown = respondToShutdown;
    const self = this;
    this.stdin = {
      write(line) {
        for (const part of String(line).split("\n")) {
          if (!part.trim()) continue;
          const message = JSON.parse(part);
          self.received.push(message);
          self.handle(message);
        }
        return true;
      },
      end() {
        self.stdinEnded = true;
      },
      on() {},
    };
  }

  handle(message) {
    if (message.type === "hello") {
      this.reply({
        type: "ready",
        protocolVersion: 1,
        pid: this.pid,
        capture: { tool: "pw-record" },
        playback: { tool: "pw-play" },
        stt: { provider: "local-endpoint" },
        tts: { provider: "espeak-ng" },
      });
    } else if (message.type === "shutdown" && this.respondToShutdown) {
      this.reply({ type: "bye" });
      this.exit(0);
    }
  }

  reply(message) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  exit(code) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.emit("exit", code);
  }

  kill(signal) {
    this.killed = true;
    this.exit(signal === "SIGKILL" ? 137 : 143);
  }

  messagesOfType(type) {
    return this.received.filter((m) => m.type === type);
  }
}

function makeConfig() {
  const config = defaultVoiceConfig();
  config.native.enabled = true;
  config.native.stt.url = "http://127.0.0.1:8178/inference";
  config.native.tts.provider = "espeak-ng";
  config.consent.nativeAudioAcceptedAt = "2026-07-02T00:00:00Z";
  return config;
}

function makeLoop({ config = makeConfig(), childFactory, controllerOverrides } = {}) {
  const pi = new MockPi();
  const controller = createConversationController(pi);
  const children = [];
  const kills = [];
  const loop = createNativeAudioLoop(pi, controller, {
    spawn: () => {
      const child = childFactory ? childFactory() : new FakeChild();
      children.push(child);
      return child;
    },
    env: {},
    loadConfig: () => ({ config, warnings: [], path: "/tmp/voice.json", exists: true }),
    sweep: () => ({ killed: [], removed: [] }),
    kill: (pid, signal) => kills.push({ pid, signal }),
    registerExitHook: () => {},
    timings: {
      handshakeMs: 500,
      byeMs: 50,
      stdinCloseMs: 25,
      sigtermMs: 25,
      restartBackoffMs: [10, 10, 10],
      restartWindowMs: 1000,
      restartLimit: 3,
      steerDebounceMs: 20,
      probeTimeoutMs: 200,
      maxPendingInterrupts: 3,
    },
  });
  return { pi, controller, loop, children, kills, controllerOverrides };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("refuses to spawn when the controller is disabled", async () => {
  const { loop, children } = makeLoop();
  const ctx = mockCtx();
  const started = await loop.start(ctx);
  assert.equal(started, false);
  assert.equal(children.length, 0, "no companion may be spawned outside safe mode");
  assert.match(ctx.notifications[0].message, /\/talk on/);
});

test("refuses to start without native.enabled or consent", async () => {
  const noConsent = makeConfig();
  noConsent.consent.nativeAudioAcceptedAt = null;
  const { controller, loop, children } = makeLoop({ config: noConsent });
  const ctx = mockCtx();
  controller.enable(ctx);
  assert.equal(await loop.start(ctx), false);
  assert.equal(children.length, 0);

  const disabled = makeConfig();
  disabled.native.enabled = false;
  const second = makeLoop({ config: disabled });
  second.controller.enable(ctx);
  assert.equal(await second.loop.start(ctx), false);
  assert.equal(second.children.length, 0);
});

test("start performs the handshake, opens the gate, and shows widget + footer state", async () => {
  const { controller, loop, children } = makeLoop();
  const ctx = mockCtx();
  controller.enable(ctx);

  const started = await loop.start(ctx);
  assert.equal(started, true);
  assert.equal(loop.isRunning(), true);

  const child = children[0];
  assert.deepEqual(child.received.map((m) => m.type), ["hello", "listen", "gate"]);
  assert.equal(child.received[0].config.native.stt.url, "http://127.0.0.1:8178/inference");
  assert.equal(child.received[2].mode, "open");
  assert.equal(controller.getState().uiState, "listening");
  assert.match(ctx.widgets.get("natural-conversation-audio")[0], /Voice listening/);
});

test("idle transcripts dispatch through pi.sendUserMessage with no deliverAs", async () => {
  const { pi, controller, loop, children } = makeLoop();
  const ctx = mockCtx();
  controller.enable(ctx);
  await loop.start(ctx);

  children[0].reply({ type: "final-transcript", text: "how does this work", utteranceMs: 900, sttMs: 120, capturedDuring: "listening" });
  await sleep(20);

  assert.equal(pi.sentMessages.length, 1);
  assert.equal(pi.sentMessages[0].content, "how does this work");
  assert.equal(pi.sentMessages[0].options, undefined);
});

test("transcripts while streaming coalesce into one capped steer message", async () => {
  const { pi, controller, loop, children } = makeLoop();
  const ctx = mockCtx();
  controller.enable(ctx);
  await loop.start(ctx);

  loop.handleAgentStart(ctx);
  loop.handleToolExecutionStart(ctx);
  const child = children[0];
  for (const text of ["one", "two", "three", "four"]) {
    child.reply({ type: "final-transcript", text, utteranceMs: 500, sttMs: 80, capturedDuring: "listening" });
  }
  await sleep(80); // > steerDebounceMs

  assert.equal(pi.sentMessages.length, 1);
  // cap 3 with drop-oldest: "one" is dropped
  assert.equal(pi.sentMessages[0].content, "two\nthree\nfour");
  assert.deepEqual(pi.sentMessages[0].options, { deliverAs: "steer" });
  assert.ok(ctx.notifications.some((n) => /dropped the oldest/.test(n.message)));
});

test("agent_end speaks the final answer in chunks and silence event fires after a question", async () => {
  const { pi, controller, loop, children } = makeLoop();
  const ctx = mockCtx();
  controller.enable(ctx, { silenceTimeoutMs: 60 });
  await loop.start(ctx);
  const child = children[0];

  loop.handleAgentStart(ctx);
  loop.handleAgentEnd(
    {
      type: "agent_end",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "text", text: "This is the answer to your question. It has several sentences in it. Would you like more detail?" }] },
      ],
    },
    ctx,
  );

  const speaks = child.messagesOfType("speak");
  assert.ok(speaks.length >= 1, "final answer must be spoken");
  assert.ok(child.messagesOfType("gate").some((m) => m.mode === "closed"), "half-duplex gate closes while speaking");
  assert.equal(controller.getState().uiState, "speaking");

  // Companion reports all speak chunks done → gate reopens, silence timer arms.
  for (const speak of speaks) {
    child.reply({ type: "speak-ended", id: speak.id, cancelled: false });
  }
  await sleep(30);
  assert.equal(controller.getState().uiState, "listening");

  await sleep(120); // silence timeout (60ms) passes with no speech
  const silenceMessages = pi.sentMessages.filter((m) => /stayed silent/.test(m.content));
  assert.equal(silenceMessages.length, 1, "exactly one silence event per question");
  assert.match(silenceMessages[0].content, /\[Conversation mode: the user stayed silent for \d+s after your question\./);
});

test("self-echo transcripts captured while speaking are dropped", async () => {
  const { pi, controller, loop, children } = makeLoop();
  const ctx = mockCtx();
  controller.enable(ctx);
  await loop.start(ctx);
  const child = children[0];

  loop.handleAgentStart(ctx);
  loop.handleAgentEnd(
    { type: "agent_end", messages: [{ role: "assistant", content: "The controller stores previous tools and restores them on disable." }] },
    ctx,
  );
  child.reply({
    type: "final-transcript",
    text: "controller stores previous tools and restores them",
    utteranceMs: 700,
    sttMs: 100,
    capturedDuring: "speaking",
  });
  await sleep(20);
  assert.equal(pi.sentMessages.length, 0, "echo of our own TTS must not become a user turn");
});

test("stop escalates: shutdown → stdin close → SIGTERM group → SIGKILL group", async () => {
  const { controller, loop, children, kills } = makeLoop({ childFactory: () => new FakeChild({ respondToShutdown: false }) });
  const ctx = mockCtx();
  controller.enable(ctx);
  await loop.start(ctx);
  const child = children[0];

  await loop.stop(ctx);
  assert.equal(child.received.at(-1).type, "shutdown");
  assert.equal(child.stdinEnded, true, "stdin must be closed when bye does not arrive");
  assert.deepEqual(kills.map((k) => k.signal), ["SIGTERM", "SIGKILL"]);
  assert.equal(kills[0].pid, -4242, "signals go to the process group");
  assert.equal(loop.getPhase(), "off");
  assert.equal(ctx.widgets.get("natural-conversation-audio"), undefined);
});

test("graceful stop needs no signals when the companion says bye", async () => {
  const { controller, loop, children, kills } = makeLoop();
  const ctx = mockCtx();
  controller.enable(ctx);
  await loop.start(ctx);

  await loop.stop(ctx);
  assert.equal(children[0].exitCode, 0);
  assert.deepEqual(kills, []);
  assert.equal(loop.getPhase(), "off");
});

test("pause stops capture and resume reopens the gate", async () => {
  const { controller, loop, children } = makeLoop();
  const ctx = mockCtx();
  controller.enable(ctx);
  await loop.start(ctx);
  const child = children[0];

  loop.pause(ctx);
  assert.equal(child.received.at(-1).type, "pause");
  assert.equal(controller.getState().uiState, "paused");
  assert.match(ctx.widgets.get("natural-conversation-audio")[0], /paused/);

  loop.resume(ctx);
  const types = child.received.map((m) => m.type);
  assert.deepEqual(types.slice(-2), ["listen", "gate"]);
  assert.equal(controller.getState().uiState, "listening");
});

test("unexpected exits restart with backoff, then degrade to error keeping safe mode on", async () => {
  const { controller, loop, children } = makeLoop();
  const ctx = mockCtx();
  controller.enable(ctx);
  await loop.start(ctx);

  // Crash the companion repeatedly past the restart budget.
  for (let i = 0; i < 4; i++) {
    const child = children.at(-1);
    child.exit(1);
    await sleep(40); // wait for the restart backoff (10ms) + handshake
  }

  assert.equal(loop.getPhase(), "error");
  assert.equal(controller.isEnabled(), true, "safe mode must stay on after audio failure");
  assert.equal(controller.getState().uiState, "error");
  const errors = ctx.notifications.filter((n) => n.level === "error");
  assert.ok(errors.some((n) => /repeated failures/.test(n.message)));
});

test("probes route through a short-lived companion when the loop is off", async () => {
  class ProbeChild extends FakeChild {
    handle(message) {
      super.handle(message);
      if (message.type === "probe") {
        this.reply({ type: "probe-result", id: message.id, target: message.target, ok: true, detail: `${message.target} ok` });
      }
    }
  }
  const { controller, loop, children } = makeLoop({ childFactory: () => new ProbeChild() });
  const ctx = mockCtx();
  controller.enable(ctx);

  const results = await loop.doctor(ctx, "mic");
  assert.deepEqual(results.map((r) => ({ target: r.target, ok: r.ok })), [{ target: "mic", ok: true }]);
  assert.equal(children.length, 1);
  assert.equal(children[0].exitCode, 0, "short-lived companion must be shut down");
  assert.ok(ctx.notifications.some((n) => /doctor/i.test(n.message)));
});
