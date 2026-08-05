# Independent Review A — Session Summary Correctness

## Review

### Reviewer verdict

The integrated feature has substantial correct coverage and the full package suite is green, but this review found **3 high**, **4 medium**, and **1 low** correctness findings. No blocker was identified. The most consequential issues are a reproducible scheduler wedge after a coalesced automatic failure, provider-independent setup feeding provider-specific raw request options, and stale WebUI summaries after active-branch tree navigation. This review does not decide acceptance or completion.

**Overall confidence: 95/100.** The key lifecycle defect was reproduced directly, all 111 package test files passed, installed Pi API/type/source contracts were inspected, and focused HTTP/core/migration tests passed. Confidence is below 100 because no real provider call or live custom-message RPC success fixture was run.

### Correct

- `session-summary.ts:271-282` uses the installed `agent_settled` event and returns synchronously; the focused fake-completion test confirms provider work does not delay settlement.
- `session-summary.ts:176-218` captures session ID/file, leaf, fingerprint, and entry count and revalidates before synchronous append/title mutation. `session-summary.ts:309` aborts the request on `session_shutdown`, matching the installed replacement lifecycle.
- `lib/session-summary-core.mjs:51-80` serializes only active-branch user text, assistant text, and tool names. Focused tests confirm exclusion of thinking, images, tool arguments/results, and prior summary content.
- `lib/session-summary-preferences.mjs:166-227` provides lock-protected atomic writes and `0600` files; malformed input fails closed and unknown keys survive normalized updates.
- `session-summary.ts:284-292` keeps context injection off by default and, when enabled, `lib/session-summary-core.mjs:218-230` removes historical display/RPC/injection messages and adds exactly one latest reference message.
- `bin/pi-webui.mjs:9301-9419` validates the versioned RPC projection, bounds fields, filters control/display messages from browser transcript transport, and applies generated tab titles only for `default|auto` title sources.
- `bin/pi-webui.mjs:14759-14785` places summary routes after existing remote-auth enforcement. Mutation routes require JSON, reject explicit cross-site requests, and use a 32-KiB body limit. The HTTP harness passed unauthenticated/setup/shape/body/SSE cases.
- Unrelated optional-feature migration source remains present, and both `tests/optional-feature-migration.test.mjs` and `tests/optional-feature-migration-frontend.test.mjs` passed. The full 111-file suite also passed.

### Findings

#### RSSA-01 — High — Coalesced failure can permanently wedge the scheduler

- **Affected file/symbol:** `lib/session-summary-core.mjs:255-289`, `createSummaryScheduler()`.
- **Violated requirement / failure mode:** Plan E5/E6 and success criterion 7 require fixed cooldown, newest-only coalescing, and manual cooldown bypass. If an automatic request fails while another automatic refresh is pending, the pending launch sees cooldown and returns an already-resolved promise. `finally()` assigns that bare promise to `inFlight` at line 276, but that promise has no cleanup path, so `inFlight` remains true forever. Future manual refreshes return the stuck cooldown result and cannot bypass cooldown.
- **Reasoning / reproduction:** An inline Node harness scheduled a blocked automatic request, queued a second automatic request, then failed the first. Output was `inFlight: true`, `pending: false`, `calls: 1`; a subsequent manual schedule returned `cooldown`, left `inFlight: true`, and did not increment calls. Existing tests cover coalescing and cooldown separately but not their interaction.
- **Minimal remediation:** Ensure every launch result, including `cooldown`/`disposed`, goes through a cleanup path, or do not assign non-launched cooldown promises to `inFlight`. Add a regression test for failure + pending + later manual bypass.
- **Confidence:** 100/100.

#### RSSA-02 — High — Provider-independent setup uses OpenAI-specific raw request options

