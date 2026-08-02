# WS2B Prompt/context test and fixture hardening handoff

## Identity and status

- Workstream: **WS2B Prompt/context test/fixture hardening**
- Role: implementation worker; second independently necessary recovery outcome after WS2A
- Status: **complete; ready for required independent review and parent integration**
- Scope: executable static/browser evidence only; no application, styles, index, producer, dependency, package, lock, release, or version source was changed
- Prerequisite evidence read: `plans/handoffs/prompt-context-webui-core.md` and the actual integrated `public/app.js`, `public/styles.css`, and `public/index.html` diff
- Context omission: requested root files `/home/firstpick/npm-packages/context.md` and `/home/firstpick/npm-packages/plan.md` do not exist, and repository searches found no matching lowercase files. Work followed the user contract, WS2A handoff, producer source, integrated UI diff, and current test state instead.

## Changed files

- `pi-package-webui/tests/stats-dashboard-static.test.mjs`
  - Isolates the Prompt/context normalizer/render region in a Node `vm` with a minimal DOM test harness.
  - Proves fully valid structured data creates all three native sections with zero raw line blocks.
  - Proves each malformed subsection falls back independently to its exact matching legacy line array.
  - Proves Command outputs preserves raw prompt-injection and prompt-detail strings, including hostile-looking text.
  - Executes null-versus-zero, numeric-string rejection, hostile-label preservation, and source/native rendering contracts.
  - Adds static responsive contracts for inventory stacking, semantic table row cards, data labels, wrapping, and absence of a nested Prompt/context table scroller.
- `pi-package-webui/tests/browser/stats-overlay.spec.mjs`
  - Enables the deterministic fixture only for this spec.
  - Exercises populated initial composition, five native inventory details groups, omitted counts, hostile labels, native progress semantics, actual-versus-heuristic disclosure, and zero/null presentation.
  - Exercises native `<details>/<summary>` keyboard operation and existing roving tab keyboard behavior.
  - Proves a malformed snapshot falls back alone to `promptDetailed`, leaving initial/current sections native.
  - Proves Command outputs retains raw prompt and detail content while a valid Prompt/context pane contains no `.stats-overlay-lines`.
  - Expands all details and checks horizontal overflow at 390×844 and 320×568, plus absence of fixed nested vertical scrollers in the Prompt/context subtree.
- `pi-package-webui/tests/fixtures/fake-pi.mjs`
  - Adds the bounded env gate `FAKE_PI_STATS_PROMPT_CONTEXT=1`.
  - Advertises `/stats-webui` only under that gate and emits deterministic valid or malformed-snapshot version-1 stats payloads.
  - Payload includes hostile/long labels, zero and null metrics, omitted inventory counts, raw sentinels, and responsive stress content.
- `plans/handoffs/prompt-context-tests.md`
  - This required handoff.

The progress artifact was maintained at the task-provided `.pi-subagents/artifacts/progress/.../progress.md` path. Pre-existing dirty/untracked test work was preserved with targeted edits; no reset, checkout, staging, or whole-file formatting was used.

## Tests added or updated

### Static executable contracts

`stats-dashboard-static.test.mjs` now executes the actual Prompt/context helpers/renderers rather than relying only on source regexes:

- valid `initialPrompt`, `snapshot`, and `currentContext` render native sections;
- valid structured Prompt/context renders zero legacy line blocks;
- malformed `initialPrompt`, `snapshot`, and `currentContext` each produce exactly one matching fallback line block;
- raw Command outputs keeps `RAW_PROMPT_INJECTION <keep>& exact` and `RAW_PROMPT_DETAILED </pre> exact` unchanged;
- explicit `0` and `null` remain distinct through normalization;
- a numeric string rejects only the malformed snapshot subsection;
- hostile-looking labels remain literal values and Prompt/context uses no HTML insertion API;
- responsive CSS keeps native tables/inventory wrap-based rather than nested-scroll based.

### Browser fixture/spec coverage

The focused Chromium spec uses the real Web UI server, real fake-Pi JSONL/SSE transport, actual application render path, and env-gated deterministic payload. It verifies:

- all three populated native sections and five details groups;
- no Prompt/context `.stats-overlay-lines` for valid structured payloads;
- text-safe hostile labels with no created `img`/`script` and no executed marker;
- zero-token rows, zero-character cards, null context window, and native progress ARIA/value text;
- visible actual-versus-heuristic disclosure and actual-minus-estimate result;
- keyboard opening of native details and omitted-count visibility;
- raw Command outputs preservation;
- isolated malformed-snapshot fallback to only `promptDetailed`;
- existing tab/tabpanel and roving keyboard behavior;
- no page/dialog/pane horizontal overflow at 390 and 320 pixels with all details expanded;
- no fixed nested vertical scroller inside the Prompt/context pane.

## Validation commands and outcomes

Final passing validation:

1. `node --check pi-package-webui/tests/fixtures/fake-pi.mjs && node --check pi-package-webui/tests/browser/stats-overlay.spec.mjs && node --check pi-package-webui/tests/stats-dashboard-static.test.mjs`
   - Exit 0; no output.
2. `node --test pi-package-webui/tests/stats-dashboard-static.test.mjs`
   - Exit 0; 1 test passed, 0 failed; emitted `stats-dashboard-static: all assertions passed`.
3. `cd pi-package-webui && ./node_modules/.bin/playwright test tests/browser/stats-overlay.spec.mjs --project=chromium`
   - Exit 0; 5 tests passed in 4.9s.
   - Includes the relevant existing stats tab/tabpanel and keyboard checks plus all new Prompt/context cases.
4. `git diff --check`
   - Exit 0; no output.
