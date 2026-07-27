# Open Issue Wizard — Implementation Plan

**Status:** Complete — feature checks and independent quorum passed; package baseline exceptions recorded  
**Classification:** Complex  
**Integration owner:** Main Pi agent  
**Final report:** [`../reports/open-issue-wizard.html`](../reports/open-issue-wizard.html)

## Goal

Add a bottom-right **Open Issue** action to the Pi WebUI Control Deck. The action opens an accessible five-step wizard that produces a structured GitHub issue, supports copying the complete result, and exposes a disabled future-bot submission boundary without claiming that submission works today.

## Classification rationale

This feature is complex because it has two independently verifiable slices (domain/template generation and browser UI integration), crosses reusable state, HTML, CSS, and browser event contracts, needs responsive accessibility behavior, and requires explicit rollout behavior for an unavailable submission service.

## Approved decisions and invariants

1. Title format is `[Category] [Component] [Template] Short summary`.
2. Users select exactly one category, one component, and one compatible template.
3. Categories are Feature, Bug, UX, Documentation, Performance, Compatibility, and Other. Security is intentionally omitted to avoid steering sensitive reports into public issues.
4. Components are WebUI plus all entries from the existing optional-feature catalog. The issue wizard derives optional-feature labels from the same `OPTIONAL_FEATURES` constant used by the Control Deck.
5. Forms favor buttons, radio-like choices, and dropdowns. Free input is limited to the short summary and template fields where prose is unavoidable.
6. The final page shows the complete title and Markdown body and provides one-click copying of both.
7. **Send to GitHub bot** remains visible but disabled with a clear “Coming soon” explanation. No network request is made. A narrow async adapter is kept as the future integration point.
8. The dialog uses native `<dialog>` behavior, restores focus through the WebUI’s existing modal instrumentation, responds to Escape, and provides Back/Continue navigation with one wizard page visible at a time.
9. No server endpoint, GitHub token, repository mutation, or external side effect is introduced.

## Success criteria

- [x] A persistent Open Issue button appears at the bottom-right of the expanded Control Deck without scrolling away with accordion content.
- [x] Activating it opens a labelled five-step modal and starts on category selection.
- [x] Back and Continue preserve answers; Continue is disabled until the current step is valid.
- [x] Category, component, and template selections deterministically produce the required title prefix.
- [x] Component choices include WebUI and the existing optional-feature labels without a second duplicated catalog.
- [x] Template forms render structured controls and minimal prose inputs appropriate to the selected category/template.
- [x] The review page renders the exact title and Markdown body and copies a complete issue payload.
- [x] The bot action is visible, disabled, and performs no request.
- [x] Desktop/mobile layout, keyboard focus, Escape behavior, and status announcements are covered by static/unit assertions and package checks.
- [x] Two implementation handoffs, integrated checks, two provider-diverse independent reviews, finding dispositions, and the final HTML report are recorded here.

## Scope

### In scope

- Pure wizard catalog/state/validation/serialization module.
- Unit tests for title/body generation, compatibility filtering, required fields, state transitions, and escaping/normalization.
- Control Deck footer action and five-step `<dialog>` markup.
- Responsive wizard styling and selection/preview states.
- Browser rendering, event handling, clipboard action, status messaging, and future submission adapter.
- Static integration tests and package check wiring.

### Non-goals

- Implementing or calling a GitHub bot.
- GitHub authentication, token storage, OAuth, issue creation APIs, or backend endpoints.
- Persisting drafts across reloads.
- File attachments, log collection, or automatic environment fingerprinting.
- Public security-report intake.
- Refactoring unrelated areas of the monolithic `public/app.js`.

## Architecture

```text
OPTIONAL_FEATURES (existing catalog)
          │ labels
          ▼
issue-wizard-state.mjs ── catalog / reducer / validation / title + Markdown serialization
          │
          ▼
app.js controller ── renders one step, binds controls, copies output, gates future submit
          │
          ├── index.html: fixed Control Deck footer + accessible dialog shell
          └── styles.css: desktop/mobile wizard and selection states
```

The pure module owns deterministic data and transformations; DOM code owns presentation and browser effects. `submitIssueToGithubBot(payload)` is the only future submission seam and must currently return an unavailable result without performing I/O.

## Execution DAG and ownership

### Wave 1 — WS-1: Domain model and tests

**Worker:** implementation worker 1  
**Prerequisites:** approved plan, clean working tree  
**Write boundary:**