- **Affected file/symbol:** `session-summary.ts:187-212`, direct `completeFn()` options.
- **Violated requirement / failure mode:** Plan success criterion 4 and E4 require the selected model/reasoning profile to be honored and `store:false` only where supported. The WebUI/TUI exposes all available models, but raw `complete()` receives `reasoningEffort` for every API and `onPayload` unconditionally adds `store:false` to every provider payload.
- **Reasoning / reproduction:** Installed public API contracts show different raw shapes: OpenAI Codex accepts `reasoningEffort` (`pi-ai/dist/api/openai-codex-responses.d.ts:3-8`), Anthropic expects `thinkingEnabled`/`effort` (`anthropic-messages.d.ts:5-32`), and Google expects `thinking` (`google-generative-ai.d.ts:3-9`). Their adapters invoke `onPayload` on native request objects. Thus non-OpenAI reasoning is ignored, while unsupported `store` is injected into Anthropic/Google/Bedrock/Mistral request shapes and may be rejected or at minimum violates the approved boundary. The focused test only asserts the OpenAI-shaped mutation.
- **Minimal remediation:** Build provider/API-specific raw options from `model.api` (including an explicit off mapping), and add `store:false` only for APIs/compatibility modes that support it. Alternatively use the installed simple-option mapping internally while preserving the approved single direct request semantics. Add representative OpenAI, Anthropic, Google, and ambient-provider option tests without network calls.
- **Confidence:** 96/100.

#### RSSA-03 — Medium — Available ambient-auth models are rejected when `apiKey` is absent

- **Affected file/symbol:** `session-summary.ts:179-184`, auth validation.
- **Violated requirement / failure mode:** Setup offers authenticated available models, but generation rejects any successful auth resolution without a literal API key. This makes valid header/env/ambient-auth providers (for example Bedrock or Vertex-style configurations) unusable after the UI permits selection.
- **Reasoning / reproduction:** Installed `ModelRegistry.getApiKeyAndHeaders()` returns `ResolvedRequestAuth` with optional `apiKey`, `headers`, and `env` (`pi-coding-agent/dist/core/model-registry.d.ts:5-13,29`). The implementation correctly passes headers/env at lines 200-202 but first throws at line 183 when `apiKey` is absent.
- **Minimal remediation:** Treat `auth.ok` as authoritative and let the selected provider adapter validate its supported auth combination; require a key only for APIs that actually require one. Cover an `ok:true` env/header-only fake model.
- **Confidence:** 98/100.

#### RSSA-04 — High — WebUI summary projection is stale after session-tree branch navigation

- **Affected file/symbol:** `session-summary.ts:294-307` (`session_start` projection only); `bin/pi-webui.mjs:9366-9407` (cached tab projection); `public/app.js:35557-35576` (`openSessionSummaryForTab`).
- **Violated requirement / failure mode:** Plan E9, success criteria 8/10, and WebUI validation require the active branch's latest state. Pi tree navigation changes the active branch without creating a new extension instance, but the extension does not handle `session_tree`. The browser therefore retains branch A's cached summary while branch B is active; because a cached Markdown value exists, clicking Summary opens it and does not ask the extension to regenerate.
- **Reasoning / reproduction:** Installed Pi exposes `session_tree` after navigation (`pi-coding-agent/dist/core/extensions/types.d.ts:489-497,866`). The repository's own `webui-rpc-helper.mjs:1659-1669` uses it to restore branch-local state. Session Summary only projects state on `session_start`, and neither the server nor client invalidates summary state on tree events. No summary test covers tree navigation.
- **Minimal remediation:** On `session_tree`, emit a fresh bounded `state` projection from `latestSummaryState(ctx.sessionManager.getBranch())` (and ensure stale in-flight work is discarded/settled). Add a branch A/branch B navigation test showing overlay and context use the new active branch.
- **Confidence:** 99/100.

#### RSSA-05 — Medium — A discarded stale generation leaves WebUI permanently “generating”

- **Affected file/symbol:** `session-summary.ts:175,218`; `bin/pi-webui.mjs:2899-2907,9391-9399`.
- **Violated requirement / failure mode:** Plan validation requires stale failures to preserve the previous result and expose bounded actionable feedback. Generation emits `generating`, but a stale source simply returns `{ stale:true }` without a terminal RPC state. If no coalesced settled refresh follows (for example a tree navigation during a manual refresh), the WebUI overlay remains generating indefinitely.
- **Reasoning / reproduction:** The control flow has no `success`, `failure`, or restored `state` emission between the stale return at line 218 and scheduler success wrapping. The server only exits `generating` on a later `state`, `success`, or `failure` event.
- **Minimal remediation:** Represent stale as an explicit scheduler result and emit a bounded terminal `state`/stale status that restores the last successful projection. Add a delayed fake completion test that changes leaf without another settled event.
- **Confidence:** 99/100.

