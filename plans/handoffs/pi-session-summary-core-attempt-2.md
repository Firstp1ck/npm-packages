# W1 Core Session Summary — Attempt 2 Handoff

## Run identity and status

- **Workstream:** W1 core extension and persistence, attempt 2
- **Role:** implementation writer W1
- **Status:** Core implementation complete and focused validation green; broader package validation is **not fully green** because one W2-owned static assertion still expects the pre-feature one-extension manifest.
- **Feature status:** The overall complex feature remains incomplete pending W2 integration, central integration, two independent reviews, report generation, and final plan/archive gates.
- **Provenance:** Read and followed `/home/firstpick/.pi/agent/skills/feature-development-workflow/SKILL.md`, its `references/COMPLEX-FEATURE-CONTRACT.md`, `plans/planned/pi-session-summary-extension.md`, `/tmp/session-summary-c2-context.md`, installed Pi examples/docs/types, and current repository files before editing.
- **Classification:** Complex classification retained. Repository evidence crosses extension lifecycle/provider calls, branch persistence/context, TUI commands/rendering, a versioned RPC contract, and later WebUI server/browser integration; it also has separate W1/W2 implementation outcomes and privacy/reliability risks.
- **Base revision:** `9c3cf721385c8548f02b097c10b6f383f8112578`
- **Result revision:** `9c3cf721385c8548f02b097c10b6f383f8112578` (working-tree changes only; no commit)
- **Confidence:** 92/100 for the W1 implementation and focused contracts. Confidence is reduced by unavailable static TypeScript type-check tooling and the intentionally pending W2 end-to-end WebUI bridge.

## Exact changed files

1. `pi-package-webui/session-summary.ts` — new separately registered/published Pi extension.
2. `pi-package-webui/lib/session-summary-core.mjs` — new pure serializer/parser/state/context/title/RPC/scheduler utilities and fixed bounds.
3. `pi-package-webui/lib/session-summary-preferences.mjs` — new versioned, private, lock-protected, atomic preferences store.
4. `pi-package-webui/tests/session-summary-core.test.mjs` — new deterministic utility and fake-completion extension lifecycle tests.
5. `pi-package-webui/tests/session-summary-preferences.test.mjs` — new deterministic normalization/persistence tests.
6. `pi-package-webui/package.json` — registers and publishes `session-summary.ts` and declares its direct Pi AI/TUI dependencies.
7. `plans/handoffs/pi-session-summary-core-attempt-2.md` — this runtime-required handoff artifact.

`tests/run-all.mjs` was not changed because it dynamically discovers every `*.test.mjs` file.

## Implementation summary

### Extension lifecycle and generation

- Registers `/summary` and `/summary-setup` from the standalone package extension resource.
- Requires confirmed persistent setup before any provider request.
- Defaults to `openai-codex/gpt-5.6-luna` with `low` reasoning, automatic generation disabled until setup, context injection off, generated titles enabled, and title cadence 3.
- Uses only `agent_settled`; no `agent_end` handler exists. The settled handler schedules deferred fire-and-forget work and returns synchronously.
- Uses one injectable direct `complete()` call with model-registry lookup/auth, a fresh random routing ID, no tools, `cacheRetention:"none"`, payload `store:false`, `maxRetries:0`, a 90-second timeout/abort signal, and no fallback.
- Implements single-flight generation, newest-only automatic coalescing, manual in-flight reuse, five-minute automatic failure cooldown, shutdown abort, and session/leaf/fingerprint stale-result discard.
- Automatic work updates durable state silently. Manual `/summary` displays existing state or generates when absent; `/summary refresh` forces one bounded refresh. Successful setup immediately generates and displays.

### Privacy, parsing, state, and title behavior

