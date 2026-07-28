# Pi Computer-Use Extension — Implementation Plan

- **Status:** Proposed; design decisions pending
- **Feature slug:** `pi-computer-use`
- **Proposed package:** `pi-extension-computer-use/`
- **Plan owner / integration owner:** Primary implementation agent
- **Last updated:** 2026-07-20
- **Implementation report:** [`../reports/pi-computer-use.html`](../../reports/pi-computer-use.html) *(to be created and maintained during implementation)*

## 1. Objective

Create an opt-in Pi extension that gives a vision-capable model a bounded **observe → reason → act → observe** loop for browser automation, with deterministic safety controls that do not rely on the model behaving correctly.

The initial release should provide reliable browser control through an isolated Playwright session. Full desktop control, including Hyprland support, remains an explicitly experimental follow-up until the browser protocol and safety model are proven.

## 2. Success criteria

The feature is successful when all of the following are true:

1. A user can explicitly start and stop a computer-use session from Pi.
2. A vision-capable model can observe a browser screenshot and perform bounded navigation, pointer, keyboard, scrolling, and waiting actions.
3. Every mutating action is validated against the latest observation using a frame identifier.
4. Deterministic policy code blocks or requests confirmation for consequential actions, regardless of model instructions or page content.
5. Mutating actions fail closed when interactive confirmation is unavailable.
6. Browser processes, profiles, event handlers, timers, and temporary files are cleaned up on stop, abort, reload, session replacement, and shutdown.
7. Unit, integration, safety, and package-level acceptance tests pass.
8. An independent cross-provider reviewer finds no unresolved critical or high-severity issues.
9. The plan and final HTML report contain current implementation, test, review, and residual-risk evidence.

## 3. Scope

### 3.1 MVP scope

- New publishable package: `@firstpick/pi-extension-computer-use`.
- One model-callable `computer_use` tool with a compact action protocol.
- Commands for setup, start, stop, and status.
- Playwright-based browser backend using an isolated profile.
- Screenshot observations returned as Pi image tool content.
- Optional compact semantic metadata for visible interactive elements.
- Frame IDs and stale-frame rejection.
- Domain/app policy, action classification, confirmation gates, time/action limits, and emergency stop.
- TUI/RPC-compatible status and confirmation UI using Pi APIs.
- Fail-closed behavior in print/JSON modes.
- Session-scoped state and deterministic cleanup.
- Documentation, tests, package metadata, and publish-readiness checks.

### 3.2 Deferred scope

- Experimental Hyprland desktop backend:
  - capture through HyprCapture, `grim`, or a PipeWire/portal adapter;
  - pointer/keyboard input through an explicitly selected backend such as `ydotool`, `wtype`, or `wlrctl`;
  - monitor layout and scale mapping through `hyprctl`;
  - compositor permission handling without silently modifying user configuration.
- Accessibility-tree integration through AT-SPI.
- Other operating systems or compositors.
- Provider-native special computer-use protocol serialization.
- Remote-host computer use.

### 3.3 Non-goals

- Unattended general-purpose desktop control.
- Circumventing compositor, portal, browser, or operating-system permissions.
- Automatic password, passkey, payment-card, recovery-code, or MFA entry.
- CAPTCHA bypass.
- Covert screenshots, hidden input injection, or background surveillance.
- Autonomous purchases, financial transactions, account changes, destructive actions, or external communications without explicit confirmation.
- Reusing the user's everyday browser profile by default.
- Claiming exact behavioral parity with the ChatGPT or Codex app.

## 4. Repository evidence and constraints

- The repository is a monorepo of publishable `pi-extension-*` packages.
- Package manifests are expected to remain minimal, expose valid `pi.extensions` entries, include accurate README documentation, and avoid committed secrets.
- Existing extensions use `index.ts`, optional `src/`, `tests/`, `README.md`, `LICENSE`, and package-level `npm test` scripts.
- Pi extensions can register tools, commands, lifecycle hooks, confirmation UI, status widgets, custom renderers, and image-bearing tool results.
- Extension factories must not start long-lived resources; browser/input resources start only on command or tool demand and are closed from idempotent shutdown handling.
- Pi custom tools execute concurrently by default, so computer actions require an extension-owned serial action queue.
- Tool output must remain context-bounded; image dimensions and semantic metadata require explicit limits.
- On Hyprland, screen capture and input control are separate concerns. The local portal backend supports capture-related interfaces but is not a reliable Remote Desktop input backend; desktop input therefore requires a separate, explicitly configured adapter.

