# Skill Catalog for Pi

- **Status:** Planned; implementation not started
- **Classification:** Complex feature
- **Feature slug:** `pi-skill-catalog`
- **Target package:** `pi-extension-skill-catalog/` (new)
- **Published name:** `@firstpick/pi-extension-skill-catalog`
- **Primary command:** `/skill-catalog`
- **Integration owner:** Parent Pi session
- **Last updated:** 2026-08-21

## 1. Goal

Build a read-only Pi extension that discovers Agent Skills available to the current user and trusted project across supported coding harnesses, groups duplicates without hiding collisions, and presents one alphabetically sorted, searchable, filterable catalog in Pi's native terminal UI.

The catalog must answer four questions without requiring users to know each harness's directory layout:

1. Which skills are present?
2. Which harnesses and scopes expose each skill?
3. Are two entries the same skill, copies, or conflicting definitions with the same name?
4. Is a skill valid and loaded by the current Pi session, merely discoverable, or unavailable because its manifest is invalid?

## 2. Why this is a separate package

`pi-extension-setup-skills` remains Pi's enable/disable manager. It writes Pi settings and intentionally resolves candidates by name for that workflow.

`pi-extension-skill-catalog` is separate because it has a different contract:

- It indexes several harnesses, not only Pi.
- It is read-only.
- It preserves same-name variants instead of selecting one winner.
- It reports provenance, validity, duplicates, and collisions.
- It does not install, enable, disable, link, copy, or delete skills.

The new package may reuse small discovery and UI patterns from `pi-extension-setup-skills`, but it must not import that package or duplicate its settings mutation logic.

## 3. Classification

This is a complex feature because it has several independently testable slices:

- harness-specific path and discovery rules;
- bounded filesystem scanning and safe manifest parsing;
- cross-harness normalization, grouping, and collision handling;
- interactive search, filtering, sorting, and detail display;
- package, documentation, trust, and compatibility work.

Future implementation must follow the repository's complex-feature workflow. It requires at least two meaningful implementation worker outcomes, central integration, two fresh read-only reviews from distinct provider families when available, finding dispositions, and a final HTML report under `reports/pi-skill-catalog.html`.

## 4. Success criteria

1. `/skill-catalog` opens one Pi TUI catalog without changing any harness configuration or skill file.
2. Version 1 supports Pi, Claude Code, OpenAI Codex, Cursor, Gemini CLI, OpenCode, Windsurf, and Google Antigravity through explicit adapters.
3. The extension scans documented discovery roots and trusted configured roots. It never sweeps the user's home directory or filesystem root.
4. Project-local roots are scanned only when `ctx.isProjectTrusted()` is true.
5. Results are sorted by skill name by default, with deterministic tie-breakers.
6. Search matches name, description, harness, scope, source kind, and path using case-insensitive token matching.
7. Filters support harness, scope, source kind, health, and Pi runtime state. Sort controls support name, harness, and path.
8. The results list uses Pi's native `SelectList`. Filter controls use `SettingsList` rather than a custom list implementation.
9. A skill exposed through several roots appears as one logical group when the manifest content is identical, while every occurrence and harness association remains inspectable.
10. Distinct manifests with the same declared name remain separate variants and receive a visible collision warning.
11. Invalid, unreadable, oversized, and name-mismatched manifests are reported with bounded diagnostics instead of crashing or disappearing silently.
12. The current Pi runtime overlay comes from `ctx.getSystemPromptOptions().skills`; the extension does not reimplement Pi's active-skill precedence.
13. Scanning is cancellable, bounded, cycle-safe, and free of shell commands, network requests, file watchers, and background startup work.
14. Narrow terminals, empty results, large catalogs, theme changes, symlink loops, unreadable roots, and non-TUI modes have deterministic behavior and tests.
15. Package tests, type checks, pack inspection, Markdown checks, and installed-host smoke checks pass before completion.

## 5. Scope

### 5.1 Included in version 1

- A new first-party Pi extension package.
- `/skill-catalog [initial search text]`.
- On-demand scanning when the command opens.
- A native Pi TUI list with search, multi-facet filters, sort selection, counts, warnings, and an expandable detail panel.
- User, trusted-project, package/plugin, managed, and built-in source labels where an adapter can establish them without guessing.
- Pi runtime loaded-state overlay.
- Per-harness discovery rules and capability notes.
- Optional explicit extra roots in extension configuration.
- In-memory scan caching for the current command invocation only.
- Linux, macOS, and Windows path handling through Node APIs and adapter-specific roots.
- User documentation, advanced technical documentation, contributor documentation, tests, and root package catalog entry.

### 5.2 Non-goals

- Installing, enabling, disabling, updating, moving, linking, copying, editing, or deleting skills.
- Changing Pi, Claude, Codex, Cursor, Gemini, OpenCode, Windsurf, or Antigravity settings.
- Running another harness's CLI to ask what it loaded.
- Scanning arbitrary caches, temporary plugin downloads, editor extension bundles, `node_modules`, or every `SKILL.md` under the home directory.
- Traversing the workspace to discover contextual descendant Claude or Cursor skill roots.
- Loading skill bodies into the model context.
- Following or executing scripts, references, assets, links, or instructions inside a skill.
- Resolving which same-name skill wins when a vendor does not document precedence.
- A browser-native WebUI panel. Version 1 is a Pi TUI command. RPC, JSON, and print modes receive a concise unsupported-mode notice.
- Persistent content indexing, SQLite, file watchers, telemetry, or network lookups.
- A generic catalog for agents, prompts, rules, commands, tools, or MCP servers.

## 6. Product decisions and invariants

### 6.1 Definition of "all skills on the system"

For this extension, "all" means every skill reachable through a supported harness's documented user or current-project discovery roots, plus roots established by a supported runtime or package/plugin registry. It does not mean an unrestricted filesystem crawl.

The catalog distinguishes:

- **Loaded in Pi:** present in `ctx.getSystemPromptOptions().skills` for the current session.
- **Discoverable:** present under a documented or explicitly configured root.
- **Managed or built-in:** exposed by a harness-owned root that the adapter can identify reliably.
- **Invalid:** found at a valid candidate location but not usable as a skill manifest.
- **Unknown activation:** discoverable for a non-Pi harness, but the extension cannot prove that harness enabled it.