- Serializes only active-branch user text, assistant final text, and assistant tool names.
- Excludes thinking, images, tool arguments/results, bash/tool-result roles, custom summary display/RPC/state entries, credentials, and hidden metadata.
- Bounds transcript input to 200,000 UTF-16 characters with an explicit oldest-content omission marker.
- Keeps a minimal immutable system instruction and treats the two editable prompts and transcript as untrusted user-role data. Editable prompts are bounded to 8 KiB each.
- Strictly parses a complete JSON object `{version:1,title,summaryMarkdown}`; rejects fences/prose/wrong versions/empty or >16-KiB summaries. Titles are one-line normalized and capped at 44 characters; an invalid title does not invalidate a valid summary.
- Appends only validated successful state as `firstpick:session-summary-state`; latest matching state on the active branch wins. Failures and stale results preserve prior state/title.
- Applies the first eligible title immediately, then only a changed candidate at least the configured settled-user-turn cadence later. A pre-existing/manual name, or a manual rename after a generated title, is treated as explicit and never overwritten.
- Calls native `pi.setSessionName()` only after a successful, current result.

### Preferences and TUI

- Stores configuration at `~/.pi/agent/session-summary.json`, overridable with `PI_SESSION_SUMMARY_CONFIG_FILE`.
- Uses private `0700` directories, `0600` files, same-directory temp+rename atomic writes, a bounded cross-process lock, and in-process serialized updates.
- Preserves unknown top-level and nested keys. Unsupported newer versions and malformed/incomplete configured profiles fail closed; malformed files are never overwritten.
- Setup uses native Pi select/editor/confirm dialogs and includes explicit privacy/cost disclosure.
- Registers a Pi Markdown renderer for `firstpick:session-summary-display`; display messages trigger no agent turn and are always removed by the context hook.
- Context injection filters all summary display/RPC/old-injection messages. When explicitly enabled, it appends exactly one latest active-branch reference-only summary per provider context build.

## Versioned RPC seam for W2

The extension emits hidden, non-turn-triggering custom messages with:

- `customType: "firstpick:session-summary-rpc"`
- `content: ""` (no transcript/provider context payload)
- `display: false`
- bounded `details` object with `version: 1`

Allowed `details.kind` values and fields:

| Kind | Fields beyond `version`, `kind`, `sessionId`, `durable` | Meaning |
|---|---|---|
| `setup` | `configured`, `enabled` | Confirmed preferences were saved. |
| `state` | `configured`, `enabled`, optional `title`, optional `summaryMarkdown` | Current branch projection on session start. |
| `generating` | `configured`, `enabled` | A bounded background/manual request started. |
| `success` | optional `title`, `summaryMarkdown` | Validated state was appended. |
| `failure` | `message` | Bounded sanitized actionable failure; prior success remains canonical. |
| `title` | `title` | Native title was safely applied and is eligible for W2's non-explicit tab bridge. |

Bounds are enforced before emission: session ID 128 characters, title 44, summary 16 KiB, failure message 512. Unknown fields such as credentials are dropped. The context hook always removes this custom type. W2 should parse only `details.version === 1` and this allowlisted kind/field set, preserve `titleSource:"explicit"`, and keep summary state tab/session scoped.

## Commands and validation evidence

