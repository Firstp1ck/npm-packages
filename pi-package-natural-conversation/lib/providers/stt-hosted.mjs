import { encodeWav } from "../native-audio/wav.mjs";
import { fetchProvider, parseTranscriptResponse, providerError } from "./http-shared.mjs";
import { buildSttFormData } from "./stt-local-endpoint.mjs";

const HOSTED_STT = Object.freeze({
  groq: {
    url: "https://api.groq.com/openai/v1/audio/transcriptions",
    keyName: "GROQ_API_KEY",
    defaultModel: "whisper-large-v3-turbo",
  },
  openai: {
    url: "https://api.openai.com/v1/audio/transcriptions",
    keyName: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini-transcribe",
  },
});

/**
 * Hosted STT adapter (Groq / OpenAI), Phase-4-compatible request shape.
 * Construction requires the API key in the environment; consent gating is
 * enforced by the adapter factory and again by resolveRuntimeVoiceConfig —
 * this is never a silent fallback target.
 */
export function createHostedSttAdapter({ provider, env = process.env, model, language = "auto", timeoutMs = 30000, baseUrl, fetchImpl = fetch } = {}) {
  const spec = HOSTED_STT[provider];
  if (!spec) throw providerError("stt-unknown-provider", `Unknown hosted STT provider '${provider}'`);
  const apiKey = env[spec.keyName];
  if (!apiKey) throw providerError("stt-key-missing", `${spec.keyName} is required for the ${provider} STT provider`);
  const url = baseUrl || spec.url;
  const resolvedModel = model || spec.defaultModel;

  async function transcribe(wavBuffer, { signal } = {}) {
    const startedAt = Date.now();
    const form = buildSttFormData(wavBuffer, { language });
    form.set("model", resolvedModel);
    form.set("response_format", "json");
    const response = await fetchProvider(
      `${provider} STT`,
      url,
      { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: form },
      { timeoutMs, signal, fetchImpl },
    );
    const text = await parseTranscriptResponse(`${provider} STT`, response);
    return { text, ms: Date.now() - startedAt };
  }

  async function probe({ signal } = {}) {
    const silence = encodeWav(Buffer.alloc(16000, 0), { sampleRateHz: 16000 });
    const startedAt = Date.now();
    try {
      await transcribe(silence, { signal });
      return { ok: true, detail: `${provider} STT round-trip ok in ${Date.now() - startedAt}ms` };
    } catch (error) {
      return { ok: false, detail: error?.message ?? String(error) };
    }
  }

  return { id: provider, probe, transcribe };
}
