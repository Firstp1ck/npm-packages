# WebUI subagent launch-slot configuration

## Objective and success criteria

Add a separate configuration editor to the WebUI **Subagents** section for assigning a model and thinking level to one or more launch slots for each existing builtin subagent role.

Success means:

- the editor covers the existing builtin roles `context-builder`, `delegate`, `oracle`, `planner`, `researcher`, `reviewer`, `scout`, and `worker`;
- every role always has one base launch slot and can add independent same-role slots;
- each slot stores an explicit provider-qualified model plus thinking level, or inherits both;
- launch slots remain presets for the same runtime role (for example, two configured reviewer slots still launch `agent: "reviewer"` with distinct explicit model specs);
- user-global settings are the default, with an explicit project scope that inherits user settings until customized;
- settings are WebUI-owned and require no changes to `pi-subagents`;
- the active Pi tab receives bounded launch-slot guidance in its system prompt after reload, so future orchestration passes the configured model spec to each matching child;
- saving is localhost-only, revision-checked, atomic through the existing private WebUI settings file, and preserves unrelated settings;
- configuration rendering and refresh remain separate from live subagent monitoring;
- focused tests, package checks, independent review, and the final HTML report complete successfully.

## Scope and non-goals

### In scope

- Versioned WebUI-owned launch-slot persistence in the existing private WebUI settings file.
- User and per-project scopes, where an absent project configuration inherits the user configuration.
- Stable slot IDs, bounded normalization, optimistic revision checks, and project-key resolution from the active tab cwd.
- Model and thinking selectors backed by the active tab's available model registry.
- A separate responsive and accessible configuration editor above the current live subagent monitor.
- Cached per-session prompt guidance loaded at `session_start`; successful saves offer an active-tab reload before becoming effective.
- Tests, README documentation, plan, independent review evidence, and a strict HTML report.

### Non-goals

- Modifying `pi-subagents`, its RPC protocol, builtin agents, or agent files.
- Creating callable aliases such as `reviewer-2`.
- Launching children directly from the configuration editor or adding a task composer.
- Changing already-running children.
- Configuring fallback models, tools, skills, prompts, watchdogs, retry gates, or custom/package agents.
- Exposing configuration mutation to remote browser clients.

## Approved decisions and assumptions

- Added rows are **launch slots**, not callable agents. Multiple rows retain the same runtime role and are expressed as repeated tasks with explicit `model` values.
- `pi-subagents` remains unchanged. WebUI owns persistence and injects orchestration guidance through its existing helper extension.
- User-global scope is the default. Project scope is keyed by the active tab's canonical project root and inherits user slots until explicitly saved.
- Model and thinking are configurable. An inherited model also inherits thinking; choosing an explicit thinking level requires an explicit model because mixed parallel task entries encode thinking as a model suffix.
- Canonical persisted models use `provider/id` without a thinking suffix. Runtime guidance composes `provider/id:<thinking>` only when thinking is explicit.
- The editor covers the eight documented builtin roles. Custom/package role discovery is deferred because current `pi-subagents` exposes no structured configuration API.
- Save endpoints are localhost-only. GET remains authenticated/read-only under existing WebUI access controls.
- Save returns `reloadRequired: true`; the helper intentionally keeps the session-start snapshot until the active tab is reloaded. Running children are unaffected.
- The base slot is non-removable. Additional slots copy the source slot's current model/thinking draft and are removable.
- Maximums: 8 slots per role, 32 total slots, 160-character slot IDs, 240-character model IDs, and only Pi's supported thinking vocabulary.

## Configuration contract

### Persisted WebUI settings shape

```json
{
  "version": 5,
  "subagentLaunchSlots": {
    "version": 1,
    "user": {
      "roles": {
        "reviewer": [
          { "id": "reviewer:base", "model": "anthropic/claude-opus-4-8", "thinking": "high" },
          { "id": "slot-uuid", "model": "google/gemini-3.1-pro", "thinking": "high" }
        ]
      }
    },
    "projects": {
      "/canonical/project/root": {
        "roles": {}
      }
    }
  }
}
```

Normalization always materializes all eight roles with one base slot. Missing or malformed project entries do not erase the user configuration. Unknown roles, duplicate/unsafe IDs, unsupported thinking values, excess slots, and overlong values are dropped or reset deterministically.

### HTTP GET

`GET /api/subagents/config?tab=<tabId>&scope=user|project`

Returns:

- `scope`, `projectKey`, `projectLabel`, and `inherited`;
- `revision`, an opaque SHA-256 digest of the stored scope entry or inheritance marker;
- normalized `roles` and role metadata;
- available models from the active tab and model-specific supported thinking levels;
- `reloadRequired: false` on initial load;
- explicit bounds and supported thinking choices.

### HTTP POST

`POST /api/subagents/config`

Body:

```json
{
  "tab": "tab-id",
  "scope": "user",
  "revision": "opaque-revision",
  "roles": { "reviewer": [{ "id": "reviewer:base", "model": null, "thinking": null }] }
}
```

