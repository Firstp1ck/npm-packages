# WebUI Subagent Terminal View Plan

**Status:** Awaiting streaming architecture approval  
**Owner / integration:** Primary Pi agent (sole writer)  
**Package:** `pi-package-webui`  
**Report:** [`../reports/webui-subagent-terminal-view.html`](../reports/webui-subagent-terminal-view.html)

## Objective and success criteria

Add a browser-persisted choice for opening tracked subagents either in the existing non-blocking overlay/widget or in a dedicated, clearly marked WebUI subagent terminal tab.

Success means:

1. The Subagents side-panel section offers **Overlay** and **Tab / terminal** modes, defaults to Overlay, and persists the selection in browser storage.
2. Clicking a running subagent follows the selected mode.
3. Tab / terminal mode creates or focuses one virtual tab per parent-terminal/run/child identity and marks it as a subagent.
4. The subagent tab renders the existing bounded structured transcript and live status without creating another Pi process.
5. The subagent tab is explicitly view-only: its input is disabled and explains that messages must be sent from the parent terminal.
6. Closing a subagent tab removes only the browser view and never calls a stop, interrupt, abort, or terminal-close API.
7. Existing parent terminal tabs, overlay behavior, polling, responsive layout, and accessibility remain functional.
8. Feature-focused checks pass, package-wide checks introduce no new failure beyond the confirmed tracked baseline, and an independent cross-provider reviewer has no unresolved material findings.
9. While a child is running, its virtual terminal displays the same pulsing **Agent is running:** treatment as the main transcript and names the current tool/activity when available.
10. Virtual child transcript cards use the full available content width, matching normal terminal transcript layout instead of retaining the overlay-oriented width cap.
11. **Proposed streaming follow-up:** while a child writes an assistant response, the virtual tab receives incremental `message_update` / `text_delta` events and updates the same streaming bubble behavior as a normal terminal, with snapshot polling retained only as reconnect/fallback reconciliation.

## Scope

### In scope

- Browser-local opening preference in the Subagents side panel.
- Client-side virtual subagent terminal tabs in the existing tab bar.
- Dedicated view-only transcript surface using the existing `/api/subagents/output` endpoint.
- Active-view polling, finished/stale handling, copy/refresh controls, accessible labels, and responsive styling.
- Static, helper, and HTTP regression coverage where applicable.
- README documentation.
- Main-transcript-style live run indicator in virtual subagent tabs, driven by the existing bounded child activity fields.
- Full-width transcript cards in the dedicated virtual-tab surface; the compact overlay retains its bounded layout.

### Non-goals

- Changing `pi-subagents` or its RPC protocol.
- Steering, follow-up, resume, stop, interrupt, or abort controls from a subagent tab.
- Spawning an independent Pi RPC process for a subagent view.
- Persisting open subagent tabs across browser reloads or server restarts.
- Showing completed children that can no longer be discovered from the active-run side panel after their view was closed.

## Approved decisions and assumptions

- **Tab model:** virtual WebUI tabs keyed by parent tab ID, run ID, and child agent ID.
- **Lifecycle:** closing a virtual tab is view-only and cannot affect the child process.
- **Interaction:** view-only; no usable message input or subagent control actions.
- **Preference:** Overlay remains the default for backward compatibility; Tab / terminal is stored in `localStorage` for this browser.
- **Dependency scope:** no changes to `pi-subagents`; the current output/status bridge is sufficient.
- **Reopen behavior:** clicking the same child focuses the existing virtual tab instead of duplicating it.
- **Finished behavior:** an open virtual tab retains its last captured output and becomes non-polling when the child is no longer tracked.

## Architecture and interfaces

### Browser state

Add:

- `subagentOpenMode`: normalized `overlay | tab`, restored from browser storage.
- `subagentTerminalViews`: a map of virtual view records keyed by stable parent/run/agent identity.
- `activeSubagentTerminalId`: the selected virtual view, independent of the backend `activeTabId`.
- A dedicated refresh timer/request serial for the active virtual view.

