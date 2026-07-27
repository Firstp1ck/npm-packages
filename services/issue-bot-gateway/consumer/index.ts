import { randomBase64Url, sha256Hex, utf8Length } from "../shared/crypto.js";
import { isCreateAuthorized, queueDigestPreimage, validateQueueMessage, type QueueMessage } from "../shared/schemas.js";
import type { SafeReasonCode } from "../shared/status.js";
import { createIssue, reconcileIssueMarker } from "./create-issue.js";
import { githubTarget, mintInstallationToken, type GithubAppEnv } from "./github-app.js";
import { moderateSubmission, type ModerationEnv } from "./moderation.js";
import { D1ConsumerStore, type ConsumerStore, type D1DatabaseLike } from "./status-store.js";

const MAX_QUEUE_MESSAGE_BYTES = 96 * 1024;
const LEASE_MS = 240_000;

export interface QueueMessageLike { body: unknown; attempts?: number; ack(): void; retry(options?: { delaySeconds?: number }): void }
export interface QueueBatchLike { queue?: string; messages: QueueMessageLike[] }

export interface ConsumerEnv extends GithubAppEnv, ModerationEnv {
  ISSUE_BOT_DB: D1DatabaseLike;
  ISSUE_BOT_CREATE_ENABLED?: string;
  ISSUE_BOT_LABELS?: string;
  ISSUE_BOT_RECONCILIATION_PAGES?: string;
  ISSUE_BOT_MAIN_QUEUE_NAME?: string;
  ISSUE_BOT_DLQ_NAME?: string;
}

export interface ConsumerDependencies { now?: () => number; fetch?: typeof fetch; store?: ConsumerStore }

function retry(message: QueueMessageLike, delaySeconds: number | null = null): void {
  message.retry(delaySeconds === null ? undefined : { delaySeconds: Math.min(3_600, Math.max(1, Math.floor(delaySeconds))) });
}

function candidate(body: unknown): { id: string; digest: string; policyVersion: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const value = body as { submission_id?: unknown; payload_digest?: unknown; policy_version?: unknown };
  if (typeof value.submission_id !== "string" || typeof value.payload_digest !== "string" || typeof value.policy_version !== "string") return null;
  return { id: value.submission_id, digest: value.payload_digest, policyVersion: value.policy_version };
}

async function exactQueueMessage(body: unknown): Promise<QueueMessage | null> {
  if (utf8Length(JSON.stringify(body)) > MAX_QUEUE_MESSAGE_BYTES) return null;
  const message = validateQueueMessage(body);
  if (!message) return null;
  const digest = await sha256Hex(queueDigestPreimage(message));
  return digest === message.payload_digest ? message : null;
}

function reasonForVerdict(decision: "accept" | "reject" | "review"): SafeReasonCode {
  return decision === "review" ? "manual_review" : "not_accepted";
}

async function terminal(
  store: ConsumerStore,
  message: QueueMessage,
  leaseId: string,
  status: "created" | "rejected" | "review" | "unavailable" | "unknown",
  reason: SafeReasonCode,
  now: number,
  issue?: { url: string; number: number },
): Promise<boolean> {
  const changed = await store.transition(message.submission_id, message.payload_digest, leaseId, status, reason, now, issue);
  if (changed) console.log(JSON.stringify({ event: "issue_bot_terminal", submission_id: message.submission_id, status, reason_code: reason }));
  return changed;
}

type ReconcileAction = { kind: "ack" } | { kind: "retry"; delaySeconds: number | null };