Relevant references:

- `CONTRIBUTING.md`
- `pi-package-webui/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `pi-package-webui/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
- `/usr/share/doc/arch-wiki/html/en/Wayland.html` — Automation
- `/usr/share/doc/arch-wiki/html/en/XDG_Desktop_Portal.html` — backend interfaces
- `~/.hyprwiki/content/Configuring/Advanced and Cool/Permissions.md`

## 5. Proposed decisions and assumptions

These are recommended defaults, not yet user-approved decisions.

| Decision | Recommended default | Rationale | Status |
|---|---|---|---|
| First release | Browser-only MVP | Smaller attack surface and more reliable coordinates/semantics | Pending approval |
| Browser integration | `playwright-core` with explicit executable discovery/setup | Avoid implicit large browser downloads and global installation | Pending spike |
| Browser profile | Fresh isolated ephemeral profile | Prevent accidental access to personal cookies, sessions, and extensions | Pending approval |
| Tool surface | One `computer_use` tool with an `action` enum | Compact schema and close fit to computer-use loops | Proposed |
| Tool enum schema | `StringEnum` plus action-specific runtime validation | Compatible with Google-family providers and strict per-action checks | Proposed |
| Observation model | Screenshot plus bounded visible-element metadata | Pixel compatibility with improved reliability where DOM data exists | Proposed |
| Action ordering | One serial queue per active session | Prevent concurrent clicks/typing and state races | Proposed |
| Stale-action defense | Require latest `frame_id` for coordinate/element actions | Reject decisions based on obsolete screenshots | Proposed |
| Confirmation policy | Deterministic categories; fail closed when UI is unavailable | Safety cannot depend on prompt compliance | Proposed |
| Secret handling | Never accept or synthesize secrets; user enters them manually outside the tool | Tool inputs and results may persist in session history | Proposed |
| Downloads/uploads | Blocked by default in MVP | High exfiltration and filesystem risk | Pending approval |
| Headless mode | Unsupported in MVP | No safe confirmation channel | Proposed |
| Desktop backend | Separate experimental milestone after MVP | Hyprland capture/input permissions and coordinate mapping add substantial risk | Proposed |
| Telemetry | None | Avoid collecting browsing and screenshot metadata | Proposed |

### 5.1 Blocking decisions before implementation

1. Approve browser-only MVP versus including desktop control in the first release. **Recommendation: browser-only.**
2. Choose ephemeral-only profiles versus an optional dedicated persistent profile. **Recommendation: ephemeral-only for v1.**
3. Approve the default upload/download policy. **Recommendation: block both; add narrowly scoped opt-ins later.**
4. Decide whether navigation to a new domain requires confirmation or only an allowlist match. **Recommendation: allowlisted domains proceed; every new domain requires confirmation.**
5. Confirm package naming: `pi-extension-computer-use` / `@firstpick/pi-extension-computer-use`.

Implementation must not begin while these decisions remain blocking.

## 6. Threat model and safety invariants

### 6.1 Primary threats

- Prompt injection embedded in web pages instructing the model to disclose data or perform consequential actions.
- Screenshots exposing notifications, personal data, tokens, account information, or unrelated applications.
- Model-generated clicks using stale screenshots or incorrect monitor/viewport coordinates.
- Typing into the wrong focused element.
- Navigation to phishing or untrusted domains.
- Uploading local files or downloading malicious content.
- Access to authenticated browser sessions through a reused profile.
- Infinite action loops, excessive screenshots, resource exhaustion, or abandoned browser processes.
- Shell injection through executable paths, URLs, filenames, or backend arguments.
- Privilege expansion through `/dev/uinput`, compositor permissions, portal grants, or helper daemons.
- Sensitive tool arguments and screenshots persisting in Pi session history.

