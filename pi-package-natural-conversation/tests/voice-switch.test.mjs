import test from "node:test";
import assert from "node:assert/strict";
import { listPiperVoices, switchPiperVoice, voiceListText } from "../lib/voice-switch.mjs";
import { defaultVoiceConfig } from "../lib/voice-config.mjs";
import { VOICE_CATALOG } from "../lib/tts-provisioner.mjs";

function makeDeps({ onDisk = [], piperBinary = "/usr/bin/piper", config, saved = [], downloads = [], probeOk = true } = {}) {
  const cfg = config ?? defaultVoiceConfig();
  return {
    detectTts: () => ({ piperBinary, voices: onDisk, packageManager: "pacman", installHint: "hint" }),
    loadConfig: () => ({ config: structuredClone(cfg), warnings: [], path: "/tmp/voice.json", exists: true }),
    saveConfig: (next) => {
      saved.push(next);
      return { config: next, warnings: [], path: "/tmp/voice.json" };
    },
    download: async (url, target) => downloads.push({ url, target }),
    mkdir: () => {},
    makePiperAdapter: () => ({ probe: async () => (probeOk ? { ok: true, detail: "synthesized 4096 bytes" } : { ok: false, detail: "boom" }) }),
  };
}

function ctxWithNotifications() {
  const notifications = [];
  const statuses = [];
  return {
    hasUI: true,
    notifications,
    statuses,
    ui: {
      notify: (message, level) => notifications.push({ message, level }),
      setStatus: (_key, text) => statuses.push(text),
    },
  };
}

test("listPiperVoices merges the catalog with on-disk voices and marks the current one", () => {
  const config = defaultVoiceConfig();
  config.native.tts.provider = "piper";
  config.native.tts.modelPath = "/voices/de_DE-thorsten-medium.onnx";
  const listing = listPiperVoices({
    env: {},
    deps: makeDeps({
      config,
      onDisk: [
        { path: "/voices/de_DE-thorsten-medium.onnx", file: "de_DE-thorsten-medium.onnx", sizeMb: 61 },
        { path: "/voices/custom-voice.onnx", file: "custom-voice.onnx", sizeMb: 40 },
      ],
    }),
  });

  assert.equal(listing.current, "de_DE-thorsten-medium");
  assert.equal(listing.piperInstalled, true);
  const thorsten = listing.voices.find((voice) => voice.id === "de_DE-thorsten-medium");
  assert.equal(thorsten.downloaded, true);
  assert.equal(thorsten.current, true);
  const custom = listing.voices.find((voice) => voice.id === "custom-voice");
  assert.equal(custom.note, "found on disk");
  const notDownloaded = listing.voices.find((voice) => voice.id === "en_US-lessac-medium");
  assert.equal(notDownloaded.downloaded, false);
  assert.match(voiceListText(listing), /● de_DE-thorsten-medium/);
  assert.match(voiceListText(listing), /↓ en_US-lessac-medium/);
});

test("switching to an on-disk voice verifies, persists, and live-applies without downloading", async () => {
  const saved = [];
  const downloads = [];
  const applied = [];
  const ctx = ctxWithNotifications();
  const result = await switchPiperVoice("de_DE-thorsten-medium", {
    env: {},
    ctx,
    loop: { applyTtsConfig: (patch) => applied.push(patch) },
    controller: { updateStatus: () => {} },
    deps: {
      ...makeDeps({ saved, downloads, onDisk: [{ path: "/voices/de_DE-thorsten-medium.onnx", file: "de_DE-thorsten-medium.onnx", sizeMb: 61 }] }),
      onStatus: () => {},
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.downloaded, false);
  assert.deepEqual(downloads, []);
  assert.equal(saved[0].native.tts.provider, "piper");
  assert.equal(saved[0].native.tts.modelPath, "/voices/de_DE-thorsten-medium.onnx");
  assert.deepEqual(applied, [{ provider: "piper", modelPath: "/voices/de_DE-thorsten-medium.onnx" }]);
  assert.ok(ctx.notifications.some((n) => /Voice switched to de_DE-thorsten-medium/.test(n.message)));
});

test("switching to a missing catalog voice downloads model + sidecar with percent progress", async () => {
  const saved = [];
  const downloads = [];
  const statusTexts = [];
  const voice = VOICE_CATALOG.find((entry) => entry.id === "en_US-lessac-medium");
  const deps = {
    ...makeDeps({ saved, downloads }),
    download: async (url, target, { onProgress } = {}) => {
      downloads.push({ url, target });
      if (onProgress) {
        onProgress({ receivedBytes: 25, totalBytes: 100 });
        onProgress({ receivedBytes: 100, totalBytes: 100 });
      }
    },
    onStatus: (text) => statusTexts.push(text),
  };
  const ctx = ctxWithNotifications();

  const result = await switchPiperVoice("en_US-lessac-medium", { env: {}, ctx, deps, home: "/fake" });

  assert.equal(result.ok, true);
  assert.equal(result.downloaded, true);
  assert.equal(downloads.length, 2);
  assert.equal(downloads[0].url, voice.url);
  assert.equal(downloads[1].url, voice.configUrl);
  assert.ok(statusTexts.includes("Voice: downloading en_US-lessac-medium 25%"));
  assert.ok(statusTexts.includes("Voice: downloading en_US-lessac-medium 100%"));
  assert.ok(statusTexts.includes("Voice: testing en_US-lessac-medium"));
  assert.equal(statusTexts.at(-1), undefined, "status is cleared at the end");
  assert.equal(saved[0].native.tts.modelPath, "/fake/.local/share/piper/en_US-lessac-medium.onnx");
});

test("failed verification does not persist config; unknown voices list the options", async () => {
  const saved = [];
  const ctx = ctxWithNotifications();
  const failed = await switchPiperVoice("de_DE-thorsten-medium", {
    env: {},
    ctx,
    deps: {
      ...makeDeps({ saved, probeOk: false, onDisk: [{ path: "/voices/de_DE-thorsten-medium.onnx", file: "de_DE-thorsten-medium.onnx", sizeMb: 61 }] }),
      onStatus: () => {},
    },
  });
  assert.equal(failed.ok, false);
  assert.equal(saved.length, 0);
  assert.ok(ctx.notifications.some((n) => n.level === "error"));

  const unknown = await switchPiperVoice("nope", { env: {}, ctx, deps: { ...makeDeps({ saved }), onStatus: () => {} } });
  assert.equal(unknown.ok, false);
  assert.ok(ctx.notifications.some((n) => /Unknown voice 'nope'/.test(n.message)));
});

test("switching requires piper to be installed", async () => {
  const saved = [];
  const ctx = ctxWithNotifications();
  const result = await switchPiperVoice("en_US-lessac-medium", {
    env: {},
    ctx,
    deps: { ...makeDeps({ saved, piperBinary: null }), onStatus: () => {} },
  });
  assert.equal(result.ok, false);
  assert.equal(saved.length, 0);
  assert.ok(ctx.notifications.some((n) => /\/talk setup/.test(n.message)));
});