5. `git diff --cached --quiet`
   - Exit 0; no staged files.

Corrected diagnostic runs, retained for provenance:

- `node --test ...stats-dashboard-static.test.mjs` initially exited 1 because the new VM harness lacked a `statsPromptEstimateSourceLabel` stub. The harness was corrected; application source was not changed; final static runs passed.
- `npx playwright ...` from repository root exited 127 because Playwright is package-local. The corrected package-local binary command ran.
- The first package-local browser run had 2 passes/3 failures because an early DOM-open path could precede command-catalog readiness and therefore had no fixture payload. The spec was corrected to dispatch the env-gated fixture through the real `/api/prompt` path before selecting Prompt/context.
- The next browser run had 4 passes/1 failure because `getByText("0 chars")` correctly found two matching zero presentations. The assertion was narrowed to the snapshot badge; final browser runs passed 5/5.

## Omissions

- No deterministic fixture omission: the required bounded structured/malformed payload fixture was added without architecture expansion.
- WebKit was not run; package default and requested focused validation use Chromium.
- No full monorepo suite was run. The focused static test and entire stats overlay Chromium spec include the relevant existing checks for this bounded workstream.
- No source fix is claimed or included.

## Blocker findings

- **No integration blocker found.** The populated payload, independent snapshot fallback, raw tab preservation, details/progress semantics, keyboard behavior, and narrow viewport checks all passed against the integrated UI.
- The absent requested root `context.md`/`plan.md` files are a context artifact omission, not an implementation blocker; the canonical WS2A handoff and actual source/diff were available.

## Risks and parent integration notes

- The fake-Pi addition is strictly env-gated, so existing fixture consumers retain their prior command list and behavior unless `FAKE_PI_STATS_PROMPT_CONTEXT=1` is set.
- Static VM coverage intentionally uses a minimal DOM harness; the focused real-browser suite supplies the complementary native DOM/ARIA/layout evidence.
- Shared test files were already untracked dirty-tree work before WS2B. Parent integration should preserve them as a unit and inspect the Prompt/context sections rather than treating file creation provenance as WS2B-only.
- The shared tree contains unrelated source/test changes. Parent should integrate only these three owned test/fixture files and this handoff; no app/styles/index/producer changes are part of WS2B.
- Required independent acceptance review remains parent-owned.
- Confidence: **97/100**. Final syntax, executable static normalization/render contracts, real Chromium transport/render behavior, 390/320 overflow, whitespace, and no-staged-files evidence passed. Confidence is below 100 because WebKit and the full monorepo suite were intentionally not run.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Changed only the two authorized stats test files, the bounded env-gated fake-Pi fixture, and the required handoff; no app/styles/index, producer, package, lock, release, version, or unrelated fixture source was edited."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Executable static VM contracts and the complete focused Chromium stats spec passed, covering structured native rendering, independent fallback, hostile/null/zero handling, raw preservation, details/progress semantics, keyboard behavior, and 390/320 overflow."
    }
  ],
  "changedFiles": [
    "pi-package-webui/tests/stats-dashboard-static.test.mjs",
    "pi-package-webui/tests/browser/stats-overlay.spec.mjs",
    "pi-package-webui/tests/fixtures/fake-pi.mjs",
    "plans/handoffs/prompt-context-tests.md"
  ],
  "testsAddedOrUpdated": [
    "pi-package-webui/tests/stats-dashboard-static.test.mjs",
    "pi-package-webui/tests/browser/stats-overlay.spec.mjs",
    "pi-package-webui/tests/fixtures/fake-pi.mjs"
  ],
  "commandsRun": [
    {
      "command": "node --check pi-package-webui/tests/fixtures/fake-pi.mjs && node --check pi-package-webui/tests/browser/stats-overlay.spec.mjs && node --check pi-package-webui/tests/stats-dashboard-static.test.mjs",
      "result": "passed",
      "summary": "Exit 0; all owned JavaScript modules parse."
    },
    {
      "command": "node --test pi-package-webui/tests/stats-dashboard-static.test.mjs",
      "result": "passed",
      "summary": "Exit 0; 1 test passed, 0 failed."
    },
    {
      "command": "cd pi-package-webui && ./node_modules/.bin/playwright test tests/browser/stats-overlay.spec.mjs --project=chromium",
      "result": "passed",
      "summary": "Exit 0; 5 tests passed in 4.9s."
    },
    {
      "command": "git diff --check",
      "result": "passed",
      "summary": "Exit 0; no whitespace errors in tracked diffs."
    },
    {
      "command": "git diff --cached --quiet",
      "result": "passed",
      "summary": "Exit 0; no staged files."
    }
  ],
  "validationOutput": [
    "syntax-check-exit=0",
    "TAP: tests 1, pass 1, fail 0",
    "stats-dashboard-static: all assertions passed",
    "Chromium stats-overlay.spec.mjs: 5 passed (4.9s)",
    "git-diff-check-exit=0",
    "cached-diff-exit=0"
  ],
  "residualRisks": [
    "WebKit and the full monorepo suite were not run; focused Chromium and relevant existing stats checks passed.",
    "Shared test files predated WS2B as untracked dirty-tree work, so parent integration must preserve their existing non-WS2B cases."
  ],
  "noStagedFiles": true,
  "diffSummary": "Adds executable Prompt/context renderer/normalizer contracts, an env-gated structured/malformed stats fixture, and focused browser coverage for native UI, fallback, raw preservation, semantics, keyboard behavior, and narrow overflow.",
  "reviewFindings": [
    "no blockers found; required independent review remains pending"
  ],
  "manualNotes": "Requested root context.md and plan.md were absent. No source fixes were made or claimed."
}
```
