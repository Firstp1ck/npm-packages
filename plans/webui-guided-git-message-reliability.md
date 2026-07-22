# WebUI Guided Git Message Reliability Plan

**Status:** Complete — implemented, verified, independently reviewed, and reported
**Feature slug:** `webui-guided-git-message-reliability`
**Owner / integration owner:** Primary Pi agent (sole writer)
**Package:** `pi-package-webui`
**Report:** [`../reports/webui-guided-git-message-reliability.html`](../reports/webui-guided-git-message-reliability.html)

## Objective and success criteria

Make generated Git commit messages appear deterministically in the WebUI Guided Git workflow without accepting stale, partial, mismatched, duplicated, or wrong-run results.

Success means:

1. Every `/git-staged-msg` request receives a server-generated correlation ID tied to its originating WebUI tab and working directory.
2. The server snapshots both message artifacts before dispatch and reports a fresh result only after **both** files differ from that exact baseline, are non-empty, and form a stable pair.
3. Freshness no longer depends on the current `Date.now()` versus filesystem mtime with a 10-second tolerance.
4. Browser triggers (timer, reconnect/resume, and `agent_end`) converge on one bounded poller per tab/run/generation instead of racing independent retry chains.
5. Superseded or cancelled runs cannot overwrite or fail a newer workflow state.
6. Missing or incomplete artifacts remain in a visible waiting state during the bounded grace period, then fail with actionable recovery guidance.
7. Focused unit/static tests and package checks pass, with unrelated pre-existing failures disclosed.
8. Two qualifying independent cross-provider reviewers assess the final plan and implementation; material findings are resolved and recorded.
9. This plan and the linked self-contained HTML report are current and validated.

## Scope and non-goals

### In scope

- Commit-message artifact snapshotting and stable pair reads.
- Server-side generation correlation and baseline ownership per terminal tab.
- Fresh-message API readiness responses.
- Frontend single-flight, generation-aware bounded polling.
- Tab/run/cancellation/supersession guards.
- Focused tests and Guided Git documentation where needed.

### Non-goals

- Changing the `/git-staged-msg` prompt contract or generated file locations.
- Redesigning branch-name or PR-description generation in this change.
- Persisting in-progress Guided Git browser state across a full WebUI server restart.
- Automatically committing generated messages.
- Changing staged-review security bindings.

## Approved decisions and assumptions

The user requested a reliability improvement without prescribing an implementation. The following defaults are selected from codebase evidence and minimize compatibility risk.

| Decision | Resolution | Rationale |
|---|---|---|
| Correlation authority | Server-generated UUID stored on the owning tab | The server dispatches the prompt and owns tab/cwd routing; browser timestamps cannot reliably identify filesystem output. |
| Freshness proof | Compare stable before/after snapshots for both files | Avoids clock skew, coarse mtime tolerances, and the current `Math.max()` bug that permits one stale file. |
| Pair validity | Require both files to exist, be non-empty, differ from their exact baselines, and remain unchanged across a short settle read | Prevents stale, partial, and mixed-generation previews. Rewrites with identical content remain valid because metadata changes are included. |
| Browser coordination | One poller per tab + workflow run + generation ID | Timer, reconnect, and `agent_end` become idempotent wakeups instead of competing requests. |
| Poll bounds | Short adaptive polling after generation settles, capped at 30 seconds | Covers delayed filesystem visibility without unbounded background activity. |
| Failure behavior | Keep waiting feedback visible; after timeout return to a recoverable Generate error with explicit regenerate/preview guidance | Avoids silent stalls while preserving user control. |
| Compatibility | A message GET without a generation ID continues to preview current files | Existing manual “Preview current message files” and commit-step navigation keep working. |
| Review/test ownership | Primary agent is sole writer; reviewers are read-only | Avoids conflicts with existing uncommitted `styles.css` and `mobile-static.test.mjs` changes. |

## Architecture and interfaces

```text
Browser: Run /git-staged-msg
  -> POST /api/git-workflow/generate (tab + staged-content binding)
  -> server snapshots short + long files in tab.cwd
  -> server creates generationId and dispatches the prompt
  <- generationId + model profile

Pi writes both files and settles
  -> timer / resume / agent_end wakes the same browser poller
  -> GET /api/git-workflow/message?generationId=<id>&tab=<tab>
  -> server verifies tab/cwd/id, both artifacts changed from baseline,
     both are non-empty, and the pair is stable across a settle interval
  <- { ready:false, reason } until valid
  <- { ready:true, short, long, metadata, generationId } when valid
  -> browser checks runId + generationId again and renders exactly once
```

### Planned interfaces

