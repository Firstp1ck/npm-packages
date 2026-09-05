# Technical reference: Anthropic Auth Recovery for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Install

```bash
pi install npm:@firstpick/pi-extension-anthropic-auth-recovery
```

## When it appears

The recovery option appears only for supported Anthropic subscription or extra-usage compatibility errors. Other provider errors and unrelated Anthropic failures are ignored.

Pi shows automatic startup compatibility warnings and footer status only when an Anthropic subscription login is active. It skips the startup check and clears any previous footer status when Anthropic is logged out or configured with an API key instead. You can still run `/anthropic-auth-status` manually.

The same recognized error is shown only once during a Pi session.

## Recovery flow

1. Pi offers a recovery action instead of starting it automatically.
2. You choose an authenticated non-Anthropic model.
3. A separate plan-only session checks the external compatibility patch and prepares a plan.
4. You review that plan and decide separately whether anything should be applied.

The recovery session is not allowed to apply or roll back patches, install packages, or perform live provider verification.

Use `/anthropic-auth-status` for a read-only compatibility status check.

## Optional remote recovery

Terminal Pi can open a separate local recovery session when a supported terminal launcher is available.

A Web UI or remote session may use an explicitly configured recovery address and private bearer token:

```text
PI_WEBUI_RECOVERY_URL=https://trusted-host.example/recovery
PI_WEBUI_RECOVERY_TOKEN=<private token>
```

Use only a trusted HTTPS address or a loopback address. Missing or invalid configuration falls back to a manual local command instead of trying unknown services.

## Choosing the recovery model

Set `PI_ANTHROPIC_RECOVERY_MODEL=provider/model` to prefer a particular authenticated non-Anthropic model. If it is unavailable, Pi asks you to choose from the models that are currently authenticated.

## Privacy and safety

The extension does not save provider errors, credentials, prompts, or model tokens. A configured remote recovery service receives the plan-only request, working folder, and selected model, so configure it only when you trust that service.

A generated plan is advice, not proof that a patch is safe. Review it before authorizing any later change.

## Limitations

- It is not a general Anthropic troubleshooting tool.
- Automatic terminal opening depends on the local terminal application.
- Remote recovery is unavailable until both the address and token are configured.
- Only already-authenticated recovery models are offered.
