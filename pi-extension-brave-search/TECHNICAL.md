# Technical reference: Brave Search for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Brave Search tool integration for Pi.

## What it does

- Adds the `brave_search` tool for live web search from Pi.
- Returns formatted results plus structured metadata.
- Supports Brave result filters, extra snippets, spellcheck, clean text output, and Goggles.
- Deduplicates normalized URLs across returned result blocks.
- Applies sane limits and request pacing to keep output stable, context-safe, and compatible with low-rate plans.
- Resolves API key in this order:
  1. `process.env.BRAVE_SEARCH_API_KEY`
  2. `./.env` (current working directory)
  3. `PI_CODING_AGENT_DIR/.env`

## Install

```bash
pi install npm:@firstpick/pi-extension-brave-search
```

## Configuration

- `BRAVE_SEARCH_API_KEY` (required)

If no key is configured when Pi starts, the extension prompts you to enter one and choose where to save it:

- current workspace: `./.env`
- global Pi config: `$PI_CODING_AGENT_DIR/.env` or `~/.pi/agent/.env`

## Commands

- `/brave-search-status` — show whether Brave Search is configured and where key resolution succeeded.
- `/brave-search-setup` — run the interactive setup prompt again when no key is configured.
- `/brave-search-results` — show and adjust the default web result count saved as `BRAVE_SEARCH_RESULT_COUNT`.

## Tools

- `brave_search`
  - Inputs: `query`, optional `count`, `country`, `search_lang`, `freshness`, `safesearch`, `result_filter`, `extra_snippets`, `spellcheck`, `text_decorations`, `goggles`
  - Output: formatted search results + metadata, including `responseTypes`, requested web result count, count warning, canonical URLs, result type, original index, duplicate count, and optional extra snippets

Useful `result_filter` values include `web`, `news`, `videos`, `faq`, `discussions`, `infobox`, and `locations`. `count` applies to web results only in Brave's API. Brave Web Search supports `count` from 1 to 20 per request; the extension warns at 16+ and clamps invalid saved defaults into the supported range.

## Example view

The query is shown directly in the tool header, so it is easy to see what Pi searched for before reading the results.