#### RSSA-06 — Medium — An explicit rename to the same generated text is not protected

- **Affected file/symbol:** `lib/session-summary-core.mjs:207-215`, `shouldApplySummaryTitle()`; no `session_info_changed` tracking in `session-summary.ts`.
- **Violated requirement / failure mode:** Success criterion 13 and the non-goal require explicit/manual names always to win. Provenance is inferred only by comparing the current string with the previously generated string. If the user explicitly runs `/name Generated title` while that exact generated title is current, a later candidate after cadence is treated as eligible and overwrites the explicit choice.
- **Reasoning / reproduction:** Calling `shouldApplySummaryTitle()` with prior generated title `Generated title`, current name `Generated title`, a different candidate, and ordinal delta 3 returned `true`. Installed Pi emits `session_info_changed` for `/name`, RPC, and `pi.setSessionName()` (`docs/extensions.md:405-412`), but the extension does not track it or suppress its own generated rename event.
- **Minimal remediation:** Track explicit-name provenance via `session_info_changed` with a narrowly scoped self-rename guard, persist enough branch-local provenance for reloads, and test same-text explicit rename plus clear/restore cases.
- **Confidence:** 95/100.

#### RSSA-07 — Medium — “Strict” output parsing has no total response bound and accepts unknown fields

- **Affected file/symbol:** `lib/session-summary-core.mjs:106-123`, `parseSummaryOutput()`; `session-summary.ts:214-217`.
- **Violated requirement / failure mode:** Plan D9/E13 and the strict structured-result contract require fixed output bounds and `{version,title,summaryMarkdown}` validation. The parser bounds only `summaryMarkdown` after parsing; it accepts arbitrary additional fields of unlimited size and the request sets no explicit output-token cap.
- **Reasoning / reproduction:** An inline harness passed a 100,052-character JSON response containing a 100,000-character unknown field and `summaryMarkdown:"ok"`; parsing succeeded. This permits avoidable response accumulation/JSON parsing and does not enforce the declared exact schema even though unrecognized data is later dropped.
- **Minimal remediation:** Reject raw output above a fixed total character bound before `JSON.parse`, require only the allowed keys/types, and set a conservative provider output cap where the adapter supports it. Add oversized-unknown-field and unknown-key tests.
- **Confidence:** 97/100.

#### RSSA-08 — Low — TUI display uses a contextual custom message instead of the installed non-contextual entry API

- **Affected file/symbol:** `session-summary.ts:59-67,264-269`, `displaySummary()` and renderer registration.
- **Violated requirement / failure mode:** Plan E11 and TUI validation call for a non-contextual display entry. Installed Pi documentation states `sendMessage()`/`registerMessageRenderer()` messages participate in LLM context and directs durable TUI-only content to `appendEntry()`/`registerEntryRenderer()` (`docs/extensions.md:1388-1391,1439-1445,1561-1567`).
- **Reasoning / reproduction:** The extension mitigates normal provider exposure through its context filter, so no direct leak was reproduced. Nevertheless each manual display is persisted as a context-capable custom message and depends on the filter remaining effective, rather than using Pi's purpose-built non-contextual API.
- **Minimal remediation:** Render a bounded display custom entry via `pi.appendEntry()` and `pi.registerEntryRenderer()`, keeping the canonical summary state separate if desired; update WebUI filtering/tests for entry transport as needed.
- **Confidence:** 99/100.

### Required-angle disposition

