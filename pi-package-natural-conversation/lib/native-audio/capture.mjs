import { findExecutable, substituteArgvTokens } from "./exec-utils.mjs";

export const CAPTURE_TOOLS = Object.freeze([
  {
    tool: "pw-record",
    args: ({ sampleRateHz, device }) => [
      "--rate", String(sampleRateHz), "--channels", "1", "--format", "s16",
      ...(device ? ["--target", device] : []),
      "-",
    ],
  },
  {
    tool: "parecord",
    args: ({ sampleRateHz, device }) => [
      "--raw", `--rate=${sampleRateHz}`, "--channels=1", "--format=s16le",
      ...(device ? [`--device=${device}`] : []),
    ],
  },
  {
    tool: "arecord",
    args: ({ sampleRateHz, device }) => [
      "-q", "-f", "S16_LE", "-r", String(sampleRateHz), "-c", "1", "-t", "raw",
      ...(device ? ["-D", device] : []),
      "-",
    ],
  },
  {
    tool: "ffmpeg",
    args: ({ sampleRateHz, device }) => [
      "-hide_banner", "-loglevel", "error", "-f", "pulse", "-i", device || "default",
      "-ac", "1", "-ar", String(sampleRateHz), "-f", "s16le", "-",
    ],
  },
]);

/**
 * Resolve the capture command for a `native.capture` config block.
 * Explicit `command` argv arrays win (also the test seam); otherwise the
 * fallback chain is probed in order and the first tool found on PATH wins.
 */
export function resolveCaptureCommand(captureConfig = {}, { env = process.env, findExec = findExecutable } = {}) {
  const sampleRateHz = Number.isFinite(captureConfig.sampleRateHz) ? captureConfig.sampleRateHz : 16000;
  const device = captureConfig.device || null;

  if (Array.isArray(captureConfig.command) && captureConfig.command.length > 0) {
    const argv = substituteArgvTokens(captureConfig.command, { rate: sampleRateHz, device: device ?? "default" });
    return { tool: argv[0], argv, sampleRateHz };
  }

  const requested = captureConfig.tool && captureConfig.tool !== "auto" ? captureConfig.tool : undefined;
  for (const entry of CAPTURE_TOOLS) {
    if (requested && entry.tool !== requested) continue;
    const executable = findExec(entry.tool, env);
    if (!executable) continue;
    return { tool: entry.tool, argv: [executable, ...entry.args({ sampleRateHz, device })], sampleRateHz };
  }
  return undefined;
}