### 6.2 Non-negotiable invariants

1. Computer use is disabled until the user explicitly starts it.
2. Starting a session presents the active backend, profile mode, allowed domains, limits, and major privacy implications.
3. The model cannot disable, weaken, or edit policy through the `computer_use` tool.
4. Policy decisions are based on normalized structured action data, current browser state, and deterministic rules.
5. Page text, DOM attributes, accessibility labels, and screenshots are always untrusted input.
6. Passwords, MFA codes, passkeys, recovery codes, payment-card data, and secret tokens are never accepted by automated typing actions.
7. Consequential actions require a fresh explicit user confirmation immediately before execution.
8. `ctx.hasUI === false` blocks all mutating actions; v1 does not provide a headless override.
9. Coordinate/element actions must reference the most recent frame and target state.
10. Only one action executes at a time.
11. Action count, wall-clock duration, screenshot dimensions, returned metadata, navigation redirects, and wait duration are bounded.
12. Process execution uses argument arrays rather than shell interpolation.
13. Stop, abort, reload, replacement-session shutdown, and process exit invoke the same idempotent cleanup path.
14. No hidden telemetry or screenshot upload exists beyond normal transmission to the selected model provider.

### 6.3 Consequential-action categories

At minimum, the policy engine must classify and gate:

- external communication: send, submit, post, publish, invite;
- financial: buy, subscribe, bid, donate, transfer;
- identity/account: sign in, sign out, create/delete account, change email/password/security settings;
- destructive: delete, remove, cancel, revoke, overwrite;
- privacy: grant camera/microphone/location/clipboard/screen permissions;
- filesystem: upload, download, choose local file, open external application;
- legal or high-impact consent: accepting agreements, waivers, or employment/financial/medical submissions;
- secrets and authentication fields;
- navigation to a domain outside the active allowlist.

## 7. Architecture

```text
Pi extension entrypoint
├── commands and lifecycle
├── computer_use tool
├── session state machine
├── serial action executor
├── policy engine
│   ├── action classifier
│   ├── domain policy
│   ├── confirmation gate
│   └── limits / emergency stop
├── backend interface
│   ├── Playwright browser backend (MVP)
│   └── Hyprland desktop backend (deferred experimental)
├── observation pipeline
│   ├── screenshot capture and normalization
│   ├── frame ID generation
│   ├── viewport/coordinate metadata
│   └── bounded semantic element map
└── Pi presentation adapter
    ├── tool result image/text
    ├── status/widget
    ├── confirmations
    └── audit entries
```

### 7.1 Proposed package layout

```text
pi-extension-computer-use/
├── index.ts
├── package.json
├── README.md
├── LICENSE
├── src/
│   ├── action-schema.ts
│   ├── action-queue.ts
│   ├── config.ts
│   ├── extension.ts
│   ├── observation.ts
│   ├── policy.ts
│   ├── session.ts
│   ├── tool.ts
│   ├── types.ts
│   ├── ui.ts
│   └── backends/
│       ├── backend.ts
│       ├── playwright.ts
│       └── hyprland.ts          # deferred/experimental
└── tests/
    ├── action-schema.test.mjs
    ├── config.test.mjs
    ├── lifecycle.test.mjs
    ├── observation.test.mjs
    ├── policy.test.mjs
    ├── tool-static.test.mjs
    └── playwright.integration.test.mjs
```

### 7.2 Core interfaces

```ts
type ComputerSessionStatus =
  | "stopped"
  | "starting"
  | "active"
  | "awaiting_confirmation"
  | "failed"
  | "stopping";

interface ComputerBackend {
  readonly kind: "browser" | "desktop";
  readonly capabilities: ReadonlySet<ComputerCapability>;
  start(config: BackendConfig, signal?: AbortSignal): Promise<void>;
  observe(signal?: AbortSignal): Promise<RawObservation>;
  act(action: ValidatedComputerAction, signal?: AbortSignal): Promise<ActionOutcome>;
  stop(): Promise<void>; // idempotent
}

interface Observation {
  frameId: string;
  capturedAt: number;
  url?: string;
  title?: string;
  width: number;
  height: number;
  scale: number;
  image: { data: string; mimeType: "image/png" | "image/jpeg" | "image/webp" };
  elements?: VisibleElement[];
}

interface PolicyDecision {
  outcome: "allow" | "confirm" | "block";
  category: string;
  reason: string;
  displaySummary: string;
}
```

