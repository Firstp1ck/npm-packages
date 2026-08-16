# Pi Web UI tool and skill resource profiles

- **Status:** Proposed; awaiting approval
- **Classification:** Complex
- **Feature slug:** `pi-webui-resource-profiles`
- **Target package:** `pi-package-webui/`
- **Integration owner:** Primary Pi session
- **Last updated:** 2026-08-16
- **Final report:** [reports/pi-webui-resource-profiles.html](../../reports/pi-webui-resource-profiles.html) *(created after integration and review)*

## 1. Goal

Let users activate already-discovered Pi tools and skills at three scopes:

1. the current session branch;
2. the global default inherited by future sessions;
3. an exact provider/model default that follows model changes while the resource type is not pinned for the session.

Expose the feature through native TUI `/tools` and `/skills` commands and through the WebUI **Common Options → Feature Setup** submenu while retaining the existing composer shortcut.

## 2. Classification rationale

This remains a **complex feature** because repository evidence shows at least two meaningful implementation slices and several cross-component contracts:

- persisted settings normalization and migration;
- branch-aware runtime state for both TUI and RPC sessions;
- asynchronous model-change handling;
- HTTP endpoints and browser controls;
- independent tool and skill precedence;
- TUI, static, endpoint, and browser validation.

It crosses `index.ts`, the RPC helper, shared settings, server endpoints, browser UI, tests, and user documentation. Separate runtime/TUI and HTTP/browser implementation outcomes are independently verifiable. This confirms the preliminary complex classification.

## 3. Success criteria

1. `/tools` and `/skills` open native TUI selectors with **Session only**, **Global default**, and **Model default** scopes.
2. The WebUI selectors expose the same scopes, exact-model picker, and reset behavior.
3. Tool and skill state resolve independently using:

   ```text
   explicit session selection
       > exact provider/model profile
       > global default
       > captured Pi runtime default
   ```

4. Selecting a specific model immediately recomputes and applies that exact model’s configured tools and skills for each unpinned resource type; users do not need to reopen a selector, reload, or start a new session.
5. A resource type with no exact-model selection immediately falls back to its global default and then the captured Pi runtime default.
6. Each session selector provides **Use inherited defaults** so tools and skills can be unpinned independently.
6. Saving global or model defaults does not rewrite an existing explicit session selection.
7. Exact model identity uses case-sensitive `provider` plus `modelId`, never display names or wildcard matching.
8. Empty arrays mean “enable none”; `null` means “inherit the next-lower scope.”
9. Legacy settings preserve current behavior and migrate only on the next normal settings write.
10. Temporarily unavailable configured resource names survive edits at global and model scopes.
11. Explicit `/skill:name` blocking and model-invocation filtering remain correct, including `disableModelInvocation` skills.
12. Rapid model changes cannot apply stale asynchronous settings reads.
13. **Common Options → Feature Setup** contains Tools Setup and Skills Setup, and the existing composer shortcut remains functional.
14. Focused tests, the package suite, browser interaction checks, syntax checks, Markdown checks, and `git diff --check` pass, or every omission/failure is recorded.
15. The unrelated existing `pi-package-webui/package-lock.json` modification is preserved and not included in this feature.

## 4. Approved decisions and invariants

| Decision | Approved behavior | Rationale |
|---|---|---|
| Meaning of “load” | Activate only tools and skills already discovered by Pi | Avoids package installation, path loading, trust, and reload scope. |
| Precedence | Session > exact model > global > Pi runtime | Gives explicit session intent highest priority while supporting useful defaults. |
| Model switching | On every successful specific-model selection, immediately apply that exact model’s profile for unpinned tools and skills | Automatic adjustment requires no selector reopen, reload, or new session; explicit session pins still retain precedence. |
| Session reset | Include **Use inherited defaults** per resource type | Prevents a branch from becoming permanently pinned after one toggle. |
| Model identity | Exact case-sensitive `provider` + `modelId` | Avoids wildcard surprises and ambiguous display names. |
| TUI commands | `/tools` and `/skills` | Matches existing Pi conventions and WebUI labels. |
| WebUI placement | Common Options → Feature Setup; retain shortcut | Satisfies the requested location without removing the fast path. |
| Persistence owner | Private WebUI settings envelope shared by this package’s TUI extension | Preserves current behavior; do not add package-specific keys to Pi core settings. |
| Writer strategy | Two sequential workers in the shared checkout | The checkout is dirty, so isolated worktree fanout is unsafe. |

