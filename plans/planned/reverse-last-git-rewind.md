# Reverse Last — Git-backed rewind and session continuity plan

- **Status:** Proposed; implementation pending
- **Classification:** Complex
- **Feature slug:** `reverse-last-git-rewind`
- **Target package:** [`pi-extension-reverse-last/`](../../pi-extension-reverse-last/)
- **Integration owner:** Primary Pi session
- **Last updated:** 2026-07-28
- **Implementation report:** [`../../reports/reverse-last-git-rewind.html`](../../reports/reverse-last-git-rewind.html) *(to be created during implementation)*

## 1. Goal

Evolve `@firstpick/pi-extension-reverse-last` from a `write`/`edit`-only text undo stack into a safe hybrid rewind system that:

1. preserves the existing `/reverse-last [count]` command and `reverse_last({ count })` tool;
2. reverses completed Bash and shared-worktree subagent changes at honest aggregate boundaries;
3. creates exact Git-backed worktree checkpoints tied to visible Pi session nodes;
4. integrates with `/fork`, `/clone`, `/tree`, `/resume`, and compaction;
5. creates an undo point before every restore;
6. preserves the real Git index and never changes `HEAD` or the current branch;
7. remains useful outside Git repositories through a hardened file-operation fallback.

This is not a line-for-line port of `pi-rewind-hook`. It combines that extension's strongest checkpoint/session concepts with `reverse-last`'s direct command/tool UX, while addressing known performance, submodule, concurrency, and restore-safety hazards.

## 2. Classification rationale

The feature is **complex** because it changes the persistence and restore model, adds Git object/ref management, spans Pi tool and session lifecycles, introduces cross-process concurrency concerns, changes destructive behavior, needs backward-compatible migration, and has multiple independently verifiable implementation slices.

Repository evidence:

- The current implementation is a single 464-line extension with no tests.
- It stores UTF-8 pre-images in mutable per-session JSON and only observes `write` and `edit` (`pi-extension-reverse-last/index.ts:9-172`).
- It directly overwrites or deletes paths during undo without divergence checks or rollback (`index.ts:174-278`).
- Pi provides session-native custom entries, tree/fork hooks, turn/tool hooks, and parent-session lineage, but no core parent hook for child-internal file operations.
- `pi-subagents` exposes optional package event-bus lifecycle signals, but they are not Pi core contracts and do not expose every child mutation or isolated-worktree content.

## 3. Measurable success criteria

1. Existing `/reverse-last`, `/reverse-last N`, and `reverse_last({ count })` invocations remain accepted.
2. Sequential parent `write`, `edit`, and `bash` calls in a Git worktree produce reversible change boundaries.
3. A foreground shared-worktree subagent call is reversible as one aggregate boundary after its parent tool result completes.
4. Known asynchronous shared-worktree subagent activity blocks restore while live and creates a debounced completion checkpoint when a validated lifecycle event arrives.
5. Concurrent sibling mutators are represented as one aggregate boundary; the UI never claims unsafe per-tool attribution.
6. Git snapshots include tracked and untracked non-ignored content, including binary data and executable modes.
7. Snapshot capture and restore leave the real Git index, `HEAD`, branch, and non-extension refs unchanged.
8. Every restore persists an undo snapshot before mutation and verifies the resulting worktree tree against the target.
9. A restore failure attempts rollback, records the outcome, and cancels `/fork` or `/tree` rather than continuing with uncertain files.
10. `/fork`, `/clone`, `/tree`, resume, compaction, and branch-summary checkpoints reconstruct through session-native metadata and validated `parentSession` lineage.
11. Changed submodules, nested repositories, unresolved merges, sparse checkouts, and unsafe path transitions fail closed in the initial release.
12. Non-Git sessions retain a hardened, binary-safe, conflict-aware `write`/`edit` operation undo fallback.
13. Legacy v0.2 JSON stacks migrate idempotently without deleting the original or mutating the worktree.
14. Retention never prunes a current snapshot discovered in the bounded same-repository live set, a restore undo snapshot, or an in-progress restore transaction; incomplete discovery preserves the existing store.
15. Focused unit/integration tests, package checks, package dry-run, concurrent-process tests, and installed-host smoke tests pass.
16. Two independent, fresh-context reviewers from distinct provider families find no unresolved critical/high findings.
17. The final HTML report documents implementation evidence, tests, review dispositions, residual risks, recovery, and rollback.

## 4. Approved working decisions

These defaults are part of this plan unless implementation evidence forces escalation.

| Decision | Working default | Rationale |
|---|---|---|
| Product shape | Hybrid boundary rewind + session-tree checkpoints | Preserves simple undo while gaining Bash/subagent and fork/tree coverage. |
| Git snapshot domain | Tracked + untracked non-ignored worktree content | Matches user-visible coding state while avoiding ignored caches/secrets by default. |
| Real index | Preserve; never restore staged state | Avoids unexpectedly rewriting the user's staging decisions. |
| `HEAD`/branch | Never change | This is worktree rewind, not Git-history manipulation. |
| Git boundary unit | Sequential outer mutator when observable; otherwise one aggregate concurrent batch | Honest attribution under Pi's concurrent tool execution. |
| `/reverse-last N` in Git mode | Reverse the newest `N` contiguous boundaries to the oldest selected boundary's `before` snapshot | Retains count semantics without unsafe non-contiguous replay. |
| Picker | Contiguous suffix only | Arbitrary older selections can clobber newer overlapping work. |
| Non-Git behavior | Hardened local operation journal for `write`/`edit` only | Retains the current package's non-Git value without pretending Bash can be observed exactly. |
| Ignored files | Excluded and disclosed | Git does not snapshot them; restores must not claim complete filesystem backup. |
| Empty directories | Excluded and disclosed | Git tree objects do not represent them. |
| Submodules | Block any restore whose changed paths contain gitlinks | Avoid the destructive submodule failure reported upstream. |
| Nested repositories | Block affected paths | Never recursively delete or overwrite nested `.git` state. |
| Sparse checkout / unresolved index | Restore disabled initially | Semantics require dedicated tests before support. |
| Async writers | Block restore while a validated known shared-repo child is live | Cross-process locks cannot stop arbitrary writers. |
| Retention | Bounded default: 200 unpinned snapshots and 30 days; current/undo/transaction/labeled pins survive | Limits storage and source retention while preserving important recovery points. |
| Rollout | `off` → `observe` → `on`; first release defaults to `observe` | Collect performance/safety evidence before enabling destructive restore integration. |
| Upstream reuse | Concepts only unless copied code receives explicit attribution and license preservation | Avoid accidental uncredited source copying. |

