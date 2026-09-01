# APPEND_SYSTEM selector plan

**Status:** Planned, blocked on complex-feature capability waiver  
**Target:** `pi-package-webui`  
**Integration owner:** Main Pi agent  
**Prepared:** 2026-09-01  
**Final report:** [`../../reports/append-system-selector.html`](../../reports/append-system-selector.html)

## Goal

Let a local WebUI user discover exact `APPEND_SYSTEM.md` files below `~/.pi` and the active tab's working directory, choose one with the existing browser-native list, save that choice, and restart the active Pi tab so the selected file becomes its append-system prompt.

## Classification

This remains a **complex feature**. Repository evidence confirms three meaningful slices and a security-sensitive contract boundary:

1. bounded server-side filesystem discovery and selection validation;
2. persisted WebUI settings and Pi child-process argument construction;
3. browser-native selection, restart confirmation, tests, and documentation.

The feature crosses the HTTP/browser boundary and changes the initial system prompt for future Pi processes. This supports the preliminary complex classification rather than contradicting it.

## Success criteria

- Discovery searches `~/.pi` and the active tab cwd to a maximum directory depth of 10.
- Discovery matches the exact case-sensitive filename `APPEND_SYSTEM.md` and does not follow directory symlinks.
- The response is deterministic, bounded, deduplicated, and reports skipped/inaccessible roots without exposing file contents.
- The browser uses the existing `renderNativeSelectorItems` implementation, including filtering and keyboard navigation.
- The current effective choice is visible. A "Use Pi default discovery" choice removes the override.
- Saving accepts only a candidate from a fresh server-side discovery for the requested tab. Browser-supplied arbitrary paths are rejected.
- The selected path is stored in private WebUI settings and passed to Pi as `--append-system-prompt <path>` for newly created or reloaded tabs.
- The server verifies that a persisted override still names a regular `APPEND_SYSTEM.md` file before passing it to Pi. An invalid saved path is not interpreted as inline prompt text and produces a visible diagnostic.
- After a changed save, the browser asks whether to restart the active Pi tab. It never restarts an active/busy tab without confirmation.
- Focused endpoint, persistence, static UI, and restart-flow tests pass, followed by the package checks.
- README, TECHNICAL, and DEVELOPMENT documentation stay in their required user/advanced/contributor layers.

## Scope

### Included

- Localhost-only discovery and mutation endpoints.
- Global WebUI persistence in `~/.pi/webui/settings.json` or `PI_WEBUI_SETTINGS_FILE`.
- Active-tab cwd as the project discovery root.
- One selected override at a time for WebUI-managed Pi tabs.
- Default-discovery rollback option.
- Active-tab restart confirmation after selection.

### Not included

- Editing or creating prompt files.
- Reading prompt contents into the browser.
- Multiple simultaneous append overrides.
- Changing terminal Pi's global or project `APPEND_SYSTEM.md` behavior.
- Following symlinked directories or searching outside the two approved roots.
- Automatically restarting every open tab.
- Applying a changed system prompt to an already-running Pi process without restart.

## Decisions and invariants

### Approved from the request and repository evidence

- The selector lives in WebUI and uses its existing native selector/list code.
- Search depth is 10 directory edges below each root. Each root is depth 0.
- The selected file changes WebUI-managed Pi child startup through Pi's documented repeatable `--append-system-prompt` option.
- The choice is durable WebUI state, not a rewrite or copy of the selected Markdown file.
- A restart means restarting the active Pi RPC tab through the existing `restartTabRpc` path. Restarting the HTTP server is unnecessary.

### Safety invariants