Only Pi receives a loaded-state claim in version 1. Other harnesses are labeled discoverable unless a documented, file-based registry gives a stable activation answer.

### 6.2 Read-only boundary

The discovery path has a closed read-only API allowlist:

- Node `fs`, `path`, `os`, `url`, `crypto`, and `perf_hooks` APIs that do not write, spawn, watch, or use the network;
- `ctx.getSystemPromptOptions()` for the current Pi runtime skill overlay;
- `DefaultPackageManager.listConfiguredPackages()` and `DefaultPackageManager.getInstalledPath()` only, for paths that are already installed locally.

No other package-manager method is allowed. In particular, do not call `resolve`, `resolveExtensionSources`, install, update, remove, settings mutation, progress callback, or package-check methods.

The extension must not:

- call `pi.exec`;
- spawn a harness CLI;
- write a cache or state file;
- mutate Pi settings;
- register a model-callable tool;
- append skill content to the session;
- start discovery timers, watchers, subprocesses, or network requests.

Pi's lifecycle-managed native TUI components may use their own animation timers while the command is open. The command must dispose the loader on success, cancellation, error, refresh, and close. Discovery and catalog code remain timer-free.

The only registered runtime entry point is the human command `/skill-catalog`.

### 6.3 Trust boundary

- User-global roots may be scanned because the user installed the extension in their Pi environment.
- Project-local roots are ignored when `ctx.isProjectTrusted()` is false.
- Project configuration at `.pi/skill-catalog.json` is read only for a trusted project.
- A skill manifest is untrusted data. The UI renders bounded plain metadata and never interprets Markdown or ANSI escape sequences from it.
- Control characters and ANSI sequences are stripped from names, descriptions, paths, and diagnostics before rendering.
- The scanner never follows references named in a manifest.

### 6.4 No hidden precedence

Adapters may annotate documented precedence, but aggregation never discards a variant because one harness would prefer another. Every same-name definition stays visible. The detail panel explains the documented winner only when the vendor specifies one.

## 7. Supported harness matrix

The initial adapters are based on current official documentation checked during planning. Each adapter owns its paths, depth rules, compatibility roots, source labels, and documented precedence notes.

| Harness | User roots | Current-project roots | Layout rule | Important notes |
| --- | --- | --- | --- | --- |
| Pi | `~/.pi/agent/skills`, `~/.agents/skills`, runtime/package sources | only `<cwd>/.pi/skills`; ancestor `.agents/skills` through repository root, or filesystem root outside Git | Recursive `SKILL.md`; Pi-native root `.md` files also count | Runtime loaded skills come from Pi's own command context. Ancestor `.pi/skills` is not a Pi discovery rule. Same-name first-wins behavior is annotation only. |
| Claude Code | `~/.claude/skills`; reliably enabled plugin roots | ancestor `.claude/skills`; approved added-directory roots when represented by stable configuration | Ancestor roots in version 1 | Contextual descendant `.claude/skills` scanning is deferred because it requires a broad workspace walk. Enterprise, personal, project, and plugin precedence is annotated. Marketplace download caches are excluded unless a stable enabled-plugin registry identifies them. |
| OpenAI Codex | `$CODEX_HOME/skills`, default `~/.codex/skills`, `~/.agents/skills`, platform admin root | ancestor `.agents/skills` through repository root | One direct skill directory per root unless current docs prove more | Include bundled system skills under the detected Codex home. Exclude `.tmp` and plugin download caches. Duplicate names remain separate. |
| Cursor | `~/.agents/skills`, `~/.cursor/skills`, documented compatibility roots, detected managed built-ins | current and ancestor `.agents/skills`, `.cursor/skills`, and compatibility roots through repository boundary | Recursive within each explicit root | Contextual descendant skill-root discovery is deferred. `~/.cursor/skills-cursor` may be indexed as managed only when its manifest identifies it. Collision precedence is unknown. |
| Gemini CLI | `~/.gemini/skills`, `~/.agents/skills`, stable extension roots | `.gemini/skills`, `.agents/skills` in trusted workspace | Root file or one directory deep as documented | Built-in, extension, user, and workspace precedence is annotated. Deeper grouping is not scanned. |
| OpenCode | XDG `opencode/skills`, `~/.claude/skills`, `~/.agents/skills` | ancestor `.opencode/skills`, `.claude/skills`, `.agents/skills` through worktree root | One skill directory deep | Unique names are expected, but no winner is inferred for collisions. Honor `XDG_CONFIG_HOME`. |
| Windsurf | platform global root, `~/.agents/skills`, platform enterprise root | `.windsurf/skills`, `.agents/skills`; optional `.claude/skills` only when a stable config flag proves compatibility is enabled | One skill directory deep | Platform roots differ on Linux, macOS, and Windows. Undocumented collision and symlink behavior stays unknown. |
| Antigravity | detected current global root, currently `~/.gemini/antigravity/skills` | `.agents/skills`; legacy `.agent/skills` when present | One skill directory deep | Keep this adapter version-gated because Google has changed global paths. Name may default to the folder when omitted. |

### 7.1 Shared-root handling

A physical `~/.agents/skills/example/SKILL.md` may be discoverable by Pi, Codex, Cursor, Gemini CLI, OpenCode, and Windsurf. The catalog reads the physical file once but retains one exposure policy per harness and root.

Filesystem traversal may be shared only when policies have identical layout and exclusions. A candidate found by a recursive Pi or Cursor policy must not be attributed to a shallow Codex, Gemini CLI, OpenCode, or Windsurf policy. The catalog displays one physical occurrence with the applicable harness badges and every exposure path, scope, source kind, layout, and precedence note in the detail panel.

### 7.2 Internal and cache roots

Internal roots are included only through an explicit adapter probe with a versioned contract. Examples include Codex system skills and Cursor managed skills.

The following remain excluded by default:

