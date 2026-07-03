import { audioPayloadFromResponse, fetchProvider, providerError } from "./http-shared.mjs";

/**
 * Local TTS endpoint adapter — Phase-4 WebUI contract: JSON
 * `{text, voice?, format}` request; binary audio or JSON `{audioBase64}`
 * response. A Piper HTTP wrapper fits this shape.
 */
export function createLocalTtsAdapter({ url, voice = null, format = "wav", timeoutMs = 20000, fetchImpl = fetch } = {}) {
  if (!url) throw providerError("tts-not-configured", "Local TTS endpoint URL is not configured. Set PI_VOICE_TTS_URL or run /talk setup.");

  async function synthesize(text, { signal } = {}) {
    const startedAt = Date.now();
    const response = await fetchProvider(
      "local TTS",
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voice: voice || undefined, format }),
      },
      { timeoutMs, signal, fetchImpl },
    );
    const payload = await audioPayloadFromResponse("local TTS", response, format);
    return { ...payload, ms: Date.now() - startedAt };
  }

  async function probe({ signal } = {}) {
    const startedAt = Date.now();
    try {
      const { audio } = await synthesize("Pi voice check.", { signal });
      return { ok: true, detail: `local TTS synthesized ${audio.length} bytes in ${Date.now() - startedAt}ms` };
    } catch (error) {
      return { ok: false, detail: error?.message ?? String(error) };
    }
  }

  return { id: "local-endpoint", probe, synthesize };
}
