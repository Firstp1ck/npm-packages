# Technical reference: Archwiki Local for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Local ArchWiki retrieval tools and an Arch/Arch-based distro troubleshooting skill backed by the installed `arch-wiki-docs` package. The skill prioritizes EndeavourOS first and CachyOS second when distro-specific context matters.

Docs path:

```txt
/usr/share/doc/arch-wiki/html/en/
```

Cache path:

```txt
~/.cache/pi/archwiki-local/
├── pages.json
└── metadata.json
```

## Packaged skill

The package includes `skills/arch-linux-local/SKILL.md`, so publishing/installing the package can deliver the troubleshooting workflow and the extension together.

The skill is for Arch Linux and Arch-based distributions, not only vanilla Arch. It includes distro reference notes for EndeavourOS, CachyOS, Manjaro, Garuda Linux, Artix Linux, and BlackArch.

## Registered commands

- `/archwiki-status` — reports docs path, page count, `arch-wiki-docs` package version, and cache freshness.
- `/archwiki-local-setup` — installs `arch-wiki-docs` with `pacman` when missing, and checks `pacman -Qu arch-wiki-docs` for pending updates when already installed. If automatic install/update is not possible, it tells the user to run:

  ```bash
  sudo pacman -S arch-wiki-docs
  ```

- `/archwiki-smoke-test` — runs compact local parser/search/extract/read checks against representative ArchWiki topics.

## Registered tools

- `archwiki_search` — searches local pages with query normalization, query expansion, stopword/downweight tuning, compact output by default, and optional snippets.
- `archwiki_read` — reads a page as clean text with local path citation.
- `archwiki_sections` — lists extracted headings with `maxSections` and omitted-count metadata.
- `archwiki_extract` — extracts a named or query-relevant section with `maxSections`, truncation, and omitted-count metadata.
- `archwiki_related` — returns locally linked ArchWiki pages.
- `archwiki_smoke_test` — runs parser/search/extract/read smoke checks.

## Notes

If `/usr/share/doc/arch-wiki/html/en/` is missing or empty, ArchWiki-local prompts/tools warn that `arch-wiki-docs` is required and stop instead of falling back silently.
