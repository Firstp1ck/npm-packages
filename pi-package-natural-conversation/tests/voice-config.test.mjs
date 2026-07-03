import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_ACK_PHRASES,
  defaultVoiceConfig,
  validateVoiceConfig,
  loadVoiceConfig,
  saveVoiceConfig,
  resolveRuntimeVoiceConfig,
  isLoopbackUrl,
  safeEndpointLabel,
  hasNativeConsent,
} from "../lib/voice-config.mjs";

test("default config matches the plan §7 draft schema", () => {
  const config = defaultVoiceConfig();
  assert.equal(config.version, 1);
  assert.equal(config.native.enabled, false);
  assert.equal(config.native.autoStartWithTalkOn, true);
  assert.deepEqual(config.native.capture, { tool: "auto", command: null, device: null, sampleRateHz: 16000 });
  assert.equal(config.native.vad.startDb, 9);
  assert.equal(config.native.vad.hangoverMs, 800);
  assert.equal(config.native.vad.minSpeechMs, 300);
  assert.equal(config.native.vad.maxUtteranceMs, 30000);
  assert.equal(config.native.vad.preRollMs, 300);
  assert.equal(config.native.stt.provider, "local-endpoint");
  assert.equal(config.native.tts.fallback, "espeak-ng");
  assert.equal(config.native.silence.timeoutMs, 8000);
  assert.equal(config.native.allowRemoteProviders, false);
  assert.deepEqual(config.consent, { nativeAudioAcceptedAt: null, hostedSttAcceptedAt: null, hostedTtsAcceptedAt: null });
  // naturalness features (plan Phases 2/3/5)
  assert.equal(config.style.preset, "natural");
  assert.deepEqual(config.native.acknowledgement, { enabled: false, delayMs: 700, phrases: [...DEFAULT_ACK_PHRASES] });
  assert.equal(config.native.bargeIn.cancelOnSpeechStart, true);
  assert.equal(config.native.bargeIn.confirmMs, 250);
  assert.equal(config.native.bargeIn.marginDb, 5);
  assert.deepEqual(config.tools.allow, []);
});

test("style, acknowledgement, and barge-in cancel values are validated", () => {
  const { config, warnings } = validateVoiceConfig({
    version: 1,
    style: { preset: "shakespearean" },
    tools: { allow: [42, "ok"] },
    native: {
      acknowledgement: { enabled: true, delayMs: 50, phrases: [] },
      bargeIn: { cancelOnSpeechStart: "yes" },
    },
  });
  assert.equal(config.style.preset, "natural");
  assert.deepEqual(config.tools.allow, [], "non-string tool names invalidate the list");
  assert.ok(warnings.some((w) => w.includes("tools.allow")));
  const valid = validateVoiceConfig({ version: 1, tools: { allow: ["brave_search"] } });
  assert.deepEqual(valid.config.tools.allow, ["brave_search"]);
  assert.equal(config.native.acknowledgement.enabled, true);
  assert.equal(config.native.acknowledgement.delayMs, 700, "out-of-range delay falls back");
  assert.deepEqual(config.native.acknowledgement.phrases, [...DEFAULT_ACK_PHRASES], "empty phrase list falls back");
  assert.equal(config.native.bargeIn.cancelOnSpeechStart, true);
  assert.ok(warnings.some((w) => w.includes("style.preset")));
  assert.ok(warnings.some((w) => w.includes("acknowledgement.delayMs")));
  assert.ok(warnings.some((w) => w.includes("acknowledgement.phrases")));
});

test("invalid values fall back to defaults with warnings; unknown keys are dropped", () => {
  const { config, warnings } = validateVoiceConfig({
    version: 1,
    native: {
      enabled: "yes",
      vad: { hangoverMs: -5, startDb: 12 },
      stt: { provider: "telepathy" },
      apiKey: "sk-should-never-persist",
    },
  });
  assert.equal(config.native.enabled, false);
  assert.equal(config.native.vad.hangoverMs, 800);
  assert.equal(config.native.vad.startDb, 12);
  assert.equal(config.native.stt.provider, "local-endpoint");
  assert.equal("apiKey" in config.native, false);
  assert.ok(warnings.some((w) => w.includes("native.enabled")));
  assert.ok(warnings.some((w) => w.includes("apiKey")));
});