For project scope, `{ "inherit": true }` removes the explicit project entry and resumes user inheritance.

Behavior:

- require localhost before reading the body;
- bind project identity to the selected tab's server-owned cwd;
- reject stale revisions with HTTP 409 and return/describe the conflict without overwriting;
- reject unknown/unavailable models, unsupported model/thinking combinations, duplicate IDs, missing base slots, and limit violations with HTTP 400;
- preserve currently configured unavailable models only on GET; a new save must use currently available models or inherit;
- persist via `writeWebuiSettings`, preserving unrelated fields;
- return the fresh contract plus `saved: true`, `changed`, and `reloadRequired: true` when changed.

## Runtime guidance contract

At `session_start`, `webui-rpc-helper.mjs` reads the effective launch-slot configuration once for `ctx.cwd` and caches it for that extension runtime. `before_agent_start` appends a bounded section only when at least one slot has an explicit model:

```text
## WebUI subagent launch slots
These are default model assignments for future delegation in this Pi tab. Explicit user instructions in the current request win.
- reviewer slot 1: agent=reviewer model=anthropic/claude-opus-4-8:high
- reviewer slot 2: agent=reviewer model=google/gemini-3.1-pro:high
When launching multiple slots of one role, create separate task entries so each model remains explicit; do not replace them with count when model specs differ.
```

The section is configuration guidance, not a claim that aliases exist. It never changes tool calls in place and does not affect running children. Skill filtering and launch-slot guidance must compose into one `before_agent_start` return without discarding either change.

## Browser UX contract

- Add an **Agent models** configuration region between the current help callout and open-mode control.
- Keep separate state, loading, errors, dirty draft, request serial, and rendering from `latestSubagents` and its polling loop.
- Scope selector: **User default** and **This project**. Project scope visibly says when it inherits user defaults and offers **Use user defaults** after customization.
- Group slots by role. Every role card shows a title, short purpose, numbered slots, model select, thinking select, metadata, **Add same type**, and removal controls for added slots.
- Model option `Default / inherit` forces thinking to `Default / inherit`. Thinking choices update from the selected model's supported levels.
- One **Save agent models** button saves the complete draft. It is enabled only when dirty and not busy.
- After a changed save, show **Reload active tab** and **Later**. Reload uses the existing tab restart path and then refetches configuration.
- Loading/save/conflict errors remain inside this region and never hide or stop the live monitor/open-mode control.
- Adding focuses the new model select and announces the role/ordinal. Removal restores sensible focus. Repeated controls have instance-specific accessible labels.
- At narrow/coarse layouts, cards and actions stack, selects fill the width, model IDs wrap, and touch targets are at least 44px.

## Workstreams and ownership

### WS-1 — Plan and contract baseline

- Owner: integration owner.
- Deliverable: this plan, baseline status, frozen data/API/runtime/UX contract.
- Dependencies: approved user decisions and source-backed architecture handoffs.
- Status: complete before implementation delegation.

### WS-2 — Persistence, runtime guidance, and server API

- Owner: implementation worker A; sole writer while active.
- Files: `lib/git-workflow-preferences.mjs`, new `lib/subagent-launch-slots.mjs`, `webui-rpc-helper.mjs`, `bin/pi-webui.mjs`, `lib/trust-boundaries.mjs`, focused helper/persistence/HTTP tests.
- Deliverable: normalized versioned persistence, effective scope resolution, prompt formatter/cache integration, GET/POST endpoints, validation, localhost guard, and focused backend tests.
- Dependencies: WS-1.
- Non-goals: browser DOM/CSS and report.

### WS-3 — Browser configuration editor

- Owner: implementation worker B; starts only after WS-2 integration inspection.
- Files: `public/index.html`, `public/app.js`, `public/styles.css`, optional pure browser state module, focused browser/static tests, README.
- Deliverable: separate accessible editor, scope/draft/add/remove/save/reload flows, responsive styling, and focused UI tests.
- Dependencies: integrated WS-2 API contract.
- Non-goals: changing backend contract or live monitoring behavior.

### WS-4 — Integration, validation, review fixes, and report

- Owner: integration owner as sole final writer.
- Deliverable: combined checks, manual contract evidence, finding dispositions, accepted fixes, and `reports/subagent-launch-slot-configuration.html`.
- Dependencies: WS-2 and WS-3 complete and inspected.

Merge/order: WS-1 → WS-2 → integration inspection → WS-3 → combined validation → independent reviews → accepted fixes → rerun checks → report.

## Acceptance tests

### Persistence and contract

- Defaults materialize all eight roles with one stable base slot each.
- User round-trip preserves multiple same-role slots and unrelated WebUI settings.
- Project scope inherits user settings until customized; reset removes only that project entry.
- Project key resolution is deterministic for nested paths in the same repository/config root.
- Invalid roles, IDs, duplicate IDs, thinking values, model suffixes, and bounds are rejected or normalized as specified.
- Revision mismatch returns 409 and leaves disk unchanged.
- Existing unavailable models remain visible on GET, while POST rejects unavailable new values.
- Model/thinking compatibility is validated against active-tab registry metadata.
- POST is rejected for non-localhost clients before mutation.

