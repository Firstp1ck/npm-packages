# Compact WebUI Sections

**Status:** Complete  
**Classification:** Lightweight — repository evidence shows a presentation-only change concentrated in `public/styles.css`, with no API, data-model, migration, security, or deployment contract changes.  
**Integration owner:** Main Pi session `019f9b1e-b611-78d0-bc54-384dd51d2309`  
**Report:** [`../reports/compact-webui-sections.html`](../reports/compact-webui-sections.html)

## Goal and success criteria

Make App Runner, the Subagents side-panel section, the Git changed-file browser, and Guided Git denser without removing controls, changing behavior, or weakening mobile touch targets.

Success means:

- desktop spacing, padding, gaps, and nonessential minimum heights are reduced in all four surfaces;
- Git changed-file rows reuse the Files tree visual language (transparent rows, inset hover/focus accent, and matching palette) while using a denser data-list height and shallower nested guides;
- long labels and metadata continue to truncate or wrap safely;
- coarse-pointer/mobile controls retain the existing 44px minimums;
- focused WebUI static checks pass and the package suite introduces no new failure;
- two fresh, independent reviewers from providers distinct from the implementation provider assess the integrated diff.

## Scope and non-goals

### In scope

- `public/styles.css`
- focused static CSS contracts in `tests/compact-sections-static.test.mjs`
- this plan and the final HTML report

### Non-goals

- changing App Runner, Subagents, Git, or Guided Git behavior;
- removing actions or explanatory content;
- changing side-panel section ordering, persistence, APIs, or server logic;
- globally changing the WebUI density preference.

## Decisions and invariants

1. Use scoped CSS refinements rather than markup/JavaScript changes because all requested surfaces already expose stable component classes.
2. Preserve mobile/coarse-pointer overrides, especially 44px Guided Git and Subagents configuration controls.
3. Keep semantic colors and focus/hover affordances; compactness must not hide state.
4. Treat the Files tree as the visual source for Git folder/file rows while allowing Git-specific tighter row height, padding, and indentation; retain Git status and line-stat colors.
5. Keep Git file rows at `1.55rem`, tighten directory summaries independently to `1.25rem`, and explicitly reset the generic `details { padding: 0.6rem; }` card styling on `.git-side-panel-folder`; the second screenshot proved that inherited container padding—not the summary row itself—caused the remaining ~1.2rem vertical separation. Keep zero inter-row gaps and `0.72rem` nesting steps (`0.48rem` margin plus `0.24rem` guide padding).
6. Do not touch the user's unrelated dirty files in the repository.

## Execution and acceptance

1. Update scoped component CSS and add focused static assertions.
2. Run syntax/static checks and the package test suite.
3. Inspect the final diff and confirm write boundaries.
4. Obtain the required independent review quorum and record dispositions below.
5. Save and verify the linked HTML report.

## Validation record

- `node tests/compact-sections-static.test.mjs` — **pass**; verifies all four surfaces, real Git/Files property parity, source ordering, and coarse-pointer selector coverage.
- `node tests/subagent-launch-slots-static.test.mjs` — **pass**.
- `node --check public/app.js` and `node --check tests/compact-sections-static.test.mjs` — **pass**.
- Scoped `git diff --check` — **pass**.
- HTML report strict validation — **pass**. The validator's only warning notes the intentional text/table-only format; exact CSS values are clearer here than a decorative graph or diagram.
- `npm test` — **52 of 53 test files pass**. The only failure is the pre-existing typography-floor assertion at `tests/mobile-static.test.mjs:298`, caused by unchanged `public/styles.css:7343` (`font-size: 0.72rem` in `.compact-tool-shell .message-role`). The feature block starts near line 10925 and does not interact with that selector.
- Write-boundary inspection — feature-authored changes are limited to `public/styles.css`, `tests/compact-sections-static.test.mjs`, this plan, and the linked report. The unrelated pre-existing `.composer-workflow-mode-button` hunk in the already-dirty stylesheet was not modified by this workstream.

## Independent review record