### Invariants

- `index.ts` owns resource lifecycle/commands only in `ctx.mode === "tui"`.
- `webui-rpc-helper.mjs` owns resource lifecycle only in `ctx.mode === "rpc"`.
- Tool and skill pin state are separate.
- A model-profile save never silently changes an explicitly pinned current session.
- Settings updates use the existing locked latest-snapshot update path.
- Workers do not modify this plan, the final report, documentation owned by the integration owner, or `package-lock.json`.
- No worker installs, publishes, commits, pushes, restarts, or changes user settings.

## 5. Scope

### In scope

- Shared normalization and exact-model profile resolution.
- Versioned private settings migration.
- Session branch persistence with explicit/inherit modes.
- TUI `/tools` and `/skills` selectors.
- RPC helper state and skill-prompt filtering.
- Model-change recomputation with stale-result fencing.
- HTTP GET/POST support for session/global/model scopes.
- WebUI scope and model controls.
- Common Options submenu entries while retaining the composer shortcut.
- Focused unit, integration, static, and browser interaction coverage.
- README, advanced user reference, and contributor documentation updates.

### Non-goals

- Installing packages or adding extension/skill paths.
- Project-scoped defaults.
- Wildcard model matching or provider-wide profiles.
- Editing Pi core `~/.pi/agent/settings.json`.
- Changing CLI `--tools`, `--skill`, package discovery, or project trust behavior.
- Automatically changing explicitly pinned sessions after global/model saves.
- Managing prompt templates, themes, extensions, or subagent resource lists.
- Modifying unrelated dependency lockfile updates.

## 6. Persisted contract

Extend the settings envelope to version 8:

```json
{
  "version": 8,
  "resourceDefaults": {
    "tools": { "enabledTools": null },
    "skills": { "enabledSkills": null },
    "modelProfiles": [
      {
        "provider": "openai-codex",
        "modelId": "gpt-5.6-sol",
        "tools": { "enabledTools": ["read", "grep"] },
        "skills": { "enabledSkills": null }
      }
    ]
  }
}
```

Rules:

- `null` inherits the next-lower scope; `[]` explicitly enables none.
- Profiles are logically keyed by exact `(provider, modelId)` pairs.
- Store profiles as an array so model IDs containing `/` remain unambiguous.
- Normalize bounded strings and name lists; deduplicate deterministically.
- Drop a profile only when both resource selections are `null`.
- Legacy version ≤7 settings normalize to `modelProfiles: []` without an eager write.
- Preserve unrelated and forward-compatible settings fields.
- Preserve unavailable configured resource names when editing visible choices.

Branch entries remain compatible and gain explicit unpin state:

```json
{ "version": 2, "mode": "explicit", "enabledTools": ["read"] }
{ "version": 2, "mode": "inherit" }
{ "version": 2, "mode": "explicit", "enabledSkills": ["repo-explorer"] }
{ "version": 2, "mode": "inherit" }
```

Legacy tool `enabledTools` and skill `disabledSkills` entries remain explicit pins.

## 7. Runtime design