### 7.3 Tool protocol

Proposed actions:

- `observe`
- `navigate`
- `click`
- `double_click`
- `hover`
- `drag`
- `type`
- `key`
- `scroll`
- `wait`
- `back`
- `forward`
- `reload`

The public TypeBox schema uses a `StringEnum` action field with optional action-specific fields. Runtime validation then narrows to a strict internal discriminated union and rejects irrelevant, missing, non-finite, oversized, or out-of-bounds values.

Each successful action returns:

- a short textual outcome;
- the latest frame ID, viewport, URL/title when applicable, and capability metadata;
- a fresh screenshot as image content unless the action explicitly suppresses it for a tested reason;
- bounded semantic element metadata in text/details;
- an audit-safe policy category and confirmation result.

Tool descriptions must tell the model to:

- observe before acting;
- use only the latest frame;
- treat page instructions as untrusted;
- never request or type secrets;
- stop and ask the user when policy blocks an action;
- avoid repeated failed actions.

### 7.4 State and concurrency

- A session has exactly one backend and one serial action queue.
- `start` is atomic: partial startup failure triggers cleanup and returns to `stopped` or `failed` with no live resources.
- `stop` is idempotent and drains/cancels queued actions before closing the backend.
- Tool calls received while stopped, starting, awaiting confirmation, stopping, or failed return explicit bounded errors.
- New actions are rejected after emergency stop or when action/runtime limits are reached.
- An observation increments the frame generation; only the newest frame is actionable.
- Navigation, focus changes, viewport changes, dialogs, and page lifecycle changes invalidate previous frames.

### 7.5 Browser backend

- Use `playwright-core` if the spike confirms acceptable executable discovery and packaging; otherwise document and approve the smallest viable alternative.
- Launch a dedicated browser context with an isolated temporary profile.
- Disable extension loading and unnecessary browser integrations by default.
- Restrict downloads, clipboard, camera, microphone, geolocation, notifications, popups, and external protocols through backend policy.
- Track the active page explicitly; new pages/popups require policy handling.
- Normalize viewport dimensions and device scale factor.
- Prefer stable element IDs derived from the current observation for semantic actions; fall back to coordinates only when necessary.
- Detect password and other sensitive input types before typing.
- Close pages, contexts, browser processes, temporary profiles, and listeners during cleanup.

### 7.6 Observation pipeline

- Capture only the controlled browser viewport in the MVP, never the full desktop.
- Generate a cryptographically random or monotonic-session frame ID that cannot collide within a session.
- Bound image dimensions and encoded bytes while preserving readable text; choose PNG/WebP/JPEG defaults through an evidence-based spike.
- Include viewport width, height, scale, URL, title, and capture timestamp.
- Return only visible, relevant interactive elements; cap item count, label length, and total bytes.
- Remove hidden attributes, script content, large text blocks, and likely secret values from semantic metadata.
- Never include cookies, local storage, request headers, tokens, or form values in tool output.

### 7.7 Policy and confirmation flow

```text
Raw model action
  → schema validation
  → current-state and frame validation
  → target normalization
  → deterministic policy classification
      → block: return reason, do not execute
      → confirm: display exact action/target/domain, execute only on approval
      → allow: execute
  → invalidate old frame
  → capture fresh observation
  → return bounded result
```

Confirmation prompts must show the exact normalized action, target element/coordinates, active domain, policy category, and consequence. Approval applies to one action only in v1; no broad “always allow” for consequential categories.

### 7.8 Configuration

Proposed global configuration path:

```text
~/.pi/agent/computer-use.json
```

Configuration should include only non-secret policy and backend settings:

- enabled backend(s);
- browser executable path;
- default domain allowlist;
- maximum session duration and action count;
- screenshot size/format limits;
- confirmation-category toggles where weakening is safe;
- optional dedicated profile mode if approved later.

