# README section inventory and template decisions

## Corpus and weighting

Primary evidence covers every top-level project README under `C:/Users/hdlea/Documents/GitHub` plus meaningful nested project READMEs: 14 non-forge files across 12 project directories. Two short stubs (`Abweichungsprozess/Documents/README.md` and `Databases/README.md`) were retained as evidence that the template must scale down. The `pi-coding-agent-forge` root README and two representative skill package READMEs were sampled only for repository/package conventions, not allowed to dominate the project template.

Excluded from project-pattern weighting: `.cursor/commands/readme-update.md`, test fixtures/golden data, vendored package READMEs, worker/corpus documentation, memory files, and a third-party OpenAgents README copied into `.dotfiles`. These are not project landing pages. The `.dotfiles/.local/scripts/README-npm-supply-chain-scanner.md` is a script-specific run note and is treated as nested operational documentation, not a project README.

## Exact H2 section inventory by README

| README | H2 sections |
| --- | --- |
| `Abweichungsprozess/README.md` | What Changed; Requirements; Install; Run From Source; Build Single EXE (PyInstaller); Build NSIS Installer; Output; Troubleshooting |
| `Abweichungsprozess/Documents/README.md` | None (title and one-sentence stub) |
| `Abweichungsprozess-rewrite/README.md` | Development; Tests and checks; Desktop build; Release |
| `Budget-Planer/README.md` | Features; Screenshots; Quick Start; Getting Started; Desktop Application; Currency Support; Supported Languages; Contributing; License; Support; Acknowledgments |
| `Databases/README.md` | None (title and one-line description) |
| `Externe-Analytik-rewrite/README.md` | Status; Repository layout; Prerequisites (all install per-user, no admin); Dev loop; Runtime assets (dev vs bundle); License |
| `Hyprland-Simple-Setup/README.md` | Example Images; Example Terminal and Musik Visualizer; Table of Contents; Introduction; TUI Testing; Environment Setup; Prerequisites; Installation Details; Project Structure; Setup Script Execution; Package Installations; Manuell Installation & Configuration; Change Wallpaper with the Wallpaper Script; Terminal Experience; Customization; Troubleshooting; Additional Resources; Contributing & Support; License |
| `Laboratory-Dashboard-App/README.md` | Features; Technology Stack; Project Structure; Getting Started |
| `Lagerverwaltung-Web/README.md` | Features; Tech Stack; Getting Started; Quick Reference; Project Structure |
| `Pacsea/README.md` | Community; Supported Platforms; Demo; Table of Contents; Quick start; Features; Security-first approach for AUR Packages; Usage; CLI Commands; Configuration; Optional: build from source; Troubleshooting; Roadmap; Credits; License; Wiki; Contributing |
| `UniPack/README.md` | Features; Supported Package Managers; Installation; Keyboard Shortcuts; Usage; Built With; License |
| `UsrGrp-Manager-TUI/README.md` | Safety model; Build and run; Configuration; Verification |
| `laboratory-planner/README.md` | Combined-product status; Vacation planner (existing foundation); Feature overview; Stack; Prerequisites; Run the app locally; Demo accounts; User guide; Data and configuration; Build and release; Project layout; Troubleshooting |
| `laboratory-planner/backend/README.md` | Development |
| `pi-coding-agent-forge/README.md` *(secondary)* | Start here; Find what you need; Technical and contributor information |
| `pi-skill-feature-development-workflow/README.md` *(secondary)* | Helpful when; What to share with Pi; Try asking; What you’ll get; Keep in mind; Install; Technical details |
| `pi-skill-html-report/README.md` *(secondary)* | Helpful when; What to share with Pi; Try asking; What you’ll get; Keep in mind; Install; Technical details |

## Normalized section families

Exact heading frequency understates shared intent because headings vary (`Stack`, `Tech Stack`, `Technology Stack`, `Built With`). Normalized observations:

| Semantic family | Representative headings | Observed pattern |
| --- | --- | --- |
| Purpose/outcome | Intro text, Introduction, foundation/status summaries | Present in every usable project README; essential. |
| Capabilities | Features, Feature overview, What you can do | Common in user-facing apps/TUIs; absent mainly in stubs and narrow developer notes. |
| Fast setup | Quick Start, Getting Started, Install, Installation, Build and run, Dev loop, Run locally | Dominant actionable pattern across mature projects. |
| Requirements | Requirements, Prerequisites, Environment Setup, Supported Platforms | Common when runtime/platform constraints matter. |
| Usage | Usage, User guide, CLI Commands, Keyboard Shortcuts, first workflow | Common for interactive products; depth varies by project type. |
| Configuration/data | Configuration, Data and configuration, Runtime assets, Customization | Important when state, paths, environment, or behavior is user-controlled. |
| Safety/security | Safety model, Security-first approach, privilege notes | Rare as a heading but critical where consequences are material. |
| Technology | Stack, Tech Stack, Technology Stack, Built With | Common orientation aid for software projects, but not a universal user need. |
| Structure | Project Structure, Project layout, Repository layout | Common in larger or contributor-oriented repositories. |
| Verification | Tests and checks, Verification, TUI Testing | Present where maintainers prioritize explicit quality evidence. |
| Build/release | Desktop build, Build and release, Release, installer sections | Conditional on distributable applications/packages. |
| Troubleshooting | Troubleshooting, recovery guidance | Recurs in setup-heavy projects. |
| Community | Community, Contributing, Support, Contributing & Support | Common for public projects. |
| Legal/credit | License, Credits, Acknowledgments | License is common and expected; credits are conditional. |
| Navigation/media | Table of Contents, Screenshots, Demo, example images, Wiki/resources | Useful only when document length or product type justifies it. |
| Status/history | Status, Combined-product status, What Changed, roadmap | Useful for lifecycle context, but long implementation history ages quickly. |

## Audience profile decision

Before selecting sections, the skill must classify the README's primary audience:

- **User-oriented:** applications, end-user tools, setup/configuration repositories, desktop/web products, CLI/TUI products, and installable packages. Default to outcome, capabilities, installation, first use, user-editable configuration, safety, troubleshooting, support, and license. Development and implementation information is prohibited: API calls or endpoints, request/response examples, schemas, architecture, technology stack, repository/source layout, internal algorithms, test commands or fixtures, benchmarks, contributor setup, source-build instructions, packaging/publication internals, and release-maintenance procedures. Link to the appropriate technical or contributor document instead.
- **Developer/library-oriented:** libraries, SDKs, APIs, frameworks, reusable modules, and integration-focused repositories. Include the public integration surface: installation, a minimal code example, runtime compatibility, API/documentation links, verification, and concise technical orientation where useful.

When evidence is mixed, optimize the root README for the primary user and link to technical or contributor documentation for the secondary audience.

## Template decisions

