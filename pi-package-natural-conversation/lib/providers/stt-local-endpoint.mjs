import { encodeWav } from "../native-audio/wav.mjs";
import { fetchProvider, parseTranscriptResponse, providerError } from "./http-shared.mjs";

export function buildSttFormData(wavBuffer, { language } = {}) {
  const form = new FormData();
  form.set("file", new Blob([wavBuffer], { type: "audio/wav" }), "speech.wav");
  if (language && language !== "auto") form.set("language", String(language));
  return form;
}

/**
 * Local STT endpoint adapter — Phase-4 WebUI contract: multipart with a
 * `file` field, tolerant `{text|transcript|data.text|result.text}` or plain
 * text response. whisper.cpp's `whisper-server /inference` fits this shape.
 */
export function createLocalSttAdapter({ url, language = "auto", timeoutMs = 30000, fetchImpl = fetch } = {}) {
  if (!url) throw providerError("stt-not-configured", "Local STT endpoint URL is not configured. Set PI_VOICE_STT_URL or run /talk setup.");

  async function transcribe(wavBuffer, { signal } = {}) {
    const startedAt = Date.now();
    const response = await fetchProvider("local STT", url, { method: "POST", body: buildSttFormData(wavBuffer, { language }) }, { timeoutMs, signal, fetchImpl });
    const text = await parseTranscriptResponse("local STT", response);
    return { text, ms: Date.now() - startedAt };
  }

  async function probe({ signal } = {}) {
    const silence = encodeWav(Buffer.alloc(16000, 0), { sampleRateHz: 16000 }); // 0.5 s of silence
    const startedAt = Date.now();
    try {
      await transcribe(silence, { signal });
      return { ok: true, detail: `local STT round-trip ok in ${Date.now() - startedAt}ms` };
    } catch (error) {
      return { ok: false, detail: error?.message ?? String(error) };
    }
  }

  return { id: "local-endpoint", probe, transcribe };
}
