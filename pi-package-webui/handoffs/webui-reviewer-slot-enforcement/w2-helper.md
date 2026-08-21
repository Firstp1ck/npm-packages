# W2 WebUI reviewer-slot helper enforcement handoff

## Identity and status

- Workstream: `W2` — runtime helper, bounded permit lifecycle, helper tests, and layered documentation
- Run identity: `worker` / `webui-reviewer-slot-enforcement` / `w2-helper`
- Status: completed; focused validation passed; required integration review remains pending
- Base revision: `128e769a628c0f0f5ced524aa21a8dbf827aa7f1`
- Result revision: uncommitted working tree on the same base revision
- Confidence: 97/100

## Changed files

- `webui-rpc-helper.mjs`
  - Registers the WebUI-owned `approve_subagent_model_deviation` tool with a closed TypeBox schema for reviewer occurrence 1–8, a requested model of at most 280 characters, and a trimmed reason of at most 500 characters.
  - Stores at most eight process-local permits for two minutes, bound to the active `subagentLaunchSlotRevision` and helper generation; reload, replacement, shutdown, stale generation, and snapshot failure clear or invalidate permits.
  - Prunes permits before `subagent` and `subagent_gate`, supplies bounded descriptors to `applySubagentLaunchSlotDefaults`, blocks mismatch reports before execution, consumes direct permits only after whole-request admission, and leases all descriptors embedded into a newly created workflow wrapper.
  - Extends system/tool guidance to state that explicit reviewer mismatches block and deviation approval is valid only after explicit user authorization.
- `tests/subagents-helper.test.mjs`
  - Adds runtime coverage for the strict approval-tool contract, blocked explicit reviewer mismatches and diagnostics, exact and omitted admission, unchanged non-reviewer behavior, whole-request permit retention, one-use consumption, expiry, eight-permit retention, revision/generation invalidation, workflow leasing, and immutable snapshot reload behavior.
- `README.md`
  - Adds the short user-facing reviewer mismatch and explicit-authorization warning to the first-use Agent models guidance.
- `TECHNICAL.md`
  - Documents exact reviewer admission behavior, permit bounds/lifecycle, correction flow, invalidation, workflow limitations, and the WebUI-local enforcement boundary.
- `DEVELOPMENT.md`
  - Documents helper/pure-policy ownership, revision and generation binding, permit state, direct admission and workflow lease mechanics, and focused contributor checks.
- `handoffs/webui-reviewer-slot-enforcement/w2-helper.md`
  - This independently reviewable workstream record.

No pure policy files/tests, browser UI, settings schema/migration, upstream packages, canonical plan/report, or unrelated package files were edited by W2.

## Validation

| Command | Exit | Output |
|---|---:|---|
| `node tests/subagents-helper.test.mjs` | 0 | `subagents-helper.test.mjs passed` |
| `node --check webui-rpc-helper.mjs` | 0 | No output; syntax check passed. |
| `git diff --check -- README.md TECHNICAL.md DEVELOPMENT.md` | 0 | No output; scoped Markdown diff check passed. |
| `git diff --check -- webui-rpc-helper.mjs tests/subagents-helper.test.mjs` | 0 | No output; no source/test whitespace errors. |
| `git diff --cached --name-only` | 0 | No output; no staged files. |

Tracked W2 implementation/test/documentation diff summary before this handoff: 5 files changed, 283 insertions, 12 deletions.

## Assumptions and deviations

- The integrated W1 API and its approved descriptor/report contract were treated as authoritative: `options.deviations`, `report.blocked`, and `report.consumedDeviationIds`.
- A full eight-permit store rejects a ninth unused permit rather than silently evicting an earlier user-authorized permit.
- Schema length limits apply before trimming; the execute path trims requested model and reason and rejects blank normalized values.
- Workflow leasing removes every active descriptor because the generated wrapper embeds the complete supplied descriptor list; matching and one-use consumption then occur inside that one wrapper.
- No deviations from the approved scope or write boundary were made.

## Omitted checks

