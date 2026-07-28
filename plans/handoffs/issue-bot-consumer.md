# WS-2 Private Consumer Handoff

- **Workstream:** WS-2 — private queue consumer and required minimal gateway contracts
- **Status:** implementation complete for assigned scope; ready for integration inspection/review
- **Base revision:** `d24b0ca1df6c7371e8d2adb02951c20e705527f5`
- **Result state:** uncommitted shared-worktree changes; no staged files
- **Authority:** `plans/issue-bot.md`, `plans/handoffs/issue-bot-contracts.md`, and the WS-2 task acceptance contract

## Delivered

- `consumer/index.ts` is a **Queue-only** Worker entry point with no public `fetch` export. It validates exact queue shape, canonical title/body, digest, policy version, and 96 KiB bound before doing any model or GitHub work.
- `consumer/moderation.ts` sends one bounded Responses API request with the configured `gpt-5.6-terra` default, fixed untrusted-data instruction, strict TypeBox verdict JSON schema, `store: false`, high reasoning effort, and no `tools`. URL-shaped input is redacted before it reaches the model. Malformed/refused output becomes `review`; transient upstream failures use bounded queue retry; neither can create an issue.
- `consumer/status-store.ts` applies D1 lease/digest/policy guards around every claim and terminal transition. The migration adds lease expiry, delivery/model/GitHub attempt and request metadata, and persisted mutation state. No raw issue prose, prompt/output, or bearer token is stored.
- `consumer/github-app.ts` mints short-lived RS256 GitHub App JWTs with Web Crypto and requests an installation token down-scoped to the configured single repository with `issues: write` only.
- `consumer/create-issue.ts` uses only canonical queue title/body, fixed configured labels (empty by default), and a server marker. It reconciles the complete marker exactly before creation and on every mutation/redelivery path. `mutation_state=post_started` is persisted before POST; timeout, 5xx, malformed success, or crash/redelivery becomes reconciliation-only. An absent marker after that barrier remains `unknown`; no second POST is allowed.
- The consumer records valid DLQ messages as `unavailable` with no OpenAI/GitHub call. Main queue transient failures retry under Queue policy; the configuration declares bounded retries and the DLQ consumer.

## Files changed by WS-2

- `services/issue-bot-gateway/consumer/create-issue.ts`
- `services/issue-bot-gateway/consumer/github-app.ts`
- `services/issue-bot-gateway/consumer/index.ts`
- `services/issue-bot-gateway/consumer/moderation.ts`
- `services/issue-bot-gateway/consumer/prompt.ts`
- `services/issue-bot-gateway/consumer/status-store.ts`
- `services/issue-bot-gateway/test/consumer-worker.test.ts`
- `services/issue-bot-gateway/test/e2e-consumer.test.ts`
- `services/issue-bot-gateway/migrations/0001_initial.sql`
- `services/issue-bot-gateway/package.json`
- `services/issue-bot-gateway/wrangler.toml.example`
- `services/issue-bot-gateway/README.md`
- `plans/handoffs/issue-bot-consumer.md`

`package-lock.json` was not changed: implementation uses built-in Workers Web Crypto and adds no runtime dependency. Intake, shared contracts, WebUI, parent plan, report files, and production configuration were not edited.

## Tests added

- `test/consumer-worker.test.ts`: fixed strict request/no-tools/URL-redaction contract; RS256/down-scoped token request; malformed and semantically non-exact verdicts; retry; exact marker reconciliation; ambiguous mutation redelivery with zero second POST; DLQ; malformed queue message.
- `test/e2e-consumer.test.ts`: fake queue → OpenAI → GitHub App → D1 state flow, then redelivery, proving exactly one POST.

## Validation evidence

| Command | Result |
|---|---|
| `cd services/issue-bot-gateway && npm run typecheck` | Passed |
| `cd services/issue-bot-gateway && npm run test:consumer` | Passed, 6 fake-backed consumer tests |
| `cd services/issue-bot-gateway && npm run test:e2e` | Passed, 1 fake-backed end-to-end consumer test |
| `cd services/issue-bot-gateway && npm run check` | Passed, typecheck plus all 16 shared/intake/consumer/E2E tests |
| `cd services/issue-bot-gateway && npm audit --omit=dev --audit-level=high` | Passed, 0 vulnerabilities |
| `wrangler deploy --dry-run` for intake and consumer configs | Passed; consumer has D1 binding and creation flag remains `false` |
| Fresh local `wrangler d1 migrations apply ... --local` | Passed, 8 migration commands |
| Local D1 `pragma_table_info('submissions')` query | Passed; confirmed lease, delivery/model/GitHub metadata, and mutation-state columns |
| Changed-file credential-value scan, content-free logging scan, and no-public-fetch scan | Passed |

## Omissions / deviations

- No deployment, Cloudflare resource creation, actual OpenAI request, GitHub request, secret setup, or production enablement was attempted. Both documented kill switches remain false.
- The consumer uses fake OpenAI/GitHub/D1/Queue endpoints only. A real authenticated strict-output model canary remains a launch gate.
- No lockfile change was needed. No unapproved shared/intake/WebUI interface change was made.
- Wrangler reports an informational warning that intake-only non-secret `vars` do not inherit into `env.consumer`; this is intentional privilege separation. The consumer dry-run confirms its required D1 binding and consumer-only variables.

## Residual risks / integration notes

- Cloudflare/OpenAI/GitHub semantics remain locally simulated; staging must verify Queue `batch.queue` DLQ routing, D1 lease concurrency, GitHub marker pagination/rate limiting, App permission scope, and the configured model’s strict schema behavior.
- Reconciliation scans a bounded recent page horizon. This cannot authorize a retry after `post_started`: an absent marker remains `unknown`, so it trades eventual automatic recovery for duplicate prevention.
- Model classification remains probabilistic; only an exact validated accept tuple reaches the deterministic finalizer.
- `ISSUE_BOT_GITHUB_OWNER`, repository, labels, account IDs, secrets, routes, and launch approval are deployment-owned and intentionally remain placeholders/disabled.
- Unrelated `pi-package-webui/**` changes appeared in the shared worktree during this WS-2 run; WS-2 did not modify them.
