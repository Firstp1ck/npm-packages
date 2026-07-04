// Voice listing and switching for /talk voice (and the WebUI voice dropdown,
// which drives the same command over RPC). Switching to a catalog voice that
// is not on disk downloads it (model + sidecar config) with user-visible
// progress, verifies it with a real test synthesis, persists voice.json, and
// live-applies the change to a running audio companion.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { VOICE_CATALOG, detectTtsEnvironment } from "./tts-provisioner.mjs";
import { downloadFile } from "./stt-provisioner.mjs";
import { createPiperTtsAdapter } from "./providers/tts-piper.mjs";
import { loadVoiceConfig, saveVoiceConfig } from "./voice-config.mjs";

export { VOICE_CATALOG };

function voiceIdFromFile(file) {
  return file.replace(/\.onnx$/, "");
}

/**
 * Merge the download catalog with voices found on disk. Returns
 * `{ voices, current, piperInstalled }` where each voice is
 * `{ id, file, sizeMb, note, downloaded, path, current }`.
 */
export function listPiperVoices({ env = process.env, home, deps = {} } = {}) {
  const detection = (deps.detectTts ?? detectTtsEnvironment)({ env, home: home ?? homedir(), findExec: deps.findExec });
  const { config } = (deps.loadConfig ?? (() => loadVoiceConfig({ env })))();
  const currentPath = config.native.tts.provider === "piper" ? config.native.tts.modelPath : null;

  const voices = VOICE_CATALOG.map((entry) => {
    const onDisk = detection.voices.find((voice) => voice.file === entry.file);
    return {
      id: entry.id,
      file: entry.file,
      sizeMb: entry.sizeMb,
      note: entry.note,
      downloaded: Boolean(onDisk),
      path: onDisk?.path ?? null,
      current: Boolean(currentPath && (onDisk?.path === currentPath || currentPath.endsWith(`/${entry.file}`))),
    };
  });
  for (const voice of detection.voices) {
    if (VOICE_CATALOG.some((entry) => entry.file === voice.file)) continue;
    voices.push({
      id: voiceIdFromFile(voice.file),
      file: voice.file,
      sizeMb: voice.sizeMb,
      note: "found on disk",
      downloaded: true,
      path: voice.path,
      current: voice.path === currentPath,
    });
  }
  return {
    voices,
    current: voices.find((voice) => voice.current)?.id ?? null,
    ttsProvider: config.native.tts.provider,
    piperInstalled: Boolean(detection.piperBinary),
  };
}

/**
 * Switch the Piper voice by catalog/on-disk id. Reports progress through
 * `onStatus(text)` (transient footer/status line) and `notify(message, level)`
 * (discrete user messages). Returns `{ ok, id, modelPath?, downloaded? }`.
 */
export async function switchPiperVoice(voiceId, { env = process.env, home, loop, controller, ctx, deps = {} } = {}) {
  const notify = deps.notify ?? ((message, level = "info") => ctx?.hasUI && ctx.ui?.notify?.(message, level));
  const onStatus = deps.onStatus ?? (() => {});
  const listing = listPiperVoices({ env, home, deps });

  const wanted = String(voiceId ?? "").trim();
  const voice = listing.voices.find((entry) => entry.id === wanted || entry.file === wanted || entry.id.toLowerCase() === wanted.toLowerCase());
  if (!voice) {
    notify(`Unknown voice '${wanted}'. Available: ${listing.voices.map((entry) => entry.id).join(", ")}`, "error");
    return { ok: false, id: wanted };
  }
  if (!listing.piperInstalled) {
    notify("piper is not installed; run /talk setup for the guided natural-voice setup first.", "error");
    return { ok: false, id: voice.id };
  }

  // Download when missing — catalog voices only; on-disk extras are always present.
  let modelPath = voice.path;
  let downloaded = false;
  if (!voice.downloaded) {
    const entry = VOICE_CATALOG.find((item) => item.id === voice.id);
    if (!entry) {
      notify(`Voice '${voice.id}' is not on disk and not in the download catalog.`, "error");
      return { ok: false, id: voice.id };
    }
    const targetDir = join(env.XDG_DATA_HOME || join(home ?? homedir(), ".local", "share"), "piper");
    modelPath = join(targetDir, entry.file);
    (deps.mkdir ?? ((path) => mkdirSync(path, { recursive: true })))(targetDir);
    notify(`Downloading voice ${entry.id} (${entry.sizeMb} MB)…`, "info");
    let lastPct = -1;
    const onProgress = ({ receivedBytes, totalBytes }) => {
      const pct = totalBytes > 0 ? Math.floor((receivedBytes / totalBytes) * 100) : 0;
      if (pct === lastPct) return;
      lastPct = pct;
      onStatus(`Voice: downloading ${entry.id} ${pct}%`);
    };
    const download = deps.download ?? downloadFile;
    try {
      await download(entry.url, modelPath, { ...deps, onProgress });
      onStatus(`Voice: downloading ${entry.id} config`);
      await download(entry.configUrl, `${modelPath}.json`, { ...deps });
      downloaded = true;
    } catch (error) {
      onStatus(undefined);
      notify(`Voice download failed: ${error.message}`, "error");
      return { ok: false, id: voice.id };
    }
  }

  // Verify with a real synthesis before persisting anything.
  onStatus(`Voice: testing ${voice.id}`);
  const makePiperAdapter = deps.makePiperAdapter ?? ((options) => createPiperTtsAdapter({ ...options, env }));
  const probe = await makePiperAdapter({ modelPath }).probe({});
  if (!probe.ok) {
    onStatus(undefined);
    notify(`Voice '${voice.id}' failed the test synthesis: ${probe.detail}`, "error");
    return { ok: false, id: voice.id };
  }

  // Persist and live-apply.
  const loadConfig = deps.loadConfig ?? (() => loadVoiceConfig({ env }));
  const save = deps.saveConfig ?? ((config) => saveVoiceConfig(config, { env }));
  const { config } = loadConfig();
  config.native.tts.provider = "piper";
  config.native.tts.modelPath = modelPath;
  save(config);
  loop?.applyTtsConfig?.({ provider: "piper", modelPath });

  onStatus(undefined);
  controller?.updateStatus?.(ctx);
  notify(`Voice switched to ${voice.id}${downloaded ? " (downloaded)" : ""} — ${probe.detail}.`, "info");
  return { ok: true, id: voice.id, modelPath, downloaded };
}

export function voiceListText(listing) {
  const lines = ["Piper voices (switch with /talk voice <id>):"];
  for (const voice of listing.voices) {
    const marker = voice.current ? "●" : voice.downloaded ? "○" : "↓";
    const state = voice.current ? "current" : voice.downloaded ? "downloaded" : `download ${voice.sizeMb} MB`;
    lines.push(`${marker} ${voice.id} — ${voice.note} (${state})`);
  }
  if (!listing.piperInstalled) lines.push("piper is not installed — run /talk setup first.");
  if (listing.ttsProvider !== "piper" && listing.current === null) lines.push(`Current TTS provider is ${listing.ttsProvider}; switching a voice selects piper.`);
  return lines.join("\n");
}