- `npm run check`, `npm test`, the pure policy suite, launch-slot suite, and full repository Markdown/source checks were not run because W2 validation was explicitly scoped to the helper test, helper syntax check, and these documentation files. They remain integration-owner checks after W1 and W2 are combined.
- No browser or Playwright checks were run because browser UI was a non-goal.
- No independent reviewer was launched; the plan assigns the required review gate to the integration owner.

## Residual risks and integration notes

- Enforcement remains local to the WebUI helper; launch paths that bypass it are outside this delivery.
- A later mismatch in sequential workflow code cannot undo a child already launched by an earlier `runs.run`; `runs.all` remains transactionally preflighted by W1.
- Exact configured model/thinking strings are compared without upstream fuzzy resolution, and provider fallback may still change the runtime model after an admitted launch later fails.
- W1 pure-policy edits are already present in the shared working tree. Integration should inspect both handoffs and all W1/W2 diffs, then run the plan’s package-wide checks and required independent reviews.
- The repository also contains unrelated pre-existing changes outside this package; W2 did not touch them. The Git index is empty.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Implemented only the approved helper runtime enforcement, bounded permit lifecycle, focused helper tests, layered documentation, and required W2 handoff; pure policy, browser, settings, plan/report, upstream, and unrelated files were not edited by W2."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Focused helper tests, helper syntax validation, scoped Markdown/source diff checks, no-staged-files evidence, changed-file summary, assumptions, omitted checks, and residual risks are recorded in this handoff."
    }
  ],
  "changedFiles": [
    "webui-rpc-helper.mjs",
    "tests/subagents-helper.test.mjs",
    "README.md",
    "TECHNICAL.md",
    "DEVELOPMENT.md",
    "handoffs/webui-reviewer-slot-enforcement/w2-helper.md"
  ],
  "testsAddedOrUpdated": [
    "tests/subagents-helper.test.mjs"
  ],
  "commandsRun": [
    {
      "command": "node tests/subagents-helper.test.mjs",
      "result": "passed",
      "summary": "Exit 0; printed subagents-helper.test.mjs passed."
    },
    {
      "command": "node --check webui-rpc-helper.mjs",
      "result": "passed",
      "summary": "Exit 0 with no output."
    },
    {
      "command": "git diff --check -- README.md TECHNICAL.md DEVELOPMENT.md",
      "result": "passed",
      "summary": "Exit 0 with no Markdown whitespace errors."
    },
    {
      "command": "git diff --check -- webui-rpc-helper.mjs tests/subagents-helper.test.mjs",
      "result": "passed",
      "summary": "Exit 0 with no source/test whitespace errors."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "Exit 0 with no output; no staged files."
    }
  ],
  "validationOutput": [
    "subagents-helper.test.mjs passed",
    "node --check completed with exit code 0 and no output",
    "scoped Markdown git diff --check completed with exit code 0 and no output",
    "scoped source/test git diff --check completed with exit code 0 and no output",
    "git diff --cached --name-only returned no paths",
    "Tracked W2 diff before handoff: 5 files changed, 283 insertions, 12 deletions"
  ],
  "residualRisks": [
    "WebUI-local enforcement does not cover launch paths that bypass the helper.",
    "Sequential workflow calls cannot roll back an earlier child when a later runs.run mismatches.",
    "Package-wide integration checks and the required independent review gate remain pending."
  ],
  "noStagedFiles": true,
  "diffSummary": "The helper now registers explicit reviewer deviation approval, binds up to eight two-minute one-use permits to snapshot revision/generation, blocks explicit reviewer mismatches before execution, consumes or leases permits safely, and adds focused runtime tests plus correctly layered user/contributor documentation.",
  "reviewFindings": [
    "no self-identified blockers; required independent review remains pending"
  ],
  "manualNotes": "Base HEAD is 128e769a628c0f0f5ced524aa21a8dbf827aa7f1. W1 pure-policy changes and unrelated pre-existing repository changes remain unstaged in the shared working tree and were not modified by W2."
}
```
