# NixOS Wiki Local for Pi

Lets Pi search local NixOS and Nix documentation before using the public web.

## What you can do

- Searches local NixOS and Nix documentation.
- Uses official documentation repositories as its source.
- Returns focused passages instead of whole manuals.
- Includes status and local-corpus checks.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-nixos-wiki-local
```

Restart Pi if the package does not appear in your current session.

## How to use it

Complete the local documentation setup described by the status command, then ask Pi a NixOS or Nix question normally. Pi searches the local official sources first.

- `/nixoswiki-status` — show docs path, page count, repository revisions, and cache timestamp.
- `/nixoswiki-local-setup` — clone/update the three official documentation sources.
- `/nixoswiki-smoke-test` — run compact parser/search/extract/read checks against representative NixOS/Nix topics.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-nixos-wiki-local/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
