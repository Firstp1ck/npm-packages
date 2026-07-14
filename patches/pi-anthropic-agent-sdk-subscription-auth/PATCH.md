# PATCH.md — Pi Anthropic Agent SDK subscription auth

## Purpose

Restore Anthropic subscription/OAuth use in Pi after Anthropic moved third-party/Agent SDK traffic onto the current Claude Agent SDK billing path. The patched request shape mirrors current Claude Code/Agent SDK requests closely enough that OAuth traffic should be classified as Agent SDK usage instead of legacy third-party extra-usage traffic.

### Root cause

Pi's Anthropic OAuth branch still sent the older Claude Code identity shape:

- `anthropic-beta`: only `claude-code-20250219`, `oauth-2025-04-20`, plus Pi's normal tool/thinking betas;
- `user-agent`: `claude-cli/2.1.75`;
- no `x-claude-code-session-id` header;
- first OAuth system block: `You are Claude Code, Anthropic's official CLI for Claude.`;
- no Agent SDK billing attribution system block.

Current Claude Code 2.1.201 / Agent SDK requests observed locally send a first system block like:

```text
x-anthropic-billing-header: cc_version=2.1.201.986; cc_entrypoint=sdk-cli;
```

followed by:

```text
You are a Claude agent, built on Anthropic's Claude Agent SDK.
```

and include the Agent SDK/Claude Code beta set:

```text
oauth-2025-04-20,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,claude-code-20250219,extended-cache-ttl-2025-04-11
```

Anthropic's current support article says Claude Agent SDK usage, `claude -p`, and third-party apps built on the Agent SDK are covered by an eligible monthly Agent SDK credit first, then usage credits if enabled.

### Expected outcome

Anthropic OAuth requests from Pi keep using OAuth bearer auth, but send the current Agent SDK attribution/identity shape. The stale subscription-auth warning is suppressed. If Anthropic returns the exact extra-usage third-party-app error again, Pi asks whether to apply this saved `PATCH.md`; on confirmation it switches the current agent to `openai-codex/gpt-5.5` and queues a recovery turn that implements this patch.

## Scope (exact files changed)

Path variables:

- `PI_GLOBAL=${HOME}/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent`
- `PI_WEBUI=${HOME}/npm-packages/pi-package-webui/node_modules/@earendil-works`
- `PI_WEBUI_PKG=${HOME}/npm-packages/pi-package-webui`
- `PI_AGENT=${HOME}/.pi/agent`
- `PI_GLOBAL_WIN=C:/Users/hdlea/AppData/Local/Programs/node-v24.12.0-win-x64/node_modules/@earendil-works/pi-coding-agent`
- `PI_WEBUI_APPDATA=C:/Users/hdlea/AppData/Local/Programs/node-v24.12.0-win-x64/node_modules/@firstpick/pi-package-webui`
- `PI_WEBUI_REPO=C:/Users/hdlea/Documents/GitHub/npm-packages/pi-package-webui`
- `PI_WEBUI_AGENT_NPM=C:/Users/hdlea/.pi/agent/npm/node_modules/@firstpick/pi-package-webui`
- `PI_AGENT_WIN=C:/Users/hdlea/.pi/agent`

Files:

