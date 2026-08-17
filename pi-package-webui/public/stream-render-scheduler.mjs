export const NORMAL_STREAM_RENDER_INTERVAL_MS = 40;

/**
 * Latest-wins cadence for expensive normal-stream formatting. The first
 * request renders synchronously; sustained requests publish at most once per
 * interval. Semantic callers use flushNow(), while reset/cancellation uses
 * cancel(). Clock and timer hooks keep cadence tests deterministic.
 */
export function createLatestWinsRenderScheduler({
  render,
  now = () => (typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now()),
  schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
  cancelSchedule = (handle) => globalThis.clearTimeout(handle),
  intervalMs = NORMAL_STREAM_RENDER_INTERVAL_MS,
  onDiagnostic,
} = {}) {
  if (typeof render !== "function") throw new TypeError("render is required");
  if (typeof now !== "function" || typeof schedule !== "function" || typeof cancelSchedule !== "function") {
    throw new TypeError("now, schedule, and cancelSchedule must be functions");
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new TypeError("intervalMs must be a positive number");
  const diagnose = typeof onDiagnostic === "function"
    ? (record) => {
        try { onDiagnostic(Object.freeze(record)); } catch { /* Diagnostics cannot alter rendering. */ }
      }
    : () => {};

  let handle = null;
  let pendingValue;
  let hasPending = false;
  let lastFlushAt = null;

  const clearHandle = () => {
    if (handle !== null) cancelSchedule(handle);
    handle = null;
  };

  const run = (reason = "scheduled") => {
    clearHandle();
    if (!hasPending) return false;
    const value = pendingValue;
    pendingValue = undefined;
    hasPending = false;
    lastFlushAt = now();
    render(value, { reason });
    diagnose({ type: "render-scheduler", action: "flush", reason });
    return true;
  };

  const defer = () => {
    if (handle !== null) return;
    const elapsed = lastFlushAt === null ? intervalMs : Math.max(0, now() - lastFlushAt);
    const delayMs = Math.max(0, intervalMs - elapsed);
    handle = schedule(() => {
      handle = null;
      run("cadence");
    }, delayMs);
    diagnose({ type: "render-scheduler", action: "defer", delayMs });
  };

  return Object.freeze({
    request(value) {
      pendingValue = value;
      hasPending = true;
      if (lastFlushAt === null || now() - lastFlushAt >= intervalMs) return run("immediate");
      defer();
      return false;
    },
    flushNow(reason = "semantic") {
      return run(String(reason || "semantic"));
    },
    cancel() {
      clearHandle();
      pendingValue = undefined;
      hasPending = false;
      lastFlushAt = null;
    },
    pending() {
      return hasPending;
    },
    intervalMs() {
      return intervalMs;
    },
  });
}
