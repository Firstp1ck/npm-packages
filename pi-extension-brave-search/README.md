# Brave Search for Pi

Lets Pi search the current web through the Brave Search API.

## What you can do

- Lets Pi search for current information on the web.
- Supports language, country, date, and safety filters.
- Lets you choose how many results Pi returns by default.
- Includes setup and status commands for the API connection.

## Install

Install it through Pi:

```bash
pi install npm:@firstpick/pi-extension-brave-search
```

Restart Pi if the package does not appear in your current session.

## How to use it

Run `/brave-search-setup` to save your API key. Pi can then search automatically when current information is needed, or you can ask it explicitly to use Brave Search.

- `/brave-search-status` — show whether Brave Search is configured and where key resolution succeeded.
- `/brave-search-setup` — run the interactive setup prompt again when no key is configured.
- `/brave-search-results` — show and adjust the default web result count saved as `BRAVE_SEARCH_RESULT_COUNT`.

## Before you start

You need a Brave Search API key. If none is configured, Pi opens a setup prompt and lets you save it for the current workspace or your Pi user configuration.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-extension-brave-search/TECHNICAL.md) for complete commands, configuration, compatibility, security, and troubleshooting information.
