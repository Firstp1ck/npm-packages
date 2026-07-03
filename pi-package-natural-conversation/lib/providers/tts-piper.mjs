import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { findExecutable } from "../native-audio/exec-utils.mjs";
import { voiceRuntimeDir } from "../native-audio/pidfiles.mjs";
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
 *
 * With `keepWarm`, one piper process stays alive for the whole session with
 * the model loaded (`--output-dir` mode, one WAV per stdin line): warm
 * synthesis is ~100 ms instead of ~800 ms per sentence, because the ~700 ms
 * model load happens once. WAVs land in a 0700 dir under XDG_RUNTIME_DIR
 * (tmpfs) and are unlinked the moment they are read; any warm-path failure
 * falls back to the classic exec-per-utterance path.
 */
export function createPiperTtsAdapter({
  modelPath,
  binary,
  keepWarm = false,
  timeoutMs = 15000,
  runtimeDir,
  env = process.env,
  spawn = nodeSpawn,
  findExec = findExecutable,
  readFile = readFileSync,
  fileExists = existsSync,
} = {}) {
  if (!modelPath) throw providerError("tts-not-configured", "Piper TTS needs native.tts.modelPath (run /talk setup)");

  const warmDir = runtimeDir ?? join(voiceRuntimeDir(env), `piper-${process.pid}`);
  const persistent = { child: null, pending: [], stderrBuf: "" };

  function resolveBinary() {
    return binary ?? findPiperBinary(env, findExec);
  }

  function failAllPending(message) {
    for (const request of persistent.pending.splice(0)) {
      if (!request.settled) {
        request.settled = true;
        clearTimeout(request.timer);
        request.reject(providerError("tts-failed", message));
      }
    }
  }

  function settleNextPending(reportedPath) {
    const request = persistent.pending.shift();
    const wavPath = isAbsolute(reportedPath) ? reportedPath : join(warmDir, reportedPath.split("/").pop());
    let audio = null;
    try {
      audio = readFile(wavPath);
    } catch {
      // fall through: request (if any) is rejected below
    }
    try {
      unlinkSync(wavPath);
    } catch {
      // best effort; the dir is tmpfs and removed on dispose
    }
    if (!request || request.settled) return;
    request.settled = true;
    clearTimeout(request.timer);
    if (!audio || audio.length === 0) {
      request.reject(providerError("tts-failed", "piper wrote no audio"));
      return;
    }
    request.resolve({
      audio,
      format: "wav",
      sampleRateHz: piperVoiceSampleRate(modelPath, { readFile }),
      ms: Date.now() - request.startedAt,
    });
  }

  function ensureWarm() {
    if (persistent.child && persistent.child.exitCode === null) return persistent.child;
    const executable = resolveBinary();
    if (!executable) return null;
    try {
      mkdirSync(warmDir, { recursive: true, mode: 0o700 });
    } catch {
      return null;
    }
    let child;
    try {
      child = spawn(executable, ["--model", modelPath, "--output-dir", warmDir], { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      return null;
    }
    persistent.child = child;
    persistent.stderrBuf = "";
    child.stdin.on("error", () => {});
    child.stdout.on("data", () => {});
    child.stderr.on("data", (chunk) => {
      persistent.stderrBuf += String(chunk);
      let newline;
      while ((newline = persistent.stderrBuf.indexOf("\n")) !== -1) {
        const line = persistent.stderrBuf.slice(0, newline);
        persistent.stderrBuf = persistent.stderrBuf.slice(newline + 1);
        const wrote = /Wrote (.+\.wav)\s*$/.exec(line);
        if (wrote) settleNextPending(wrote[1]);
      }
    });
    child.on("error", () => {
      if (persistent.child === child) persistent.child = null;
      failAllPending("piper warm process failed to start");
    });
    child.on("close", () => {
      if (persistent.child === child) persistent.child = null;
      failAllPending("piper warm process exited");
    });
    return child;
  }

  function synthesizeWarm(text, signal) {
    const child = ensureWarm();
    if (!child) return null;
    const line = text.replace(/\s+/g, " ").trim();
    if (!line) return null;
    return new Promise((resolve, reject) => {
      const request = { resolve, reject, settled: false, startedAt: Date.now(), timer: null };
      if (signal?.aborted) {
        reject(providerError("tts-cancelled", "piper synthesis cancelled"));
        return;
      }
      // A stuck warm process would desync the FIFO queue; kill it so the
      // close handler rejects everything and the next call respawns fresh.
      request.timer = setTimeout(() => {
        if (request.settled) return;
        request.settled = true;
        reject(providerError("tts-failed", "piper warm synthesis timed out"));
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
      }, timeoutMs);
      request.timer.unref?.();
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            if (request.settled) return;
            request.settled = true;
            clearTimeout(request.timer);
            // The queue slot stays: the WAV still arrives and is discarded
            // by settleNextPending, keeping FIFO order intact.
            reject(providerError("tts-cancelled", "piper synthesis cancelled"));
          },
          { once: true },
        );
      }
      persistent.pending.push(request);
      try {
        child.stdin.write(`${line}\n`);
      } catch {
        const index = persistent.pending.indexOf(request);
        if (index >= 0) persistent.pending.splice(index, 1);
        if (!request.settled) {
          request.settled = true;
          clearTimeout(request.timer);
          reject(providerError("tts-failed", "piper warm process is not writable"));
        }
      }
    });
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
    if (keepWarm) {
      try {
        const warm = synthesizeWarm(text, signal);
        if (warm) return await warm;
      } catch (error) {
        if (error?.code === "tts-cancelled") throw error;
        // any warm failure degrades to the exec path below
      }
    }
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

  /** Preload the model so the first spoken sentence skips the ~700 ms load. */
  function warmup() {
    if (keepWarm) ensureWarm();
  }

  function dispose() {
    const child = persistent.child;
    persistent.child = null;
    failAllPending("piper adapter disposed");
    if (child && child.exitCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
    try {
      rmSync(warmDir, { recursive: true, force: true });
    } catch {
      // tmpfs cleanup is best-effort
    }
  }

  return { id: "piper", probe, synthesize, warmup, dispose };
}
