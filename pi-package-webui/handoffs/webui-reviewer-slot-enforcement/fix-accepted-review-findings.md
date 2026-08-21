# Accepted reviewer findings fix handoff

## Run identity and status

- **Workstream:** `webui-reviewer-slot-enforcement/fix-accepted-review-findings`
- **Run role:** `worker` implementation subagent
- **Parent session:** `Reviewer model routing investigation`
- **Status:** Complete; accepted findings A1–A4 and B1–B4 are implemented and focused validation passes.
- **Confidence:** 96/100. The accepted paths and regressions were exercised directly; confidence is below 100 because package-wide and browser suites were outside this focused fix run.

## Implemented findings

- **A1:** Removed marker-text trust. Wrapper ownership is now tracked in module-private `WeakSet` state keyed by the input object. Model-supplied marker comments are wrapped and enforced. Added `runs.run` and `runs.all` spoof regressions.
- **A2:** Compiles supplied workflow source as a separately constructed strict async function. Its only wrapper-provided value is the guarded `runs` adapter, so it does not close over the original runtime or wrapper-private occurrence/permit state. Added private-identifier and original-runs bypass regressions.
- **A3:** Preserves structurally bounded `expiresAt` values in deviation descriptors, checks expiry during direct matching, embeds expiry in workflow leases, and rechecks it at workflow-child use time with a wrapper-private captured clock. Added immediate and delayed-use integration regressions.
- **A4:** Calls the original `runs.run`/`runs.all` before committing cloned occurrence and consumed-permit state. A synchronous original-runtime validation throw leaves both clones uncommitted. Added retry regressions for both methods.
- **B1:** `approve_subagent_model_deviation` now requires `ctx.ui.confirm(...) === true`, names the exact occurrence/model/duration/reason, and fails closed without interactive UI or on rejection. It also rejects a confirmation if the slot snapshot changes while the dialog is open. Added no-UI, rejection, exact-dialog, and approval tests.
- **B2:** Tracks launch-slot snapshot load failure. Reviewer-bearing structured calls and all nonempty opaque `workflowScript` launches fail closed until a later reload succeeds; non-reviewer direct calls remain available. Added failure, preservation, and reload-recovery coverage.
- **B3/B4:** Clarified that workflow leasing and direct admission spend permits, and downstream/unused-workflow failures do not restore them.

No permit restoration, upstream `pi-subagents` admission, browser policy UI, settings migration, or unrelated refactor was added.

## Changed files

- `lib/subagent-launch-policy.mjs`
- `webui-rpc-helper.mjs`
- `tests/subagent-launch-policy.test.mjs`
- `tests/subagents-helper.test.mjs`
- `tests/resource-defaults-helper.test.mjs`
- `README.md`
- `TECHNICAL.md`
- `DEVELOPMENT.md`
- `handoffs/webui-reviewer-slot-enforcement/fix-accepted-review-findings.md` (this handoff)

## Tests added or updated

- `tests/subagent-launch-policy.test.mjs`
  - marker spoofing for `runs.run` and `runs.all`
  - isolation of every generated wrapper-private identifier
  - attempted direct access to `__piWebuiOriginalRuns`
  - workflow lease expiry after wrapping and before use
  - synchronous validation failure followed by successful retry for `run` and `all`
- `tests/subagents-helper.test.mjs`
  - fail closed without UI and on confirmation rejection
  - exact interactive confirmation content
  - workflow descriptor carries `expiresAt`
  - immediate unexpired workflow use and delayed expired use
- `tests/resource-defaults-helper.test.mjs`
  - reviewer-bearing and opaque-workflow fail-closed behavior after snapshot read failure
  - preservation of non-reviewer direct launch behavior
  - successful reload clears the failure gate

## Commands run and exit codes

Final validation:

1. `node tests/subagent-launch-policy.test.mjs` — exit **0**; `subagent-launch-policy.test.mjs passed`.
2. `node tests/subagents-helper.test.mjs` — exit **0**; `subagents-helper.test.mjs passed`.
3. `node tests/resource-defaults-helper.test.mjs` — exit **0**; expected malformed-settings warnings were emitted, then `resource-defaults-helper.test.mjs passed`.
4. `node --check lib/subagent-launch-policy.mjs && node --check webui-rpc-helper.mjs && node --check tests/subagent-launch-policy.test.mjs && node --check tests/subagents-helper.test.mjs && node --check tests/resource-defaults-helper.test.mjs` — exit **0**, no output.
5. `git diff --check -- lib/subagent-launch-policy.mjs webui-rpc-helper.mjs tests/subagent-launch-policy.test.mjs tests/subagents-helper.test.mjs tests/resource-defaults-helper.test.mjs README.md TECHNICAL.md DEVELOPMENT.md` — exit **0**, no diagnostics.
6. `git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'` — exit **0**, no diagnostics.
7. `git diff --cached --name-only` — exit **0**, no paths; no staged files.
8. `git diff --stat -- lib/subagent-launch-policy.mjs webui-rpc-helper.mjs tests/subagent-launch-policy.test.mjs tests/subagents-helper.test.mjs tests/resource-defaults-helper.test.mjs README.md TECHNICAL.md DEVELOPMENT.md` — exit **0**; 8 files, 881 insertions, 73 deletions against `HEAD` (this includes the already-integrated feature baseline, not only this accepted-fix pass).
9. `git status --short -- lib/subagent-launch-policy.mjs webui-rpc-helper.mjs tests/subagent-launch-policy.test.mjs tests/subagents-helper.test.mjs tests/resource-defaults-helper.test.mjs README.md TECHNICAL.md DEVELOPMENT.md` — exit **0**; exactly the eight scoped files are modified.

Earlier diagnostic runs:

- `node --check lib/subagent-launch-policy.mjs` — exit **0**.
- `node --check webui-rpc-helper.mjs` — exit **0**.
- `node tests/subagent-launch-policy.test.mjs` — exit **0**.
- `node tests/subagents-helper.test.mjs` — exit **0**.
- First `node tests/resource-defaults-helper.test.mjs` — exit **1** because the new failure classifier referenced nonexistent `isRecord`; changed it to the existing `isPlainObject` helper. Two subsequent runs exited **0**.
- `node --check tests/subagent-launch-policy.test.mjs && node --check tests/subagents-helper.test.mjs && node --check tests/resource-defaults-helper.test.mjs` — exit **0**.

## Omitted checks

- `npm run check`, full `npm test`, and browser/Playwright suites were not rerun in this focused accepted-finding pass. The requested focused policy/helper/resource-default tests, syntax checks, and scoped diff checks all passed.
- No external-provider or live child launch was performed.

## Assumptions and deviations

- The accepted disposition tables and the two named reviewer artifacts were treated as the complete fix scope.
- “Only the guarded runs parameter is reachable” is implemented as lexical isolation from all wrapper-private state. Normal JavaScript globals remain available to workflow source, as they were before; no sandboxing architecture was introduced.
- Permit consumption remains admission-based. Only synchronous original-runtime validation errors avoid state commit; asynchronous/downstream failures intentionally do not restore state, matching B3/B4 documentation disposition.
- No approved direction was changed. The one failed diagnostic was fixed within the existing helper interface.

## Unresolved issues and residual risks

- Enforcement remains WebUI-local and cannot govern paths bypassing the helper.
- Sequential workflows cannot undo an earlier launched child when a later separate call is blocked.
- Exact configured model-string matching may reject fuzzy aliases accepted upstream.
- Workflow source still has ordinary JavaScript global access; it cannot access wrapper-private lexical bindings or the original `runs` through generated names.
- The worktree contains unrelated pre-existing modifications outside this write boundary (including a sibling package and `tests/session-sampling-helper.test.mjs`) plus pre-existing untracked plan/handoff files. They were not edited or staged by this run.

## Integration notes

