# WS1 Prompt/context structured producer contract handoff

## Identity and status

- Workstream: **WS1 Prompt/context structured producer contract**
- Run role: implementation worker 1
- Status: **complete; ready for parent integration and WS2 consumption**
- Feature-level status: incomplete until WS2, central integration, review quorum, report, and archive gates complete
- Base revision: `ce2072e2948a0b2d9a946bb416904f411d8aa411`
- Result revision: `ce2072e2948a0b2d9a946bb416904f411d8aa411` plus the current unstaged working-tree changes (no commit created)

The preliminary complex classification remains correct: this producer contract is one of two meaningful cross-component slices, adds privacy/size-sensitive wire data, and requires later Web UI integration and independent review. Root `context.md` and `plan.md` were absent; the canonical source of requirements was `plans/planned/prompt-context-native-dashboard.md` as directed.

## Changed files

- `pi-extension-stats/index.ts`
  - Adds producer-owned typed source kinds/identities and shared builders for `promptContext.initialPrompt`, `.snapshot`, and `.currentContext`.
  - Calibrates initial component rows with largest remainder so component tokens equal `totalTokens` exactly.
  - Keeps actual current-context utilization separate from heuristic character-derived source composition.
  - Adds deterministic caps, aggregate `other-omitted` rows, explicit inventory omitted counts, bounded text, and portable privacy-safe path display.
  - Clears stale `latestSystemPromptOptions` on `session_start` alongside the existing pending-measurement reset.
  - Retains payload version 1, legacy `promptEstimate`, all `lines.*`, and command formatters; initial/current legacy rows reuse the same underlying builders/sources.
- `pi-extension-stats/tests/stats-payload.test.mjs`
  - Extends the fixture harness for prompt options, tools, branch messages, context usage, event lifecycle, and reconstruction failures.
  - Adds structured invariants, caps/omitted counts, privacy, size, deterministic output, null/zero/malformed data, Windows/POSIX path redaction, lifecycle reset, current usage, branch reconstruction, and retained legacy-line coverage.
- `pi-extension-stats/README.md`
  - Documents additive version-1 `promptContext`, exact calibration, actual-vs-heuristic separation, caps/privacy, and legacy compatibility.

No package, version, lock, dependency, Web UI/browser, plan, or report source was changed by this workstream. The required progress and handoff artifacts are operational outputs, not implementation scope.

## WS2 integration contract

The optional additive root field is `promptContext`; payload `version` remains `1`.

### `promptContext.initialPrompt`

- `totalTokens`
- `lowTokens`
- `highTokens`
- `confidence`
- `source`
- `warning` (`string | null`)
- `estimateMethod`: `"weighted-character-estimate-with-largest-remainder-calibration"`
- `components[]` (maximum 24)
  - `id`
  - `kind`
  - `label`
  - `chars` (`number | null`)
  - `uncalibratedTokens`
  - `tokens`
  - `percent` (`number | null`)

Component `tokens` sum exactly to `totalTokens` when nonzero; finite percentages use `totalTokens`. Overflow is combined as `id: "other-omitted"`, `kind: "other"`.

### `promptContext.snapshot`

- `source`
- `settled`
- `attempts`
- `warning` (`string | null`)
- `systemPromptChars`
- `estimateComponents`
  - `promptText`
  - `toolSchemas`
  - `framing`
  - `calibration.multiplier`
  - `calibration.samples`
- `metadata`
  - `currentDate` (`string | null`)
  - `cwdDisplay` (`string | null`, basename only)
  - `extraGuidelineCount`
- `tools`
  - `totalCount`
  - `omittedCount`
  - `items[]` (maximum 12): `name`, `description` (`string | null`), `parameterSummary`, `estimatedTokens`
- `toolPromptEntries`
  - `totalCount`
  - `omittedCount`
  - `names[]` (maximum 24)
- `skills`
  - `totalCount`
  - `omittedCount`
  - `items[]` (maximum 10): `name`, `description` (`string | null`)
- `contextFiles`
  - `totalCount`
  - `omittedCount`
  - `items[]` (maximum 8): `displayPath`, `chars` (`number | null`)

No tool parameter schema, skill location, context content, or full external path is included. Context paths inside cwd are relative; external paths are basename-only. Both POSIX and Windows path forms are handled.

### `promptContext.currentContext`

- `usage`
  - `tokens` (`number | null`)
  - `contextWindow` (`number | null`)
  - `percent` (`number | null`)
- `breakdown`
  - `estimateMethod`: `"weighted-character-estimate"`
  - `reconstruction`: `"complete" | "unavailable"`
  - `estimatedTotalTokens`
  - `actualMinusEstimatedTokens` (`number | null`)
  - `sources[]` (maximum 24)
    - `id`
    - `kind`
    - `label`
    - `chars`
    - `estimatedTokens`
    - `percent` (`number | null`)

Current source percentages use `estimatedTotalTokens`, never actual provider usage. `usage` is independently provider/context-derived. Overflow is combined as `other-omitted`.

### Producer-defined kinds and IDs

Kinds are: `system-prompt`, `tools-prompt`, `custom-prompt`, `append-system`, `context-file`, `skills`, `tool-schemas`, `framing`, `user-messages`, `assistant-messages`, `assistant-tool-calls`, `tool-results`, and `other`.