- `pi-package-webui/public/issue-wizard-state.mjs`
- `pi-package-webui/tests/issue-wizard-state.test.mjs`
- `plans/handoffs/open-issue-wizard-domain.md`

**Forbidden/shared paths:** `public/app.js`, `public/index.html`, `public/styles.css`, `package.json`, this plan, report files.

**Deliverables:** category/template catalog, state transitions, compatibility selection, structured field definitions, validation, title/Markdown/complete-payload generation, future submission adapter, unit tests.

**Validation:** `node --check public/issue-wizard-state.mjs`; `node tests/issue-wizard-state.test.mjs`.

**Stop/escalate:** any need for a backend endpoint, authentication, a new dependency, persistence, catalog duplication, or title-format change.

### Wave 2 — WS-2: Browser integration and static coverage

**Worker:** implementation worker 2  
**Prerequisites:** WS-1 files and tests pass  
**Write boundary:**

- `pi-package-webui/public/app.js`
- `pi-package-webui/public/index.html`
- `pi-package-webui/public/styles.css`
- `pi-package-webui/tests/open-issue-wizard-static.test.mjs`
- `plans/handoffs/open-issue-wizard-interface.md`

**Forbidden/shared paths:** WS-1 module/test, `package.json`, this plan, report files.

**Deliverables:** bottom-right Control Deck action, dialog shell, controller/rendering/event integration, clipboard behavior, disabled bot action, responsive/a11y styling, static tests.

**Validation:** `node --check public/app.js`; `node tests/open-issue-wizard-static.test.mjs`; rerun WS-1 test.

**Stop/escalate:** any product change, network call, unsafe HTML injection, optional-feature catalog duplication, or unrelated `app.js` refactor.

### Wave 3 — Integration owner

1. Inspect actual diff, changed-file boundaries, handoffs, and tests from both workers.
2. Add `public/issue-wizard-state.mjs` to the package syntax-check script if needed.
3. Resolve integration defects only after verifying evidence.
4. Run targeted tests, full `npm test`, and `npm run check` from `pi-package-webui`.
5. Inspect responsive/focus semantics from source and, when available, run a browser-focused smoke test.
6. Update progress and evidence in this plan.

### Wave 4 — Independent review quorum

Two fresh-context, read-only reviewers from providers distinct from each other and from the OpenAI implementation provider assess the integrated diff for architecture, correctness, security, edge cases, tests, maintainability, and plan compliance. Each finding receives an integration-owner disposition and evidence.

### Wave 5 — Report and completion

Create and validate `reports/open-issue-wizard.html` with implementation, evidence, reviewer dispositions, residual risks, and rollout guidance. Keep bidirectional links between report and plan.

## Acceptance checks

| Check | Command/evidence | Required result |
|---|---|---|
| Pure state behavior | `node tests/issue-wizard-state.test.mjs` | Pass |
| Static browser contract | `node tests/open-issue-wizard-static.test.mjs` | Pass |
| JavaScript syntax | `node --check public/app.js && node --check public/issue-wizard-state.mjs` | Pass |
| Package tests | `npm test` | Wizard tests pass; unrelated baseline failures are documented without a false green claim |
| Package check | `npm run check` | Changed-file syntax passes; the same unrelated baseline failures are documented |
| No bot side effect | source/static assertion | Adapter performs no fetch/API call and Send is disabled |
| Catalog source of truth | source/static assertion | UI passes `OPTIONAL_FEATURES` labels into the pure model; no duplicate optional-feature list |
| Accessibility | markup/static assertions | labelled dialog, progress semantics, one visible step, keyboard buttons, live status, focus restoration |
| Responsive UI | CSS/static assertions | footer remains visible; dialog and controls adapt at mobile breakpoint |

## Integration and rollback guidance

- Integration order is WS-1 then WS-2, followed by the package script update and combined tests.
- Rollback is file-local: remove the Control Deck footer/dialog/controller/styles/tests/module and restore the package check entry. No persisted schema or backend state needs migration.
- The future bot can be enabled later by implementing the adapter and adding an authenticated server contract in a separate security-reviewed feature.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Optional-feature labels drift | Reuse `OPTIONAL_FEATURES`; never duplicate its catalog in HTML or the pure module. |
| User prose injects HTML/Markdown unexpectedly | Render previews with text-safe paths and serialize normalized plain text; never assign user content with `innerHTML`. |
| Long content overflows on mobile | Bounded dialog layout, scrolling content region, wrapping option cards, sticky navigation. |
| Disabled Send is mistaken for a failure | Label it “Send to GitHub bot (coming soon)” and provide a working copy action plus status text. |
| State becomes inconsistent when earlier choices change | Reducer resets dependent template/form state when category or component changes. |
| Large `app.js` integration causes regression | Keep controller cohesive, import pure helpers, add static contracts, and run full package checks. |