Invalid configuration fails safe. The extension must never persist credentials, cookies, page content, screenshots, or confirmation secrets in this file.

## 8. Workstreams, ownership, dependencies, and merge order

Only one writer may modify a shared worktree. If workstreams are parallelized, each writer must use an isolated git worktree and non-overlapping file ownership; the integration owner performs final merges and conflict resolution.

| ID | Workstream | Primary files/components | Dependencies | Ownership and parallelism | Merge order |
|---|---|---|---|---|---|
| W0 | Decision resolution and technical spikes | Plan updates; throwaway spike artifacts | None | Integration owner; no production implementation | 1 |
| W1 | Package skeleton, types, schema, config, state machine | `package.json`, `index.ts`, `src/types.ts`, `src/action-schema.ts`, `src/config.ts`, `src/session.ts` | W0 | Core writer | 2 |
| W2 | Policy engine and Pi UI | `src/policy.ts`, `src/ui.ts`, policy/config tests | Frozen W1 interfaces | May run in isolated worktree, separate from W3 | 3 |
| W3 | Playwright backend and observation pipeline | `src/backends/*`, `src/observation.ts`, backend/observation tests | Frozen W1 interfaces | May run in isolated worktree, separate from W2 | 4 |
| W4 | Tool, commands, lifecycle, and integration | `src/tool.ts`, `src/extension.ts`, `index.ts`, lifecycle/integration tests | W1–W3 | Integration owner only | 5 |
| W5 | Security hardening and acceptance tests | Tests, fixtures, dependency audit, failure-path fixes | W4 | Integration owner; read-only security review may run independently | 6 |
| W6 | Documentation, packaging, plan/report evidence | `README.md`, package metadata, this plan, HTML report | W5 | Integration owner | 7 |
| W7 | Independent cross-provider review and fixes | Read-only review output; affected files after disposition | W6 | Reviewer is read-only; integration/fix owner applies changes | 8 |
| W8 | Experimental Hyprland backend | `src/backends/hyprland.ts`, dedicated tests/docs | Stable and accepted browser MVP | Separate future milestone | Post-v1 |

## 9. Ordered implementation tasks

### W0 — Resolve decisions and run spikes

- [ ] Obtain approval for the blocking decisions in §5.1.
- [ ] Verify selected vision-capable models accept image-bearing custom tool results across intended providers.
- [ ] Spike `playwright-core` executable discovery, browser startup, screenshot capture, and cleanup without implicit global installation.
- [ ] Measure representative screenshot byte/token cost and select bounded dimensions/format.
- [ ] Verify Pi confirmation behavior in TUI and RPC modes; confirm fail-closed behavior in print/JSON modes.
- [ ] Update this plan with approved decisions and spike evidence.

### W1 — Build the bounded core

- [ ] Create the package skeleton and minimal manifest following repository conventions.
- [ ] Define backend, observation, action, policy, configuration, and state types.
- [ ] Define the Google-compatible public tool schema and strict per-action runtime validators.
- [ ] Implement finite coordinate, string, duration, action-count, and payload bounds.
- [ ] Implement the serial action queue, state transitions, frame generation, and stale-frame rejection.
- [ ] Implement safe configuration loading with fail-closed defaults and no secret persistence.

### W2 — Implement policy and user controls

- [ ] Implement deterministic action categories and the allow/confirm/block matrix.
- [ ] Normalize URLs, domains, targets, key combinations, and action summaries before policy evaluation.
- [ ] Implement one-action confirmation prompts and explicit denial reasons.
- [ ] Implement `/computer-use-setup`, `/computer-use start`, `/computer-use stop`, and `/computer-use status` UX.
- [ ] Add active-backend status, limits, and an emergency-stop shortcut.
- [ ] Ensure no-UI modes block mutation and provide actionable diagnostics.

### W3 — Implement browser observation and actions

- [ ] Implement isolated browser/context/profile startup and idempotent cleanup.
- [ ] Implement viewport screenshot capture, frame metadata, image normalization, and bounded element mapping.
- [ ] Implement navigation, pointer, keyboard, scroll, wait, and history actions.
- [ ] Invalidate frames on page/focus/viewport/dialog changes.
- [ ] Detect sensitive fields and block automated secret entry.
- [ ] Intercept popups, downloads, uploads, external protocols, permission requests, and unexpected page creation.

