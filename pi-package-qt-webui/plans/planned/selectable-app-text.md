# Selectable app text

## Goal and classification

Make readable app text selectable with the mouse and keyboard and copyable without changing action semantics, links, rendering safety, or scrolling.

Complex: the inspected application already selects transcript bodies, but has about 100 remaining labels across the shell, workspace rows, status panels, shared components, and dialogs. Shared text behavior and separate dialog integration/testing are meaningful implementation slices. The preliminary lightweight classification does not fit this evidence.

Integration owner: parent Pi session. Source checkout only. Existing unrelated and earlier scrolling changes must be preserved. No commits, installation, publication, global settings, or dependency upgrades.

## Scope and invariants

- Readable titles, paths, metadata, status details, notices, explanatory dialog text, and row text should allow drag selection and normal Ctrl+C. Existing editable fields and selectable transcript bodies stay functional.
- Action buttons, decorative icons, spinner glyphs, menu indicators, and drag handles remain controls rather than text editors. Dropdown/row text may require explicit click-versus-selection arbitration; selection must not activate a command, open a session, or submit a dialog.
- Untrusted strings remain PlainText. Only already sanitized Markdown uses rich text. Never broaden HTML or link policy.
- Preserve existing font, palette, wrapping, bounded sizing, accessibility, and full original text for copying. For converted selectable fields, elision preservation is explicitly relaxed: render actual source with a read-only TextEdit clipped within existing geometry instead of mismatched elided Label glyphs. Action/decorative controls keep native Label elision. Long selectable fields may clip; focused Ctrl+A/C must copy the full source.
- Preserve doubled transcript/workspace wheel speed, browser-style middle-click autoscroll, scrollbar dragging, link confirmation, keyboard navigation, completion, and dialog focus.
- Selection is field-local. Cross-message or cross-window continuous selection is not part of this change.

## Decisions

Approved: selectable readable text across the app, while action controls retain their interaction; one shared text policy/component if it avoids divergent fixes; native read-only selection and standard copy behavior; no clipboard writes without user copy input.

Current approved W1 architecture, option B: a real read-only PlainText TextEdit is the rendering and selection authority for converted fields. Use bounded clipping rather than ellipsis, preserving one-line versus wrapped behavior, existing dimensions, fonts, colors, and accessibility. Do not layer full-source selectable geometry over a differently elided Label. A drag-threshold tap signal from selectable row text plus blank-row tap handling must retain exactly-once row activation while selection activates nothing. No custom ellipsis/source mapping, separate clipboard path, or new rich-text path. Document clipping and full-source focused Ctrl+A/C.

Architecture checkpoint: W1 proposed selecting directly in Qt Quick Text. Rejected before writes because installed Qt 6.11 QQuickText metadata has no selectByMouse/selectByKeyboard; those properties belong to QQuickTextEdit. W1 then reported a disposable Qt 6.11.2 prototype with six passing checks for the Label/TextEdit composition, drag versus click, and full-source Ctrl+A/C. Parent approved that revised architecture with mandatory coherent elision/wrapping/selection rendering and actual SessionList input-arbitration checks. W1 must retain the prototype source/output for inspection and escalate any visual/API trade-off. Useful status values, errors, notices, and headings remain readable-text scope; only truly decorative/action glyphs are excluded.

## Execution order and ownership

All children use the shared dirty checkout sequentially. No concurrent writers and no automatic worktrees.

