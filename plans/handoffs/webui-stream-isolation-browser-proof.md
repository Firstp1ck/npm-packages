# WebUI stream-output isolation — WS2b browser proof handoff

- **Workstream:** WS2b — deterministic browser isolation proof and hardening
- **Identity:** implementation worker 3, sole sequential writer after WS2a, persisted run resumed for one recovery-validation pass
- **Status:** implemented, validated, and recovery-revalidated; not staged, not committed
- **Baseline revision:** `6f96d29256c2362bee165469899b4007e1655f18` (HEAD unchanged)
- **Baseline state:** WS1 controller/routing and WS2a lifecycle/chrome/todo separation integrated in the working tree; prerequisite syntax/focused checks and all 113 WebUI check files passed before WS2b edits
- **Result state:** deterministic normal/compact browser proof passes together with the full interaction-continuity browser suite and all 113 WebUI check files; the persisted result was revalidated unchanged after an orchestration-only acceptance configuration rejection
- **Classification:** complex remains valid. This handoff completes WS2b only; central integration, independent review quorum, final report, and plan archival remain parent-owned gates.

## Changed files

- `pi-package-webui/tests/fixtures/fake-pi.mjs`
  - adds an opt-in `FAKE_PI_STREAM_ISOLATION=1` normal/compact scenario;
  - emits explicit pre-burst semantic boundaries, exactly 1,000 indexed `text_delta` transport events, thinking/tool-call/tool-execution raw events, and explicit post-burst semantic boundaries;
  - records run/mode/phase/subtype/index fields in the existing opt-in JSONL command log;
  - settles an authoritative deterministic assistant tail.
- `pi-package-webui/tests/browser/stream-output-isolation.spec.mjs`
  - boots the real WebUI server with the fake-Pi transport;
  - proves normal and compact raw-stream ownership with a document-wide `MutationObserver`, focus listeners, node-identity references, scroll snapshots, request capture, open dropdown/modal assertions, selection continuity, and authoritative final-tail equality;
  - records exact mutation/focus/node/network counters to test output;
  - keeps semantic lifecycle polling and workspace-watcher events outside the raw observation window rather than allowlisting them.
- `plans/handoffs/webui-stream-isolation-browser-proof.md`
  - this handoff.

No product source, controller interface, canonical plan, report, package metadata, lockfile, service worker, or unrelated existing test was modified by WS2b. Browser evidence exposed no product-source event-ownership defect requiring a correction.

## Fixture and observation contract

### Deterministic event flow

Each mode has a unique run ID and emits:

1. **Pre-burst semantic boundaries**
   - normal: `agent_start`, `tool_execution_start`, `message_start`;
   - compact: `agent_start`, `message_start`, `tool_execution_start` (compact must create its shell after message reset).
2. **Raw window**
   - thinking start/delta/end;
   - text start, exactly 1,000 ordered/indexed `text_delta` events, text end;
   - tool-call start/delta/end;
   - `tool_execution_update`.
3. **Post-burst semantic boundaries**
   - `tool_execution_end`, `message_end`, `agent_end`, `agent_settled`.

The final text delta carries the complete deterministic 250-character numeric body and explicit begin/tail markers; the preceding 999 empty deltas still traverse the real EventSource classifier/controller path. This intentionally tests ownership/event cadence without turning the proof into a Markdown throughput benchmark. The browser ledger asserts all indexes `0..999` are present and ordered, and authoritative settlement must equal the exact concatenated raw text.

### Explicit mutation allowlist

Only these mutations are allowed during the raw window:

- any attribute, character-data, or child-list mutation whose target is under `#chat` (the transcript-owned root);
- `hidden` attribute writes on `#jumpToLatestButton`, the approved chat follow-scroll control.

Everything else observed under `document.documentElement` is forbidden. The proof also independently requires zero focus events, unchanged `document.activeElement`, zero unrelated identity changes, zero non-chat scroll changes, preserved selection endpoints/text, open dropdown/modal continuity, and zero page HTTP/RPC requests.

The fixture JSONL ledger is deliberately outside the watched WebUI workspace. Keeping it under the fixture cwd initially manufactured real `webui_workspace_files_changed` events; moving the test ledger outside the workspace removed that harness artifact without weakening any assertion.

## Browser results and exact counters

Counters below are from the final combined affected-browser run:

