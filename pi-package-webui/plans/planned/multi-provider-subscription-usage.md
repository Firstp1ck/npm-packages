# Multi-Provider Subscription and Credit Usage

**Status:** Planned — implementation not started  
**Classification:** Complex feature  
**Prepared:** 2026-07-31  
**Repository:** `pi-package-webui`  
**Integration owner:** Parent Pi session / designated repository maintainer  
**Final report:** [`../../reports/multi-provider-subscription-usage.html`](../../reports/multi-provider-subscription-usage.html) *(created after implementation)*

## Goal

Replace the hard-coded Claude/Codex usage presentation with a secure, extensible provider-usage system, preserve current behavior, and add useful usage reporting for providers that have a sufficiently credible account, quota, credit, or billing data source.

## Classification rationale

This is a complex feature because it:

- crosses backend server routes, Pi credential handling, provider-specific network/CLI adapters, browser state/rendering, styles, tests, and documentation;
- introduces multiple externally versioned contracts with different billing semantics;
- handles sensitive credentials and private/undocumented endpoints;
- requires compatibility migration for existing Codex and Claude routes;
- benefits from separate backend/provider and frontend/validation implementation ownership.

The complex-feature workflow therefore requires at least two meaningful implementation-worker outcomes, central integration, two independent fresh-context reviews, finding disposition, and a final HTML report.

## Findings carried into the plan

### Existing implementation

- `bin/pi-webui.mjs` contains the Codex OAuth usage fetcher/normalizer, Claude CLI execution/parser, and `/api/codex-usage` plus `/api/claude-usage` routes.
- `lib/codex-usage-auth.mjs` performs lock-safe Codex OAuth refresh by accessing Pi's private runtime credential store because the public runtime API has no force-refresh operation.
- `public/index.html`, `public/app.js`, and `public/styles.css` hard-code separate Codex and Claude side-panel sections.
- Existing focused coverage is strongest for Codex OAuth refresh and static wiring; direct usage-endpoint harness coverage is incomplete.
- The current Claude card invokes the external Claude Code CLI. It is not evidence of the Pi `anthropic` credential's account or billing scope.

### Provider feasibility

| Provider | Source | Stability | Planned disposition |
|---|---|---:|---|
| OpenAI Codex | ChatGPT private usage endpoint, already implemented | Existing/private | Migrate without behavior regression |
| Claude Code | Official CLI `/usage`, already implemented | CLI output contract | Migrate without behavior regression |
| OpenRouter | Official current-key and credits APIs | Official | Add in the first rollout |
| Kimi Code | `/coding/v1/usages`; official CLI `/usage` confirms quota semantics | Undocumented REST | Add as experimental, manual refresh by default |
| GitHub Copilot | `copilot_internal/user` for live quota; official billing APIs require a separate token | Private live API / official historical API | Add private live card as experimental; defer separate-PAT billing UI |
| MiniMax Token Plan | Coding-plan remains endpoint | Undocumented REST | Add as experimental after contract validation |
| Gemini Code Assist | Official CLI `/stats` is session-local; account quota endpoints are internal; current Pi no longer exposes native Gemini CLI OAuth | External/private | Defer to an optional external-CLI companion |
| Cursor Enterprise | Official team analytics with separate admin key; not a Pi provider | Official admin-only | Out of scope |
| xAI Grok/X subscription | No documented subscription quota API; API billing is separate | None suitable | Do not implement |
| Qwen/Alibaba Token Plan | Console/private endpoint may require browser session | Private console | Do not implement in this feature |
| Z.AI Coding Plan | Published limits, console-only current usage | No documented usage API | Do not implement |
| OpenCode Go | Published limits, no public current-usage endpoint | No documented usage API | Do not implement authoritative usage |
| Radius/Xiaomi plans | No standardized or documented quota contract found | Unknown | Defer |

## Success criteria