- **Correctness:** Findings RSSA-01, RSSA-02, RSSA-05, RSSA-07.
- **Lifecycle/concurrency:** RSSA-01 and RSSA-05. No additional finding for non-blocking `agent_settled`, shutdown abort, or pre-append source revalidation.
- **Persistence/branch semantics:** RSSA-04 and RSSA-08. No finding for append-only successful canonical state or malformed-config preservation.
- **Privacy/security:** No direct transcript/credential leakage finding. Serializer scope, prompt separation, context filtering, response projection, and Markdown sanitization paths were verified. RSSA-02/RSSA-07 remain provider-boundary hardening issues.
- **Auth/CSRF:** RSSA-03 concerns provider auth compatibility. No finding in HTTP authentication/CSRF ordering: remote auth precedes routes, JSON/body/cross-site guards are present, and focused HTTP cases passed.
- **Provider-call boundaries:** RSSA-02 and RSSA-03. No real provider call was made.
- **Stale-session behavior:** RSSA-04 and RSSA-05. Cross-session append/title mutation revalidation itself had no additional finding.
- **Context off/latest-only:** No finding; default off and exactly-one active-branch injection logic passed focused tests.
- **Strict parser/input/output bounds:** RSSA-07. Transcript, prompt, title, rendered summary, failure, request-body, and RPC field bounds otherwise had no finding.
- **Scheduler coalescing/cooldown/abort:** RSSA-01. Shutdown abort and ordinary one-flight/newest coalescing tests passed.
- **RPC message transport:** RSSA-04/RSSA-05 affect projection freshness. The allowlisted version/bounds, message start/end suppression, SSE projection, and tab/session-ID reset logic had no additional finding.
- **Explicit/manual title protection:** RSSA-06. Browser `titleSource === "explicit"` protection itself had no finding.
- **Unrelated optional-feature migration preservation:** No finding; both dedicated migration tests and the full suite passed on the combined dirty tree.

### Commands run and outcomes

- `git status --short; git diff --stat; git diff --cached --stat` — passed; combined dirty tree inspected and no staged files found.
- `git diff --check` and syntax checks for `public/app.js`, `bin/pi-webui.mjs`, and `session-summary.ts` — passed.
- `node tests/session-summary-preferences.test.mjs && node tests/session-summary-core.test.mjs && node tests/http-endpoints-harness.test.mjs` — passed.
- `node tests/optional-feature-migration.test.mjs && node tests/optional-feature-migration-frontend.test.mjs && node tests/native-parity.test.mjs && node tests/native-parity-harness.test.mjs && node tests/mobile-static.test.mjs` — passed.
- `npm test` — passed; all 111 test files passed.
- Inline scheduler failure/coalescing harness — passed as a diagnostic and reproduced RSSA-01 (`inFlight:true` after cooldown; manual returned `cooldown`; one call only).
- Inline strict-parser harness — passed as a diagnostic and reproduced RSSA-07 (100,052-character response accepted).
- Inline explicit-title harness — passed as a diagnostic and reproduced RSSA-06 (`shouldApplySummaryTitle(...) === true`).
- Installed Pi docs/types/source inspection — confirmed lifecycle, non-contextual entry API, optional auth fields, `session_tree`, and provider-specific request option shapes.

### Omissions and residual risks

