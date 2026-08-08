# Development guide: Aur Review for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## WebUI RPC payload

In RPC mode the extension writes one versioned `setWidget` payload under `aur-review:rpc`:

```text
AUR_REVIEW_RPC_PAYLOAD {"type":"firstpick.pi-extension-aur-review.review","version":3,...}
```

The payload includes the validated `scope` and `origin`. The companion WebUI renderer uses `openGitChangesDialog()` for the live diff and `openFileInViewer()` for report paths. TUI and non-WebUI operation use native select, confirm, editor, and notify APIs instead.

## Inter-extension event

After a durable approval or decline, the extension emits `aur-review:decision` on Pi's extension event bus. Payload type: `firstpick.pi-extension-aur-review.decision`, version `3`, with `repoRoot`, `scope`, `origin`, `fingerprint`, staged-content binding metadata for Guided Git, decision metadata, changed-file metadata, and decline comments when supplied. Event delivery is best-effort; the durable review record remains authoritative.

## Development

```bash
npm test
npm run check
```

## Preserved package internals

`aur-review` is a manual repository/Git review gate for Pi. The compatibility package and command name remain `aur-review`, but it reviews the active Git repository rather than only AUR packages.

A decision is bound to a deterministic snapshot and is refused when that snapshot changes.

## Commands

- `/aur-review` or `/aur-review start [--report path]` — create a standalone `working-tree` review.
- `/aur-review start --scope staged --origin guided-git` — create the canonical Guided Git review for exactly the current index.
- `/aur-review refresh` — create a new snapshot using the stored scope/origin after remediation.
- `/aur-review status` — show the record and whether a pending snapshot remains current.
- `/aur-review approve` — requires Pi-native confirmation and approves only the exact snapshot.
- `/aur-review decline` — requires non-empty multiline editor comments, records the decline, and sends constrained remediation instructions.
- `/aur-review close` — hides/archives the card; never approves anything.

Unknown scope/origin values, unsupported scope/origin pairs, and malformed persisted records fail closed. The only supported pairs are `working-tree`/`standalone` and `staged`/`guided-git`.

Agents can call `aur_review_request` with optional repository-relative `reportPaths`, plus Google-compatible string-enum `scope` and `origin` choices. It never approves changes.

## Snapshot and storage

A standalone `working-tree` fingerprint includes porcelain-v2 status, deterministic staged/unstaged binary diffs, and hashes for untracked files.

A Guided Git `staged` fingerprint includes only the staged/index status and cached binary diff. It also persists a separate, domain-separated SHA-256 `stagedContentHash` of the bounded bytes from `git diff --cached --binary --full-index --no-ext-diff --no-textconv --no-renames --`. Approval/decline binds that exact content hash as well as the review fingerprint. The staged snapshot requires at least one substantive staged change and is intentionally unchanged by unrelated unstaged or untracked files, including unstaged edits to a file that also has staged content. Approval/decline and refresh recapture the stored scope before acting.

Git commands use argv execution only, bounded output, and timeouts. Untracked regular files are hashed through bounded handle reads with actual per-file and aggregate byte accounting; observed replacement or growth fails the snapshot safely. Version-2 review records are atomically written under `${PI_CODING_AGENT_DIR:-~/.pi/agent}/aur-review/v2/reviews`, never inside the reviewed repository. Every read/check/capture/write transition also takes a bounded, token-owned cross-process lock under the adjacent `locks` directory; stale recovery is limited to a dead same-host PID or an old incomplete lock.

Report paths must be regular files inside the repository after symlink resolution, with a 2 MiB per-file cap and a 20-report cap. Candidates are discovered from changed report-like files and conventional report directories. `dev/scripts/aur-scan` is a conventional source for historical scanner reports; its candidates are newest-first and bounded. Browser payloads contain only paths and metadata, never report contents or diffs.

## Guided Git / WebUI integration

When `@firstpick/pi-extension-aur-review` is loaded and enabled in pi-package-webui, Guided Git enters a **Manual staged review** step after either `git add .` or accepting a non-empty current staged set. WebUI sends the canonical staged command to that same tab and keeps the detailed review controls in the `aur-review` card:

- **Review changes** opens Git Changes.
- Report buttons open the file viewer.
- **Approve** and **Decline** use extension-owned native dialogs.

Only a current, matching `staged`/`guided-git` approval for that tab advances Guided Git to commit-message generation. Standalone, stale, malformed, closed, declined, unrelated, and wrong-tab payloads do not advance it. A decline returns Guided Git to staging; remediation must make only requested edits and verify them, without staging, committing, or pushing. Corrected files must then be reviewed/restaged through Guided Git before a new staged review.

If the extension is unavailable or disabled, Guided Git retains its existing staging-to-message behavior.