1. Capture the pre-controller active tool set at session start as the Pi runtime fallback.
2. Read the latest branch entry independently for tools and skills.
3. Resolve the current exact model profile, then global defaults, then the captured baseline.
4. On every successful `model_select`, immediately recompute and apply both unpinned resource types from the newly selected exact model; do not require a selector reopen, reload, or new session.
5. Preserve explicit session pins independently: a pinned resource type is unchanged while the other type still adjusts automatically.
6. Fence every asynchronous recomputation with a monotonic generation and re-check the active model key before applying.
7. On model A → model B → unconfigured model, immediately recompute from immutable defaults rather than the currently active set.
7. Keep separate TUI and RPC controllers or one shared controller with explicit mode ownership; never let both mutate the same runtime.
8. Continue filtering disabled skills from the available-skills system-prompt section and blocking disabled explicit `/skill:name` calls.
9. Keep skills marked `disableModelInvocation` unavailable for automatic model invocation even when user-accessible.
10. Define dynamic tools registered after baseline capture as a bounded limitation: inherited fallback uses the captured session/reload baseline; newly registered tools remain available to explicit selectors and take effect when selected.

## 8. User flows

### TUI

```text
/tools or /skills
  → choose scope: Session only | Global default | Model default
  → when Model default: choose an authenticated exact provider/model
  → toggle available resources
  → for Session only: optionally choose Use inherited defaults
  → save/apply and show a concise scope-aware confirmation
```

Global/model writes update the private package settings. Session writes append branch entries and apply immediately. The commands refuse custom TUI rendering outside TUI mode.

### WebUI

```text
Common Options
  → Feature Setup
    → Tools Setup | Skills Setup
      → choose Session only | Global default | Model default
      → choose exact model when needed
      → toggle resources or Use inherited defaults
```

The existing composer Tools/Skills shortcut opens the same selectors.

Selecting a model through Pi’s normal model picker is the activation trigger. After the model change succeeds, the matching exact-model tool and skill selections take effect immediately for unpinned resource types; changing the model inside a profile-editing form only chooses which profile to edit and does not switch Pi’s active model.

## 9. Execution DAG and ownership

```text
Approved plan
    |
    v
Wave A: runtime + persistence + TUI worker
    |
    v
Integration owner inspection + focused checks
    |
    v
Wave B: HTTP + browser UI worker
    |
    v
Integration owner cross-workstream checks + docs
    |
    v
Two fresh independent reviewers
    |
    v
Finding disposition → one bounded fix worker if needed
    |
    v
Revalidation → final HTML report → archive plan
```

### Workstream A — runtime, persistence, and TUI

- **Worker role:** implementation worker
- **Prerequisite:** approved plan; no source implementation started
- **Write boundary:**
  - `pi-package-webui/lib/resource-selection.mjs` *(new)*
  - `pi-package-webui/lib/git-workflow-preferences.mjs`
  - `pi-package-webui/webui-rpc-helper.mjs`
  - `pi-package-webui/index.ts`
  - focused new/updated tests whose names are limited to resource settings/runtime/TUI behavior
- **Forbidden:** `pi-package-webui/bin/pi-webui.mjs`, `pi-package-webui/public/**`, user documentation, this plan, reports, `package-lock.json`, unrelated tests.
- **Deliverables:** settings v8 normalization/migration, pure resolution helpers, TUI commands, branch pin/unpin behavior, model-switch fencing, focused tests.
- **Validation:** focused Node tests plus syntax/type-loading checks applicable to touched files.
- **Unique handoff:** `.pi/subagents/handoffs/pi-webui-resource-profiles-worker-a.md`
- **Stop/escalate:** any new product choice, schema incompatibility, need to touch a forbidden/shared path, or inability to preserve legacy entries.

### Integration checkpoint A

The integration owner must inspect the actual diff, confirm boundary compliance, preserve `package-lock.json`, and run focused Workstream A tests before starting Workstream B.

### Workstream B — HTTP and browser UI

- **Worker role:** implementation worker
- **Prerequisite:** Workstream A integrated and focused checks passing
- **Write boundary:**
  - `pi-package-webui/bin/pi-webui.mjs`
  - `pi-package-webui/public/app.js`
  - `pi-package-webui/public/index.html`
  - `pi-package-webui/public/styles.css` only if required for the added controls
  - required service-worker or asset revision file only when existing cache conventions require it
  - focused HTTP/static/browser tests for the resource selectors and Common Options entries
