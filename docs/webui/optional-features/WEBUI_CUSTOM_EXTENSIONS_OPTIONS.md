# Web UI Custom Extension Implementation Options

## Goal

Let users add custom extensions to the Pi Web UI without forking `@firstpick/pi-package-webui`. The extension surface should let users add browser-visible UI, commands, panels, widgets, renderers, and optional backend actions while preserving the current Pi package/trust model.

## Current architecture snapshot

Relevant current files:

- `pi-package-webui/bin/pi-webui.mjs` starts one Pi RPC process per Web UI tab.
- `buildPiArgsForTab()` starts Pi with `--mode rpc --no-extensions --no-skills --no-prompt-templates --no-themes`, then re-adds curated user/project/package resources and the internal `webui-rpc-helper.mjs` extension.
- `GET /api/events` streams tab/RPC events to the browser over SSE.
- `POST /api/extension-ui-response` sends browser dialog answers back to the Pi RPC child.
- `pi-package-webui/public/app.js` already handles RPC extension UI requests:
  - `notify`
  - `setStatus`
  - `setWidget`
  - `setTitle`
  - `set_editor_text`
  - blocking dialogs: `select`, `confirm`, `input`, `editor`
- Current limitation: extensions can influence the Web UI only through text-ish widgets/status/dialogs or hard-coded optional-feature renderers. There is no general browser plugin registry or custom DOM/component API.

## Rating scale

`User webui extensibility` is rated from `1` to `10`:

- `1`: cosmetic or fixed behavior only.
- `5`: users can add useful commands/widgets, but only inside predefined UI shapes.
- `10`: users can add arbitrary rich UI surfaces, custom renderers, browser actions, and backend integration without forking the Web UI.

## Options summary

| Option | Approach | User webui extensibility | Safety | Implementation effort | Best fit |
|---|---:|---:|---:|---:|---|
| 1 | Extend existing RPC extension UI protocol | 4/10 | High | Low | Fastest useful incremental step |
| 2 | Declarative Web UI contribution manifest | 6/10 | High | Medium | Safe marketplace-style extensions |
| 3 | Trusted browser ESM plugins | 9/10 | Low-Medium | Medium-High | Power-user custom DOM/features |
| 4 | Sandboxed iframe micro-app extensions | 8/10 | Medium-High | High | Rich UI with isolation |
| 5 | Backend Web UI extension hooks/routes | 7/10 | Medium | High | Extensions needing server-side actions/data |
| 6 | Hybrid manifest + sandbox + optional trusted ESM | 10/10 | Medium | Highest | Long-term maximum extensibility |
| 7 | Fork/custom build/user-script approach | 10/10 raw power, 2/10 product fit | Low | Low initial, high ongoing | Escape hatch only |

---

## Option 1 — Extend the existing RPC extension UI protocol

### Idea

Keep using normal Pi extensions and the existing RPC `extension_ui_request` event path, but add more Web UI-aware request methods and richer payload conventions.

Potential new methods:

```json
{
  "type": "extension_ui_request",
  "method": "webui.registerWidget",
  "extensionId": "my-ext",
  "widgetKey": "my-ext.dashboard",
  "title": "My dashboard",
  "kind": "markdown-card",
  "data": { "markdown": "## Status\nAll good" }
}
```

Possible additions:

- Rich typed widgets: markdown, table, progress, action-list, chart-lite.
- Side-panel cards.
- Command palette actions.
- Footer/status chips with metadata.
- Message attachments/custom transcript cards.
- Action callbacks routed through `POST /api/webui-extension-action` to the originating tab/RPC process.

### Implementation outline

1. Add new allowed methods in `public/app.js::handleExtensionUiRequest()`.
2. Add renderers for generic typed payloads instead of hard-coding each optional package.
3. Track extension-owned contributions by `tabId + extensionId + contributionId`.
4. Add one action-response endpoint that sends a special RPC command or hidden slash command to the originating extension.
5. Document a Web UI payload schema for Pi extension authors.

### Pros

- Reuses existing Pi extension discovery, package installation, project trust, RPC child process, SSE, and tab scoping.
- Lowest disruption to current code.
- Good for widgets, commands, dialogs, and status surfaces.
- No arbitrary browser JavaScript from extensions.

### Cons

- Not true arbitrary UI. Users are limited to supported schemas/components.
- Complex interactive components become awkward because all actions must round-trip through RPC.
- Harder to build highly custom layouts, animations, drag/drop, graphs, editors, etc.
- Web UI must keep adding generic component types over time.

### Rating

**4/10** for maximum extensibility; **8/10** as a safe incremental first phase.

---

## Option 2 — Declarative Web UI contribution manifest

### Idea

Let packages declare Web UI contributions in `package.json` or a manifest file. The Web UI discovers these alongside normal Pi package resources and renders them with built-in safe components.

