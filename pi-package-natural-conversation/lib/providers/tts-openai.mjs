import { audioPayloadFromResponse, fetchProvider, providerError } from "./http-shared.mjs";

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";

/** Hosted OpenAI TTS adapter, Phase-4-compatible request shape. */
export function createOpenAiTtsAdapter({ env = process.env, model, voice, format = "wav", timeoutMs = 20000, baseUrl, fetchImpl = fetch } = {}) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw providerError("tts-key-missing", "OPENAI_API_KEY is required for the openai TTS provider");
  const url = baseUrl || OPENAI_TTS_URL;

  async function synthesize(text, { signal } = {}) {
    const startedAt = Date.now();
    const response = await fetchProvider(
      "openai TTS",
      url,
      {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: model || "gpt-4o-mini-tts",
          voice: voice || "alloy",
          input: text,
          response_format: format,
        }),
      },
      { timeoutMs, signal, fetchImpl },
    );
    const payload = await audioPayloadFromResponse("openai TTS", response, format);
    return { ...payload, ms: Date.now() - startedAt };
  }

  async function probe({ signal } = {}) {
    const startedAt = Date.now();
    try {
      const { audio } = await synthesize("Pi voice check.", { signal });
      return { ok: true, detail: `openai TTS synthesized ${audio.length} bytes in ${Date.now() - startedAt}ms` };
    } catch (error) {
      return { ok: false, detail: error?.message ?? String(error) };
    }
  }

  return { id: "openai", probe, synthesize };
}
