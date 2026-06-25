# Optional Features: Minimal WebUI Implementation Plan

Date: 2026-06-07

## Goal

Keep `pi-package-webui` minimal and user-customizable by moving optional-feature-specific logic into the packages/extensions that own those features.

The WebUI should provide:

- generic extension payload transport/rendering;
- optional feature enable/disable controls;
- safe generic actions;
- minimal fallback UI.

The WebUI should not own feature-specific business logic, parsing, or duplicated TUI behavior.

## Reference Pattern

`pi-extension-git-footer-status` is the target pattern:

- extension owns rich footer data;
- extension emits a structured WebUI payload;
- WebUI validates/renders/caches the payload generically;
- fallback is minimal and does not duplicate extension behavior.

## Features to Migrate

| Feature ID | Package | Current issue | Target change |
|---|---|---|---|
| `releaseNpm` | `@firstpick/pi-extension-release-npm` | WebUI has hardcoded release widget parsing/rendering/actions. | Extension emits structured release widget/log payloads and action metadata. |
| `releaseAur` | `@firstpick/pi-extension-release-aur` | Same as npm release, plus setup/status widgets. | Extension emits structured AUR release/setup payloads. |
| `todoProgressWidget` | `@firstpick/pi-extension-todo-progress` | WebUI parses TUI widget text lines into a custom checklist UI. | Extension emits structured checklist payload. |
| `gitWorkflow` | `@firstpick/pi-prompts-git-pr` / new extension | WebUI owns guided git workflow state and server git endpoints. | Move workflow orchestration into an extension; WebUI renders generic stepper/action/log payloads. |
| `tuiToolsCommand` | `@firstpick/pi-extension-tools` | WebUI helper duplicates tools state/toggle behavior. | Owning extension exposes browser-safe structured resource-toggle payload/API. |
| `tuiSkillsCommand` | `@firstpick/pi-extension-setup-skills` | WebUI helper duplicates skill discovery/toggle behavior. | Owning extension exposes browser-safe structured resource-toggle payload/API. |
| `themeBundle` | `@firstpick/pi-themes-bundle` | WebUI hardcodes bundle discovery. | Keep browser theme application in WebUI, but discover theme resources through generic package/theme metadata. |

Mostly acceptable as-is:

| Feature ID | Package | Reason |
|---|---|---|
| `statsCommand` | `@firstpick/pi-extension-stats` | WebUI mostly detects/hides command availability; it does not currently duplicate rich stats rendering. |
| `gitFooterStatus` | `@firstpick/pi-extension-git-footer-status` | Already migrated to extension-owned structured payload. |

## Shared Contract

Add a generic WebUI extension payload contract that can be used by all optional features.

Recommended payload envelope:

```ts
type WebuiExtensionPayload = {
  type: "firstpick.webui.extension-payload";
  version: 1;
  featureId: string;
  payloadId: string;
  renderer: "footer" | "log" | "checklist" | "stepper" | "resource-toggle" | "summary" | "generic-lines";
  title?: string;
  cache?: {
    enabled?: boolean;
    key?: string;
    invalidateOnFeatureToggle?: boolean;
    cwdScoped?: boolean;
  };
  actions?: Array<{
    id: string;
    label: string;
    command?: string;
    variant?: "default" | "primary" | "danger";
    disabled?: boolean;
  }>;
  data: unknown;
};
```

Transport options:

- short-lived/live widgets: `ctx.ui.setWidget(payloadId, JSON.stringify(payload), ...)`;
- persistent status/footer-like data: `ctx.ui.setStatus(payloadId, JSON.stringify(payload))`;
- user actions: existing `/api/prompt` slash-command dispatch, with silent/internal args where needed.

## WebUI Core Changes

1. Add `parseWebuiExtensionPayload(raw)` validation.
2. Add generic renderers:
   - `renderExtensionLog(payload)`;
   - `renderExtensionChecklist(payload)`;
   - `renderExtensionStepper(payload)`;
   - `renderExtensionResourceToggle(payload)`;
   - `renderExtensionSummary(payload)`;
   - existing footer payload renderer can remain specialized initially, then move under this system.
