# Git Panel Live Updates

Related report: [Git Panel Live Updates report](../reports/git-panel-live-updates.html)

## Objective and success criteria

Make the side-panel Git section reflect repository changes shortly after files are created, modified, renamed, or removed, without periodic browser polling.

Success criteria:

- A repository discovered for an open terminal tab has one recursive server-side filesystem watcher shared by tabs using the same Git root.
- Filesystem bursts are debounced before one server-wide SSE invalidation is emitted, with a maximum wait so sustained writes cannot postpone updates indefinitely.
- The browser invalidates the matching cached Git snapshot and refreshes it when the Git section/repository is visible; a collapsed panel refreshes on its next visible render.
- A change arriving during a Git snapshot request is not lost.
- Persistent Git read failures do not cause a retry loop.
- Tab cwd changes, tab closure, tab-start failure, watcher errors, and server shutdown release watcher resources.
- Focused lifecycle, SSE integration, static UI, syntax, and repository checks pass or any unrelated failure is recorded.
- Two independent qualifying cross-provider reviews are completed and every finding receives a disposition.

## Scope and non-goals

In scope:

- Local recursive repository watching via Node's built-in `fs.watch`.
- Debounced repository-level invalidation events over the existing SSE channel.
- Git-sidepanel cache invalidation and conditional refresh behavior.
- Resource lifecycle, focused tests, documentation, review evidence, and report artifacts.

Non-goals:

- No periodic Git polling.
- No file-content or changed-filename transfer in SSE events.
- No automatic network `git fetch`.
- No change to Git mutation authorization or destructive-action confirmation.
- No new runtime dependency or broad sidepanel rewrite.
- No modification or rollback of the pre-existing footer-calibration and danger-button work in the dirty worktree.

## Approved decisions and assumptions

- User approved a server-side recursive watcher with short debounce and SSE invalidation instead of browser polling.
- Use one watcher per canonical Git root, reference-counted by tab ID, to avoid duplicate events for tabs in the same repository.
- Register lazily when `/api/git-root` or `/api/git-panel` successfully discovers a repository. This aligns watcher cost with repositories the browser actually exposes.
- Use a 250 ms trailing debounce plus a 2 s maximum wait. This preserves responsive quiet-burst updates and bounded progress during sustained writes.
- Publish only repository root plus event timestamp; the browser re-reads authoritative Git status rather than trusting platform-dependent filesystem event details.
- Include worktree and Git metadata changes so external stage/commit/branch operations can invalidate the panel. Run read-only Git commands with `GIT_OPTIONAL_LOCKS=0` to avoid watcher feedback from optional index refreshes.
- Treat watcher startup/runtime failure as non-fatal: record the diagnostic and preserve manual/five-minute refresh behavior.
- The main agent is the sole writer/integration owner. Required reviewers were read-only.

## Architecture and interfaces

### Backend watcher manager

`lib/git-live-watcher.mjs` owns:

- `subscribe(tabId, root)` — move a tab subscription to a canonical root and lazily create the shared recursive watcher.
- `unsubscribe(tabId)` — remove the tab reference and close the root watcher when its final subscriber leaves.
- `closeAll()` — close every watcher and timer during shutdown.
- A 250 ms trailing debounce, 2 s maximum wait, debounced `onChange({ root, changedAt })`, and non-fatal `onError({ root, error })` callbacks.

`bin/pi-webui.mjs` integrates the manager with successful Git discovery/panel reads, cwd/tab lifecycle, startup-failure cleanup, shutdown, and existing `broadcastServerEvent()` SSE delivery.

### SSE contract

```text
{ type: "webui_git_changed", root: <canonical-root>, changedAt: <ISO timestamp> }
```

The event is an invalidation signal only. It contains no changed file paths or content.

### Browser refresh flow

```text
fs.watch burst
  -> 250 ms debounce (2 s max wait)
  -> broadcastServerEvent(webui_git_changed)
  -> expire matching gitPanelState snapshot
  -> visible repository: GET /api/git-panel
  -> collapsed repository/section: refresh when next rendered visible
```

`loadGitPanelRepository()` preserves a pending refresh when an invalidation arrives during an in-flight request, then performs one follow-up read. Error snapshots are not automatically retried on every render; a manual force refresh or a new SSE invalidation clears the error and retries once.

## Implementation map

