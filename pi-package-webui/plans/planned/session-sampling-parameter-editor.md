# Per-session sampling-parameter editor

**Status:** Planned
**Classification:** Complex feature
**Integration owner:** Parent Pi session (`openai-codex/gpt-5.6-sol`, high)
**Report:** [session-sampling-parameter-editor.html](../../reports/session-sampling-parameter-editor.html)

## Goal and measurable success criteria

Add a dedicated **Sampling parameters** section to the WebUI Control Deck so each Pi tab/session can inspect, edit, apply, and clear a free-form JSON sampling-parameter object.

Success requires:

1. The section is a first-class collapsible/reorderable side-panel section and remains usable in desktop and mobile settings surfaces.
2. The editor accepts a JSON object, rejects invalid JSON/non-object roots without changing active state, and supports clearing the session override.
3. Applied values affect subsequent provider requests for only the active Pi session and survive session resume/tree navigation through Pi custom session entries.
4. Overrides apply only to Pi-documented compatible APIs: `openai-completions`, `openai-responses`, and `azure-openai-responses`; unsupported models remain unchanged and the UI explains that state.
5. Session values override model-level `samplingParams` per key without modifying `models.json` or global model configuration.
6. Focused runtime/API, UI/static, syntax, and integrated test checks pass.
7. Two implementation-worker handoffs, two independent fresh-context reviews, finding dispositions, and a current HTML report are recorded before completion.

## Classification rationale

The preliminary `complex` classification is confirmed by repository evidence. The feature has at least two meaningful implementation slices and crosses three contracts: the Pi extension runtime (`webui-rpc-helper.mjs`), the WebUI HTTP/RPC bridge (`bin/pi-webui.mjs`), and browser UI/state (`public/*`). It also introduces branch-aware session persistence, provider-request mutation, validation/security bounds for arbitrary JSON, and end-to-end tests. These satisfy multiple complex-feature criteria; no material evidence supports reclassification.

## Scope and non-goals

### In scope

- A top-level Sampling parameters Control Deck section.
- Free-form JSON-object editing with Apply and Reset actions.
- Current-model/API compatibility and model-default/effective-state feedback.
- Branch-aware per-session persistence through `pi.appendEntry()`.
- Request-time shallow top-level merge after Pi builds the provider payload.
- Tab-scoped GET/PUT API routes backed by the existing hidden WebUI helper command.
- Focused backend, frontend, accessibility/static, and integrated validation.

### Non-goals

- Editing `~/.pi/agent/models.json` or model-wide defaults.
- Inventing a fixed schema/range for provider-specific keys such as `top_k` or `min_p`.
- Applying arbitrary fields to Anthropic, Google, or other unsupported APIs.
- Adding a new dependency, database, global setting, or migration.
- Modifying the pre-existing package-version/dependency work in `package.json` or `package-lock.json`.

## Approved decisions, assumptions, and invariants

1. **Free-form JSON is the canonical editor.** Pi documents `samplingParams` as a free-form object, so a JSON textarea preserves server-specific values instead of constraining users to a guessed field list.
2. **Session state is durable and branch-aware.** The helper stores the latest normalized object as a custom session entry and restores the last entry on the active branch. Reset persists `{}` so old values do not reappear on resume.
3. **Runtime merge is shallow and last-wins.** For compatible APIs, the helper returns `{ ...event.payload, ...sessionSamplingParams }` from `before_provider_request`, matching Pi's documented verbatim top-level semantics.
4. **Unsupported APIs are fail-closed.** The helper never mutates their payloads. Existing session overrides remain stored so switching back to a compatible model restores their effect.
5. **The browser never writes provider payloads directly.** It sends only a bounded JSON object to a tab-scoped endpoint; normalization and compatibility checks stay in the Pi helper runtime.
6. **Bounds protect the RPC/UI channel without narrowing JSON semantics.** Root must be a plain object; serialized size and key count are bounded; JSON-compatible nested values remain allowed.
7. **No edits to user model configuration.** Model defaults are read-only context and session overrides are separate state.
8. **Dirty-worktree preservation.** Existing `package.json` and lockfile changes are user/pre-existing work and are outside both worker write boundaries.

## Execution DAG and workstream ownership

```text
Plan + contract
  └─ Wave 1: Runtime/API worker (A)
       └─ Wave 2: Browser/UI worker (B), consuming A's endpoint contract
            └─ Central integration + affected/cross-workstream validation
                 └─ Two fresh read-only reviewers in parallel
                      └─ Parent finding disposition / accepted-fix pass if needed
                           └─ Revalidation + HTML report + archive
```

Only one writer runs at a time in the shared dirty checkout. The parent integration owner alone updates this plan, integrates outcomes, dispositions findings, and claims completion.

### Workstream A — Pi runtime and HTTP bridge

**Owner:** implementation worker A  
**Prerequisite:** this plan  
**Allowed source writes:**

- `webui-rpc-helper.mjs`
- `bin/pi-webui.mjs`
- backend-focused test files selected by the worker under `tests/` (excluding `tests/mobile-static.test.mjs` and browser specs)
- unique handoff: `plans/handoffs/session-sampling-runtime.md`

**Forbidden/shared paths:** `public/**`, this canonical plan, reports, `package.json`, lockfiles, and worker B's tests.

**Deliverables:**

- Branch-aware sampling state restore/persist/set/get in the helper.
- Compatible-API-only `before_provider_request` payload merge.
- Tab-scoped GET/PUT endpoint(s) with bounded validation and useful errors.
- Backend-focused tests proving state normalization, reset, compatibility behavior, and route/helper wiring.