### W4 — Integrate with Pi

- [ ] Register the `computer_use` tool with precise description, prompt snippet, and named prompt guidelines.
- [ ] Return text plus image content in the provider-compatible Pi result shape.
- [ ] Add concise custom tool rendering without leaking sensitive details.
- [ ] Wire abort signals through queues, policy prompts, backend operations, and screenshot encoding.
- [ ] Start resources only on explicit command/tool demand.
- [ ] Route stop, abort, reload, session replacement, and shutdown through one idempotent cleanup function.
- [ ] Persist only minimal audit/state metadata needed for branch-safe reconstruction; avoid screenshot persistence where Pi/session semantics permit.

### W5 — Harden and verify

- [ ] Complete the unit, integration, safety, lifecycle, and package test matrix.
- [ ] Run a code-security review covering prompt injection, secret exposure, shell/process safety, profile isolation, dependencies, and cleanup.
- [ ] Test cancellation and failure injection at every startup/action/observation/cleanup phase.
- [ ] Test multiple simultaneous tool calls and prove serialization.
- [ ] Test redirect chains, popups, dialogs, focus changes, stale frames, and page crashes.
- [ ] Resolve all critical/high findings and document medium/low dispositions.

### W6 — Document and package

- [ ] Document installation, browser setup, commands, tool behavior, configuration, limitations, and safety model.
- [ ] Include explicit privacy warnings about screenshots and model-provider transmission.
- [ ] Document unsupported secrets, uploads/downloads, headless mode, and desktop control.
- [ ] Ensure `pi.extensions`, `files`, peer/runtime dependencies, scripts, README, and LICENSE are publish-ready.
- [ ] Update this plan with verification output and create/update the HTML implementation report.

### W7 — Independent review and finalization

- [ ] Run a fresh-context, read-only review using the strongest suitable available non-OpenAI model if OpenAI implemented the feature.
- [ ] Review architecture, correctness, security, edge cases, tests, maintainability, plan compliance, and acceptance criteria.
- [ ] Record every finding and severity in §12 and the HTML report.
- [ ] Apply material fixes through the implementation owner, rerun affected tests, and record dispositions.
- [ ] If the required provider is unavailable, report that limitation and obtain user approval before using a fallback or proceeding unreviewed.

### W8 — Experimental Hyprland milestone

- [ ] Reconfirm scope and threat model before any desktop implementation.
- [ ] Detect Hyprland and backend prerequisites read-only; never install services or change compositor permissions automatically.
- [ ] Define capture and input adapters independently.
- [ ] Implement monitor geometry, transform, scale, and active-window metadata.
- [ ] Require a stronger desktop-control consent screen and persistent visible indicator.
- [ ] Add desktop-specific tests for multiple monitors, mixed scale, focus drift, lock screen, compositor restart, and input-daemon failure.
- [ ] Keep the backend disabled by default until separately reviewed and approved.

## 10. Test and acceptance plan

### 10.1 Unit tests

- Public schema accepts every documented valid action and rejects malformed inputs.
- Runtime validator rejects missing, irrelevant, non-finite, negative, oversized, and out-of-bounds fields.
- State machine rejects illegal transitions.
- Queue executes actions serially and handles cancellation without deadlock.
- Frame IDs change after invalidating events; stale IDs are rejected before execution.
- URL/domain normalization handles IDNs, ports, redirects, schemes, credentials, and malformed URLs safely.
- Policy matrix produces expected allow/confirm/block outcomes for every consequential category.
- Sensitive-field detection blocks password, one-time-code, payment, token, and recovery fields.
- Configuration parsing clamps limits and fails safe on malformed files.
- Observation metadata excludes form values, secrets, hidden content, and oversized text.

### 10.2 Browser integration tests

Use a local deterministic fixture site with pages for navigation, forms, dialogs, popups, redirects, downloads, file inputs, long pages, dynamic DOM changes, and prompt-injection text.