- GET discovery and POST selection require localhost, matching other host-filesystem and global WebUI mutations.
- Discovery never returns file contents.
- Directory symlinks are listed only as skipped entries and are never traversed.
- Candidate count, visited-directory count, and diagnostic count are bounded. The implementation will use explicit constants and deterministic path sorting.
- POST selection canonicalizes and rechecks the target as a regular exact-name file under an approved canonical root. It does not trust a prior browser response by path string alone.
- `buildPiArgsForTab` never passes a missing path to `--append-system-prompt`, because Pi may treat a missing path as literal prompt text.
- Existing `options.piArgs` remain later in the argument list so explicit launcher arguments retain their documented behavior. The selected WebUI override is inserted before them and the final behavior is covered by tests.

### Assumptions

- A user-global WebUI choice is desired. It applies to all newly created or reloaded WebUI tabs, while candidate discovery uses the active tab cwd.
- Choosing "Use Pi default discovery" restores Pi's normal `.pi/APPEND_SYSTEM.md` or `~/.pi/agent/APPEND_SYSTEM.md` lookup.
- Inaccessible directories are skipped and summarized instead of failing the whole scan.

### Rejected or deferred

- Persisting the selection in Pi's `~/.pi/agent/settings.json`: Pi has no documented setting for an append-system file path.
- Copying the chosen file into `~/.pi/agent/APPEND_SYSTEM.md`: that mutates user-authored prompt files and loses source identity.
- Browser-provided arbitrary paths: this bypasses the requested bounded discovery roots.
- Automatic tab restart immediately after selection: the request asks to ask first, and restart can interrupt active work.

## Execution DAG

```text
Wave 1
  A. Discovery and persistence library
  B. Browser selector contract and static test fixture

Wave 2, depends on A
  C. HTTP routes and Pi child startup integration

Wave 3, depends on B and C
  D. Browser save and restart-confirmation integration

Wave 4, depends on A through D
  E. Cross-workstream validation, documentation, reviews, and report
```

## Workstreams and ownership

### Worker 1 handoff: discovery, persistence, and server integration

**Owned files:**

- new `lib/append-system-selection.mjs`
- `lib/git-workflow-preferences.mjs`
- `bin/pi-webui.mjs`
- focused library and HTTP tests

**Deliverable:** bounded discovery, normalized persistence, localhost-only endpoints, fresh selection validation, launch-argument integration, and server-side tests.

**Handoff artifact:** `plans/handoffs/append-system-selector-worker-1.md`

### Worker 2 handoff: browser selector and user flow

**Owned files:**

- `public/app.js`
- focused static/browser tests
- browser asset revisions only when required by the package's cache contract

**Deliverable:** native-list selector, current/default choices, save feedback, explicit restart confirmation, and browser/static tests.

**Handoff artifact:** `plans/handoffs/append-system-selector-worker-2.md`

### Integration owner

The main Pi agent owns shared plan state, integration, documentation, final validation, finding dispositions, report generation, and plan archival. Workers must not edit this plan or each other's files.

## Endpoint and data contract

Proposed localhost-only routes:

- `GET /api/append-system-files?tab=<id>` returns the effective saved choice, canonical roots with display labels, bounded candidates, and bounded scan diagnostics.
- `POST /api/append-system-selection` accepts `{ tabId, path }`, where `path: null` restores Pi default discovery. A non-null path must pass a new bounded scan and exact candidate validation.

A successful changed POST returns `changed: true`, the normalized selection, and `restartRequired: true`. It does not restart the tab. The browser then uses the standard confirmation UI and, after approval, calls a narrow tab-reload action or the existing native reload path. Cancellation leaves the saved choice ready for the next manual reload or new tab.

## Persistence and startup

Add a normalized nullable `appendSystemPromptPath` field to private WebUI settings. Preserve unknown future fields and existing schema compatibility through `normalizeWebuiSettings` and the locked `updateWebuiSettings` path.

At `buildPiArgsForTab` time:

1. read the current persisted WebUI selection;
2. verify the exact filename and regular-file status;
3. verify that it remains under `~/.pi` or the tab cwd within depth 10;
4. append `--append-system-prompt` and the canonical file path;
5. otherwise use normal Pi discovery and expose a bounded warning diagnostic rather than passing an invalid path as prompt text.