## 5. Scope

### 5.1 In scope

- Git-backed exact worktree snapshot store using a private extension ref.
- Session-native checkpoint and restore ledger.
- Sequential and aggregate mutation boundaries for parent tools.
- Bash effects captured through outer tool boundaries and visible session boundaries.
- Foreground shared-worktree subagent aggregate capture.
- Optional, validated `pi-subagents` async lifecycle adapter.
- `/fork`, `/clone`, `/tree`, compaction, resume, and lineage integration.
- Verified restore, undo, rollback, path/submodule/nested-repository guards.
- Hardened non-Git operation fallback.
- Migration from v0.2 JSON stacks.
- Retention, diagnostics, recovery instructions, tests, and documentation.

### 5.2 Non-goals

- Rewinding Git commits, branches, remotes, `HEAD`, or the real index.
- Capturing ignored files, empty directories, `.git` internals, process side effects, databases, sockets, or external services.
- Observing individual tools inside a child Pi process from the parent extension.
- Capturing unintegrated files in isolated subagent worktrees.
- Guaranteeing attribution while unknown background/external writers mutate the same worktree.
- Recursive submodule initialization, checkout, deletion, or restoration.
- Cross-repository atomic restore.
- Automatic Git garbage collection in the initial release.
- Silent coexistence with another extension that also restores files during `/fork` or `/tree`.

## 6. Coverage contract

| Mutation source | Planned coverage | Exactness shown to user |
|---|---|---|
| Parent sequential `write`/`edit` | Before/after Git boundary in a repository; byte-safe file journal outside Git | Exact boundary |
| Parent sequential `bash` | Before/after whole-worktree boundary around outer tool call/result | Exact if no overlapping writer; otherwise aggregate |
| Concurrent sibling tools | One boundary from first preflight snapshot to final mutator completion | Aggregate |
| Foreground shared-worktree subagent | Outer `subagent` call/result captures all completed child effects in parent repo | Aggregate |
| Async shared-worktree subagent | Start event creates writer lease; completion event triggers debounced capture | Aggregate, integration-dependent |
| Async child without validated lifecycle event | Captured only at next parent-visible/manual boundary | Best effort; warning required |
| Isolated `worktree:true` subagent | No capture of child worktree; later integration into parent repo is captured | Unsupported until integration |
| Child using another repository | Out of scope for current session | Unsupported |
| User `!`/`!!` Bash | Capture pre-state on `user_bash`; close aggregate boundary at next safe event or explicit command | Aggregate-open until closed |
| Background process surviving Bash result | Cannot be guaranteed | Unsupported/live-writer warning |
| External editor/process | Captured only at next checkpoint | Unattributed aggregate |

The status and picker UI must use the exact labels **exact**, **aggregate**, **best effort**, and **unsupported** rather than implying stronger guarantees.

## 7. Architecture

```text
index.ts (Pi registration/composition)
├── configuration + rollout mode
├── mutation boundary coordinator
│   ├── parent tool batch tracking
│   ├── user Bash pending boundary
│   └── optional pi-subagents lifecycle adapter
├── Git snapshot store
│   ├── repository identity
│   ├── temporary-index capture
│   ├── synthetic snapshot commits
│   └── refs/pi-reverse-last/store reachability anchor
├── session ledger
│   ├── visible-node bindings
│   ├── reverse boundaries
│   ├── current/undo state
│   ├── fork/tree handoff
│   └── lineage reconstruction
├── restore coordinator
│   ├── dry run + hazards
│   ├── repo mutation lock
│   ├── undo-first transaction
│   ├── exact worktree restore
│   ├── verification
│   └── rollback
├── non-Git operation journal
├── retention + migration
└── command/tool/UI adapters
```

### 7.1 Proposed package layout

```text
pi-extension-reverse-last/
├── index.ts
├── package.json
├── README.md
├── LICENSE
├── src/
│   ├── config.ts
│   ├── contracts.ts
│   ├── git-runner.ts
│   ├── git-repository.ts
│   ├── snapshot-store.ts
│   ├── session-ledger.ts
│   ├── boundary-coordinator.ts
│   ├── restore-service.ts
│   ├── operation-journal.ts
│   ├── migration.ts
│   ├── retention.ts
│   ├── subagent-adapter.ts
│   ├── commands.ts
│   ├── ui.ts
│   └── status.ts
└── tests/
    ├── helpers/
    │   ├── fake-pi.ts
    │   ├── fake-session.ts
    │   └── git-repo.ts
    ├── operation-journal.test.ts
    ├── snapshot-store.test.ts
    ├── session-ledger.test.ts
    ├── boundary-coordinator.test.ts
    ├── restore-service.test.ts
    ├── migration-retention.test.ts
    ├── subagent-adapter.test.ts
    └── installed-host-harness.test.ts
```

`index.ts` becomes wiring only. Git, ledger, restore, and migration logic must be independently testable.

## 8. Data contracts

All persisted data is versioned and strictly validated. Session custom entries contain IDs, hashes, timestamps, and bounded metadata—never file contents, prompts, command text, or credentials.