- `.codex/.tmp`;
- raw Codex plugin download caches;
- Claude marketplace catalogs that are downloaded but not enabled;
- editor extension installation trees such as `.vscode/extensions`;
- package `node_modules` not reported by Pi's runtime/package resolver;
- backups, trash, build output, and arbitrary `SKILL.md` search results.

## 8. Architecture

```text
/skill-catalog
    |
    v
Command controller
    |-- load trusted user/project config
    |-- read current Pi runtime skills
    |-- build scan request
    v
Adapter registry
    |-- detect supported harness roots
    |-- attach per-root layout and precedence metadata
    v
Bounded scanner
    |-- canonicalize paths and symlinks
    |-- enumerate candidate manifests
    |-- parse bounded YAML frontmatter
    |-- emit occurrences and diagnostics
    v
Catalog builder
    |-- normalize metadata
    |-- merge physical duplicates
    |-- group identical copies
    |-- preserve conflicting variants
    |-- attach Pi runtime overlay
    |-- sort and build facets
    v
Native Pi TUI
    |-- Input for query
    |-- SelectList for results
    |-- SettingsList for facets
    `-- bounded detail panel
```

### 8.1 Core contracts

```ts
type HarnessId =
  | "pi"
  | "claude"
  | "codex"
  | "cursor"
  | "gemini-cli"
  | "opencode"
  | "windsurf"
  | "antigravity"
  | "custom";

type SkillScope = "user" | "project" | "package" | "plugin" | "managed" | "system" | "custom";
type LayoutRule = "pi-recursive" | "recursive" | "direct-child" | "root-file-or-direct-child";
type Health = "valid" | "invalid" | "unreadable" | "oversized" | "name-mismatch";

type PiState = "loaded" | "not-loaded" | "not-applicable";

interface RootExposurePolicy {
  id: string;
  harness: HarnessId;
  path: string;
  scope: SkillScope;
  sourceKind: string;
  layout: LayoutRule;
  documented: boolean;
  precedenceNote?: string;
  excludeNames: ReadonlySet<string>;
}

interface HarnessAdapter {
  id: HarnessId;
  label: string;
  detect(input: DetectionInput): Promise<AdapterDetection>;
  roots(input: RootInput): Promise<RootExposurePolicy[]>;
  validateName?(manifest: ParsedManifest, location: CandidateLocation): Diagnostic[];
}

interface SkillExposure {
  id: string;
  linkedPath: string;
  rootPolicyId: string;
  harness: HarnessId;
  scope: SkillScope;
  sourceKind: string;
  layout: LayoutRule;
  precedenceNote?: string;
  piState: PiState;
}

interface SkillOccurrence {
  id: string;
  manifestPath: string;
  realPath: string;
  exposures: SkillExposure[];
  health: Health;
  diagnostics: Diagnostic[];
  parsed?: ParsedManifest;
  contentHash?: string;
}

interface SkillVariant {
  id: string;
  normalizedName: string;
  displayName: string;
  description: string;
  contentHash?: string;
  occurrences: SkillOccurrence[];
  collision: boolean;
}