- **Forbidden:** Workstream A files, user documentation, this plan, reports, `package-lock.json`, unrelated tests.
- **Deliverables:** model-scope API, validation and unavailable-name preservation, WebUI controls, submenu entries, retained shortcut, interaction/static coverage.
- **Validation:** focused endpoint/static tests, JavaScript syntax check, and targeted browser interaction test when available.
- **Unique handoff:** `.pi/subagents/handoffs/pi-webui-resource-profiles-worker-b.md`
- **Stop/escalate:** any need to change the persisted schema or runtime contract, any new product choice, or any forbidden/shared-path requirement.

### Integration owner work

- Inspect and accept/reject each worker result.
- Resolve shared documentation and version/cache consistency.
- Update `README.md`, `TECHNICAL.md`, and `DEVELOPMENT.md` at the correct documentation layers.
- Run cross-workstream checks.
- Record reviewer findings and dispositions.
- Create the final HTML report.
- Move this plan to `plans/archive/` only after all completion gates pass.

## 10. Validation contract

### Settings and pure resolution

- Legacy v7 normalizes to v8 in memory without behavior change.
- Next normal write persists v8 and preserves unrelated fields.
- Exact profile matching is case-sensitive by provider/model ID.
- `null`, `[]`, malformed values, duplicates, and both-null profiles behave deterministically.
- Latest-snapshot profile updates do not lose concurrent unrelated settings.
- Unavailable names survive global/model edits.

### Runtime

- Session tools pinned / skills inherited.
- Session skills pinned / tools inherited.
- Both pinned and both inherited.
- Use inherited defaults appends an inherit entry and immediately recomputes.
- Selecting model A immediately applies A’s unpinned tool and skill selections without reopening selectors or reloading.
- Model A → B immediately applies B’s selections; switching to a model with no profile immediately restores model/global/runtime fallback correctly.
- If tools are session-pinned and skills are inherited, model selection immediately adjusts skills only; verify the inverse case too.
- Rapid model changes cannot apply stale reads.
- TUI handlers do not own or mutate RPC mode.
- RPC helper does not own TUI mode.
- Disabled skill prompt filtering and explicit command blocking remain correct.
- `disableModelInvocation` remains respected.

### HTTP and WebUI

- GET/POST reject unsupported scopes and malformed model identities.
- Model scope returns configured state and exact model metadata.
- Global/model saves do not rewrite session state.
- Session unpin recomputes inherited state.
- Common Options entries work by pointer and keyboard.
- Mobile submenu drill-in/back behavior remains correct.
- Existing composer shortcut still opens Tools Setup and Skills Setup.
- Model picker includes available exact models and requires a valid selection.

### Integrated commands

From `pi-package-webui/`, run at minimum:

```bash
node --check public/app.js
node --check bin/pi-webui.mjs
node --check webui-rpc-helper.mjs
npm test
git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'
git diff --check
```

Run the focused browser spec for Common Options/resource selectors. If browser dependencies or a display are unavailable, record the exact omission and run the strongest static/DOM harness available.

## 11. Independent review gate

After integration and cross-workstream validation, obtain two fresh-context, read-only reviewer outputs from distinct provider families when available:

1. **Correctness/security reviewer:** precedence, stale async state, branch persistence, settings migration, trust/privacy, prompt/tool behavior.
2. **UX/tests/maintainability reviewer:** TUI and WebUI parity, accessibility, model picker, reset UX, test quality, documentation, and scope discipline.

Each finding must record:

- reviewer run identity and provider/model;
- affected file or symbol;
- requirement or failure mode;
- evidence and severity;
- disposition: `accepted`, `rejected`, `deferred`, or `needs verification`;
- fix and revalidation evidence when accepted.

