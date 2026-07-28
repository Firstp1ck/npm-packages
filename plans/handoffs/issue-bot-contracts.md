# Issue Bot v1 Contracts — Wave 0 Handoff

**Status:** Frozen for local implementation  
**Policy version:** `1`  
**Integration owner:** Main Pi agent  
**Parent plan:** [`../issue-bot.md`](../issue-bot.md)

## Classification and implementation gate

Repository evidence confirms this is a **complex, security-sensitive feature**: it has three implementation slices (intake/shared contracts, private consumer/finalizer, and WebUI integration), crosses browser/Cloudflare/OpenAI/GitHub contracts, and needs independent security review. Local fake-backed implementation is approved. Production deployment and issue creation remain disabled until the account-specific gates in the parent plan pass.

## Frozen decisions

1. `services/issue-bot-gateway` is a standalone ESM TypeScript package using Node 22+, TypeBox runtime validation, `node:test`, and Wrangler/Vitest-compatible Worker interfaces without a root workspace change.
2. The intake and consumer use separate Worker entry points and secret sets. Intake must not type or reference OpenAI/GitHub credentials; consumer exports no public `fetch` handler.
3. The queue message includes normalized `summary` and exact template `fields` in addition to canonical `title`/`body`. The consumer rebuilds title/body and requires byte equality before model use and before finalization.
4. Intake uses a short-lived D1 outbox because D1 and Queue cannot commit atomically. Raw prose may exist only in the queue and pending outbox and must be deleted from the outbox after successful enqueue or terminal enqueue failure.
5. Add intake secret `STATUS_TOKEN_KEY`. A per-submission capability is derived from a stored random nonce and this key; D1 stores only the capability hash. This permits same-key/same-digest admission replay without persisting the bearer token.
6. Before a GitHub create POST, persist `mutation_state=post_started`. Any ambiguous result or later redelivery is reconciliation-only; absence of a marker never authorizes a second POST.
7. Both kill switches default false: `ISSUE_BOT_ADMISSION_ENABLED=false` and `ISSUE_BOT_CREATE_ENABLED=false`.
8. Keep configured model default `gpt-5.6-terra` to match the requested plan, but production launch requires an authenticated strict-schema canary. The ID is not currently documented as a public direct Responses API model; operators must explicitly approve a demonstrated ID or switch to an approved documented model.
9. Empty label mapping is the safe default. Labels are derived from checked-in/configured allowlists only and are never created automatically.

## Browser submission schema

Every object rejects unknown properties.

```json
{
  "schemaVersion": 1,
  "idempotencyKey": "lowercase UUID-v4",
  "turnstileToken": "1..2048 characters",
  "issue": {
    "categoryId": "frozen category id",
    "componentId": "frozen component id",
    "templateId": "compatible frozen template id",
    "summary": "1..160 normalized characters",
    "fields": { "only fields declared by the selected template": "1..4000 normalized characters or an allowlisted enum" }
  }
}
```

The browser never sends an authoritative owner, repository, labels, title, body, verdict, callback URL, or credential.

## Queue schema refinement

```json
{
  "schema_version": 1,
  "submission_id": "22-character base64url id",
  "payload_digest": "64 lowercase SHA-256 hex",
  "policy_version": "1",
  "issue": {
    "category_id": "frozen category id",
    "component_id": "frozen component id",
    "template_id": "compatible frozen template id",
    "summary": "normalized summary",
    "fields": { "exact normalized template fields": "value" },
    "title": "canonical title",
    "body": "canonical escaped Markdown"
  }
}
```

Digest preimage is the canonical JSON representation of `{schema_version,policy_version,issue}`. The consumer recomputes it and rejects a mismatch. Encoded queue messages are capped below 96 KiB.

## Verdict schema and authorization gate

```json
{
  "schemaVersion": 1,
  "decision": "accept | reject | review",
  "reasonCode": "allowlisted reason",
  "riskFlags": ["allowlisted unique risk flag"]
}
```

Only exact `accept / acceptable / []` is authorization to continue. Every malformed, refused, incomplete, timed-out, unsupported, ambiguous, or semantically inconsistent response fails closed and creates no issue.

## D1 state and mutation invariants

```text
received -> rejected_prefilter | queued | unavailable
queued -> checking | unavailable
checking -> created | rejected | review | unavailable | unknown
unknown -> created | unavailable
```

Required tables: `submissions`, temporary `enqueue_outbox`, and content-free `audit_events`. Persist IDs, hashes, enums, timestamps, attempts, model/request metadata, and confirmed issue URL/number only. Do not persist raw IP, capability tokens, Turnstile tokens, model prompt/output, installation tokens, or raw issue prose outside the pending outbox.

## Frozen catalog

Categories/templates/fields are ported byte-for-byte from `pi-package-webui/public/issue-wizard-state.mjs`. Components are a policy-v1 snapshot of `createIssueWizardCatalog(OPTIONAL_FEATURES.map(feature => feature.label))` from `pi-package-webui/public/app.js`. Any catalog or canonical-builder change requires a policy-version bump and browser/server parity fixtures.

## Public routes

- `POST /v1/submissions`: exact JSON + size validation, origin policy, Turnstile, deterministic filters, idempotency/quota admission, outbox, enqueue.
- `GET /v1/submissions/:id`: `Authorization: Bearer <status capability>` only; unknown ID and wrong token are indistinguishable.
- `GET /health`: content-free local readiness only.

Responses use exact allowlisted envelopes, `Cache-Control: no-store`, and exact-origin CORS with `Vary: Origin`. They never echo user prose or upstream errors.

## Worker ownership

### WS-1 — shared contracts and intake

Owns `services/issue-bot-gateway/{package.json,package-lock.json,tsconfig.json,wrangler.toml.example,shared/**,intake/**,migrations/**,test/shared-*,test/intake-*}`, base README content, and `plans/handoffs/issue-bot-intake.md`. Must create consumer-compatible package/config placeholders but must not write `consumer/**` or `pi-package-webui/**`.

### WS-2 — private consumer

Owns `services/issue-bot-gateway/{consumer/**,test/consumer-*}` and `plans/handoffs/issue-bot-consumer.md`. Must treat `shared/**`, migrations, package/config, intake, and WebUI as frozen. Contract insufficiency is an escalation, not permission to duplicate or weaken validation.

### WS-3 — WebUI

Owns `pi-package-webui/public/issue-bot-client.mjs`, narrow issue-wizard portions of `app.js`, wizard markup/styles, service-worker cache entry/version, the server static allowlist, focused tests/README, and `plans/handoffs/issue-bot-webui.md`. It keeps `issue-wizard-state.mjs` pure and the copy path available.

## Local acceptance

- Gateway: typecheck; shared/intake/consumer/E2E tests; migration smoke; both Wrangler environments parse; dependency and secret scans.
- WebUI: client/state/static/HTTP harness tests; package `npm test` and `npm run check`; service-worker/static allowlist coverage.
- Integrated: accepted/rejected/review/malformed/timeout/duplicate/redelivery/DLQ/ambiguous-mutation fixtures; exact one-issue maximum; content-free storage/log assertions.

## Deployment-only gates

Cloudflare resource IDs/routes/limits, Turnstile site and allowed hosts/origins, `STATUS_TOKEN_KEY`, GitHub App installation and Issues-only permission, repository labels/private-report URL, OpenAI billing/model canary, staging repository, quotas/cost owner, and explicit production enablement are not guessed in source. They remain required before staging/production creation.
