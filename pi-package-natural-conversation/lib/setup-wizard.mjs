import { findExecutable } from "./native-audio/exec-utils.mjs";
import { CAPTURE_TOOLS } from "./native-audio/capture.mjs";
import { PLAYBACK_TOOLS } from "./native-audio/playback.mjs";
import {
  defaultVoiceConfig,
  loadVoiceConfig,
  saveVoiceConfig,
  resolveRuntimeVoiceConfig,
  isLoopbackUrl,
  safeEndpointLabel,
} from "./voice-config.mjs";
import { createLocalSttAdapter } from "./providers/stt-local-endpoint.mjs";
import { createLocalTtsAdapter } from "./providers/tts-local-endpoint.mjs";
import { createEspeakTtsAdapter } from "./providers/tts-espeak.mjs";
import { provisionLocalStt } from "./stt-provisioner.mjs";
import { provisionPiperTts } from "./tts-provisioner.mjs";

const DEFAULT_STT_URL = "http://127.0.0.1:8178/inference";
const DEFAULT_TTS_URL = "http://127.0.0.1:8179/speech";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Interactive `/talk setup` wizard (Phase 5b). Built on ctx.ui
 * select/confirm/input so it works in both TUI and RPC modes; degrades to a
 * text notice when dialogs are unavailable. Writes voice.json atomically with
 * mode 0600 only after the explicit consent summary. No secrets are ever
 * written — API keys stay environment-only.
 */