1. Scout, read-only: inventory labels, existing selection primitives, interaction/layout hazards, and recommend a bounded shared approach. Artifact `selection/scout.md`.
2. W1, shared component and main-window integration: after parent approval, own `qml/components/` except `Composer.qml`, `CompletionPopup.qml`, `DropUpPicker.qml`, and `TabStrip.qml`; own `qml/shell.qml`; may create focused selection tests under `tests/qml-selectable-text.test.mjs` and `tests/fixtures/selectable-text-checks.qml`; may adjust existing QML contract/scroll tests only for required component imports and valid changed contracts. No dialogs, backend, plan, or documentation edits. Artifact `selection/main-window.md`.
3. W2, dialog and interactive-row integration plus validation: request parent inspection/acceptance of W1 before writing. Own `qml/dialogs/`, `qml/components/Composer.qml`, `CompletionPopup.qml`, `DropUpPicker.qml`, and `TabStrip.qml`, tests and fixtures required for this scope, and README/TECHNICAL/DEVELOPMENT updates. W1's shared text component is read-only unless a verified integration fix is separately approved. Artifact `selection/dialogs-validation.md`.
4. Parent inspects integrated changes and test evidence. W2 requests this checkpoint after completing all writes and before returning. No further writes after the checkpoint unless approved.
5. Two fresh read-only reviews after parent acceptance: Claude CLI for interaction/layout/security and a distinct available OpenRouter author family for broad correctness, coverage, maintainability, and plan compliance. Both review the integrated target and return independently. Artifacts `selection/review-claude.md` and `selection/review-independent.md`.
6. Parent dispositions findings, applies only accepted bounded corrections, reruns checks, and creates the final report at `../../reports/qt-webui-selectable-app-text.html`. Required fixes needing a worker retain the original workstream identity.

Every worker reports identity/status, changed files, commands and exit codes, omitted checks, assumptions, risks, and its unique output reference. All children stop for unapproved scope, architecture, product, security, compatibility, ownership, or dependency decisions.

## Acceptance and validation

- Actual Qt mouse selection and Ctrl+C for representative main-window and dialog text in both themes and display scales.
- Plain-text safety for HTML-like paths/messages; existing sanitized rich-text behavior preserved.
- Drag selection does not activate row actions, confirmation, completion, or links. A normal click/keyboard activation still works where intended.
- Long/wrapped/elided text, resize, selection colors, focus restoration, empty strings, and updates while selected have bounded behavior.
- Existing QML contracts, transcript/workspace scroll tests, docs contracts, and live Quickshell smoke tests pass.
- Run full `npm run check` before final acceptance; classify pre-existing failures separately with evidence.
- Two independent review outputs and dispositions recorded below; HTML report linked back to this plan; completed plan archived only after verification.

## Integration and rollback

Inspect each handoff and actual source diff before advancing. Preserve prior uncommitted user changes. Revert only this workstream's edits if rollback is needed, never reset the repository. Keep source-only rollout explicit.

## Progress and evidence