- New testable `lib/git-message-artifacts.mjs` helpers for stable snapshots, version comparison, pair readiness, and pair stability.
- `startGitWorkflowGeneration()` returns `generationId` for commit generation and retains its baseline on the owning tab.
- `GET /api/git-workflow/message` accepts optional `generationId`; without it, behavior remains current-file preview.
- Browser state adds the active message generation ID; transient poll ownership stays in a tab-keyed map rather than serializable workflow data.

## Files and ownership

| File | Responsibility |
|---|---|
| `pi-package-webui/lib/git-message-artifacts.mjs` | Stable artifact snapshots and freshness/readiness rules |
| `pi-package-webui/bin/pi-webui.mjs` | Tab-scoped generation records, correlated API behavior, stable message reads |
| `pi-package-webui/public/app.js` | Generation-aware single-flight polling and stale-result suppression |
| `pi-package-webui/tests/git-message-artifacts.test.mjs` | Unit coverage for missing, stale, partial, identical-content rewrite, and stable-pair behavior |
| `pi-package-webui/tests/guided-git-message-reliability-static.test.mjs` | Source contract coverage for backend/frontend correlation and polling |
| `plans/webui-guided-git-message-reliability.md` | Canonical decisions, evidence, checks, reviews, and dispositions |
| `reports/webui-guided-git-message-reliability.html` | Final audit report |

No concurrent writer may modify these files in this worktree. Existing user changes in `public/styles.css` and `tests/mobile-static.test.mjs` must be preserved and not attributed to this feature.

## Ordered work items

| # | Work item | Dependency | Status |
|---|---|---|---|
| 1 | Trace generation dispatch, artifact reads, tab routing, event wakeups, and tests | — | Complete |
| 2 | Resolve correlation, freshness, pair validity, polling, compatibility, and failure decisions | 1 | Complete |
| 3 | Implement stable artifact helpers and tab-scoped server generation records | 2 | Complete |
| 4 | Replace frontend retry races with generation-aware single-flight polling | 3 | Complete |
| 5 | Add focused tests and run syntax/package/diff checks | 3–4 | Complete with two unrelated Windows-environment failures documented below |
| 6 | Obtain two independent cross-provider reviews and disposition every finding | 5 | Complete — Anthropic and Google final reviews PASS |
| 7 | Apply accepted fixes and rerun affected checks | 6 | Complete |
| 8 | Create and strictly validate the linked HTML report | 7 | Complete |

## Acceptance tests

- A missing baseline followed by two valid files becomes ready.
- Only one changed file remains pending.
- Two unchanged pre-existing files remain pending even when their mtimes are near the request time.
- Rewriting both files with identical text is accepted when file metadata proves a new write.
- Empty or unstable files remain pending.
- A fresh API request with the wrong/superseded generation ID cannot return a message as ready.
- Manual current-file preview works without a generation ID.
- Multiple browser wakeups reuse one poll promise for the same tab/run/generation.
- A newer generation or incremented run ID invalidates older poll results and failures.
- Polling is bounded and produces actionable timeout output.
- `node --check`, focused tests, package checks, and `git diff --check` pass or any unrelated baseline failure is documented.
- The final HTML report passes the skill's strict validator.

## Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Filesystems expose coarse or unusual timestamps | Medium | Compare nanosecond mtime/ctime where available plus size/inode/content hash; do not use wall-clock freshness. |
| The generator intentionally emits identical text | Medium | Treat metadata change as a valid rewrite even when content hash is unchanged. |
| Both files are rewritten but one is still being edited | High | Stable per-file reads plus a short pair settle/re-read before `ready:true`. |
| Agent completion event is delayed or duplicated | Medium | Event paths only wake a generation-keyed single-flight poller; resume remains a fallback. |
| Browser switches tabs during generation | Medium | All state and poll ownership are tab-scoped; inactive-tab events target their owning tab. |
| Server restarts during generation | Low | Fail closed with an expired-generation message; full restart persistence is out of scope. |
| Existing uncommitted files are overwritten | High | Do not edit the currently modified `styles.css` or `mobile-static.test.mjs`; use new focused tests. |

## Verification record