### 8.1 Repository identity

```ts
interface RepoIdentityV1 {
  schemaVersion: 1;
  rootHash: string;          // hash of canonical root, not raw path in session JSONL
  commonDirHash: string;     // distinguishes linked/common Git storage
  objectFormat: "sha1" | "sha256";
}
```

Raw canonical paths remain runtime-local. Extension custom entries never store raw repository paths and cannot select an arbitrary repository. Pi's own session header already records `cwd`; this rule is scoped to data added by this extension.

### 8.2 Snapshot reference

```ts
interface SnapshotRefV1 {
  commit: string;
  tree: string;
}
```

Requirements:

- Validate OID syntax against repository object format.
- Verify `commit^{commit}` and its tree before showing or restoring.
- Verify the commit is reachable through the private store or explicitly pinned by a validated in-progress transaction.

### 8.3 Reverse boundary entry

Custom type: `reverse-last-boundary`.

```ts
interface ReverseBoundaryV1 {
  schemaVersion: 1;
  boundaryId: string;
  repo: RepoIdentityV1;
  before: SnapshotRefV1;
  after: SnapshotRefV1;
  source: "write" | "edit" | "bash" | "subagent" | "user-bash" | "turn" | "external";
  exactness: "exact" | "aggregate" | "best-effort";
  toolCallIds?: string[];
  createdAt: number;
}
```

Arrays and strings are bounded. Tool call IDs are metadata only and never used as filesystem or Git arguments.

### 8.4 Visible checkpoint entry

Custom type: `reverse-last-checkpoint`.

```ts
interface VisibleCheckpointV1 {
  schemaVersion: 1;
  repo: RepoIdentityV1;
  entryId: string;
  snapshot: SnapshotRefV1;
  boundary: "user-before" | "assistant-end" | "compaction" | "branch-summary" | "manual";
  createdAt: number;
}
```

### 8.5 Restore transaction entry

Custom type: `reverse-last-restore`.

```ts
interface RestoreTransactionV1 {
  schemaVersion: 1;
  transactionId: string;
  repo: RepoIdentityV1;
  source: "command" | "tool" | "fork" | "tree" | "undo";
  status: "prepared" | "applied" | "rolled-back" | "failed";
  target: SnapshotRefV1;
  undo: SnapshotRefV1;
  consumedBoundaryIds?: string[];
  createdAt: number;
  errorCode?: string;
}
```

A successful restore appends a new immutable status entry; it never edits or deletes prior session entries.

### 8.6 Fork handoff entry

Custom type: `reverse-last-fork-pending`.

```ts
interface ForkPendingV1 {
  schemaVersion: 1;
  targetEntryId: string;
  current: SnapshotRefV1;
  undo?: SnapshotRefV1;
  createdAt: number;
}
```

The child consumes only validated metadata associated with `session_start(reason: "fork")` and the explicit previous/parent session.

### 8.7 Non-Git operation journal

```ts
interface FileOperationV2 {
  schemaVersion: 2;
  id: string;
  sessionId: string;
  toolName: "write" | "edit";
  capturedAt: number;
  files: Array<{
    absolutePath: string;
    existedBefore: boolean;
    beforeBase64?: string;
    beforeMode?: number;
    afterSha256: string | null;
    byteLength: number;
  }>;
  origin: "native-v2" | "migrated-v1";
}
```

State writes use a private `0600` temporary file, `fsync`, and same-directory rename. Read errors are distinct from nonexistence.

## 9. Git snapshot store

### 9.1 Capture algorithm

1. Resolve and canonicalize:
   - `git rev-parse --is-inside-work-tree`;
   - `git rev-parse --show-toplevel`;
   - `git rev-parse --git-common-dir`;
   - `git rev-parse --show-object-format` when available.
2. Reject bare repositories, unresolved roots, changed repository identity, unsupported sparse checkout, or unsafe repository state.
3. Acquire an in-process mutex keyed by canonical Git common directory.
4. Create a private temporary directory outside the worktree and point `GIT_INDEX_FILE` to a new temporary index.
5. Every Git invocation runs from the canonical repository root (explicit `cwd` or `git -C`) and scrubs inherited `GIT_DIR`, `GIT_WORK_TREE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`, and `GIT_CONFIG_*` variables. Add back only the extension-controlled `GIT_INDEX_FILE` and required deterministic identity/config values.
6. Run argument-array Git commands with timeouts and bounded output:
   - `git read-tree --empty`;
   - `git add -A -- .` from canonical root;
   - `git write-tree`.
7. Reuse the prior snapshot commit when the tree OID is unchanged.
8. Otherwise create a parentless synthetic commit with `git commit-tree` and deterministic extension identity.
9. Keep snapshots reachable through `refs/pi-reverse-last/store`. Each incremental keepalive commit uses an empty tree and parents `[previousAnchor, newSnapshot]`; a retention rebuild replaces the chain with a bounded anchor whose parents are exactly the validated live snapshots.
10. Update the private ref with compare-and-swap (`git update-ref <ref> <new> <old>`). A retry must re-read the current ref and rebuild the keepalive/anchor from that fresh value; it must not replay a stale update unchanged.
11. Clean the temporary index/directory in `finally`.
12. Append a boundary/checkpoint only after the commit is reachable.

The real index, `HEAD`, branch, and non-extension refs must be byte/signature checked in tests before and after capture.

### 9.2 Performance controls

- Never run a full worktree capture merely to reconstruct `/resume` state.
- Capture only when a mutation may have occurred or a user explicitly requests a checkpoint.
- Coalesce concurrent sibling tools into one batch.
- Reuse unchanged trees.
- Debounce async completion captures.
- Apply capture timeout and return a truthful skipped-checkpoint diagnostic.
- Bound session-ledger scans by files, bytes, entries, lineage depth, and time.
- No automatic `git gc` in v1.