### Runtime guidance

- `session_start` snapshots effective slots for the current cwd.
- User/project precedence resolves correctly.
- Prompt guidance uses repeated same-role entries, explicit canonical model specs, and thinking suffixes. When a role mixes explicit and inherited slots, inherited rows are preserved as `use the role/default model` entries so slot count and ordering remain intact.
- Guidance is omitted when every slot inherits.
- Guidance is bounded and coexists with disabled-skill prompt filtering.
- A save does not mutate the current helper snapshot; reload/session restart does.

### Browser behavior

- Configuration loads independently from live overview polling.
- The Agent models editor is a native, keyboard-accessible `details`/`summary` surface that starts collapsed, reports dirty/reload/error state in its summary, and reopens when attention is required.
- Role cards respond to the actual side-panel container width, not only viewport width; narrow panels stack model/thinking controls without overlap while retaining full per-slot accessible names.
- Scope switching preserves or explicitly confirms dirty-draft loss.
- Add creates an independent same-role slot with a stable ID, copies the source draft, focuses it, and respects limits.
- Base slots cannot be removed; added slots can be removed with explicit accessible names.
- Model inheritance resets thinking inheritance; explicit models expose only supported thinking options.
- Save prevents double submission, retains drafts on failure/conflict, and shows reload only after changed success.
- Reload targets the active tab and refetches configuration without stopping running child monitoring.
- Live `/api/subagents` refresh does not replace focused configuration controls.
- Mobile/coarse CSS stacks controls without overflow and meets touch-target expectations.

### Package checks

- Syntax checks for every changed JS/MJS file.
- Focused launch-slot persistence/state/helper/API tests.
- Existing `subagents-helper.test.mjs`, `http-endpoints-harness.test.mjs`, and `mobile-static.test.mjs` pass.
- `npm test` and `npm run check` pass, or any unrelated pre-existing failure is recorded with evidence.
- `git diff --check -- pi-package-webui` passes.
- Final HTML report validates strictly through the `html-report` skill validator.

## Risks and mitigations

- **Prompt adherence:** launch slots are guidance because `pi-subagents` is unchanged. Make the prompt explicit, bounded, and test exact output; document that explicit user/tool-call models still win.
- **Role catalog drift:** the eight builtin roles are version-coupled. Keep one exported catalog and document the compatibility boundary.
- **Project identity:** cwd may be nested or not a repository. Resolve nearest `.pi`/`.git` root with a deterministic cwd fallback and never trust a browser-supplied path.
- **Model suffix ambiguity:** persist base IDs and thinking separately; reject persisted model IDs ending in a recognized thinking suffix.
- **Concurrent edits:** revision-check against the latest disk snapshot immediately before the atomic settings write and reject stale browser drafts.
- **Reload honesty:** helper caching ensures saved and active states are distinct; UI copy must not claim current children changed.
- **Large side panel:** render compact role cards and stack on mobile; keep live monitoring below rather than interleaving form and live rows.
- **Remote mutation:** explicit localhost trust route prevents authenticated remote configuration writes.

## Review and report status

Completed against the integrated worktree.

- Independent reviewer A: Claude Sonnet 5 with high thinking — backend/runtime correctness and security.
- Independent reviewer B: Kimi K3 with high thinking — browser UX, accessibility, integration, and test adequacy.
- Accepted and fixed: same-file concurrent update serialization, per-tab reload reminders, stable scope-select description, distinct slot-ID generation errors, mixed inherited/explicit guidance documentation, and byte-for-byte unchanged settings after a rejected stale save.
- Deferred as non-blocking follow-up: optional role-scoped stale-model messaging, shared thinking-level helper extraction, project-entry pruning, and a repository-owned visual regression harness.
- Narrow-width UI follow-up review: Claude Sonnet 5 and Kimi K3, both with high thinking, independently found no blockers. Accepted fixes updated the stale `Add same type` static assertion, added the missing `.sr-only` utility, and clarified the temporary reload dismissal as `Not now`.
- The narrow-panel layout was also rendered by the independent Claude reviewer in Chrome 152 at 200–340px container widths inside a 1600px viewport; model/thinking controls stacked without overlap. The lack of a permanent executable visual test remains a non-blocking coverage gap.
- Focused persistence, browser-state, browser-static, helper, HTTP, and fast-mode regression tests pass; changed JS/MJS syntax checks and `git diff --check -- pi-package-webui` pass.
- `npm test` and `npm run check` each run 52 test files with 51 passing. The only failure is the committed, unrelated `mobile-static.test.mjs` typography-floor assertion against `font-size: 0.72rem` at `public/styles.css:7290`, outside the launch-slot CSS block and not worsened by this feature.
- Final report: `reports/subagent-launch-slot-configuration.html`.
- Strict report validation: PASS with zero errors and zero warnings via the bundled `html-report` validator.
