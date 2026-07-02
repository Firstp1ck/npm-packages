import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectSttEnvironment, provisionLocalStt, sttInstallHint, MODEL_CATALOG, STT_SERVICE_NAME } from "../lib/stt-provisioner.mjs";

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

/** STT adapter whose probe results are scripted per call. */
function scriptedAdapterFactory(results) {
  let call = 0;
  return () => ({
    probe: async () => ({ ok: results[Math.min(call++, results.length - 1)], detail: "scripted" }),
  });
}

test("detectSttEnvironment finds ggml models and reports install hints", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-stt-home-"));
  const modelsDir = join(home, ".local", "share", "pywhispercpp", "models");
  mkdirSync(modelsDir, { recursive: true });
  writeFileSync(join(modelsDir, "ggml-base.bin"), Buffer.alloc(11 * 1024 * 1024));
  writeFileSync(join(modelsDir, "ggml-tiny-junk.bin"), Buffer.alloc(1024)); // too small — ignored
  writeFileSync(join(modelsDir, "notes.txt"), "not a model");

  const detection = detectSttEnvironment({
    env: {},
    home,
    findExec: (name) => (name === "pacman" ? "/usr/bin/pacman" : name === "whisper-server" ? "/usr/bin/whisper-server" : undefined),
  });

  assert.equal(detection.serverBinary, "/usr/bin/whisper-server");
  assert.equal(detection.packageManager, "pacman");
  assert.deepEqual(detection.models.map((m) => m.file), ["ggml-base.bin"]);
  assert.match(detection.installHint, /pacman -S whisper-cpp-vulkan/);
  assert.match(sttInstallHint(undefined), /build it from source/);
  assert.match(sttInstallHint("brew"), /brew install whisper-cpp/);
});

test("an already-running endpoint is used without any further steps", async () => {
  const ctx = scriptedCtx({});
  const result = await provisionLocalStt({
    ctx,
    env: {},
    deps: { makeSttAdapter: scriptedAdapterFactory([true]), detect: () => ({ throwIfCalled: true }) },
  });
  assert.deepEqual(result, { url: "http://127.0.0.1:8178/inference", mode: "existing-endpoint" });
  assert.match(ctx.notifications[0].message, /already|Found a running/i);
});

test("install-hint loop re-detects, model is reused, and a systemd service is written and verified", async () => {
  const detections = [
    { serverBinary: undefined, models: [], packageManager: "pacman", installHint: sttInstallHint("pacman"), espeak: true },
    {
      serverBinary: "/usr/bin/whisper-server",
      models: [{ path: "/models/ggml-large-v3-turbo.bin", file: "ggml-large-v3-turbo.bin", sizeMb: 1620 }],
      packageManager: "pacman",
      installHint: sttInstallHint("pacman"),
      espeak: true,
    },
  ];
  const commands = [];
  const written = [];
  const ctx = scriptedCtx({
    selects: [
      "I installed it — check again",
      "ggml-large-v3-turbo.bin (1620 MB, /models/ggml-large-v3-turbo.bin)",
    ],
    confirms: [true], // install the systemd service
  });

  const result = await provisionLocalStt({
    ctx,
    env: { XDG_CONFIG_HOME: "/fake/.config" },
    deps: {
      detect: () => detections.shift() ?? detections[0],
      // initial endpoint probe fails; post-service probe succeeds
      makeSttAdapter: scriptedAdapterFactory([false, true]),
      runCommand: async (command, args) => {
        commands.push([command, ...args]);
        return { code: 0, stdout: "", stderr: "" };
      },
      writeFile: (path, content) => written.push({ path, content }),
      mkdir: () => {},
      sleep: async () => {},
      home: "/fake",
    },
  });

  assert.deepEqual(result, { url: "http://127.0.0.1:8178/inference", mode: "service" });
  assert.equal(written.length, 1);
  assert.equal(written[0].path, `/fake/.config/systemd/user/${STT_SERVICE_NAME}`);
  assert.match(written[0].content, /ExecStart=.*whisper-server -m \/models\/ggml-large-v3-turbo\.bin --host 127\.0\.0\.1 --port 8178/);
  assert.match(written[0].content, /WantedBy=default\.target/);
  assert.ok(commands.some((c) => c.join(" ") === "systemctl --user daemon-reload"));
  assert.ok(commands.some((c) => c.join(" ") === `systemctl --user enable --now ${STT_SERVICE_NAME}`));
  assert.ok(ctx.notifications.some((n) => /whisper-server is not installed/.test(n.message)), "install hint must be shown");
});

test("skipping at the install prompt returns undefined and runs no commands", async () => {
  const commands = [];
  const ctx = scriptedCtx({ selects: ["Skip local STT setup"] });
  const result = await provisionLocalStt({
    ctx,
    env: {},
    deps: {
      detect: () => ({ serverBinary: undefined, models: [], packageManager: "pacman", installHint: "hint", espeak: true }),
      makeSttAdapter: scriptedAdapterFactory([false]),
      runCommand: async (...args) => {
        commands.push(args);
        return { code: 0, stdout: "", stderr: "" };
      },
    },
  });
  assert.equal(result, undefined);
  assert.deepEqual(commands, []);
});

test("model download path with manual start mode verifies the endpoint", async () => {
  const home = mkdtempSync(join(tmpdir(), "pi-stt-home-"));
  const downloads = [];
  const base = MODEL_CATALOG[0];
  const ctx = scriptedCtx({
    selects: [`download ${base.id} (${base.sizeMb} MB — ${base.note})`],
    confirms: [
      true, // download model
      false, // decline systemd service
      true, // "server is running now, verify"
    ],
  });

  const result = await provisionLocalStt({
    ctx,
    env: {},
    deps: {
      detect: () => ({ serverBinary: "/usr/bin/whisper-server", models: [], packageManager: "pacman", installHint: "hint", espeak: true }),
      // initial probe fails; manual-start verification succeeds
      makeSttAdapter: scriptedAdapterFactory([false, true]),
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
      download: async (url, target) => downloads.push({ url, target }),
      sleep: async () => {},
      home,
    },
  });

  assert.deepEqual(result, { url: "http://127.0.0.1:8178/inference", mode: "manual" });
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].url, base.url);
  assert.ok(downloads[0].target.endsWith(`/whisper/${base.file}`));
  assert.ok(ctx.notifications.some((n) => /whisper-server -m .*ggml-base\.en\.bin --host 127\.0\.0\.1 --port 8178/.test(n.message)), "manual start command must be shown");
  assert.ok(ctx.notifications.some((n) => /start it again after a reboot/i.test(n.message)));
});
