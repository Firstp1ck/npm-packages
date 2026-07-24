# Raspberry Pi Documentation Local Wiki Extension

Pi extension package that provides local-first search and retrieval tools for the official Raspberry Pi Documentation corpus.

## What it registers

- Command: `/raspberrypi_wiki-status`
- Command: `/raspberrypi-wiki-local-setup`
- Command: `/raspberrypi_wiki-smoke-test`
- Tools: `raspberrypi_wiki_search`, `raspberrypi_wiki_read`, `raspberrypi_wiki_sections`, `raspberrypi_wiki_extract`, `raspberrypi_wiki_related`, `raspberrypi_wiki_smoke_test`
- Skill: `raspberrypi-local`

## Corpus profile

Default local checkout path:

```txt
~/.raspberrypiwiki
```

Configured upstream repository:

```txt
https://github.com/raspberrypi/documentation
```

The upstream repository README identifies it as the source and tools used to build the public Raspberry Pi Documentation site. The build notes identify `documentation/asciidoc/` as the regular AsciiDoc documentation source. This package therefore indexes only AsciiDoc files and skips top-level build/tooling Markdown files.

Indexed files:

```txt
\.(adoc|asciidoc|asc)$
```

Parser format:

```txt
asciidoc
```

## Setup

Run inside Pi:

```txt
/raspberrypi-wiki-local-setup
```

The setup command is idempotent:

- If `~/.raspberrypiwiki` does not exist, it clones the configured repository with `--depth=1`.
- If it is an existing Git checkout, it runs `git pull --ff-only`.
- If it is a non-Git directory, it checks whether readable documentation files exist and reports the result.

Then verify:

```txt
/raspberrypi_wiki-status
/raspberrypi_wiki-smoke-test
```

## Search tuning

Corpus-specific tuning lives in `index.ts`:

- `CONFIG.promptDetection` targets Raspberry Pi computers, Raspberry Pi OS, Imager, raspi-config, config/cmdline files, GPIO, camera/rpicam/libcamera/Picamera2, bootloader/EEPROM/NVMe, Compute Module, and Pico/RP2040/RP2350 terms.
- `CONFIG.queryExpansions` maps realistic support queries such as `ssh`, `headless`, `camera`, `config.txt`, `gpio`, `nvme`, `bootloader`, `wifi`, and `pico` to current Raspberry Pi documentation vocabulary.
- `CONFIG.searchStopwords` removes high-frequency generic and Raspberry-Pi-brand tokens (`raspberry`, `pi`, generic help words) that over-rank broad aggregate pages.
- `CONFIG.termWeights` downweights broad corpus terms such as `configuration`, `computer`, `device`, `os`, `setup`, and `remote access` while preserving precise terms like `ssh`, `rpicam`, `dtoverlay`, `nvme`, `rp2040`, and `rp2350`.

The tuning was derived from the local corpus profile and representative searches, not copied from another wiki package.

## Development checks

```bash
validate_wiki /home/firstpick/pi-coding-agent-forge/pi-extension-raspberrypi-wiki-local
npm install --package-lock-only --ignore-scripts
npm pack --dry-run
bun build index.ts --target=node --outfile=/tmp/raspberrypi-wiki-local-index-check.js
```

A lightweight registration/smoke check can be run with Bun by loading `index.ts` into a fake Pi extension API and calling the registered tools.

## Notes

- Retrieval tools are read-only.
- Missing local docs fail loudly instead of silently falling back to web sources.
- Search defaults to compact output with snippets disabled unless `includeSnippets: true` is requested.
- Query extracts are section-limited by default and report omitted sections to keep token output bounded.
- Related-link output only returns local links that resolve inside the indexed documentation tree.
- Final answers should cite local documentation paths as `<path> — <section>`.
- See `references/evaluation.md` for the corpus audit, smoke-test results, caveats, and final confidence.