Example `package.json`:

```json
{
  "name": "my-pi-webui-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./index.ts"],
    "webui": ["./webui/manifest.json"]
  }
}
```

Example `webui/manifest.json`:

```json
{
  "id": "my-ext",
  "name": "My Extension",
  "version": "1.0.0",
  "contributes": {
    "commands": [
      { "id": "my-ext.refresh", "title": "Refresh My Data", "endpoint": "rpc:my-ext.refresh" }
    ],
    "sidePanelCards": [
      { "id": "my-ext.card", "title": "My Data", "source": "rpc:my-ext.card" }
    ],
    "widgets": [
      { "id": "my-ext.widget", "placement": "aboveComposer", "source": "event:my-ext.widget" }
    ]
  }
}
```

### Implementation outline

1. Extend Web UI package/resource discovery to collect `pi.webui` manifests from installed global/project packages and local paths.
2. Serve `GET /api/webui-extensions` with normalized, trusted manifests.
3. Add a browser-side contribution registry in `public/app.js`.
4. Render declarative contributions in known slots:
   - command palette
   - side panel
   - widget area
   - footer/status chips
   - composer actions
   - transcript cards
5. Route manifest actions to existing Pi mechanisms: slash commands, RPC commands, tools, or a helper extension.
6. Validate manifests with a strict schema and ignore unknown/unsafe fields.

### Pros

- Much safer than arbitrary JS.
- Easy to review, test, and document.
- Works well with Pi packages, npm/git installs, and project-local packages.
- Great for a public extension ecosystem.
- Stable across Web UI updates.

### Cons

- Limited to predefined component/action types.
- Extension authors cannot build fully custom UI behavior.
- The Web UI team must design and maintain enough generic components to cover common needs.
- Advanced extensions may quickly outgrow the declarative model.

### Rating

**6/10** for maximum extensibility; **9/10** for safe, maintainable user extension support.

---

## Option 3 — Trusted browser ESM plugins

### Idea

Allow packages to ship browser-side JavaScript modules loaded by the Web UI. Each module exports an `activate(webui)` function and receives a constrained Web UI SDK.

Example manifest:

```json
{
  "id": "my-rich-webui-plugin",
  "name": "My Rich Plugin",
  "entry": "./dist/plugin.js",
  "style": "./dist/plugin.css",
  "permissions": ["state:read", "commands:register", "events:subscribe", "rpc:send"]
}
```

Example plugin:

```js
export default function activate(webui) {
  webui.commands.register({
    id: "my-plugin.open",
    title: "Open My Plugin",
    run: () => webui.panels.open("my-plugin.main")
  });

  webui.panels.register({
    id: "my-plugin.main",
    title: "My Plugin",
    render(root, api) {
      root.innerHTML = `<button>Refresh</button><pre></pre>`;
      root.querySelector("button").onclick = async () => {
        const state = await api.pi.getState();
        root.querySelector("pre").textContent = JSON.stringify(state, null, 2);
      };
    }
  });
}
```

### Web UI SDK surface

Possible first SDK:

```ts
interface WebuiPluginApi {
  version: string;
  extensionId: string;
  events: { on(type: string, handler: Function): () => void };
  commands: { register(command: WebuiCommand): Disposable };
  panels: { register(panel: WebuiPanel): Disposable; open(id: string): void };
  widgets: { register(widget: WebuiWidget): Disposable };
  notifications: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  pi: {
    getState(): Promise<any>;
    getMessages(opts?: { since?: number }): Promise<any>;
    prompt(message: string): Promise<any>;
    callExtension(action: string, payload?: any): Promise<any>;
  };
}
```

### Implementation outline

1. Add manifest discovery for Web UI plugin entries.
2. Add static asset serving under a safe prefix such as `/webui-extensions/:id/*`.
3. Add CSP rules that allow only local plugin assets.
4. Load plugins with dynamic `import()` after user/project trust is resolved.
5. Provide a stable `window.piWebuiPluginHost` or explicit `activate(api)` SDK.
6. Add permissions/warnings in the side panel: installed, enabled, disabled, source path, package name.
7. Add plugin lifecycle: activate, deactivate, reload on `/reload`, dispose handlers.

### Pros

- Very high user extensibility.
- Users can create real custom browser UX: panels, modals, graphs, buttons, drag/drop, custom transcript renderers.
- Familiar web development model.
- Can evolve independently of Pi's terminal TUI component system.

### Cons

- Browser plugins can read conversation content and send network requests unless constrained by CSP and permissions.
- DOM/CSS conflicts are possible unless style scoping is enforced.
- Requires a stable SDK contract and compatibility policy.
- Bugs in plugin JS can break the Web UI unless isolated carefully.
- Review/trust UX becomes important.

### Rating