3. Add generic action button handler:
   - dispatch declared `command` through `/api/prompt`;
   - allow `danger` styling;
   - avoid feature-specific command names in WebUI.
4. Replace `optionalFeatureWidgetFeatureId()` hardcoded widget-key matching with payload `featureId`.
5. Replace hardcoded optional command family maps where possible with extension-announced metadata.
6. Cache only payloads that explicitly request caching.
7. Invalidate cache on feature toggle changes.

## Implementation Phases

### Phase 1 — Payload Infrastructure

Files:

- `pi-package-webui/public/app.js`
- `pi-package-webui/tests/mobile-static.test.mjs`
- `pi-package-webui/README.md`

Tasks:

- Add shared payload constants and validator.
- Add generic widget renderer dispatch.
- Add generic action renderer/handler.
- Keep existing feature-specific renderers temporarily.
- Add static tests proving structured payloads are preferred over feature-specific fallbacks.

Acceptance criteria:

- Existing UI behavior remains unchanged.
- Unknown/invalid payloads fall back to safe generic line rendering or are ignored.
- Feature toggles can hide payloads by `featureId`.

### Phase 2 — Release NPM

Files:

- `pi-extension-release-npm/index.ts`
- `pi-package-webui/public/app.js`
- `pi-package-webui/tests/mobile-static.test.mjs`

Extension changes:

- Emit structured payloads for:
  - live output;
  - footer/phase metadata;
  - saved logs;
  - status.
- Include actions:
  - toggle output;
  - abort;
  - close log.

WebUI changes:

- Render release payloads with generic `log`/`summary` renderers.
- Remove or deprecate `renderReleaseNpmOutputWidget()` and `renderReleaseNpmLogWidget()` after parity.

Acceptance criteria:

- `/release-npm` live output, logs, toggle, and abort work without hardcoded `release-npm:*` widget parsing in WebUI.

### Phase 3 — Release AUR

Files:

- `pi-extension-release-aur/index.ts`
- `pi-package-webui/public/app.js`
- `pi-package-webui/tests/mobile-static.test.mjs`

Extension changes:

- Emit structured payloads for:
  - live output;
  - logs;
  - setup status;
  - publish/create confirmation summaries.
- Include actions:
  - toggle;
  - abort;
  - close log;
  - setup follow-up actions where safe.

WebUI changes:

- Use the same generic renderers from Phase 2.
- Remove release-AUR-specific rendering/parsing once parity is verified.

Acceptance criteria:

- `/release-aur` and `/release-aur-setup` render through generic payloads.
- WebUI has no `release-aur:*` widget-key special cases except temporary migration compatibility.

### Phase 4 — Todo Progress

Files:

- `pi-extension-todo-progress/index.ts`
- `pi-package-webui/public/app.js`

Extension changes:

- Emit structured checklist payload:

```ts
type ChecklistPayload = {
  done: number;
  total: number;
  partial: number;
  items: Array<{ text: string; status: "todo" | "partial" | "done" }>;
  footer?: string;
};
```

WebUI changes:

- Remove TUI text parsing from `parseTodoProgressWidget()`.
- Remove duplicated checklist-line parsing where not needed for message cleanup.
- Render checklist from structured payload.

Acceptance criteria:

- Todo widget remains visually equivalent.
- WebUI no longer parses ANSI/TUI todo widget text lines to infer state.

### Phase 5 — Tools and Skills

Files:

- `pi-extension-tools/index.ts`
- `pi-extension-setup-skills/index.ts`
- `pi-package-webui/webui-rpc-helper.mjs`
- `pi-package-webui/bin/pi-webui.mjs`
- `pi-package-webui/public/app.js`

Extension changes:

- Add browser-safe structured commands or payloads for state and mutation:
  - list resources;
  - enable/disable resources;
  - persist state;
  - report whether reload is required.