## Decision record

| Decision | Status | Evidence |
|---|---|---|
| Use recommended defaults | Approved by user | User response: “use defaults” |
| Complex classification | Approved by integration owner | Cross-file UI + pure domain slice + accessibility and rollout contract |
| Bot disabled until implemented | Approved | Avoids false success and unauthorized external side effects |

## Progress record

| Workstream | Run identity | Provider/model | Status | Handoff | Validation |
|---|---|---|---|---|---|
| WS-1 Domain | `f00545fe-2480-48da-b5d5-2db501f6ec5c` step 1/2 | OpenAI / `gpt-5.6-terra` xhigh | Complete | `plans/handoffs/open-issue-wizard-domain.md` | Syntax + domain tests passed |
| WS-2 Interface | `f00545fe-2480-48da-b5d5-2db501f6ec5c` step 2/2 | OpenAI / `gpt-5.6-terra` xhigh | Complete | `plans/handoffs/open-issue-wizard-interface.md` | App syntax + domain/static tests passed |
| Integration | Main agent | OpenAI / `gpt-5.6-sol` | Complete | This plan | Targeted checks passed; package-wide run completed with 7 unrelated pre-existing/environmental failures |

### Integration evidence

- Added the new ESM module to the server static allowlist, PWA app shell, and package syntax-check chain.
- Added template descriptions/field previews and preserved focus after dynamic rerenders.
- Updated browser asset cache-busters and their static-test contracts.
- `node tests/issue-wizard-state.test.mjs`, `node tests/open-issue-wizard-static.test.mjs`, `node tests/boot-failure-diagnostics.test.mjs`, and `node tests/fast-mode-client-static.test.mjs` pass.
- `npm test` and `npm run check` reached the full 66-file suite; 59 passed and 7 failed for unrelated existing Windows/temp-lock/ConPTY/RPC/path/font-floor conditions. The unchanged `font-size: 0.72rem` failure is present on `HEAD`; no wizard-specific test failed.
- No supported browser automation dependency or installed browser executable was available; responsive/focus/Escape behavior was verified by source contracts, static tests, and two independent reviews rather than live browser automation.
- `reports/open-issue-wizard.html` passed the html-report strict validator with five major sections, one overview table, one accessible architecture SVG, no remote/local dependencies, no errors, and no warnings.

## Independent review record

| Reviewer | Run identity | Provider/model | Status | Findings | Dispositions |
|---|---|---|---|---|---|
| Reviewer A | `f7f26ed6-8968-4e97-a5fc-6bd4bccb75e6` | Anthropic / `claude-opus-4-8` high | Complete, qualifying | 5 non-blocking | 3 accepted/fixed, 1 informational accepted, 1 deferred |
| Reviewer B | `bac5c395-2b13-4662-ba9d-c22dff2d45ac` | Google family via OpenRouter / `gemini-3.5-flash` high | Complete, qualifying fallback | No blockers/findings | Accepted; coverage overstatement qualified |

Review artifacts: [`reviews/open-issue-wizard-anthropic.md`](reviews/open-issue-wizard-anthropic.md) and [`reviews/open-issue-wizard-google.md`](reviews/open-issue-wizard-google.md).

## Finding disposition log

| ID | Disposition | Rationale and verification |
|---|---|---|
| A-N1: unrelated suite failures | **Accepted (informational)** | Recorded without changing unrelated code; dedicated feature checks pass. |
| A-N2: incomplete ARIA radio pattern | **Accepted and fixed** | Replaced radio roles with `aria-pressed` toggle-button semantics and labelled groups; static regression assertions pass. |
| A-N3: bracket-only summary | **Accepted and fixed** | Shared post-strip title normalization now gates validation and payload generation; unit regression passes. |
| A-N4: GitHub autolinks | **Deferred** | Copy-only, user-reviewed content may intentionally reference users/issues. Reassess before enabling automated bot submission. |
| A-N5: duplicate live announcements | **Accepted and fixed** | Progress is no longer a live region; the status region is the single announcer; static regression passes. |
| B: no feature defects | **Accepted** | Independent evidence agrees with targeted checks; “zero coverage gaps” language is qualified because no live browser harness was available. |
