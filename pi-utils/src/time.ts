/** Normalize Unix timestamps expressed in seconds, milliseconds, or microseconds to milliseconds. */
export function normalizeTimestampMs(timestamp: number): number {
  if (timestamp < 1e11) return timestamp * 1000;
  if (timestamp > 1e14) return Math.floor(timestamp / 1000);
  return timestamp;
}