1. One **Usage** side-panel section renders provider cards from a common sanitized contract instead of one top-level accordion per provider.
2. Existing Codex and Claude cards preserve their current visible usage windows, reset timing, errors, manual refresh, periodic refresh, and Codex Fast-mode control behavior.
3. OpenRouter displays official key usage/limit, daily/weekly/monthly spend when returned, account credits, and reset metadata without exposing its key.
4. Kimi Code displays weekly and rolling five-hour quota data when the configured Pi credential is compatible; it is labeled **Experimental** and is not automatically polled before user consent.
5. GitHub Copilot displays provider-reported live quota snapshots when available, does not invent AI-credit remaining values, and clearly labels its private endpoint as **Experimental**.
6. MiniMax displays only provider-returned coding-plan remains data, never infers a plan from quota totals, and is labeled **Experimental**.
7. Missing credentials, incompatible credential types, absent CLIs, unsupported plans, malformed payloads, timeout, 401/403, 404, 429, and upstream 5xx failures produce bounded sanitized states without failing other cards.
8. Raw OAuth tokens, refresh tokens, API keys, GitHub account tokens, account IDs, raw upstream payloads, and unbounded CLI output never reach browser responses or logs.
9. Existing `/api/codex-usage` and `/api/claude-usage` remain compatibility aliases for at least one release and are covered by tests.
10. Focused tests, `npm test`, `npm run check`, syntax checks, and `git diff --check` pass on the integrated result.
11. Two qualifying implementation-worker outcomes, two independent reviews, finding dispositions, and the final HTML report are recorded before completion.

## Scope

### In scope

- A server-only provider-usage adapter registry and common sanitized response contract.
- Migration of existing Codex and Claude implementation into adapters.
- New OpenRouter, Kimi Code, GitHub Copilot, and MiniMax adapters.
- A consolidated Usage side-panel section with progressive per-provider loading.
- Stability/source/billing-scope labels that prevent unlike metrics from being presented as equivalent.
- Compatibility aliases for existing browser endpoints.
- Provider contract tests, endpoint harness tests, static browser tests, documentation, and cache-version updates.
- Experimental-provider disclosure and manual-first fetching.

### Non-goals

- Scraping provider dashboards or requiring browser cookies.
- Adding new Pi model providers, changing `/login`, or changing provider request behavior.
- Storing new GitHub PATs, Cursor admin keys, Google Cloud credentials, or browser sessions.
- Implementing Gemini, Cursor, xAI subscription, Alibaba/Qwen, Z.AI, OpenCode Go, Radius, or Xiaomi usage in this release.
- Deriving subscription remaining quota from local token counts when the provider does not expose an authoritative value.
- Combining Codex Fast mode with the generic usage adapter contract.
- Publishing, deploying, installing, or enabling packages.

## Approved design decisions and invariants

1. **Server-only credentials:** all credential resolution, refresh, CLI execution, and upstream requests stay in the WebUI server process.
2. **One common display contract, multiple semantics:** cards carry `metricKind` and `billingScope`; quota windows, credit balances, historical billing, and session-local statistics are never silently normalized into the same meaning.
3. **Per-provider loading:** provider metadata and cached state load separately from network refreshes so one slow CLI/provider cannot block the whole Usage section.
4. **Official sources auto-refresh; experimental sources are manual-first:** Codex and Claude retain existing behavior; OpenRouter may auto-refresh; Kimi, Copilot, and MiniMax require an explicit first fetch in the browser session and display an experimental disclosure.
5. **Compatibility first:** legacy Codex/Claude routes remain aliases during rollout. The browser migrates to the new endpoint only after parity tests pass.
6. **No invented limits:** adapters render only values returned by the provider or documented fixed limits explicitly marked as documentation-derived. The initial release will not use documented fallback allowances for missing live values.
7. **Bounded execution:** every network/CLI adapter has its own timeout, response-size limit, abort handling, parser validation, and error sanitizer.
8. **Isolated private API dependency:** Pi private credential-store access remains behind one compatibility module with version-focused tests. No browser or general extension code can access it.
9. **Fast mode remains separate:** the Codex Fast-mode control stays a Codex-specific adjacent control and is not included in usage snapshots.
10. **No implementation during planning:** the current dirty worktree is preserved. Workers must inspect current changes before writing and must not overwrite unrelated in-progress work.

## Common server contract

### Provider metadata