| Metric | Normal | Compact |
| --- | ---: | ---: |
| Transcript attributes | 89 | 38 |
| Transcript character-data | 3 | 2 |
| Transcript child-list | 34 | 15 |
| Allowed follow-control attributes | 7 | 0 |
| Forbidden attributes | **0** | **0** |
| Forbidden character-data | **0** | **0** |
| Forbidden child-list | **0** | **0** |
| Focus events | **0** | **0** |
| Active-element changes | **0** | **0** |
| Unrelated root/control replacements | **0** | **0** |
| Non-chat scroll changes | **0** | **0** |
| Raw-window HTTP/RPC requests | **0** | **0** |
| Selection changes/disconnections | **0** | **0** |
| Dropdown/modal closures | **0** | **0** |
| Chat scroll | `0 → 767` (auto-follow active) | `446 → 446` (paused reader) |
| Lost final tail | **0** | **0** |

Normal mode directly observed thinking, assistant text, tool-call arguments, and live tool-execution output. Compact mode directly observed compact thinking/text; the transport also delivered and logged tool-call and tool-execution-update events. Compact intentionally ignores rich `tool_execution_update` body rendering under the existing controller sink and retains its semantic compact tool-shell behavior.

## Validation evidence

Commands ran from `/home/firstpick/npm-packages/pi-package-webui` unless noted.

| # | Command | Exit | Result |
| --- | --- | ---: | --- |
| 1 | `node --check public/app.js && node --check public/stream-output-controller.mjs && node tests/stream-output-controller.test.mjs && node tests/stream-output-isolation-static.test.mjs && node tests/streaming-ui-coupling.test.mjs && npm run check` | `0` | WS2a prerequisite reverified; focused controller/static/lifecycle checks passed and all 113 WebUI check files passed before WS2b edits. |
| 2 | `node --check tests/fixtures/fake-pi.mjs && node --check tests/browser/stream-output-isolation.spec.mjs` | `0` | New/changed JavaScript syntax passed. |
| 3 | `node --check tests/fixtures/fake-pi.mjs && node --check tests/browser/stream-output-isolation.spec.mjs && for test_file in tests/stream-output-controller.test.mjs tests/stream-output-isolation-static.test.mjs tests/streaming-ui-coupling.test.mjs tests/interaction-state-stability-static.test.mjs tests/chat-scroll-intent-static.test.mjs tests/fast-output-live.test.mjs tests/fast-mode-client-static.test.mjs tests/webui-output-mode.test.mjs tests/fast-mode-output-work.test.mjs tests/completion-signal-contract.test.mjs tests/sse-backpressure-harness.test.mjs tests/thinking-stream-recovery.test.mjs tests/compaction-resume-harness.test.mjs tests/mobile-static.test.mjs; do node "$test_file" || exit; done` | `0` | Syntax plus 14 affected controller/static/interaction/compact/completion/SSE/thinking/compaction/mobile checks passed. |
| 4 | `npm run test:browser -- --grep "stream output isolation"` | `0` | 2/2 Chromium isolation tests passed; final raw counters are recorded above. |
| 5 | `npx playwright test tests/browser/stream-output-isolation.spec.mjs tests/browser/interaction-continuity.spec.mjs` | `0` | 24/24 Chromium tests passed, including the new proof plus selection, pointer, tool, dropdown, scroll-intent, compact, and settlement continuity coverage. |
| 6 | `npm run check` | `0` | All syntax checks and all **113/113** WebUI check files passed after WS2b edits. |
| 7 | `git diff --check` (repository root) | `0` | No whitespace errors. |
| 8 | `git diff --cached --name-only` (repository root) | `0` | Empty output; no staged files. |

### Persisted-run recovery validation

The original WS2b process result was rejected only because the parent requested runtime acceptance level `verified` without supplying runtime `verifyCommands`. The integration owner confirmed this was an orchestration configuration error, not an implementation, browser-proof, or validation failure. This persisted worker run was resumed without changing product/source behavior.

Recovery commands and results:

