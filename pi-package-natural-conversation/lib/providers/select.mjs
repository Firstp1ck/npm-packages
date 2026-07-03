import { providerError } from "./http-shared.mjs";
import { createLocalSttAdapter } from "./stt-local-endpoint.mjs";
import { createHostedSttAdapter } from "./stt-hosted.mjs";
import { createLocalTtsAdapter } from "./tts-local-endpoint.mjs";
import { createEspeakTtsAdapter } from "./tts-espeak.mjs";
import { createOpenAiTtsAdapter } from "./tts-openai.mjs";
import { createPiperTtsAdapter } from "./tts-piper.mjs";

function requireHostedConsent(kind, provider, { native, consent }) {
  const consentKey = kind === "stt" ? "hostedSttAcceptedAt" : "hostedTtsAcceptedAt";
  if (!native?.allowRemoteProviders || !consent?.[consentKey]) {
    throw providerError(
      "consent-required",
      `Hosted ${kind.toUpperCase()} provider '${provider}' requires allowRemoteProviders and recorded hosted consent (run /talk setup). There is no automatic local-to-hosted fallback.`,
    );
  }
}

export function createSttAdapter({ native, consent }, { env = process.env, fetchImpl = fetch } = {}) {
  const stt = native.stt;
  if (stt.provider === "local-endpoint") {
    return createLocalSttAdapter({ url: stt.url, language: stt.language, timeoutMs: stt.timeoutMs, fetchImpl });
  }
  requireHostedConsent("stt", stt.provider, { native, consent });
  return createHostedSttAdapter({ provider: stt.provider, env, language: stt.language, timeoutMs: stt.timeoutMs, fetchImpl });
}

/**
 * Build the ordered TTS degradation chain: configured provider first, then
 * espeak-ng when configured as fallback. Degradation never crosses into
 * hosted providers.
 */
export function createTtsChain({ native, consent }, { env = process.env, fetchImpl = fetch, spawn, findExec } = {}) {
  const tts = native.tts;
  const chain = [];

  if (tts.provider === "local-endpoint") {
    chain.push(createLocalTtsAdapter({ url: tts.url, voice: tts.voice, timeoutMs: tts.timeoutMs, fetchImpl }));
  } else if (tts.provider === "piper") {
    chain.push(
      createPiperTtsAdapter({
        modelPath: tts.modelPath,
        keepWarm: tts.keepWarm !== false,
        timeoutMs: tts.timeoutMs,
        env,
        spawn,
        findExec,
      }),
    );
  } else if (tts.provider === "openai") {
    requireHostedConsent("tts", tts.provider, { native, consent });
    chain.push(createOpenAiTtsAdapter({ env, voice: tts.voice, timeoutMs: tts.timeoutMs, fetchImpl }));
  } else if (tts.provider === "espeak-ng") {
    chain.push(createEspeakTtsAdapter({ voice: tts.voice, rate: tts.rate, env, spawn, findExec }));
  }

  if (tts.provider !== "espeak-ng" && tts.fallback === "espeak-ng") {
    chain.push(createEspeakTtsAdapter({ voice: null, rate: tts.rate, env, spawn, findExec }));
  }
  if (chain.length === 0) throw providerError("tts-not-configured", "No TTS provider is configured");
  return chain;
}