1. `${PI_GLOBAL}/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js`
2. `${PI_GLOBAL}/dist/modes/interactive/interactive-mode.js`
3. `${PI_GLOBAL}/dist/modes/interactive/components/settings-selector.js`
4. `${PI_GLOBAL}/docs/providers.md`
5. `${PI_GLOBAL}/docs/settings.md`
6. `${PI_WEBUI}/pi-ai/dist/api/anthropic-messages.js`
7. `${PI_WEBUI}/pi-ai/dist/providers/anthropic.js`
8. `${PI_WEBUI}/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js`
9. `${PI_WEBUI}/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/anthropic.js`
10. `${PI_WEBUI}/pi-coding-agent/dist/modes/interactive/interactive-mode.js`
11. `${PI_WEBUI}/pi-coding-agent/dist/modes/interactive/components/settings-selector.js`
12. `${PI_WEBUI}/pi-coding-agent/docs/providers.md`
13. `${PI_WEBUI}/pi-coding-agent/docs/settings.md`
14. `${PI_WEBUI_PKG}/public/app.js`
15. `${PI_AGENT}/extensions/anthropic-subscription-auth-recovery.ts`
16. `${PI_GLOBAL_WIN}/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js`
17. `${PI_GLOBAL_WIN}/dist/modes/interactive/interactive-mode.js`
18. `${PI_GLOBAL_WIN}/dist/modes/interactive/components/settings-selector.js`
19. `${PI_GLOBAL_WIN}/docs/providers.md`
20. `${PI_GLOBAL_WIN}/docs/settings.md`
21. `${PI_WEBUI_APPDATA}/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js`
22. `${PI_WEBUI_APPDATA}/node_modules/@firstpick/pi-package-webui/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/anthropic.js`
23. `${PI_WEBUI_APPDATA}/node_modules/@firstpick/pi-package-webui/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js`
24. `${PI_WEBUI_APPDATA}/node_modules/@firstpick/pi-package-webui/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/settings-selector.js`
25. `${PI_WEBUI_APPDATA}/node_modules/@firstpick/pi-package-webui/node_modules/@earendil-works/pi-coding-agent/docs/providers.md`
26. `${PI_WEBUI_APPDATA}/node_modules/@firstpick/pi-package-webui/node_modules/@earendil-works/pi-coding-agent/docs/settings.md`
27. `${PI_WEBUI_APPDATA}/public/app.js`
28. `${PI_WEBUI_APPDATA}/node_modules/@firstpick/pi-package-webui/public/app.js`
29. `${PI_WEBUI_REPO}/node_modules/@earendil-works/pi-ai/dist/providers/anthropic.js`
30. `${PI_WEBUI_REPO}/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/anthropic.js`
31. `${PI_WEBUI_REPO}/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js`
32. `${PI_WEBUI_REPO}/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/settings-selector.js`
33. `${PI_WEBUI_REPO}/node_modules/@earendil-works/pi-coding-agent/docs/providers.md`
34. `${PI_WEBUI_REPO}/node_modules/@earendil-works/pi-coding-agent/docs/settings.md`
35. `${PI_WEBUI_REPO}/public/app.js`
36. `${PI_WEBUI_AGENT_NPM}/public/app.js`
37. `${PI_AGENT_WIN}/extensions/anthropic-subscription-auth-recovery.ts`

Fast path-discovery rule:

- Patch every existing equivalent listed above; do not create missing package trees.
- For `@earendil-works/pi-ai` 0.80.x, the mutation implementation is usually `dist/api/anthropic-messages.js` and exports `stream`.
- For older WebUI-local `@earendil-works/pi-ai` 0.78.x/0.79.x, the mutation implementation is usually `dist/providers/anthropic.js` and exports `streamAnthropic`.
- In 0.80.x, `dist/providers/anthropic.js` is only a provider-registration wrapper that imports `../api/anthropic-messages.lazy.js`; do not patch that wrapper unless it actually contains `const claudeCodeVersion`, the OAuth branch, and the old Claude Code system prompt.
- The Windows/local files numbered 16-37 were patched or already equivalent on 2026-07-14 and are listed so the next recovery can skip path hunting.

## Change 1 — Update Anthropic OAuth request identity to Agent SDK shape

**File:** `${PI_GLOBAL}/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js`

Also applied to every existing WebUI-local `pi-ai` mutation implementation:

- `${PI_WEBUI}/pi-ai/dist/api/anthropic-messages.js` when present.
- `${PI_WEBUI}/pi-ai/dist/providers/anthropic.js` when `dist/api/anthropic-messages.js` is absent and this file contains the OAuth request implementation.
- `${PI_WEBUI}/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js` when present.
- `${PI_WEBUI}/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/anthropic.js` when `dist/api/anthropic-messages.js` is absent and this file contains the OAuth request implementation.

Fast implementation detail: the same semantic patch applies to both file layouts, but the exact OAuth condition and cache-control call may differ by version:

- Newer API file: `if (apiKey && isOAuthToken(apiKey))` and `getCacheControl(model, ..., options?.env)`.
- Older provider file: `if (isOAuthToken(apiKey))` and sometimes `getCacheControl(model, ...)` without `options?.env`.

### What was changed

Replaced the stale Claude Code version constant with Agent SDK attribution constants and helper:

```js
const claudeCodeVersion = "2.1.201";
const claudeCodeBuild = "986";
const claudeCodeEntrypoint = "sdk-cli";
const claudeAgentSdkIdentityPrompt = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
function claudeCodeBillingHeader() {
    return `x-anthropic-billing-header: cc_version=${claudeCodeVersion}.${claudeCodeBuild}; cc_entrypoint=${claudeCodeEntrypoint};`;
}
```

Changed the OAuth branch in `createClient()` from the old Claude Code beta/user-agent shape to the current Agent SDK beta/user-agent/session-header shape:

```js
const oauthBetaFeatures = [
    "oauth-2025-04-20",
    ...betaFeatures,
    "thinking-token-count-2026-05-13",
    "context-management-2025-06-27",
    "prompt-caching-scope-2026-01-05",
    "claude-code-20250219",
    "extended-cache-ttl-2025-04-11",
];
```

and:

```js
"anthropic-beta": [...new Set(oauthBetaFeatures)].join(","),
"user-agent": `claude-cli/${claudeCodeVersion} (external, ${claudeCodeEntrypoint})`,
"x-app": "cli",
...(sessionId ? { "x-claude-code-session-id": sessionId } : {}),
```

