# Technical reference: Nixos Wiki Local for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Local NixOS/Nix documentation retrieval for Pi, backed by the shared `pi-utils` local-wiki engine.

## Sources

The setup command creates minimal sparse, shallow, blob-filtered checkouts under `~/.nixoswiki`:

- `NixOS/nixpkgs` — `doc/` and `nixos/doc/`
- `NixOS/nix.dev` — `source/`
- `NixOS/nix` — `doc/`

Sparse checkout patterns exclude common images, archives, media, fonts, and binary artifacts to keep the local corpus focused on documentation text.

## Commands

- `/nixoswiki-status` — show docs path, page count, repository revisions, and cache timestamp.
- `/nixoswiki-local-setup` — clone/update the three official documentation sources.
- `/nixoswiki-smoke-test` — run compact parser/search/extract/read checks against representative NixOS/Nix topics.

Set `NIXOSWIKI_DOCS_PATH=/path/to/docs` to override the corpus path, useful for tests.

## Tools

- `nixoswiki_search` — compact output by default, optional snippets, query expansions, and corpus-specific stopword/downweight tuning.
- `nixoswiki_read`
- `nixoswiki_sections` — supports `maxSections` and omitted-count metadata.
- `nixoswiki_extract` — supports `maxSections`, truncation, and omitted-count metadata.
- `nixoswiki_related`
- `nixoswiki_smoke_test`

## Skill references

Markdown parsing uses frontmatter titles when present, ignores headings inside fenced code blocks, and strips common `{#anchor}` suffixes from headings/titles.

The packaged `nixos-local` skill includes reference notes matching the ArchWiki-local style:

- `references/troubleshooting-policy.md`
- `references/safety-rules.md`
- `references/query-expansions.md`
- `references/source-map.md`
- `references/non-nixos-host-policy.md`