- `lib/git-live-watcher.mjs` — isolated watcher/refcount/debounce/max-wait/error lifecycle manager.
- `bin/pi-webui.mjs` — watcher integration, SSE event emission, cleanup hooks, and `GIT_OPTIONAL_LOCKS=0` for read-only Git commands.
- `public/app.js` — cache invalidation, visible refresh, pending-follow-up behavior, and persistent-error loop guard.
- `tests/git-live-watcher.test.mjs` — unit coverage for shared roots, debounce, max wait, moves, failures, and close-all.
- `tests/git-panel-live-updates-static.test.mjs` — source-contract coverage for server/browser/watch lifecycle and documentation.
- `tests/http-endpoints-harness.test.mjs` — real server/SSE coverage for create, modify, rename, and remove.
- `README.md` — live-update behavior and no-polling/no-fetch boundaries.
- `package.json` — standard syntax check includes the new watcher module.

## Ordered work items

1. [x] Add the isolated watcher manager and lifecycle unit tests.
2. [x] Integrate watcher registration/release and SSE broadcasting in the server.
3. [x] Add browser invalidation, visible refresh, and in-flight follow-up handling.
4. [x] Add SSE integration and static browser regression coverage.
5. [x] Update README behavior documentation and run focused/full checks.
6. [x] Obtain two qualifying independent reviews and disposition all findings.
7. [x] Apply accepted fixes, rerun checks, and publish the linked self-contained HTML report.

Dependencies/merge order were watcher module -> server integration -> browser handling -> tests/docs -> independent reviews -> accepted fixes -> final checks/report. One writer owned all feature edits.

## Acceptance tests and results

| Check | Result | Evidence |
|---|---|---|
| `node --check lib/git-live-watcher.mjs` | Pass | Exit 0. |
| `node --check bin/pi-webui.mjs` | Pass | Exit 0. |
| `node --check public/app.js` | Pass | Exit 0. |
| `node --test tests/git-live-watcher.test.mjs` | Pass | TAP: 1 test file, 0 failures; includes max-wait coverage. |
| `node --test tests/git-panel-live-updates-static.test.mjs` | Pass | TAP: 1 test file, 0 failures. |
| `node tests/http-endpoints-harness.test.mjs` | Pass | Real SSE invalidations observed after create, modify, rename, and remove. The first attempt hit a transient random-port `EADDRINUSE`; the clean retry passed. |
| `npm run check` | Expected unrelated failure | Feature syntax and tests pass; 33/34 test files pass. `tests/mobile-static.test.mjs:1758` fails because the package-lock root contains optional companion `@firstpick/pi-extension-bang-command-autocomplete` at `^0.2.1`. Review reproduced this as pre-existing and unrelated. |
| `git diff --check -- <feature files>` | Pass | No whitespace errors. |
| Strict HTML validator | Pass | `validate_report.py reports/git-panel-live-updates.html --strict` passes after report generation. |

Manual browser behavior was not executed because this repository has no browser/jsdom harness for the monolithic sidepanel functions. The server/SSE path is exercised end-to-end and the browser contract is structurally asserted.

## Independent review trace

### Qualifying reviewer A — Kimi

- Parent run ID: `1aaf2f11-01a6-4ed3-a5cd-eb9f09259527`, child 0.
- Runtime model: `openrouter/moonshotai/kimi-k3:high` (`kimi-k3`, high thinking), selected after the requested Anthropic model hit repeated 429 rate limits.
- Provider/model family: OpenRouter gateway / Moonshot Kimi.
- Result: complete; acceptance checked; verdict **approve with findings**; confidence 88/100.
- Evidence reproduced: watcher sharing/lifecycle, SSE contract, optional-lock suppression, in-flight follow-up, focused tests, integration harness, diff check, and the unrelated full-suite failure.

Findings and dispositions:

1. **Medium: persistent `/api/git-panel` failures caused an unbounded render/reload loop — accepted and fixed.** `ensureGitPanelVisibleRepositoriesFresh()` now skips error snapshots; a new SSE invalidation clears the error and retries once. Static coverage verifies both sides.
2. **Minor: trailing debounce could starve under sustained writes — accepted and fixed.** The watcher now enforces a 2 s maximum wait, with unit/static coverage.
3. **Minor: recursive watcher portability/resource limits — deferred as residual platform risk.** Startup/runtime failures are non-fatal, resources are released, and manual/five-minute refresh remains available.
4. **Note: repository root appears in SSE — rejected as a new privacy defect.** The browser already receives the same root/cwd through existing authenticated WebUI APIs/events; no filenames or content are added.
5. **Testing gaps for behavioral browser races and lifecycle integration — deferred.** The repository has no DOM/browser harness; the manager and real SSE paths are behaviorally tested, while browser wiring follows existing static-test conventions.

### Duplicate-provider initial reviewer — not counted toward the cross-provider gate