A fix pass may receive only accepted findings and must remain a single sequential writer.

## 12. Rollback and recovery

- Code rollback removes model-scope handling while legacy global/session settings remain readable.
- Version 8 fields are additive; older package versions may ignore unknown `modelProfiles` while retaining existing global fields.
- Session `mode: "inherit"` entries are harmless custom entries to older versions; explicit legacy entries remain supported by the new version.
- If settings parsing fails, fail safely without overwriting the unreadable file and keep Pi’s runtime resources.
- If model-profile recomputation fails, retain the last safely applied state and show a bounded error rather than applying partial selections.
- Keep a user backup of `~/.pi/webui/settings.json` before manual downgrade; never edit it while sessions are active.
- The existing unrelated `package-lock.json` diff must remain byte-for-byte outside this feature.

## 13. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---:|---|
| TUI and RPC controllers both mutate one WebUI tab | High | Strict `ctx.mode` ownership and tests proving no cross-mode mutation. |
| Previous model profile leaks into an unconfigured model | High | Capture immutable runtime baseline; recompute from persisted layers, never current active state. |
| Slow profile read wins after a later model switch | High | Generation counter and active-model-key fence before apply. |
| Session branch cannot return to inherited behavior | Medium | Explicit v2 inherit entry and visible reset action. |
| Skill marked user-only becomes model-invokable | Medium | Preserve `disableModelInvocation` filtering semantics. |
| Editing visible choices deletes unavailable configured names | Medium | Preserve unavailable names at global and model scopes. |
| Concurrent settings writers lose unrelated changes | Medium | Use locked latest-snapshot `updateWebuiSettings()`. |
| Settings v8 breaks hard-coded tests or migration | Medium | Focused migration tests and deliberate assertion updates. |
| Dynamic tools appear after baseline capture | Low | Document baseline-at-session/reload behavior; selectors can explicitly include newly registered tools. |
| Existing dirty lockfile is overwritten | High | Sequential shared-tree workers with explicit forbidden path and parent diff inspection. |

## 14. Decision and progress record

### Approved decisions

- 2026-08-16: Activate already-discovered resources only.
- 2026-08-16: Use session > exact model > global > runtime precedence independently for tools and skills.
- 2026-08-16: Follow model changes unless that resource type is session-pinned.
- 2026-08-16: A successful specific-model selection automatically and immediately applies that exact model’s configured tools and skills for unpinned resource types, without reload or selector reopening.
- 2026-08-16: Register `/tools` and `/skills` in the TUI.
- 2026-08-16: Put both entries under Common Options → Feature Setup and retain the existing shortcut.
- 2026-08-16: Include independent **Use inherited defaults** actions.

### Assumptions

- Exact authenticated model lists remain available through the existing model registry/API.
- The package extension is loaded wherever its TUI commands and shared settings should apply.
- Settings remain local/private under the existing WebUI settings path.

### Explicitly rejected or deferred

- Package/path loading and installation.
- Wildcard model profiles.
- Project-scoped resource profiles.
- Pi core settings schema changes.
- Removing the existing composer shortcut.

### Current progress

- Repository exploration completed.
- Pi extension, TUI, skills, and settings documentation inspected.
- Existing WebUI session/global implementation traced.
- User-owned behavior decisions resolved.
- Independent architecture challenge completed; findings incorporated.
- Implementation has not started.

## 15. Completion record

The feature is complete only when:

1. both implementation-worker outcomes and handoffs are inspected and accepted;
2. current focused and cross-workstream validation evidence is recorded;
3. two qualifying independent reviews are complete and every finding is dispositioned;
4. accepted fixes are revalidated;
5. [the final HTML report](../../reports/pi-webui-resource-profiles.html) is current and links back to this plan (or its archived path);
6. this plan is moved from `plans/planned/` to `plans/archive/`;
7. remaining risks and any explicit waiver are recorded.

Until then, report the feature as **incomplete**.
