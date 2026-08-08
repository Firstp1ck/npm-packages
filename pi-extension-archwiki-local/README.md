# ArchWiki Local for Pi

Lets Pi search your local ArchWiki copy before reaching for the public web.

## What you can do

- Searches the ArchWiki copy installed on your computer.
- Reads focused sections instead of sending you through long pages.
- Includes guidance for Arch and common Arch-based distributions.
- Keeps local documentation available even when web search is unnecessary.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-archwiki-local
```

Restart Pi if the package does not appear in your current session.

## How to use it

Run `/archwiki-local-setup` once if the local ArchWiki package is missing. After that, ask Pi an Arch Linux question normally; it searches and cites the local documentation first.

- `/archwiki-status` — reports docs path, page count, `arch-wiki-docs` package version, and cache freshness.
- `/archwiki-local-setup` — installs or updates `arch-wiki-docs`. If it cannot do that automatically, it shows the exact `pacman` command for you to run.
- `/archwiki-smoke-test` — runs compact local parser/search/extract/read checks against representative ArchWiki topics.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-archwiki-local/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
