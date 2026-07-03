import test from "node:test";
import assert from "node:assert/strict";
import { runSetupWizard } from "../lib/setup-wizard.mjs";
import { createConversationController } from "../lib/conversation-controller.mjs";
import { defaultVoiceConfig } from "../lib/voice-config.mjs";

class MockPi {
  getActiveTools() {
    return ["read", "bash"];
  }

  setActiveTools() {}

  getAllTools() {
    return [{ name: "read" }, { name: "grep" }, { name: "find" }, { name: "ls" }, { name: "bash" }];
  }

  getThinkingLevel() {
    return "high";
  }

  setThinkingLevel() {}
}

function scriptedCtx({ selects = [], confirms = [], inputs = [] }) {
  const notifications = [];
  return {
    hasUI: true,
    notifications,
    ui: {
      theme: { fg: (_n, v) => v },
      notify: (message, level) => notifications.push({ message, level }),
      setStatus: () => {},
      select: async () => selects.shift(),
      confirm: async () => confirms.shift(),
      input: async (_title, placeholder) => {
        const value = inputs.shift();
        return value === "" ? placeholder ?? "" : value;
      },
    },
  };
}

function wizardDeps({ saved }) {
  return {
    findExec: (name) => (["pw-record", "pw-play", "espeak-ng"].includes(name) ? `/usr/bin/${name}` : undefined),
    loadConfig: () => ({ config: defaultVoiceConfig(), warnings: [], path: "/tmp/voice.json", exists: false }),
    saveConfig: (config) => {
      saved.push(config);
      return { config, warnings: [], path: "/tmp/voice.json" };
    },
    nowIso: () => "2026-07-02T12:00:00.000Z",
    makeSttAdapter: () => ({ probe: async () => ({ ok: true, detail: "stt ok" }) }),
    // no TTS endpoint answering by default → the wizard shows the provider menu
    makeTtsAdapter: () => ({ probe: async () => ({ ok: false, detail: "tts unreachable" }) }),
    makeEspeakAdapter: () => ({ probe: async () => ({ ok: true, detail: "espeak-ng at /usr/bin/espeak-ng" }) }),
  };
}

function fakeLoop() {
  return {
    runProbes: async (_ctx, targets) =>
      targets.map((target) =>
        target === "mic"
          ? { target, ok: true, detail: "pw-record, peak -20 dBFS", noiseFloorDb: -45 }
          : { target, ok: true, detail: `${target} ok` },
      ),
  };
}

test("setup wizard writes an enabled, calibrated config with consent after the summary confirm", async () => {
  const pi = new MockPi();
  const controller = createConversationController(pi);
  const saved = [];
  const ctx = scriptedCtx({
    selects: ["espeak-ng (works now, robotic)"],
    confirms: [
      true, // use the already-running STT endpoint
      true, // microphone test
      true, // speaker test
      true, // heard the tone
      false, // headphones
      true, // auto-start
      true, // consent summary
    ],
    inputs: ["5"], // silence seconds
  });
  controller.enable(ctx);

  const result = await runSetupWizard({ pi, controller, loop: fakeLoop(), ctx, env: {}, deps: wizardDeps({ saved }) });

  assert.equal(result.completed, true);
  assert.equal(saved.length, 1);
  const config = saved[0];
  assert.equal(config.native.enabled, true);
  assert.equal(config.consent.nativeAudioAcceptedAt, "2026-07-02T12:00:00.000Z");
  assert.equal(config.native.stt.provider, "local-endpoint");
  assert.equal(config.native.stt.url, "http://127.0.0.1:8178/inference");
  assert.equal(config.native.tts.provider, "espeak-ng");
  assert.equal(config.native.vad.thresholdDb, -33, "noise floor -45 + 12 dB");
  assert.equal(config.native.silence.timeoutMs, 5000);
  assert.equal(config.native.autoStartWithTalkOn, true);
  assert.equal(config.native.headphones, false);
  assert.equal(config.native.allowRemoteProviders, false);
});

test("declining the consent summary writes nothing", async () => {
  const pi = new MockPi();
  const controller = createConversationController(pi);
  const saved = [];
  const ctx = scriptedCtx({
    selects: ["espeak-ng (works now, robotic)"],
    confirms: [true, false, false, false, false, false], // accept endpoint; skip tests/options, refuse consent
    inputs: [""],
  });
  controller.enable(ctx);

  const result = await runSetupWizard({ pi, controller, loop: fakeLoop(), ctx, env: {}, deps: wizardDeps({ saved }) });

  assert.equal(result.completed, false);
  assert.equal(result.reason, "cancelled");
  assert.equal(saved.length, 0, "cancelling must not write voice.json");
  assert.ok(ctx.notifications.some((n) => /nothing was written/i.test(n.message)));
});

