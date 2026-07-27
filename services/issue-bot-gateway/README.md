# Pi WebUI Issue Bot gateway

This package contains the public, fail-closed Cloudflare intake Worker and private Queue-only consumer for the Pi WebUI issue bot. Intake accepts a frozen v1 wizard payload, applies deterministic safety checks, persists only content-free state in D1, and sends a validated message to the private consumer. The consumer independently validates the message/digest, uses one strict tool-free Responses API classification call, and can create an issue only through a down-scoped GitHub App installation token.

For command-by-command staging and production resource setup, secret separation, verification, enablement, and rollback, use [`CLOUDFLARE-PROVISIONING.md`](./CLOUDFLARE-PROVISIONING.md).

## Security boundary

- `intake/` has no OpenAI or GitHub App binding, configuration, or credential.
- Both deploy-time kill switches default to `false`: `ISSUE_BOT_ADMISSION_ENABLED=false` (this Worker) and `ISSUE_BOT_CREATE_ENABLED=false` (consumer placeholder).
- The only raw issue prose persisted by intake is `enqueue_outbox.queue_payload`; it is deleted after enqueue success, controlled enqueue failure, or scheduled expiry. `submissions` and `audit_events` contain IDs, hashes, enums, and timing only.
- D1 stores a rotating keyed IP bucket hash, never the source IP. Status capability tokens are HMAC-derived and only their SHA-256 hash is stored.
- API errors, status records, and this Worker do not emit user prose, Turnstile data, upstream body text, or credentials.

## Local checks

Requires Node 22+:

```sh
cd services/issue-bot-gateway
npm install
npm run check
npm run test:consumer
npm run test:e2e
# Account-level launch gate; performs one synthetic model-only request and prints no prose/key:
OPENAI_API_KEY='set-in-your-shell-only' ISSUE_BOT_MODEL='approved-model-id' npm run canary:openai
cp wrangler.toml.example wrangler.toml
npx wrangler deploy --dry-run --config wrangler.toml
npx wrangler deploy --dry-run --config wrangler.toml --env consumer
rm wrangler.toml
```

Focused tests use fake Queue/Turnstile/OpenAI/GitHub endpoints. `test/d1-contracts.test.ts` applies the real migration to Node's in-process SQLite and exercises idempotency, lease contention, the mutation barrier, guarded transitions, quota bounds, trigger behavior, and cleanup. No test contacts Cloudflare, OpenAI, GitHub, or any production service.

## Deploying intake (operator-owned prerequisites)

1. Copy `wrangler.toml.example` to deployment-only configuration and replace `database_id`; create the named Queue and D1 database first.
2. Apply `migrations/0001_initial.sql` with the appropriate D1 database. Do not edit the migration to add content-bearing columns.
3. Set the intake-only secrets using `wrangler secret put`: `TURNSTILE_SECRET_KEY`, `IP_HASH_KEY`, and `STATUS_TOKEN_KEY`.
4. Configure exact `ISSUE_BOT_ALLOWED_ORIGINS`, Turnstile hostname/action checks (`issue_bot_submit` plus UUID-bound `cData`), retention, duplicate cooldown, routes, D1 binding, Queue producer, and a private vulnerability-report destination in the browser deployment.
5. Keep the example cron trigger enabled. The scheduled handler is mandatory for outbox crash recovery, stale-admission termination, quota cleanup, and the documented retention/privacy bound.
6. Keep `ISSUE_BOT_ADMISSION_ENABLED=false` through local/staging test, independent review, abuse/cost quota approval, and an explicit launch decision. Enabling it only permits admission; it cannot create a GitHub issue.

## Private consumer operation

`consumer/index.ts` exports only a Queue handler—never a public `fetch` handler. Deploy it as the `consumer` environment with no route or `workers.dev` exposure, its own secrets, and `ISSUE_BOT_CREATE_ENABLED=false` until the staging and launch gates pass.

For each valid message the consumer recomputes the canonical digest/title/body, acquires a bounded D1 lease, records only model/request/attempt metadata, and makes one strict `gpt-5.6-terra` Responses API request with no tools. It accepts only `accept` / `acceptable` / `[]`; malformed output, refusals, or schema deviations terminally enter `review`, while transient upstream failures use bounded queue retry.

Before any GitHub issue POST it lists recent issues and compares the complete server-authored marker exactly. It persists `mutation_state=post_started` before POST. Any timeout, 5xx, malformed success, crash/redelivery after that barrier, or ambiguous mutation is reconciliation-only and cannot POST again. An exact marker resolves `created`; an absent marker remains `unknown` for operator action. The GitHub App JWT is RS256 and accepts either PKCS#8 (`BEGIN PRIVATE KEY`) or GitHub's PKCS#1 RSA (`BEGIN RSA PRIVATE KEY`) PEM. The freshly minted installation token is down-scoped to the configured one repository with `issues: write` only. Reconciliation accepts markers only from the configured App slug's exact `<slug>[bot]` identity. Empty `ISSUE_BOT_LABELS` is the safe default.

Configure `ISSUE_BOT_MAIN_QUEUE_NAME`, the main Queue, and its DLQ exactly as shown in `wrangler.toml.example`. The same private Worker treats only the exact main queue as classification-capable; a missing or unknown queue name fails closed as DLQ and moves valid submissions to `unavailable` without calling OpenAI or GitHub. No consumer secret, token, raw title/body, prompt, or model output is logged or retained in D1.

Before a deployment, set only the consumer Worker secrets with `wrangler secret put`: `OPENAI_API_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_PRIVATE_KEY`. Set the exact owner, repository, GitHub App slug, main queue name, and optional fixed label list in deployment-only configuration. Keep `ISSUE_BOT_RECONCILIATION_PAGES` small enough for the 240-second processing lease. Do not put consumer credentials in the intake Worker or tracked configuration.

## Recovery and retention

A successful Queue send followed by an interrupted D1 update leaves the temporary outbox row in place. The Worker `scheduled` handler retries these pending rows. A controlled producer failure marks the record `unavailable` and removes the outbox prose. The same handler expires stale `received` rows, fails closed any `queued`/`checking` row with no progress for one hour, removes expired digest reservations and old content-free metadata, and relies on the D1 trigger to release active quota slots on terminal state changes.

The default model remains `gpt-5.6-terra` only to match the approved plan. It is not a documented public direct-API identifier; production remains blocked until `npm run canary:openai` succeeds with the explicitly approved model. The canary makes one synthetic model-only request, validates the same strict enum/maxItems wire schema and local verdict contract, and prints only content-free model/request/verdict metadata. The local schema additionally enforces unique risk flags.

Use `GET /health` for intake-only content-free readiness. `POST /v1/submissions` requires exact configured Origin, JSON, Turnstile, and admission enabled. `GET /v1/submissions/:id` requires `Authorization: Bearer <status capability>`; missing IDs and wrong capabilities have the same response. The consumer intentionally has no HTTP endpoint.
