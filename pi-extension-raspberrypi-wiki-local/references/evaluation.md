# Raspberry Pi Local Wiki Evaluation

Date: 2026-05-27  
Package: `@firstpick/pi-extension-raspberrypi-wiki-local`  
Extension id: `raspberrypi`  
Skill: `raspberrypi-local`  
Confidence: **93/100**

## Corpus profile

- Local checkout: `/home/firstpick/.raspberrypiwiki`
- Upstream remote: `https://github.com/raspberrypi/documentation`
- Local branch/revision: `master` @ `8d7d08c`
- `origin/master` check: `8d7d08ca60c8`, matching the local checkout prefix
- Local file profile before tuning: `272` `.adoc` files and `4` `.md` files
- Indexed extensions after tuning: `.adoc`, `.asciidoc`, `.asc`
- Parser format: `asciidoc`
- Indexed page count observed by status/smoke test: `272`

Official/source evidence used:

- Repository README states the repo contains the source and tools used to build the public Raspberry Pi Documentation site.
- `BUILD.md` identifies `documentation/asciidoc/` as the regular AsciiDoc documentation source and describes generated HTML as build output.
- Local `git ls-remote origin refs/heads/master` matched the checked-out revision prefix, so corpus assumptions were made against the current configured upstream branch.

## Changes applied

- Restricted `CONFIG.fileExtensions` from Markdown + AsciiDoc to AsciiDoc-only to avoid indexing root build/tooling Markdown files.
- Kept `CONFIG.format = "asciidoc"` and bumped cache schema to force rebuild.
- Tuned `CONFIG.promptDetection` for Raspberry Pi OS/hardware, Imager, raspi-config, config/cmdline files, camera/rpicam/libcamera/Picamera2, GPIO, bootloader/EEPROM/NVMe, Compute Module, and Pico/RP2040/RP2350 terms.
- Expanded `CONFIG.queryExpansions` for realistic support searches: SSH/headless, camera/rpicam, config.txt/dtoverlay/dtparam, GPIO/pinctrl, NVMe/PCIe boot, Wi-Fi/NetworkManager, Raspberry Pi OS versions, and Pico SDK/MicroPython.
- Added corpus-derived `CONFIG.searchStopwords` for high-frequency generic/domain tokens. Local term-frequency sampling showed `raspberry` and `pi` occur in about 200/272 docs each, while generic terms like `the`, `to`, `for`, `with`, `use`, and `using` dominate document frequency.
- Added `CONFIG.termWeights` for broad but sometimes meaningful terms (`configuration`, `computer`, `device`, `os`, `setup`, `remote access`, etc.). Precise terms such as `ssh`, `rpicam`, `dtoverlay`, `nvme`, `rp2040`, and `rp2350` remain full-weight.
- Changed search default to compact output: snippets are omitted unless `includeSnippets: true`.
- Tightened default output bounds: search default `8`, sections default `60`, read default `16000` chars, extract default `10000` chars with section caps.
- Fixed AsciiDoc include-heavy parent title behavior by deriving page titles/links from the source file while sections/text use expanded includes.
- Fixed related-link resolution to return only local paths that exist inside the docs root, with fallbacks for common Raspberry Pi docs xref patterns.
- Added command `/raspberrypi_wiki-smoke-test` and tool `raspberrypi_wiki_smoke_test`.
- Rewrote `README.md`, `skills/raspberrypi-local/SKILL.md`, and `references/scaffold-checklist.md` with Raspberry-Pi-specific setup, workflow, diagnostics, safety, and token guidance.

## Representative tool results

| Call | Result | Output size |
|---|---:|---:|
| `/raspberrypi_wiki-status` | available, `272` pages, git `8d7d08c` | 218 chars |
| `raspberrypi_wiki_search({ query: "ssh headless setup", limit: 5, includeSnippets: false })` | SSH page ranked #1 | 1760 chars |
| `raspberrypi_wiki_sections({ page: "ssh", maxSections: 20 })` | 12 headings, 0 omitted | 1822 chars |
| `raspberrypi_wiki_extract({ page: "ssh", section: "Enable the SSH server", maxChars: 5000, maxSections: 2 })` | exact section, not truncated | 1684 chars |
| `raspberrypi_wiki_read({ page: "ssh", maxChars: 2000 })` | bounded broad read, truncated | 2427 chars |
| `raspberrypi_wiki_related({ page: "ssh", limit: 10 })` | 2/2 returned links resolve | 460 chars |
| `raspberrypi_wiki_smoke_test({ maxSearchResults: 5 })` | all checks passed | 5240 chars |

## Simulation matrix

| Scenario | Query | Expected/canonical result | Observed top results | Accuracy | Effectiveness | Token output |
|---|---|---|---|---:|---:|---:|
| Novice setup | `ssh headless setup` | `computers/remote-access/ssh.adoc` | SSH page #1, remote-access aggregate #2 | 96 | 95 | 94 |
| Beginner config/GPIO | `config.txt dtoverlay gpio` | config.txt + GPIO/device-tree pages | GPIO #1, config.txt #2, configuration #3 | 91 | 92 | 93 |
| Intermediate camera/API | `camera libcamera picamera2` | rpicam/libcamera/Picamera2 pages | install packages #1, Picamera2 Python #2, rpicam pages next | 92 | 93 | 93 |
| Advanced boot/storage | `boot from nvme pi 5` | `boot-nvme.adoc` | NVMe SSD boot #1 | 96 | 95 | 94 |
| Expert/dev workflow | `pico sdk blink build` | Pico C/C++ SDK pages | official SDK #1, C SDK aggregate #2 | 94 | 94 | 94 |

## Practical checks

- `validate_wiki /home/firstpick/pi-coding-agent-forge/pi-extension-raspberrypi-wiki-local`: passed.
- `npm install --package-lock-only --ignore-scripts`: passed, 0 vulnerabilities reported.
- `npm pack --dry-run`: passed after the evaluation report was added; tarball contained 7 package files and excluded cache/docs/package-lock artifacts.
- `bun build index.ts --target=node --outfile=/tmp/raspberrypi-wiki-local-index-check.js`: passed.
- Lightweight registration harness: registered expected commands/tools and verified prompt routing triggered for a Raspberry Pi SSH prompt but not a webpack prompt.

## Remaining caveats

- The parser is lightweight AsciiDoc, not a full Asciidoctor render. Some tabs/delimited-block syntax remains visible in extracts; this is acceptable for local evidence but not identical to rendered HTML.
- Include-heavy parent pages are useful but can still appear near specific child pages. The skill therefore instructs `search -> sections -> exact section extract`.
- Related links are intentionally conservative and only include local paths that resolve on disk. This improves correctness but makes `related` non-exhaustive.
- The corpus does not include generated Pico SDK Doxygen-derived pages unless the upstream build/submodule generation has been run into `documentation/asciidoc/pico-sdk/`.
- Search is lexical, not semantic/BM25. Mixed broad queries can rank several related pages; use exact section extraction for final answers.

## Scores

- Accuracy: **94/100**
- Effectiveness: **94/100**
- Token/output discipline: **93/100**
- Final confidence: **93/100**