| Command | Exit | Evidence |
|---|---:|---|
| `node tests/session-summary-preferences.test.mjs` | 0 | Defaults, bounds, future-key preservation, newer-version fail-closed behavior, serialized updates, atomic persistence, POSIX `0600`, malformed-file safety passed. |
| `node tests/session-summary-core.test.mjs` | 0 | Serializer/privacy, strict parser, state restoration, context filtering/injection, title cadence/explicit-name protection, staleness, bounded RPC, single-flight/coalescing/cooldown/abort, command registration, non-blocking settled behavior, and injected fake `complete()` passed. |
| `node --check lib/session-summary-core.mjs && node --check lib/session-summary-preferences.mjs && node --experimental-transform-types --check session-summary.ts` | 0 | JavaScript syntax and Node TypeScript transform syntax passed. |
| `node -e "import('./session-summary.ts')..."` | 0 | Public extension module loaded successfully. |
| `node tests/custom-message-markdown-static.test.mjs && node tests/completion-signal-contract.test.mjs` | 0 | Existing Markdown rendering and true settlement contracts passed. |
| `npm pack --dry-run --json --ignore-scripts` plus resource assertion | 0 | Package contains the extension, both core modules, and both focused tests. |
| Manifest registration assertion | 0 | `package.json` registers and publishes `./session-summary.ts`. |
| `git diff --check -- <owned files>` | 0 | No whitespace errors in tracked owned diff; new files were also syntax/test loaded. |
| `npm test` | 1 | 110/111 test files passed. Sole failure: `tests/mobile-static.test.mjs:2226` still asserts `pkg.pi.extensions` equals only `["./index.ts"]`; actual approved manifest is `["./index.ts","./session-summary.ts"]`. This file is explicitly W2-owned/forbidden to W1. The HTTP harness, native parity tests, both new tests, completion contract, and Markdown contract all passed within this run. |
| `git diff --cached --quiet` | 0 | No staged files. |

### Corrected intermediate checks

- An early core test run failed because the test fixture embedded raw newlines in JSON; the fixture was corrected to use `JSON.stringify`, then passed.
- A subsequent early core assertion exposed an unwanted `version` field inside normalized `state.result`; normalization was corrected, then passed.
- `npx --no-install tsc ...` exited 1 because this package has no installed TypeScript compiler CLI and `npx` resolved the placeholder package. No install or dependency mutation was attempted. Node's built-in TypeScript transform syntax/load checks passed instead.

## Validation omissions and residual risks

- **W2-owned integration:** `bin/pi-webui.mjs` still needs explicit child extension forwarding and versioned event parsing/title-source protection. Browser/API/static changes are outside W1 ownership.
- **Known package-test mismatch:** W2 must update `tests/mobile-static.test.mjs:2226` to accept the approved separate extension resource. W1 did not alter the forbidden test.
- **Type checking:** No full static TypeScript compiler was available. Runtime transform syntax and module load succeeded, but parent integration should run the repository's supported type checker if one is later available.
- **Lockfile:** `package.json` now declares direct `@earendil-works/pi-ai` and `@earendil-works/pi-tui` dependencies required by public imports. The lockfile was not changed because lockfiles are outside the exact write boundary.
- **End-to-end UI/provider:** No real provider call, browser flow, or live RPC child session was run. All completion behavior used an injected fake. W2/browser integration remains intentionally unverified.
- **Overall feature gate:** W2 outcome, parent central validation, independent review quorum, accepted-fix revalidation, final HTML report, and plan archive are pending.

## Integration notes

1. Inspect the six W1 code/manifest files and retain the exact fixed bounds and privacy scope.
2. In W2, explicitly forward `session-summary.ts` into curated child RPC args and consume only the bounded version-1 RPC `details` seam above.
3. Update the W2-owned manifest static assertion, add tab-scoped setup/overlay/title bridge behavior, and preserve explicit names.
4. After W2 integration, rerun `npm test`, `npm run check`, focused browser coverage, and package dry-run. Do not treat the current single static mismatch as a core failure or relax the separate-extension decision.

## Repository state

