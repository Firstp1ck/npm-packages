# Intercom Conversation Viewer

Status: **Awaiting implementation approval**  
Feature class: **Complex**  
Integration owner: **Parent Pi session**  
Final report: [Intercom Conversation Viewer report](../../reports/intercom-conversation-viewer.html) *(created after integration and review)*

## Goal

When an agent uses generic Intercom or native subagent-supervisor coordination, show one conversation tag beneath the Pi WebUI input frame. Selecting a tag opens an accessible in-app modal that presents the two agents' names/IDs and messages in a familiar chat layout.

## Classification rationale

The preliminary `complex` classification is confirmed. The feature crosses persisted Pi session contracts, server-side privacy projection, an HTTP interface, live/restart synchronization, composer UI, modal accessibility, mobile layout, browser caching, tests, and user documentation. It has two meaningful implementation slices (data/API and browser UI) and benefits from separate implementation ownership plus independent privacy/correctness review.

## Measurable success criteria

1. The composer shows exactly one tag per direct two-agent conversation for the active Pi tab, and no tag when no supported conversation exists.
2. Supported records include:
   - generic `pi-intercom` direct messages represented by structured `intercom_message`, `intercom_sent`, and `intercom_received` session entries;
   - native `pi-subagents` child-to-supervisor requests and successful supervisor replies represented by structured supervisor session records.
3. Automated `subagent-control` and `subagent-result` relay traffic does **not** create tags.
4. Selecting a tag opens a focus-managed native dialog. It shows only participant name/ID, message text, direction, and time/order metadata needed for the chat. It does not expose attachment names or bodies, tool arguments/results, reasoning, stdout/stderr, session paths, or raw session entries.
5. Conversations are projected from the active persisted session branch, deduplicated by protocol/request identity, deterministically ordered, bounded, and marked when history/text is truncated.
6. A browser-provided filesystem/session path is never accepted. Session access remains confined to allowed Pi session roots and the selected WebUI tab.
7. The tag list and any open modal refresh safely during live activity, reject stale responses after tab switches, recover from browser/server restart, and stop polling on close.
8. Keyboard, Escape/close, focus restoration, screen-reader labels, narrow/mobile layout, and text-only safe rendering work.
9. Focused parser, endpoint, static/browser, privacy, restart, and cache-revision checks pass; cross-workstream package checks pass after integration.
10. Two fresh, read-only, provider-diverse reviews are completed and every finding is dispositioned in this plan.

## Approved decisions and invariants

| Decision | Approved outcome |
| --- | --- |
| Channels | Include both generic Intercom and native subagent-supervisor coordination. |
| Viewer | Use an in-app modal, not a browser popup or terminal tab. |
| Tags | Show one tag per conversation. |
| Participants | Render both agents explicitly by name/ID; do not relabel them as User/Assistant. |
| Visible content | Show agent name/ID and message text only, like a Telegram/WhatsApp chat. |
| Attachments | Show neither attachment metadata nor attachment bodies. |
| Synthetic relays | Exclude automated `subagent-control` and `subagent-result` records. |
| Source of truth | Use structured records from the active branch of the persisted Pi session. Do not parse rendered prose or connect WebUI directly to the broker. |
| Privacy | Whitelist supported record shapes before copying message text; ignore every unrelated entry/tool. |
| Interaction | Read-only viewer; no compose/reply/cancel controls in this feature. |
| Persistence | Reconstruct from session records after restart; do not persist browser-local transcript copies. |
| Concurrent work | Preserve all existing changes. Do not touch shared frontend/docs/cache files until the syntax-highlighting session explicitly releases ownership. |

## Scope

### In scope

- Pure conversation projection and deduplication.
- Tab-scoped read-only summaries and one-conversation detail API.
- Composer conversation tags.
- Accessible chat-style modal.
- Live refresh, restart reconstruction, branch-aware behavior, bounds, and truncation state.
- Focused tests, user documentation, technical documentation, contributor documentation, and browser asset revisions.

### Non-goals

- Sending or replying from the modal.
- Showing generic non-agent human chat.
- Showing attachments, tool calls/results, reasoning, logs, or complete child transcripts.
- Replacing the existing subagent output overlay/tab.
- Changing Intercom or native supervisor transport protocols.
- Persisting a new conversation database, broker history, or browser-local transcript.
- Guess-merging ambiguous peer names or reconstructing compacted history from summary prose.

## Architecture and contracts

### Projection contract

Add a pure bounded projector, expected at `lib/intercom-conversations.mjs`, that receives active-branch `SessionManager` entries plus local-session identity and returns sanitized conversation summaries/details.

Accepted inputs only:

- `custom_message` with `customType: intercom_message`;
- `custom` with `customType: intercom_sent`;
- `custom` with `customType: intercom_received`;
- `custom_message` with `customType: subagent_supervisor_request`;
- successful, matching native supervisor reply records required to pair a reply with its request.

Required behavior:

- Prefer canonical structured message/request IDs for deduplication.
- Preserve distinct retries/superseding messages; do not text-deduplicate them.
- Group generic messages conservatively by persisted peer identity; use a label-only identity when outbound records cannot be safely resolved.
- Group native messages by parent session, run, child index, and agent identity.
- Ignore malformed, failed, synthetic-relay, attachment-only, and all unrelated records.
- Apply explicit limits before serialization and return truncation flags.

Initial bounds to validate during implementation:

- 32 conversations per tab;
- 200 messages per conversation;
- 64 KiB maximum message text;
- 2 MiB maximum serialized response.

Changing these limits is an implementation judgment if tests show a smaller safe limit is required. Increasing scope or exposing additional fields requires approval.

### HTTP contract

Add a tab-scoped read-only route in `bin/pi-webui.mjs`:

```text
GET /api/intercom/conversations?tab=<tab-id>
GET /api/intercom/conversations?tab=<tab-id>&conversation=<opaque-id>
```

Summary responses contain bounded tag metadata; detail responses contain one sanitized conversation. The route must resolve the selected tab/server-side session file, enforce allowed session roots, use active-branch `SessionManager` entries, return opaque conversation IDs, and never return raw paths or entries.

### Browser contract

Add a dedicated tag container beneath the input frame inside `.composer-context-tags`, plus one native `<dialog>` for the conversation viewer. The UI fetches summaries for the active tab, fetches one detail on selection, renders via `textContent`/safe DOM APIs, labels local/peer messages by agent identity, and uses generation/request guards to discard stale responses.

Refresh triggers should include authoritative reload/reconnect/tab-switch paths and relevant message/tool settlement events. While open, use a bounded low-frequency safety refresh and cancel it on close/tab change.

## Execution DAG and ownership

```text
Decision record + plan approval
            |
            v
WS-A: projection + HTTP contract + backend tests
            |
            v
Integration inspection A + focused backend checks
            |
            v
WS-B: tags + modal + live UI + docs + frontend tests/cache revisions
            |
            v
Central integration + affected/cross-workstream validation
            |
            v
Reviewer A (correctness/privacy)  ||  Reviewer B (UX/tests/maintainability)
            |                                     |
            +------------------+------------------+
                               v
                 Finding disposition / accepted fix pass
                               |
                               v
                    Revalidation + HTML report
                               |
                               v
                     Completion gate / archive plan
```

### WS-A — Data and HTTP implementation worker

- **Prerequisites:** Approved plan; current concurrent changes re-read; no frontend ownership required.
- **Write boundary:**
  - `pi-package-webui/lib/intercom-conversations.mjs` (new)
  - focused new projector test(s)
  - `pi-package-webui/bin/pi-webui.mjs`
  - focused endpoint/backend test sections only
- **Forbidden/shared paths:** No `public/**`, docs, package metadata, service worker, canonical plan, report, or unrelated tests.
- **Deliverables:** Pure projector, allowed-path tab-scoped endpoint, bounds/truncation/privacy behavior, parser and HTTP tests.
- **Validation:** Focused Node tests for projector and HTTP harness; syntax check; `git diff --check` on owned files.
- **Unique handoff artifact:** `pi-package-webui/.pi/subagents/handoffs/intercom-viewer-ws-a.md`
- **Stop conditions:** Any need to expose attachment/tool data, change session/intercom protocols, accept browser paths, broaden route authority, or overwrite concurrent work.

### WS-B — Browser UI, documentation, and user-flow implementation worker

- **Prerequisites:** WS-A integrated and inspected; endpoint contract stable; syntax-highlighting session explicitly releases shared frontend/docs/cache ownership.
- **Write boundary:**
  - `pi-package-webui/public/index.html`
  - `pi-package-webui/public/app.js`
  - `pi-package-webui/public/styles.css`
  - `pi-package-webui/public/service-worker.js`
  - one or more focused new Intercom viewer UI tests
  - only necessary additions to `README.md`, `TECHNICAL.md`, and `DEVELOPMENT.md`
- **Forbidden/shared paths:** No projector/server contract changes, canonical plan, report, unrelated UI areas, or rewrites of concurrent syntax/image/subagent changes.
- **Deliverables:** Per-conversation tags, accessible modal, safe message rendering, live/restart refresh, responsive styling, documentation, asset revisions, static/browser tests.
- **Validation:** Focused static tests, targeted browser flow when available, JavaScript syntax, Markdown diff check, asset/cache consistency, `git diff --check` on owned files.
- **Unique handoff artifact:** `pi-package-webui/.pi/subagents/handoffs/intercom-viewer-ws-b.md`
- **Stop conditions:** Endpoint mismatch, inaccessible modal behavior needing architecture change, UI conflict with concurrent work, or any requirement to display fields outside the approved content contract.

Both workers run sequentially in the shared dirty checkout. No concurrent source writers are allowed.

## Integration procedure

