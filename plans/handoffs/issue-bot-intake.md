# WS-1 Intake Worker Handoff

- **Worker:** WS-1 (implementation worker)
- **Status:** complete for assigned intake/shared-contract scope; ready for integration review
- **Base revision:** `d24b0ca1df6c7371e8d2adb02951c20e705527f5`
- **Result revision:** uncommitted shared-worktree changes (no commit created; no staged files)
- **Authority:** `plans/issue-bot.md` and `plans/handoffs/issue-bot-contracts.md` policy v1

## Delivered files

- `services/issue-bot-gateway/package.json`, `package-lock.json`, `tsconfig.json`, `wrangler.toml.example`, `README.md`
- `services/issue-bot-gateway/shared/catalog.ts`, `crypto.ts`, `schemas.ts`, `status.ts`
- `services/issue-bot-gateway/intake/index.ts`, `enqueue.ts`, `prefilters.ts`, `rate-limit.ts`, `status-store.ts`, `turnstile.ts`
- `services/issue-bot-gateway/migrations/0001_initial.sql`
- `services/issue-bot-gateway/test/shared-contracts.test.ts`, `test/intake-worker.test.ts`

## Implementation notes

- Frozen TypeBox schemas reject unknown object properties. Server catalog is a policy-v1 snapshot of all current optional-feature labels and the canonical builder parity fixture imports the browser builder and compares byte-identical title/body output.
- Intake accepts only the versioned public routes, exact configured Origin, JSON up to 32 KiB, lowercase UUID-v4 idempotency key, server-side Turnstile, deterministic sensitive/security/spam/injection filters, keyed rotating IP buckets, and closed-by-default admission.
- D1 state covers idempotency, status capabilities (stored hash only), quota counters, content-free audit events, and a temporary raw queue outbox. Queue send/commit ambiguity preserves the outbox for scheduled retry; producer rejection removes it and terminates safely.
- Status responses are content-free. Intake/shared code contains no OpenAI or GitHub App credential binding/reference. Both documented kill switches default to `false`.
- Migration includes the active-quota release trigger for consumer terminal transitions. WS-2 should use the frozen stored status/state names and preserve that trigger invariant.

## Validation evidence

| Command | Result |
|---|---|
| `cd services/issue-bot-gateway && npm install` | Passed; 0 vulnerabilities reported. npm warned that local install scripts for `esbuild` and `workerd` were blocked by host `allowScripts`, but Wrangler dry-run/migration checks below completed. |
| `cd services/issue-bot-gateway && npm run typecheck` | Passed after correcting initial TypeScript issues. |
| `cd services/issue-bot-gateway && npm run check` | Passed: typecheck plus 9 focused shared/intake tests. |
| `cp wrangler.toml.example wrangler.toml && npx wrangler deploy --dry-run --config wrangler.toml && rm wrangler.toml` | Passed; Worker bundled with D1, Queue, and closed-default vars. |
| `cp wrangler.toml.example wrangler.toml && npx wrangler d1 migrations apply pi-webui-issue-bot --local --config wrangler.toml && rm wrangler.toml` | Passed; `0001_initial.sql` applied locally (7 commands). |
| Gateway changed-file secret regex scan and static intake/shared credential-name scan | Passed; no credential-shaped values and no forbidden consumer credential references. |
| `git diff --cached --name-only` | Passed; empty output (no staged files). |

## Omissions and deviations

- Did not write `consumer/**`, `pi-package-webui/**`, the parent plan, or reports, per ownership boundary.
- No production secrets, Cloudflare resource IDs, allowed origins, Turnstile hostname/action, resource limits, model entitlement, labels, or GitHub App values were guessed.
- The user-provided `/home/firstpick/npm-packages/context.md` and `/home/firstpick/npm-packages/plan.md` were absent; canonical `plans/issue-bot.md` and the frozen contracts were read instead.
- A direct Wrangler invocation on the `.toml.example` filename is not parsed as TOML by Wrangler because of its final `.example` suffix. README validation instructions copy it temporarily to `wrangler.toml`; that command passed.

## Risks and integration notes

- Local checks use fake Turnstile/D1/Queue implementations; staging still needs real Cloudflare bindings, configured exact origins/hostname/action, queue/DLQ, and D1 resource validation.
- Active quota counters are released by the D1 trigger when WS-2 moves model-bound records to terminal states. WS-2 must not bypass D1 status updates or replace terminal statuses with unrecognized values.
- Queue delivery remains at-least-once by design. The consumer must independently validate the shared queue schema/digest and implement its frozen reconciliation/no-blind-retry requirements.
- Production stays disabled: intake admission and consumer creation flags both default false. No staging/production deployment, model canary, or issue creation was attempted.
