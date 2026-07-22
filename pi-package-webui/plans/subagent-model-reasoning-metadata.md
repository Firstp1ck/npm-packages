# WebUI subagent model and reasoning metadata

## Objective and success criteria

Show the effective model and reasoning effort for every tracked WebUI subagent wherever the child is identified: the Subagents side-panel row, the non-blocking output overlay, and the dedicated subagent terminal view.

Success means:

- running async children expose the effective `provider/model` and thinking/reasoning level from the pi-subagents lifecycle status;
- foreground children preserve explicit per-child or run-level model/thinking overrides and upgrade to effective runtime metadata when available;
- the browser and server normalize these values before display;
- absent legacy metadata degrades honestly to `model unknown` / `reasoning unknown` rather than inventing values;
- focused tests and the package test suite pass.

## Scope and non-goals

### In scope

- WebUI subagent bridge metadata collection and serialization.
- Server-side payload normalization.
- Side-panel, overlay, and virtual terminal metadata presentation.
- Static/contract tests and README documentation.

### Non-goals

- Changing pi-subagents lifecycle schemas or model selection.
- Adding model/reasoning controls to the WebUI.
- Persisting completed subagent history beyond the existing retained open view.
- Refactoring unrelated WebUI surfaces or the in-progress Git panel work already present in the working tree.

## Approved decisions and assumptions

- Display both values on every child identity surface, not only after opening output.
- Use the lifecycle status `steps[].model` and `steps[].thinking` as canonical effective metadata for async runs.
- Preserve the full provider-qualified model ID; label thinking as user-facing `reasoning`.
- Explicitly show `unknown` for legacy/unavailable metadata.
- Keep payload protocol version 1 because the fields are additive and optional.
- Existing uncommitted changes are user-owned; edits must be narrow and must not revert or reformat them.

## Architecture and interfaces

1. `webui-rpc-helper.mjs` enriches tracked child records with bounded `model` and `thinking` strings. Async runs read their canonical status file; foreground runs start from invocation overrides and accept effective model information from progress details when present.
2. `bin/pi-webui.mjs` allowlists and bounds both fields in overview and output payloads.
3. `public/app.js` uses one formatter to render `model …` and `reasoning …` consistently in the side panel, overlay pills, and subagent terminal header.
4. Existing `/api/subagents` and `/api/subagents/output` responses remain backward compatible.

## Work items

1. **Bridge metadata** — owner: implementation owner; files: `webui-rpc-helper.mjs`; dependency: none.
2. **Server normalization** — owner: implementation owner; file: `bin/pi-webui.mjs`; dependency: bridge fields.
3. **UI presentation** — owner: implementation owner; files: `public/app.js`, optionally `public/styles.css`; dependency: normalized payload.
4. **Tests/docs** — owner: implementation owner; files: `tests/mobile-static.test.mjs`, focused helper tests if available, `README.md`; dependency: implementation.
5. **Independent reviews** — two read-only reviewers from distinct non-OpenAI provider families; dependency: implementation and tests.
6. **Report** — `reports/subagent-model-reasoning-metadata.html`; dependency: tests and review dispositions.

Merge order: bridge → server → UI → tests/docs → review fixes → report. One writer owns the active worktree throughout.

## Acceptance tests

- Static test proves bridge collection, payload normalization, and all three display surfaces include model/reasoning metadata with unknown fallbacks.
- `npm test` passes.
- `npm run check` passes, or any unrelated pre-existing failure is recorded with evidence.
- Manual payload evidence or fixture demonstrates a status step such as `model: anthropic/claude-opus-4-8:high`, `thinking: high` reaches normalized UI facts.

## Risks

- Foreground progress may not expose fully resolved thinking metadata; explicit invocation metadata and honest unknown fallbacks avoid false claims.
- Nested async runs may require their own lifecycle directory; enrichment must target the child run ID rather than assume the parent status file.
- Frequent polling must avoid unnecessary RPC/status-file work once the run directory is known.
- The working tree contains unrelated in-progress Git panel changes; broad rewrites could corrupt them.

## Review status

- **Anthropic — Claude Opus 4.8, high reasoning:** approved with no blockers. One medium efficiency finding identified repeated same-directory `status.json` reads; fixed by caching parsed status once per lifecycle directory per refresh cycle. A low defense-in-depth finding about publish-time suffix derivation was also fixed. The reasoning-vocabulary drift note remains a low residual risk because the accepted Pi levels are intentionally allowlisted.
- **Google family through OpenRouter — Gemini 3.1 Pro Preview, high reasoning:** implementation approved; found one test-regex blocker after the cache-function signature changed. Fixed the assertion to include `statusByDir`, then reran the static test through all feature assertions.
- **Finding disposition:** all blocker and medium findings resolved. No unresolved material findings.

## Verification log

Implementation completed across the helper bridge, server normalization, browser presentation, fixtures, focused tests, and README.

- `node --check webui-rpc-helper.mjs && node --check bin/pi-webui.mjs && node --check public/app.js` — passed.
- `node tests/subagents-helper.test.mjs` — passed.
- `node tests/http-endpoints-harness.test.mjs` — passed.
- `git diff --check -- pi-package-webui` — passed.
- `npm test` — 27/28 test files passed; `mobile-static.test.mjs` reached and passed the new subagent assertions, then failed on the pre-existing dependency expectation `@firstpick/pi-extension-git-footer-status` (`^0.4.0` expected vs current package `^0.4.1`).
- `npm run check` — same single pre-existing `mobile-static.test.mjs` mismatch after all syntax checks and other test files passed.
- Post-review: `node tests/subagents-helper.test.mjs && node tests/http-endpoints-harness.test.mjs` — passed.
- Post-review: `node tests/mobile-static.test.mjs` — all feature assertions passed; execution reached the same unrelated dependency expectation at line 1729 (`^0.4.0` expected vs `^0.4.1` current).
- Post-review: source syntax checks and `git diff --check` — passed.
- `python3 scripts/validate_report.py reports/subagent-model-reasoning-metadata.html --strict` (from the `html-report` skill directory) — passed with no errors or warnings.

## Report

Final report: [`../reports/subagent-model-reasoning-metadata.html`](../reports/subagent-model-reasoning-metadata.html)
