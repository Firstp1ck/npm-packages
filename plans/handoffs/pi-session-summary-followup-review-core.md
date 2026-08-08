# Focused Verification — RSSA-FOLLOWUP-01

## Review

### Verdict

**The original coalesced-pending automatic failure is fixed, but the requested no-duplicate condition is not fully met.** A normal internally launched pending automatic failure now emits terminal RPC state exactly from the scheduler run, and the focused suite passes. A manual `/summary refresh` that joins an already in-flight automatic request still causes the same automatic failure to be projected twice. No blocker or broader regression was found.

**Confidence: 99/100.** The current source and focused regression were inspected, the requested suite passed, and the duplicate overlap was reproduced directly through the public extension with an injected completion and no network access.

### Correct

- **RSSA-FOLLOWUP-01 primary failure fixed:** `pi-package-webui/session-summary.ts:185-294` wraps each launched scheduler `run` and emits a bounded failure RPC for non-manual, non-abort failures at lines 290-292. Because this catch belongs to the launched run, it covers the internally launched pending refresh whose promise is not returned to the second `agent_settled` caller.
- **Outer duplicate owner removed:** `pi-package-webui/session-summary.ts:302-308` now fire-and-forgets `scheduler.schedule()` without a terminal `.then()` failure projection. The outer catch handles only pre-schedule preference-read rejection.
- **Regression added and passing:** `pi-package-webui/tests/session-summary-core.test.mjs:343-359` blocks a successful first automatic call, coalesces another settled event, makes the pending completion fail, verifies a second request launched, and verifies the final failure RPC message is `pending automatic failed`.
- **Ordinary manual path avoids duplication:** for a manual run launched while idle, the run catch skips projection because `manual === true` (`session-summary.ts:290-292`) and `generateManual()` emits the single failure RPC plus one notification (`session-summary.ts:355-363`).

### Finding

#### RSSA-FOLLOWUP-01A — Low — Manual refresh joining an automatic request duplicates its failure RPC

- **File/symbol:** `pi-package-webui/session-summary.ts:290-292`, scheduler-run catch; `pi-package-webui/session-summary.ts:355-360`, `generateManual()`.
- **Failure mode:** If an automatic generation is already in flight, a manual `/summary refresh` joins the scheduler's existing promise. The launched input still has `manual:false`, so its catch emits a failure RPC. When the same promise resolves as failure, `generateManual()` emits the identical failure RPC again. The current regression checks the last failure payload but does not count failure events.
- **Severity:** Low. The scheduler remains cleaned up and the user receives only one manual notification, but RPC consumers receive duplicate terminal failure events for one provider attempt.
- **Reproduction:** A read-only injected-extension diagnostic started an automatic request, invoked manual `summary refresh` while it was blocked, rejected the shared completion with `overlap failed`, and counted RPC entries. Output: `{"failureCount":2,"notifications":["Session summary failed: overlap failed"]}`.
- **Minimal remediation:** Centralize failure projection per launched run: emit every non-abort run failure (manual or automatic) in the run catch, then remove only `sendRpc(..."failure"...)` from `generateManual()` while retaining its manual notification. Add assertions that ordinary automatic, ordinary manual, and manual-joins-automatic failures each append exactly one matching failure RPC.
- **Confidence:** 100/100.

### Commands and outcomes

- `cd pi-package-webui && node tests/session-summary-core.test.mjs` — **passed**; printed `session-summary core tests passed`.
- `git status --short -- <target paths>; git diff --cached --name-only; git diff -- <target paths>` — **passed**; both implementation/test targets and the report are untracked, so ordinary Git diff output is unavailable; staged output was empty. Exact current target content and stored pre-fix context were compared directly.
- Read-only injected-extension automatic/manual overlap diagnostic — **passed as a diagnostic and reproduced the duplicate** with `failureCount:2` and one manual notification.

### Omissions and residual risks

- No implementation or test file was edited; only this required report artifact was overwritten.
- No real provider/network, browser, full package, or unrelated suite was run, as required by the focused scope.
- The new regression proves the pending automatic terminal payload but does not assert an exact count of one, leaving the duplicate-overlap case uncovered.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "The primary RSSA-FOLLOWUP-01 fix is verified at session-summary.ts:185-308 and tests/session-summary-core.test.mjs:343-359; one concrete low-severity duplicate-event finding includes exact symbols, reproduction, remediation, and confidence."
    }
  ],
  "changedFiles": [
    "plans/handoffs/pi-session-summary-followup-review-core.md"
  ],
  "testsAddedOrUpdated": [
    "pi-package-webui/tests/session-summary-core.test.mjs"
  ],
  "commandsRun": [
    {
      "command": "cd pi-package-webui && node tests/session-summary-core.test.mjs",
      "result": "passed",
      "summary": "Focused core suite, including first-success plus pending-automatic-failure extension regression, passed."
    },
    {
      "command": "git status/diff inspection for session-summary.ts and tests/session-summary-core.test.mjs",
      "result": "passed",
      "summary": "Targets are untracked and no staged files exist; exact current contents were inspected against stored pre-fix context."
    },
    {
      "command": "read-only injected extension: automatic request plus overlapping manual refresh failure diagnostic",
      "result": "passed",
      "summary": "Reproduced two identical failure RPC events for one shared failed request and one manual notification."
    }
  ],
  "validationOutput": [
    "session-summary core tests passed",
    "pending automatic failure now emits terminal RPC state",
    "outer agent_settled continuation no longer emits scheduler failure",
    "overlap diagnostic: failureCount=2, manual notification count=1",
    "no staged files"
  ],
  "residualRisks": [
    "Low: manual refresh joining an in-flight automatic request duplicates the shared request's failure RPC.",
    "The regression does not assert exactly one failure event.",
    "No browser or real-provider execution was performed under the focused scope."
  ],
  "noStagedFiles": true,
  "diffSummary": "Parent patch moves automatic failure projection into every scheduler run, removes the outer agent_settled failure continuation, and adds a pending-failure extension regression. Primary defect is fixed, but an automatic/manual overlap can still duplicate failure RPCs.",
  "reviewFindings": [
    "fixed: pi-package-webui/session-summary.ts:185-308 - internally launched pending automatic failures now emit terminal failure RPC state.",
    "low: pi-package-webui/session-summary.ts:290-292 and 355-360 - manual refresh joining an in-flight automatic request emits the same failure RPC twice.",
    "no blockers"
  ],
  "manualNotes": "Focused verdict: RSSA-FOLLOWUP-01 primary defect fixed, but no-duplicate acceptance remains conditional on RSSA-FOLLOWUP-01A. Confidence: 99/100."
}
```
