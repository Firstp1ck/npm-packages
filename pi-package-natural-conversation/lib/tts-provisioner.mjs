// Guided natural-voice (Piper) provisioning for /talk setup, mirroring the
// STT provisioner: detect the user-installed piper binary (never bundled —
// Piper is GPL), reuse voice models already on disk or download one after a
// size warning, then verify with a real test synthesis. No service is needed:
// the piper adapter execs the binary per utterance.
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findExecutable } from "./native-audio/exec-utils.mjs";
import { createPiperTtsAdapter, findPiperBinary } from "./providers/tts-piper.mjs";
import { downloadFile } from "./stt-provisioner.mjs";

const VOICES_BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

export const VOICE_CATALOG = Object.freeze([
  { id: "en_US-lessac-medium", path: "en/en_US/lessac/medium", sizeMb: 63, note: "natural US English" },
  { id: "en_GB-alba-medium", path: "en/en_GB/alba/medium", sizeMb: 63, note: "natural British English" },
  { id: "de_DE-thorsten-medium", path: "de/de_DE/thorsten/medium", sizeMb: 63, note: "natural German" },
  { id: "de_DE-thorsten-high", path: "de/de_DE/thorsten/high", sizeMb: 110, note: "German, best quality" },
].map((voice) => ({
  ...voice,
  file: `${voice.id}.onnx`,
  url: `${VOICES_BASE_URL}/${voice.path}/${voice.id}.onnx`,
  configUrl: `${VOICES_BASE_URL}/${voice.path}/${voice.id}.onnx.json`,
})));

const VOICE_SEARCH_DIRS = (home, env) => {
  const data = env.XDG_DATA_HOME || join(home, ".local", "share");
  return [join(data, "piper"), join(data, "piper", "voices"), join(data, "piper-voices")];
};

export function piperInstallHint(packageManager) {
  if (packageManager === "pacman") {
    return [
      "Install piper (pick one):",
      "  yay -S piper-tts-bin        # prebuilt binary from the AUR",
      "  pipx install piper-tts      # Python build, no AUR helper needed",
    ].join("\n");
  }
  return [
    "Install piper:",
    "  pipx install piper-tts",
    "or download a release from https://github.com/rhasspy/piper/releases",
  ].join("\n");
}

/** Detect piper binary and voice models already on disk. */
export function detectTtsEnvironment({ env = process.env, findExec = findExecutable, home = homedir() } = {}) {
  const packageManager = ["pacman", "brew", "apt-get", "dnf", "zypper"].find((tool) => findExec(tool, env));
  const voices = [];
  for (const dir of VOICE_SEARCH_DIRS(home, env)) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".onnx")) continue;
      const path = join(dir, entry);
      if (!existsSync(`${path}.json`)) continue; // piper voices need their sidecar config
      try {
        voices.push({ path, file: entry, sizeMb: Math.round(statSync(path).size / (1024 * 1024)) });
      } catch {
        // unreadable entry; skip
      }
    }
  }
  return {
    piperBinary: findPiperBinary(env, findExec),
    voices,
    packageManager,
    installHint: piperInstallHint(packageManager),
  };
}

/**
 * Guided Piper provisioning. Returns `{ modelPath }` on success or undefined
 * when the user skips/cancels. Every state-changing step is behind an
 * explicit confirm; installing the binary itself stays a user action with an
 * exact command and a re-check loop.
 */
export async function provisionPiperTts({ ctx, env = process.env, deps = {} }) {
  const ui = ctx.ui;
  const notify = (message, level = "info") => ui.notify(message, level);
  const detect = deps.detectTts ?? (() => detectTtsEnvironment({ env, findExec: deps.findExec }));
  const makePiperAdapter = deps.makePiperAdapter ?? ((options) => createPiperTtsAdapter({ ...options, env }));
  const download = deps.download ?? downloadFile;
  const home = deps.home ?? homedir();
  const mkdir = deps.mkdir ?? ((path) => mkdirSync(path, { recursive: true }));

  // 1. piper binary, with an install-hint-and-recheck loop.
  let detection = detect();
  while (!detection.piperBinary) {
    notify(`piper is not installed.\n${detection.installHint}`, "warning");
    const answer = await ui.select("piper not found", [
      "I installed it — check again",
      "Skip natural voice setup",
    ]);
    if (answer === undefined || answer.startsWith("Skip")) return undefined;
    detection = detect();
    if (detection.piperBinary) notify(`Found piper at ${detection.piperBinary}.`, "info");
  }

  // 2. Pick a voice: reuse what is on disk, or download (model + sidecar config).
  let modelPath;
  const reuseOptions = detection.voices.map((voice) => `${voice.file} (${voice.sizeMb} MB, ${voice.path})`);
  const downloadOptions = VOICE_CATALOG.map((voice) => `download ${voice.id} (${voice.sizeMb} MB — ${voice.note})`);
  const choice = await ui.select("Piper voice", [...reuseOptions, ...downloadOptions]);
  if (choice === undefined) return undefined;
  const reuseIndex = reuseOptions.indexOf(choice);
  if (reuseIndex >= 0) {
    modelPath = detection.voices[reuseIndex].path;
  } else {
    const voice = VOICE_CATALOG[downloadOptions.indexOf(choice)];
    const targetDir = join(env.XDG_DATA_HOME || join(home, ".local", "share"), "piper");
    modelPath = join(targetDir, voice.file);
    if (!existsSync(modelPath)) {
      const go = await ui.confirm("Download voice?", `Download ${voice.id} (${voice.sizeMb} MB) from huggingface.co to ${targetDir}?`);
      if (!go) return undefined;
      mkdir(targetDir);
      notify(`Downloading ${voice.id} (${voice.sizeMb} MB)…`, "info");
      try {
        await download(voice.url, modelPath, deps);
        await download(voice.configUrl, `${modelPath}.json`, deps);
      } catch (error) {
        notify(`Voice download failed: ${error.message}`, "error");
        return undefined;
      }
      notify("Voice downloaded.", "info");
    }
  }

  // 3. Verify with a real synthesis through the actual adapter.
  const probe = await makePiperAdapter({ modelPath }).probe({});
  if (!probe.ok) {
    notify(`Piper test synthesis failed: ${probe.detail}`, "error");
    return undefined;
  }
  notify(`Piper voice verified — ${probe.detail}.`, "info");
  return { modelPath };
}