- `npm run check` was not rerun independently; equivalent changed-file syntax checks and the complete `npm test` suite passed. Parent evidence reports `npm run check` passed.
- Chromium was not rerun in this correctness-focused review. Parent evidence reports it passed; the browser spec uses mocked HTTP success rather than a live custom-message success/title event.
- No real provider call was made, intentionally. RSSA-02 is based on installed adapter types/source rather than network behavior.
- No live Pi fixture emitted W1 success/title RPC messages, so event transport remains covered by source inspection, static assertions, and sanitized SSE replay tests rather than a live end-to-end event.
- The worktree combines session-summary and unrelated optional-feature migration changes. Functional preservation is supported by dedicated and full-suite tests, but this review did not reconstruct the unavailable pre-worker patch byte-for-byte.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Eight concrete findings (3 high, 4 medium, 1 low) cite exact source symbols/lines, violated plan requirements, reproductions, minimal remediation, and confidence; residual risks and no-finding angles are explicitly recorded."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "node tests/session-summary-preferences.test.mjs && node tests/session-summary-core.test.mjs && node tests/http-endpoints-harness.test.mjs",
      "result": "passed",
      "summary": "Focused persistence, lifecycle/core, HTTP/auth/body/SSE contracts passed."
    },
    {
      "command": "node tests/optional-feature-migration.test.mjs && node tests/optional-feature-migration-frontend.test.mjs && node tests/native-parity.test.mjs && node tests/native-parity-harness.test.mjs && node tests/mobile-static.test.mjs",
      "result": "passed",
      "summary": "Unrelated migration preservation plus parity/static integration checks passed."
    },
    {
      "command": "node --check public/app.js && node --check bin/pi-webui.mjs && node --experimental-transform-types --check session-summary.ts && git diff --check",
      "result": "passed",
      "summary": "Changed implementation syntax and diff whitespace checks passed."
    },
    {
      "command": "npm test",
      "result": "passed",
      "summary": "All 111 package test files passed."
    },
    {
      "command": "inline createSummaryScheduler failure + pending + manual diagnostic",
      "result": "passed",
      "summary": "Reproduced permanent inFlight cooldown wedge and failed manual bypass."
    },
    {
      "command": "inline parseSummaryOutput oversized unknown-field diagnostic",
      "result": "passed",
      "summary": "Reproduced acceptance of a 100,052-character raw response with a 100,000-character unknown field."
    },
    {
      "command": "inline same-text explicit-title diagnostic",
      "result": "passed",
      "summary": "Reproduced eligibility to overwrite a same-text explicit rename after cadence."
    },
    {
      "command": "npm run check",
      "result": "not-run",
      "summary": "Not independently rerun; full npm test and changed-file syntax checks passed, and parent evidence reports check green."
    },
    {
      "command": "npm run test:browser -- --grep session-summary",
      "result": "not-run",
      "summary": "Not rerun in correctness review; parent reports Chromium green."
    }
  ],
  "validationOutput": [
    "npm test: all 111 test files passed",
    "focused core/preferences/HTTP checks passed",
    "optional-feature migration preservation tests passed",
    "scheduler diagnostic: inFlight remained true and manual returned cooldown after coalesced failure",
    "strict parser diagnostic: oversized unknown output field accepted",
    "explicit-title diagnostic: same-text manual intent was not distinguishable/protected",
    "no real provider calls and no staged files"
  ],
  "residualRisks": [
    "Provider behavior was verified from installed adapter contracts/source, not live network calls.",
    "Live W1 success/title custom-message transport was not produced by an end-to-end Pi fixture.",
    "Chromium and npm run check were not independently rerun in this review; parent evidence reports both passed.",
    "Combined dirty-tree preservation was functionally tested but not byte-for-byte reconstructed against a saved pre-worker patch."
  ],
  "noStagedFiles": true,
  "diffSummary": "Review-only: inspected the integrated session-summary core, private preferences, WebUI/RPC/API/UI integration, tests, installed Pi contracts, and combined optional-feature migration tree; no implementation files were modified.",
  "reviewFindings": [
    "high: lib/session-summary-core.mjs:255-289 - failure with pending automatic work can permanently wedge inFlight and defeat manual cooldown bypass.",
    "high: session-summary.ts:187-212 - provider-independent setup feeds OpenAI-specific reasoning/store mutations to all provider APIs.",
    "medium: session-summary.ts:179-184 - valid env/header-only auth is rejected because apiKey is incorrectly mandatory.",
    "high: session-summary.ts:294-307 and public/app.js:35557-35576 - WebUI projection is not refreshed on session_tree branch navigation.",
    "medium: session-summary.ts:175,218 - stale generation emits no terminal RPC event and can leave WebUI generating indefinitely.",
    "medium: lib/session-summary-core.mjs:207-215 - explicit same-text rename can later be overwritten.",
    "medium: lib/session-summary-core.mjs:106-123 - parser has no total raw-output bound and accepts arbitrary unknown fields.",
    "low: session-summary.ts:59-67,264-269 - TUI display uses context-capable custom messages instead of Pi non-contextual entries.",
    "no blockers found"
  ],
  "manualNotes": "Reviewer verdict: material correctness fixes are warranted, but acceptance/completion is left to the parent. Overall confidence: 95/100."
}
```