## Acceptance checks

### Focused

- Pure discovery tests for depth 0, depth 10, depth 11 exclusion, overlapping roots, symlink directories, inaccessible entries, deterministic ordering, candidate caps, and exact filename matching.
- Settings tests for normalization, merge preservation, save, clear, and custom settings-file behavior.
- HTTP harness tests for localhost restriction, active-tab cwd roots, arbitrary-path rejection, stale/deleted candidate rejection, no-content response, save/clear behavior, and launch args after reload.
- Static UI tests proving the shared native selector is used, the current/default options render, save does not auto-restart, and confirmation gates restart.
- Browser test where practical for keyboard filtering, cancellation, confirmation, and active-tab reload.

### Package-wide

```bash
npm run check
npm test
git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'
```

Run affected Playwright tests when the local browser runtime is available. Record any omitted browser run explicitly.

## Integration and rollback

Integration order is server/persistence first, browser flow second, then docs and full checks. The integration owner inspects actual diffs and reruns cross-workstream tests.

Rollback is data-safe:

1. choose "Use Pi default discovery" and restart the active tab;
2. or remove `appendSystemPromptPath` from private WebUI settings while WebUI is stopped;
3. revert the feature code. Older versions ignore the unknown persisted field, but the migration tests must verify that a later settings write preserves or safely normalizes it according to the package's compatibility policy.

No selected prompt file is modified during apply or rollback.

## Risks

- **Prompt authority:** selecting a file changes high-priority instructions for future Pi turns. The UI must show the full canonical display path before save and restart.
- **Traversal cost:** recursive scans can be expensive. Hard depth, directory, candidate, and diagnostic limits are mandatory.
- **Symlink escape:** traversal must use non-following directory entry metadata and canonical root checks at selection time.
- **Stale selection:** a file can disappear between discovery and child launch. Launch validation must prevent accidental inline-path prompt text.
- **Cross-project surprise:** the persisted choice is global even when discovered from one project. The selector and documentation must say so.
- **Busy restart:** restarting during generation would interrupt work. Existing busy guards plus explicit confirmation remain authoritative.
- **Argument precedence:** user-supplied Pi arguments may contain their own append flags. Tests and documentation must state the resulting layering order.

## Mandatory complex-feature evidence

The contract requires two distinct implementation-worker outcomes and two fresh independent reviews from distinct provider families when available. The current Pi session exposes no `subagent` capability, so these gates cannot run.

Implementation must stop before Wave 1 until the user explicitly either:

- waives the two implementation-worker outcomes and two-reviewer quorum for this feature, allowing direct main-agent implementation and self-review; or
- supplies an approved alternative capability that can produce those outcomes.

No waiver is currently recorded.

## Review and finding disposition

After integration, two fresh read-only reviewers must assess architecture, correctness, security, edge cases, tests, maintainability, and plan compliance unless explicitly waived. Record each reviewer's run identity/provider/model and every finding with severity, evidence, and `accepted`, `rejected`, `deferred`, or `needs verification` disposition in this section.

No review runs or findings yet.

## Progress record

- 2026-09-01: Loaded the feature workflow and complex-feature contract.
- 2026-09-01: Explored server settings, browser-native selector, restart flow, Pi CLI append-prompt support, and documentation conventions.
- 2026-09-01: Confirmed the preliminary complex classification.
- 2026-09-01: Recorded the no-symlink, localhost-only, fresh-validation, default-rollback, and explicit-restart decisions.
- 2026-09-01: Preflight found the required delegated worker and reviewer capability unavailable. Implementation is blocked pending an explicit scoped waiver or approved alternative.

## Completion gate

Do not move this plan to `plans/archive/` until implementation outcomes, integrated validation, current review dispositions, the linked self-contained HTML report, documentation, and any explicit waiver are recorded. Until then, report the feature as incomplete.
