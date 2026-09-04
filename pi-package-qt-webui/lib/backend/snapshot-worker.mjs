import { parentPort, workerData } from "node:worker_threads";
import { loadPersistedSessionSnapshotInProcess } from "./session-sync.mjs";
import { LIMITS, boundedError } from "./protocol.mjs";

try {
  const result = await loadPersistedSessionSnapshotInProcess(workerData.path, { temporaryDirectory: workerData.directory });
  const json = JSON.stringify(result);
  if (Buffer.byteLength(json) > LIMITS.maxSnapshotOutputBytes) throw Object.assign(new Error("Projected snapshot exceeds its output byte limit"), { code: "limit_exceeded" });
  parentPort.postMessage({ json });
} catch (error) {
  parentPort.postMessage({ error: { code: error.code ?? "unavailable", message: boundedError(error.message) } });
}