The real backend tab remains the owning parent terminal. This preserves all existing tab-scoped API semantics while allowing the main content surface and tab bar to present a child-specific view.

### UI flow

```text
Subagents side panel
  -> user selects Overlay or Tab / terminal
  -> click child row
     -> Overlay: existing widget flow
     -> Tab: ensure parent terminal is active
             create/focus virtual child tab
             fetch /api/subagents/output for parent/run/agent
             render dedicated view-only transcript
```

### Close flow

```text
close virtual subagent tab
  -> clear only client-side view state/timer
  -> restore owning parent terminal surface
  -> no backend lifecycle request
```

### Files and boundaries

| File | Planned responsibility |
|---|---|
| `pi-package-webui/public/index.html` | Opening-mode selector and dedicated subagent terminal surface |
| `pi-package-webui/public/app.js` | Preference persistence, virtual-tab state/lifecycle, polling, rendering, close semantics |
| `pi-package-webui/public/styles.css` | Marked subagent tab, dedicated view, disabled composer, responsive behavior |
| `pi-package-webui/tests/mobile-static.test.mjs` | Structural and lifecycle regression assertions |
| `pi-package-webui/README.md` | User-facing behavior and view-only limitation |
| `plans/webui-subagent-terminal-view.md` | Canonical execution/review record |
| `reports/webui-subagent-terminal-view.html` | Final self-contained audit report |

No server or `webui-rpc-helper.mjs` change is planned unless implementation evidence shows the existing bounded output endpoint is insufficient.

## Ordered work items

| # | Work item | Dependency | Status |
|---|---|---|---|
| 1 | Add opening-mode markup, state normalization, persistence, and side-panel wiring | Approved decisions | Complete |
| 2 | Add virtual subagent tab identity, create/focus/close behavior, and real-tab restoration | 1 | Complete |
| 3 | Add dedicated transcript renderer and active-view polling using existing output API | 2 | Complete |
| 4 | Add view-only composer messaging, visual marking, responsive/accessibility styles | 2, 3 | Complete |
| 5 | Add/update focused regression tests and README | 1–4 | Complete |
| 6 | Run syntax, focused, and full package checks; resolve failures | 5 | Complete with pre-existing baseline failure noted below |
| 7 | Run independent cross-provider review; disposition every finding | 6 | Complete |
| 8 | Produce and validate final HTML report | 7 | Complete |
| 9 | Add main-style child run indicator with current activity and elapsed runtime | User follow-up | Complete |
| 10 | Remove the overlay width cap from dedicated-tab transcript cards | User follow-up | Complete |
| 11 | Add focused assertions, rerun checks, and obtain follow-up cross-provider review | 9–10 | Complete |
| 12 | Refresh and strictly validate the HTML report | 11 | Complete |
| 13 | Approve cross-package streaming scope and bounded event transport | User decision | Blocked pending approval |
| 14 | Add bounded live child-event transport for foreground and async subagents | 13 | Pending |
| 15 | Relay selected child events through authenticated WebUI SSE with reconnect cursor | 14 | Pending |
| 16 | Render child text deltas and live tool transitions with snapshot reconciliation | 15 | Pending |
| 17 | Add transport/UI tests, cross-provider review, and refresh the HTML report | 16 | Pending |

## Acceptance tests

