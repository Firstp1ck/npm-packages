import type { WorkflowCallRecordV1 } from "./persistence-schema.ts";
import type { WorkflowRunStorage } from "./run-storage.ts";

export type WorkflowReplayCache = {
  readonly sourceRunId: string;
  take(fingerprint: string): WorkflowCallRecordV1 | undefined;
  remaining(): WorkflowCallRecordV1[];
};

export function createWorkflowReplayCache(
  sourceRunId: string,
  calls: WorkflowCallRecordV1[],
  options: { excludeCallIds?: Iterable<string> } = {},
): WorkflowReplayCache {
  const excluded = new Set(options.excludeCallIds ?? []);
  const byFingerprint = new Map<string, WorkflowCallRecordV1[]>();
  for (const call of [...calls].sort((a, b) => a.callIndex - b.callIndex || a.callId.localeCompare(b.callId))) {
    if (call.status !== "completed" || excluded.has(call.callId) || !("result" in call)) continue;
    const queued = byFingerprint.get(call.fingerprint) ?? [];
    queued.push(structuredClone(call));
    byFingerprint.set(call.fingerprint, queued);
  }
  return {
    sourceRunId,
    take(fingerprint) {
      const queued = byFingerprint.get(fingerprint);
      const call = queued?.shift();
      if (queued?.length === 0) byFingerprint.delete(fingerprint);
      return call;
    },
    remaining() {
      return [...byFingerprint.values()].flat().map((call) => structuredClone(call));
    },
  };
}

export async function loadWorkflowReplayCache(
  storage: WorkflowRunStorage,
  sourceRunId: string,
  options: { excludeCallIds?: Iterable<string> } = {},
): Promise<WorkflowReplayCache> {
  return createWorkflowReplayCache(sourceRunId, await storage.readCalls(sourceRunId), options);
}