- Start browser, observe page, and receive a valid image result.
- Navigate within an allowed domain.
- Click by coordinate and stable element reference.
- Type only into permitted fields.
- Scroll, drag, hover, press keys, use history, reload, and wait within bounds.
- Reject an action referencing the previous frame.
- Detect and gate form submission and external communication.
- Block secret fields, downloads, uploads, unexpected popups, and external protocols by default.
- Handle page navigation between decision and execution without acting on the new page.
- Recover cleanly from page crash, browser crash, timeout, and aborted confirmation.

### 10.3 Lifecycle and reliability tests

- Concurrent model tool calls execute one at a time in source order or are rejected according to the documented queue policy.
- Repeated start/stop cycles leave no browser or temporary-profile processes/files.
- Session reload, new, resume, fork, clone, abort, and shutdown clean up exactly once.
- Startup failure after each acquired resource releases all earlier resources.
- Screenshot encoding failure does not leave the state actionable with an unknown frame.
- Action and time limits stop further mutation.
- Emergency stop cancels queued/current work and closes resources.

### 10.4 Security tests

- Page prompt injection cannot alter policy or start/stop computer use.
- Tool arguments cannot inject shell commands or executable flags.
- Browser executable discovery rejects untrusted project-local paths unless explicitly approved.
- Screenshots are limited to the controlled browser viewport.
- No cookies, headers, storage, form values, or credentials appear in results/logs/configuration.
- No-UI execution blocks mutating actions.
- Confirmation approval applies only to the exact normalized action and current frame/domain.
- Symlink/path traversal cannot bypass upload/download restrictions if those features are later enabled.
- Dependency review reports no unresolved critical/high known vulnerabilities relevant to runtime use.

### 10.5 Provider compatibility tests

For each supported provider/model family:

- Custom tool schema is accepted.
- Text-plus-image tool results are accepted and interpreted.
- The model can reference the returned frame ID correctly.
- Oversized images/metadata are rejected or normalized before provider submission.
- Unsupported non-vision models receive a clear capability error before session start.

### 10.6 Package checks

Run at minimum:

```bash
cd pi-extension-computer-use
npm test

cd ..
./dev/scripts/check-publish-readiness.sh --all --check-alt-client
./dev/scripts/publish-packages.sh --all
```

The publish command remains plan-only; do not publish without explicit user approval.

### 10.7 Acceptance scenarios

1. **Safe browsing:** User starts an ephemeral session, allows one domain, and the model navigates and summarizes content without mutation.
2. **Form protection:** Model fills a harmless field but must obtain confirmation immediately before submission.
3. **Prompt injection:** Page tells the model to upload a secret; deterministic policy blocks the upload regardless of model response.
4. **Secret protection:** Model attempts to type into a password/OTP field; the extension blocks and asks the user to take over manually.
5. **Stale frame:** Page changes after observation; the old click is rejected and a fresh observation is returned.
6. **No UI:** Print/JSON execution attempts a click; the action fails closed.
7. **Emergency stop:** User triggers stop during a queued action; mutation stops and all resources are closed.
8. **Crash cleanup:** Browser crashes mid-action; the extension reports failure without orphaned processes or an actionable stale frame.

## 11. Dependencies and release gates

### 11.1 Expected dependencies

- Peer: `@earendil-works/pi-coding-agent`
- Peer: `@earendil-works/pi-tui` only if custom rendering requires it
- Peer: `typebox`
- Runtime candidate: `playwright-core` *(subject to W0 spike and approval)*
- Existing shared utilities only when they reduce duplication without coupling the package to unrelated behavior

No dependency should trigger hidden browser downloads, privileged service installation, system configuration changes, or telemetry during package installation.

### 11.2 Release gates

- [ ] Blocking design decisions approved and recorded.
- [ ] Browser MVP scope complete; desktop code absent or disabled behind an explicit experimental gate.
- [ ] All planned tests pass with concrete command output recorded.
- [ ] No unresolved critical/high security findings.
- [ ] Independent cross-provider review completed or user explicitly approves a documented fallback.
- [ ] README and package metadata are accurate.
- [ ] Publish-readiness and plan-only publish checks pass.
- [ ] HTML report exists and links back to this plan.
- [ ] User explicitly approves versioning and publication actions.