- No files were staged.
- No commit, stash, checkout, reset, clean, lockfile change, or real provider call occurred.
- Pre-existing unrelated optional-feature migration and WebUI edits remain untouched and dirty.
- Unique artifact: `plans/handoffs/pi-session-summary-core-attempt-2.md`.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete implementation and validation findings identify exact files, the sole broader-test failure at tests/mobile-static.test.mjs:2226, severity/ownership, RPC/config seams, and residual risks."
    }
  ],
  "changedFiles": [
    "pi-package-webui/session-summary.ts",
    "pi-package-webui/lib/session-summary-core.mjs",
    "pi-package-webui/lib/session-summary-preferences.mjs",
    "pi-package-webui/tests/session-summary-core.test.mjs",
    "pi-package-webui/tests/session-summary-preferences.test.mjs",
    "pi-package-webui/package.json",
    "plans/handoffs/pi-session-summary-core-attempt-2.md"
  ],
  "testsAddedOrUpdated": [
    "pi-package-webui/tests/session-summary-core.test.mjs",
    "pi-package-webui/tests/session-summary-preferences.test.mjs"
  ],
  "commandsRun": [
    {
      "command": "node tests/session-summary-preferences.test.mjs",
      "result": "passed",
      "summary": "Preference normalization, locking, atomic persistence, permissions, unknown-key preservation, and malformed/future fail-closed behavior passed."
    },
    {
      "command": "node tests/session-summary-core.test.mjs",
      "result": "passed",
      "summary": "Core privacy/parser/state/context/title/scheduler and injected fake-completion lifecycle tests passed."
    },
    {
      "command": "node --check lib/session-summary-core.mjs && node --check lib/session-summary-preferences.mjs && node --experimental-transform-types --check session-summary.ts && node extension import",
      "result": "passed",
      "summary": "Syntax, TypeScript transform syntax, and public extension module load passed."
    },
    {
      "command": "node tests/custom-message-markdown-static.test.mjs && node tests/completion-signal-contract.test.mjs",
      "result": "passed",
      "summary": "Existing Markdown and settlement contracts passed."
    },
    {
      "command": "npm pack --dry-run --json --ignore-scripts plus resource assertion",
      "result": "passed",
      "summary": "All new public and test resources are included in the package."
    },
    {
      "command": "npm test",
      "result": "failed",
      "summary": "110/111 files passed; only W2-owned tests/mobile-static.test.mjs:2226 retains the obsolete one-extension manifest assertion."
    },
    {
      "command": "npx --no-install tsc --noEmit ... session-summary.ts",
      "result": "failed",
      "summary": "No TypeScript compiler CLI is installed; npx returned its placeholder diagnostic. No install was attempted."
    },
    {
      "command": "git diff --cached --quiet",
      "result": "passed",
      "summary": "No staged files."
    }
  ],
  "validationOutput": [
    "session-summary preferences tests passed",
    "session-summary core tests passed",
    "session-summary extension load passed",
    "custom message Markdown static check passed",
    "completion signal contract checks passed",
    "pack resources present: session-summary.ts, both core modules, and both focused tests",
    "npm test: 1/111 failed solely at tests/mobile-static.test.mjs:2226; all other files passed",
    "Zero real provider calls; extension generation test used injected fake completion only"
  ],
  "residualRisks": [
    "medium: W2 must forward the extension into WebUI child RPC sessions and implement the bounded version-1 event/title bridge without overwriting explicit names.",
    "medium: W2-owned tests/mobile-static.test.mjs:2226 must be updated for the approved two-resource manifest before the full suite can pass.",
    "low: full static TypeScript type checking was unavailable; Node transform syntax and module load checks passed.",
    "low: lockfile was intentionally unchanged despite two newly direct, already installed Pi dependencies because lockfiles were outside W1's write boundary.",
    "overall complex feature gates after W1 remain pending."
  ],
  "noStagedFiles": true,
  "diffSummary": "Adds a separately published session-summary extension, pure bounded core utilities, private atomic preferences, deterministic fake-only tests, and package manifest/dependency registration; no W2/browser files were changed.",
  "reviewFindings": [
    "medium: tests/mobile-static.test.mjs:2226 - obsolete W2-owned assertion rejects the approved separate extension resource; update during W2 integration.",
    "medium: bin/pi-webui.mjs - explicit child forwarding and the generated-title WebUI bridge are pending by plan and outside W1 ownership.",
    "no blocker found in W1 focused tests after corrections."
  ],
  "manualNotes": "Base/result HEAD is 9c3cf721385c8548f02b097c10b6f383f8112578. Overall feature remains incomplete under the complex-feature contract. Confidence: 92/100."
}
```