- Repository inspected; model/agent discovery complete. Scout handoff completed in workflow `717eb300-e9bd-4897-8c72-a653304a9997`, artifact `selection/scout.md`.
- W1 run `5bd7b641-524e-44d0-b239-591b9588f11c` stopped for architecture approval before any production writes. Parent rejected the unsupported Text selection API and requested a verified temporary prototype.
- Revised Label/TextEdit proposal approved through supervisor request `8ce9d2c4-4632-465b-95c4-2415057e6f95`; W1 implementation is now authorized within its ownership. Required checks include coherent selection of elided/wrapped text, full original copy text, exactly-once row taps, non-activating selection drags, and independent Settle/Close controls.
- W1 demonstrated that native Label elision and TextEdit partial-selection geometry cannot agree for left/middle elision, and stopped before production edits. Parent approved option B through request `00a5277f-c732-4534-9445-345e7e9fbf1a`: correct native source selection with bounded non-elided TextEdit rendering. This supersedes the transparent-overlay proposal and explicitly relaxes elision preservation only for converted text fields.
- W1 completed. Parent inspected its handoff, `SelectableText.qml`, actual SessionList tap/selection integration, status/notice conversions, and test changes. Ownership matched the W1 contract; previous dirty documentation and scrolling changes remain present.
- Parent reran native selection, QML contracts, transcript autoscroll, and workspace scrolling tests: 33 Node tests passed with no skips, including native Qt runs at both scales. Log: `/tmp/qt-webui-selection-w1-parent-check.log`. Scoped whitespace and no-staged-files checks passed.
- W1 is accepted as an integrated workstream, not final feature completion. W2 run `fc17441c-362f-40cf-9267-891db69f6aad` is approved to begin its owned dialog/interactive-component, test, and documentation slice. Shared W1 production files remain read-only unless separately authorized.
- Validation gap for W2: extend the native offscreen fixture to verify Ctrl+C through a test-only editable paste sink where supported, rather than equating retained selection with clipboard content. Preserve the test-only clipboard isolation and report any real limitation.
- W2 completed its owned slice and stopped for integration approval. Parent inspected `selection/dialogs-validation.md`, the actual dialog/interactive-row and layered-documentation diffs, the shared component, and the native clipboard/arbitration fixture. No ownership or source-only rollout blocker was found.
- Parent independently reran W2's focused docs/contracts/completion/native Qt suite: 37 tests passed with zero skips. Exact Ctrl+C → editable paste-sink checks and drag-versus-action checks passed at both scales and in both themes. Log: `/tmp/qt-webui-w2-parent-integration-check.log`.
- Inspected the full integrated `npm run check` log from W2: 272 passed, zero failures/skips (`/tmp/qt-webui-w2-npm-check.log`). Parent whitespace and no-staged-files checks passed. Layout bindings were inspected in source; this is not a claim of manual desktop/screenshot visual inspection.
- W1+W2 are accepted as review-ready. W2 may finalize its handoff without further source writes, allowing the existing workflow to start the two fresh read-only reviews. Independent review quorum, finding dispositions, final acceptance, and final report remain pending.
- Review recovery: external `claude-code` attempt `e03faf30-1772-4602-b6c7-5657eb2a9efe` failed during Pi runner startup (`MODULE_NOT_FOUND`, imported through `dist/experimental/server.js`), without a review result. Fleet inspection confirmed the other reviewer, `412b2a46-78f4-45a2-87a7-5033a1848872`, remains live and reports `claude-opus-4.8`; it was not duplicated or interrupted.
- One bounded read-only replacement attempt for only the failed slot used native `reviewer` with the generated eligible `openrouter/google/gemini-3.8-flash:batch:high` selection via `subagent_gate` (one attempt, one required success). It returned `0/1 qualifying successes`, `reviewer#1 pre-launch`, with no detailed rejection cause in the tool response. No qualifying replacement output exists. The default two-attempt slot budget is exhausted; keep the review gate incomplete rather than blindly repeating or repairing global dependencies outside task scope.
- The workflow has now settled. Reviewer `412b2a46-78f4-45a2-87a7-5033a1848872` completed and its artifact was inspected. Runtime status reported `claude-opus-4.8`; the originally requested Google model is not evidence of actual provider diversity. The final workflow notification identifies the failed CLI slot as `591aae36-60ea-47e0-9d57-b6461dceb58e`, while its earlier startup/session record used `e03faf30-1772-4602-b6c7-5657eb2a9efe`. These identify the same failed logical slot, not two qualifying reviews.

## Independent review dispositions

Reviewed artifact: `/home/firstpick/.pi/agent/sessions/--home-firstpick-npm-packages--/subagent-artifacts/outputs/717eb300-e9bd-4897-8c72-a653304a9997/selection/review-independent.md`.

| ID | Finding | Disposition | Parent evidence and decision |
| --- | --- | --- | --- |
| R1 | Converted text exposes an editable accessibility role | accepted | Confirmed with the actual Qt 6.11.2 `QAccessible` interface. Baseline Label has role 41, StaticText; the shared selector's editor has role 42, EditableText, and reports readOnly=0. Preserve display-text semantics explicitly and add regression coverage before final acceptance. See BUG-001 below. |
| R2 | Double-clicking a directory name no longer navigates | rejected | Intentional selection/action separation. `DirectoryDialog.qml` excludes name-text geometry from double-click navigation; the native fixture verifies word selection does not navigate. Restoring navigation during word selection would violate the approved no-accidental-action requirement. Enter and blank-row double-click remain navigation paths. No new navigation control is authorized by this finding. |
| R3 | Text focus breaks list Enter/Space and arrow navigation | rejected | Not reproduced as stated. A disposable native Qt probe with two actual SessionList entries verified baseline Down navigation, clicked the selectable title, then observed editor activeFocus=true and list activeFocus=true, one Return action, one Space action, and Down moving to index 1. Focus scopes and key propagation invalidate the review's assumption that the list must lose active focus. This result covers SessionList, not every possible key sequence in every dialog. No speculative focus-restoration patch, which could break copy, is justified. |
| R4 | I-beam replaces pointing-hand cursor over selectable row text | rejected | Intentional affordance for the newly selectable text region. Ordinary row taps and blank-row actions are separately tested. Replacing the I-beam is a cosmetic preference, not a requirement failure. |
| R5 | Native runners do not assert executed test counts or zero Qt skips | deferred | Confirmed inspection of both new Node runners: they check runner exit status and failure/error patterns, but not a minimum pass count. Current retained Qt logs demonstrate executed cases with zero skips, so this does not invalidate current evidence. Add positive case-discovery/zero-skip assertions as a bounded future test-hardening change; no claim that the current runners already enforce them. |