interface SkillGroup {
  normalizedName: string;
  variants: SkillVariant[];
  harnesses: HarnessId[];
  scopes: SkillScope[];
  health: Health[];
  piStates: PiState[];
}
```

### 8.2 Adapter registry

Adapters are declarative where possible. Shared path helpers handle home directories, XDG paths, environment overrides, repository boundaries, and platform enterprise roots.

Each adapter must state:

- how it detects the harness or relevant root;
- which user, project, package/plugin, managed, and system roots it can prove;
- whether the root is recursive, direct-child, or Pi-specific;
- exact default exclusions;
- known precedence text;
- whether folder-name equality is required;
- whether a missing frontmatter name may default to the directory.

An adapter returns one `RootExposurePolicy` per harness-root relationship. Policies that point to the same physical root remain distinct when layout, exclusions, scope, source kind, or precedence differs. The scanner may share traversal and file reads, but it evaluates candidate reachability against each policy before assigning a harness.

An adapter returns no roots that do not exist unless they are explicit configured roots. Missing harnesses do not produce warnings. Version 1 does not discover arbitrary descendant Claude or Cursor roots below the current workspace.

### 8.3 Pi runtime overlay

Inside the command handler, call `ctx.getSystemPromptOptions()` and read its `skills?: Skill[]` field. Index by canonical `filePath` first, then by source provenance as a secondary aid.

This overlay is authoritative only for the current Pi session:

- matched Pi exposure: `piState = "loaded"`;
- discoverable but unmatched Pi exposure: `piState = "not-loaded"`;
- foreign-harness exposure: `piState = "not-applicable"`.

Group state is derived from its exposures and may contain more than one value.

Do not parse `settings.json` to reconstruct Pi precedence for the loaded-state badge. Do not call `resolve`, `resolveExtensionSources`, or any package method outside the closed allowlist in section 6.2. Package roots may come only from loaded `Skill.sourceInfo`, `listConfiguredPackages().installedPath`, or `getInstalledPath()`.

For an already-installed package root, the Pi adapter reads `package.json` itself and indexes only `pi.skills` entries or the conventional `skills/` directory. Its read-only manifest-path resolver must support the documented include/exclude forms, remain inside the package root after canonicalization, and have dedicated fixtures. Tests must prove that install, refresh, Git, npm, settings mutation, progress, subprocess, and network paths are unreachable.

### 8.4 Bounded scanner

The scanner must:

1. keep every `RootExposurePolicy` until candidate reachability is evaluated;
2. share traversal only for policies with identical real root, layout, exclusions, and depth rules;
3. deduplicate manifest parsing and hashing by canonical real file path;
4. enumerate according to each exposure policy's layout rule;
5. skip `.git`, `node_modules`, temp, cache, backup, and adapter exclusions before descending;
6. follow symlinked skill entries only after canonicalization;
7. prevent cycles with a visited-real-directory set;
8. read only exact `SKILL.md` candidates, except Pi-native direct root `.md` files;
9. limit a scan to 10,000 candidate manifests, 100,000 visited directories, 500,000 directory entries, depth 32, and a 15-second elapsed budget checked between operations;
10. limit each manifest to 1 MiB and frontmatter to the first 256 KiB;
11. use a concurrency pool of 16 reads;
12. check an `AbortSignal` between directory and file operations;
13. return deterministic partial results plus bounded root diagnostics when any limit or non-fatal error is reached;
14. perform no network, subprocess, write, watcher, or discovery-timer work.

Version 1 does not traverse the workspace to find contextual descendant `.claude/skills`, `.cursor/skills`, or `.agents/skills` roots. It scans explicit user, current-directory, ancestor, managed, package/plugin, and configured roots only.

A direct `SKILL.md` symlink may resolve outside its declared root. It is allowed for user-global roots and trusted project roots, but every linked exposure and the canonical real path must remain visible. The scanner still reads only the manifest and never sibling resources.

### 8.5 Manifest parsing

Use the `yaml` package with a non-executing core schema rather than regular expressions. Parse only the first YAML document bounded by the opening and closing frontmatter delimiters.

Rules:

- Strip UTF-8 BOM before checking the first delimiter.
- Accept LF and CRLF.
- Require a string `description`, except where a documented adapter permits a missing field.
- Require a string `name`, except Antigravity's documented folder-name fallback.
- Preserve optional scalar metadata for display, but never render arbitrary nested objects.
- Reject custom tags, aliases, duplicate keys, non-scalar `name` or `description`, and unterminated frontmatter.
- Normalize display whitespace without changing the original file.
- Strip ANSI and control characters.
- Validate the Agent Skills portable name rules and adapter-specific folder matching separately.
- Hash the complete bounded manifest bytes with SHA-256. The hash identifies identical copies, not trustworthiness.

Parser failures become diagnostics. They do not throw past the scanner boundary.

### 8.6 Identity, duplicates, and collisions

Use three levels of identity:

1. **Physical occurrence:** canonical real path, with linked aliases retained.
2. **Content variant:** normalized declared name plus manifest SHA-256.
3. **Logical group:** normalized declared name.

Rules:

- The same real file reached through several roots is one occurrence with an `exposures` entry for every linked path, root policy, harness, scope, source kind, and precedence note.
- Separate files with the same name and same hash are one variant with several physical occurrences.
- Same normalized name and different hashes create several variants. Mark every variant in that group as a collision.
- Missing or invalid names group under a synthetic diagnostic key based on canonical path and never collide with a valid skill.
- Never overwrite a map entry solely because its name matches another skill.

### 8.7 Search and sorting

Normalize searchable text with Unicode NFKC, locale-independent lowercase conversion, whitespace collapse, and control removal.

Search behavior:

- split the query into non-empty tokens;
- require every token to match at least one indexed field;
- fields are name, description, harness label, scope, source kind, every linked exposure path, and real path;
- do not search skill bodies or referenced files.

Default ordering:

1. normalized skill name;
2. valid before invalid;
3. groups containing `piState = "loaded"` before not-loaded and not-applicable groups;
4. primary harness label;
5. scope order: project, user, package, plugin, managed, system, custom;
6. canonical path.

Additional sort modes are harness then name, and path then name. Use an explicit English numeric collator in code and deterministic fixture assertions rather than host-locale defaults.

## 9. TUI design

### 9.1 Main catalog

Use `ctx.ui.custom()` in non-overlay mode. The component contains:

- `DynamicBorder`;
- title and summary counts;
- native `Input` for the search query;
- active filter chips as plain text;
- native `SelectList` for the current result rows;
- a compact detail panel for the selected group or expanded variant;
- help text and bottom border.

Do not create a replacement list widget. Rebuild a `SelectList` instance when query, filters, or sorting changes because Pi's current native list has no public item-replacement method.

The outer catalog component must implement Pi TUI's `Focusable` contract and propagate focus to the embedded `Input`. Rebuilding the result list or returning from the filter dialog must preserve the logical focus target and update `Input.focused` so IME candidate positioning remains correct.

Each result row shows:

```text
skill-name    Pi, Codex, Cursor · user + project · 2 copies
```

Warnings replace the suffix when more important:

```text
skill-name    collision · 3 different manifests
broken-skill  invalid frontmatter · /path/to/SKILL.md
```

### 9.2 Filters

Pressing `f` while the result list has focus opens a native `SettingsList` with search enabled. Filter sections are represented as toggle rows:

- harness: one row per detected harness;
- scope: project, user, package, plugin, managed, system, custom;
- health: valid, invalid, unreadable, oversized, name mismatch, collision, duplicate;
- Pi state: loaded in Pi, not loaded in Pi, foreign-only.

No selected value means "all" for that facet. The header always shows the number of visible groups and total groups.

### 9.3 Controls

| Key | Behavior |
| --- | --- |
| Type while search is focused | Update token search |
| `Tab` / `Shift+Tab` | Move between search and results |
| `Up` / `Down` | Move through results; while search is focused these still navigate results |
| `Enter` | Expand or collapse selected group's variants and occurrences |
| `f` | Open native facet filter list when results have focus |
| `s` | Cycle name, harness, and path sort modes |
| `Ctrl+R` | Cancel any prior scan and rescan documented roots |
| `Esc` | Collapse details, then clear search, then close |
| `q` | Close when results have focus |

Use injected keybindings where Pi provides a named action. Keep raw fallback keys only for extension-specific actions.

### 9.4 Detail panel

The detail panel renders bounded plain text:

- declared name and description;
- harnesses and scopes;
- loaded-in-Pi state;
- source kind;
- manifest path and real path when linked;
- content hash prefix;
- validity diagnostics;
- duplicate or collision explanation;
- documented harness precedence notes.

The panel never renders the Markdown body. Descriptions are limited to 400 display characters and paths to terminal width with ANSI-safe truncation.

### 9.5 Loading and failure states

- Show a cancellable `BorderedLoader` during the scan. Its native animation timer is the only allowed timer and must be disposed on every exit path.
- If cancellation occurs, dispose the loader and close without saving anything.
- If some roots fail, show results plus a warning count and root-level diagnostics in a synthetic detail row.
- If no skills exist, show detected harnesses, scanned root count, and the empty-state reason.
- If `ctx.mode !== "tui"`, notify that `/skill-catalog` requires Pi TUI mode and perform no scan.

## 10. Configuration

Version 1 reads optional configuration from:

- user: `~/.pi/agent/skill-catalog.json`;
- project: `<cwd>/.pi/skill-catalog.json`, only when the project is trusted.

Schema:

```json
{
  "version": 1,
  "enabledHarnesses": ["pi", "claude", "codex", "cursor", "gemini-cli", "opencode", "windsurf", "antigravity"],
  "includeManaged": true,
  "extraRoots": [
    {
      "path": "~/shared-agent-skills",
      "harness": "custom",
      "scope": "custom",
      "layout": "recursive"
    }
  ],
  "excludePaths": ["~/shared-agent-skills/archive"]
}
```

Rules:

- Unknown versions or fields fail with a clear diagnostic.
- Relative user paths resolve from the user config directory.
- Relative project paths resolve from the project config directory.
- `~` expansion applies only at the beginning of a path.
- Exclusions are path prefixes after canonicalization, not shell globs.
- Reject an extra root that canonicalizes to the user's home directory, POSIX root, a Windows drive root, a UNC share root, or an adapter-defined broad configuration root.
- Apply the scanner's directory, entry, depth, elapsed, candidate, file-size, and concurrency limits to configured recursive roots.
- Configuration cannot raise hard scan, traversal, file-size, elapsed, or concurrency limits.
- The command does not create or modify this file.

## 11. Proposed package layout

```text
pi-extension-skill-catalog/
├── index.ts
├── package.json
├── tsconfig.json
├── README.md
├── TECHNICAL.md
├── DEVELOPMENT.md
├── LICENSE
├── src/
│   ├── contracts.ts
│   ├── constants.ts
│   ├── config.ts
│   ├── paths.ts
│   ├── repository-boundary.ts
│   ├── adapters/
│   │   ├── index.ts
│   │   ├── shared.ts
│   │   ├── pi.ts
│   │   ├── claude.ts
│   │   ├── codex.ts
│   │   ├── cursor.ts
│   │   ├── gemini-cli.ts
│   │   ├── opencode.ts
│   │   ├── windsurf.ts
│   │   └── antigravity.ts
│   ├── scanner/
│   │   ├── enumerate.ts
│   │   ├── symlinks.ts
│   │   ├── frontmatter.ts
│   │   └── scan.ts
│   ├── catalog/
│   │   ├── normalize.ts
│   │   ├── aggregate.ts
│   │   ├── search.ts
│   │   ├── filters.ts
│   │   └── sort.ts
│   └── ui/
│       ├── command.ts
│       ├── catalog-view.ts
│       ├── filter-view.ts
│       ├── detail-view.ts
│       └── render.ts
└── tests/
    ├── fake-pi.mjs
    ├── fixtures/
    │   ├── homes/
    │   ├── projects/
    │   ├── manifests/
    │   └── symlinks/
    ├── adapters.test.mjs
    ├── config.test.mjs
    ├── frontmatter.test.mjs
    ├── scanner.test.mjs
    ├── aggregation.test.mjs
    ├── search-filter-sort.test.mjs
    ├── ui.test.mjs
    ├── extension.test.mjs
    └── package.test.mjs