1. Integration owner records a baseline diff/status and verifies current ownership before each worker.
2. After WS-A, inspect every changed hunk and handoff. Reject edits outside its boundary or unsupported contract changes.
3. Run focused projector/HTTP checks on the shared integrated tree.
4. Wait for explicit shared-file release, then launch WS-B.
5. Inspect every WS-B hunk against the approved endpoint/UI contract and preserve existing frontend/docs/cache changes.
6. Run affected tests, browser/static user-flow checks, JavaScript syntax, Markdown checks, cache-revision checks, package checks, and `git diff --check`.
7. Review the actual integrated result, not isolated worker claims.

## Validation contract

Minimum planned checks (exact commands may adapt to package scripts discovered at implementation time):

- projector unit tests covering direct generic and native conversations;
- malformed/failed/synthetic/attachment/unrelated-record exclusion tests;
- deduplication, ordering, ambiguous identity, branch, bounds, and truncation tests;
- HTTP summary/detail, stale tab/conversation, path confinement, privacy, response bounds, and restart tests;
- static DOM/JS tests for tag container, modal wiring, safe rendering, stale-response guards, polling cleanup, focus/Escape, and cache revisions;
- browser test of the active-tab flow at desktop and narrow/mobile width when the harness supports it;
- `node --check public/app.js` and changed `.mjs` files;
- package-focused test/check scripts;
- `git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'`;
- final `git diff --check`.

Any repository-wide failure must be classified as introduced, pre-existing, or unrelated with evidence. No failure may be silently ignored.

## Independent review quorum

After integration, launch two distinct fresh-context, read-only reviewer runs using provider families distinct from each other and from the primary implementation provider when available:

1. **Reviewer A — correctness, security, privacy, restart behavior**
2. **Reviewer B — UX/accessibility, tests, maintainability, plan compliance**

Each finding must record run/model, file or symbol, requirement/failure mode, evidence, severity, and one disposition: `accepted`, `rejected`, `deferred`, or `needs verification`. Only independently verified accepted findings enter a fix pass. Accepted fixes require focused and cross-workstream revalidation.

## Finding disposition record

| ID | Reviewer/run/model | File or symbol | Finding/evidence | Severity | Disposition and rationale | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| Pending | Pending | Pending | Review occurs after integration. | Pending | Pending | Pending |

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Generic outbound recipient identity can be name-only. | Resolve only from evidence; keep ambiguous labels separate instead of guessing. |
| Generic protocol has no thread ID. | Use conservative participant-pair conversations and protocol message IDs. |
| Compaction may remove old structured records. | Show bounded/truncated history; never reconstruct messages from summary prose. |
| Child transcripts contain unrelated sensitive content. | Prefer parent records; whitelist exact structured records; never return full child transcripts. |
| Shared checkout is heavily modified. | Sequential writers only, explicit ownership handoff, re-read before editing, inspect each hunk, preserve all unrelated changes. |
| Live inbound events may not map to one browser event. | Authoritative refetch triggers plus bounded polling only while modal is open. |
| Oversized or malformed message data. | Strict validation, per-message/conversation/response bounds, safe text rendering, truncation metadata. |
| Modal/tag regressions on mobile or keyboard use. | Native dialog semantics, focus restoration, narrow-width tests, and browser validation. |

## Rollback guidance

This feature adds no migration or new durable store. Roll back only the projector, read-only route, dedicated tag/modal UI, focused tests/docs, and corresponding asset revision changes. Preserve every unrelated concurrent hunk. Existing persisted Intercom/session records remain valid and untouched; removing the viewer does not affect message transport or session history.

## Decision and progress record

| Date | Record |
| --- | --- |
| 2026-08-15 | Preliminary complex classification confirmed from repository evidence. |
| 2026-08-15 | User approved both generic Intercom and native supervisor channels. |
| 2026-08-15 | User approved an in-app modal and one tag per conversation. |
| 2026-08-15 | User approved direct agent conversations only; synthetic operational relays excluded. |
| 2026-08-15 | User restricted visible content to agent name/ID and message text; attachments excluded. |
| 2026-08-15 | Architecture review recommended active-branch structured session records, a pure projector, a tab-scoped API, and a dedicated modal. |
| 2026-08-15 | Current shared frontend/docs/cache ownership belongs to the syntax-highlighting session; implementation must wait for explicit release. |

## Completion checklist

- [ ] User approves this canonical implementation plan.
- [ ] WS-A qualifying implementation-worker outcome and handoff are integrated and inspected.
- [ ] WS-B qualifying implementation-worker outcome and handoff are integrated and inspected.
- [ ] Affected and cross-workstream validation passes or omissions are recorded.
- [ ] Two qualifying independent reviews are complete and every finding is dispositioned.
- [ ] Accepted fixes are implemented and revalidated.
- [ ] Self-contained HTML report is created, validated, and linked with this plan.
- [ ] Plan is moved from `plans/planned/` to `plans/archive/` only after verified completion.