- Opening-mode selector exists, has both modes, defaults safely, and is restored from browser storage.
- Agent row dispatches to overlay or virtual-tab opening according to the current preference.
- Virtual child tab key includes parent tab, run, and agent identity; duplicate clicks focus rather than duplicate.
- Subagent tabs have a visible **Subagent** marker and accessible names.
- Dedicated view uses the selected child’s `/api/subagents/output` query and the structured transcript renderer.
- Disabled input includes an explicit view-only instruction.
- Virtual close handler contains no `/api/tabs/close`, `/api/abort`, subagent stop, or interrupt call.
- Returning to a real terminal clears the virtual active state without closing the backend parent tab.
- Overlay mode continues to use `openSubagentOverlay` and render in the shared widget area.
- `npm run check` reaches and passes all feature assertions; no failure remains beyond the confirmed pre-existing package-lock baseline.
- Running virtual tabs append a pulsing **Agent is running:** card after live transcript output.
- The indicator shows the current tool and bounded arguments when available, otherwise the current activity state or a waiting fallback, plus elapsed runtime.
- Dedicated-tab transcript message cards and the live indicator fill the available transcript width; compact overlay sizing remains unchanged.
- Proposed: selected child `message_update` / `text_delta` events reach the browser incrementally rather than waiting for a completed `message_end` snapshot.
- Proposed: disconnect/reload falls back to the existing bounded snapshot and resumes streaming without duplicating completed output.
- Proposed: stream payloads remain bounded, scoped to the selected parent/run/child, and never expose filesystem paths to the browser.
- HTML report strict validation passes.

## Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Virtual selection diverges from real backend tab scope | High | Keep `activeTabId` bound to the owning parent and model child selection separately |
| Existing polling overwrites or unnecessarily redraws the child view | Medium | Use a dedicated active-view timer and request serial; render only meaningful changes |
| Closing a child view accidentally invokes terminal lifecycle code | High | Separate close handler and add source-level regression assertions for no backend call |
| Parent transcript state is lost when switching views | Medium | Hide/show dedicated surface instead of replacing the parent chat state or backend tab |
| Completed child disappears from side-panel discovery | Low | Retain the last snapshot in any already-open virtual tab and mark it finished |
| Mobile tab bar/view becomes crowded | Medium | Reuse terminal-tab primitives and add narrow-width styles/scrolling |
| Long current-tool arguments distort the running indicator | Medium | Reuse normalized bounded RPC fields and allow the indicator metadata to wrap within the full-width card |
| Full-width rule unintentionally expands compact overlay cards | Medium | Scope width overrides strictly under `.subagent-terminal-transcript` |

## Verification record

- `node --check public/app.js` — **passed**.
- `node tests/subagents-helper.test.mjs` — **passed**.
- `node tests/http-endpoints-harness.test.mjs` — **passed**.
- `git diff --check -- pi-package-webui plans/webui-subagent-terminal-view.md` — **passed**.
- `npm run check` — syntax checks and 27/28 test files passed. `tests/mobile-static.test.mjs` reached and passed all new subagent terminal assertions, then failed on an unrelated pre-existing package-lock invariant: the tracked lockfile lists optional companion packages in both root `dependencies` and `optionalDependencies`, while the tracked test expects them absent from root `dependencies`. The same mismatch exists at `HEAD`; this feature does not modify `package.json` or `package-lock.json`.
- Initial direct focused commands were invoked once from the monorepo root with package-relative paths and failed with `MODULE_NOT_FOUND`; rerunning from `pi-package-webui/` produced the results above.
- Post-review fix verification: `node --check public/app.js`, `node tests/subagents-helper.test.mjs`, and `node tests/http-endpoints-harness.test.mjs` — **passed**.
- `python3 ./scripts/validate_report.py reports/webui-subagent-terminal-view.html --strict` from the `html-report` skill directory — **PASS**, no warnings or errors.

## Follow-up verification (2026-07-20)

- `node --check public/app.js` — **passed**.
- `node tests/subagents-helper.test.mjs` — **passed**.
- `node tests/http-endpoints-harness.test.mjs` — **passed**.
- `node tests/mobile-static.test.mjs` — all follow-up assertions, including unchanged-poll DOM stability and targeted elapsed-node refresh behavior, passed; the unchanged tracked package-lock invariant then failed at line 1707.
- `git diff --check -- pi-package-webui plans/webui-subagent-terminal-view.md` — **passed**.