export async function runSetupWizard({ pi, controller, loop, ctx, env = process.env, deps = {} }) {
  const findExec = deps.findExec ?? findExecutable;
  const load = deps.loadConfig ?? (() => loadVoiceConfig({ env }));
  const save = deps.saveConfig ?? ((config) => saveVoiceConfig(config, { env }));
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const makeSttAdapter = deps.makeSttAdapter ?? createLocalSttAdapter;
  const makeTtsAdapter = deps.makeTtsAdapter ?? createLocalTtsAdapter;
  const makeEspeakAdapter = deps.makeEspeakAdapter ?? (() => createEspeakTtsAdapter({ env }));
  const provisionStt = deps.provisionStt ?? provisionLocalStt;
  const provisionTts = deps.provisionTts ?? provisionPiperTts;

  const ui = ctx?.ui;
  if (!ctx?.hasUI || typeof ui?.select !== "function" || typeof ui?.confirm !== "function" || typeof ui?.input !== "function") {
    ui?.notify?.(
      [
        "Interactive setup needs dialog support. Manual configuration:",
        "1. Write ~/.pi/agent/voice.json (see the package README for the schema).",
        "2. Set PI_VOICE_STT_URL (e.g. a local whisper-server) and optionally PI_VOICE_TTS_URL.",
        "3. Set native.enabled=true and consent.nativeAudioAcceptedAt to an ISO timestamp.",
        "4. Start with /talk on, then /talk audio on.",
      ].join("\n"),
      "info",
    );
    return { completed: false, reason: "no-dialog-ui" };
  }

  const notify = (message, level = "info") => ui.notify(message, level);
  const cancelled = () => {
    notify("Setup cancelled; nothing was written.", "info");
    return { completed: false, reason: "cancelled" };
  };

  // Step 0: native audio needs safe mode (no microphone outside safe mode).
  if (!controller.isEnabled()) {
    const enable = await ui.confirm(
      "Enable conversation safe mode?",
      "Native audio setup tests the microphone, which is only allowed inside conversation safe mode (thinking off, read-only tools). Enable it now?",
    );
    if (!enable) return cancelled();
    controller.enable(ctx);
  }

  const { config: existing } = load();
  const config = { ...defaultVoiceConfig(), ...structuredClone(existing) };

  // Step 1: environment probe.
  const captureFound = CAPTURE_TOOLS.map((entry) => entry.tool).filter((tool) => findExec(tool, env));
  const playbackFound = PLAYBACK_TOOLS.map((entry) => entry.tool).filter((tool) => findExec(tool, env));
  const espeakFound = Boolean(findExec("espeak-ng", env));
  const packageManager = ["pacman", "brew"].find((tool) => findExec(tool, env));
  const espeakHint = packageManager === "pacman" ? " — install: sudo pacman -S espeak-ng" : packageManager === "brew" ? " — install: brew install espeak-ng" : "";
  notify(
    [
      "Environment probe:",
      `capture tools: ${captureFound.join(", ") || "none found (install pipewire-utils, pulseaudio-utils, alsa-utils, or ffmpeg)"}`,
      `playback tools: ${playbackFound.join(", ") || "none found"}`,
      `espeak-ng (TTS fallback): ${espeakFound ? "found" : `not found${espeakHint}`}`,
    ].join("\n"),
    captureFound.length && playbackFound.length ? "info" : "warning",
  );
  if (captureFound.length === 0 || playbackFound.length === 0) {
    const proceed = await ui.confirm("Continue anyway?", "No usable capture or playback tool was found. You can still write a config, but audio will not work until one is installed.");
    if (!proceed) return cancelled();
  }

  // Step 2: STT provider. First look for an endpoint that is already
  // answering; otherwise offer the guided system-level provisioning flow
  // (detects whisper-server, reuses downloaded models, installs a user
  // systemd service after explicit confirms).
  let sttConfigured = false;
  const candidateUrl = env.PI_VOICE_STT_URL || config.native.stt.url || DEFAULT_STT_URL;
  let candidateOk = false;
  try {
    candidateOk = (await makeSttAdapter({ url: candidateUrl, timeoutMs: 4000 }).probe({})).ok;
  } catch {
    candidateOk = false;
  }
  if (candidateOk) {
    const useIt = await ui.confirm("Use running STT endpoint?", `A speech-to-text endpoint is already answering at ${safeEndpointLabel(candidateUrl)}. Use it?`);
    if (useIt) {
      config.native.stt.provider = "local-endpoint";
      config.native.stt.url = candidateUrl;
      sttConfigured = true;
    }
  }
  if (!sttConfigured) {
    const sttChoice = await ui.select("Speech-to-text provider", [
      "guided local whisper setup (recommended, private)",
      "custom URL",
      "skip for now",
    ]);
    if (sttChoice === undefined) return cancelled();
    if (sttChoice.startsWith("guided")) {
      const provisioned = await provisionStt({ ctx, env, deps: { ...deps, makeSttAdapter } });
      if (provisioned) {
        config.native.stt.provider = "local-endpoint";
        config.native.stt.url = provisioned.url;
        sttConfigured = true;
      } else {
        notify("Speech-to-text is not configured yet; re-run /talk setup anytime.", "warning");
      }
    } else if (sttChoice === "custom URL") {
      const url = await ui.input("STT endpoint URL", candidateUrl);
      if (url === undefined) return cancelled();
      config.native.stt.provider = "local-endpoint";
      config.native.stt.url = url.trim() || candidateUrl;
      try {
        const probe = await makeSttAdapter({ url: config.native.stt.url, timeoutMs: 5000 }).probe({});
        notify(`STT probe: ${probe.detail}`, probe.ok ? "info" : "warning");
      } catch (error) {
        notify(`STT probe failed: ${error.message}`, "warning");
      }
    }
  }

  // Step 3: TTS provider — use an endpoint that already answers, otherwise
  // offer guided natural-voice (Piper) provisioning; espeak-ng stays the
  // works-now floor and the automatic runtime fallback.
  let ttsConfigured = false;
  const ttsCandidateUrl = env.PI_VOICE_TTS_URL || config.native.tts.url || DEFAULT_TTS_URL;
  let ttsCandidateOk = false;
  try {
    ttsCandidateOk = (await makeTtsAdapter({ url: ttsCandidateUrl, timeoutMs: 4000 }).probe({})).ok;
  } catch {
    ttsCandidateOk = false;
  }
  if (ttsCandidateOk) {
    const useIt = await ui.confirm("Use running TTS endpoint?", `A text-to-speech endpoint is already answering at ${safeEndpointLabel(ttsCandidateUrl)}. Use it?`);
    if (useIt) {
      config.native.tts.provider = "local-endpoint";
      config.native.tts.url = ttsCandidateUrl;
      config.native.tts.fallback = espeakFound ? "espeak-ng" : "none";
      ttsConfigured = true;
    }
  }
  if (!ttsConfigured) {
    const ttsOptions = [
      "guided natural voice setup (Piper, local)",
      ...(espeakFound ? ["espeak-ng (works now, robotic)"] : []),
      "custom URL",
    ];
    const ttsChoice = await ui.select("Text-to-speech provider", ttsOptions);
    if (ttsChoice === undefined) return cancelled();
    if (ttsChoice.startsWith("guided")) {
      const provisioned = await provisionTts({ ctx, env, deps });
      if (provisioned) {
        config.native.tts.provider = "piper";
        config.native.tts.modelPath = provisioned.modelPath;
        config.native.tts.url = null;
        config.native.tts.fallback = espeakFound ? "espeak-ng" : "none";
      } else if (espeakFound) {
        notify("Falling back to espeak-ng for now — re-run /talk setup anytime for a natural voice.", "warning");
        config.native.tts.provider = "espeak-ng";
        config.native.tts.url = null;
      }
    } else if (ttsChoice.startsWith("espeak-ng")) {
      config.native.tts.provider = "espeak-ng";
      config.native.tts.url = null;
    } else {
      const url = await ui.input("TTS endpoint URL", ttsCandidateUrl);
      if (url === undefined) return cancelled();
      config.native.tts.provider = "local-endpoint";
      config.native.tts.url = url.trim() || ttsCandidateUrl;
      config.native.tts.fallback = espeakFound ? "espeak-ng" : "none";
      try {
        const probe = await makeTtsAdapter({ url: config.native.tts.url, timeoutMs: 5000 }).probe({});
        notify(`TTS probe: ${probe.detail}`, probe.ok ? "info" : "warning");
      } catch (error) {
        notify(`TTS probe failed: ${error.message}`, "warning");
      }
    }
  }
  if (config.native.tts.provider === "espeak-ng") {
    const probe = await makeEspeakAdapter().probe({});
    notify(`espeak-ng probe: ${probe.detail}`, probe.ok ? "info" : "warning");
  }

  // Step 4: microphone test + calibration.
  const micTest = await ui.confirm("Microphone test", "Record about one second from the default microphone to measure the noise floor and seed the voice threshold?");
  let calibrated = false;
  if (micTest) {
    const draft = resolveRuntimeVoiceConfig(config, env);
    const results = await loop.runProbes(ctx, ["mic"], { configOverride: { native: draft.native, consent: config.consent } });
    const mic = results?.[0];
    if (mic?.ok) {
      notify(`Microphone: ${mic.detail}`, "info");
      if (Number.isFinite(mic.noiseFloorDb)) {
        config.native.vad.thresholdDb = clamp(Math.round(mic.noiseFloorDb + 12), -55, -25);
        calibrated = true;
        notify(`Voice threshold calibrated to ${config.native.vad.thresholdDb} dBFS (noise floor + 12 dB).`, "info");
      }
    } else {
      notify(`Microphone test failed: ${mic?.detail ?? "no result"}`, "warning");
    }
  }

  // Step 5: speaker test.
  const speakerTest = await ui.confirm("Speaker test", "Play a short 440 Hz test tone through the default output?");
  if (speakerTest) {
    const draft = resolveRuntimeVoiceConfig(config, env);
    const results = await loop.runProbes(ctx, ["speaker"], { configOverride: { native: draft.native, consent: config.consent } });
    const speaker = results?.[0];
    if (speaker?.ok) {
      const heard = await ui.confirm("Did you hear the tone?", "A 440 Hz tone should have played through your speakers or headphones.");
      if (!heard) notify("Check your output device; /talk doctor speaker re-runs this test.", "warning");
    } else {
      notify(`Speaker test failed: ${speaker?.detail ?? "no result"}`, "warning");
    }
  }

  // Step 6: options.
  config.native.headphones = await ui.confirm("Headphones?", "Are you using headphones? (Enables voice barge-in while the assistant is speaking, since headphones remove acoustic echo.)");
  config.native.autoStartWithTalkOn = await ui.confirm("Auto-start?", "Start native audio automatically whenever /talk on enables conversation mode?");
  const silenceAnswer = await ui.input("Silence event timeout in seconds (0 disables)", String(Math.round((config.native.silence.timeoutMs ?? 8000) / 1000)));
  if (silenceAnswer !== undefined && silenceAnswer.trim() !== "") {
    const seconds = Number(silenceAnswer.trim());
    if (Number.isFinite(seconds) && seconds >= 0) {
      config.native.silence.enabled = seconds > 0;
      if (seconds > 0) config.native.silence.timeoutMs = clamp(Math.round(seconds * 1000), 1000, 120000);
    }
  }

  // Step 6b: non-loopback endpoints need an explicit extra consent.
  const remoteHosts = [config.native.stt.url, config.native.tts.url]
    .filter((url) => url && !isLoopbackUrl(url))
    .map((url) => safeEndpointLabel(url));
  if (remoteHosts.length > 0) {
    const allow = await ui.confirm(
      "Allow remote endpoints?",
      `These endpoints are NOT loopback: ${remoteHosts.join(", ")}. Your voice audio (and spoken assistant answers, which can contain file contents) will be sent to them. Allow?`,
    );
    if (!allow) return cancelled();
    config.native.allowRemoteProviders = true;
  }

  // Step 7: consent summary — the only step that writes anything.
  const summary = [
    "While native audio is on, the microphone is captured continuously inside conversation safe mode.",
    `Speech is transcribed by: ${config.native.stt.url ? safeEndpointLabel(config.native.stt.url) : config.native.stt.provider}.`,
    `Answers are spoken by: ${
      config.native.tts.provider === "espeak-ng"
        ? "espeak-ng (local)"
        : config.native.tts.provider === "piper"
          ? `piper (local, ${config.native.tts.modelPath ?? "no voice"})`
          : config.native.tts.url
            ? safeEndpointLabel(config.native.tts.url)
            : config.native.tts.provider
    }.`,
    "Raw audio is processed in memory only and never persisted.",
    "Stop anytime: /talk pause, /talk audio off, or /talk off.",
    calibrated ? "Microphone threshold was calibrated." : "Microphone threshold uses adaptive defaults.",
  ].join("\n");
  const accept = await ui.confirm("Enable native audio?", summary);
  if (!accept) return cancelled();

  config.version = 1;
  config.native.enabled = true;
  config.consent = { ...config.consent, nativeAudioAcceptedAt: nowIso() };
  const saved = save(config);
  notify(
    [
      `Saved ${saved.path} (mode 0600).`,
      "Start with /talk on" + (config.native.autoStartWithTalkOn ? " (audio starts automatically)" : ", then /talk audio on") + ".",
      "Diagnostics: /talk doctor. Status: /talk status.",
    ].join("\n"),
    "info",
  );
  controller.updateStatus(ctx);
  return { completed: true, config: saved.config, path: saved.path };
}