## 10. Boundary coordinator

### 10.1 Parent tool batches

Pi preflights sibling tool calls sequentially and executes them concurrently. The coordinator therefore tracks a turn-level mutation batch:

1. On the first potentially mutating `tool_call`, capture/reuse the batch `before` snapshot.
2. Add each `write`, `edit`, `bash`, `subagent`, and unknown configured mutator to the active set.
3. Finalize each member on `tool_result`, including error results because a failed tool may still have changed files.
4. When the active mutator set becomes empty, capture `after`.
5. If trees differ:
   - one sequential known tool → source-specific **exact** boundary;
   - overlapping tools → one **aggregate** boundary.
6. If capture fails, emit no boundary and do not bind the previous snapshot as if it were current.

### 10.2 Visible session checkpoints

- First `turn_start` for a prompt: capture/reuse the pre-prompt state. Resolve the triggering node as the newest unbound user entry on the active branch whose text matches the prompt retained from `before_agent_start`; if that identity cannot be proven, record an unbound diagnostic rather than attaching the snapshot to an arbitrary resumed node.
- Each assistant `turn_end`: capture if mutation was possible; otherwise alias the last validated current snapshot.
- `agent_settled`: close any pending aggregate boundary after retries/compaction/follow-ups settle.
- `session_compact`: bind the compaction entry to current validated state without forcing a duplicate scan.
- `session_tree`: bind `summaryEntry.id`, when present, to the resulting current snapshot.

### 10.3 User Bash

`user_bash` has no post-execution event. The initial implementation will:

- capture a pre-state before execution;
- mark an aggregate boundary open;
- close it at the next safe parent event, explicit `/reverse-last checkpoint`, session transition, or `/reverse-last` preflight;
- never claim immediate per-command exactness;
- avoid replacing Bash operations, which could break SSH/sandbox/custom execution extensions.

## 11. Subagent integration

### 11.1 Core behavior without package coupling

- A foreground `subagent` call is treated like any other outer mutating tool.
- Child-internal tools are not visible to the parent extension.
- Shared-worktree effects are captured after the outer tool completes.
- Isolated child worktrees and alternate repositories are not captured.

### 11.2 Optional `pi-subagents` adapter

Current installed `pi-subagents` publishes event-bus channels:

- `subagent:async-started`;
- `subagent:async-complete`;
- `subagent:foreground-complete`;
- `subagent:process-terminal`.

These are package contracts, not Pi core hooks. The adapter must therefore:

1. feature-detect events without importing `pi-subagents` internals;
2. validate lifecycle artifact version and every payload field;
3. canonicalize payload `cwd` and match its Git identity to the active repository;
4. treat any matching async run as a potential writer because payloads do not prove read-only intent;
5. create a live-writer lease on validated start;
6. block restore while a lease is live;
7. clear the lease and schedule one debounced capture on terminal completion;
8. reconcile stale leases against bounded status/artifact evidence and a maximum lease age; after the maximum age, headless mode keeps restore blocked with an actionable error until reconciliation succeeds, while interactive mode may explicitly clear the lease after a warning;
9. expose lease age, reconciliation state, and block reason through `/reverse-last status` and tool errors;
10. degrade to best-effort next-boundary capture when the adapter is unavailable or incompatible.

No hard runtime dependency on `pi-subagents` is introduced in the first release.

## 12. Session ledger and lineage

### 12.1 Reconstruction

On every `session_start`:

1. reset in-memory extension state;
2. resolve repository identity without capturing;
3. parse only the new versioned custom types from the active branch. Legacy v0.2 `customType: "reverse-last"` entries with `data.type: "capture" | "undo"` are audit metadata only and are ignored rather than parsed or migrated;
4. reconstruct visible bindings, unconsumed boundaries, current snapshot, undo snapshot, pending transaction, and migration marker;
5. verify referenced commits lazily before display/restore;
6. follow `parentSession` only when a selected binding is missing locally.

Lineage traversal must use:

- visited-set cycle prevention;
- maximum depth and total bytes;
- allowed session-root containment;
- regular-file/no-unsafe-symlink checks;
- validated header and same-repository identity;
- explicit `previousSessionFile`/`parentSession`, never arbitrary paths from custom data.

### 12.2 Fork/clone

On `session_before_fork`:

- resolve the selected visible checkpoint;
- offer keep files, restore files, restore files only/code-only where the installed host supports it, restore undo, or cancel;
- append validated pending state before replacement;
- cancel on restore failure.

On child `session_start(reason: "fork")`:

- reconstruct ordinary checkpoint entries copied on the selected branch;
- read fork-pending state from `event.previousSessionFile` only: an entry appended during `session_before_fork` is after the selected target and is not expected in the copied child branch;
- require the pending `targetEntryId` to be present in the child's selected branch, match repository identity, and fall within a bounded age/count window;
- consume the latest matching pending state and append child-local current/undo metadata;
- ignore and eventually compact from consideration stale pending records left by cancelled/failed forks;
- do not auto-restore again.

The installed docs describe `skipConversationRestore` as reserved/future-facing. Code-only behavior is a capability-tested feature, not an unconditional promise.

### 12.3 Tree navigation

On `session_before_tree`:

- resolve the target checkpoint;
- show keep current files, restore target files, restore undo, or cancel;
- perform restore before navigation;
- cancel navigation on any restore uncertainty.

On `session_tree`:

- append resulting current/undo metadata;
- if files were kept, bind that exact current state to the resulting leaf;
- alias any generated branch-summary node.

### 12.4 Resume

Resume is metadata-only. It never automatically captures or restores the worktree. If the current worktree differs from the session's recorded current snapshot, status reports divergence and requires an explicit action.

## 13. Restore transaction

### 13.1 Preflight

