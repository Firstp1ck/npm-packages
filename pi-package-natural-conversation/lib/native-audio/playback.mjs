import { findExecutable, substituteArgvTokens } from "./exec-utils.mjs";

export const PLAYBACK_TOOLS = Object.freeze([
  {
    tool: "pw-play",
    args: ({ sampleRateHz, device }) => [
      "--rate", String(sampleRateHz), "--channels", "1", "--format", "s16", "--raw",
      ...(device ? ["--target", device] : []),
      "-",
    ],
  },
  {
    tool: "paplay",
    args: ({ sampleRateHz, device }) => [
      "--raw", `--rate=${sampleRateHz}`, "--channels=1", "--format=s16le",
      ...(device ? [`--device=${device}`] : []),
    ],
  },
  {
    tool: "aplay",
    args: ({ sampleRateHz, device }) => [
      "-q", "-f", "S16_LE", "-r", String(sampleRateHz), "-c", "1", "-t", "raw",
      ...(device ? ["-D", device] : []),
      "-",
    ],
  },
  {
    tool: "ffplay",
    args: ({ sampleRateHz }) => [
      "-f", "s16le", "-ar", String(sampleRateHz), "-nodisp", "-autoexit", "-loglevel", "error", "-i", "-",
    ],
  },
]);

/**
 * Resolve the playback command for a `native.playback` config block.
 * Playback rate varies with the TTS provider output, so resolution happens
 * per utterance with the actual sample rate. Explicit `command` argv arrays
 * may use a `{rate}` token.
 */
export function resolvePlaybackCommand(playbackConfig = {}, { sampleRateHz = 16000, env = process.env, findExec = findExecutable } = {}) {
  const device = playbackConfig.device || null;

  if (Array.isArray(playbackConfig.command) && playbackConfig.command.length > 0) {
    const argv = substituteArgvTokens(playbackConfig.command, { rate: sampleRateHz, device: device ?? "default" });
    return { tool: argv[0], argv, sampleRateHz };
  }

  const requested = playbackConfig.tool && playbackConfig.tool !== "auto" ? playbackConfig.tool : undefined;
  for (const entry of PLAYBACK_TOOLS) {
    if (requested && entry.tool !== requested) continue;
    const executable = findExec(entry.tool, env);
    if (!executable) continue;
    return { tool: entry.tool, argv: [executable, ...entry.args({ sampleRateHz, device })], sampleRateHz };
  }
  return undefined;
}
