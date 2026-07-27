import { utf8Length } from "../shared/crypto.js";
import { validateQueueMessage } from "../shared/schemas.js";
import type { SubmissionStore } from "./status-store.js";

export interface QueueProducerLike { send(message: unknown): Promise<void> }

const MAX_QUEUE_MESSAGE_BYTES = 96 * 1024;

export async function enqueueOutboxPayload(queue: QueueProducerLike, rawPayload: string): Promise<void> {
  if (utf8Length(rawPayload) > MAX_QUEUE_MESSAGE_BYTES) throw new Error("queue payload exceeds policy limit");
  let parsed: unknown;
  try { parsed = JSON.parse(rawPayload); } catch { throw new Error("outbox payload is not JSON"); }
  if (!validateQueueMessage(parsed)) throw new Error("outbox payload fails queue schema");
  await queue.send(parsed);
}

/** Queue success is followed by an atomic status/outbox update; a crash between them is retried by scheduled recovery. */
export async function enqueueSubmission(
  store: SubmissionStore,
  queue: QueueProducerLike,
  pending: { id: number; submissionId: string; queuePayload: string },
  now: number,
): Promise<boolean> {
  try {
    await enqueueOutboxPayload(queue, pending.queuePayload);
  } catch {
    // A producer rejection is terminal and deletes pending prose. Do not apply this
    // path after a successful send: that outcome is ambiguous and must be recoverable.
    await store.markUnavailableAndDeleteOutbox(pending.submissionId, pending.id, now);
    return false;
  }
  try {
    await store.markQueuedAndDeleteOutbox(pending.submissionId, pending.id, now);
    return true;
  } catch {
    // Preserve the outbox after a send/commit ambiguity. Scheduled recovery can safely
    // redeliver because the private consumer treats messages as at-least-once.
    return false;
  }
}