## Independent review

**Original review status:** Complete — **PASS**, no blocker or high-severity findings.  
**Reviewer:** `anthropic/claude-opus-4-8:high` in a fresh, read-only subagent context.  
**Artifact:** `.pi-subagents/artifacts/outputs/bd0ff5ae-a988-4410-9b7b-3f8fdb2404ff/reviews/webui-subagent-terminal-view.md`

### Finding dispositions

| Severity | Finding | Disposition |
|---|---|---|
| Low | Switching from an active virtual child tab to Overlay mode could render the overlay into the still-hidden parent widget area when both belong to the same parent terminal. | **Fixed.** `openSubagentOverlay` now deactivates any active virtual child surface before deciding whether the owning backend tab needs switching. The static regression assertion was tightened, and syntax/helper/endpoint checks were rerun successfully. |
| Low | The package-lock invariant keeps `npm run check` red. | **Accepted as pre-existing baseline.** Reproduced at `HEAD`; neither lockfile nor package manifest is in this feature diff. Track separately. |
| Low / informational | The CSS-hidden parent composer remains in the DOM, so command-palette actions can still target the parent terminal. | **Accepted by design.** The child surface itself is inert and view-only; parent-terminal interaction is explicitly allowed and no action can target the child through this view. |
| Low / informational | Finished child transcript uses `aria-live="off"`. | **Accepted.** Static content remains keyboard/navigation accessible while preventing stale completion announcements. |
| Residual | No runtime DOM automation covers open → focus → close → reopen; repository coverage is source-pattern based. | **Accepted residual risk.** Lifecycle was code-traced by the independent reviewer and protected by no-backend-call assertions; focused helper and HTTP harnesses pass. |

### Follow-up review round 1

**Reviewer:** `anthropic/claude-opus-4-8:high` in a fresh, read-only context.  
**Artifact:** `.pi-subagents/artifacts/outputs/33fb9bf5-7098-49e3-b7b0-84c7098f825b/reviews/webui-subagent-terminal-follow-up.md`  
**Verdict:** **FAIL** pending one medium-severity correction; both user-requested visual requirements were independently confirmed satisfied.

| Severity | Finding | Disposition |
|---|---|---|
| Medium | Every one-second background poll rebuilt the full polite live transcript twice and toggled a separate polite status line, even when only `updatedAt` changed. | **Fixed; re-review pending.** Background refreshes now compare a meaningful snapshot with transport-only `updatedAt` removed. Unchanged polls preserve transcript/tab DOM and do not expose routine loading state. Manual refresh updates only status/button chrome unless child data meaningfully changes. Routine status uses `aria-live="off"`; errors switch it to polite. A VM behavior check proves an unchanged background poll performs zero transcript/tab renders and clears internal loading state. |
| Note | Browser lifecycle/layout checks remain source-pattern based. | **Accepted residual.** The new VM check adds runtime behavior coverage for unchanged polling; actual browser geometry and assistive-technology automation remain outside the current harness. |

**Post-fix checks:** syntax, helper tests, HTTP endpoint harness, unchanged-poll VM assertion, and `git diff --check` pass before the same unrelated package-lock baseline failure.

### Follow-up review round 2

**Reviewer:** resumed `anthropic/claude-opus-4-8:high` read-only review.  
**Verdict:** **FAIL** pending elapsed freshness and one low-severity metadata correction; the prior polling/accessibility finding was confirmed fixed.

| Severity | Finding | Disposition |
|---|---|---|
| Medium | Suppressing unchanged transcript rebuilds froze elapsed runtime until another meaningful child event. | **Fixed; final re-review pending.** Activity and elapsed metadata are separate nodes. Unchanged polls update only an existing visual elapsed node, marked `aria-hidden="true"`, preserving transcript node identity and avoiding live-region re-announcement. The VM behavior test now proves exactly one targeted elapsed update and zero transcript/tab renders. |
| Low | A retained 404-completed view could keep raw `running` text in its header from the last snapshot. | **Fixed.** Header facts now prefer `finished` whenever `view.finished` is true. |

