# W1 pure reviewer launch-slot enforcement handoff

## Identity and status

- Workstream: `W1` — pure launch-policy enforcement
- Run identity: `worker` / `webui-reviewer-slot-enforcement` / `w1-policy`
- Status: completed; ready for integration-owner inspection and required independent review
- Base revision: `128e769a628c0f0f5ced524aa21a8dbf827aa7f1`
- Result revision: uncommitted working tree on the same base revision
- Confidence: 97/100

## Changed files and summary

- `lib/subagent-launch-policy.mjs`
  - Extended `applySubagentLaunchSlotDefaults(toolName, input, roles, options = {})` with bounded caller-supplied deviation descriptors.
  - Added stable `blocked` decisions using `reviewer-model-mismatch` and `reviewer-thinking-mismatch` codes, plus `consumedDeviationIds`.
  - Preserved explicit model values while comparing reviewer model identity and recognized terminal thinking suffix against the one-based occurrence slot.
  - Preserved omitted-model filling and left explicit non-reviewer models unenforced.
  - Added workflow enforcement for `runs.run` and transactional preflight for `runs.all`; a mismatch throws an error with code `reviewer-model-policy-blocked` and bounded `decisions` before original `runs.all` receives children.
- `tests/subagent-launch-policy.test.mjs`
  - Added focused coverage for exact reviewer matches, model mismatch shape, thinking mismatch, occurrence order, deviation matching and bounds, unchanged non-reviewer behavior, omitted-model regression, workflow `runs.run`, atomic `runs.all`, and workflow deviation admission.
- `handoffs/webui-reviewer-slot-enforcement/w1-policy.md`
  - This independently reviewable workstream record.

Source edits stayed within the approved two-file implementation boundary. The canonical plan, helper, documentation, upstream packages, and settings were not edited by this workstream.

## Validation

| Command | Exit | Output |
|---|---:|---|
| `node tests/subagent-launch-policy.test.mjs` | 0 | `subagent-launch-policy.test.mjs passed` |
| `node --check lib/subagent-launch-policy.mjs` | 0 | No output; syntax check passed. |
| `git diff --check -- lib/subagent-launch-policy.mjs tests/subagent-launch-policy.test.mjs` | 0 | No output; no whitespace errors. |
| `git diff --cached --name-only` | 0 | No output; no staged files. |

Diff summary: 2 implementation/test files changed, 345 insertions and 57 deletions (`git diff --stat` before writing this handoff).

## Assumptions and approved interface details

- The supervisor approved the concrete API contract during implementation:
  - `options.deviations` accepts at most eight `{ id, role: "reviewer", occurrence, requestedModel }` descriptors.
  - Reports retain `applied` and `unsupported` and add `blocked` and `consumedDeviationIds` arrays.
  - Direct mismatch decisions contain `code`, `role`, `occurrence`, `location`, `slotId`, `expectedModel`, `requestedModel`, and `correctionModel`.
  - Workflow errors use `code = "reviewer-model-policy-blocked"` and expose the same objects in `decisions`.
- Descriptor IDs are bounded to 160 characters, requested model specifications to 280 characters, duplicate IDs are ignored, and reviewer occurrences are bounded to the configured eight-slot maximum.
- Exact trimmed model specifications pass. A recognized terminal thinking suffix is separated for mismatch classification; different suffix spelling/case remains an exact-match failure.
- The pure policy reports consumed deviation IDs; permit storage, expiry, lifecycle, and removal remain W2 responsibilities.

## Omitted checks

- `npm run check`, `npm test`, helper tests, launch-slot suite, and full documentation checks were not run because W1 validation was explicitly limited to the focused test and syntax check; integrated checks belong to the integration owner after W2.
- No helper-level behavior was tested because helper registration and lifecycle are W2 non-goals.
- No independent reviewer was launched by this worker; the plan requires the integration owner to run the review gate.

## Residual risks and integration notes

- Direct structured launches are not blocked by this pure function alone. W2 must inspect `report.blocked` and return the runtime tool-call block before launch.
- W2 should remove/consume caller-owned permits only when admission succeeds; a report may contain both `blocked` decisions and `consumedDeviationIds` when a multi-child direct request has a mix of permitted and unpermitted mismatches.
- Workflow deviations are embedded into one wrapper and matched once inside that workflow. `runs.all` uses transactional occurrence/deviation state and does not commit either when any child mismatches.
- As documented in the approved plan, a later sequential workflow mismatch cannot undo an earlier child already launched by a previous `runs.run`.
- The repository contained unrelated pre-existing unstaged/untracked changes outside this package and an untracked canonical plan. They were not touched. `git diff --cached --name-only` was empty.
- Integration should inspect the generated workflow wrapper contract before wiring leased permits, then run the plan’s full package checks and required independent review.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Implemented only the approved pure reviewer policy and focused tests in lib/subagent-launch-policy.mjs and tests/subagent-launch-policy.test.mjs; no helper, docs, plan, settings, or upstream source was edited."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Focused tests and syntax validation exited 0; this handoff records exact commands, outputs, diff scope, assumptions, omitted checks, and residual integration risks."
    }
  ],
  "changedFiles": [
    "lib/subagent-launch-policy.mjs",
    "tests/subagent-launch-policy.test.mjs",
    "handoffs/webui-reviewer-slot-enforcement/w1-policy.md"
  ],
  "testsAddedOrUpdated": [
    "tests/subagent-launch-policy.test.mjs"
  ],
  "commandsRun": [
    {
      "command": "node tests/subagent-launch-policy.test.mjs",
      "result": "passed",
      "summary": "Exit 0; printed subagent-launch-policy.test.mjs passed."
    },
    {
      "command": "node --check lib/subagent-launch-policy.mjs",
      "result": "passed",
      "summary": "Exit 0 with no output."
    },
    {
      "command": "git diff --check -- lib/subagent-launch-policy.mjs tests/subagent-launch-policy.test.mjs",
      "result": "passed",
      "summary": "Exit 0 with no whitespace errors."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "Exit 0 with no output; no staged files."
    }
  ],
  "validationOutput": [
    "subagent-launch-policy.test.mjs passed",
    "node --check completed with exit code 0 and no output",
    "targeted git diff --check completed with exit code 0 and no output",
    "git diff --cached --name-only returned no paths"
  ],
  "residualRisks": [
    "W2 must enforce direct report.blocked decisions and own permit lifecycle/consumption.",
    "Sequential workflow enforcement cannot undo children launched before a later runs.run mismatch.",
    "Full package and helper integration suites remain for the integration owner after W2."
  ],
  "noStagedFiles": true,
  "diffSummary": "Pure policy now emits stable reviewer mismatch decisions, accepts at most eight one-use deviation descriptors, and preflights workflow run/all calls; focused tests cover direct and workflow enforcement while preserving omitted-model and non-reviewer behavior.",
  "reviewFindings": [
    "no self-identified blockers; required independent review remains pending"
  ],
  "manualNotes": "Base HEAD is 128e769a628c0f0f5ced524aa21a8dbf827aa7f1. Unrelated pre-existing unstaged and untracked repository changes were left untouched."
}
```