- Keep TUI custom UI for native terminal usage.

WebUI changes:

- Replace duplicated helper logic with extension-owned API.
- Remove tools/skills state mutation from `webui-rpc-helper.mjs` once extensions support WebUI mode.
- Render both tools and skills with one generic `resource-toggle` renderer.

Acceptance criteria:

- `/tools` and `/skills` WebUI selectors still work.
- Ownership of resource discovery and persistence is in the owning extensions.
- WebUI only renders and dispatches actions.

### Phase 6 — Guided Git Workflow

Files:

- likely new package: `pi-extension-git-workflow`
- `pi-package-webui/public/app.js`
- `pi-package-webui/bin/pi-webui.mjs`
- `pi-package-webui/public/index.html`
- `pi-package-webui/public/styles.css`

Extension changes:

- Own the workflow state machine:
  - stage;
  - generate message;
  - preview message;
  - commit short/long;
  - push;
  - cancel/error/done.
- Own git shell execution and message-file discovery.
- Emit generic stepper/log/action payloads.

WebUI changes:

- Remove `gitWorkflowsByTab`, `gitWorkflow` state, and guided git workflow UI orchestration.
- Remove `/api/git-workflow/*` server endpoints.
- Render generic stepper/action/log payloads.

Acceptance criteria:

- Guided git workflow remains available only when installed/enabled.
- WebUI has no git workflow business logic or git subprocess endpoints.

### Phase 7 — Theme Bundle

Files:

- `pi-package-webui/bin/pi-webui.mjs`
- `pi-package-webui/public/app.js`
- `pi-package-themes-bundle/package.json`

Changes:

- Keep browser CSS/theme application in WebUI.
- Replace hardcoded `@firstpick/pi-themes-bundle` path probing with generic Pi package theme-resource resolution.
- Preserve user custom background/theme selection.

Acceptance criteria:

- Installed theme packages can contribute themes without WebUI package-specific path logic.
- WebUI remains responsible only for browser-specific theme application.

### Phase 8 — Cleanup and Enforcement

Tasks:

- Remove migrated feature-specific functions from WebUI.
- Remove migrated CSS only after generic renderer CSS covers equivalent visuals.
- Add tests that fail on reintroduced hardcoded widget-key parsing for migrated features.
- Update docs to define extension-owned WebUI payload expectations.

Suggested checks:

```bash
npm --prefix /home/firstpick/npm-packages/pi-package-webui run check
node --experimental-strip-types --check /home/firstpick/npm-packages/pi-extension-release-npm/index.ts
node --experimental-strip-types --check /home/firstpick/npm-packages/pi-extension-release-aur/index.ts
node --experimental-strip-types --check /home/firstpick/npm-packages/pi-extension-todo-progress/index.ts
node --experimental-strip-types --check /home/firstpick/npm-packages/pi-extension-tools/index.ts
node --experimental-strip-types --check /home/firstpick/npm-packages/pi-extension-setup-skills/index.ts
git diff --check
```

## Migration Compatibility

During migration, WebUI can support both old and new payloads:

1. Prefer structured extension payloads.
2. Fall back to existing hardcoded renderers temporarily.
3. Warn in tests/docs that fallback is transitional.
4. Remove fallback once the owning extension emits stable payloads.

## Risks

- Release workflows are high-risk because they involve external publishing and abort/toggle controls.
- Tools/skills changes affect model context and active tool availability.
- Git workflow migration changes subprocess ownership and may affect cwd/session isolation.
- Generic payload schema must remain intentionally small; otherwise WebUI becomes a second plugin framework.

## Done Criteria

- Optional feature business logic lives in its owning package/extension.
- `pi-package-webui` contains generic payload rendering and user toggles only.
- Each optional feature can be enabled/disabled without stale cached UI.
- Feature-specific WebUI code remains only for WebUI-native concerns, not extension behavior.
- Static checks and relevant runtime smoke tests pass.