### Follow-up final review

**Reviewer:** fresh `anthropic/claude-opus-4-8:high` read-only review.  
**Artifact:** `.pi-subagents/artifacts/outputs/926cd05e-c0b3-45e1-bd8c-8d79cd637e5a/reviews/webui-subagent-terminal-follow-up-final.md`  
**Verdict:** **PASS** — no blocker, high-, medium-, or low-severity implementation findings.  
**Confidence:** 97/100.

The reviewer independently executed refresh-control VM scenarios and confirmed:

- unchanged background poll: zero transcript renders, zero tab renders, one targeted elapsed-node update;
- meaningful child change, 404 completion, and transient error: one view render and one tab render each;
- unchanged manual Refresh: status/button chrome only, no transcript/tab rebuild;
- elapsed refresh mutates only the existing `.subagent-run-indicator-elapsed` node, which is `aria-hidden`;
- retained completion metadata says `finished`;
- the main-style current-activity indicator, full-width dedicated cards, bounded compact overlay, and view-only close safety remain correct.

Residual risks remain browser/assistive-technology automation gaps and the unrelated tracked package-lock invariant. No implementation finding remains open.

## Follow-up decisions (2026-07-20)

- **Activity treatment:** reuse the main transcript's `runIndicator`, pulse, headline, metadata, and streaming classes rather than inventing a separate visual language.
- **Live detail source:** use existing `currentTool`, bounded `currentToolArgs`, `activityState`, and run `startedAt`; no backend or `pi-subagents` protocol change is needed.
- **Indicator lifetime:** show it whenever the selected child is running, including while waiting between tools; remove it once the retained child view is finished.
- **Width:** only dedicated virtual-tab transcript cards become full width. The existing compact overlay remains width-bounded.

## Streaming follow-up evidence and open decision (2026-07-20)

### Current behavior

The virtual child view is **not yet equivalent to main-terminal token streaming**:

- the main terminal receives Pi RPC `message_start`, `message_update` with `text_delta`, and `message_end` events through `/api/events` SSE;
- the child runner receives those same child events internally, but `pi-subagents` explicitly excludes `message_update` from its persisted async event log;
- the child transcript artifact and WebUI helper expose only completed `message_end` / `tool_result_end` snapshots;
- the browser therefore polls `/api/subagents/output` every second and can only render completed child messages plus tool/activity state.

### Recommended architecture requiring approval

1. Extend `pi-subagents` with a bounded, sanitized live child-event channel covering both foreground and async runs.
2. Have the WebUI server authenticate and relay only the selected parent/run/child events through SSE using a reconnect cursor; never expose child event-file paths to the browser.
3. Reuse the main incremental streaming renderer for child `text_delta` updates and reconcile on `message_end` with the existing bounded snapshot.
4. Keep the current one-second snapshot poll as fallback for missing capability, disconnects, completion, and older `pi-subagents` versions.

This is a cross-package dependency change. The earlier approved no-`pi-subagents` constraint cannot deliver true token-by-token parity because the required child deltas are currently discarded before the WebUI can observe them.

## Completion checklist

- [x] Original implementation matches approved view-only scope.
- [x] Follow-up indicator and full-width layout meet the new acceptance checks.
- [x] Feature checks introduce no regression beyond the tracked baseline.
- [x] Follow-up independent review findings are resolved or explicitly accepted.
- [x] Plan and HTML report link to each other for the completed snapshot-based feature.
- [ ] Streaming dependency scope is approved.
- [ ] True child delta streaming and fallback reconciliation are implemented and verified.
- [ ] Final streaming review and HTML report refresh are complete.