The review's empty-source note is a coverage suggestion, not a demonstrated defect. No scope expansion is approved for it.

### Parent verification evidence

- Keyboard probe source: `/tmp/qt-webui-review-probe.py`; generated fixture and output: `/tmp/qt-webui-review-probe-h6i9k2nv/`. The probe copies production components and adds only a test alias for the Working list. Command `python /tmp/qt-webui-review-probe.py` passed three Qt cases, zero failures/skips, and printed the focus/action/index observations in R3.
- Accessibility probe source: `/tmp/qt-webui-review-accessibility.cpp`; QML: `/tmp/qt-webui-review-probe-h6i9k2nv/accessibility.qml`; log: `/tmp/qt-webui-review-accessibility.log`. The copied selector only adds an editor object name for lookup. Compile with `g++ -fPIC /tmp/qt-webui-review-accessibility.cpp -o /tmp/qt-webui-review-accessibility $(pkg-config --cflags --libs Qt6Quick Qt6Qml Qt6Gui)` and run with `QT_QPA_PLATFORM=offscreen QT_QUICK_BACKEND=software /tmp/qt-webui-review-accessibility /tmp/qt-webui-review-probe-h6i9k2nv/accessibility.qml`.
- Initial probe compilation without `-fPIC` failed with a Qt protected-symbol copy-relocation error. Adding `-fPIC` resolved the diagnostic build issue. No installed packages or global settings were changed.
- These are disposable verification probes, not committed regression tests. No production edits were made during finding disposition.

## Confirmed bug

| Bug | Severity | Module | Status | Summary |
| --- | --- | --- | --- | --- |
| BUG-001 | Major | Shared selectable text | OPEN | Readable display text exposes editable accessibility semantics. |

### BUG-001: Selectable display text exposes editable accessibility semantics

**Severity:** Major
**Module:** `qml/components/SelectableText.qml`
**Spec Reference:** Scope and invariants, preserve accessibility.
**Found During:** Independent review R1 and parent native Qt accessibility probe.

#### Reproduction Steps

**Preconditions:** Installed Qt 6.11.2 development libraries and the current shared component.

**Steps:**
1. Instantiate a baseline Qt Quick Controls Label and the current SelectableText with ordinary display text in an offscreen QQuickView.
2. Obtain the selector's internal TextEdit and the baseline Label using object names in a disposable copy.
3. Query each using `QAccessible::queryAccessibleInterface`, then inspect `role()` and `state().readOnly`.

#### Expected Result

Converted display text retains static/read-only accessibility semantics. Existing heading and alert meaning must remain intact.

#### Actual Result

The selector editor reports EditableText and does not expose the read-only accessibility flag.

**Evidence:**
- `baselineLabel role=41 static=1 editable=0 readOnly=0`
- `baselineEditor role=42 static=0 editable=1 readOnly=0`
- `selectorEditor role=42 static=0 editable=1 readOnly=0`

#### Environment

- Runtime: Qt 6.11.2, Linux x86_64.
- Configuration: offscreen platform, software Qt Quick backend.
- This verifies Qt accessibility interfaces, not an end-to-end Orca/AT-SPI session.

#### Analysis

**Likely root cause:** The shared TextEdit lacks explicit accessible role/name/read-only metadata, unlike existing readable TextEdit integrations.
**Related bugs:** None confirmed.
**Workaround:** None verified for assistive-technology users.

## Remaining acceptance blockers

- Fix BUG-001 within the shared component's contract, preserve heading/alert semantics, and run native accessibility and selection regressions. Revalidate the integrated checkout after any fix.
- Obtain the missing independent review from a distinct actual provider family. Current qualifying review count is 1 of 2. The failed slot's bounded retry budget is exhausted, and repairing installed Pi dependencies would require separate authorization.
- Final visual/assistive-technology checks remain unverified. The passing native input/layout tests must not be described as a manual desktop or screen-reader inspection.
- Final HTML report and plan archival remain pending. Keep this plan under `plans/planned/`; the feature is not accepted as complete.
