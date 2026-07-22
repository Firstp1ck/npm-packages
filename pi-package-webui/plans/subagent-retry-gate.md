# Generic subagent retry gate

## Objective and success criteria

Add a generic, opt-in `subagent_gate` tool to the existing WebUI package. The tool must launch subagents through pi-subagents RPC v1, count successful qualifying outputs rather than launch attempts, classify failures, retry only when safe, and expose attempt/gate state to the WebUI.

Success means:

- one or more generic tasks can be submitted with a required-success quorum;
- initial launches and replacements use pi-subagents RPC v1 `spawn` rather than direct child processes;
- failed read-only tasks receive bounded, reason-aware fresh retries;
- tasks that may write are retried only when the RPC launch failed before a child run existed; completed/started writer failures are returned to the parent for diagnosis;
- stopped/interrupted tasks are never retried automatically;
- every attempt has a distinct run identity and retained status, failure class, model/provider, and retry relationship;
- fallback model selection is bounded and gate-aware, including optional provider diversity;
- WebUI shows gate quorum plus individual attempts/retries and terminal states;
- focused and package checks pass without reverting unrelated dirty-worktree changes.

## Scope and non-goals

### In scope

- `APPEND_SUBAGENTS.md` general retry instructions.
- A generic `subagent_gate` tool inside `pi-package-webui`.
- RPC v1 request/reply transport, lifecycle completion handling, bounded retries, cancellation, and structured results.
- WebUI bridge/server/browser attempt and gate visualization.
- Read-only builtin-agent fallback model overrides in Pi settings.
- Tests, documentation, plan, review evidence, and HTML report.

### Non-goals

- Patching installed `pi-subagents` files.
- Automatically rerunning a task after it may have mutated files or external systems.
- Guessing whether an arbitrary task is read-only; callers must declare retry safety, with `may-write` as the safe default.
- Hiding exhausted or non-retryable failures.
- Replacing pi-subagents lifecycle/status storage.
- Refactoring unrelated in-progress WebUI or dotfiles changes.

## Approved decisions and assumptions

- Retry safety follows the recommended policy: pre-launch failures may be retried generally; post-launch automatic retries require `retrySafety: "read-only"`. `may-write` is the default.
- Stopped and interrupted attempts never retry automatically.
- The wrapper is added to the existing `pi-package-webui` extension; no separate extension/package is introduced.
- The public tool is named `subagent_gate` and accepts generic task slots, quorum, retry, timeout, and provider-diversity controls.
- Default retry budget is two total attempts per task slot (one retry), bounded further by the gate deadline and available fallback models.
- Fallback models are configured only for read-only builtin roles: `reviewer`, `scout`, `planner`, `context-builder`, `researcher`, and `oracle`.
- Fallback order is Anthropic Opus 4.8, Kimi K3, then OpenAI Sol; explicit task models remain primary and the gate can reject duplicate providers when diversity is required.
- Existing uncommitted changes are user-owned. All edits must be narrow and preserve them.

## Architecture and interfaces

1. `lib/subagent-gate.mjs` owns the RPC v1 client, attempt state machine, failure classifier, model/provider selection, cancellation, quorum evaluation, and `subagent_gate` tool registration.
2. `index.ts` registers the gate with the existing WebUI extension and forwards package-local gate lifecycle events.
3. The gate uses `subagents:rpc:v1:spawn` for every attempt and correlates completion through pi-subagents lifecycle events. RPC launch failures are classified before retry.
4. Gate updates use a package-local versioned event and contain bounded, sanitized gate/attempt summaries.
5. `webui-rpc-helper.mjs` tracks gate events alongside ordinary subagent lifecycle status and publishes additive `gates` data in `PI_WEBUI_SUBAGENTS_V1`.
6. `bin/pi-webui.mjs` normalizes gate and attempt payloads before `/api/subagents` responses.
7. `public/app.js`, `public/index.html`, and `public/styles.css` render quorum and attempts without changing existing running-child behavior.
8. `.pi/agent/settings.json` supplies builtin read-only fallback model lists; `.pi/agent/APPEND_SUBAGENTS.md` documents the general retry algorithm and safety boundary.

### Tool contract

`subagent_gate` accepts:

- `tasks[]`: `agent`, `task`, optional `model`, `fallbackModels`, `context`, `cwd`, `skill`, `output`, `outputMode`, `acceptance`, `phase`, `label`, and `retrySafety` (`may-write` default or `read-only`);
- `requiredSuccesses` (defaults to task count);
- `maxAttemptsPerTask` (defaults to 2, bounded);
- `requireDistinctProviders` (defaults false);
- `excludedProviders`;
- `attemptTimeoutMs`, `gateTimeoutMs`, and optional concurrency.

The result includes gate status, qualifying count, attempts, successful outputs, exhausted slots, and residual failures. A gate that misses quorum returns an error result rather than silently degrading.

## Work items

1. [x] **Plan and baseline** — owner: integration owner; files: plan and targeted diffs; dependency: approved decisions.
2. [x] **Prompt/settings policy** — owner: integration owner; files: `.pi/agent/APPEND_SUBAGENTS.md`, `.pi/agent/settings.json`; dependency: none.
3. [x] **Gate runtime** — owner: integration owner; files: `index.ts`, new `lib/subagent-gate.mjs`, package metadata/tests; dependency: RPC v1 contract.
4. [x] **Bridge/server visualization data** — owner: integration owner; files: `webui-rpc-helper.mjs`, `bin/pi-webui.mjs`, fixtures/tests; dependency: gate event contract.
5. [x] **Browser visualization** — owner: integration owner; files: `public/app.js`, `public/index.html`, `public/styles.css`, static tests; dependency: normalized payload.
6. [x] **Verification and independent review** — two fresh, read-only, cross-provider reviewers; dependency: implementation and tests.
7. [x] **Report** — `reports/subagent-retry-gate.html`; strict validation passed after final review dispositions and accepted fixes.

Merge order: policy → runtime → bridge/server → browser → tests/docs → accepted review fixes → report. One writer owns the active worktree.

## Acceptance tests

- Unit tests cover RPC correlation, successful quorum, transient read-only retry, writer no-retry after launch, pre-launch retry, stopped/interrupted no-retry, retry exhaustion, fallback selection, provider diversity, cancellation, and bounded attempt records.
- Helper tests prove gate updates appear in the internal WebUI status payload.
- HTTP/static tests prove normalized gate payloads and browser rendering hooks.
- `node --check` passes for changed JavaScript/MJS files.
- `node tests/subagent-gate.test.mjs` passes.
- `node tests/subagents-helper.test.mjs` passes.
- relevant HTTP/static tests pass.
- `git diff --check` passes for changed files.
- `npm test` and `npm run check` pass, or unrelated pre-existing failures are recorded with evidence.
- Strict HTML report validation passes.

## Risks

- RPC v1 completion can race a fast child; the gate must subscribe before spawning and keep a bounded completion cache.
- A provider-looking failure may occur after tools ran. `may-write` tasks therefore never receive post-launch automatic retries.
- Agent-level fallbackModels can rerun an attempt internally. They are limited to read-only builtin roles.
- Provider IDs may include nested model paths; provider extraction must use the leading provider segment only.
- Gate events and browser payloads must be bounded to avoid status-channel growth.
- Existing WebUI files contain unrelated uncommitted work; broad rewrites are prohibited.

## Review status

The mandatory review gate is satisfied by two separate fresh-context, read-only reviewer runs from provider families distinct from the OpenAI implementation model and from each other:

| Run | Effective model | Provider family | Result | Evidence |
|---|---|---|---|---|
| `150df49e-30e5-4d24-9b15-6f9ec0420f9b`, child 2 | `openrouter/moonshotai/kimi-k3:high` | Moonshot/Kimi via OpenRouter | Qualifying; completed | `.pi-subagents/artifacts/outputs/150df49e-30e5-4d24-9b15-6f9ec0420f9b/reviews/subagent-retry-gate-kimi.md` |
| `680653e8-f00e-4bef-92a5-6f36e81bcd5a` | `cursor-composer/composer-2.5:high` | Cursor Composer | Qualifying; completed | `.pi-subagents/artifacts/outputs/680653e8-f00e-4bef-92a5-6f36e81bcd5a/reviews/subagent-retry-gate-cursor.md` |

Two attempted Anthropic reviews (`150df49e…`, child 1, Opus 4.8; `d18040f5…`, Fable 5) were rejected as qualifying evidence because Anthropic returned HTTP 429 and both runs eventually failed their turn budgets after fallback. Their partial observations were treated only as advisory corroboration and were not counted toward the gate.

### Finding dispositions