```ts
interface UsageProviderMetadata {
  id: string;
  label: string;
  sourceKind: "official-api" | "private-api" | "local-cli";
  stability: "official" | "existing" | "experimental";
  metricKind: "quota-window" | "credit-balance" | "billing-usage" | "session-stats";
  billingScope: string;
  supportsForceAuthRefresh: boolean;
  automaticRefresh: boolean;
  configured: boolean;
  available: boolean;
  unavailableReason?: string;
}
```

### Sanitized card snapshot

```ts
interface UsageCardSnapshot {
  providerId: string;
  available: boolean;
  fetchedAt?: string;
  plan?: string;
  summary?: string;
  windows: Array<{
    id: string;
    label: string;
    unit: "percent" | "requests" | "credits" | "usd" | "tokens";
    used?: number;
    limit?: number;
    remaining?: number;
    usedPercent?: number;
    resetsAt?: string;
    resetAfterSeconds?: number;
  }>;
  details?: Array<{ label: string; value: string }>;
  warnings?: string[];
  auth?: {
    source?: string;
    expiresAt?: string;
    refreshed?: boolean;
  };
}
```

### HTTP surface

- `GET /api/usage-providers`
  - returns metadata and cached status only;
  - never performs an upstream fetch.
- `GET /api/provider-usage?provider=<id>&refresh=0|1`
  - fetches exactly one allowlisted adapter;
  - rejects unknown or duplicate provider IDs;
  - returns one sanitized snapshot or sanitized provider error.
- `GET /api/codex-usage[?refresh=1]`
  - compatibility alias to `openai-codex`.
- `GET /api/claude-usage`
  - compatibility alias to `claude-code`.

The final route names may change only before implementation begins and must then be updated here, in tests, and in the HTML report.

## Proposed file map

### New backend modules

- `lib/provider-usage/contract.mjs` — validation, normalization, bounded error shape.
- `lib/provider-usage/registry.mjs` — allowlisted adapter registration and metadata.
- `lib/provider-usage/auth.mjs` — credential resolution/refresh compatibility boundary.
- `lib/provider-usage/providers/openai-codex.mjs`
- `lib/provider-usage/providers/claude-code.mjs`
- `lib/provider-usage/providers/openrouter.mjs`
- `lib/provider-usage/providers/kimi-coding.mjs`
- `lib/provider-usage/providers/github-copilot.mjs`
- `lib/provider-usage/providers/minimax.mjs`

### Existing files expected to change

- `bin/pi-webui.mjs` — registry construction, route dispatch, compatibility aliases.
- `lib/codex-usage-auth.mjs` — either retained as a compatibility facade or migrated with tests.
- `public/index.html` — consolidated Usage section and experimental disclosures.
- `public/app.js` — provider card state, progressive loading, refresh scheduling, rendering.
- `public/styles.css` — generic usage-card styles and stability badges.
- `public/service-worker.js` — cache version bump after browser assets change.
- `tests/mobile-static.test.mjs` — generic UI and compatibility assertions.
- `tests/http-endpoints-harness.test.mjs` — route and sanitization coverage.
- `tests/codex-usage-auth.test.mjs` — private credential compatibility regression.
- `README.md` — supported providers, semantics, stability, and security boundaries.

### New tests

- `tests/provider-usage-contract.test.mjs`
- `tests/provider-usage-registry.test.mjs`
- `tests/provider-usage-adapters.test.mjs`
- `tests/provider-usage-static.test.mjs`

## Execution DAG and workstreams

```text
W0 Contract freeze and dirty-tree reconciliation
  ├── W1 Backend registry + Claude/Codex migration
  │     ├── W2 Official OpenRouter adapter
  │     └── W3 Experimental Kimi/Copilot/MiniMax adapters
  └── W4 Frontend consolidated Usage shell (starts after contract freeze)

W1 + W2 + W3 + W4
  └── W5 Central integration + compatibility migration
        └── W6 Full validation
              └── W7 Two independent reviews
                    └── W8 Accepted fixes + revalidation
                          └── W9 HTML report + archive plan
```

### W0 — Contract freeze and repository reconciliation

**Owner:** Integration owner  
**Writes:** this plan only  
**Prerequisites:** implementation authorization; inspection of the current dirty worktree  
**Deliverables:**