**9/10** for maximum extensibility.

---

## Option 4 — Sandboxed iframe micro-app extensions

### Idea

Extensions ship a mini web app that runs inside a sandboxed iframe. The iframe communicates with the Web UI through `postMessage` and a narrow capability API.

Example manifest:

```json
{
  "id": "my-dashboard",
  "name": "My Dashboard",
  "iframe": "./dist/index.html",
  "slots": [{ "type": "sidePanel", "id": "my-dashboard.panel", "title": "Dashboard" }],
  "permissions": ["state:read", "messages:read", "extension:call"]
}
```

Message protocol sketch:

```json
{ "type": "webui.ready", "pluginId": "my-dashboard" }
{ "type": "webui.request", "id": "1", "method": "state.get" }
{ "type": "webui.response", "id": "1", "ok": true, "data": { } }
{ "type": "webui.event", "event": "message_update", "data": { } }
```

### Implementation outline

1. Serve each plugin's iframe assets under `/webui-extensions/:id/`.
2. Render iframe slots in side panel, modal, widget area, or custom tab.
3. Use `<iframe sandbox="allow-scripts">` by default; add capabilities only when needed.
4. Implement a request/response `postMessage` bridge with per-plugin permission checks.
5. Support plugin sizing, theme tokens, and event subscriptions.
6. Add dev tooling for local iframe reload.

### Pros

- Rich UI without direct access to the parent DOM.
- Better crash/style isolation than trusted ESM plugins.
- Clear security boundary and easier permission checks.
- Great for dashboards, visualizers, mini-apps, and long-lived panels.

### Cons

- Less seamless integration with parent UI.
- More protocol work: sizing, focus, keyboard shortcuts, theme sync, events, permissions.
- Iframes can still be dangerous if granted broad capabilities or external network access.
- Harder to reuse parent components directly.

### Rating

**8/10** for maximum extensibility; better safety than trusted ESM.

---

## Option 5 — Backend Web UI extension hooks/routes

### Idea

Let Pi packages register Web UI backend handlers in addition to normal Pi extensions. These handlers run in the Web UI server process and can expose package-specific endpoints, data providers, or action handlers.

Example manifest:

```json
{
  "id": "my-backend-ext",
  "serverEntry": "./webui/server.mjs",
  "permissions": ["routes:register", "tabs:read", "rpc:send"]
}
```

Example server module:

```js
export default function activate(serverApi) {
  serverApi.routes.get("/data", async ({ tab }) => {
    return { cwd: tab.cwd, time: new Date().toISOString() };
  });
}
```

### Implementation outline

1. Add a server-side plugin loader in `bin/pi-webui.mjs`.
2. Expose a very small server SDK: route registration, tab metadata, safe RPC send, cleanup hooks.
3. Namespace every route under `/api/webui-extensions/:extensionId/*`.
4. Enforce localhost/remote-auth and route permissions.
5. Add lifecycle hooks for tab create/close/reload and server shutdown.
6. Load only from trusted package sources and show warnings because this code runs with Web UI process permissions.

### Pros

- Enables real backend integrations: local file watchers, caching, long-running services, data aggregation, third-party APIs.
- Avoids abusing slash commands for every browser action.
- Works well paired with declarative or iframe UI.

### Cons

- Server plugins execute arbitrary Node.js code in the Web UI process.
- A bad plugin can crash or compromise the whole Web UI server.
- Requires careful namespacing, permissions, lifecycle cleanup, and error isolation.
- Harder to keep compatibility stable.

### Rating

**7/10** alone; **10/10** when paired with a rich frontend extension model.

---

## Option 6 — Hybrid recommended long-term architecture

### Idea

Implement a layered system so different users can choose different power/safety levels:

1. **Declarative manifests** for common safe contributions.
2. **Sandboxed iframe apps** for rich custom UI.
3. **Optional trusted ESM plugins** for deep same-page integration.
4. **Optional backend hooks** for server-side integrations.
5. Existing **RPC extension UI** remains the compatibility baseline.

### Proposed package shape

```json
{
  "name": "@scope/pi-webui-awesome",
  "keywords": ["pi-package", "pi-webui-extension"],
  "pi": {
    "extensions": ["./extension.ts"],
    "webui": ["./webui/manifest.json"]
  }
}
```

```json
{
  "id": "awesome",
  "name": "Awesome Web UI Extension",
  "version": "1.0.0",
  "contributes": {
    "commands": [{ "id": "awesome.open", "title": "Open Awesome" }],
    "panels": [{ "id": "awesome.panel", "title": "Awesome", "kind": "iframe", "src": "./dist/index.html" }]
  },
  "browser": {
    "entry": "./dist/plugin.js",
    "mode": "trusted-esm",
    "optional": true
  },
  "server": {
    "entry": "./server.mjs",
    "optional": true
  },
  "permissions": [
    "state:read",
    "messages:read",
    "prompt:send",
    "extension:call"
  ]
}
```