async function reconcileOnly(
  store: ConsumerStore,
  message: QueueMessage,
  leaseId: string,
  env: ConsumerEnv,
  fetcher: typeof fetch,
  now: number,
  alreadyUnknown: boolean,
): Promise<ReconcileAction> {
  const target = githubTarget(env);
  if (!target || env.ISSUE_BOT_CREATE_ENABLED !== "true") {
    return (await terminal(store, message, leaseId, "unavailable", "unavailable", now)) ? { kind: "ack" } : { kind: "retry", delaySeconds: null };
  }
  const installation = await mintInstallationToken(env, target, fetcher);
  if (installation.kind === "retry") {
    await store.releaseLease(message.submission_id, message.payload_digest, leaseId, now);
    return { kind: "retry", delaySeconds: installation.retryAfterSeconds };
  }
  if (installation.kind === "unavailable") return (await terminal(store, message, leaseId, "unavailable", "unavailable", now)) ? { kind: "ack" } : { kind: "retry", delaySeconds: null };
  const reconciliation = await reconcileIssueMarker(message, target, installation.token, fetcher, env.ISSUE_BOT_RECONCILIATION_PAGES);
  if (reconciliation.kind === "retry") {
    await store.releaseLease(message.submission_id, message.payload_digest, leaseId, now);
    return { kind: "retry", delaySeconds: reconciliation.retryAfterSeconds };
  }
  if (reconciliation.kind === "found") {
    return (await terminal(store, message, leaseId, "created", "acceptable", now, reconciliation.issue)) ? { kind: "ack" } : { kind: "retry", delaySeconds: null };
  }
  // An absent marker after a prior post_started/ambiguous state is not permission for
  // another POST. Once already unknown, preserve that terminal state and release the
  // temporary lease instead of attempting the illegal unknown -> unknown transition.
  if (reconciliation.kind === "missing") {
    if (alreadyUnknown) {
      return (await store.releaseLease(message.submission_id, message.payload_digest, leaseId, now)) ? { kind: "ack" } : { kind: "retry", delaySeconds: null };
    }
    return (await terminal(store, message, leaseId, "unknown", "unknown", now)) ? { kind: "ack" } : { kind: "retry", delaySeconds: null };
  }
  return (await terminal(store, message, leaseId, "unavailable", "unavailable", now)) ? { kind: "ack" } : { kind: "retry", delaySeconds: null };
}

async function processMessage(store: ConsumerStore, messageLike: QueueMessageLike, env: ConsumerEnv, fetcher: typeof fetch, now: number): Promise<void> {
  const malformedCandidate = candidate(messageLike.body);
  const message = await exactQueueMessage(messageLike.body);
  if (!message) {
    if (malformedCandidate) await store.markMalformedUnavailable(malformedCandidate.id, malformedCandidate.digest, malformedCandidate.policyVersion, now);
    messageLike.ack();
    return;
  }

  const leaseId = randomBase64Url(16);
  const claim = await store.claim(message.submission_id, message.payload_digest, message.policy_version, leaseId, now, LEASE_MS);
  if (claim.kind === "busy" || claim.kind === "not_ready") { retry(messageLike, claim.kind === "not_ready" ? 5 : 15); return; }
  if (claim.kind !== "claimed") { messageLike.ack(); return; }

  // `unknown` and every persisted mutation state are reconciliation-only. A worker
  // crash immediately before/after a POST can therefore never turn into a second POST.
  if (claim.status === "unknown" || claim.mutationState !== "none") {
    const action = await reconcileOnly(store, message, leaseId, env, fetcher, now, claim.status === "unknown");
    if (action.kind === "retry") retry(messageLike, action.delaySeconds);
    else messageLike.ack();
    return;
  }

  if (env.ISSUE_BOT_CREATE_ENABLED !== "true") {
    if (await terminal(store, message, leaseId, "unavailable", "unavailable", now)) messageLike.ack();
    else retry(messageLike);
    return;
  }

  const moderation = await moderateSubmission(message, env, fetcher);
  const recorded = await store.recordModelAttempt(message.submission_id, message.payload_digest, leaseId, moderation.metadata.modelId, moderation.metadata.requestId, moderation.metadata.latencyMs, now);
  if (!recorded) { retry(messageLike); return; }
  if (moderation.kind === "retry") {
    await store.releaseLease(message.submission_id, message.payload_digest, leaseId, now);
    retry(messageLike, moderation.retryAfterSeconds);
    return;
  }
  if (moderation.kind === "review") {
    if (await terminal(store, message, leaseId, "review", "manual_review", now)) messageLike.ack();
    else retry(messageLike);
    return;
  }
  if (moderation.kind === "unavailable") {
    if (await terminal(store, message, leaseId, "unavailable", "unavailable", now)) messageLike.ack();
    else retry(messageLike);
    return;
  }
  if (!isCreateAuthorized(moderation.verdict)) {
    const status = moderation.verdict.decision === "review" ? "review" : "rejected";
    if (await terminal(store, message, leaseId, status, reasonForVerdict(moderation.verdict.decision), now)) messageLike.ack();
    else retry(messageLike);
    return;
  }

  const target = githubTarget(env);
  if (!target) {
    if (await terminal(store, message, leaseId, "unavailable", "unavailable", now)) messageLike.ack();
    else retry(messageLike);
    return;
  }
  const installation = await mintInstallationToken(env, target, fetcher);
  if (installation.kind === "retry") {
    await store.releaseLease(message.submission_id, message.payload_digest, leaseId, now);
    retry(messageLike, installation.retryAfterSeconds);
    return;
  }
  if (installation.kind === "unavailable") {
    if (await terminal(store, message, leaseId, "unavailable", "unavailable", now)) messageLike.ack();
    else retry(messageLike);
    return;
  }
  const reconciliation = await reconcileIssueMarker(message, target, installation.token, fetcher, env.ISSUE_BOT_RECONCILIATION_PAGES);
  if (reconciliation.kind === "retry") {
    await store.releaseLease(message.submission_id, message.payload_digest, leaseId, now);
    retry(messageLike, reconciliation.retryAfterSeconds);
    return;
  }
  if (reconciliation.kind === "found") {
    if (await terminal(store, message, leaseId, "created", "acceptable", now, reconciliation.issue)) messageLike.ack();
    else retry(messageLike);
    return;
  }
  if (reconciliation.kind === "unavailable") {
    if (await terminal(store, message, leaseId, "unavailable", "unavailable", now)) messageLike.ack();
    else retry(messageLike);
    return;
  }

  // This write is the mutation barrier. If it is not durably persisted, no POST is
  // attempted. Redelivery sees post_started and can only reconcile the exact marker.
  if (!await store.markPostStarted(message.submission_id, message.payload_digest, leaseId, now)) { retry(messageLike); return; }
  const creation = await createIssue(message, target, installation.token, env.ISSUE_BOT_LABELS, fetcher);
  const githubRequestId = creation.kind === "created" ? creation.issue.requestId : creation.requestId;
  if (!await store.recordGithubRequest(message.submission_id, message.payload_digest, leaseId, githubRequestId, now)) { retry(messageLike); return; }
  if (creation.kind === "created") {
    if (await terminal(store, message, leaseId, "created", "acceptable", now, creation.issue)) messageLike.ack();
    else retry(messageLike);
    return;
  }
  if (creation.kind === "rate_limited") {
    if (await store.clearPostStartedForRetry(message.submission_id, message.payload_digest, leaseId, now)) retry(messageLike, creation.retryAfterSeconds);
    else retry(messageLike);
    return;
  }
  if (creation.kind === "known_failure") {
    if (await terminal(store, message, leaseId, "unavailable", "unavailable", now)) messageLike.ack();
    else retry(messageLike);
    return;
  }
  if (await terminal(store, message, leaseId, "unknown", "unknown", now)) messageLike.ack();
  else retry(messageLike);
}

