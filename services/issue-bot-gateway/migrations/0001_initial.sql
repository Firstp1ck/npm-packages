-- Policy v1: submissions/audit rows are intentionally content-free. queue_payload is the
-- only raw-prose column and exists solely in the temporary enqueue outbox.
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY CHECK(length(id) = 22),
  idempotency_key TEXT NOT NULL,
  payload_digest TEXT NOT NULL CHECK(length(payload_digest) = 64),
  policy_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('received', 'rejected_prefilter', 'queued', 'checking', 'created', 'rejected', 'review', 'unavailable', 'unknown')),
  reason_code TEXT,
  status_nonce TEXT NOT NULL,
  status_token_hash TEXT NOT NULL,
  ip_bucket_hash TEXT NOT NULL,
  model_bound INTEGER NOT NULL CHECK(model_bound IN (0, 1)),
  -- Private-consumer coordination and audit metadata. These values are content-free:
  -- no prompt, model output, bearer token, or issue prose is retained here.
  processor_lease_id TEXT,
  processor_lease_expires_at INTEGER,
  delivery_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(delivery_attempt_count >= 0),
  last_delivery_at INTEGER,
  model_id TEXT,
  openai_request_id TEXT,
  model_latency_ms INTEGER CHECK(model_latency_ms IS NULL OR model_latency_ms >= 0),
  github_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(github_attempt_count >= 0),
  github_request_id TEXT,
  mutation_state TEXT NOT NULL DEFAULT 'none' CHECK(mutation_state IN ('none', 'post_started', 'ambiguous', 'confirmed')),
  issue_url TEXT,
  issue_number INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(ip_bucket_hash, idempotency_key)
);

CREATE INDEX IF NOT EXISTS submissions_status_updated_idx ON submissions(status, updated_at);
CREATE INDEX IF NOT EXISTS submissions_bucket_created_idx ON submissions(ip_bucket_hash, created_at);
CREATE INDEX IF NOT EXISTS submissions_digest_policy_created_idx ON submissions(payload_digest, policy_version, created_at);
CREATE INDEX IF NOT EXISTS submissions_consumer_lease_idx ON submissions(status, processor_lease_expires_at);

CREATE TABLE IF NOT EXISTS enqueue_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  queue_payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS digest_reservations (
  payload_digest TEXT NOT NULL CHECK(length(payload_digest) = 64),
  policy_version TEXT NOT NULL,
  submission_id TEXT NOT NULL CHECK(length(submission_id) = 22),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(payload_digest, policy_version)
);
CREATE INDEX IF NOT EXISTS digest_reservations_expiry_idx ON digest_reservations(expires_at);

CREATE TABLE IF NOT EXISTS quota_counters (
  bucket_hash TEXT NOT NULL,
  window_kind TEXT NOT NULL,
  count INTEGER NOT NULL CHECK(count >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(bucket_hash, window_kind)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('admitted', 'prefilter_rejected', 'enqueue_succeeded', 'enqueue_failed', 'checking', 'created', 'rejected', 'review', 'unavailable', 'unknown')),
  created_at INTEGER NOT NULL
);

-- An active admission slot is released regardless of whether a terminal transition is
-- performed by the intake failure path or the private consumer.
CREATE TRIGGER IF NOT EXISTS submissions_release_active_quota
AFTER UPDATE OF status ON submissions
WHEN OLD.model_bound = 1
  AND OLD.status IN ('received', 'queued', 'checking')
  AND NEW.status IN ('created', 'rejected', 'review', 'unavailable', 'unknown')
BEGIN
  UPDATE quota_counters
    SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END, updated_at = NEW.updated_at
    WHERE (bucket_hash = OLD.ip_bucket_hash OR bucket_hash = 'global') AND window_kind = 'active';
END;