### Suggested implementation phases

#### Phase 1: Generalize current extension UI rendering

- Add generic typed widget/card payloads on top of `extension_ui_request`.
- Add extension-owned registry maps in `public/app.js`.
- Add docs and examples for Pi extensions that drive Web UI widgets without custom browser JS.

#### Phase 2: Add `pi.webui` manifest discovery

- Discover manifests from installed user/project Pi packages.
- Add `GET /api/webui-extensions`.
- Add side-panel management UI: enabled, disabled, source, permissions, trust warning.
- Render declarative commands/cards/widgets.

#### Phase 3: Add sandboxed iframe slots

- Serve package assets under a namespaced local URL.
- Add `postMessage` bridge with permission checks.
- Support theme tokens and state/event subscriptions.

#### Phase 4: Add optional trusted ESM plugins

- Load only when explicitly enabled by the user.
- Require visible warning: “This plugin can read/control the Web UI page.”
- Add dispose/reload/error boundaries.

#### Phase 5: Add backend hooks only if needed

- Start with RPC/helper-extension action routing first.
- Add server hooks only for use cases that cannot be handled through existing Pi extensions/tools/commands.

### Pros

- Provides both safe defaults and maximum power.
- Lets the ecosystem start simple and grow without redesigning everything.
- Preserves current Pi package model.
- Can keep remote/LAN users safer by disabling trusted ESM/server plugins unless explicitly enabled.
- Best chance of avoiding a fork-heavy ecosystem.

### Cons

- Highest design and maintenance cost.
- Requires a real Web UI extension SDK, schema versioning, compatibility promises, and docs.
- Needs strong error isolation and plugin management UI.
- Security model must be explicit and visible.

### Rating

**10/10** for maximum user extensibility and the recommended long-term design.

---

## Option 7 — Fork/custom build/user scripts

### Idea

Tell users to fork `pi-package-webui`, patch `public/app.js`, inject scripts/styles, or run browser user scripts.

### Pros

- Absolute power.
- Almost no platform work required initially.
- Useful for experiments before stabilizing extension APIs.

### Cons

- Not maintainable for normal users.
- Breaks on updates.
- No package ecosystem.
- No trust/permissions story.
- Hard to support.

### Rating

**10/10 raw capability**, but **2/10 as a product extension strategy**.

---

## Recommended path

For this codebase, the best path is:

1. **Short term:** implement Option 1 plus a minimal manifest subset from Option 2.
   - This leverages existing RPC/SSE/dialog infrastructure.
   - It gives extension authors useful Web UI capabilities quickly.
2. **Medium term:** implement sandboxed iframe plugins from Option 4.
   - This unlocks rich user UI while keeping isolation.
3. **Long term:** add trusted ESM and backend hooks only behind explicit enablement.
   - This reaches maximum extensibility for advanced users without making unsafe behavior the default.

## Minimum viable implementation proposal

A good first milestone would be:

- Add `pi.webui` manifest discovery.
- Add `GET /api/webui-extensions`.
- Add declarative contribution slots:
  - command palette actions
  - side-panel cards
  - widget-area cards
  - footer/status chips
- Add generic widget schemas:
  - markdown
  - key/value list
  - table
  - progress
  - action buttons
- Route button actions to the active tab through one helper action endpoint.
- Add docs and an example package.

This would not yet support arbitrary custom JavaScript, but it would create the registry, permission, and lifecycle foundations needed for iframe/ESM plugins later.

## Security notes

- Existing Pi extensions and packages already run with local user permissions. Web UI extensions add a second risk: browser-side code can read chat/session data and potentially send it elsewhere.
- Project-local Web UI extensions should only load after project trust, matching `.pi/extensions` behavior.
- Remote/LAN access should remain conservative:
  - localhost can manage/install/enable extensions;
  - remote clients can use enabled extensions only after Remote PIN auth;
  - enabling trusted browser/server plugins should be localhost-only.
- Use strict schemas for manifests and RPC UI payloads.
- Namespace every extension contribution by package/source/id.
- Prefer sandboxed iframes for third-party rich UI.
- Keep trusted ESM/server hooks disabled by default or require explicit per-package approval.

## Suggested test coverage

- Unit tests for manifest validation and path normalization.
- Unit tests for contribution registry add/update/remove behavior.
- Browser tests for command palette/side-panel/widget rendering from a fixture manifest.
- RPC integration test where a fake extension emits typed widget/status/action requests.
- Security tests for path traversal in plugin asset serving.
- Reload tests: `/reload` should dispose old contributions and load updated ones.
- Remote-auth tests: extension management endpoints should be localhost-only where appropriate.