- Confirm the common contract and endpoint names.
- Attribute or preserve every pre-existing modified/untracked file.
- Decide whether workers use sequential shared-tree writes or clean isolated worktrees.
- Record the exact base revision and implementation provider models.

**Gate:** no worker writes until existing changes are understood and ownership is conflict-free.

### W1 — Backend registry and existing-provider migration

**Owner:** Implementation worker A  
**Writes:** `lib/provider-usage/contract.mjs`, `lib/provider-usage/registry.mjs`, `lib/provider-usage/auth.mjs`, Codex/Claude provider modules, focused tests; bounded route changes in `bin/pi-webui.mjs`  
**Must not write:** browser files, README, canonical plan, report  
**Deliverables:**

- Registry and sanitized contract.
- Codex/Claude adapters with parity fixtures.
- New generic routes and legacy aliases.
- Credential redaction and timeout/error normalization tests.

**Validation:** focused contract/registry tests, Codex auth tests, syntax checks.

**Handoff:** `plans/planned/handoffs/multi-provider-usage-w1-backend.md`

### W2 — Official OpenRouter adapter

**Owner:** Implementation worker B  
**Writes:** `lib/provider-usage/providers/openrouter.mjs`, adapter fixtures/tests only  
**Must not write:** registry, routes, browser files, shared tests, plan, report  
**Prerequisite:** W1 contract is frozen and available  
**Deliverables:**

- Official `/api/v1/auth/key` and `/api/v1/credits` support.
- Correct handling of absent limits, reset policies, balances, and period usage.
- No activity endpoint unless a suitable management credential is separately authorized; that is out of scope.

**Validation:** mocked 200/401/403/429/5xx/malformed/timeout cases.

**Handoff:** `plans/planned/handoffs/multi-provider-usage-w2-openrouter.md`

### W3 — Experimental provider adapters

**Owner:** Implementation worker C  
**Writes:** Kimi, Copilot, and MiniMax provider modules plus adapter-local fixtures/tests  
**Must not write:** registry, routes, browser files, plan, report  
**Prerequisite:** W1 contract is frozen and available  
**Deliverables:**

- Kimi weekly/five-hour quota normalization and OAuth refresh handling.
- Copilot snapshot normalization using the stored GitHub-side credential, without sending the proxy token to GitHub REST.
- MiniMax remains normalization with explicit region/key handling.
- Experimental metadata and manual-first behavior signals.
- Defensive parsers for known schema variants without permissive secret/raw-payload fallback.

**Validation:** mocked fixture matrix and explicit credential-type mismatch tests.

**Handoff:** `plans/planned/handoffs/multi-provider-usage-w3-experimental.md`

### W4 — Consolidated browser Usage section

**Owner:** Implementation worker D  
**Writes:** `public/index.html`, `public/app.js`, `public/styles.css`, `public/service-worker.js`, frontend-focused tests  
**Must not write:** backend modules/routes, README, plan, report  
**Prerequisite:** W0 contract freeze; may use committed contract fixtures before backend completion  
**Deliverables:**

- One Usage accordion with progressive cards.
- Independent card loading/errors and refresh controls.
- Experimental disclosure and explicit first-fetch action.
- Stability/source/billing-scope labels.
- Preserved Codex Fast-mode placement and behavior.
- Accessible status, button, meter, and error semantics.

**Validation:** static UI tests, app/service-worker syntax checks, mobile layout assertions.

**Handoff:** `plans/planned/handoffs/multi-provider-usage-w4-frontend.md`

### W5 — Central integration

**Owner:** Integration owner  
**Writes:** shared route wiring, shared tests, README, plan progress records; minimal conflict fixes  
**Prerequisites:** qualifying W1 and at least one of W2/W3 plus W4 handoffs  
**Deliverables:**

- Inspect actual changes and handoffs; reject scope drift.
- Integrate provider registration in deterministic order.
- Verify old and new endpoints return equivalent Codex/Claude semantics.
- Add endpoint harness coverage and README guidance.
- Confirm experimental adapters cannot auto-fetch before consent.

### W6 — Integrated validation

Run from `pi-package-webui`:

```bash
node tests/provider-usage-contract.test.mjs
node tests/provider-usage-registry.test.mjs
node tests/provider-usage-adapters.test.mjs
node tests/provider-usage-static.test.mjs
node tests/codex-usage-auth.test.mjs
node tests/http-endpoints-harness.test.mjs
node tests/mobile-static.test.mjs
node --check public/app.js
node --check public/service-worker.js
node --check bin/pi-webui.mjs
npm test
npm run check
git diff --check
```

Where live account tests are unavailable, record that clearly. Never use production credentials in fixtures, logs, reports, or handoffs.

### W7 — Independent review quorum

Launch two distinct read-only, fresh-context reviewers after integration:

1. **Reviewer A:** architecture, credential security, endpoint stability, redaction, timeout/abort behavior, and compatibility.
2. **Reviewer B:** browser correctness, accessibility, provider semantics, test completeness, maintainability, and scope compliance.

Use distinct provider families from each other and from the primary implementation provider when available. Reviewers inspect the integrated diff and plan, do not edit files, and return file/line evidence.

**Handoffs:**

- `plans/planned/handoffs/multi-provider-usage-review-a.md`
- `plans/planned/handoffs/multi-provider-usage-review-b.md`

### W8 — Finding disposition and accepted fixes

The integration owner records exactly one disposition for every finding:

| Finding | Reviewer/run/model | Evidence | Severity | Disposition | Rationale | Revalidation |
|---|---|---|---|---|---|---|
| *(populate after review)* | | | | `accepted/rejected/deferred/needs verification` | | |

Only accepted, independently verified findings enter a fix pass. Re-run affected focused checks and the cross-workstream suite after fixes.

### W9 — Final report and plan archival

Create `reports/multi-provider-subscription-usage.html` using the `html-report` skill. Include:

- executive summary and provider support matrix;
- final architecture and sequence diagram;
- credential/security boundaries;
- implementation file map;
- compatibility and rollout behavior;
- test evidence and omitted live checks;
- reviewer findings/dispositions;
- residual risks and usage guidance.

Update the mutual links between report and plan. After all completion gates pass, move this plan and completed handoffs from `plans/planned/` to `plans/archive/`. `plans/archive/` is already Git-ignored; do not ignore `plans/planned/`.

## Worker contract requirements

Every implementation worker prompt must include:

- workstream/run identity and base revision;
- this plan path and prerequisite handoffs;
- exact allowed and forbidden write sets;
- approved decisions, non-goals, and security invariants;
- concrete deliverables and validation commands;
- unique handoff path;
- stop/escalation rules for unapproved API, auth, security, interface, dependency, or scope decisions.

Every accepted handoff must report:

- identity, status, base/result revision;
- changed files and summary;
- commands, exit codes, and relevant output;
- omitted validation;
- deviations and assumptions;
- unresolved decisions and residual risks;
- integration notes and artifact path.

## Acceptance matrix

| Area | Acceptance evidence |
|---|---|
| Contract | Schema validation rejects non-finite values, excessive arrays/strings, unknown units, and secret-like fields |
| Isolation | A provider timeout/failure leaves every other provider card usable |
| Credentials | Tests prove browser responses and logs contain no access/refresh token, API key, account ID, or raw payload |
| Codex parity | Existing fixtures produce equivalent plan/windows/reset/auth metadata through old and new routes |
| Claude parity | Existing CLI fixtures produce equivalent summary/windows/activity through old and new routes |
| OpenRouter | Official key and credit fixtures cover limited/unlimited/no-limit/reset variants |
| Kimi | Weekly and five-hour fixtures cover remaining/used variants and reset timestamps |
| Copilot | Legacy, free, current quota, absent AI-credit, and unsupported payloads are differentiated |
| MiniMax | Global/CN, remains aliases, provider error envelope, and plan-title absence are covered |
| Experimental consent | No experimental upstream request occurs before explicit browser action |
| UI/accessibility | Cards, meters, refresh controls, errors, badges, and live regions pass static assertions and manual keyboard review |
| Compatibility | Legacy endpoints remain functional and documented as transitional |
| Regression | Full package tests and checks pass |
| Governance | Two worker outcomes, two reviews, all dispositions, accepted-fix revalidation, and HTML report are recorded |