```

`package.json` should use the exact published name, `pi-package` keyword, `pi.extensions: ["./index.ts"]`, Pi core packages as `peerDependencies`, and `yaml` as a production dependency. Use Node's test runner with `tsx` for TypeScript tests, expose `npm test` and `npm run typecheck`, and include `typescript`, `tsx`, and `@types/node` as development dependencies. `tsconfig.json` must typecheck `index.ts`, `src/**`, and `tests/**` without emitting. The tarball files list includes runtime source, layered documentation, and license; tests remain repository-only.

## 12. Execution DAG and workstreams

```text
W0 public contracts, fixture specification, and adapter matrix
   |
   +--> W1 discovery engine and parser --------+
   |                                           |
   +--> W2 catalog model and native TUI -------+--> W3 central integration
                                                      |
                                                      +--> W4 compatibility and acceptance
                                                      |
                                                      +--> W5 documentation and package catalog
                                                      |
                                                      `--> W6 review, fixes, report, completion
```

### W0: public contracts, fixture specification, and adapter matrix

**Owner:** Integration owner before worker launch.

**Writes:** canonical plan, `src/contracts.ts`, and `tests/fixtures/contracts/**` only.

**Deliverables:**

- version-pinned path/layout matrix derived from official docs;
- stable public types for exposure policies, occurrences, exposures, variants, groups, filters, and diagnostics;
- declarative fixture specifications for every harness, shared roots, project ancestry, managed roots, invalid manifests, duplicate copies, collisions, and symlink loops;
- exact expected classification for each fixture specification;
- recorded decision for any vendor contract that changed after this plan.

**Exit checks:** Every adapter case has a fixture specification and expected root/layout result. W1 and W2 can compile against the same approved contracts without depending on each other's implementation. No unresolved scope or path decision remains.

### W1: discovery engine and parser

**Worker outcome 1:** A bounded, cross-platform discovery library.

**Owned files:** `src/constants.ts`, `src/config.ts`, `src/paths.ts`, `src/repository-boundary.ts`, `src/adapters/**`, `src/scanner/**`, `tests/fixtures/discovery/**`, `tests/adapters.test.mjs`, `tests/config.test.mjs`, `tests/frontmatter.test.mjs`, and `tests/scanner.test.mjs`.

**Must not edit:** `src/contracts.ts`, catalog/UI files, catalog/UI fixtures, package files, docs, root README, canonical plan, or reports.

**Deliverables:**

- all adapters and shared path helpers;
- safe YAML frontmatter parser;
- policy-preserving bounded scanner with cancellation, symlink handling, traversal limits, and diagnostics;
- read-only Pi package-path resolution that cannot install or refresh;
- deterministic discovery fixtures and tests.

**Validation:** parser, adapter, config, scanner, package-path safety, cross-platform path, and symlink tests.

**Handoff:** `plans/handoffs/pi-skill-catalog-discovery.md`.

### W2: catalog model and native TUI

**Worker outcome 2:** A pure catalog model and searchable/filterable native Pi UI.

**Owned files:** `src/catalog/**`, `src/ui/**`, `tests/fixtures/catalog/**`, `tests/aggregation.test.mjs`, `tests/search-filter-sort.test.mjs`, and `tests/ui.test.mjs`.

**Must not edit:** `src/contracts.ts`, adapters, scanner, parser, discovery fixtures, package files, docs, root README, canonical plan, or reports.

**Prerequisite:** W0 public contracts and fixture specifications are approved. Use test doubles for the discovery result.

**Deliverables:**

- occurrence, exposure, variant, and group aggregation;
- deterministic search, facets, and sort modes;
- `Focusable` catalog component with native `Input` and `SelectList`;
- native `SettingsList` facet selector;
- detail, loading, partial failure, empty, narrow-terminal, and non-TUI states;
- loader disposal, IME focus propagation, theme invalidation, and input-routing tests.

**Validation:** aggregation, collision, search/filter/sort, rendering width, focus propagation, loader disposal, key behavior, and no-custom-list assertions.

**Handoff:** `plans/handoffs/pi-skill-catalog-ui.md`.

### W3: central integration

**Owner:** Integration owner, single writer in the shared tree.

**Writes:** `index.ts`, `package.json`, `tsconfig.json`, integration seams, `tests/fake-pi.mjs`, `tests/extension.test.mjs`, `tests/package.test.mjs`, and canonical plan progress.

**Steps:**

1. inspect W1 and W2 diffs and handoffs;
2. confirm ownership boundaries and resolve contract mismatches centrally;
3. add the Node test runner, `tsx`, and strict no-emit typecheck scripts;
4. register `/skill-catalog` only;
5. connect scan cancellation, Pi runtime metadata, catalog model, loader lifecycle, and TUI;
6. run affected tests after each integration step;
7. run the full package suite after both outcomes are integrated.

**Exit checks:** `npm test` and `npm run typecheck` exist and pass. Actual integrated files match this plan, and no worker introduced mutation, subprocess, network, body indexing, or custom list behavior.

### W4: compatibility and acceptance

**Owner:** Dedicated validation worker or integration owner after W3.

**Writes:** `tests/fixtures/acceptance/**` and new acceptance tests only.

**Coverage:**

- Linux, macOS, and Windows path fixtures;
- `HOME`, `USERPROFILE`, `CODEX_HOME`, and `XDG_CONFIG_HOME` overrides;
- trusted and untrusted project behavior;
- Git worktree `.git` file boundaries;
- per-policy shared-root attribution;
- documented depth differences;
- candidate, directory, entry, depth, and elapsed caps with deterministic partial-result warnings;
- broad extra-root rejection for POSIX, Windows drive, UNC, and home roots;
- 5,000-manifest synthetic scan benchmark with recorded wall time and peak memory;
- installed Pi host smoke test that opens and closes the command without changing settings or files.

**Exit checks:** No fixture path escapes its temporary root. Benchmark regression thresholds are set from the first reviewed baseline rather than guessed in advance.

### W5: documentation and package catalog

**Owner:** Integration owner or one sequential documentation worker.

**Writes:** package `README.md`, `TECHNICAL.md`, `DEVELOPMENT.md`, and repository `README.md` catalog entry only.

**Required content:**

- README: purpose, supported harnesses, installation, `/skill-catalog` first use, controls, read-only/privacy warning, and technical reference link.
- TECHNICAL: full support matrix, config schema, source/status meanings, platform roots, limits, security, compatibility, and troubleshooting.
- DEVELOPMENT: architecture, adapter contract, aggregation rules, UI composition, fixtures, tests, and contributor commands.
- Root README: one entry in the Extensions group.

**Exit checks:** Documentation layers follow `AGENTS.md`, links resolve, install command uses `@firstpick/pi-extension-skill-catalog`, and no internal schemas or source maps leak into user documents.

### W6: review, fixes, report, and completion

1. Run two fresh, read-only reviewers on the integrated result with distinct provider families when available.
2. Ask both to assess architecture, discovery correctness, security, trust, symlinks, path portability, UI behavior, tests, maintainability, and plan compliance.
3. Record each finding in this plan with one disposition: `accepted`, `rejected`, `deferred`, or `needs verification`.
4. Give one fix worker only the accepted findings and exact verification checks.
5. Re-run focused and full validation after fixes.
6. Create `reports/pi-skill-catalog.html` with the `html-report` skill and link it from this plan.
7. Archive this plan only after every completion gate passes.

## 13. Test plan

### 13.1 Parser tests

- valid minimal frontmatter;
- quoted and multiline YAML descriptions;
- CRLF and UTF-8 BOM;
- missing delimiter, name, or description;
- duplicate keys, aliases, custom tags, arrays, maps, and non-string required fields;
- ANSI and control character stripping;
- portable name validation and harness-specific folder matching;
- Antigravity folder fallback;
- frontmatter and file-size bounds;
- no skill-body rendering or indexing.

### 13.2 Adapter tests

- every documented user and project root;
- environment and XDG overrides;
- ancestor walk to Git directory and Git worktree file;
- current `<cwd>/.pi/skills` included and ancestor `.pi/skills` excluded;
- contextual descendant Claude and Cursor roots excluded from version 1;
- untrusted project exclusion;
- shared `.agents/skills` policies retain different per-harness layouts and attribution;
- recursive versus direct-child layouts;
- platform enterprise roots;
- missing harness roots are silent;
- internal managed roots require a valid versioned probe;
- excluded cache and temp paths remain absent.

### 13.3 Scanner tests

- unreadable root and file;
- disappearing file during scan;
- symlinked skill and symlink loop;
- duplicate real paths from aliases;
- direct root Markdown only for Pi-native roots;
- cancellation before and during reads;
- concurrency cap;
- candidate, visited-directory, directory-entry, depth, and elapsed caps with deterministic partial results;
- rejection of home, POSIX root, Windows drive root, and UNC share root as configured recursive roots;
- read-only package-root lookup never reaches install, npm, Git, progress, or network paths;
- stable diagnostics without absolute fixture-host leakage.

### 13.4 Catalog tests

- one physical file retains several exposure paths, root policies, harnesses, scopes, source kinds, and precedence notes;
- identical copies grouped into one variant;
- same-name different-content collision preserved;
- invalid synthetic group does not collide with valid name;
- Pi runtime overlay matches canonical file path and preserves `loaded`, `not-loaded`, and `not-applicable` states;
- AND-token search over all documented fields;
- filter intersections and empty filter meaning all;
- stable name, harness, and path ordering;
- deterministic tie-breakers independent of host locale.

### 13.5 TUI tests

- command registration and no custom tool;
- TUI mode guard before scanning;
- search/list focus routing and `Focusable` propagation to `Input` for IME positioning;
- focus restoration after list rebuilds and filter dialogs;
- native `SelectList` result construction;
- native searchable `SettingsList` filters;
- sort cycling, refresh cancellation, details, clear, close, and empty state;
- widths of 40, 80, 120, and 200 columns;
- no rendered line exceeds available width;
- theme invalidation rebuilds themed strings;
- native loader timers are disposed on success, cancellation, error, refresh, and close;
- descriptions and paths are bounded and ANSI-safe;
- partial scan diagnostics remain visible but compact.

### 13.6 Package and repository checks

Run at minimum:

```bash
cd pi-extension-skill-catalog
npm test
npm run typecheck
npm pack --dry-run --json

cd ..
git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'
```

Also run the repository's standard package catalog/link checks if available, then install from the absolute local package path in a disposable Pi home for the installed-host smoke test. Installation into the user's real Pi environment requires separate explicit approval.

## 14. Performance and resource limits

- Extension factory performs no scan and should add no measurable startup I/O beyond command registration.
- On command open, scan at most 10,000 candidate manifests, 100,000 directories, 500,000 directory entries, depth 32, and 15 seconds of checked elapsed time.
- Reject user-configured roots that resolve to home, a filesystem or drive root, a UNC share root, or another adapter-defined broad root.
- Read at most 1 MiB per manifest and parse at most 256 KiB of frontmatter.
- Keep at most 100 root-level diagnostics and summarize any additional failures by count.
- Limit concurrent file reads to 16.
- Keep one catalog snapshot in memory only while the command is open.
- Do not persist hashes, metadata, search indexes, or query history.
- Establish benchmark thresholds from the reviewed 5,000-manifest fixture baseline, then fail later regressions above 25 percent for wall time or peak memory on the same runner.

## 15. Risks and mitigations

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Vendor paths or depth rules change | High | Isolate rules in adapters, pin evidence dates in DEVELOPMENT, and keep conformance fixtures per harness. |
| "All" implies an unsafe whole-home crawl | High | Define scope explicitly and scan only documented, runtime-proven, or user-configured roots. |
| Plugin marketplace caches look installed | High | Require an enabled-plugin registry or omit the cache. Never infer activation from downloaded files. |
| Same-name skills are silently lost | High | Group by name and hash, preserve variants, and flag collisions. Never key candidates only by name. |
| Project skill leaks from an untrusted repository | High | Gate project roots and project config on `ctx.isProjectTrusted()`. |
| Symlink reads an unexpected file | Medium | Read only exact manifests, show linked and real paths, bound size, prevent cycles, and never follow sibling resources. |
| YAML parser accepts dangerous constructs | Medium | Use non-executing schema, reject tags/aliases/duplicate keys, and render only sanitized scalar metadata. |
| UI freezes on large catalogs | Medium | Async bounded scan, concurrency pool, cancellable loader, pure in-memory query, and benchmark fixture. |
| Native `SelectList` cannot replace items | Medium | Rebuild the native list when view state changes; do not fork or reimplement it. |
| Foreign-harness activation is overstated | Medium | Use "discoverable" and "unknown activation" labels. Claim loaded state only from Pi runtime metadata. |
| Antigravity global path drifts | Medium | Version-gated adapter, project shared root first, and clear adapter diagnostic when no stable root is known. |
| Package overlaps `/skills` manager | Low | Use `/skill-catalog`; keep setup and mutation out of this package. |
| Custom configuration expands read scope | Low | Require explicit paths, reject home/filesystem/drive/UNC roots, trust-gate project config, enforce traversal limits, and never write config. |

## 16. Rollout and rollback

### Rollout

1. Land the new package without installing or enabling it globally.
2. Run fixture, package, and installed-host smoke checks in a disposable Pi home.
3. Publish only after the complex-feature review and report gates pass.
4. Document the exact command and read-only scan boundary before first use.
5. Ask separately before installing the package into the user's real Pi settings.

### Rollback

The extension stores no persistent state and changes no harness files. Rollback is therefore package-level:

- remove or disable `@firstpick/pi-extension-skill-catalog` from Pi settings;
- reload Pi;
- verify `/skill-catalog` is absent.

No migration or data cleanup is required. If a future release adds persistent state or mutation, it needs a new approved plan and migration contract.

## 17. Documentation and evidence links

Planning evidence:

- Pi extension docs: `pi-package-webui/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- Pi skills docs: `pi-package-webui/node_modules/@earendil-works/pi-coding-agent/docs/skills.md`
- Pi TUI docs: `pi-package-webui/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
- Pi package docs: `pi-package-webui/node_modules/@earendil-works/pi-coding-agent/docs/packages.md`
- Native list reference: `@earendil-works/pi-tui` `SelectList` and `SettingsList`
- Existing Pi skill manager: `pi-extension-setup-skills/index.ts`
- Repository documentation rules: `AGENTS.md`
- External harness research artifact: `/home/firstpick/.pi/agent/sessions/--home-firstpick-npm-packages--/subagent-artifacts/outputs/050ad32a-02a9-44a6-9849-07cbc9940e08/harness-skill-docs.md`
- Independent plan review artifact: `/home/firstpick/.pi/agent/sessions/--home-firstpick-npm-packages--/subagent-artifacts/outputs/febec65c-48c1-45a0-99d6-eb6829902cdf/plan-review.md`
- Focused fallback re-review artifact: `/home/firstpick/.pi/agent/sessions/--home-firstpick-npm-packages--/subagent-artifacts/outputs/717239b4-2c83-48f4-b9c1-493d7e7af5ed/plan-rereview-fallback.md`
- Repo Explorer reports:
  - `/home/firstpick/.pi/agent/skills/repo-explorer/repo-explorer-effectiveness-2026-08-21T11-02-22-391Z-npm-packages-6765dda935.md`
  - `/home/firstpick/.pi/agent/skills/repo-explorer/repo-explorer-effectiveness-2026-08-21T11-03-45-950Z-pi-extension-setup-skills-8a6e2ec1bf.md`

Final implementation report: pending at `reports/pi-skill-catalog.html`.

## 18. Decision record

| Date | Decision | Status | Reason |
| --- | --- | --- | --- |
| 2026-08-21 | Create a new package instead of extending `pi-extension-setup-skills` | Approved for plan | Read-only cross-harness cataloging and Pi settings mutation are separate user outcomes. |
| 2026-08-21 | Use `/skill-catalog` | Approved for plan | Avoids collision and confusion with `/skills`. |
| 2026-08-21 | Keep version 1 read-only and human-command-only | Approved for plan | Cataloging does not require model tools or configuration mutation. |
| 2026-08-21 | Use explicit adapters and documented roots, not whole-home search | Approved for plan | Keeps scope predictable, private, and testable. |
| 2026-08-21 | Support eight named harnesses in the initial adapter set | Approved for plan | Current official docs establish native skill locations for them, with Antigravity version-gated. |
| 2026-08-21 | Claim loaded state only for current Pi runtime | Approved for plan | Foreign harnesses lack one stable, safe activation API. |
| 2026-08-21 | Use native `SelectList` and `SettingsList` | Approved for plan | Follows Pi UI conventions and the user rule for Pi package lists. |
| 2026-08-21 | Preserve same-name variants and annotate precedence | Approved for plan | Different harnesses resolve collisions differently, and some do not document a winner. |
| 2026-08-21 | Defer WebUI-native UI, install/sync, and body indexing | Approved for plan | They are separate products with larger security and interface scope. |
| 2026-08-21 | Preserve one exposure policy per harness-root relationship | Approved after plan review | Shared physical roots have different recursion, scope, exclusion, and precedence rules. |
| 2026-08-21 | Exclude contextual descendant Claude and Cursor root discovery from version 1 | Approved after plan review | A workspace-wide search conflicts with the bounded read-only contract. |
| 2026-08-21 | Permit only already-installed local Pi package paths | Approved after plan review | Package source resolution may install, refresh, spawn, or use the network. |
| 2026-08-21 | Reject home, filesystem, drive, and UNC share roots in custom configuration | Approved after plan review | Candidate limits alone do not bound directory traversal. |
| 2026-08-21 | Allow only lifecycle-managed native TUI animation timers | Approved after plan review | `BorderedLoader` uses a timer; discovery and catalog code remain timer-free. |

## 19. Planning review dispositions

| Finding | Disposition | Plan change and evidence |
| --- | --- | --- |
| F1: one merged layout policy corrupts shared-root attribution | accepted | Added per-harness `RootExposurePolicy`; traversal is shared only for identical policies. |
| F2: physical dedup loses aliases and provenance | accepted | Added `SkillExposure[]` to preserve every linked path, root, harness, scope, source kind, layout, and precedence note. |
| F3: ancestor `.pi/skills` overstates Pi discovery | accepted | Limited Pi-native project discovery to `<cwd>/.pi/skills`; ancestor walking applies only to `.agents/skills`. |
| F4: contextual descendant discovery was unbounded | accepted | Deferred descendant Claude/Cursor roots and added directory, entry, depth, and elapsed limits. |
| F5: package resolution could install or refresh | accepted | Prohibited package source resolution; only already-installed local paths are allowed and must have side-effect tests. |
| F6: configured roots allowed home or filesystem sweeps | accepted | Added canonical broad-root rejection for home, POSIX, drive, and UNC roots. |
| F7: Pi loaded state needed three values | accepted | Replaced the boolean with `loaded`, `not-loaded`, and `not-applicable`. |
| F8: native loader contradicted the no-timer rule | accepted | Exempted only lifecycle-managed native loader animation and required disposal on every exit. |
| F9: embedded input omitted IME focus propagation | accepted | Added `Focusable` propagation and focus-restoration tests. |
| F10: DAG and ownership were ambiguous | accepted | Moved public contracts to W0, partitioned fixtures/tests, made W1/W2 parallel, and assigned package files and scripts to W3. |

Reviewer: `reviewer` run `c1ff7719`, artifact linked in section 17. All findings were checked against the local Pi docs, types, source, and the plan before acceptance.

Fallback re-review run `73f2573e` verified F1-F4 and F6-F10. It found one remaining F5 wording contradiction between the filesystem-only statement and the approved read-only Pi APIs. Sections 6.2 and 8.3 now use a closed allowlist containing only `ctx.getSystemPromptOptions()`, `listConfiguredPackages()`, and `getInstalledPath()` beyond read-only Node APIs. Every other package-manager method is forbidden.

## 20. Progress and review record

- [x] Repository conventions and existing Pi skill manager inspected.
- [x] Pi extension, skills, TUI, package, and example documentation inspected.
- [x] Official cross-harness path and format research completed.
- [x] Scope, architecture, safety, UI, tests, and rollout decisions recorded.
- [x] Independent plan review completed and all findings dispositioned.
- [x] Focused fallback re-review completed; its final API-boundary blocker was corrected with a closed allowlist.
- [ ] Implementation authorization received.
- [ ] W0 contracts and fixtures finalized against current vendor versions.
- [ ] W1 discovery outcome completed and integrated.
- [ ] W2 catalog/UI outcome completed and integrated.
- [ ] Acceptance suite completed.
- [ ] Two independent integrated reviews completed and findings dispositioned.
- [ ] Accepted fixes revalidated.
- [ ] Final HTML report created and linked.
- [ ] Plan moved to `plans/archive/` after verified completion.
