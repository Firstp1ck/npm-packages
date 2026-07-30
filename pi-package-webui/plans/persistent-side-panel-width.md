# Persistent Control Deck width

Status: implemented and reviewed  
Classification: lightweight  
Integration owner: parent Pi session (`openai-codex/gpt-5.6-sol`, high)  
Report: [persistent-side-panel-width.html](../reports/persistent-side-panel-width.html)

## Goal and success criteria

Persist the desktop Control Deck/side-panel width for the operating-system user, while retaining immediate browser-local restoration and responsive overlay behavior.

Success requires:

- Pointer and keyboard resize completion saves a rounded width.
- The width is stored in the private user WebUI settings file and restored in later WebUI sessions.
- Existing browser-local values migrate when the user settings file has no width.
- Widths outside 320–4096 px are rejected or ignored.
- Narrow/overlay layouts remain non-resizable.
- Existing unrelated dirty-worktree changes are preserved.

## Classification rationale

The preliminary lightweight classification is confirmed. This adds one bounded scalar preference, one small authenticated API resource, and focused client restore/save behavior using existing settings infrastructure. It has one implementation slice, no database or deployment migration, no new dependency, and no material security boundary change.

## Scope and non-goals

### In scope

- User-scoped `interfacePreferences.sidePanelWidth` normalization and persistence.
- `GET` and `PUT /api/interface-preferences`.
- Browser-local cache, migration, cross-tab application, and startup race protection.
- Focused unit, static, and HTTP-harness coverage.

### Non-goals

- Multi-account server profiles; the local WebUI remains scoped to the OS user running it.
- Mobile/overlay resizing.
- Persisting every browser interface preference server-side.
- Refactoring unrelated Guided Git publication work already present in the dirty worktree.

## Decisions and invariants

1. The server-owned source of truth is the existing private WebUI settings file (`~/.config/pi-webui/settings.json`, or `PI_WEBUI_SETTINGS_FILE`).
2. `localStorage` remains an immediate, offline-capable cache and migration source.
3. Server values are whole pixels in the inclusive range 320–4096.
4. A startup response cannot override a resize made while that response is in flight.
5. Preference responses expose only the normalized preference, not the absolute settings-file path.
6. Existing atomic writes and per-file update serialization remain the only settings write path.

## Implementation map

| File | Change |
|---|---|
| `lib/git-workflow-preferences.mjs` | Normalize and merge `interfacePreferences.sidePanelWidth`; define server bounds. |
| `bin/pi-webui.mjs` | Read/save helpers and authenticated `GET`/`PUT /api/interface-preferences` routes. |
| `public/app.js` | Cache locally, save to the user endpoint, restore/migrate at startup, prevent stale-response races, and apply cross-tab updates. |
| `tests/git-workflow-preferences.test.mjs` | Bounds, rounding, and settings-file persistence coverage. |
| `tests/side-panel-resize-static.test.mjs` | Client/server wiring and bounded-local-cache assertions. |
| `tests/http-endpoints-harness.test.mjs` | Endpoint round trip, rejection, preservation, and path-disclosure coverage. |

## Validation evidence

| Check | Result |
|---|---|
| `node --check public/app.js && node --check bin/pi-webui.mjs && node --check lib/git-workflow-preferences.mjs` | Passed |
| `node tests/git-workflow-preferences.test.mjs` | Passed |
| `node --test tests/side-panel-resize-static.test.mjs` | Passed: 4/4 |
| `git diff --check -- <feature files>` | Passed |
| `node tests/http-endpoints-harness.test.mjs` | Feature assertions reached final cleanup without assertion failure; command exited nonzero because orphaned Windows fake-Pi processes kept the temporary directory locked (`EBUSY`). Reproduced twice. |

## Independent review and dispositions

The direct Anthropic reviewer route was attempted twice and failed before producing output because the account returned HTTP 429 rate limits. Three fresh, read-only reviews then completed through OpenRouter with distinct model-author families. On 30 July 2026, the user explicitly waived routing-provider diversity and approved this model-author-diverse alternative quorum.

| Review | Identity | Result |
|---|---|---|
| Browser/user-flow review | `openrouter/google/gemini-3.6-flash:high`; session `56dd7365/run-0` | No blockers; lightweight classification confirmed. |
| Security/settings review | `openrouter/deepseek/deepseek-v4-flash:high`; session `1c04b363/run-0` | No blockers; one moderate path-disclosure finding. |
| Race/UX/test review | `openrouter/qwen/qwen3.7-plus:high`; session `045fe19a/run-0` | No blockers; one low local-cache upper-bound finding and several optional notes. |

### Finding dispositions

| Finding | Disposition | Evidence/rationale |
|---|---|---|
| API returned the absolute settings-file path | **Accepted and fixed** | Client did not use it; responses now return only `preferences`. Harness asserts `path` is absent. |
| Browser cache accepted values over 4096 px | **Accepted and fixed** | `readStoredSidePanelWidth` now enforces the same upper bound as the server. |
| Startup restore is fire-and-forget | **Rejected** | Intentional non-blocking startup; immediate local cache plus revision guard prevents the material stale-response race. |
| Save failure uses a warning rather than persistent banner | **Deferred** | Local persistence and a visible warning preserve usability; broader offline-status UX is outside scope. |
| Overlay storage events do not immediately apply the width | **Deferred** | Overlay width is intentionally fixed; the persisted cache remains available. No current-session requirement is violated. |
| Raw top-level settings preserve unknown fields | **Rejected as pre-existing/out of scope** | Not introduced by this feature and does not bypass normalized `interfacePreferences`. |

## Rollback and residual risks

Rollback is additive: remove the interface-preference routes and client calls, then remove `interfacePreferences` normalization. Existing settings files may retain an inert `interfacePreferences` field safely.

Residual risks:

- No real-browser pointer/keyboard reload test was run.
- The full HTTP harness cannot currently report a clean Windows exit because its spawned fake-Pi process tree leaves temporary directories locked.
- Server-save failures fall back to browser storage and a warning; they do not guarantee cross-browser persistence until a later successful save.
