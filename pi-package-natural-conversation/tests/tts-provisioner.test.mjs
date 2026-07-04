import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectTtsEnvironment, provisionPiperTts, piperInstallHint, VOICE_CATALOG } from "../lib/tts-provisioner.mjs";

function scriptedCtx({ selects = [], confirms = [] }) {
  const notifications = [];
  return {
    hasUI: true,
    notifications,
    ui: {
      notify: (message, level) => notifications.push({ message, level }),
      select: async () => selects.shift(),
      confirm: async () => confirms.shift(),
      input: async () => "",
    },
  };
}

test("detectTtsEnvironment finds voices with sidecar configs and hints installs", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-tts-home-"));
  const voicesDir = join(home, ".local", "share", "piper");
  mkdirSync(voicesDir, { recursive: true });
  writeFileSync(join(voicesDir, "de_DE-thorsten-medium.onnx"), Buffer.alloc(1024 * 1024));
  writeFileSync(join(voicesDir, "de_DE-thorsten-medium.onnx.json"), "{}");
  writeFileSync(join(voicesDir, "orphan.onnx"), Buffer.alloc(1024)); // no sidecar json — ignored

  const detection = detectTtsEnvironment({
    env: {},
    home,
    findExec: (name) => (name === "pacman" ? "/usr/bin/pacman" : name === "piper" ? "/usr/bin/piper" : undefined),
  });

  assert.equal(detection.piperBinary, "/usr/bin/piper");
  assert.deepEqual(detection.voices.map((v) => v.file), ["de_DE-thorsten-medium.onnx"]);
  assert.match(detection.installHint, /piper-tts-bin/);
  assert.match(piperInstallHint(undefined), /pipx install piper-tts/);
});

test("install-hint loop re-detects, an on-disk voice is reused, and synthesis is verified", async () => {
  const detections = [
    { piperBinary: undefined, voices: [], packageManager: "pacman", installHint: piperInstallHint("pacman") },
    {
      piperBinary: "/usr/bin/piper",
      voices: [{ path: "/voices/de_DE-thorsten-medium.onnx", file: "de_DE-thorsten-medium.onnx", sizeMb: 63 }],
      packageManager: "pacman",
      installHint: piperInstallHint("pacman"),
    },
  ];
  const probeCalls = [];
  const ctx = scriptedCtx({
    selects: [
      "I installed it — check again",
      "de_DE-thorsten-medium.onnx (63 MB, /voices/de_DE-thorsten-medium.onnx)",
    ],
  });

  const result = await provisionPiperTts({
    ctx,
    env: {},
    deps: {
      detectTts: () => detections.shift() ?? detections[0],
      makePiperAdapter: (options) => ({
        probe: async () => {
          probeCalls.push(options);
          return { ok: true, detail: "piper synthesized 4096 bytes at 22050 Hz in 80ms" };
        },
      }),
    },
  });

  assert.deepEqual(result, { modelPath: "/voices/de_DE-thorsten-medium.onnx" });
  assert.deepEqual(probeCalls, [{ modelPath: "/voices/de_DE-thorsten-medium.onnx" }]);
  assert.ok(ctx.notifications.some((n) => /piper is not installed/.test(n.message)));
  assert.ok(ctx.notifications.some((n) => /voice verified/i.test(n.message)));
});

test("voice download fetches both the model and its sidecar config", async () => {
  const home = mkdtempSync(join(tmpdir(), "pi-tts-home-"));
  const downloads = [];
  const voice = VOICE_CATALOG.find((v) => v.id === "de_DE-thorsten-medium");
  const ctx = scriptedCtx({
    selects: [`download ${voice.id} (${voice.sizeMb} MB — ${voice.note})`],
    confirms: [true], // download consent
  });

  const result = await provisionPiperTts({
    ctx,
    env: {},
    deps: {
      detectTts: () => ({ piperBinary: "/usr/bin/piper", voices: [], packageManager: "pacman", installHint: "hint" }),
      download: async (url, target) => downloads.push({ url, target }),
      makePiperAdapter: () => ({ probe: async () => ({ ok: true, detail: "ok" }) }),
      home,
    },
  });

  assert.ok(result.modelPath.endsWith("/piper/de_DE-thorsten-medium.onnx"));
  assert.equal(downloads.length, 2);
  assert.equal(downloads[0].url, voice.url);
  assert.equal(downloads[1].url, voice.configUrl);
  assert.equal(downloads[1].target, `${result.modelPath}.json`);
});

test("failed verification returns undefined so the wizard can fall back to espeak-ng", async () => {
  const ctx = scriptedCtx({
    selects: ["v.onnx (63 MB, /voices/v.onnx)"],
  });
  const result = await provisionPiperTts({
    ctx,
    env: {},
    deps: {
      detectTts: () => ({ piperBinary: "/usr/bin/piper", voices: [{ path: "/voices/v.onnx", file: "v.onnx", sizeMb: 63 }], packageManager: undefined, installHint: "hint" }),
      makePiperAdapter: () => ({ probe: async () => ({ ok: false, detail: "boom" }) }),
    },
  });
  assert.equal(result, undefined);
  assert.ok(ctx.notifications.some((n) => n.level === "error"));
});

test("skipping at the install prompt returns undefined", async () => {
  const ctx = scriptedCtx({ selects: ["Skip natural voice setup"] });
  const result = await provisionPiperTts({
    ctx,
    env: {},
    deps: { detectTts: () => ({ piperBinary: undefined, voices: [], packageManager: undefined, installHint: "hint" }) },
  });
  assert.equal(result, undefined);
});