| Template section | Decision | Why |
| --- | --- | --- |
| Project title + one-sentence outcome | **Always include** | The only universal pattern; gives immediate identity, audience, and value. |
| Verified badges | **Conditional** | Useful trust signals in Pacsea/UniPack and external examples, but noisy or misleading when stale. Never invent them. |
| Main Window image | **Default for user-oriented visual products** | Gives users immediate orientation. Search repository assets first; if missing, ask the user to provide/capture one or explicitly continue without it. Omit for non-visual projects or when the user declines. |
| Common feature previews | **Default for user-oriented visual products** | Show two to four representative, common user-visible features or workflows. If repository evidence does not establish them, ask the user to name them. Request image paths/captures for missing visuals. Never invent or silently substitute features or images. |
| What you can do | **Default include for user-facing projects** | Feature sections recur most often and answer why the project matters. Omit for tiny internal modules or stubs. |
| Status/limitations | **Conditional, near top** | Essential for rewrites, prototypes, archived work, or migration states; unnecessary for stable projects. |
| Quick start | **Always include when the project is runnable/installable** | Setup/run sections are the strongest cross-repository pattern. Includes requirements, primary install/run command, and first-success signal. |
| How to use | **Conditional** | Needed when first use is not obvious; otherwise duplicates Quick start. |
| Configuration and data | **Conditional** | Include when users control settings, paths, environment, credentials, storage, backup, or reset behavior. |
| Safety and privacy | **Conditional but mandatory when risk exists** | Rare headings do not mean low importance. Privilege, account mutation, secrets, destructive setup, and sensitive data must be visible before use. |
| Compatibility | **Conditional** | Unifies platform/language/runtime support and prevents hidden adoption failures. |
| Technology | **Developer/library profile only** | Useful for integration-oriented readers. Prohibited in user-oriented READMEs; express only user-visible requirements or compatibility there. |
| Project structure | **Developer/library profile only, and short** | Helpful for integration or contribution, but distracting for end users; exhaustive source maps belong in contributor docs. |
| Development and verification | **Developer/library profile only** | Libraries benefit from a primary verification path. User-oriented READMEs link to `CONTRIBUTING.md`/`DEVELOPMENT.md` and contain no development commands; a user-facing health check belongs in Quick start or Troubleshooting without contributor detail. |
| Build and release | **Developer/library profile only** | User-oriented READMEs may explain how to obtain or update a published release, but source builds, packaging, publication, and release maintenance belong in contributor docs. |
| Troubleshooting | **Conditional** | Include likely first-run failures and concrete checks; link out when extensive. |
| Roadmap | **Conditional and linked** | Useful for active public projects, but long speculative backlogs become stale and overwhelm usage. |
| Contributing and support | **Default for shared/public projects** | Consolidates issue, contribution, and security-reporting paths without duplicate sections. |
| License | **Default include** | Frequent, expected, and legally useful; link to the authoritative file. |
| Acknowledgments | **Conditional** | Include required attribution or meaningful credit; otherwise omit ceremony. |
| Table of contents | **Generated only for long READMEs** | Useful in Pacsea/Hyprland-sized documents, unnecessary in concise READMEs. |

## Content deliberately excluded or relocated

| Content | Decision | Destination/reason |
| --- | --- | --- |
| Long “What Changed” or phase-by-phase implementation history | **Exclude from normal README** | Use `CHANGELOG.md`, release notes, migration/status docs; history decays quickly. A short current status may remain. |
| API calls or endpoints, request/response examples, schemas, payloads, internal algorithms, locking, or architecture | **Prohibited in user-oriented README; relocate** | Use API documentation, `TECHNICAL.md`, `DEVELOPMENT.md`, or architecture docs according to repository policy. Public API examples are allowed only in the developer/library profile. |
| Exhaustive source-file maps | **Relocate or compress** | Keep only directories readers need; detailed maps are contributor material. |
| Full contributor test matrices, fixtures, benchmark mechanics, local linking, and publication internals | **Relocate** | Use `CONTRIBUTING.md`/`DEVELOPMENT.md`; retain only user-facing health checks in README. |
| Demo credentials or real-looking passwords | **Exclude by default** | Security and copy/paste risk. If unavoidable, clearly label disposable local-only credentials and source them from verified project docs. |
| Exhaustive dependency/package lists | **Relocate or summarize** | Link to manifests or technical docs; keep only prerequisites users must install. |
| Full keybinding/CLI/config catalogs | **Relocate or summarize** | Provide a quick reference and link to authoritative docs/wiki/help output. |
| Inline styling and decorative HTML | **Do not standardize** | Can harm portability/accessibility; allow existing intentional branding without making it canonical. |
| Empty boilerplate sections | **Exclude** | Conditional sections must earn their place with verified content. |
| Claims inferred only from directory names or dependencies | **Exclude** | The skill must report gaps or placeholders rather than fabricate capabilities, support, or safety claims. |
| Generated, invented, or unrelated screenshots | **Exclude** | Use verified repository assets or user-provided images only. Ask when Main Window or common-feature visuals are missing; proceed without visuals only after the user declines or the project is non-visual. |

## Decision summary

The template standardizes **reader flow**, not section count. For user-oriented visual repositories the default is outcome → Main Window → capabilities and common feature previews → quickest success → normal use → user-editable configuration/safety → support/legal. Missing Main Window or common-feature visuals trigger a user request rather than invention. Development and implementation information never appears there; it is linked elsewhere. Developer/library repositories add the public integration surface and only the technical orientation needed to use or extend the library. This preserves the strongest patterns in the corpus while avoiding the bloat visible in the longest READMEs and the under-documentation visible in stubs.