test("non-loopback endpoints require the extra remote consent", async () => {
  const pi = new MockPi();
  const controller = createConversationController(pi);
  const saved = [];
  const ctx = scriptedCtx({
    selects: ["custom URL", "espeak-ng (works now, robotic)"],
    confirms: [
      false, // do not use the running endpoint (we want a custom one)
      false, // microphone test
      false, // speaker test
      false, // headphones
      true, // auto-start
      false, // remote endpoints — REFUSED
    ],
    inputs: ["http://stt.example.com/inference", ""],
  });
  controller.enable(ctx);

  const result = await runSetupWizard({ pi, controller, loop: fakeLoop(), ctx, env: {}, deps: wizardDeps({ saved }) });
  assert.equal(result.completed, false);
  assert.equal(saved.length, 0);
});

test("wizard routes to guided STT provisioning when no endpoint answers", async () => {
  const pi = new MockPi();
  const controller = createConversationController(pi);
  const saved = [];
  const provisionCalls = [];
  const deps = {
    ...wizardDeps({ saved }),
    // no endpoint is answering anywhere
    makeSttAdapter: () => ({ probe: async () => ({ ok: false, detail: "unreachable" }) }),
    provisionStt: async (args) => {
      provisionCalls.push(args);
      return { url: "http://127.0.0.1:8178/inference", mode: "service" };
    },
  };
  const ctx = scriptedCtx({
    selects: ["guided local whisper setup (recommended, private)", "espeak-ng (works now, robotic)"],
    confirms: [
      false, // microphone test
      false, // speaker test
      false, // headphones
      true, // auto-start
      true, // consent summary
    ],
    inputs: [""],
  });
  controller.enable(ctx);

  const result = await runSetupWizard({ pi, controller, loop: fakeLoop(), ctx, env: {}, deps });

  assert.equal(result.completed, true);
  assert.equal(provisionCalls.length, 1);
  assert.equal(saved[0].native.stt.provider, "local-endpoint");
  assert.equal(saved[0].native.stt.url, "http://127.0.0.1:8178/inference");
});

test("wizard routes to guided Piper provisioning and stores the voice model path", async () => {
  const pi = new MockPi();
  const controller = createConversationController(pi);
  const saved = [];
  const deps = {
    ...wizardDeps({ saved }),
    provisionTts: async () => ({ modelPath: "/voices/de_DE-thorsten-medium.onnx" }),
  };
  const ctx = scriptedCtx({
    selects: ["guided natural voice setup (Piper, local)"],
    confirms: [
      true, // use running STT endpoint
      false, // microphone test
      false, // speaker test
      false, // headphones
      true, // auto-start
      true, // consent summary
    ],
    inputs: [""],
  });
  controller.enable(ctx);

  const result = await runSetupWizard({ pi, controller, loop: fakeLoop(), ctx, env: {}, deps });

  assert.equal(result.completed, true);
  assert.equal(saved[0].native.tts.provider, "piper");
  assert.equal(saved[0].native.tts.modelPath, "/voices/de_DE-thorsten-medium.onnx");
  assert.equal(saved[0].native.tts.fallback, "espeak-ng");
});

test("wizard falls back to espeak-ng when guided Piper provisioning is skipped", async () => {
  const pi = new MockPi();
  const controller = createConversationController(pi);
  const saved = [];
  const deps = {
    ...wizardDeps({ saved }),
    provisionTts: async () => undefined,
  };
  const ctx = scriptedCtx({
    selects: ["guided natural voice setup (Piper, local)"],
    confirms: [true, false, false, false, true, true],
    inputs: [""],
  });
  controller.enable(ctx);

  const result = await runSetupWizard({ pi, controller, loop: fakeLoop(), ctx, env: {}, deps });

  assert.equal(result.completed, true);
  assert.equal(saved[0].native.tts.provider, "espeak-ng");
  assert.ok(ctx.notifications.some((n) => /Falling back to espeak-ng/.test(n.message)));
});

test("wizard refuses to run without safe mode consent", async () => {
  const pi = new MockPi();
  const controller = createConversationController(pi);
  const saved = [];
  const ctx = scriptedCtx({ selects: [], confirms: [false], inputs: [] }); // refuse enabling safe mode

  const result = await runSetupWizard({ pi, controller, loop: fakeLoop(), ctx, env: {}, deps: wizardDeps({ saved }) });
  assert.equal(result.completed, false);
  assert.equal(controller.isEnabled(), false);
  assert.equal(saved.length, 0);
});

test("wizard degrades to text instructions without dialog UI", async () => {
  const pi = new MockPi();
  const controller = createConversationController(pi);
  const notifications = [];
  const ctx = { hasUI: true, ui: { notify: (message, level) => notifications.push({ message, level }) } };

  const result = await runSetupWizard({ pi, controller, loop: fakeLoop(), ctx, env: {}, deps: wizardDeps({ saved: [] }) });
  assert.equal(result.completed, false);
  assert.equal(result.reason, "no-dialog-ui");
  assert.ok(notifications.some((n) => /voice\.json/.test(n.message)));
});