## 12. Independent review record

| Date | Reviewer/model/provider | Scope | Findings | Disposition | Status |
|---|---|---|---|---|---|
| Pending | Required cross-provider reviewer | Architecture, correctness, security, edge cases, tests, maintainability, plan compliance | Not run | Not applicable | Pending implementation |

Do not claim independent review until this table contains the actual provider/model, review evidence, findings, and dispositions.

## 13. Risks and mitigations

| Risk | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Web prompt injection influences model intent | High | Deterministic policy, untrusted-page instructions, confirmations | Model may still make harmless but incorrect actions |
| Screenshot leaks sensitive content to model provider | High | Isolated browser, viewport-only capture, explicit consent, no desktop capture in MVP | Controlled page itself may contain sensitive data |
| Authenticated profile exposes accounts | High | Ephemeral isolated profile by default; no personal profile reuse | User may authenticate manually during session |
| Consequential click misclassification | High | Category matrix, target text/context checks, one-action confirmation | Novel UI patterns may evade heuristics |
| Stale screenshot causes wrong action | High | Frame IDs, invalidation events, pre-execution state check | Very fast in-frame visual changes remain possible |
| Wrong-field typing | High | Element identity/focus checks, sensitive-field blocking, fresh frame | Custom controls may obscure field semantics |
| Orphaned browser/input resources | Medium | Idempotent cleanup and failure-injection lifecycle tests | Hard process crashes may require OS cleanup |
| Large screenshots exhaust context | Medium | Dimension/byte limits, format spike, bounded semantic metadata | Dense pages may become less readable |
| Playwright/browser supply-chain risk | Medium | Minimal dependency, lockfile/review, explicit browser setup | Browser itself remains a large dependency surface |
| Provider image/tool incompatibility | Medium | Capability preflight and provider matrix | Provider behavior may change over time |
| Desktop input requires elevated capability | High | Deferred experimental backend, explicit setup, no automatic privilege changes | `/dev/uinput` or equivalent remains powerful |
| Multi-monitor/scale coordinate errors | High | Desktop-specific transforms/tests; browser viewport MVP avoids issue | Deferred backend remains compositor-specific |
| Session persistence stores sensitive actions | High | Never type secrets, minimize details, document session behavior | URLs and non-secret actions may still persist |

## 14. Rollout strategy

1. Develop behind explicit opt-in commands with no automatic startup.
2. Release browser-only as experimental/pre-1.0 behavior.
3. Default to ephemeral profiles, blocked downloads/uploads, one-domain confirmation, and conservative limits.
4. Collect only user-reported, non-sensitive failure evidence; no telemetry.
5. Stabilize protocol, policy, cleanup, and provider compatibility before adding persistent profiles.
6. Treat Hyprland desktop control as a separate reviewed milestone with its own enablement decision.

## 15. HTML report requirements

Create a self-contained report at `reports/pi-computer-use.html` using the `html-report` skill when implementation begins. It must include:

- executive summary and final scope;
- approved decisions and deviations from this proposal;
- architecture and action/policy flow diagrams;
- implementation map by file/component;
- threat model and safety invariants;
- test and acceptance evidence with exact commands/results;
- provider compatibility evidence;
- independent-review findings and dispositions;
- residual risks and unsupported scenarios;
- setup, usage, emergency stop, and rollback guidance;
- a link back to this plan.

## 16. Completion checklist

- [ ] User-approved scope and defaults are recorded.
- [ ] Package implementation exists at `pi-extension-computer-use/`.
- [ ] Browser MVP meets all success criteria.
- [ ] Safety invariants are encoded and tested.
- [ ] Critical checks and provider compatibility tests pass.
- [ ] Independent review is complete and all material findings are resolved.
- [ ] README, plan, and HTML report are current and mutually linked.
- [ ] Residual risks and deferred desktop milestone are explicit.
- [ ] No publication or system-level setup was performed without approval.

## 17. Change log

| Date | Change | Author |
|---|---|---|
| 2026-07-20 | Initial proposed implementation plan created from repository conventions and Pi/Wayland/Hyprland capability evidence | Pi agent |