Normal IDs are stable producer-assigned `<kind>-<occurrence>` values for identical input. WS2 must consume `kind`/`id` and must not infer semantics from `label`.

### Legacy compatibility

These remain present and are the WS2 section-fallback/raw-command sources:

- `promptEstimate`
- `lines.promptInjection`
- `lines.promptDetailed`
- `lines.tokenBreakdown`
- every other existing `lines.*`

WS2 owns independent structured-section normalization/fallback and all browser/UI changes.

## Validation evidence

Passed:

1. `node --experimental-strip-types --test pi-extension-stats/tests/stats-payload.test.mjs` — exit 0; 10 tests passed, 0 failed. Node emitted only existing typeless-package warnings for `pi-extension-stats` and `pi-utils`.
2. `node --experimental-strip-types --check pi-extension-stats/index.ts && git diff --check -- pi-extension-stats/index.ts pi-extension-stats/tests/stats-payload.test.mjs pi-extension-stats/README.md` — exit 0; no output.
3. `cd pi-extension-stats && npm pack --dry-run --json` — exit 0; package `@firstpick/pi-extension-stats@0.2.9`, 5 packed files, no package/version/lock mutation.
4. `git diff --check -- pi-extension-stats/index.ts pi-extension-stats/tests/stats-payload.test.mjs pi-extension-stats/README.md; ...; git diff --cached --quiet` — both exit 0; no staged files.

Superseded/diagnostic command failures:

- `npm pack --dry-run --json` from repository root — exit 1 (`Invalid package, must have name and version`); rerun successfully from `pi-extension-stats` as required.
- `cd pi-extension-stats && npx --no-install tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck index.ts` — exit 1 because a TypeScript compiler is not installed/available; no dependency was installed. Type-stripped execution and syntax checks passed instead.

Omissions:

- No browser/static Web UI tests were run; those are WS2-owned and no Web UI file was edited.
- No standalone TypeScript type-check was possible because the repository/package has no available TypeScript compiler.
- No full monorepo test was run; requested producer-focused checks and package dry run passed.

## Deviations, assumptions, unresolved decisions, and risks

- Deviations: none from the approved payload-v1, privacy, legacy, dependency, and ownership decisions.
- Assumptions: `warning` and invalid/unavailable usage metrics are represented as explicit `null`; real numeric zero is preserved. Reconstruction is `unavailable` only when branch reconstruction throws.
- Unresolved decisions: none for WS1. WS2 must implement independent subsection fallback exactly as planned.
- Residual risks:
  - Standalone static type-check remains unverified due missing compiler.
  - Current source attribution is intentionally heuristic and must remain labeled as such in WS2.
  - The repository and target files had pre-existing unstaged stats-dashboard changes; this worker preserved them and did not reset/stage anything. Parent integration must review the combined working-tree diff rather than treating it as an isolated commit.

## Acceptance evidence

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Implemented additive version-1 promptContext only in the approved stats producer/test/README boundary; no dependency, version, lock, or Web UI changes."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "10 focused producer tests pass; syntax, diff, package dry-run, privacy/cap/invariant, lifecycle, and no-staged-files evidence is recorded above."
    }
  ],
  "changedFiles": [
    "pi-extension-stats/index.ts",
    "pi-extension-stats/tests/stats-payload.test.mjs",
    "pi-extension-stats/README.md"
  ],
  "testsAddedOrUpdated": [
    "pi-extension-stats/tests/stats-payload.test.mjs"
  ],
  "commandsRun": [
    {
      "command": "node --experimental-strip-types --test pi-extension-stats/tests/stats-payload.test.mjs",
      "result": "passed",
      "summary": "10 passed, 0 failed"
    },
    {
      "command": "node --experimental-strip-types --check pi-extension-stats/index.ts && git diff --check -- pi-extension-stats/index.ts pi-extension-stats/tests/stats-payload.test.mjs pi-extension-stats/README.md",
      "result": "passed",
      "summary": "Syntax and scoped whitespace checks passed with no output"
    },
    {
      "command": "cd pi-extension-stats && npm pack --dry-run --json",
      "result": "passed",
      "summary": "Package dry run completed for @firstpick/pi-extension-stats@0.2.9"
    },
    {
      "command": "git diff --cached --quiet",
      "result": "passed",
      "summary": "No staged files"
    },
    {
      "command": "cd pi-extension-stats && npx --no-install tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck index.ts",
      "result": "failed",
      "summary": "TypeScript compiler unavailable; no install or dependency change made"
    }
  ],
  "validationOutput": [
    "TAP: tests 10, pass 10, fail 0",
    "Node type-stripped syntax check exit 0",
    "Scoped git diff --check exit 0",
    "Stats package dry run exit 0",
    "No staged files (git diff --cached --quiet exit 0)"
  ],
  "residualRisks": [
    "Standalone TypeScript type-check omitted because no compiler is available",
    "WS2 must label current composition as heuristic and implement independent section fallback",
    "Parent must integrate against the pre-existing dirty working tree"
  ],
  "noStagedFiles": true,
  "diffSummary": "Adds bounded/redacted promptContext initialPrompt, snapshot, and currentContext producer data with invariant/lifecycle/privacy tests and compatibility documentation.",
  "reviewFindings": [
    "no self-identified blockers; independent reviewer gate remains parent-owned"
  ],
  "manualNotes": "Initial root-level npm pack failed due wrong working directory and was superseded by a successful package-local dry run."
}
```
