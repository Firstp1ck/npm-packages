# Public WebUI Issue Bot — Implementation Plan

**Status:** Implemented and independently reviewed locally — staging/production deployment remains gated  
**Classification:** Complex, security-sensitive, externally deployed (validated against repository evidence)  
**Integration owner:** Main Pi agent  
**Target repository:** `Firstp1ck/pi-coding-agent-forge`  
**Related plan:** [`open-issue-wizard.md`](./open-issue-wizard.md)  
**Frozen Wave 0 contracts:** [`handoffs/issue-bot-contracts.md`](./handoffs/issue-bot-contracts.md)  
**Final report:** [`../reports/issue-bot.html`](../reports/issue-bot.html) (created at completion)  
**Architecture revision:** v2 — Cloudflare-native queue pipeline replaces the earlier GitHub Actions design (see [Architecture decision record](#architecture-decision-record))

## Goal

Enable any Pi WebUI user to submit the existing **Open Issue** wizard payload to a public intake service. The intake service applies deterministic abuse controls, enqueues the submission to a private processor, asks the OpenAI Responses API using `gpt-5.6-terra` with a strict structured-output verdict schema to classify whether the report is relevant and sufficiently specific, and creates a public GitHub issue directly through a GitHub App scoped to **Issues: write** only after a strict, locally validated acceptance verdict.

## Recommended architecture

```text
Pi WebUI Open Issue wizard
        │
        │ HTTPS + Turnstile token + idempotency key
        ▼
Cloudflare Worker: public intake
        ├── exact schema and size checks
        ├── CAPTCHA verification
        ├── IP/submission rate limits
        ├── deterministic spam, secret, and security-report filters
        ├── D1 status/idempotency record
        └── Cloudflare Queue producer (no OpenAI or GitHub credential)
                    │  at-least-once delivery, bounded retries, dead-letter queue
                    ▼
Cloudflare Worker: private processor (queue consumer, not internet-reachable)
        │
        ├── Step 1: classify
        │     ├── exact queue-message schema validation
        │     ├── OpenAI Responses API call
        │     ├── model: gpt-5.6-terra
        │     ├── strict structured output (verdict JSON schema)
        │     ├── no tools, no credentials, untrusted-data prompt boundary
        │     └── fail closed on refusal, timeout, or malformed output
        │
        └── Step 2: finalize (deterministic code only)
              ├── strict local verdict validation
              ├── server-derived repository/content/labels
              ├── duplicate marker reconciliation
              ├── short-lived GitHub App installation token (Issues: write only)
              ├── POST /repos/{owner}/{repo}/issues
              └── D1 status update (created / rejected / review / unavailable / unknown)
                    │
                    ▼
WebUI polls intake status endpoint and shows created link or safe rejection
```

The public intake Worker holds neither the OpenAI key nor any GitHub credential. Only the private queue consumer holds them, and it is not reachable from the internet. The model interaction is a plain HTTPS API call with no tools and no local agent process; deterministic consumer code alone can cause issue creation.

The GitHub App needs only repository **Issues: write** permission for `POST /repos/{owner}/{repo}/issues`, which accepts installation access tokens; tokens expire after one hour and are minted per use from the App private key. This is strictly narrower than the `contents: write` permission the previous `repository_dispatch` design required.

## Architecture decision record

| Decision | Direction | Rationale |
|---|---|---|
| Public intake | Cloudflare Worker | Supplies an internet-facing endpoint, bot protection, quotas, status storage, and secret custody without exposing the WebUI server. |
| Moderation/creation transport | Cloudflare Queue between intake and a private consumer Worker | At-least-once delivery, automatic bounded retries, and a dead-letter queue replace fire-and-forget `repository_dispatch` plus a callback protocol; the consumer is not internet-reachable. |
| GitHub identity | Repository-installed GitHub App | Short-lived installation token, repository-scoped **Issues: write** only, auditable bot identity; avoids a long-lived PAT. |
| Classifier | OpenAI Responses API, `gpt-5.6-terra`, strict structured output | Matches the requested model without a runner, action pinning, or a local agent process; the schema is enforced server-side rather than parsed from free text. |
| Model authority | Classification only | The model cannot choose repository, labels, issue content, credentials, or side effects. It receives no tools and no credentials. |
| Privilege separation | Public intake vs. private consumer | The internet-facing Worker has no OpenAI key and no GitHub credential; the credentialed consumer has no public route. |
| Public issue content | Existing canonical WebUI title/body | The model does not rewrite user content. The reviewed wizard payload remains the source of the public issue. |
| Rejected submissions | No public GitHub issue | Spam, vague reports, prompt injection, sensitive data, and suspected security disclosures fail closed. |
| Security reports | Reject public creation and point to private vulnerability reporting | Prevents accidental publication of vulnerabilities or credentials. |
| User feedback | Asynchronous submission ID plus capability-token polling | Classification and creation run asynchronously; typical end-to-end latency is seconds instead of Actions-runner minutes. |

### Implementation freeze (Wave 0)

Repository reconnaissance confirms the preliminary **complex** classification: this feature has three meaningful implementation slices, crosses browser/Cloudflare/OpenAI/GitHub contracts, changes externally deployed security boundaries, and requires independent review. The canonical local contract is frozen in [`handoffs/issue-bot-contracts.md`](./handoffs/issue-bot-contracts.md).

Local implementation may proceed against fake Turnstile/OpenAI/GitHub endpoints with both kill switches disabled. Account/resource values are deployment-only gates and must not be guessed. Two contract refinements are approved: queue messages carry normalized structured fields so the consumer can independently rebuild canonical content, and intake uses a dedicated `STATUS_TOKEN_KEY` plus a temporary D1 outbox for recoverable idempotency and enqueue crash recovery. Production launch still requires a strict-schema canary for the configured model; `gpt-5.6-terra` is retained as requested configuration but is not currently documented as a public direct Responses API model ID.

### Superseded (v1) decisions

The previous GitHub Actions design (`repository_dispatch` → classifier job with `openai/codex-action` → finalizer job → HMAC callback) is retired. Reasons, in decreasing weight:

1. `repository_dispatch` requires the App to hold `contents: write` — broader than `issues: write` and a real permission escalation for the internet-facing gateway. *(Verify once more during preflight.)*
2. Dispatch is fire-and-forget with no run handle; delivery, workflow presence, runner queueing, and the callback channel could each fail independently, forcing limbo states and reconciliation machinery.
3. The runner sandbox protected against an agent threat the design itself disabled: a schema-constrained Responses API call has no local process to sandbox, and structured outputs are enforced server-side.
4. Public-repository Actions logs are world-readable, inverting the content-free-logging posture; Worker logs are private.
5. Two platforms doubled the contract surface: action SHA pinning, `allow-bot-users`, callback secret rotation, byte-for-byte schema mirroring, and a dedicated workflow workstream existed only to host one model call.

## Security invariants

These are mandatory and may not be weakened during implementation:

1. No OpenAI, GitHub App, or GitHub issue-write credential is sent to the browser, included in an npm package, passed to the model as text, or written to logs. The public intake Worker never holds any of them.
2. The browser and intake Worker cannot select the target owner/repository, labels, assignees, milestone, project, or moderation verdict.
3. The intake Worker and the consumer validate exact schemas with unknown properties rejected.
4. User strings are treated as untrusted data. They are never interpolated into executable code, shell commands, or API parameters other than the issue `title`/`body` JSON fields.
5. Deterministic validation, size limits, secret detection, security-report detection, and rate limiting run before any model call.
6. Issue creation is performed only by deterministic consumer code after strict verdict validation. The model interaction is a network API call with no tools and no access to any credential; the model cannot cause issue creation.
7. Only a schema-valid `accept` verdict with the accepted reason code and no risk flags may reach issue creation.
8. Malformed output, refusal, timeout, unsupported model/schema, quota exhaustion, queue exhaustion/dead-lettering, or ambiguous mutation state never becomes an implicit acceptance.
9. The consumer reconstructs and revalidates the canonical title/body and allowlisted labels independently of the model verdict.
10. No blind retry is allowed after an ambiguous GitHub create-issue request. Marker reconciliation must run first. Queue redeliveries are treated as ambiguous until reconciled.
11. Suspected secrets, personal data, or vulnerability disclosures are not sent to the model or published as issues.
12. Logs and status records contain identifiers, hashes, reason codes, timing, and issue URLs only—not raw submission prose.
13. The existing **Copy complete issue** path remains available when the bot is unavailable or rejects a report.

## Scope

### In scope

- Cloudflare public intake Worker: Turnstile verification, quotas, D1 status/idempotency records, queue producer.
- Cloudflare private processor Worker: queue consumer, Responses API classification, deterministic finalization, GitHub App token minting, issue creation, D1 status updates, dead-letter handling.
- Versioned submission, queue-message, and verdict schemas.
- `gpt-5.6-terra` model configuration with strict structured output via the Responses API.
- Deterministic rejection of malformed, spam-like, vague, prompt-injection-like, secret-bearing, or security-sensitive reports.
- Canonical WebUI payload submission, progress feedback, rejection messaging, and created-issue link.
- Tests for browser, intake, consumer, schemas, security boundaries, idempotency, queue redelivery, and failure behavior.
- Deployment documentation for the GitHub App, Cloudflare resources (Workers, Queue, D1, Turnstile), and rollback.

### Non-goals

- Letting the model edit or rewrite the user's issue.
- Letting the model execute code, browse URLs, call GitHub, use tools, or select labels.
- Anonymous file, screenshot, log, or binary uploads.
- Collecting environment fingerprints automatically.
- A general-purpose issue gateway for arbitrary repositories.
- Replacing GitHub private vulnerability reporting.
- Shipping a maintainer PAT, GitHub App private key, or OpenAI key with Pi WebUI.
- Using the local active Pi tab, its tools, extensions, skills, transcript, or credentials for moderation.
- Any GitHub Actions workflow, `repository_dispatch` event, or repository secret/variable for this feature.
- Automatically deleting or closing issues that were created before validation.

## Repository layout

Planned files and responsibilities:

```text
services/
  issue-bot-gateway/
    package.json
    wrangler.toml.example        # Two Worker configs + queue/D1 bindings; no secret values
    migrations/
      0001_initial.sql
    shared/
      schemas.ts                 # Submission, queue-message, and verdict runtime validation
      catalog.ts                 # Frozen versioned wizard catalog snapshot + canonical builder port
      status.ts                  # Status/reason-code enums shared by intake and consumer
    intake/
      index.ts                   # Public routes and response envelopes
      prefilters.ts              # Deterministic policy checks
      rate-limit.ts              # Quota admission
      status-store.ts            # D1 idempotency/status state machine
      enqueue.ts                 # Queue producer
    consumer/
      index.ts                   # Queue handler, retry/DLQ policy
      moderation.ts              # Fixed prompt + strict structured-output Responses API call
      github-app.ts              # JWT → short-lived installation token (Issues: write)
      create-issue.ts            # Verdict gate, marker reconciliation, issue creation
    test/
      *.test.ts
    README.md                    # Local test and deployment setup

pi-package-webui/
  public/
    issue-bot-client.mjs         # Narrow browser adapter; no credentials
    issue-wizard-state.mjs       # Existing pure canonical payload/state logic
    app.js                       # Submission/progress/result UI integration
    index.html                   # Enabled button and bot-protection/status UI
    service-worker.js            # Cache the new client module
  bin/
    pi-webui.mjs                 # Optional same-origin proxy/config endpoint if required
  tests/
    issue-bot-client.test.mjs
    open-issue-wizard-static.test.mjs
    issue-bot-http-harness.test.mjs
  README.md

plans/
  issue-bot.md
  handoffs/
    issue-bot-contracts.md
    issue-bot-intake.md
    issue-bot-consumer.md
    issue-bot-webui.md

reports/
  issue-bot.html                 # Final implementation/review/rollout report
```

Intake and consumer may deploy as two Workers from one package (preferred: shared schema/catalog code, separate entry points and secret sets). If direct browser-to-intake CORS and Turnstile integration cannot be restricted safely to supported WebUI origins, use a narrow same-origin WebUI server proxy. The proxy must forward only the versioned submission payload and Turnstile token; it must not hold GitHub or OpenAI credentials.

## Data contracts

### Browser-to-intake submission

```json
{
  "schemaVersion": 1,
  "idempotencyKey": "UUID-v4",
  "turnstileToken": "browser challenge token",
  "issue": {
    "categoryId": "bug",
    "componentId": "webui",
    "templateId": "bug-defect-report",
    "summary": "Panel fails to open",
    "fields": {
      "severity": "high",
      "expectedBehavior": "The panel opens.",
      "actualBehavior": "Nothing appears.",
      "reproductionSteps": "1. Open the deck\n2. Select the panel"
    }
  }
}
```

Rules:

- UTF-8 request body limit: 32 KiB.
- Summary: 1–160 normalized characters.
- Prose field: 1–4,000 normalized characters.
- Generated issue body: at most 16,000 characters.
- Only fields declared by the selected template are accepted.
- Unknown properties, controls, bidi overrides/isolates, malformed Unicode, and invalid enum values are rejected.
- The intake Worker reconstructs or verifies the canonical title/body contract; client-supplied title/body are never authoritative.
- The intake Worker validates `categoryId`/`componentId`/`templateId`/fields against a frozen, versioned server-side copy of the wizard catalog. The browser catalog is built at runtime from `createIssueWizardCatalog(OPTIONAL_FEATURES.map(f => f.label))` in `pi-package-webui/public/app.js`, so the component list is not static in the pure module; Wave 0 must snapshot it, and catalog changes require a `policy_version` bump plus parity fixtures proving byte-identical title/body output between the browser builder (`buildIssuePayload`) and the server-side port in `shared/catalog.ts`.

### Accepted intake response

```json
{
  "ok": true,
  "status": "queued",
  "submissionId": "opaque-id",
  "statusToken": "single-submission capability token",
  "pollAfterMs": 2500
}
```

The intake Worker stores only a hash of `statusToken`. The capability grants read access to one submission status and is returned once.

### Queue message

```json
{
  "schema_version": 1,
  "submission_id": "opaque-id",
  "payload_digest": "sha256",
  "policy_version": "1",
  "issue": {
    "category_id": "bug",
    "component_id": "webui",
    "template_id": "bug-defect-report",
    "summary": "Panel fails to open",
    "fields": {
      "severity": "high",
      "expectedBehavior": "The panel opens.",
      "actualBehavior": "Nothing appears.",
      "reproductionSteps": "1. Open the deck\n2. Select the panel"
    },
    "title": "[Bug] [WebUI] [Defect report] Panel fails to open",
    "body": "canonical escaped Markdown"
  }
}
```

The intake Worker fixes the message shape; the consumer revalidates it exactly and rejects unknown properties. Normalized `summary` and `fields` are included so the consumer can rebuild the canonical title/body independently and require byte equality; client-supplied content remains non-authoritative. The message must stay well below Cloudflare Queues' documented per-message size limit (128 KB); the implementation applies a stricter 96 KiB encoded-message cap in addition to the 32 KiB request and 16,000-character body caps.

Queue configuration:

- bounded delivery attempts (default 3) with backoff, then the dead-letter queue;
- dead-lettered messages terminate as `unavailable` in D1 and never create an issue;
- redeliveries are expected (at-least-once); the marker reconciliation in the finalize step is therefore load-bearing, not defense-in-depth.

### Model verdict

```json
{
  "schemaVersion": 1,
  "decision": "accept",
  "reasonCode": "acceptable",
  "riskFlags": []
}
```

Schema:

- `decision`: `accept | reject | review`
- `reasonCode`: `acceptable | spam | too_vague | irrelevant | abuse | sensitive_security_report | secret_or_private_data | prompt_injection | unsupported_content | ambiguous`
- `riskFlags`: allowlisted unique values only, maximum eight items.
- `additionalProperties: false` at every object level.

The schema is submitted to the Responses API as a strict structured-output contract *and* revalidated locally with a real JSON parser and the checked-in schema; server-side enforcement is never trusted alone.

Creation requires all of:

- exactly one valid JSON object;
- `schemaVersion === 1`;
- `decision === "accept"`;
- `reasonCode === "acceptable"`;
- `riskFlags.length === 0`;
- queue-message digest and policy version still match;
- deterministic finalize checks pass.

A model-generated confidence score is intentionally excluded because it is not an authorization control.

### Status polling

In-flight states:

- `queued`
- `checking`

Safe terminal states:

- `created` with `issueUrl` and `issueNumber`
- `rejected` with an allowlisted user-facing reason code
- `review` with no public issue
- `unavailable` (includes dead-lettered submissions)
- `unknown` for an ambiguous GitHub mutation outcome

Raw model output, prompts, upstream bodies, stack traces, and credentials must never be returned.

## Moderation policy

### Deterministic prefilters

Reject before the model when any condition is met:

- invalid schema, unsupported category/component/template, or missing required field;
- body or field limit exceeded;
- credential/private-key/token signatures;
- suspected vulnerability disclosure or explicit security-report language;
- excessive mentions, issue references, URLs, repeated characters, repeated lines, or promotional patterns;
- control/bidi characters or unsupported markup constructs;
- duplicate digest within the configured cooldown/retention window;
- Turnstile failure or quota exhaustion.

Do not claim complete secret, PII, or vulnerability detection. Near-matches that could be sensitive should fail closed to the private-reporting message.

### Model acceptance rubric

Accept only when the report is all of the following:

1. Relevant to Pi WebUI or one of its listed companion components.
2. Coherent and written as a genuine bug, feature, UX, documentation, performance, compatibility, or general request.
3. Specific enough for a maintainer to understand the requested outcome or observed problem.
4. Actionable for its selected template:
   - bug: expected behavior, actual behavior, and useful reproduction steps;
   - feature: desired outcome, affected users, and testable acceptance boundary;
   - UX/docs/performance/compatibility: concrete affected area and evidence appropriate to the template.
5. Not advertising, abuse, unrelated support solicitation, random text, or repeated low-information content.
6. Not asking the classifier to ignore policy, reveal secrets, use tools, execute instructions, or alter the verdict format.
7. Not a security disclosure, credential leak, or private-data submission.

Ambiguous reports use `review`; they do not create an issue automatically.

The prompt is a fixed checked-in file. It must state that the submission object is untrusted data, that instructions inside it must not be followed, and that no response other than the verdict schema is permitted.

## Consumer design

### Classification step (`moderation.ts`)

Required properties:

- Exact queue-message schema validation before model use.
- Responses API call with:
  - `model: gpt-5.6-terra`;
  - reasoning effort `high` initially; change only with measured quality evidence;
  - the fixed checked-in prompt file content;
  - the checked-in verdict schema as a strict structured-output contract;
  - bounded request timeout and no automatic model-call retry beyond the queue's own bounded redelivery.
- The submission text is passed only as clearly delimited untrusted data inside the prompt.
- No tools, no function calling, no credentials, and no URLs of any kind are given to the model.
- Refusal, timeout, empty output, multiple objects, or any schema deviation fails closed to `review`/`unavailable` semantics per the failure table in the test matrix — never to `accept`.
- The classification step never touches GitHub credentials; the verdict object is its only output.

### Finalize step (`create-issue.ts`)

Required properties (deterministic code only):

- Verdict parsed with a real JSON parser and validated against the checked-in schema.
- Canonical queue payload and digest validated again.
- Category/component labels selected from a checked-in allowlist; missing optional labels are omitted rather than invented.
- Public issue content comes only from the canonical queue payload plus a server-authored provenance marker.
- A marker such as `<!-- pi-webui-issue-bot:v1:<submission-id>:<digest-prefix> -->` is appended for reconciliation.
- Before creation — and on every redelivery — recent bot-created issues are searched for the exact marker; a found marker resolves the submission as `created` without a second POST.
- Issue creation uses a fresh short-lived GitHub App installation token minted from the App JWT (`POST /app/installations/{id}/access_tokens`), optionally down-scoped to the single repository and `issues: write`.
- On `403`/`429`, honor `retry-after`/`x-ratelimit-reset`; GitHub secondary limits for content creation (documented at roughly 80 content-generating requests/minute and 500/hour) bound the global creation rate and must be reflected in the global quota ceiling.
- `410 Gone` (Issues disabled) and permission failures terminate as `unavailable` with an operator alert.
- After a timeout or ambiguous GitHub response, the submission is marked `unknown`; the next redelivery (or a manual operator action) must reconcile via marker search before any further POST. No blind retry.
- No raw user text or model output is logged.

## Intake design

### Public routes

- `POST /v1/submissions` — validate, prefilter, rate-limit, store admission record, enqueue.
- `GET /v1/submissions/:id` — capability-token-protected status read.
- `GET /health` — content-free readiness state.

There is no internal callback route; the consumer writes status transitions directly to D1.

### Cloudflare resources

- Two Workers (public intake, private consumer) deployed from one package.
- Cloudflare Queue with a dead-letter queue between them.
- Turnstile for bot resistance.
- D1 for status, idempotency, quotas, and bounded audit metadata (shared by both Workers).
- Optional Workers Rate Limiting binding for coarse IP-level admission before D1 logic.

Queues are available on both Free and Paid Workers plans; verify current throughput, batch, retention, and message-size limits against the account's plan during preflight and record them in the deployment README.

### D1 state

State machine:

```text
received -> rejected_prefilter
received -> queued -> checking
checking -> created | rejected | review | unavailable | unknown
unknown -> created | unavailable        # reconciliation only
```

Bind `(submitter bucket, idempotency key)` to the digest and policy version. Same key/same digest returns the prior status; same key/different digest returns `409`.

Store no raw issue title/body after a successful enqueue. Retain only submission ID, digest, policy version, rate-limit bucket hash, reason/status, timestamps, model/request metadata (model ID, OpenAI request ID, latency), delivery-attempt count, and confirmed issue URL/number. Default metadata retention: seven days; make it configurable and document the privacy trade-off.

### Rate limits

Initial conservative defaults:

- one active submission per status capability;
- 30-second cooldown per IP bucket;
- five model-bound submissions per hour and twenty per day per IP bucket;
- global concurrency and daily budget ceilings, kept safely below GitHub's secondary content-creation limits;
- rejected model-bound attempts count toward quota;
- honor OpenAI and GitHub rate-limit and retry headers for read-only operations;
- never automatically retry an ambiguous issue-creation mutation.

IP addresses must be transformed into rotating, keyed hashes before storage. Do not store full IP addresses in D1 or logs.

## WebUI integration

1. Keep `issue-wizard-state.mjs` pure and preserve its canonical builder.
2. Add a separate `issue-bot-client.mjs` for network behavior instead of placing `fetch` in the pure state module. Wire it in through the existing no-op seam: `submitIssueToGithubBot(...)` in `issue-wizard-state.mjs` is the declared future submission boundary and is already awaited in `app.js` (`await submitIssueToGithubBot(payload)`). Replace that call site with the injected client adapter (or have the seam delegate to an injected transport) while the pure module keeps returning the offline `unavailable` result when no adapter is configured.
3. Send the structured wizard state plus a fresh UUID v4, not editable title/body fields.
4. Disable the submit button while admission is in flight; prevent double submission.
5. Show clear states: checking, queued, rejected, manual review, unavailable, created, and unknown.
6. Poll with bounded exponential backoff and stop after a documented timeout; allow manual refresh later.
7. Open confirmed issue URLs with safe `noopener` behavior.
8. Keep **Copy complete issue** usable at every terminal failure state.
9. For suspected security reports, show the configured private vulnerability reporting URL without echoing the sensitive content.
10. Update the PWA cache/version contracts and static tests for the new client module.
11. Do not persist raw issue drafts or status capability tokens beyond the active browser session unless separately approved.

## Deployment prerequisites

Before implementation reaches production, confirm:

1. Cloudflare account, Worker routes/domain, Turnstile site key, Queue + dead-letter queue, D1 database, and deployment ownership; record the plan's current Queues limits.
2. GitHub App slug, app ID, installation ID, private-key custody, repository access limited to the target repository, and **Issues: write** as the only repository permission.
3. Repository issues and private vulnerability reporting are enabled.
4. `OPENAI_API_KEY` has API billing and direct Responses API access to `gpt-5.6-terra`.
5. A staging canary proves `gpt-5.6-terra` honors the strict structured-output verdict schema via the direct Responses API. If the model is not available through the direct API for this account, select another approved direct-API model or explicitly revisit this architecture decision — this is a mandatory launch gate.
6. Exact repository label allowlist. Labels are not created automatically without explicit approval.
7. Public intake URL, CORS policy, allowed WebUI origins, security-report URL, privacy notice, and metadata retention.
8. Cost ceilings, global quota, and operational owner for abuse/model/GitHub failures.

## Required secrets and configuration

All secrets live in Cloudflare; this feature requires no GitHub repository secrets or variables.

### Public intake Worker secrets

- `TURNSTILE_SECRET_KEY`
- `IP_HASH_KEY`
- `STATUS_TOKEN_KEY` (dedicated HMAC key for recoverable per-submission status capabilities; only capability hashes are stored)

### Private consumer Worker secrets

- `OPENAI_API_KEY`
- `GITHUB_APP_ID`
- `GITHUB_APP_INSTALLATION_ID`
- `GITHUB_APP_PRIVATE_KEY`

### Non-secret configuration (per-Worker vars)

- target `owner/repo` (consumer only);
- `ISSUE_BOT_POLICY_VERSION`;
- `ISSUE_BOT_CREATE_ENABLED` creation flag (consumer kill switch);
- intake admission flag (intake kill switch);
- gateway base URL, Turnstile site key, private vulnerability reporting URL, and safe user-facing rejection messages (public configuration).

No real secret value belongs in Git, `wrangler.toml.example`, test fixtures, issue bodies, or reports.

## Execution DAG and ownership

The implementation requires multiple bounded workers. Parallel writes are allowed only in clean isolated worktrees with non-overlapping ownership. Otherwise run workers sequentially in the shared worktree.

### Wave 0 — contracts and deployment preflight

**Owner:** integration owner  
**Prerequisites:** this plan approved; deployment prerequisites assigned  
**Deliverables:** frozen v1 schemas (submission, queue message, verdict), policy/prompt text, intake URL convention, GitHub App identity and permission set, labels, secret names, retention, queue/DLQ configuration, staging strategy, and a versioned server-side snapshot of the wizard catalog (categories, components including the `OPTIONAL_FEATURES`-derived labels, templates, field definitions) plus canonical-builder parity fixtures shared by intake and consumer tests.  
**Validation:** schemas compile; representative fixtures validate; the Responses API structured-output canary and the `repository_dispatch`-permission assumption noted in the ADR are checked; no credential or deployment ambiguity remains.  
**Stop/escalate:** target repository, credential custody, gateway owner, model entitlement, or security-report destination is unresolved.

### WS-1 — intake Worker

**Worker:** implementation worker 1  
**Prerequisites:** Wave 0 contracts  
**Write boundary:**

- `services/issue-bot-gateway/shared/**` (initial versions per frozen contracts)
- `services/issue-bot-gateway/intake/**`
- `services/issue-bot-gateway/migrations/**`
- intake-focused tests, `package.json`, `wrangler.toml.example`, README sections
- `plans/handoffs/issue-bot-intake.md`

**Forbidden/shared paths:** `services/issue-bot-gateway/consumer/**`, `pi-package-webui/**`, this plan, report files.  
**Deliverables:** routes, schema validation, Turnstile verification, prefilters, quotas, D1 migration/store, queue producer, tests, deployment README.  
**Validation:** intake unit/integration tests, typecheck/lint, local Worker test runtime with a queue stub, migration smoke test, secret/log scan.  
**Stop/escalate:** raw IP/content retention, bypassable CAPTCHA/quota, any need for the intake Worker to hold an OpenAI or GitHub credential.

### WS-2 — consumer Worker

**Worker:** implementation worker 2  
**Prerequisites:** Wave 0 contracts; frozen `shared/**` schemas  
**Write boundary:**

- `services/issue-bot-gateway/consumer/**`
- consumer-focused tests and README sections
- `plans/handoffs/issue-bot-consumer.md`

**Forbidden/shared paths:** `services/issue-bot-gateway/intake/**`, `shared/**` after freeze (escalate contract changes), `pi-package-webui/**`, this plan, report files.  
**Deliverables:** queue handler with retry/DLQ policy, moderation call with strict structured output and fail-closed handling, GitHub App JWT/token minting, verdict gate, marker reconciliation, issue creation, D1 status transitions, fixtures/tests, operator setup notes.  
**Validation:** consumer unit/integration tests against fake OpenAI/GitHub endpoints, typecheck/lint, redelivery/DLQ simulations, secret/log scan.  
**Stop/escalate:** the model cannot produce strict output, the verdict gate would need loosening, the finalize step would trust model-selected content, or the App needs any permission beyond Issues: write.

### Wave 1 integration — intake/consumer contract

**Owner:** integration owner  
**Prerequisites:** WS-1 and WS-2 inspected and validated  
**Actions:** run end-to-end fixture tests through a local queue (accepted/rejected/review/malformed/timeout/duplicate/redelivery/DLQ flows), verify shared schema usage from one source, verify D1 transitions from both Workers, and confirm no issue is created for non-accept outcomes.

### WS-3 — WebUI client integration

**Worker:** implementation worker 1 or a new bounded worker after Wave 1  
**Prerequisites:** integrated staging deployment and final status contract  
**Write boundary:**

- `pi-package-webui/public/issue-bot-client.mjs`
- relevant issue-wizard sections of `pi-package-webui/public/app.js`
- relevant issue-wizard markup/styles/service-worker files
- focused WebUI tests and README sections
- `plans/handoffs/issue-bot-webui.md`

**Forbidden/shared paths:** `services/**`, this plan, unrelated `app.js` areas.  
**Deliverables:** enabled bot button, admission request, bounded polling, result UI, created link, rejection/private-security guidance, preserved copy fallback, tests.  
**Validation:** focused client/state/static/HTTP harness tests, syntax checks, accessibility source contracts, package tests/check.  
**Stop/escalate:** browser needs a secret, arbitrary CORS, raw draft persistence, editable destination/labels, or the copy path regresses.

### Wave 2 integration — combined system

**Owner:** integration owner

1. Inspect every actual diff and handoff against write boundaries.
2. Run all intake, consumer, WebUI, schema, security, and package checks.
3. Deploy only to staging Workers, a staging queue, and a staging repository (or non-public test label/path) first.
4. Execute adversarial synthetic submissions; do not use real sensitive reports.
5. Verify accepted submissions create exactly one staging issue and all other outcomes create none, including under forced queue redelivery.
6. Review logs, D1 rows, queue/DLQ contents, and browser responses for leaked fixture content or secrets.
7. Record all residual risks and deployment instructions.

### Wave 3 — independent review quorum

Use at least two fresh-context, read-only reviewers from distinct provider families. Review the integrated implementation, not isolated worker branches.

Required review angles:

- architecture, correctness, prompt/data boundary, and privilege separation between intake and consumer;
- GitHub App permission minimality, token handling, idempotency/reconciliation under redelivery, quotas, secret handling, tests, and rollout.

Every finding receives an integration-owner disposition: `accepted`, `rejected`, `deferred`, or `needs verification`, with evidence. Accepted fixes are applied by one bounded fix owner and revalidated.

### Wave 4 — report and completion

Create and strictly validate `reports/issue-bot.html` covering architecture, deployment, evidence, test results, reviewer dispositions, residual risks, operations, and rollback. Link the report and plan bidirectionally.

## Test matrix

### Intake

- Exact-schema acceptance and rejection at every object level.
- Request byte, normalized character, field-count, and Unicode bounds.
- Catalog parity: server-side canonical title/body byte-identical to `buildIssuePayload` fixtures.
- Turnstile success, failure, timeout, replay, and hostname/action mismatch.
- Secret/security/mention/URL/repetition/promotion prefilter fixtures and benign near-misses.
- Per-IP, per-capability, global, hourly, daily, concurrency, and cooldown quotas with a fake clock.
- Same idempotency key/same digest, same key/different digest, concurrent duplicates, and restart recovery.
- Queue producer success and controlled enqueue failures (submission terminates as `unavailable`, never silently lost).
- Content-free logging and D1 retention cleanup.

### Consumer

- Queue-message schema and digest validation; unknown-property rejection; size-bound enforcement.
- Prompt-injection corpus: instruction overrides, fake tool/JSON, HTML comments, multilingual attacks, delimiter escapes, URLs, and encoded text.
- Valid accept/reject/review verdicts and every malformed variant: extra/missing fields, wrong enums/version, text-only, multiple objects, truncation, refusal, timeout, and unsupported model/schema — each fails closed and never creates an issue.
- Proof that only exact `accept/acceptable/[]` reaches creation.
- Proof that title/body/repository/labels do not come from model output.
- Label allowlist, mention/reference neutralization, and marker generation.
- At-least-once redelivery: concurrent and sequential redeliveries create at most one issue via marker reconciliation.
- Dead-letter handling: exhausted messages terminate as `unavailable` and never create an issue.
- GitHub App JWT/installation-token minting success and controlled 401/403/404/422/429/5xx/timeouts.
- GitHub create success, malformed response, permission failure, `410 Gone`, validation failure, rate limit, timeout, and ambiguous outcome (`unknown` + reconciliation-before-retry).
- D1 status transitions from the consumer, including the `unknown -> created|unavailable` reconciliation edges.

### WebUI

- Submission serialization uses canonical structured wizard state.
- Fresh UUID per new submission and no duplicate request on double-click.
- Queued/polling/created/rejected/review/unavailable/unknown states.
- Poll timeout/backoff, cancellation when the dialog closes, and safe manual retry semantics.
- Safe issue-link rendering and no user-controlled HTML.
- Private-security-report guidance without echoing sensitive prose.
- Copy fallback remains available.
- Keyboard focus, disabled/busy semantics, status live region, mobile layout, service-worker cache, and offline behavior.
- Existing issue-wizard state/static tests continue to pass.

### Security verification

- Secret scan of changed files, fixtures, Worker logs, browser responses, and generated report.
- Dependency audit for the new gateway package.
- No raw title/body fixture appears in content-free logs or D1 status metadata.
- Static check that intake code paths cannot reference `OPENAI_API_KEY` or `GITHUB_APP_*` bindings (separate secret sets per Worker config).
- Consumer has no public route; verify the deployed consumer Worker rejects or lacks HTTP exposure.
- GitHub App installation has only the target repository and Issues: write.
- Model requests contain no credentials, tools, or callback URLs.

## Acceptance criteria

- [ ] Any supported WebUI user can submit through the configured public intake without receiving or supplying a maintainer credential.
- [ ] The intake Worker rejects malformed, oversized, rate-limited, secret-bearing, and security-sensitive submissions before any model call, and holds no OpenAI or GitHub credential.
- [ ] The consumer classifies via the direct Responses API with `gpt-5.6-terra` and a strict structured-output verdict schema, with no tools and fail-closed error handling.
- [ ] The model cannot mutate anything, call GitHub, select repository/labels/content, or access credentials.
- [ ] Only a strict `accept/acceptable/[]` verdict can create an issue.
- [ ] Issues are created through a short-lived GitHub App installation token scoped to the target repository with Issues: write only.
- [ ] Accepted issues use the exact canonical title/body reviewed in the WebUI plus a nonsecret provenance marker.
- [ ] Rejected, review, unavailable, dead-lettered, malformed, and timeout paths create zero issues.
- [ ] Repeated clicks, duplicate submissions, queue redeliveries, and restart recovery create at most one confirmed issue.
- [ ] The WebUI eventually shows the confirmed issue URL or an accurate safe terminal state.
- [ ] Suspected vulnerabilities point to private vulnerability reporting and are never published automatically.
- [ ] Logs, status storage, responses, and reports contain no raw issue prose or credentials.
- [ ] Intake tests, consumer tests, focused WebUI tests, full package tests/checks, security scans, and staging canaries (including the structured-output canary) pass.
- [ ] Two provider-diverse independent reviewers qualify the integrated implementation and every finding is dispositioned.
- [ ] Production enablement occurs only after explicit deployment approval and a successful staging soak.

## Rollout plan

### Phase 0 — offline and staging fixtures

- Implement with fake OpenAI/GitHub/Turnstile endpoints and a local queue.
- Run deterministic and adversarial fixtures locally, including forced redelivery and DLQ paths.
- Deploy staging Workers, a staging queue, and D1 against a staging repository or a non-public test label/path.

### Phase 1 — shadow mode

- Public intake admits and classifies submissions but creates no production issue (`ISSUE_BOT_CREATE_ENABLED=false`).
- Record only safe reason/status metrics.
- Manually compare a representative sample of synthetic/consented reports with expected decisions.
- Tune deterministic thresholds and rubric; do not tune using private security reports.

### Phase 2 — limited creation

- Enable production creation with low global quotas and the creation flag.
- Keep `review` fail-closed.
- Monitor false accept/reject rate, cost, queue depth/redeliveries/DLQ, model latency, duplicate prevention, and abuse attempts.

### Phase 3 — general availability

- Enable the button by default only after staging/shadow gates and independent review pass.
- Maintain the intake admission kill switch and the consumer creation flag.
- Review quotas, model version, secrets, and false classifications periodically.

## Rollback and incident response

1. Disable intake admission or set `ISSUE_BOT_CREATE_ENABLED=false`; retain copy-only behavior. Queued messages then terminate safely without creating issues.
2. Revert the WebUI bot button to disabled/unavailable while preserving the existing copy path.
3. Revoke/rotate the OpenAI key, IP hash key, or GitHub App private key independently as needed; uninstall or suspend the GitHub App to sever issue-write capability instantly.
4. If a secret appears in logs, delete affected logs where possible, rotate immediately, and audit Worker deployments and access.
5. If duplicate or unsafe issues are created, disable creation first, preserve evidence (including queue/DLQ state), then close/label them manually; do not run an automated destructive cleanup.
6. Schema rollback must retain support for already queued v1 messages and status records until they terminate or expire; draining the queue with creation disabled is the safe default.

No database down-migration is required during emergency disablement. D1 and DLQ cleanup should be separate reviewed operations.

## Observability

Track content-free metrics:

- admission count and prefilter reason codes;
- Turnstile and quota failures;
- classification decision/reason, latency, model ID, OpenAI request ID, and token/cost totals when available;
- queue depth, delivery attempts, redeliveries, DLQ arrivals;
- issue creation, reconciliation, duplicate, and unknown-outcome counts;
- status polling latency and terminal-state distribution.

Use Workers Logs/Logpush with content-free events plus the D1 audit rows as the audit trail (this replaces the immutable public Actions run logs of the v1 design — an accepted trade-off that requires the audit-row schema to actually ship).

Do not log raw title/body, model prompt/output, capability token, installation token, OpenAI key, App key, Turnstile token, cookie, PIN, or full IP address.

## Source references

- [GitHub create-an-issue REST API](https://docs.github.com/en/rest/issues/issues#create-an-issue)
- [Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
- [Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [OpenAI structured outputs](https://platform.openai.com/docs/guides/structured-outputs)
- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses/create)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)
- [Cloudflare Queues limits](https://developers.cloudflare.com/queues/platform/limits/)
- [Cloudflare Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)

## Residual risks

- LLM classification remains probabilistic; deterministic policy, fail-closed review, shadow mode, quotas, and sampling reduce but do not eliminate false decisions.
- CAPTCHA and IP quotas increase abuse cost but do not establish a durable user identity. Add authenticated GitHub user intake later if abuse warrants it.
- GitHub issue creation has no general application-supplied idempotency key, and queue delivery is at-least-once. Exact-marker reconciliation and fail-closed ambiguous outcomes reduce duplicate risk but cannot provide a transactional guarantee across Cloudflare and GitHub; redelivery dedupe fixtures are mandatory.
- The consumer Worker co-locates the OpenAI key and the issue-write capability (via the App private key). Mitigations: no public reachability, separate secret sets per Worker, code review of the consumer, independent rotation, and instant App suspension as a severance path. Escalate to a two-consumer split (moderation vs. finalize over a private binding/second queue) only if review deems it necessary.
- `gpt-5.6-terra` availability and strict structured-output support through the direct Responses API depend on account entitlement; the staging canary is a mandatory launch gate.
- The `contents: write` requirement claim for the superseded `repository_dispatch` path should be re-verified during preflight only if the Actions design is ever reconsidered.
- Public issue text may still contain sensitive material that deterministic filters miss. The wizard warning, conservative security routing, and copy/manual fallback remain necessary.
- Auditability shifts from immutable public Actions logs to operator-controlled Worker logs and D1 rows; acceptable only if the content-free audit-row schema is implemented, not just planned.

## Progress record

| Workstream | Status | Evidence |
|---|---|---|
| Architecture and security research | Complete | Repository exploration plus official OpenAI/GitHub sources |
| Plan (v1, GitHub Actions design) | Superseded | Prior revision of `plans/issue-bot.md` |
| Plan validation pass (v1) | Complete | Verified against local repo state (`issue-wizard-state.mjs`, `app.js` seam, existing tests), `openai/codex-action` `action.yml` inputs, and documented `repository_dispatch` `client_payload` limits |
| Architecture revision (v2, Cloudflare-native queue) | Complete | Researcher evidence (GitHub App IAT + Issues: write, official docs) and oracle assessment recommending intake → Queue → consumer; this document |
| Deployment preflight | Partial / launch-gated | Official platform contracts checked; account resources, Turnstile, GitHub App, and exact OpenAI model entitlement remain operator inputs |
| Wave 0 contract freeze | Complete | [`handoffs/issue-bot-contracts.md`](./handoffs/issue-bot-contracts.md); complex classification validated; queue structured-state, D1 outbox, and `STATUS_TOKEN_KEY` refinements approved |
| Intake Worker | Complete locally | `services/issue-bot-gateway/intake/**`; intake/shared tests and handoff pass |
| Consumer Worker | Complete locally | `services/issue-bot-gateway/consumer/**`; fake-backed moderation/GitHub/redelivery/DLQ/E2E tests pass |
| WebUI integration | Complete locally | `issue-bot-client.mjs`, wizard integration, static/client/state tests, and handoff |
| Integrated validation/review | Complete locally | Gateway 33/33 tests, real SQLite contract test, focused WebUI suites, secret/boundary scans, Wrangler dry-runs, provider-diverse review, and post-fix adversarial PASS |
| Final report | Complete | [`../reports/issue-bot.html`](../reports/issue-bot.html), strict HTML validation PASS |
| Production rollout | Blocked by design | Explicit approval, provisioned resources, and successful staging/model canaries required |

## Independent review dispositions

Fresh read-only reviews used `anthropic/claude-opus-5` and `openrouter/moonshotai/kimi-k3`, both distinct from the primary OpenAI implementation provider. Findings are advisory and were checked against source, tests, the frozen contracts, and current official documentation before disposition.

| Finding | Disposition | Evidence / rationale |
|---|---|---|
| Anthropic B1 — strict-output schema compatibility | accepted | Added a dedicated enum-based wire schema, removed unsupported `uniqueItems` from the wire, retained local uniqueness validation, and added exact response/incomplete/refusal parsing plus `max_output_tokens`. Current official OpenAI docs explicitly support `enum`, `anyOf`, and `maxItems`; the authenticated canary remains mandatory. |
| Anthropic B2 — PKCS#1 GitHub App key | accepted | JWT code now converts GitHub-style PKCS#1 RSA PEM to PKCS#8 in memory; PKCS#1 and PKCS#8 tests pass. |
| Anthropic B3 / OpenRouter M5 — SQL paths untested | accepted | Added a real SQLite migration/store test covering concurrent idempotency, atomic digest reservations, leases, mutation barrier, transitions, quota bounds, trigger release, and cleanup. |
| Anthropic B4 / OpenRouter B2 — missing cron | accepted | Added mandatory five-minute intake cron and deployment documentation. |
| OpenRouter B1 — duplicate content | accepted | Added atomic D1 digest reservations with expiry and a concurrency assertion; fresh UUIDs cannot race into duplicate issues during cooldown. |
| Anthropic M1 — marker from arbitrary author | accepted | Reconciliation requires the exact configured GitHub App `<slug>[bot]` login and `Bot` type. |
| Anthropic M2 — DLQ name fail-open | accepted | Only the exact configured main queue can classify/create; missing or unknown queue names are unavailable-only. |
| Anthropic M3 / OpenRouter M2 — GitHub 403/429 backoff | accepted | Definitive rate-limit responses clear the persisted mutation barrier through a guarded store operation and retry with bounded headers; ambiguous outcomes remain reconciliation-only. |
| Anthropic M4 — mentions/references | accepted | Browser/server canonical builders now byte-identically neutralize GitHub `@mentions` and `#references`; all-template parity fixtures pass. |
| Anthropic M5 — short lease | accepted | Consumer lease raised to 240 seconds and default reconciliation horizon reduced to three pages. |
| Anthropic M6 — unrelated terminal-tab diff | deferred | Unrelated concurrent work is outside this plan and remains unmodified/unclaimed; it must be split or handled by its owner before an issue-bot-only commit. |
| Anthropic M7 — deleted static assertions | accepted | Restored focus, toggle semantics, live-region, preview, copy, pure-module, static-serving, PWA, and syntax regression assertions alongside new bot tests. |
| Anthropic M8 — missing test matrix artifacts | accepted | Added Turnstile action/hostname/cdata/transport tests, prefilter positives/near-misses, exact model refusal/incomplete/multiple-output tests, SQL tests, and all-template parity. A live HTTP/browser staging harness is deferred to the deployment gate because no endpoint/resources exist locally. |
| Anthropic M9 — fixed prompt delimiter | accepted | Moderation uses a random per-request delimiter named in the developer instruction; delimiter and role are tested. |
| Anthropic L1/L2/L4/L5/L6/L7/L8/L9 | accepted | Added queue retry delays, quota/digest cleanup, exact outbox ID lookup, removed the dead token parameter, included consumer in typecheck, broadened repository IDs, gated insecure local GitHub API explicitly, and bounded model output. |
| Anthropic L3 / OpenRouter M4 — no observability | accepted | Added content-free terminal events only; external alert/Logpush routing remains an operator deployment task. |
| Anthropic L10 / OpenRouter M1 — prefilter quota/cooldown | deferred | Turnstile, exact-origin policy, atomic model-bound quotas, digest reservations, and retention are implemented. A separate coarse edge rate-limit for all rejected traffic is a staging-tuning decision to avoid turning local false positives into durable quota denial. |
| Anthropic L11 — day/IP-scoped idempotency | deferred | Accepted residual: status/idempotency is deliberately scoped to a rotating IP bucket; digest reservation independently prevents duplicate content during cooldown. |
| Anthropic L12 / OpenRouter M6 — CSP and status-read rate limit | deferred | Documented deployment concerns; exact CSP/Workers Rate Limiting depend on the final WebUI origin and Turnstile route. |
| OpenRouter M3 — hardcoded catalog parity | accepted | Tests extract the live `OPTIONAL_FEATURES` labels and validate byte parity for every template. |
| OpenRouter M7 — created reason metadata | accepted | Added content-free `acceptable` audit reason for confirmed creation. |
| OpenRouter M8 — timing/constant-time notes | needs verification | Timing hardening is not an authorization control for a 256-bit HMAC capability; Turnstile remote IP and cdata binding were nevertheless added. Reassess only if staging threat evidence warrants it. |
