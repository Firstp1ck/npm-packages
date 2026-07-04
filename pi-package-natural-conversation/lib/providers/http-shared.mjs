import { combinedSignal } from "@firstpick/pi-utils/http";

export function providerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** Tolerant transcript extraction, byte-compatible with the Phase-4 WebUI contract. */
export function transcriptTextFromProviderJson(json) {
  return String(json?.text || json?.transcript || json?.data?.text || json?.result?.text || "").trim();
}

export async function parseTranscriptResponse(provider, response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    const json = await response.json();
    return transcriptTextFromProviderJson(json);
  }
  return (await response.text()).trim();
}

/** Accept binary audio or JSON `{audioBase64}` responses, Phase-4 compatible. */
export async function audioPayloadFromResponse(provider, response, preferredFormat = "wav") {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    const json = await response.json();
    const audioBase64 = String(json.audioBase64 || json.audio || json.data?.audioBase64 || "").trim();
    if (!audioBase64) throw providerError("tts-bad-response", `${provider} TTS provider returned JSON without audioBase64`);
    return { audio: Buffer.from(audioBase64, "base64"), format: json.format || preferredFormat };
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) throw providerError("tts-bad-response", `${provider} TTS provider returned empty audio`);
  return { audio, format: contentType.includes("wav") ? "wav" : preferredFormat };
}

export async function fetchProvider(providerLabel, url, init, { timeoutMs, signal, fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: combinedSignal(timeoutMs, signal) });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw providerError("provider-timeout", `${providerLabel} request aborted or timed out after ${timeoutMs}ms`);
    }
    throw providerError("provider-unreachable", `${providerLabel} request failed: ${error?.message ?? error}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw providerError("provider-http-error", `${providerLabel} returned HTTP ${response.status}: ${body.slice(0, 300) || response.statusText}`);
  }
  return response;
}