1. Commands call `ctx.waitForIdle()`; the tool checks the current tool batch and rejects concurrent sibling mutators.
2. Acquire an in-process mutex and a cross-process exclusive lock file under the canonical Git common directory. The lock records bounded PID/session/start metadata, has a timeout and conservative stale-owner recovery, and is held through apply verification or rollback. A second extension process must refuse or serialize its restore; private-ref CAS alone is not a worktree lock.
3. Reject known live async/shared-repo writers.
4. Validate repository identity and target commit/tree.
5. Capture current worktree as undo and make it reachable.
6. Record current real-index signature (`git ls-files --stage -z`) and unresolved entries.
7. Compute NUL-delimited current/target tree differences with modes.
8. Block before mutation when affected paths include:
   - mode `160000` gitlinks/submodules;
   - nested `.git` files/directories;
   - unsafe symlink ancestors;
   - canonical root escape;
   - unmerged index entries;
   - sparse-checkout semantics;
   - ignored/unrepresented path collision;
   - configured path/count/byte limit overflow.
9. Produce a bounded dry-run summary: writes, replacements, deletions, modes, exclusions, and warnings.
10. In interactive flows, require confirmation immediately before mutation.
11. Append `prepared` transaction metadata with target and undo.

### 13.2 Apply

1. Immediately before any deletion or restore, recapture the worktree and require exact equality with the persisted undo tree, recheck the real-index signature, and rerun ignored-path/nested-repository/submodule collision checks. Any drift after preview/confirmation aborts without mutation and requires a fresh preview.
2. Delete only target-absent leaf files/symlinks identified by validated tree diff.
3. Never recursively delete directories; prune only empty ancestors below the repository root.
4. Never touch `.git`, submodule roots, or nested-repository roots.
5. Run `git restore --source=<target> --worktree -- .` without `--staged`, from the canonical root with the scrubbed Git environment.
6. Recapture and require exact target tree equality.
7. Recompute and require unchanged real-index signature.
8. Append `applied` metadata and expose undo.
9. Update current state only after verification.

### 13.3 Failure and rollback

- Attempt restore from undo immediately.
- Verify rollback tree and index.
- Append `rolled-back` or `failed` with bounded error code.
- If rollback fails, disable further restores for the runtime and show immutable target/undo commit IDs plus manual recovery commands.
- Never emit success before target and index verification.

The restore is multi-step and cannot be crash-atomic. Undo-first persistence, conservative deletion, verification, and rollback reduce but do not eliminate power-loss/process-kill risk.

## 14. Command and tool compatibility

### 14.1 `/reverse-last`

Existing forms remain:

- `/reverse-last` — interactive contiguous-boundary picker in Git mode; operation picker outside Git.
- `/reverse-last N` — reverse newest `N` contiguous boundaries/operations.

Additive subcommands:

- `/reverse-last checkpoints` — list visible session checkpoints, read-only.
- `/reverse-last rewind <checkpoint-id>` — dry run, confirmation, restore.
- `/reverse-last rewind-undo` — undo the latest Git restore.
- `/reverse-last checkpoint [label]` — create an explicit boundary/checkpoint.
- `/reverse-last status` — show mode, coverage, repository, live writers, retention, migration, and disabled reasons.

Unsafe arbitrary non-contiguous selection is intentionally removed in both Git and non-Git modes. This narrows the current picker's behavior to prevent stale overlapping snapshots from clobbering newer edits; the migration/release notes must call out the compatibility change. Cancellation causes no mutation.

### 14.2 `reverse_last` tool

Keep `{ count?: number }` valid and preserve `details.steps` and `details.restored`.

Add optional fields:

```ts
{
  count?: number;
  mode?: "reverse" | "checkpoint-status" | "checkpoint-preview" | "checkpoint-restore" | "restore-undo";
  checkpointId?: string;
  confirmationToken?: string;
}
```

Rules:

- Default mode remains `reverse`.
- `count` remains bounded 1–20.
- Destructive checkpoint restore is two-step: preview returns a one-time token bound to session, repo, target, current tree, and expiry.
- Interactive mode also asks the user to confirm.
- Headless mode defaults to refusing explicit checkpoint restore; an LLM-provided boolean is never informed consent.
- Reverse refuses execution when sibling mutators, restore, retention, or live-writer leases are active.
- Result details add exactness, before/after/undo IDs, changed-file summary, and warnings without renaming existing fields.

## 15. Non-Git operation fallback

The fallback retains current value while fixing known hazards:

- use byte buffers/base64 rather than UTF-8 strings;
- distinguish missing, unreadable, directory, symlink, and unsupported file types;
- record post-operation SHA-256 and mode;
- block undo when current fingerprint diverges unless the interactive user explicitly forces it;
- restore through temporary same-directory files and atomic rename when possible;
- remove journal entries only after successful restore;
- allow only LIFO or dependency-closed same-file selections;
- enforce per-file, per-session byte, operation-count, and age limits;
- persist atomically with `0600` permissions;
- never claim Bash/subagent coverage outside Git.

## 16. Legacy migration

Current state path:

```text
${PI_REVERSE_LAST_STATE_DIR || ~/.pi/agent/state/reverse-last}/${sessionId}.json
```

Legacy v0.2 session custom entries (`customType: "reverse-last"`, `data.type: "capture" | "undo"`) contain no restorable content and are ignored. Migration consumes only the external JSON stack described above.

Migration procedure:

1. Run only when no matching migration marker exists.
2. Read with a strict byte limit and validate the v0.2 schema.
3. Reject malformed entries and unsafe paths; never treat read errors as absence.
4. Convert previous UTF-8 strings to v2 byte records.
5. Derive expected post-state conservatively:
   - newest operation for a path expects the current file fingerprint;
   - each older operation expects the next newer pre-image for that path.