### Workstream B — Side-panel UI and browser state

**Owner:** implementation worker B  
**Prerequisites:** completed A handoff and integrated endpoint contract  
**Allowed source writes:**

- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `public/service-worker.js` only if existing cache-version conventions require it
- `tests/mobile-static.test.mjs`
- a focused browser/static test file under `tests/` that does not overlap A's files
- unique handoff: `plans/handoffs/session-sampling-ui.md`

**Forbidden/shared paths:** `webui-rpc-helper.mjs`, `bin/pi-webui.mjs`, this canonical plan, reports, `package.json`, lockfiles, and worker A's tests.

**Deliverables:**

- Dedicated collapsible/reorderable Sampling parameters section.
- Accessible JSON textarea, compatibility/model-default feedback, Apply and Reset actions, busy/error/success state, and stale-tab guards.
- Refresh on tab/session/model changes without clobbering an in-progress dirty draft.
- Mobile/static coverage and any focused browser-state coverage feasible in the existing harness.

## Validation contract

### Workstream A checks

- `node --check webui-rpc-helper.mjs`
- `node --check bin/pi-webui.mjs`
- focused new/updated backend tests
- `git diff --check -- webui-rpc-helper.mjs bin/pi-webui.mjs tests`

### Workstream B checks

- `node --check public/app.js`
- `node tests/mobile-static.test.mjs`
- focused new/updated UI tests
- existing compact/side-panel static tests selected from repository evidence
- `git diff --check -- public tests`

### Central integration checks

- `npm run check`
- focused HTTP/runtime test(s)
- focused UI/static test(s)
- browser test or direct user-flow probe when the local harness is available
- final `git diff --check`
- final diff inspection confirming package/lockfile changes were not altered

User-flow acceptance:

1. Open a session on a compatible OpenAI API model.
2. Enter `{ "temperature": 0.2, "top_p": 0.9 }`, apply it, and observe current/effective state.
3. Switch tabs and verify values remain isolated.
4. Resume/refresh the session and verify values restore.
5. Reset and verify the override becomes empty.
6. Select an unsupported API model and verify the UI disables or rejects application while provider requests remain untouched.

## Integration and rollback guidance

Integration order is A then B. The parent inspects both actual diffs and handoffs, verifies ownership boundaries, then runs combined checks. Any silent interface change, out-of-bound edit, missing required test, or invented product decision blocks integration.

Rollback is additive:

1. Remove the Sampling section and browser API calls.
2. Remove the GET/PUT route helpers.
3. Remove helper actions, persistence entry type, and provider-request hook.
4. Existing session files may retain inert custom entries safely; no migration is required.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Arbitrary keys break unsupported providers | Strict API allowlist before payload mutation. |
| Invalid or huge JSON exhausts the helper/RPC channel | Plain-object validation plus key/serialized-size limits. |
| Browser refresh overwrites unsaved edits | Track draft dirtiness and apply remote refresh only when clean or tab context changed. |
| Session switch leaks state | Restore from the active branch on `session_start` and `session_tree`; default to `{}`. |
| Model defaults and session overrides become ambiguous | Display defaults separately and return session/effective objects from the runtime state action. |
| Existing dirty dependency updates are overwritten | Explicitly forbidden paths and parent final diff inspection. |
| Hook order lets later extensions override values | Document that Pi extension load order remains authoritative; this helper applies its values at its registered hook position. |

## Decision and progress record

- **2026-08-06:** Confirmed Pi 0.84 documents free-form `samplingParams` only for OpenAI-compatible APIs and exposes no native RPC setter.
- **2026-08-06:** Selected the existing hidden `/webui-helper` command as the bridge and `before_provider_request` as the request mutation seam.
- **2026-08-06:** Confirmed complex classification because runtime, HTTP, browser, persistence, and validation are separate meaningful slices.
- **2026-08-06:** Repository is dirty only in package dependency/version files; parallel worktrees are disallowed, so two required writers will run sequentially with non-overlapping ownership.

## Required handoff and review records

### Implementation handoffs

| Workstream | Run/model | Status | Handoff | Changed files | Validation | Risks/deviations |
|---|---|---|---|---|---|---|
| A runtime/API | pending | pending | `plans/handoffs/session-sampling-runtime.md` | pending | pending | pending |
| B browser/UI | pending | pending | `plans/handoffs/session-sampling-ui.md` | pending | pending | pending |

### Independent reviews

Two distinct, fresh-context, read-only reviewer outputs are required after integration, using distinct provider families from each other and from the primary implementation provider when available.

| Review angle | Run/model | Status | Findings artifact |
|---|---|---|---|
| Runtime correctness, security, persistence, API contract | pending | pending | pending |
| UX, accessibility, stale-state behavior, tests/maintainability | pending | pending | pending |

### Finding dispositions

| Reviewer/run | File/symbol | Severity | Finding/evidence | Disposition | Parent rationale/verification |
|---|---|---|---|---|---|
| pending | pending | pending | pending | pending | pending |

## Completion gate

The feature remains **incomplete** until this plan records both qualifying worker outcomes, central integration evidence, current validation, two qualifying independent reviews, every finding disposition, revalidation of accepted fixes, and the linked self-contained HTML report. After all gates pass, move this file to `plans/archive/session-sampling-parameter-editor.md` and keep the report link current.