- Review the eight scoped source/test/documentation files and this handoff.
- The generated marker remains for diagnostics only; it is not an authorization or idempotence signal.
- `WeakSet` idempotence applies to the same workflow input object. Copying generated source into a new input causes safe re-wrapping rather than trusting copied text.
- Snapshot failure gating deliberately distinguishes opaque workflows from direct structured launches: every nonempty workflow is blocked, while direct calls are blocked only when their structured shape includes a reviewer.
- No staged files are present.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Implemented only accepted findings A1-A4 and B1-B4 in the authorized policy/helper/tests/docs paths; no rejected restoration, upstream admission, browser UI, migration, or unrelated refactor was added."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Focused policy, helper, and resource-default tests; five-file syntax checks; scoped source/Markdown diff checks; staged-file check; test inventory; validation outputs; and residual risks are recorded above."
    }
  ],
  "changedFiles": [
    "lib/subagent-launch-policy.mjs",
    "webui-rpc-helper.mjs",
    "tests/subagent-launch-policy.test.mjs",
    "tests/subagents-helper.test.mjs",
    "tests/resource-defaults-helper.test.mjs",
    "README.md",
    "TECHNICAL.md",
    "DEVELOPMENT.md",
    "handoffs/webui-reviewer-slot-enforcement/fix-accepted-review-findings.md"
  ],
  "testsAddedOrUpdated": [
    "tests/subagent-launch-policy.test.mjs: marker spoof, wrapper-private isolation, original-runs bypass, delayed expiry, and synchronous-validation retry regressions",
    "tests/subagents-helper.test.mjs: interactive confirmation failure/success and workflow expiry integration regressions",
    "tests/resource-defaults-helper.test.mjs: snapshot-failure fail-closed and reload recovery regressions"
  ],
  "commandsRun": [
    {
      "command": "node tests/subagent-launch-policy.test.mjs",
      "result": "passed",
      "summary": "Exit 0; policy test passed."
    },
    {
      "command": "node tests/subagents-helper.test.mjs",
      "result": "passed",
      "summary": "Exit 0; helper test passed."
    },
    {
      "command": "node tests/resource-defaults-helper.test.mjs",
      "result": "passed",
      "summary": "Final exit 0; expected malformed-settings warnings followed by test pass. An earlier diagnostic run exited 1 and was corrected as documented."
    },
    {
      "command": "node --check lib/subagent-launch-policy.mjs && node --check webui-rpc-helper.mjs && node --check tests/subagent-launch-policy.test.mjs && node --check tests/subagents-helper.test.mjs && node --check tests/resource-defaults-helper.test.mjs",
      "result": "passed",
      "summary": "Exit 0; all scoped JavaScript syntax checks passed."
    },
    {
      "command": "git diff --check -- lib/subagent-launch-policy.mjs webui-rpc-helper.mjs tests/subagent-launch-policy.test.mjs tests/subagents-helper.test.mjs tests/resource-defaults-helper.test.mjs README.md TECHNICAL.md DEVELOPMENT.md",
      "result": "passed",
      "summary": "Exit 0; no scoped whitespace errors."
    },
    {
      "command": "git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'",
      "result": "passed",
      "summary": "Exit 0; no Markdown whitespace errors."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "Exit 0 with empty output; no staged files."
    }
  ],
  "validationOutput": [
    "subagent-launch-policy.test.mjs passed",
    "subagents-helper.test.mjs passed",
    "resource-defaults-helper.test.mjs passed",
    "All scoped syntax checks exited 0 with no output",
    "Scoped source and Markdown diff checks exited 0 with no diagnostics",
    "git diff --cached --name-only exited 0 with empty output"
  ],
  "residualRisks": [
    "WebUI-local enforcement does not cover helper-bypassing launch paths.",
    "Separate sequential workflow calls cannot roll back a child already launched before a later block.",
    "Admission-spent permits are intentionally not restored after asynchronous or downstream failure.",
    "Package-wide and browser suites were not rerun in this focused pass."
  ],
  "noStagedFiles": true,
  "diffSummary": "Eight scoped implementation/test/documentation files modified; policy removes marker trust, isolates workflow source, enforces lease expiry and synchronous commit semantics; helper adds exact interactive confirmation and snapshot-failure gating; focused regressions and permit-consumption documentation added. The HEAD-relative stat is 881 insertions and 73 deletions and includes the previously integrated feature baseline.",
  "reviewFindings": [
    "no blockers in focused validation",
    "accepted A1-A4 and B1-B4 implemented",
    "initial resource-default diagnostic failure fixed; final repeated run passed"
  ],
  "manualNotes": "Unrelated pre-existing worktree modifications and untracked plan/handoff artifacts remain untouched; no files are staged."
}
```
