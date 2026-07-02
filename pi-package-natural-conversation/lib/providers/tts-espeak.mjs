import { spawn as nodeSpawn } from "node:child_process";
import { findExecutable } from "../native-audio/exec-utils.mjs";
import { providerError } from "./http-shared.mjs";

const BASE_WPM = 170;

export function buildEspeakArgs(text, { voice = null, rate = 1.0 } = {}) {
  const wpm = Math.round(BASE_WPM * (Number.isFinite(rate) && rate > 0 ? rate : 1.0));
  return ["--stdout", "-s", String(wpm), ...(voice ? ["-v", String(voice)] : []), "--", String(text)];
}

/**
 * espeak-ng TTS floor: zero servers, WAV on stdout. Honestly robotic, but
 * `/talk audio on` produces sound with nothing installed beyond ALSA/PipeWire.
 */
export function createEspeakTtsAdapter({ voice = null, rate = 1.0, env = process.env, spawn = nodeSpawn, findExec = findExecutable } = {}) {
  function executable() {
    return findExec("espeak-ng", env);
  }

  function synthesize(text, { signal } = {}) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const binary = executable();
      if (!binary) {
        reject(providerError("tts-unavailable", "espeak-ng is not installed"));
        return;
      }
      const child = spawn(binary, buildEspeakArgs(text, { voice, rate }), { stdio: ["ignore", "pipe", "pipe"] });
      const chunks = [];
      let stderr = "";
      let settled = false;

      const onAbort = () => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(providerError("tts-cancelled", "espeak-ng synthesis cancelled"));
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      child.stdout.on("data", (chunk) => chunks.push(chunk));
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        reject(providerError("tts-unavailable", `espeak-ng failed to start: ${error.message}`));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        if (code !== 0) {
          reject(providerError("tts-failed", `espeak-ng exited with code ${code}: ${stderr.slice(0, 300)}`));
          return;
        }
        resolve({ audio: Buffer.concat(chunks), format: "wav", ms: Date.now() - startedAt });
      });
    });
  }

  async function probe() {
    const binary = executable();
    if (!binary) return { ok: false, detail: "espeak-ng not found on PATH" };
    return { ok: true, detail: `espeak-ng at ${binary}` };
  }

  return { id: "espeak-ng", probe, synthesize };
}
