# Development guide: Anthropic Auth Recovery for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Packaged resources and discovery

The npm package is self-contained for normal operation:

- it bundles the complete `pi-anthropic-provider-dist-compat` PATCH.md runtime package; and
- it declares `@firstpick/pi-skill-patch-md` as a runtime dependency and resolves `patchctl.mjs` through Node package resolution.

Discovery uses the first complete, readable candidate in this order:

1. Explicit `PI_ANTHROPIC_PATCH_PATH` and `PI_PATCHCTL_PATH` emergency overrides.
2. The compatibility patch bundled with this extension and the dependency-resolved `patchctl.mjs` runner.
3. Standard agent paths: the configured agent directory's `patches/pi-anthropic-provider-dist-compat/PATCH.md` and `skills/patch-md/scripts/patchctl.mjs`.
4. Source-checkout ancestor paths for local development and backward compatibility. The extension canonicalizes its own real path first, so `dev/scripts/sync-pi-package-symlinks.sh` file links resolve back into the monorepo even when Pi's loader preserves symlink paths.

A patch candidate is accepted only when its `PATCH.md`, manifest, and contained lifecycle handler are readable. Missing-resource diagnostics identify whether the patch package, runner, or both are unavailable. `PI_AGENT_DIR` and `PI_CODING_AGENT_DIR` still select the standard agent fallback, but ordinary npm installations should not need path configuration.

After installing or upgrading the extension, restart long-running Pi/WebUI processes so they load the new module and packaged resources.

## Development

```bash
npm test
npm run check
npm run smoke
npm pack --dry-run --json
```

Tests run only against temporary directories and mocked fetch calls. They cover provider-scoped error classification, Anthropic subscription warning guards, authenticated model selection, plan-only arguments, prompt-file permissions, packaged and fallback discovery, secure WebUI rules, and an offline independent npm installation from locally built tarballs.

## Additional implementation details

Pi discovers `anthropic-subscription-auth-recovery.ts` through the package manifest.

- Recovery starts only after a classified Anthropic error, an available authenticated non-Anthropic model, and interactive confirmation.
- The automatic prompt is plan-only and starts Pi with `--no-approve`; applying a returned plan requires separate, explicit operator approval.
- Temporary prompt files use mode `0600` and are scheduled for cleanup.
- The extension does not persist provider errors, tokens, prompts, or model credentials. A configured RPC endpoint receives the plan-only prompt, working directory, and selected recovery model; configure it only when that disclosure is acceptable.
- No network request is made unless the explicit URL-and-token pair is present.

## Preserved implementation and format details

Offers an explicit, plan-only recovery flow when Pi encounters a narrowly classified Anthropic compatibility error. It helps an operator inspect an external compatibility patch with an authenticated non-Anthropic recovery model; it never applies that patch automatically.

## Install

```bash
pi install npm:@firstpick/pi-extension-anthropic-auth-recovery
```

## Behavior

The extension:

- recognizes only the supported Anthropic error classifiers and ignores errors from other providers;
- deduplicates a classified error within the Pi session;
- selects an authenticated, non-Anthropic recovery model, optionally honoring `PI_ANTHROPIC_RECOVERY_MODEL=provider/model` when that model is available;
- offers a confirmation prompt before opening a recovery flow;
- asks the recovery session to run `patchctl status` and `patchctl plan` only;
- starts Pi with `--no-approve` and explicitly forbids `apply`, rollback, package installation, and live provider verification;
- exposes `/anthropic-auth-status` for a read-only compatibility status check; and
- shows status at session start when the external patch resources can be discovered, but emits an automatic warning only when Pi has active Anthropic subscription OAuth.

In a native TUI, the confirmed flow opens a separate terminal when a supported terminal launcher is available. In RPC mode, it posts only to an explicitly configured, authenticated recovery endpoint; otherwise it shows a manual local command.

## Optional RPC/WebUI recovery

Automatic RPC recovery is disabled unless **both** environment variables are configured:

```text
PI_WEBUI_RECOVERY_URL=https://trusted-host.example/recovery
PI_WEBUI_RECOVERY_TOKEN=secret-bearer-token
```

The endpoint must use HTTPS, except loopback HTTP (`localhost`, `127.0.0.0/8`, or `::1`). Requests use a bearer token, include `mode: "plan-only"`, and have a five-second timeout. A missing token, missing URL, invalid URL, network failure, or non-success response safely falls back to a manual command; the extension never probes local endpoints implicitly.

## Compatibility and limitations

This package requires a Pi extension runtime with session, command, and agent-end hooks. It supports native TUI and RPC recovery paths; other Pi modes report that no recovery UI is available. Recovery model selection is limited to models already configured with authentication, and terminal auto-open depends on a supported local launcher.

The classifier intentionally covers only the documented subscription/extra-usage compatibility messages. It is not a general Anthropic error repair system and does not guarantee that a generated plan is safe to apply.

## License

MIT
