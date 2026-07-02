import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { findExecutable } from "../native-audio/exec-utils.mjs";
import { providerError } from "./http-shared.mjs";

export const PIPER_BINARY_NAMES = Object.freeze(["piper", "piper-tts"]);

export function findPiperBinary(env = process.env, findExec = findExecutable) {
  for (const name of PIPER_BINARY_NAMES) {
    const found = findExec(name, env);
    if (found) return found;
  }
  return undefined;
}

/** Read the sample rate from the voice's sidecar config (<model>.json). */
export function piperVoiceSampleRate(modelPath, { readFile = readFileSync } = {}) {
  try {
    const config = JSON.parse(readFile(`${modelPath}.json`, "utf8"));
    const rate = config?.audio?.sample_rate;
    return Number.isFinite(rate) ? rate : 22050;
  } catch {
    return 22050;
  }
}

/**
 * Piper exec TTS adapter: spawns the USER-INSTALLED piper binary per
 * utterance (never bundled — Piper is GPL; plan §5c item 7). Text goes to
 * stdin, raw s16le PCM comes from stdout at the voice's sample rate. No
 * server process is needed.
 *
 * The current Python piper (piper1-gpl) uses `--output-raw`; the legacy C++
 * binary uses `--output_raw`. We try the dash form first and retry once with
 * the underscore form.
 */
export function createPiperTtsAdapter({
  modelPath,
  binary,
  env = process.env,
  spawn = nodeSpawn,
  findExec = findExecutable,
  readFile = readFileSync,
  fileExists = existsSync,
} = {}) {
  if (!modelPath) throw providerError("tts-not-configured", "Piper TTS needs native.tts.modelPath (run /talk setup)");

  function resolveBinary() {
    return binary ?? findPiperBinary(env, findExec);
  }

  function runPiper(executable, rawFlag, text, signal) {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, ["--model", modelPath, rawFlag], { stdio: ["pipe", "pipe", "pipe"] });
      const chunks = [];
      let stderr = "";
      let settled = false;

      const onAbort = () => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(providerError("tts-cancelled", "piper synthesis cancelled"));
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      child.stdout.on("data", (chunk) => chunks.push(chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        reject(providerError("tts-unavailable", `piper failed to start: ${error.message}`));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        if (code !== 0) {
          const error = providerError("tts-failed", `piper exited with code ${code}: ${stderr.slice(0, 300)}`);
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve(Buffer.concat(chunks));
      });
      child.stdin.on("error", () => {});
      child.stdin.end(`${text}\n`);
    });
  }

  async function synthesize(text, { signal } = {}) {
    const executable = resolveBinary();
    if (!executable) throw providerError("tts-unavailable", "piper is not installed");
    const startedAt = Date.now();
    let audio;
    try {
      audio = await runPiper(executable, "--output-raw", text, signal);
    } catch (error) {
      if (error.code === "tts-failed" && /output[_-]raw|unrecogni[sz]ed|unknown/i.test(error.stderr ?? "")) {
        audio = await runPiper(executable, "--output_raw", text, signal);
      } else {
        throw error;
      }
    }
    if (!audio.length) throw providerError("tts-failed", "piper produced no audio");
    return { audio, format: "raw-s16le", sampleRateHz: piperVoiceSampleRate(modelPath, { readFile }), ms: Date.now() - startedAt };
  }

  async function probe({ signal } = {}) {
    if (!resolveBinary()) return { ok: false, detail: "piper not found on PATH" };
    if (!fileExists(modelPath)) return { ok: false, detail: `voice model missing: ${modelPath}` };
    const startedAt = Date.now();
    try {
      const { audio, sampleRateHz } = await synthesize("Pi voice check.", { signal });
      return { ok: true, detail: `piper synthesized ${audio.length} bytes at ${sampleRateHz} Hz in ${Date.now() - startedAt}ms` };
    } catch (error) {
      return { ok: false, detail: error?.message ?? String(error) };
    }
  }

  return { id: "piper", probe, synthesize };
}