- Same parent run ID, child 1.
- Runtime model: `openrouter/moonshotai/kimi-k3:high`; complete and acceptance checked.
- It produced useful independent evidence but could not satisfy the second provider-family slot because reviewer A also ran on Kimi.

Additional findings and dispositions:

1. **Medium: event storms/build churn — partially accepted.** The 2 s maximum wait gives sustained-write progress without 250 ms starvation. Further filename filtering or a longer UI throttle is deferred because it can hide legitimate ignored/generated-file changes and reduce requested responsiveness; in-flight requests remain bounded to one plus one follow-up.
2. **Low: possible subscription leak on tab-start failure — accepted and fixed.** The create-tab failure catch now unsubscribes defensively before deleting the tab.
3. **Low: watcher retry/log spam after platform failure — deferred.** Retries occur only on later explicit Git discovery/panel reads, not in a loop. A cooldown would add state for an unmeasured issue.
4. **Low: SSE events missed while disconnected — deferred.** The existing five-minute freshness/manual refresh fallback recovers; event replay/watermarking is broader than the approved invalidation contract.

### Qualifying reviewer B — DeepSeek

- Run ID: `7dab2d04-4c75-40f9-8338-807a9aadd5c3`.
- Runtime model: `openrouter/deepseek/deepseek-v4-pro:high` (`deepseek-v4-pro`, high thinking), verified from native subagent status; the model's prose self-identification was inaccurate and was not used as evidence.
- Provider/model family: OpenRouter gateway / DeepSeek.
- Result: complete; acceptance not required for the advisory read-only run; verdict **no actionable findings**; confidence 92/100.
- It reviewed the post-fix implementation and verified lifecycle hooks, 250 ms/2 s debounce behavior, persistent-error guard, in-flight follow-up, SSE privacy boundary, tests, maintainability, and cross-platform failure handling.

Notes and dispositions:

1. **Watcher-error state is not pushed as a dedicated browser warning — deferred by design.** Server diagnostics plus manual/five-minute fallback match the approved non-fatal behavior.
2. **No extra browser behavioral tests — deferred as an evidence limitation.** Static coverage plus server/SSE integration is proportionate to the repository's available harnesses.
3. **No additional actionable findings.**

### Non-qualifying failed/retry attempts

- The first Anthropic requests in the initial parallel run failed with provider 429s and fell back to Kimi; they are not counted as Anthropic reviews.
- DeepSeek attempt `fd8fb23e-b911-4d11-9e16-dce5df0204fc` produced a usable review but the run failed its inferred acceptance check (`no-staged-files evidence missing`), so it was not counted. The read-only slot was retried once with acceptance explicitly disabled for advisory output; run `7dab2d04-4c75-40f9-8338-807a9aadd5c3` completed and qualifies.

## Review status

- Implementation: complete.
- Accepted reviewer/self-audit fixes: complete.
- Qualifying cross-provider gate: complete (Kimi + DeepSeek, separate runs and provider/model families).
- Finding dispositions: complete.
- Report: complete and strictly validated.
- Full repository check: incomplete only because of the documented unrelated package-lock assertion.

## Residual risks

- Recursive `fs.watch` can be unreliable on some network filesystems or fail under host watch limits; failure is non-fatal but live updates then fall back to manual/five-minute refresh.
- Generated-file/build bursts can still cause periodic Git refresh work while the section is visible. Debounce, 2 s maximum wait, and one-in-flight-plus-one-pending behavior bound the request pattern; no workload benchmark was run.
- A filesystem change that occurs while the browser SSE stream is disconnected is not replayed. Cache expiry or manual refresh recovers it.
- Browser DOM timing/focus behavior and the `refreshPending` race are not executed in a real browser; they are verified by source-level assertions and independent code review.
- The worktree contains unrelated existing footer-calibration, git-footer, danger-button, and package metadata changes. This feature did not revert or claim ownership of them.

## Usage and verification guidance

Open the Git sidepanel section and expand a repository. Creating, editing, renaming, or deleting a file under that repository should update the Changes count/tree after the debounce window. Collapse the Git section, change a file, then re-open it; the stale snapshot should refresh when visible. Manual Refresh remains available if the host watcher backend fails.

Repeatable checks:

```sh
node --test tests/git-live-watcher.test.mjs
node --test tests/git-panel-live-updates-static.test.mjs
node tests/http-endpoints-harness.test.mjs
npm run check
python3 /home/firstpick/.pi/agent/skills/html-report/scripts/validate_report.py reports/git-panel-live-updates.html --strict
```