| Check | Result | Evidence |
|---|---|---|
| `node tests/git-message-artifacts.test.mjs` | Pass | Missing baselines, two-file readiness, one-file partial updates, identical-content rewrites, stable-pair equality, and empty-file rejection passed. |
| `node tests/guided-git-message-reliability-static.test.mjs` | Pass | Server correlation/baseline/cwd contracts, pair settle checks, frontend generation binding, single-flight polling, timeout, and removal of the 10-second mtime heuristic passed. |
| `node tests/guided-git-aur-review.test.mjs` | Pass | Existing staged-review action-boundary and tab-correlation guards remain intact. |
| `node tests/mobile-static.test.mjs` | Pass | All existing WebUI static checks passed with the concurrent user changes preserved. |
| `node tests/remote-auth-settings-harness.test.mjs` | Pass after compatibility fix | Commit generation still dispatches in the harness's pre-repository cwd; baseline capture safely falls back to the tab cwd while real Guided Git staging gates remain unchanged. |
| Syntax checks | Pass | `node --check` passed for `public/app.js`, `bin/pi-webui.mjs`, and `lib/git-message-artifacts.mjs`; the new module was added to `npm run check`. |
| `git diff --check` | Pass | No whitespace errors. |
| HTML report strict validation | Pass | `validate_report.py reports/webui-guided-git-message-reliability.html --strict` returned zero errors/warnings; one overview table, one accessible SVG diagram, and no local/remote dependencies. |
| `npm run check` | Partial / environment baseline | 36/38 test files passed. `http-endpoints-harness.test.mjs` failed during Windows temp cleanup with `EBUSY` on its `merge-conflict` directory; `staged-content-hash-contract.test.mjs` failed because this Windows process lacks symlink privilege (`EPERM`). All feature-focused tests and the previously affected remote-auth harness passed. |

The working tree already contained user changes in `public/styles.css` and `tests/mobile-static.test.mjs`. This feature did not edit or claim those changes.

## Independent review record

Two fresh, read-only final reviews were run independently after the dispatch-window fix. Both used high reasoning and came from provider families distinct from the OpenAI implementation model and from each other.

| Run / artifact | Verified model | Provider family | Verdict |
|---|---|---|---|
| `eefc3b34-8de9-4788-9b43-d482fe250cef` — [`anthropic-correctness.md`](../.pi-subagents/artifacts/outputs/eefc3b34-8de9-4788-9b43-d482fe250cef/reviews-final/anthropic-correctness.md) | `anthropic/claude-opus-4-8:high` | Anthropic | **PASS** — no material/blocking findings |
| `eefc3b34-8de9-4788-9b43-d482fe250cef` — [`google-ux-tests.md`](../.pi-subagents/artifacts/outputs/eefc3b34-8de9-4788-9b43-d482fe250cef/reviews-final/google-ux-tests.md) | `openrouter/google/gemini-3.1-pro-preview:high` | Google | **PASS** — no material findings, missing tests, or blockers |

The earlier review run `3dbbf3a3-6e40-4999-b68b-6225c762c51a` found one low-severity dispatch-window issue. It was fixed before the final review run and is not counted as the final review gate.

## Finding dispositions

| Finding | Severity | Disposition | Evidence |
|---|---|---|---|
| Refresh or event wakeup could run after `step="generating"` but before the generation POST returned its correlation ID, producing a confusing false failure | Low | **Accepted and fixed** | The generating view disables Refresh until `messageGenerationId` exists; fresh loads with no ID no-op while the POST is still binding the ID. Focused static tests cover both guards; both final reviewers verified the fix. |
| Identical-content rewrite on a coarse-timestamp/`ino=0` filesystem could remain indistinguishable from baseline | Medium residual | **Accepted risk / fail-closed** | Content changes are always detected by hash; normal NTFS has high-resolution metadata. The rare indistinguishable identical rewrite times out after 30 seconds with regenerate/manual-preview guidance rather than displaying stale content. |
| Current-file preview without a generation ID can display an empty file as `(empty)` | Low compatibility note | **Intentional / no change** | Manual preview preserves pre-change behavior; only correlated generation advancement requires both files to be non-empty. Commit endpoints still reject empty messages. |
| No runtime browser integration test for actual single-flight promise coalescing or backend settle transition | Low test gap | **Deferred** | Focused unit tests cover artifact semantics; static tests lock backend/frontend contracts; related harnesses and both final reviewers passed. A future browser integration harness would improve confidence but is not required for this bounded change. |
| `http-endpoints-harness` Windows `EBUSY` cleanup and staged-hash symlink `EPERM` | Environment | **Not a feature defect** | Failures occur in unrelated cleanup/symlink setup. Feature tests, mobile static checks, review-gate tests, remote-auth harness, syntax checks, and diff checks pass. |

## Residual risks and rollout

- On rare coarse-metadata filesystems, a byte-identical rewrite may fail closed at the 30-second timeout rather than be accepted automatically.
- A full WebUI server restart during generation intentionally loses the in-memory correlation record and requires regeneration.
- Verification is source/unit/harness based; no billed live model generation was run through a browser in this session.
- Restart Pi Web UI so the updated backend and `public/app.js` load together. Mixed old/new frontend/backend versions intentionally fail with restart/regenerate guidance rather than accepting uncorrelated output.