| Command | Exit | Recovery result |
| --- | ---: | --- |
| `cd pi-package-webui && npm run test:browser -- --grep "stream output isolation"` | `0` | **2/2 passed.** Normal: transcript mutations `89/3/34`, allowed follow mutations `7`, forbidden mutations `0/0/0`, focus/replacement/non-chat-scroll/network counts all `0`, chat `0 → 767`. Compact: transcript mutations `38/2/15`, allowed follow mutations `0`, forbidden mutations `0/0/0`, focus/replacement/non-chat-scroll/network counts all `0`, paused chat `446 → 446`. |
| `cd pi-package-webui && npm run check` | `0` | All syntax checks and **113/113** WebUI test files passed. The Windows-only ConPTY harness remained its established environment skip. |
| `git diff --check` | `0` | Final recovery working tree has no whitespace errors, including this handoff update. |
| `git diff --cached --name-only` | `0` | Final recovery output is empty; no files are staged. |

No test assertion, fixture behavior, product source, controller interface, package metadata, or lockfile changed during recovery. The qualifying WS2b implementation outcome remains the fixture/spec/handoff set documented above.

### Development failures resolved without weaker assertions

Iterative browser runs initially exited `1` for harness reasons that were corrected:

- a selector required a nonexistent `.streaming` class on normal live tool cards;
- normal/compact pre-boundary order needed to respect each mode's existing reset/shell semantics;
- the command ledger was initially inside the watched workspace and generated real file-tree events;
- semantic lifecycle/tab/subagent polling initially overlapped the observation window;
- `#jumpToLatestButton[hidden]` writes were classified as forbidden until represented as the plan-approved explicit chat follow-scroll allowlist;
- modal inertness required selection inside the open modal rather than trying to create a range in inert background content.

The final test still asserts literal zero for every forbidden mutation type, focus event, unrelated replacement/scroll change, and raw-window request. No assertion was relaxed to accept a product defect.

## Omissions and environmental limits

- Chromium was run. WebKit is package-opt-in (`PI_WEBUI_TEST_WEBKIT=1`) and was not run in this environment.
- The new proof uses a 1280×720 desktop viewport. It does not repeat the 1,000-event observer at 390×844 or 320×568; existing mobile static checks passed, but there is no new mobile MutationObserver result.
- The new spec directly covers normal/compact thinking/text, normal tool-call/tool-execution update, dropdown, modal, side-panel reader scroll, paused chat, selection, node identity, network, and settlement. Abort-during-stream, retry, compaction, voice, reconnect, model/thinking/branch pickers, file viewer, and individual workflow/subagent/release detail surfaces were not each rerun inside this new raw observer. Existing focused/full static checks and the 22-test interaction-continuity browser suite passed, but these omitted scenarios remain integration/reviewer considerations.
- No Firefox project is configured by the package and none was run.
- No manual visual inspection was used as acceptance evidence.

## Deviations, assumptions, unresolved decisions, and risks

- **Bounded fixture deviation:** 999 of the exactly 1,000 indexed text deltas are empty and the final delta carries the deterministic complete tail. This preserves a real 1,000-event EventSource/controller cadence while keeping the observer window between semantic lifecycle polls. The final tail is asserted losslessly; this is ownership evidence, not a token-throughput benchmark.
- **Approved allowlist:** seven normal-mode `hidden` writes to `#jumpToLatestButton` were observed and counted separately. This is the only non-`#chat` DOM allowlist and matches the approved chat follow-scroll exception. Compact paused-reader mode observed zero follow-control writes and an unchanged chat position.
- **Assumption:** scheduling the proof between known low-frequency semantic polling boundaries is the correct interpretation of “semantic boundaries are outside the raw-observation window.” The test does not mask or stub browser timers, `fetch`, EventSource, or renderers.
- **Risk:** mobile-specific and abort/retry/compaction/voice/reconnect observer scenarios remain unproven by the new spec, although existing regression suites passed.
- **Unresolved product/scope/architecture/interface/security/migration decisions:** none. No controller interface change or source correction was needed.

## Integration notes

1. Preserve the JSONL ledger outside the watched fixture cwd; placing it inside creates legitimate workspace mutation noise.
2. Preserve the exact allowlist: `#chat` descendants plus only `#jumpToLatestButton[hidden]`. Do not broaden it to footer, tabs, widgets, composer, body, side panel, or network reconciliation.
3. The 1,000-event ledger assertion is independent of DOM counters and proves complete ordered transport delivery in both modes.
4. Treat the normal and compact counter lines in Playwright output as the canonical WS2b measured evidence.
5. No product-source hunk needs integration from WS2b; only the fixture, new browser spec, and this handoff are WS2b-owned.
6. The overall complex feature remains **incomplete** until the parent performs central integration, two qualifying independent reviews with dispositions, accepted-fix revalidation, the final HTML report, and plan archival.
