# @firstpick/pi-extension-anthropic-auth-recovery

Offers an explicit, plan-only recovery flow when Pi encounters a narrowly classified Anthropic compatibility error. It helps an operator inspect an external compatibility patch with an authenticated non-Anthropic recovery model; it never applies that patch automatically.

## Install

```bash
pi install npm:@firstpick/pi-extension-anthropic-auth-recovery
```

Pi discovers `anthropic-subscription-auth-recovery.ts` through the package manifest.

## Behavior

The extension:

- recognizes only the supported Anthropic error classifiers and ignores errors from other providers;
- deduplicates a classified error within the Pi session;
- selects an authenticated, non-Anthropic recovery model, optionally honoring `PI_ANTHROPIC_RECOVERY_MODEL=provider/model` when that model is available;
- offers a confirmation prompt before opening a recovery flow;
- asks the recovery session to run `patchctl status` and `patchctl plan` only;
- starts Pi with `--no-approve` and explicitly forbids `apply`, rollback, package installation, and live provider verification;
- exposes `/anthropic-auth-status` for a read-only compatibility status check; and
- shows status at session start when the external patch resources can be discovered.

In a native TUI, the confirmed flow opens a separate terminal when a supported terminal launcher is available. In RPC mode, it posts only to an explicitly configured, authenticated recovery endpoint; otherwise it shows a manual local command.

## Prerequisites and discovery

This package does not bundle a compatibility patch or the `patchctl` runner. Install and maintain those resources separately. Discovery uses the first readable candidate in this order:

1. Explicit `PI_ANTHROPIC_PATCH_PATH` and `PI_PATCHCTL_PATH` values.
2. Standard agent paths: the configured agent directory's `patches/pi-anthropic-provider-dist-compat/PATCH.md` and `skills/patch-md/scripts/patchctl.mjs`.
3. A current-working-directory or package-module ancestor containing `patches/pi-anthropic-provider-dist-compat/PATCH.md` and `pi-skill-patch-md/skills/patch-md/scripts/patchctl.mjs`.

Set `PI_AGENT_DIR` or `PI_CODING_AGENT_DIR` to select an agent directory; otherwise Pi's usual `~/.pi/agent` location is used. Explicit paths are the most reliable choice for independently installed packages.

## Optional RPC/WebUI recovery

Automatic RPC recovery is disabled unless **both** environment variables are configured:

```text
PI_WEBUI_RECOVERY_URL=https://trusted-host.example/recovery
PI_WEBUI_RECOVERY_TOKEN=secret-bearer-token
```

The endpoint must use HTTPS, except loopback HTTP (`localhost`, `127.0.0.0/8`, or `::1`). Requests use a bearer token, include `mode: "plan-only"`, and have a five-second timeout. A missing token, missing URL, invalid URL, network failure, or non-success response safely falls back to a manual command; the extension never probes local endpoints implicitly.

## Security and privacy boundaries

- Recovery starts only after a classified Anthropic error, an available authenticated non-Anthropic model, and interactive confirmation.
- The automatic prompt is plan-only and starts Pi with `--no-approve`; applying a returned plan requires separate, explicit operator approval.
- Temporary prompt files use mode `0600` and are scheduled for cleanup.
- The extension does not persist provider errors, tokens, prompts, or model credentials. A configured RPC endpoint receives the plan-only prompt, working directory, and selected recovery model; configure it only when that disclosure is acceptable.
- No network request is made unless the explicit URL-and-token pair is present.

## Compatibility and limitations

This package requires a Pi extension runtime with session, command, and agent-end hooks, plus a separately maintained compatibility patch and `patchctl` runner. It supports native TUI and RPC recovery paths; other Pi modes report that no recovery UI is available. Recovery model selection is limited to models already configured with authentication, and terminal auto-open depends on a supported local launcher.

The classifier intentionally covers only the documented subscription/extra-usage compatibility messages. It is not a general Anthropic error repair system and does not guarantee that a generated plan is safe to apply.

## Development

```bash
npm test
npm run check
npm run smoke
npm pack --dry-run --json
```

Tests run only against temporary directories and mocked fetch calls. They cover provider-scoped error classification, authenticated model selection, plan-only arguments, prompt-file permissions, portable discovery, and secure WebUI rules.

## License

MIT
