# Open Issue Wizard — WS-1 Domain Handoff

## Workstream

- **Workstream / run identity:** WS-1 implementation worker — Open Issue Wizard domain model (`f00545fe-2480-48da-b5d5-2db501f6ec5c`, chain step 1/2)
- **Provider/model:** OpenAI / `openai-codex/gpt-5.6-terra` (xhigh)
- **Status:** Complete and validated within the assigned pure-domain boundary.
- **Base revision:** `df96479ae3617f079b3fcc0dccdb60095b25f3ba`
- **Resulting revision:** Uncommitted working-tree additions; no new commit was created.
- **Runtime output copy:** `.pi-subagents/artifacts/outputs/f00545fe-2480-48da-b5d5-2db501f6ec5c/plans/handoffs/open-issue-wizard-domain-agent-output.md`

## Changed files

- `pi-package-webui/public/issue-wizard-state.mjs` — pure catalog, reducer, validation, deterministic title/Markdown/payload generation, and the no-I/O unavailable submission seam.
- `pi-package-webui/tests/issue-wizard-state.test.mjs` — focused unit coverage for catalog derivation, compatibility, transitions, validation, normalization/escaping, serialization, and unavailable submission.

No shared UI, package, canonical-plan, report, backend, auth, persistence, dependency, or optional-feature catalog files were changed by this worker.

## Domain contract for WS-2 integration

- Call `createIssueWizardCatalog(optionalFeatureNames)` with caller-derived optional feature labels. The module contains no optional-feature names.
- Begin with `createIssueWizardState()` and apply actions through `reduceIssueWizardState(state, action, catalog)`.
- Supported actions: `select-category`, `select-component`, `select-template`, `set-summary`, `set-field`, `next`, `back`, and `reset`.
- Use `getCompatibleTemplates`, `isIssueWizardStepValid`, and `validateIssueWizardState` to render and gate pages.
- On valid state, use `buildIssuePayload` for `{ title, body }`, `issueClipboardText` for copy content, and `serializeIssuePayload` for exact JSON serialization.
- `submitIssueToGithubBot` is intentionally async, returns unavailable, and performs no I/O.

## Worker validation evidence

| Command | Result |
|---|---|
| `cd pi-package-webui && node --check public/issue-wizard-state.mjs` | Passed (exit 0) |
| `cd pi-package-webui && node tests/issue-wizard-state.test.mjs` | Passed |
| `git diff --check` | Passed |

Package-wide checks were intentionally deferred to integration.

## Deviations, assumptions, unresolved decisions, and residual risks

- The plan fixed categories and invariants but did not prescribe every template name or field label; the worker supplied one deterministic structured template per category.
- The generated catalog freezes returned data; the caller remains responsible for using `OPTIONAL_FEATURES` as the optional-feature source of truth.
- No unresolved product, backend, authentication, persistence, dependency, or security decision was introduced.

## Integration notes

The browser-safe ESM module has no dependencies or global I/O. Selection transitions reject unknown IDs and reset dependent template fields. `buildIssuePayload` rejects incomplete or invalid states and normalizes/escapes user prose before Markdown serialization.