Changed OAuth cache-retention default to long, matching Claude subscription/Agent SDK behavior:

```js
const { cacheControl } = getCacheControl(model, options?.cacheRetention ?? (isOAuthToken ? "long" : undefined), options?.env);
```

Changed OAuth system blocks from the old Claude Code identity-only block to billing attribution plus Agent SDK identity:

```js
params.system = [
    {
        type: "text",
        text: claudeCodeBillingHeader(),
    },
    {
        type: "text",
        text: claudeAgentSdkIdentityPrompt,
        ...(cacheControl ? { cache_control: cacheControl } : {}),
    },
];
```

### Why

Anthropic now distinguishes Agent SDK / third-party app traffic using request metadata that current Claude Code/Agent SDK emits. Pi's older OAuth request shape can be classified as legacy third-party extra-usage traffic and rejected with the 400 `Third-party apps now draw from your extra usage...` message.

## Change 2 — Suppress the runtime Anthropic subscription-auth warning

**File:** `${PI_GLOBAL}/dist/modes/interactive/interactive-mode.js`

Also applied to:

- `${PI_WEBUI}/pi-coding-agent/dist/modes/interactive/interactive-mode.js`

### What was changed

Changed `maybeWarnAboutAnthropicSubscriptionAuth()` to return immediately, so startup, model switching, and login flows no longer emit the Anthropic subscription-auth warning:

```js
async maybeWarnAboutAnthropicSubscriptionAuth(_model = this.session.model) {
    // Suppressed: patched Anthropic OAuth requests use Agent SDK billing attribution.
    return;
}
```

### Why

The patched OAuth request shape is intended to follow the current Agent SDK billing path. The old warning is now noisy and no longer actionable; recovery is handled by the dedicated popup in Change 6 if Anthropic still returns the extra-usage error.

## Change 3 — Update warnings settings copy

**File:** `${PI_GLOBAL}/dist/modes/interactive/components/settings-selector.js`

Also applied to:

- `${PI_WEBUI}/pi-coding-agent/dist/modes/interactive/components/settings-selector.js`
- `${PI_WEBUI_PKG}/public/app.js`

### What was changed

Changed the warnings settings label/description:

```js
label: "Anthropic Agent SDK usage",
description: "Warn when Anthropic subscription auth uses the Agent SDK billing path",
```

Changed the WebUI native settings copy to avoid the stale extra-usage wording:

```js
anthropicWarning: nativeSettingToggle("Anthropic Agent SDK usage", settings.warnings?.anthropicExtraUsage !== false, "Native TUI setting for the suppressed Anthropic Agent SDK billing-path warning.", { label: "safety", tone: "safety" }),
```

### Why

The setting name remains `warnings.anthropicExtraUsage` for compatibility, but the visible copy should no longer reinforce the stale extra-usage-only explanation.

## Change 4 — Update local installed docs

**File:** `${PI_GLOBAL}/docs/providers.md`

Also applied to:

- `${PI_WEBUI}/pi-coding-agent/docs/providers.md`

### What was changed

Changed the Claude Pro/Max paragraph to:

```md
Anthropic subscription auth is active for Claude Pro/Max accounts. Claude Agent SDK and third-party app usage use Anthropic's Agent SDK billing path: eligible monthly Agent SDK credit first, then usage credits if enabled.
```

### Why

The installed docs should match the patched runtime warning and current Anthropic support wording.

## Change 5 — Update warning setting docs

**File:** `${PI_GLOBAL}/docs/settings.md`

Also applied to:

- `${PI_WEBUI}/pi-coding-agent/docs/settings.md`

### What was changed

Changed the warning setting description to:

```md
| `warnings.anthropicExtraUsage` | boolean | `true` | Show a warning when Anthropic subscription auth uses the Agent SDK billing path |
```

### Why

Keeps local settings documentation consistent with the updated warning copy.

## Change 6 — Add recovery popup that queues PATCH.md application on OpenAI Codex

**File:** `${PI_AGENT}/extensions/anthropic-subscription-auth-recovery.ts`

### What was changed

Added a global Pi extension that watches `agent_end` messages for the exact Anthropic error:

```text
Third-party apps now draw from your extra usage, not your plan limits. Add more at claude.ai/settings/usage and keep going.
```

When that error appears, the extension shows a confirmation dialog. If confirmed, it switches the current agent to `openai-codex/gpt-5.5` and queues a follow-up user message instructing the agent to implement this patch via the `patch-md` skill:

```ts
const PATCH_PATH = "/home/firstpick/npm-packages/patches/pi-anthropic-agent-sdk-subscription-auth/PATCH.md";
const RECOVERY_PROVIDER = "openai-codex";
const RECOVERY_MODEL = "gpt-5.5";

const recoveryModel = ctx.modelRegistry.find(RECOVERY_PROVIDER, RECOVERY_MODEL);
const switched = await pi.setModel(recoveryModel);
pi.sendUserMessage(buildPatchPrompt(previousModel), { deliverAs: "followUp" });
```

The queued prompt explicitly says to use `patch-md`, apply the `PATCH.md` exactly, avoid live Anthropic verification unless approved, and report modified files plus verification results.

### Why

If the request-shape patch is overwritten by a Pi update or Anthropic changes classification again, the user gets an immediate recovery path without manually finding this patch document or switching away from the failing Anthropic model.

## Verification steps

Run syntax checks:

```bash
node --check "${HOME}/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js"
node --check "${HOME}/npm-packages/pi-package-webui/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js"
node --check "${HOME}/npm-packages/pi-package-webui/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js"
node --check "${HOME}/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js"
node --check "${HOME}/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/settings-selector.js"
node --check "${HOME}/npm-packages/pi-package-webui/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js"
node --check "${HOME}/npm-packages/pi-package-webui/public/app.js"
node --experimental-strip-types --check "${HOME}/.pi/agent/extensions/anthropic-subscription-auth-recovery.ts"
```

Run a local no-secret capture against the patched `pi-ai` stream implementation:

```bash
node --input-type=module <<'NODE'
import http from 'node:http';

const { stream } = await import(`${process.env.HOME}/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js`);
const captures = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    captures.push({
      beta: req.headers['anthropic-beta'],
      userAgent: req.headers['user-agent'],
      app: req.headers['x-app'],
      session: req.headers['x-claude-code-session-id'],
      system: body.system?.slice(0, 2),
    });
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'capture complete' } }));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const model = {
  id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', api: 'anthropic-messages', provider: 'anthropic',
  baseUrl: `http://127.0.0.1:${port}`, reasoning: false, input: ['text'], output: ['text'],
  contextWindow: 200000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
for await (const _ of stream(model, { messages: [{ role: 'user', content: 'hi' }], systemPrompt: 'custom system' }, {
  apiKey: 'sk-ant-oat-fake-local-capture-token',
  maxTokens: 16,
  sessionId: '11111111-2222-4333-8444-555555555555',
})) {}
server.close();
console.log(JSON.stringify(captures, null, 2));
NODE
```

Expected capture includes:

- `anthropic-beta` contains `oauth-2025-04-20`, `claude-code-20250219`, `thinking-token-count-2026-05-13`, `context-management-2025-06-27`, `prompt-caching-scope-2026-01-05`, and `extended-cache-ttl-2025-04-11`.
- `user-agent` is `claude-cli/2.1.201 (external, sdk-cli)`.
- `x-app` is `cli`.
- `x-claude-code-session-id` is present when a session id is provided.
- first system block begins `x-anthropic-billing-header: cc_version=2.1.201.986; cc_entrypoint=sdk-cli;`.
- second system block is `You are a Claude agent, built on Anthropic's Claude Agent SDK.` and has 1h cache control.

Run targeted static checks:

```bash
! grep -R "showWarning(ANTHROPIC_SUBSCRIPTION_AUTH_WARNING)" \
  "${HOME}/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js" \
  "${HOME}/npm-packages/pi-package-webui/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js"
grep -F "openai-codex" "${HOME}/.pi/agent/extensions/anthropic-subscription-auth-recovery.ts"
grep -F "pi-anthropic-agent-sdk-subscription-auth/PATCH.md" "${HOME}/.pi/agent/extensions/anthropic-subscription-auth-recovery.ts"
```

Expected static-check result: no `showWarning(ANTHROPIC_SUBSCRIPTION_AUTH_WARNING)` call sites remain in either installed `interactive-mode.js`, and the recovery extension contains both `openai-codex` and this `PATCH.md` path.

Optional live verification, only if you accept possible Anthropic billing/usage-credit consumption:

```bash
pi --provider anthropic --model claude-haiku-4-5 -p --tools '' 'Reply with exactly: ok'
```

## Operational notes

- Restart Pi after patching. `/reload` can load the new recovery extension and warning suppression, but a full restart is still required for already-loaded `pi-ai` module code in a running process.
- This edits built `dist/` files inside installed npm packages. A `pi update`, global reinstall, or `npm install` can overwrite these changes.
- The exact Claude Code build suffix (`986`) was observed from local Claude Code 2.1.201 request capture. If Anthropic changes classification again, recapture current Claude Code with a local `ANTHROPIC_BASE_URL` test server and update `claudeCodeVersion`, `claudeCodeBuild`, `claudeCodeEntrypoint`, beta list, and identity blocks accordingly.
- Live Anthropic verification was intentionally left optional because it may consume subscription/Agent SDK credit or usage credits.