| Source / finding | Disposition | Evidence and action |
|---|---|---|
| Kimi M1: cancellation during an in-flight spawn can lose a late run ID and orphan a child | **accepted** | RPC spawn now preserves its correlated reply after gate abort, records the returned run ID, marks the attempt terminal, and sends `stop`; a delayed-reply cancellation test proves one launch and one stop. |
| Kimi M2 / Cursor 1: cancelled attempts remain `running` | **accepted** | Attempts now become `cancelled` with `endedAt` and `cancelled` or `timeout` failure kind; helper/server/browser accept and render the terminal status. |
| Kimi M3 / Cursor 3: advertised `phase` was rejected | **accepted** | `phase` is accepted, retained, bounded, and visualized. It is intentionally not forwarded because pi-subagents RPC v1 `SubagentParams` does not accept a top-level phase field. |
| Kimi M4: no separate default attempt watchdog | **rejected** | `attemptTimeoutMs` is intentionally optional and is forwarded to pi-subagents; every gate already has a 30-minute default deadline. A second implicit timeout would create conflicting timeout ownership. The explicit attempt timeout now has the same two-hour schema ceiling as the gate. |
| Kimi partial: declared providers can be exhausted and fall back to an implicit default | **accepted** | Candidate selection now returns a terminal `provider-exhausted` failure instead of spawning an unknown/default model; excluded candidates are filtered before launch and tested. |
| Kimi N1: event-listener exceptions could leave a running snapshot | **deferred** | Pi's event bus is the extension transport boundary and current emit sites follow package convention. No reproduction was shown; broad event swallowing would hide infrastructure faults. |
| Kimi N2: excluded providers consume attempts | **accepted** | Known model candidates from excluded providers are prefiltered and no child is launched when none qualify. |
| Kimi N3/N5/N6: classifier/output micro-refactors | **rejected** | Correct behavior; preference-only cleanup not needed for the approved scope. |
| Kimi N4: package-wide static failure | **deferred / unrelated** | `mobile-static.test.mjs:1756` asserts optional companion dependencies are absent from the lock root, but the dirty baseline already contains `@firstpick/pi-extension-bang-command-autocomplete` there. The feature lockfile diff only adds `typebox`. |
| Kimi N7: terminal gates retained | **rejected** | Retention is an explicit observability requirement; storage is bounded to 32 gates and 100 attempts per gate. |
| Cursor 2: acceptance-test gaps | **accepted** | Added explicit interrupted, exhausted-budget, excluded-provider, gate-timeout, spawn-abort, missing-run-ID, cancellation-status, and early-quorum tests. |
| Cursor 4: no early quorum short-circuit | **accepted** | Queued slots now skip before launch after quorum is met; returned details identify skipped slots. Already-running initial attempts are not force-stopped. |
| Cursor 5: spawn success without run ID may duplicate a writer | **accepted** | Missing run ID is now `protocol-ambiguous`; `may-write` slots never retry it. A focused test verifies a single launch. |
| Cursor 6: fallback settings are not injected by the gate | **rejected** | Separation is intentional: agent overrides remain owned by pi-subagents, while explicit per-gate candidates remain caller-controlled. |

## Verification log

- `node --check` passed for `lib/subagent-gate.mjs`, `webui-rpc-helper.mjs`, `bin/pi-webui.mjs`, and `public/app.js`.
- `node tests/subagent-gate.test.mjs` passed after accepted fixes.
- `node tests/subagents-helper.test.mjs` passed.
- `node tests/http-endpoints-harness.test.mjs` passed.
- `git diff --check -- .` passed in `pi-package-webui`; targeted dotfiles diff check also passed.
- `settings.json` parsed and all six read-only roles were programmatically verified to use Anthropic Opus 4.8 → Kimi K3 → OpenAI Sol.
- `npm pack --dry-run --json` succeeded and includes `lib/subagent-gate.mjs`.
- `npm test` and `npm run check` each ran all 30 test files: 29 passed and only `mobile-static.test.mjs` failed at line 1756 on the unrelated dirty-baseline optional-companion lockfile invariant described above. All retry-gate static assertions execute before that failure and passed.
- Residual limitation: the RPC state machine is contract-checked against installed pi-subagents and tested with a faithful in-memory RPC/event bus, but no test launches a paid/live provider child through the real bridge.

## Report

Completed and cross-linked: [`../reports/subagent-retry-gate.html`](../reports/subagent-retry-gate.html). Strict `html-report` validation passed with no errors or warnings.