## Rollout and rollback

### Rollout

1. Land the registry and Codex/Claude migration behind compatibility aliases.
2. Enable OpenRouter automatic refresh when configured.
3. Expose Kimi, Copilot, and MiniMax cards as manual-first Experimental integrations.
4. Observe sanitized error classes and provider compatibility before considering automatic refresh for any experimental adapter.
5. Remove legacy routes only in a later separately approved release after consumers and tests migrate.

### Rollback

- Disable or unregister one failing adapter without reverting the registry or other providers.
- Point browser Codex/Claude loading back to compatibility aliases if generic routing regresses.
- Preserve old parser fixtures until the compatibility period ends.
- Revert browser consolidation independently only if the old static sections are retained during the migration commit; otherwise revert the complete browser wave atomically.
- Never roll back by weakening redaction, exposing credentials, scraping dashboards, or silently replacing authoritative values with estimates.

## Risks and mitigations

| Risk | Severity | Mitigation |
|---|---:|---|
| Private Kimi/Copilot/MiniMax schemas change | High | Experimental badge, manual-first fetch, strict adapters, fixture tests, independent disablement |
| Pi private credential-store API changes | High | Isolated compatibility module, runtime capability check, focused refresh/concurrency tests |
| Billing semantics become misleading | High | Required `metricKind` and `billingScope`; no invented limits; explicit source labels |
| Credentials leak through errors/logs | High | Server-only auth, fixed sanitized errors, bounded payloads, secret-pattern regression tests |
| Slow provider blocks the panel | Medium | Per-provider endpoint, independent state, timeouts, aborts, progressive rendering |
| Existing dirty changes conflict with implementation | High | W0 reconciliation; sequential shared-tree writes unless clean isolated worktrees are explicitly prepared |
| Claude CLI text changes | Medium | Preserve bounded parser fixtures and show parser-specific unavailable state |
| Remote/LAN WebUI broadens exposure | High | Reuse existing request authentication, return sanitized data only, review remote-route policy before integration |
| Legacy clients depend on old endpoints | Medium | Compatibility aliases for at least one release |
| Provider terms disallow private endpoint use | High | Experimental opt-in, no dashboard scraping, document source status, disable promptly if provider guidance conflicts |

## Decision record

| Date | Decision | Status | Evidence/rationale |
|---|---|---|---|
| 2026-07-31 | Use a provider adapter registry rather than adding more top-level hard-coded sections | Approved baseline | Existing Claude/Codex duplication scales poorly and couples UI to provider payloads |
| 2026-07-31 | Ship OpenRouter as official; Kimi/Copilot/MiniMax as experimental manual-first | Approved baseline | Matches API documentation/stability evidence |
| 2026-07-31 | Defer Gemini, Cursor, xAI, Qwen, Z.AI, OpenCode Go, Radius, and Xiaomi | Approved baseline | Missing Pi-native auth, individual API, or stable documented quota contract |
| 2026-07-31 | Preserve Codex Fast mode outside the usage-card contract | Approved baseline | Fast mode mutates session request behavior and is not usage data |
| 2026-07-31 | Keep legacy Codex/Claude endpoints for one compatibility release | Approved baseline | Limits migration and rollback risk |

## Progress record

| Date | Workstream | Status | Evidence |
|---|---|---|---|
| 2026-07-31 | Research and repository mapping | Complete | Local Pi/WebUI source inspection and official/private provider API review |
| 2026-07-31 | Canonical implementation plan | Complete | This document |
| — | W0-W9 implementation lifecycle | Not started | Requires separate implementation authorization |

## Completion checklist

- [ ] W0 contract and dirty-tree reconciliation recorded.
- [ ] At least two qualifying implementation-worker outcomes accepted.
- [ ] Provider registry, migrations, new adapters, and consolidated UI integrated.
- [ ] Focused and full validation evidence current.
- [ ] Two qualifying independent reviews completed.
- [ ] Every reviewer finding dispositioned.
- [ ] Accepted fixes revalidated.
- [ ] Final HTML report created and mutually linked.
- [ ] Residual risks and omitted live account checks documented.
- [ ] Plan moved from `plans/planned/` to `plans/archive/` only after all gates pass.