6. Mark imported entries `migrated-v1` and require fingerprint match before undo.
7. Skip conflicting/unprovable records with diagnostics rather than guessing.
8. Write v2 state atomically and append a migration marker.
9. Rename the original to `.migrated-v1.<timestamp>.json` only after durable success, or leave it untouched if rename fails.
10. Keep the backup for at least one release cycle.
11. Include source path hash, file hash/mtime, and original session ID in the marker so forks/resumes do not re-import.
12. Migration never modifies the worktree.

Git checkpoint history begins at the current baseline; legacy file pre-images are not fabricated into historical whole-repository snapshots.

## 17. Retention

- Default: retain at most 200 unpinned unique snapshot commits and 30 days.
- Always pin:
  - every current snapshot found by the bounded same-repository session scan;
  - latest restore undo;
  - prepared/incomplete transaction snapshots;
  - pending fork/tree state;
  - explicitly labeled checkpoints when enabled.
- Retention discovery defaults to the active lineage plus a bounded same-repository session scan. If the scan exceeds any file/byte/time/root bound or cannot prove completeness, preserve the existing store ref and skip pruning.
- Retention changes Git reachability only; append-only session metadata remains.
- Missing/pruned commits are hidden from restore choices.
- Rebuild the anchor ref as one bounded empty-tree commit whose parents are exactly the validated live snapshot commits, under the same repo lock and fresh-value CAS discipline.
- Empty, incomplete, timed-out, or failed discovery preserves the existing store ref.
- Never invoke automatic `git gc` in the initial release.
- Provide explicit status and future separately confirmed cleanup; ordinary disable/uninstall does not delete recovery objects.

## 18. Configuration

Proposed global/user settings shape:

```json
{
  "reverseLast": {
    "mode": "observe",
    "operationUndo": {
      "maxOperations": 100,
      "maxFileBytes": 4194304,
      "maxSessionBytes": 33554432,
      "maxAgeDays": 30
    },
    "rewind": {
      "captureTimeoutMs": 15000,
      "restoreTimeoutMs": 30000,
      "maxSnapshots": 200,
      "maxAgeDays": 30,
      "pinLabeledEntries": true,
      "subagentIntegration": "auto",
      "submodulePolicy": "block"
    }
  }
}
```

Modes:

- `off` — hardened non-Git/file-operation undo only; no Git checkpoints.
- `observe` — capture/validate checkpoints and expose status, but do not inject fork/tree restore or execute checkpoint restore.
- `on` — full interactive rewind.

Project-local configuration may narrow limits or disable features but must never relax destructive safety policy.

`PI_REVERSE_LAST_STATE_DIR` remains supported for the non-Git/legacy state directory.

## 19. Coexistence

Installing another extension that also restores files during `/fork` or `/tree` can create duplicate prompts and conflicting mutations. The implementation must:

- document `pi-rewind-hook` as a mutually exclusive fork/tree restore provider;
- detect active session entries or live event handshake when available;
- warn and disable this package's fork/tree integration on confirmed conflict;
- never infer a live conflicting extension solely from a stale Git ref;
- retain `/reverse-last status` and non-conflicting operation behavior where safe.

## 20. Execution DAG and workstreams

All shared-worktree implementation workers run sequentially unless clean isolated worktrees and non-overlapping ownership are explicitly established. The integration owner alone edits this plan and final report.

### Wave 0 — contracts, baseline, and safety spikes

Deliverables:

- freeze persisted schemas and settings;
- build fake Pi/session and real temporary Git test helpers;
- record current command/tool compatibility fixtures;
- record the actual installed Pi host version and capability-test `session_before_fork.entryId/position`, `session_before_tree.preparation.targetId`, `session_tree.summaryEntry`, and `skipConversationRestore` behavior;
- verify which custom entries are copied by `/fork` and `/clone`, and verify fork-pending state is recoverable only from `previousSessionFile`;
- establish and enforce a minimum Git version (recommended baseline: Git 2.29+, covering `git restore` and object-format discovery);
- spike capture/index invariants for unborn HEAD, linked worktrees, symlinks, and large repos;
- confirm package event payloads for optional async subagent adapter.

Stop if exact worktree capture cannot preserve index/HEAD or if installed host lifecycle semantics differ materially from this plan.

### Wave 1A — hardened operation fallback

**Write boundary:** `src/contracts.ts`, `src/config.ts`, `src/operation-journal.ts`, operation tests.

Deliverables:

- byte-safe bounded records;
- after-fingerprint conflict protection;
- atomic persistence/restore;
- safe LIFO/dependency-closed selection;
- compatibility fixtures.

### Wave 1B — Git repository and snapshot store

**Write boundary:** `src/git-runner.ts`, `src/git-repository.ts`, `src/snapshot-store.ts`, Git tests.

Deliverables:

- safe argument-array runner;
- canonical repo/common-dir identity;
- temporary-index capture;
- deduplicated snapshot commits;
- private anchor ref and CAS retries;
- performance instrumentation.

Wave 1A and 1B may run in parallel only with isolated ownership and no shared `package.json`/`index.ts` edits.

### Wave 1C — legacy migration

**Prerequisite:** Wave 1A operation contracts stable.

**Write boundary:** `src/migration.ts`, migration tests.

Deliverables:

- bounded idempotent v0.2 JSON migration;
- explicit ignoring of legacy audit-only custom entries;
- backup and marker behavior;
- no-worktree-mutation and conflict fixtures.

### Wave 2 — session ledger and restore coordinator

**Prerequisites:** Wave 1 integrated and passing.

**Write boundary:** `src/session-ledger.ts`, `src/restore-service.ts`, ledger/restore tests.

Deliverables:

- active-branch reconstruction and lineage;
- versioned immutable entries;
- dry-run/hazard detection;
- undo-first verified restore;
- rollback and recovery;
- submodule/nested-repo/symlink/index guards.

### Wave 3 — boundary and lifecycle integration

**Prerequisites:** restore service proven independently.

