# Technical reference: Codex Fast Mode for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

## Install

```bash
pi install npm:@firstpick/pi-extension-codex-fast-mode
```

## Commands

- `/fast-mode` — toggle the current session between Normal and Fast.
- `/fast-mode on` — enable Fast mode.
- `/fast-mode off` — disable Fast mode.
- `/fast-mode status` — show the current setting.

Fast mode starts off. The choice belongs to the current session branch and is restored when that branch is resumed. Mode changes are refused while Pi is busy; the status command remains available.

## Eligibility and credit use

Fast mode applies only to supported subscription-backed Codex requests. Other providers, unsupported models, and normal API-key billing are left unchanged.

Fast mode asks the upstream service for priority processing; it cannot guarantee that the service accepts or provides it. Account and model eligibility remain controlled by OpenAI.

Current published behavior is roughly 1.5× faster while using 2× Standard credits for GPT-5.4 and 2.5× for GPT-5.5/5.6. Provider terms can change, so check current Codex documentation before relying on those figures.

## Privacy and limitations

The extension does not inspect credentials, change authentication, choose a model, or make a separate network request. It changes only the Fast-mode preference for an otherwise supported request.