async function processDlqMessage(store: ConsumerStore, messageLike: QueueMessageLike, now: number): Promise<void> {
  const message = await exactQueueMessage(messageLike.body);
  if (message) await store.markDlqUnavailable(message.submission_id, message.payload_digest, message.policy_version, now);
  messageLike.ack();
}

/** Private Queue-only Worker entry point. It deliberately exports no HTTP fetch handler. */
export function createConsumerWorker(dependencies: ConsumerDependencies = {}) {
  const clock = dependencies.now ?? Date.now;
  const fetcher = dependencies.fetch ?? fetch;
  const resolveStore = (env: ConsumerEnv) => dependencies.store ?? new D1ConsumerStore(env.ISSUE_BOT_DB);
  return {
    async queue(batch: QueueBatchLike, env: ConsumerEnv): Promise<void> {
      const store = resolveStore(env);
      const now = clock();
      // Fail closed: only the explicitly configured main queue may classify/create.
      // Missing, renamed, or unknown queue names are handled as DLQ/unavailable.
      const isMainQueue = !!env.ISSUE_BOT_MAIN_QUEUE_NAME && batch.queue === env.ISSUE_BOT_MAIN_QUEUE_NAME;
      for (const message of batch.messages) {
        try {
          if (!isMainQueue) await processDlqMessage(store, message, now);
          else await processMessage(store, message, env, fetcher, now);
        } catch {
          // Do not leak upstream/content errors. Queue retry remains bounded by the
          // configured producer, then the DLQ handler records unavailable.
          retry(message);
        }
      }
    },
  };
}

export default createConsumerWorker();