**Write boundary:** `src/boundary-coordinator.ts`, `src/subagent-adapter.ts`, lifecycle tests.

Deliverables:

- parent tool batching;
- Bash and foreground subagent aggregate capture;
- async writer leases/completion checkpoints;
- visible user/assistant/compaction bindings;
- fork/tree/resume lifecycle handling.

### Wave 4 — command/tool/UI integration

**Prerequisites:** Wave 3 contract stable.

**Write boundary:** `src/commands.ts`, `src/ui.ts`, `src/status.ts`, `index.ts`, command/tool tests.

Deliverables:

- preserved existing interfaces;
- contiguous picker;
- checkpoint/status/undo subcommands;
- preview/token/confirmation tool protocol;
- `off`/`observe`/`on` wiring.

Only this wave edits `index.ts`.

### Wave 5 — retention

**Write boundary:** `src/retention.ts`, retention tests.

Deliverables:

- bounded same-repository live-set discovery;
- pinning and safe bounded anchor rebuild;
- incomplete-discovery preserve behavior.

### Wave 6 — integrated validation and documentation

- Run all package and monorepo-relevant checks.
- Run installed-host `/reverse-last`, `/fork`, `/clone`, `/tree`, `/resume`, compaction, user Bash, and subagent smoke scenarios.
- Validate package tarball contents and install from the tarball.
- Update `README.md`, package metadata, migration/recovery/rollback guidance.
- Create and strictly validate `reports/reverse-last-git-rewind.html`.

### Wave 7 — independent review and accepted fixes

Obtain two fresh read-only reviewers from distinct provider families and distinct from the primary implementation provider.

Required angles:

1. Git/filesystem correctness, concurrency, data loss, submodule/nested-repo handling, rollback, migration, and retention.
2. Pi lifecycle, fork/tree/resume semantics, Bash/subagent coverage claims, command/tool compatibility, UX, tests, and documentation.

The integration owner dispositions every finding as `accepted`, `rejected`, `deferred`, or `needs verification`, applies only evidence-backed accepted fixes, and reruns affected checks.

## 21. Test matrix

| Area | Required cases |
|---|---|
| Existing behavior | Empty state; one/count undo; count validation; no-UI default; picker cancel; successful/failed/no-op write/edit; restart persistence. |
| Non-Git journal | Binary, zero-byte, BOM/CRLF, executable mode, unreadable path, directory, symlink policy, oversized input, current divergence, same-file stack, atomic-write failure. |
| Git capture | Staged/unstaged/untracked; ignored exclusion; binary; executable bit; symlink; Unicode/whitespace; detached/unborn HEAD decision; linked worktree; dedupe. |
| Git invariants | Index signature unchanged; `HEAD`/branch unchanged; no user refs changed; temporary cleanup; fixed private ref only. |
| Boundaries | Sequential write/edit/bash; failed tool with mutation; overlapping sibling mutators; foreground shared-cwd subagent; no-op child; external change before boundary. |
| User Bash | Pre-state capture; close at next event; cancellation; background-process limitation; no backend override conflict. |
| Async subagents | Validated start/complete; same repo; alternate repo; malformed payload; stale lease; restore blocked live; completion capture deduped. |
| Isolated worktrees | Explicitly excluded; no false parent-worktree change; later patch/merge into parent captured normally. |
| Visible checkpoints | User-before; every assistant end; compaction alias; branch-summary alias; manual label; unchanged-tree reuse. |
| Session lifecycle | Startup; reload; new; resume; fork before/at; clone; root fork; tree keep/restore/cancel; shutdown; no-UI behavior. |
| Lineage | Copied ordinary custom entries; fork-pending read from `previousSessionFile` only; target/age validation; cancelled-fork stale pending; legacy audit entries ignored; parent fallback; multiple generations; deleted/moved parent; cycle; symlink/out-of-root path; repo mismatch; oversized JSONL. |
| Restore | Add/modify/delete/rename; file-directory transition; symlink; mode; no-op; missing commit; stale repo; ignored collision; prepared transaction restart. |
| Hazards | Changed gitlink blocked; nested `.git` blocked; no recursive delete; path escape; unmerged index; sparse checkout; concurrent drift. |
| Rollback | Apply failure before/after delete; verification mismatch; rollback success; rollback failure disables runtime; recovery IDs retained. |
| Concurrency | Two sessions append private ref; two processes attempt restore and the cross-process lock serializes/refuses one; capture versus retention; restore versus capture; sibling tool batch; external mutation after preview/confirmation is caught by immediate pre-apply recapture. |
| Migration | Valid v0.2; malformed/oversized; unsafe path; same-path chain; current mismatch; idempotent marker; backup failure; fork no re-import. |
| Retention | Count/age; current snapshots from multiple same-repo sessions; undo/transaction/label pins; stale session; missing commit; timeout/incomplete scan preserves ref; bounded anchor structure; fresh-value CAS conflict. |
| Compatibility | Existing command text/schema/result fields; intentional non-contiguous-picker narrowing; additive tool modes; actual host event payload contract; Git minimum version; env override; package install/update; conflict with another rewind provider. |
| Performance | Large clean repo; large dirty repo; many untracked files; repeated unchanged boundaries; resume with many ledger entries; timeout and memory bounds. |
| Privacy | State mode `0600`; no contents/prompts/commands/raw repo paths in extension custom entries; disclose that snapshots retain non-ignored untracked content in shared repository object storage; retention/cleanup warning. |

## 22. Validation commands

Final commands may be adjusted to repository conventions established in Wave 0, but the implementation must provide equivalents for:

```bash
cd /home/firstpick/npm-packages/pi-extension-reverse-last
npm test
npm run typecheck
npm pack --dry-run

git -C /home/firstpick/npm-packages diff --check -- \
  pi-extension-reverse-last \
  plans/planned/reverse-last-git-rewind.md
```

Additional harnesses:

- Git minimum-version and scrubbed-environment test;
- concurrent-process store-ref/lock test;
- installed Pi lifecycle smoke test;
- package tarball installation test;
- secret/content scan of session ledger fixtures and generated report;
- measured large-repository capture/resume fixture.

## 23. Rollout

### Phase A — hardened operation release

- Ship operation journal fixes and migration framework.
- Git mode defaults `off`.
- Validate compatibility and non-Git behavior.

### Phase B — observe mode

- Enable Git checkpoint capture and status by default.
- Do not inject fork/tree restore or execute checkpoint restores.
- Measure capture latency, skipped boundaries, storage growth, and false live-writer blocks locally; no telemetry leaves the machine.

### Phase C — interactive opt-in

- Users set mode `on`.
- Enable command, fork/tree, and explicit tool preview/restore flows.
- Continue to block headless implicit restore.

### Phase D — default-on consideration

Only after:

- submodule/nested-repository guards pass;
- rollback/index/concurrency suites pass;
- installed-host lifecycle tests pass;
- performance budgets are met;
- provider-diverse review has no unresolved critical/high findings.

## 24. Rollback and recovery

- Set `reverseLast.mode` to `off` to stop Git capture/restore while preserving hardened operation undo.
- Older releases safely ignore new custom entry types.
- Do not delete session metadata during rollback.
- Keep migrated v0.2 backups for at least one release.
- Leave `refs/pi-reverse-last/store` intact so recorded recovery commits remain reachable.
- Provide documented manual recovery from an undo commit using worktree-only Git commands.
- Private-ref cleanup is a separate explicit, confirmed operation that lists retained snapshots and warns that Git object deletion is deferred until garbage collection.
- If a restore transaction remains `prepared` after a crash, startup reports it and offers recovery; it never auto-applies either target or undo.

## 25. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---:|---|
| Whole-worktree restore destroys unrelated concurrent changes | High | Live-writer block, repo lock, dry run, confirmation, undo-first snapshot, immediate pre-apply verification, post-apply verification. |
| External/background writer is unobservable | High | Honest coverage labels; refuse known live async writers; document unsupported guarantee; manual checkpoint/status. |
| Submodule deletion/restoration loses `.git` data | High | Block changed gitlinks and nested repositories before mutation; no recursive deletion. |
| Partial restore or crash leaves mixed state | High | Persist prepared undo first, leaf-only deletion, rollback, runtime disable on rollback failure, recovery IDs. |
| Real index changes | High | Temporary index capture, worktree-only restore, pre/post index signature assertion. |
| Model tool races sibling mutation | High | Track full preflight batch; reject reverse tool when another mutator is in the same batch or active. |
| Git snapshot retains sensitive untracked source | Medium | Explicit warning, ignored-file exclusion, bounded retention, status/cleanup guidance, no external telemetry. |
| Full `git add -A` is slow | Medium | Mutation gating, coalescing, dedupe, timeouts, no resume capture, observe rollout, performance gates. |
| Session metadata points to stale/pruned commits | Medium | Validate commit existence and hide unavailable checkpoints. |
| Package-private subagent events drift | Medium | Optional feature-detected adapter, strict payload validation/version check, best-effort fallback. |
| Another rewind extension double-restores | Medium | Conflict detection/handshake, disable fork/tree integration, document mutual exclusion. |
| Legacy stack cannot prove old whole-repo state | Medium | Migrate only file-operation records with fingerprints; start Git history at current baseline. |
| Bounded retention surprises users | Low | Status displays retention and unavailable checkpoints; label/current/undo pins; configurable values. |

## 26. Evidence and references

### Local implementation

- [`pi-extension-reverse-last/index.ts`](../../pi-extension-reverse-last/index.ts)
- [`pi-extension-reverse-last/README.md`](../../pi-extension-reverse-last/README.md)
- [`pi-extension-reverse-last/package.json`](../../pi-extension-reverse-last/package.json)

### Authoritative installed Pi documentation

- `pi-package-webui/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `pi-package-webui/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md`
- `pi-package-webui/node_modules/@earendil-works/pi-coding-agent/docs/sessions.md`
- `pi-package-webui/node_modules/@earendil-works/pi-coding-agent/docs/compaction.md`
- `pi-package-webui/node_modules/@earendil-works/pi-coding-agent/docs/packages.md`
- `pi-package-webui/node_modules/@earendil-works/pi-coding-agent/examples/extensions/git-checkpoint.ts`

### Compared upstream design

Pinned revision: [`nicobailon/pi-rewind-hook@9320057`](https://github.com/nicobailon/pi-rewind-hook/tree/93200576b13d48de208cebf3fe8093f1de8abbb3) (v1.8.5).

- [Snapshot/store implementation](https://github.com/nicobailon/pi-rewind-hook/blob/93200576b13d48de208cebf3fe8093f1de8abbb3/index.ts#L464-L620)
- [Session lifecycle integration](https://github.com/nicobailon/pi-rewind-hook/blob/93200576b13d48de208cebf3fe8093f1de8abbb3/index.ts#L1159-L1445)
- [Documented snapshot domain and limitations](https://github.com/nicobailon/pi-rewind-hook/blob/93200576b13d48de208cebf3fe8093f1de8abbb3/README.md#L119-L224)
- [Submodule data-loss report](https://github.com/nicobailon/pi-rewind-hook/issues/10)
- [Closed performance PR describing full-worktree costs](https://github.com/nicobailon/pi-rewind-hook/pull/8)

## 27. Completion record

Implementation is complete only when:

- all success criteria are evidenced;
- the integrated implementation and actual diff match this plan or deviations are recorded;
- migration and rollback have been exercised on fixtures;
- provider-diverse review findings are dispositioned and accepted fixes revalidated;
- the final report is current and strictly validated;
- this plan is moved from `plans/planned/` to `plans/archive/` only after final verification.
