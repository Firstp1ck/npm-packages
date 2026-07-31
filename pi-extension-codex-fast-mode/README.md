# @firstpick/pi-extension-codex-fast-mode

Session-scoped Fast mode for subscription-backed Codex requests in [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).

## Install

```bash
pi install npm:@firstpick/pi-extension-codex-fast-mode
```

Reload Pi after installation so it discovers `index.ts` from the package manifest.

## Commands

- `/fast-mode` toggles Fast mode.
- `/fast-mode on` enables it.
- `/fast-mode off` disables it.
- `/fast-mode status` reports the current session-branch setting.

Fast mode defaults to off. Changes are persisted as Pi custom session entries, so a resumed or navigated session branch reconstructs its own latest setting. The command rejects enable, disable, and toggle while the session is busy; `status` remains available.

## Provider and credit limits

When Fast mode is enabled, the extension shallow-copies only a plain serialized payload for a model whose provider is exactly `openai-codex` and API is exactly `openai-codex-responses`, then writes `service_tier: "priority"`. It overwrites an existing `service_tier` while preserving other top-level fields. Every other provider, API, disabled state, or malformed payload is unchanged.

Fast mode is request intent, not a claim that the upstream service accepted a tier. The extension does not change authentication, select a model, maintain a model allowlist, inspect credentials, or make network calls. Upstream account and model eligibility remains authoritative.

Enabling Fast mode is consent to the documented subscription-credit behavior: currently about 1.5× speed, with 2× credits for GPT-5.4 and 2.5× for GPT-5.5/5.6. These provider terms can change; verify current OpenAI/Codex documentation before relying on them.

In TUI and RPC mode, the extension publishes the concise status key `codex-fast-mode` with value `on` or `off` for compatible consumers such as a WebUI integration.

## Development

```bash
npm test
npm run check
npm run smoke
npm pack --dry-run --json
```

The deterministic tests cover command grammar and completions, branch-state restoration, busy mutation guards, status publication, exact provider/API isolation, malformed payload passthrough, non-mutation, and tier overwrite. No authenticated or paid model request is made.

## License

MIT