| Run | Requested route | Actual route/outcome | Gate status |
|---|---|---|---|
| `5d9553e1-9124-41f4-93e6-f8ee04068601` | Anthropic + OpenRouter | Anthropic requests returned 429; reviewer A fell back to OpenRouter and exceeded its turn budget. Reviewer B completed via OpenRouter on the pre-hardening diff. | Non-qualifying quorum |
| `90ea9bb1-66fc-4481-a057-74080a546cfa` | direct Google + OpenRouter | Google had no configured API key; Anthropic fallback returned 429; reviewer G therefore fell back to OpenRouter. Reviewer O also completed via OpenRouter. | Two outputs, one actual provider family — non-qualifying |
| `0c963c3f` | OpenRouter follow-up | Verified the final Guided Git coarse-pointer fix and focused test; no blockers remained. | Qualifying final-diff review from one provider family only |
| `a2910a72-a6b5-4dd1-9b00-3b361a2aa275` reviewer 0 + `94df0722` | OpenRouter Kimi K3 | Reviewed the screenshot-driven Git density revision and approved CSS, cascade, truncation, touch floors, and tests; the follow-up verified the expanded coarse-selector contract. | Qualifying current-diff review from OpenRouter |
| `a2910a72-a6b5-4dd1-9b00-3b361a2aa275` reviewer 1 | Anthropic Opus requested | Anthropic Opus 5 and 4.8 returned HTTP 429; runtime fell back to OpenRouter Kimi and then exceeded the turn budget. Its partial output therefore cannot count as an Anthropic review. | Non-qualifying; quorum still blocked |
| `8fea1f2c-93e1-441a-8632-e998474f4572` reviewer 0 + `506dc503` | OpenRouter Kimi K3 | Approved the directory-specific `1.25rem` override, confirmed file rows remain unchanged, and verified the final gap/chevron regression assertions. | Qualifying current-diff review from OpenRouter |
| `8fea1f2c-93e1-441a-8632-e998474f4572` reviewer 1 | Anthropic Fable 5 requested | Anthropic Fable 5 and Opus 4.8 returned HTTP 429; runtime fell back to OpenRouter Kimi and exceeded the turn budget. The route log identifies the partial output as OpenRouter. | Non-qualifying historical attempt |
| `073d4570-aea9-4f12-86a4-e2d20a9f5c17` | OpenRouter Kimi K3 + Anthropic Opus 5 | Both actual routes were verified from `PI_PROVIDER`/`PI_MODEL`; both independently approved the final generic-`details` padding reset and regression contract with no blockers. | **Two-provider quorum satisfied** |

### Finding dispositions

- **Accepted and resolved — compact controls on coarse pointers.** Added a post-compact `@media (pointer: coarse)` 44px floor for App Runner, Subagents controls, Git disclosures/rows, and Guided Git inputs.
- **Accepted and resolved — Guided Git step buttons.** Added `button.git-workflow-step` to the 44px coarse-pointer floor and to the selector-coverage test.
- **Accepted and resolved — one-sided Git/Files test.** The focused test now extracts both rule blocks and compares their actual shared properties, including hover/focus values.
- **Accepted and resolved — review-test ordering gap.** Tests assert compact-before-responsive and coarse-after-compact ordering, and confirm the Guided Git cancellation override occurs after compact rules.
- **Accepted and resolved — plan scope discrepancy.** Scope now names `tests/compact-sections-static.test.mjs`.
- **Accepted and resolved — incomplete Git coarse-selector contract.** Added repository toggle, tab, and folder-summary selectors to the test loop so removal of any 44px Git touch floor fails the focused suite.
- **Accepted and resolved — directory rows remained too spacious.** Kept accepted file rows at `1.55rem`, then added a later directory-only `1.25rem` override with zero vertical padding, `1.1` line height, and tighter label spacing.
- **Accepted and resolved — directory-density test hardening.** Added exact assertions for directory gap, chevron size, and chevron line height; OpenRouter follow-up `506dc503` reran the focused test and found no blocker.
- **Accepted and resolved — inherited `details` card padding.** The second screenshot exposed the actual remaining gap: generic `details { padding: 0.6rem; }` added about 19.2px around every directory container. `.git-side-panel-folder` now resets margin, padding, border, radius, and background, with tests pinning both the generic rule and component reset.
- **Deferred — computed-style screenshot automation.** Both reviewers found the static cascade conclusive; a manual post-reload visual check remains useful, but browser screenshot automation is outside this presentation-only patch.
- **Deferred — coarse-rule binding and duplicate-gap cleanup.** Reviewers noted optional static-test hardening and one intentionally overridden grouped `gap` declaration. Neither affects the current cascade or screenshot defect, so no post-review code churn was introduced.
- **Not feature-owned — composer workflow button hunk.** Reviewer inspection found a separate pre-existing `.composer-workflow-mode-button` change in the already-dirty stylesheet; this workstream did not modify or claim it.
- **Rejected — remove Git row `outline: none` as a blocker.** The visible border/background/inset accent remains, matches the Files tree treatment, and reviewers agreed it is parity-consistent. Forced-colors behavior remains a low-priority general follow-up for both trees, not a feature blocker.

### Gate result

The final integrated diff passed the required provider-diverse review in run `073d4570-aea9-4f12-86a4-e2d20a9f5c17`: OpenRouter Kimi K3 and direct Anthropic Opus 5 both reported their actual routes and approved with no blockers. Earlier provider failures remain recorded above for traceability but no longer block completion.

## Risks and rollback

- **Risk:** overly small controls on touch devices. **Mitigation:** preserve existing coarse-pointer/mobile 44px overrides and test them.
- **Risk:** dense Git rows diverge from Files styles later. **Mitigation:** static contracts explicitly tie the matching row properties together.
- **Rollback:** revert the scoped CSS/test changes and remove this plan/report; no data migration or persisted state is involved.