test("unknown config version refuses the file and falls back to defaults", () => {
  const { config, warnings } = validateVoiceConfig({ version: 99, native: { enabled: true } });
  assert.equal(config.native.enabled, false);
  assert.ok(warnings.some((w) => w.includes("version 99")));
});

test("load falls back cleanly on missing or corrupt files", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-voice-test-"));
  const missing = loadVoiceConfig({ path: join(dir, "nope.json") });
  assert.equal(missing.exists, false);
  assert.equal(missing.config.native.enabled, false);

  const corruptPath = join(dir, "voice.json");
  writeFileSync(corruptPath, "{ not json");
  const corrupt = loadVoiceConfig({ path: corruptPath });
  assert.equal(corrupt.exists, true);
  assert.equal(corrupt.warnings.length, 1);
  assert.equal(corrupt.config.native.enabled, false);
});

test("save is atomic, mode 0600, schema-sanitized, and never persists secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-voice-test-"));
  const path = join(dir, "voice.json");
  const config = defaultVoiceConfig();
  config.native.enabled = true;
  config.consent.nativeAudioAcceptedAt = "2026-07-02T00:00:00.000Z";
  config.native.stt.apiKey = "sk-secret";
  config.GROQ_API_KEY = "gsk-secret";

  saveVoiceConfig(config, { path });

  const written = readFileSync(path, "utf8");
  assert.ok(!written.includes("secret"), "secrets must never be written to voice.json");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const reloaded = loadVoiceConfig({ path });
  assert.equal(reloaded.config.native.enabled, true);
  assert.equal(hasNativeConsent(reloaded.config), true);
});

test("env URLs take precedence over voice.json values", () => {
  const config = defaultVoiceConfig();
  config.native.stt.url = "http://127.0.0.1:9999/other";
  const { native, errors } = resolveRuntimeVoiceConfig(config, { PI_VOICE_STT_URL: "http://127.0.0.1:8178/inference", PI_VOICE_TTS_URL: "http://localhost:8179/speech" });
  assert.equal(errors.length, 0);
  assert.equal(native.stt.url, "http://127.0.0.1:8178/inference");
  assert.equal(native.tts.url, "http://localhost:8179/speech");
});

test("non-loopback endpoints require allowRemoteProviders", () => {
  const config = defaultVoiceConfig();
  config.native.stt.url = "http://stt.example.com/inference";
  const denied = resolveRuntimeVoiceConfig(config, {});
  assert.equal(denied.errors.length, 1);
  assert.match(denied.errors[0], /not loopback/);

  config.native.allowRemoteProviders = true;
  const allowed = resolveRuntimeVoiceConfig(config, {});
  assert.equal(allowed.errors.length, 0);
});

test("hosted providers are gated on consent, allowRemoteProviders, and env keys", () => {
  const config = defaultVoiceConfig();
  config.native.stt.provider = "groq";
  const denied = resolveRuntimeVoiceConfig(config, {});
  assert.equal(denied.errors.length, 3); // allowRemote + consent + key

  config.native.allowRemoteProviders = true;
  config.consent.hostedSttAcceptedAt = "2026-07-02T00:00:00.000Z";
  const withConsent = resolveRuntimeVoiceConfig(config, { GROQ_API_KEY: "gsk-test" });
  assert.equal(withConsent.errors.length, 0);
});

test("loopback detection and sanitized endpoint labels", () => {
  assert.equal(isLoopbackUrl("http://127.0.0.1:8178/inference"), true);
  assert.equal(isLoopbackUrl("http://localhost:8179/x"), true);
  assert.equal(isLoopbackUrl("http://[::1]:8080/x"), true);
  assert.equal(isLoopbackUrl("http://stt.example.com/x"), false);
  assert.equal(isLoopbackUrl("not a url"), false);
  assert.equal(safeEndpointLabel("http://127.0.0.1:8178/secret/path?token=abc"), "http://127.0.0.1:8178");
});
