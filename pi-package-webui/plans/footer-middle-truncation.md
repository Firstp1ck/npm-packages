# Footer Path Middle Truncation

Related report: [Footer Path Middle Truncation report](../reports/footer-middle-truncation.html)

## Objective and success criteria

Keep both the beginning and end of long working-directory values visible in the WebUI footer, eliding only the constrained middle instead of cutting off the path tail.

Success criteria:

- The enhanced git-footer `cwd` chip preserves a readable path prefix and suffix at constrained widths.
- The minimal TUI-style fallback footer applies the same behavior.
- Short values remain unchanged and full values remain available through the existing tooltip/title behavior.
- Dynamic git-footer value updates retain middle truncation.
- Focused tests, syntax checks, two qualifying independent reviews, and the final report validation pass.

## Scope and non-goals

In scope: the footer working-directory displays shown in the supplied screenshots, a reusable DOM helper, targeted responsive styling, focused regression coverage, independent review, and this plan/report pair.

Non-goals:

- No change to unrelated ellipsized model names, branch names, tab labels, file paths, or general text fields.
- No server payload or git-footer extension protocol change.
- No character-count truncation that guesses available viewport width.
- No redesign of footer layout, labels, tooltips, or click actions.

## Approved decisions and assumptions

- Scope is limited to the footer CWD/path value identified from the screenshots and source inspection.
- Use responsive DOM/CSS truncation rather than fixed string shortening: split the rendered value into a flexible prefix and fixed suffix. The prefix receives the ellipsis when space is constrained; the suffix remains visible.
- Preserve the existing complete value as the element's accessible concatenated text and in the existing full tooltip/title.
- Reuse one helper for enhanced and fallback footer variants.
- Split by Unicode code points so an astral character cannot be divided across separate spans.
- Keep the existing end-ellipsis behavior for short values that do not require a middle split.
- Preserve at least the complete final path component, including its nearest preceding `/` or `\`; the existing 16-character suffix remains the minimum when it reaches farther back.
- Treat POSIX and Windows separators equivalently, and skip trailing separators when locating the final component boundary.
- One writer owns all changes in the current worktree.

## Architecture and interfaces

`full CWD → code-point split helper (prefix + max[final 16 characters, nearest separator through tail]) → flex value container → prefix shrinks with ellipsis + complete final component stays visible`

- `public/app.js`
  - `splitMiddleTruncationText()` computes code-point-safe start/end parts, extends the suffix through the nearest POSIX or Windows separator, and retains at least six visible prefix characters before enabling split mode.
  - `setMiddleTruncatedText()` creates adjacent safe text spans only for split values; short values remain a normal text node.
  - `footerMeta()` opts enhanced metadata values into the helper.
  - `footerTuiItem()` provides equivalent support for the minimal fallback footer.
  - `renderGitFooterPayloadMeta()` limits the behavior to `chip.key === "cwd"`.
  - `updateGitFooterChipNodeValue()` preserves/removes the structured mode correctly during incremental updates.
- `public/styles.css`
  - `.middle-truncate-value` is the bounded flex container.
  - `.middle-truncate-start` has a six-character floor, shrinks, and owns `text-overflow: ellipsis`.
  - `.middle-truncate-end` is a fixed non-shrinking suffix.
- `tests/footer-middle-truncation.test.mjs`
  - Verifies short/boundary/long/disabled splits, complete POSIX and Windows final components, trailing separators, full reconstruction, Unicode boundary safety, both footer integrations, live updates, and the CSS contract.

## Ordered work items and dependencies

1. [x] Add the shared DOM helper and responsive styling.
2. [x] Integrate enhanced and fallback CWD renderers, including dynamic updates.
3. [x] Add focused regression tests and run targeted checks.
4. [x] Obtain two independent cross-provider reviews and disposition every finding.
5. [x] Apply only verified accepted fixes and rerun affected checks.
6. [x] Create and strictly validate the self-contained HTML report; finalize this plan.

### Follow-up: path-component-aware suffix

1. [x] Expand suffix selection through the nearest POSIX or Windows separator.
2. [x] Add POSIX, Windows, trailing-separator, and Unicode-boundary regression cases.
3. [x] Run focused and full verification.
4. [x] Obtain and disposition two fresh independent cross-provider reviews.
5. [x] Update and strictly validate the report and this execution record.

Dependencies/merge order: helper/style → renderer integration → focused tests → independent reviews → accepted fixes → final checks/report. One writer owns all edits.

## Implementation map

| File | Change |
|---|---|
| `public/app.js` | Shared code-point-safe split/DOM helper; enhanced and fallback CWD integration; incremental update handling. |
| `public/styles.css` | Responsive prefix/suffix flex rules that keep the path tail visible. |
| `tests/footer-middle-truncation.test.mjs` | Focused helper, renderer wiring, CSS, and Unicode regression coverage. |
| `plans/footer-middle-truncation.md` | Canonical decisions, evidence, review dispositions, and residual risks. |
| `reports/footer-middle-truncation.html` | Self-contained browser-readable implementation and audit report. |

## Acceptance tests and results

| Check | Result | Evidence |
|---|---|---|
| `node --check public/app.js` | Pass | Exit 0; no output. |
| `node --test tests/footer-middle-truncation.test.mjs` | Pass | TAP: 1 test file, 1 pass, 0 fail. |
| `npm run check` | Pass | All syntax checks and all 40 test files passed after accepted fixes. |
| `git diff --check -- ...` | Pass | No whitespace errors across implementation, test, plan, and report paths. |
| Strict HTML validator | Pass | `validate_report.py reports/footer-middle-truncation.html --strict`: PASS, no errors or warnings. |

A live browser/pixel-level visual test was not run because this workflow had no browser automation surface. The responsive behavior is supported by the focused source test, CSS cascade inspection, two independent reviews, and standard flex/overflow semantics.

## Independent review trace

Both reviewers were launched together as separately instantiated, fresh-context, read-only children in parallel run `ab63d39a-fbd2-47af-b872-3b9bff09c875`. They had separate child indexes, sessions, and outputs and did not see one another's conclusions before finishing.

### Qualifying reviewer A — Anthropic

- Child identity: parallel child 0; session run index 0.
- Exact runtime model: `anthropic/claude-opus-4-8:high`.
- Provider/model family: Anthropic / Claude.
- Verdict: approve with minor notes; confidence 88/100.
- Checks: `node --check public/app.js`, focused test, full `npm run check`, `git diff --check`, and manual source/CSS flow review all passed.

Findings and dispositions:

1. **Low: unsplit short values could lose their normal ellipsis — accepted and fixed.** `setMiddleTruncatedText()` now removes flex middle-truncation mode when no suffix split exists. `updateGitFooterChipNodeValue()` compares against the actual active split state, preventing repeated reconstruction. Focused and full checks pass.
2. **Low: hypothetical CWD in the main metric array could initially differ from its updated rendering — rejected.** Current installed git-footer source explicitly appends the CWD chip to `meta` (`node_modules/@firstpick/pi-extension-git-footer-status/index.ts`, `meta.push({ key: "cwd", ... })`). Extending behavior for an unsupported future payload shape is outside the approved scope and would add unnecessary complexity.
3. **Process: report was still pending during review — accepted and completed.** The linked self-contained report now exists and passes strict validation.

### Qualifying reviewer B — DeepSeek

- Child identity: parallel child 1; session run index 1.
- Exact runtime model: `openrouter/deepseek/deepseek-v4-pro:high`.
- Provider/model family: OpenRouter gateway / DeepSeek model family.
- Verdict: pass with no code findings; confidence 95/100.
- Checks: focused test, full `npm run check`, whitespace check, helper edge analysis, CSS compatibility, tooltip/accessibility retention, and plan compliance all passed.
- Metadata note: the review prose incorrectly self-labelled its provider as Anthropic. The Pi subagent runtime status records the actual child model as `deepseek-v4-pro` with high thinking; that structured runtime identity is used for gate eligibility and reporting.

### Parent verification finding

- **Unicode boundary splitting — accepted and fixed.** Independent reproduction showed that UTF-16 `slice()` can leave a high surrogate at the end of one span and a low surrogate at the start of another when an emoji lies exactly on the suffix boundary. The split helper now uses `Array.from()` code points, and the focused test asserts reconstruction plus absence of unpaired boundary surrogates.

## Follow-up independent review trace

The path-component-aware follow-up was reviewed by two new separately instantiated, fresh-context, read-only children in parallel run `e6bae8af-7ffa-49be-ae96-a17051cd4908`.

### Follow-up reviewer A — Anthropic

- Child identity: parallel child 0; session run index 0.
- Exact runtime model: `anthropic/claude-opus-4-8:high`.
- Provider/model family: Anthropic / Claude.
- Verdict: approve; confidence 90/100.
- Checks: syntax, focused test, all 40 package test files, whitespace, source flow, CSS cascade, POSIX/Windows/trailing separator behavior, Unicode, updates, and accessibility all passed.

Notes and dispositions:

1. **Oversized single final component may exceed available width — deferred as physical layout limit.** Showing the entire component and a meaningful prefix is impossible when their combined width exceeds the container. Mobile gives CWD a full row; the full value remains in the tooltip.
2. **Extremely narrow containers can clip a fixed suffix — deferred as the same acknowledged residual risk.** No proportionate code change can guarantee both ends below their combined minimum width.
3. **Code-point splitting is not grapheme-cluster splitting — deferred.** Filesystem paths with combining/ZWJ clusters are rare, current code prevents broken UTF-16 surrogate halves, and grapheme segmentation is outside the approved scope.
4. **Hypothetical main-array CWD asymmetry — rejected.** Current installed extension contract emits CWD only in `meta`; this is unchanged from the earlier disposition.
5. **Plan checkbox currency — accepted and fixed.** Follow-up status is current in this final plan.

### Follow-up reviewer B — DeepSeek

- Child identity: parallel child 1; session run index 1.
- Exact runtime model: `openrouter/deepseek/deepseek-v4-pro:high`.
- Provider/model family: OpenRouter gateway / DeepSeek model family.
- Verdict: pass with no actionable findings; confidence 93/100.
- Checks: syntax, focused/full tests, whitespace, 69/70 adversarial script cases with one identified false positive, reconstruction invariants, separator variants, Unicode, dynamic transitions, and CSS inheritance all passed.

Notes and dispositions:

1. **Very long final component suppresses split mode — deferred as duplicate of the physical-width limit above.**
2. **A short final component may preserve more than one component to maintain the 16-character minimum — accepted as intended behavior.** This exceeds rather than violates the requested minimum.
3. **Suffix spans inherit the parent color — accepted as verified current CSS behavior; no change needed.**

## Review status

- Implementation: complete.
- Focused and full verification: complete.
- Accepted review/parent fixes: complete and reverified.
- Initial qualifying review gate: complete (Anthropic + DeepSeek, separate outputs).
- Follow-up qualifying review gate: complete (fresh Anthropic child 0 + fresh DeepSeek child 1, distinct non-OpenAI provider/model families and separate outputs).
- Report: updated for the path-component follow-up and strictly validated.

## Residual risks

- Exact visual behavior was not exercised in a live browser; confidence relies on standard CSS flex/overflow semantics and static evidence.
- A container narrower than the six-character prefix floor plus the complete final component cannot preserve both ends without overflow. The actual desktop and mobile footer layouts provide substantially more space, and mobile gives the CWD a full row.
- Future footer payload contracts could place CWD outside `meta`; that unsupported hypothetical shape is intentionally not handled until the contract changes.

## Usage and verification guidance

Open the WebUI in a long working directory and narrow the viewport. Confirm the footer keeps the root/mount prefix and project-name suffix visible in both states:

1. git-footer extension payload available (enhanced `cwd` chip);
2. git-footer payload unavailable/disabled (minimal TUI-style footer).

Hover or focus the footer item to confirm the existing tooltip still exposes the complete original path. For repeatable checks:

```sh
cd /home/firstpick/npm-packages/pi-package-webui
node --test tests/footer-middle-truncation.test.mjs
npm run check
python3 /home/firstpick/.pi/agent/skills/html-report/scripts/validate_report.py reports/footer-middle-truncation.html --strict
```

## Report path

`reports/footer-middle-truncation.html`
