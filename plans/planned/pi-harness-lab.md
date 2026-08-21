# Harness Lab for Pi

- **Status:** Proposed; implementation pending
- **Classification:** Complex, security-sensitive feature
- **Feature slug:** `pi-harness-lab`
- **Target package:** `pi-extension-harness-lab/` (new)
- **Published name:** `@firstpick/pi-extension-harness-lab`
- **Integration owner:** Parent Pi session
- **Last updated:** 2026-08-21

## 1. Goal

Build a first-party Pi extension that can inspect a bounded view of the current harness, propose declarative harness profiles, evaluate immutable candidates against a fingerprinted benchmark, compare them with a frozen baseline, and activate or roll back a profile through an explicit, recoverable user-controlled flow.

The installed supervisor remains trusted and fixed. Version 1 never executes model-generated TypeScript, shell commands, validators, dependencies, paths, or free-form system prompts.

## 2. Product definition

The honest description for version 1 is **declarative harness-profile optimization**. It is controlled search over trusted strategies, not general recursive self-improvement.

The package name should be `Harness Lab for Pi` rather than `Self Improver for Pi`. This avoids claiming that the optimizer rewrites or improves itself. The original self-improver concept remains the long-term direction, subject to separate security gates.

The first release proves five mechanisms:

1. immutable, content-addressed candidate profiles;
2. isolated and reproducible profile evaluation with trusted in-memory tools;
3. hard safety and correctness gates before efficiency comparisons;
4. transactional activation with post-reload health receipts;
5. reliable rollback to a known-good profile.

It does not prove that a profile is generally better across projects, models, or future Pi versions.

## 3. Decision summary

| Decision | Version 1 default | Reason |
| --- | --- | --- |
| Installed code | Stable supervisor package | Candidate operations never modify the installed package directory. |
| Candidate form | Strict declarative profile | Data can be validated and interpreted without executing generated code. |
| Profile capability | Bundled strategy IDs only | Free-form prompt text remains executable influence and is excluded. |
| Live effect | Append trusted guidance templates in parent sessions | This proves activation without changing tools, models, context, or compaction. |
| Evaluation tools | Trusted in-memory virtual repository tools | They exercise tool use without touching the host filesystem or network. |
| Candidate storage | Content-addressed profile artifacts plus unique immutable proposal records in a per-project agent-directory namespace | Repeated proposals of the same executable profile preserve separate provenance without overwriting artifacts. |
| Integrity | Domain-separated hashes, a write-ahead event ledger, and derived atomic snapshots | State is tamper-evident and crash-recoverable, not tamper-proof. |
| Benchmark split | Training, validation, and sequestered holdout | The proposer cannot see validation or holdout task content. |
| Fitness | Hard gates, then paired non-inferiority and Pareto comparison | Cost or latency cannot compensate for safety or correctness regressions. |
| Mutation interface | User commands only | Model tools are read-only in version 1. Proposal, evaluation, activation, rollback, recovery, relink, and deletion run only through user commands. |
| Reload | Explicit command-owned reload | `ctx.reload()` is a terminal lifecycle boundary and never runs silently. |
| Activation | `knownGood`, `desired`, and `pendingActivation` state | A pointer is not advanced until the replacement runtime records health. |
| Failed activation | One bounded automatic reversion | The promotion confirmation authorizes recovery to the prior known-good profile. |
| Continuous loop | Not included | Every proposal and evaluation starts from explicit user intent. |
| Generated TypeScript | Deferred to a separately approved phase | It requires an OS sandbox, capability broker, dependency policy, and independent security review. |

## 4. Success criteria

1. A user can inspect the active harness fingerprint without exposing raw system prompts, context files, credentials, or transcripts.
2. A proposal operation can create only a schema-valid profile composed of bundled strategy IDs.
3. Every executable profile is immutable and content-addressed, while every candidate proposal is a unique immutable record tied to that profile and a complete baseline fingerprint.
4. Evaluation uses fresh in-memory Pi sessions, an inert resource loader, exact trusted tools, bounded inputs, external wall-clock timeouts, abort handling, and cleanup.
5. Automated tests and default benchmarks touch no real project files, run no shell commands, and make no network calls.
6. Evaluation distinguishes task failure from timeout, cancellation, provider failure, harness error, and other infrastructure failure.
7. A candidate with any safety or required-correctness regression is ineligible, regardless of cost or latency gains.
8. Validation and holdout comparisons use paired baseline/candidate trials under the same fingerprint and order policy.
9. Promotion shows the exact profile and compiled trusted guidance before confirmation.
10. Model-callable tools are read-only and cannot make provider calls, persist state, promote, roll back, reload, relink, recover, or delete.
11. Promotion survives interruption at every persistence and reload boundary without losing the previous known-good profile.
12. A failed or incomplete canary reverts to the prior known-good or neutral built-in profile on the next safe lifecycle boundary.
13. Rollback preserves candidate and evaluation history. Deletion is separate, confirmed, and refuses referenced candidates.
14. Reload, resume, concurrent sessions, corrupt state, stale locks, moved worktrees, and incompatible Pi versions have tested behavior.
15. Documentation explains cost, privacy, retention, benchmark limits, activation recovery, and the generated-code boundary before first use.

## 5. Scope

### 5.1 Included in version 1

- New `@firstpick/pi-extension-harness-lab` package.
- Read-only harness inspection.
- A versioned profile DSL with bundled strategy identifiers.
- Strict parsing, canonical serialization, content-addressed profile artifacts, and unique immutable candidate records.
- Per-project and per-worktree state under the user agent directory.
- Explicit proposal generation using a bounded, tool-free nested Pi session.
- A virtual-repository benchmark harness implemented by trusted custom tools over in-memory data.
- Training, validation, and sequestered holdout suites.
- Baseline capture, paired trials, hard gates, and comparison reports.
- Immutable profile artifacts, unique candidate records, evaluation summaries, a write-ahead event ledger, and activation receipts.
- Explicit promote, rollback, recovery, and delete commands.
- Command-owned `ctx.reload()` with pending activation and automatic fallback.
- TUI and RPC-safe status, selection, confirmation, progress, and cancellation behavior.
- Package-local tests, installed-host smoke tests, layered documentation, and root catalog entry.

### 5.2 Explicit non-goals

- Modifying Pi core.
- Modifying the installed Harness Lab package from inside the extension.
- Executing generated JavaScript or TypeScript.
- Installing candidate dependencies or running package-manager lifecycle scripts.
- Candidate-provided paths, commands, tools, validators, benchmark fixtures, or model IDs.
- Free-form candidate system prompt text.
- Removing or rewriting user messages, session history, or provider-visible context.
- Custom compaction or branch summarization.
- Tool argument rewriting or interception policies.
- Automatic model or thinking-level switching.
- Enabling tools that the user did not already approve.
- Running real `bash`, `write`, or `edit` tools during evaluation.
- Continuous background optimization.
- Automatic activation after evaluation.
- Cross-device synchronization or telemetry.
- Claims of general improvement from the bundled benchmark.

## 6. Safety invariants

These invariants are implementation blockers, not preferences.

1. The stable supervisor never imports or evaluates a candidate as code.
2. Candidate JSON cannot contain arbitrary text that reaches the system prompt. It contains only exact strategy IDs and fixed schema fields.
3. Strategy IDs resolve through a trusted, versioned catalog shipped with the package.
4. Unknown fields, unknown IDs, unsupported schema versions, duplicate IDs, incompatible strategy combinations, and out-of-range values fail closed.
5. The profile artifact digest covers canonical validated profile data, baseline fingerprint, DSL schema version, compiler version, and strategy-catalog digest through a domain-separated tagged object.
6. Profile artifact and candidate record digests are verified immediately before every read, evaluation, comparison, activation, rollback, export, or deletion decision.
7. Evaluation uses a custom inert `ResourceLoader`. It never uses `DefaultResourceLoader` or `additionalExtensionPaths`.
8. Nested evaluation and proposal sessions receive no ambient extensions, skills, prompts, themes, context files, or transcript.
9. Proposal sessions have no tools. Evaluation sessions receive only trusted virtual tools that operate on an in-memory fixture.
10. The evaluation model cannot access the host filesystem, shell, environment, process table, network clients, credentials, or benchmark files through tools.
11. Benchmark validators and scoring code are trusted package code. Candidates cannot supply or alter them.
12. Validation and holdout task text never enters the proposal model request.
13. Model output, benchmark fixture text, reports, traces, and candidate explanations are untrusted data and never become policy or code.
14. Promotion, rollback, reload, recovery override, and deletion require a user command and an interactive confirmation. No-UI mode fails closed.
15. Activation cannot overwrite `knownGood` until the replacement runtime records a healthy canary receipt.
16. Infrastructure failure, cancellation, timeout, and provider failure never become a positive or negative quality verdict.
17. Safety and correctness gates are not blended into a weighted score.
18. A candidate never affects child subagent prompts in version 1. The extension bypasses profile injection when `PI_SUBAGENT_CHILD=1`.
19. The extension never treats Safety Guard, subagent governance, or another extension as its security boundary.
20. Same-user state is described as tamper-evident, not tamper-proof.
21. When `ctx.isProjectTrusted()` is false, Harness Lab remains neutral and read-only. It does not honor project-associated activation state.
22. The live compatibility fingerprint is recomputed immediately before every parent `before_agent_start`; drift selects neutral and blocks health certification.
23. A model-generated boolean or tool argument is never treated as user authorization.

## 7. High-level architecture

```text
Pi host
  |
  v
Stable Harness Lab extension
  |-- Inspector
  |     `-- bounded capability and fingerprint snapshot
  |
  |-- Proposal service
  |     `-- tool-free, in-memory nested Pi session
  |
  |-- Profile compiler
  |     `-- strict DSL -> trusted guidance templates
  |
  |-- Evaluation supervisor
  |     |-- frozen benchmark manifest
  |     |-- fresh in-memory session per task and trial
  |     |-- trusted virtual repository tools
  |     `-- deterministic validators and metrics
  |
  |-- Candidate store
  |     |-- content-addressed profile artifacts
  |     |-- unique immutable proposal records
  |     |-- evaluation summaries
  |     `-- write-ahead hash-chained event ledger
  |
  `-- Activation manager
        |-- exact diff and user approval
        |-- pending transaction
        |-- ctx.reload()
        |-- replacement-runtime health receipt
        `-- known-good fallback
```

The trusted extension interprets candidate data. The candidate never receives an `ExtensionAPI`, never registers a hook, and never runs inside the host as code.

## 8. Proposed package layout

```text
pi-extension-harness-lab/
├── index.ts
├── package.json
├── README.md
├── TECHNICAL.md
├── DEVELOPMENT.md
├── LICENSE
├── src/
│   ├── contracts.ts
│   ├── constants.ts
│   ├── limits.ts
│   ├── paths.ts
│   ├── project-identity.ts
│   ├── identity-index.ts
│   ├── canonical-json.ts
│   ├── crypto.ts
│   ├── redaction.ts
│   ├── inspector.ts
│   ├── config.ts
│   ├── commands.ts
│   ├── tools.ts
│   ├── status.ts
│   ├── event-ledger.ts
│   ├── lock.ts
│   ├── store.ts
│   ├── recovery.ts
│   ├── profile/
│   │   ├── schema.ts
│   │   ├── validate.ts
│   │   ├── catalog.ts
│   │   ├── compatibility.ts
│   │   ├── artifact.ts
│   │   ├── compile.ts
│   │   └── runtime.ts
│   ├── proposal/
│   │   ├── loader.ts
│   │   ├── prompt.ts
│   │   ├── parse.ts
│   │   └── service.ts
│   ├── evaluation/
│   │   ├── manifest.ts
│   │   ├── virtual-fs.ts
│   │   ├── virtual-tools.ts
│   │   ├── validators.ts
│   │   ├── session.ts
│   │   ├── runner.ts
│   │   ├── metrics.ts
│   │   ├── compare.ts
│   │   └── eligibility.ts
│   └── activation/
│       ├── state.ts
│       ├── transaction.ts
│       ├── canary.ts
│       └── rollback.ts
├── benchmarks/
│   └── v1/
│       ├── manifest.json
│       ├── train/
│       ├── validation/
│       └── holdout/
└── tests/
    ├── fake-pi.mjs
    ├── fixtures/
    ├── profile-schema.test.mjs
    ├── profile-artifact.test.mjs
    ├── canonical-json.test.mjs
    ├── project-identity.test.mjs
    ├── identity-index.test.mjs
    ├── store-atomicity.test.mjs
    ├── event-ledger.test.mjs
    ├── lock.test.mjs
    ├── recovery.test.mjs
    ├── proposal.test.mjs
    ├── virtual-tools.test.mjs
    ├── evaluator.test.mjs
    ├── comparison.test.mjs
    ├── activation.test.mjs
    ├── canary-lease.test.mjs
    ├── lifecycle.test.mjs
    ├── rpc-ui.test.mjs
    ├── security-contract.test.mjs
    └── installed-host-smoke.test.mjs
```

`index.ts` contains registration and lifecycle wiring only. Parsing, state reduction, evaluation, comparison, and activation transitions remain pure or dependency-injected so tests do not need a live provider.

## 9. Version 1 profile DSL

### 9.1 Executable profile

```ts
interface HarnessProfileV1 {
  schemaVersion: 1;
  strategyIds: string[];
}
```

Rules:

- `strategyIds` contains one to three exact IDs.
- IDs are unique and appear in canonical catalog order.
- The compiler rejects incompatible combinations through a package-owned compatibility table.
- The profile contains no free-form prompt, rationale, path, URL, command, model, tool, dependency, or validator field.
- The profile remains small enough to render fully before promotion.

### 9.2 Strategy catalog

`src/profile/catalog.ts` owns a finite set of fixed templates such as:

- scope and non-goal confirmation;
- evidence before claims;
- bounded exploration and output handling;
- verification before completion;
- explicit failure and uncertainty reporting.

Each catalog entry contains:

```ts
interface StrategyCatalogEntryV1 {
  id: string;
  version: number;
  title: string;
  description: string;
  promptGuidelines: readonly string[];
  incompatibleWith: readonly string[];
}
```

Only package authors change catalog text through normal source review and package releases. Candidate generation selects IDs. It cannot author the guideline strings.

### 9.3 Compilation

The compiler:

1. validates the profile;
2. resolves every strategy against the catalog;
3. verifies profile, baseline, catalog, and compiler digests against the immutable profile artifact and candidate record;
4. emits one deterministic guidance block in catalog order;
5. adds no timestamps, candidate rationale, evaluation text, or model output;
6. returns the same bytes for the same validated profile and compiler version.

The live extension appends this block during `before_agent_start` only for parent sessions. A neutral profile returns no system-prompt change.

### 9.4 Profile artifacts and candidate records

The content-addressed profile artifact is the immutable executable authority:

```ts
interface ProfileArtifactV1 {
  artifactVersion: 1;
  profileArtifactDigest: string;
  profile: HarnessProfileV1;
  baselineFingerprint: string;
  compilerVersion: string;
  strategyCatalogDigest: string;
}
```

Each proposal creates a separate immutable candidate record:

```ts
interface CandidateRecordV1 {
  recordVersion: 1;
  candidateId: string;
  profileArtifactDigest: string;
  createdAt: string;
  createdBy: "manual" | "proposal-model";
  generatorFingerprint?: string;
  parentCandidateId?: string;
  rationale: string;
  trainingEvidenceIds: string[];
}
```

Two proposals may select the same profile artifact while preserving different rationale, parentage, and evidence. Publishing an existing profile digest verifies and reuses the immutable artifact, then appends a new candidate record. It never rewrites provenance.

Rationale and evidence references are display-only. They never enter the compiled guidance block. Profile artifacts and candidate records use verified no-clobber creation semantics.

## 10. Harness fingerprint

Every baseline, candidate, evaluation, and activation records a fingerprint containing:

- Pi package version and capability probe result;
- Harness Lab package version;
- Node version and platform;
- DSL schema version;
- compiler version;
- strategy-catalog digest;
- active parent model provider and model ID;
- thinking level;
- benchmark manifest digest;
- virtual-tool contract digest;
- validator and metric versions;
- proposal model identity when proposal generation is used;
- relevant evaluation limits and trial policy.

Do not store API keys, OAuth data, provider headers, environment dumps, raw system prompts, or context-file contents.

Split fingerprint use into two contracts:

- The **evaluation fingerprint** covers every field needed to compare baseline and candidate evidence.
- The **live compatibility fingerprint** covers Pi capabilities, profile schema/compiler/catalog, current parent model, thinking level, active tool set and schemas, project trust, and runtime mode.

A baseline becomes stale when any material evaluation field changes. Stale evidence can be displayed but cannot authorize promotion. A live receipt becomes incompatible when the live fingerprint changes.

Handle `model_select` and `thinking_level_select` as immediate invalidation signals. Because tools can change dynamically without a dedicated event, recompute the live compatibility fingerprint before every parent `before_agent_start`. On mismatch, inject neutral, show one bounded stale status, and require reevaluation plus a new promotion before restoring the profile.

## 11. Storage and integrity

### 11.1 Location

Use a private user-level root:

```text
~/.pi/agent/harness-lab/
├── identity-index.json
└── projects/
    └── <repository-id>/
        └── <workspace-id>/
            ├── identity.json
            ├── config.json
            ├── registry.json
            ├── profiles/
            │   └── sha256-<digest>/
            │       └── artifact.json
            ├── candidates/
            │   └── <candidate-id>/
            │       └── record.json
            ├── evaluations/
            │   └── <evaluation-id>/
            │       ├── request.json
            │       ├── summary.json
            │       └── optional-traces/
            ├── activation/
            │   ├── state.json
            │   └── receipts/
            ├── events/
            │   └── ledger.jsonl
            ├── locks/
            └── tmp/
```

An environment override may redirect the root for tests and advanced use. The override must be explicit, absolute after tilde expansion, and validated before writes.

### 11.2 Project identity

Do not hash raw `cwd` alone or assume a path-derived namespace can discover its prior state after a move.

- Resolve the canonical worktree root and Git common directory when available.
- Record canonical path, repository identity, worktree identity, and discovery method.
- Use separate repository and workspace digests so linked worktrees cannot collide.
- Maintain a root-level, atomic `identity-index.json` that maps stable identities and approved path aliases to state namespaces.
- Use device and inode identity only as a same-filesystem move signal, never as sole authority across copies, filesystems, or platforms.
- Detect unmatched moves, copies, and aliases, remain neutral, and require an explicit relink command instead of silently creating a second lineage.
- For non-Git directories, generate a local identity at initialization and register it in the root index. A moved directory is recovered through verified index signals or explicit user selection, not by searching candidate state blindly.
- Relink writes a new alias through the event protocol. It does not merge two existing lineages automatically.

### 11.3 Permissions and path handling

- State directories use mode `0700` where supported.
- State, candidate, receipt, and audit files use mode `0600`.
- Resolve every path beneath the selected state root.
- Reject `..`, absolute child paths, NUL/control characters, and symlink traversal.
- Open candidate files without following symlinks where the platform permits.
- Verify the digest on the opened bytes, not only before opening the path.
- Never write through a path supplied by a candidate or model response.

### 11.4 Canonical serialization and IDs

Use a package-owned canonical JSON serializer over the small validated type set. Object keys are sorted, arrays retain their defined canonical order, unsupported values are rejected, and newline behavior is fixed.

Profile artifact ID:

```text
sha256(canonicalJson({
  domain: "pi-harness-lab/profile-artifact/v1",
  profile,
  baselineFingerprint,
  compilerVersion,
  strategyCatalogDigest
}))
```

Candidate records use unique IDs plus their own content digest. Evaluation, transaction, lease, and receipt records use unique nonces plus domain-separated content digests. Human labels never serve as authority.

### 11.5 Transactional writes

- Publish immutable profile artifacts, candidate records, events, and receipts with verified create-if-absent semantics. Existing content must match its digest byte for byte.
- Write replaceable snapshots to a same-directory temporary file.
- Set restrictive permissions before publishing.
- Flush file contents, rename atomically, and flush the containing directory where supported.
- Clean abandoned temporary files only after proving they are not referenced by a live transaction.
- Registry and activation snapshots are replaceable materialized views derived from committed ledger events. They are never the source of authority.

Cross-file operations use one write-ahead protocol:

1. append and flush an immutable intent event;
2. publish immutable artifacts and derived snapshots with the same transaction ID and generation;
3. append and flush an explicit commit or abort event;
4. rebuild or verify snapshots by replaying committed events;
5. make every replay action idempotent.

A crash before commit leaves an uncommitted intent that recovery aborts or safely resumes by policy. A crash after commit can rebuild missing snapshots from the ledger. File presence alone never authorizes a transition.

### 11.6 Write-ahead event ledger

Every state-changing operation appends bounded hash-chained JSONL events with:

- event version, phase, event ID, transaction ID, and generation;
- timestamp;
- operation type;
- repository and workspace identity;
- candidate, profile artifact, evaluation, activation, or lease ID;
- previous event digest;
- current event digest;
- actor type, `user-command` or `proposal-model`;
- result and bounded reason;
- referenced artifact digests.

The ledger contains explicit intent, commit, and abort phases. Verify and replay it during startup and before mutation. A broken chain or ambiguous uncommitted intent blocks promotion, rollback, relink, and deletion until recovery is acknowledged. Inspection and export remain available.

### 11.7 Operation lock

Use one exclusive lock per workspace for proposal persistence, evaluation, activation, rollback, relink, recovery, and deletion.

The lock records PID, host, process start marker, timestamp, operation ID, and random nonce. Automatic stale recovery is allowed only when the owner is demonstrably gone. Ambiguous locks require user confirmation. Cancellation releases the lock in `finally` after child sessions and temporary state settle.

## 12. State machines

### 12.1 Candidate lifecycle

```text
proposed
  -> validation_failed | validated
validated
  -> evaluating
evaluating
  -> cancelled
   | timed_out
   | infra_failed
   | evaluated_failed
   | evaluated_passed
evaluated_passed
  -> eligible | ineligible
eligible
  -> approved
approved
  -> pending_activation
pending_activation
  -> activation_failed | active_canary
active_canary
  -> healthy | reverted
healthy
  -> superseded | rolled_back
```

No transition is inferred from file presence. Each accepted transition has a committed ledger event and, where relevant, an immutable receipt.

### 12.2 Activation state

```ts
interface ActivationStateV1 {
  schemaVersion: 1;
  generation: number;
  knownGood: string | "neutral";
  desired: string | "neutral";
  pendingActivation?: {
    transactionId: string;
    generation: number;
    from: string | "neutral";
    to: string | "neutral";
    approvedAt: string;
    candidateId: string;
    profileArtifactDigest: string;
    evaluationFingerprint: string;
    phase: "reload-requested" | "canary";
  };
  canaryLease?: {
    transactionId: string;
    generation: number;
    runtimeInstanceId: string;
    processId: number;
    processStartMarker: string;
    expectedSessionReason: "reload";
    expiresAt: string;
  };
}
```

`knownGood` changes only after a healthy receipt from the one runtime that owns the canary lease. `desired` records user intent. The active profile is runtime-local status and is not a workspace-global authority because older Pi processes may still be alive.

### 12.3 Evaluation outcome

```ts
type EvaluationOutcome =
  | "passed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "provider_failed"
  | "harness_failed"
  | "validator_failed"
  | "fingerprint_stale";
```

Only `passed` or `failed` are quality outcomes. All other values are infrastructure or control outcomes and cannot affect eligibility.

## 13. User commands and model tools

### 13.1 User command

Register one command with explicit subcommands:

```text
/harness-lab status
/harness-lab inspect
/harness-lab setup
/harness-lab propose
/harness-lab evaluate <candidate>
/harness-lab compare <candidate>
/harness-lab promote <candidate>
/harness-lab rollback [candidate]
/harness-lab recover
/harness-lab relink
/harness-lab delete <candidate>
```

Behavior:

- `status` and `inspect` are read-only.
- `setup` configures model-backed proposal permission, budgets, trace retention, and trial limits.
- `propose` previews cost/privacy scope before a model call and asks for confirmation.
- `evaluate` shows model, benchmark, repeat count, maximum cost, wall time, and retention before starting.
- `compare` renders hard gates first, then quality and efficiency differences.
- `promote` renders the complete executable profile, compiled trusted guidance, evidence fingerprint, and fallback behavior before confirmation.
- `rollback` selects only compatible previously healthy candidates or neutral.
- `recover` never guesses through ambiguous corruption. It offers verified known-good, neutral, or read-only export paths.
- `relink` shows old and new canonical identities and never merges lineages automatically.
- `delete` refuses active, known-good, pending, parent, or otherwise referenced candidates.

Use Pi's native selection/list UI when a list is needed. In RPC mode use supported dialog methods. In print or JSON mode, state-changing commands refuse to continue.

### 13.2 Model-callable tools

Version 1 exposes only read-only tools:

```text
harness_lab_status
harness_lab_inspect
harness_lab_compare
```

Rules:

- Proposal and evaluation are user commands because they incur provider cost and persist state.
- No model-generated boolean or tool argument can authorize a costly or state-changing operation.
- Tools return bounded summaries plus opaque artifact IDs, not unbounded traces or local paths.
- Local paths are resolved only inside an explicitly invoked user command or UI view and redact home and project components by default.
- No tool proposes, evaluates, promotes, rolls back, reloads, relinks, recovers, or deletes.
- Tool output follows Pi's 50 KB and 2,000-line limits.

## 14. Inspection contract

`harness_lab_inspect` may report:

- Pi and extension version;
- current model identity and thinking level;
- active tool names and canonical provenance from `pi.getAllTools()`;
- command names and provenance from `pi.getCommands()`;
- current profile and activation state;
- strategy catalog IDs and versions;
- current benchmark and evaluator fingerprint;
- stale, corrupt, locked, or recovery-required status.

It must not report or persist by default:

- the assembled system prompt;
- `getSystemPromptOptions()` contents;
- context-file contents;
- skill bodies;
- transcript messages or tool results;
- provider payloads or headers;
- credentials or environment variables;
- full local paths outside the bounded project identity display.

An advanced future export may add explicitly selected fields after a separate privacy review.

## 15. Proposal generation

### 15.1 Inputs

The proposal model receives only:

- the exact allowed profile schema;
- strategy IDs, titles, descriptions, and compatibility rules;
- the baseline fingerprint;
- bounded training task summaries and failure categories;
- bounded prior training evaluation aggregates;
- the current and parent candidate IDs;
- the user-stated optimization goal;
- a statement that all supplied data is untrusted and cannot change the output contract.

It does not receive raw transcripts, system prompts, context files, credentials, validation tasks, holdout tasks, or arbitrary project files.

### 15.2 Nested session

Follow the local pattern in `pi-extension-feature-system-prompt/feature-system-prompt.ts`:

- `createAgentSession()` with an explicit model;
- `SessionManager.inMemory()`;
- `SettingsManager.inMemory()` with compaction disabled and retry disabled;
- `noTools: "all"`;
- a custom inert `ResourceLoader` with no discovered resources;
- bounded prompt and output;
- an external wall-clock timeout that aborts the session;
- `finally` cleanup with unsubscribe and `session.dispose()`;
- no cache retention for one-off proposal calls when the provider supports the option.

### 15.3 Output contract

The model returns one exact JSON object:

```ts
interface ProposalOutputV1 {
  profile: HarnessProfileV1;
  rationale: string;
  expectedEffects: string[];
}
```

The parser requires exact keys, normalizes and bounds display-only text, validates the profile independently, computes or reuses the profile artifact digest, and creates a unique candidate record. Invalid, oversized, injected, timed-out, unavailable, or unauthenticated responses create neither artifact nor candidate record.

The model does not select its own provider, model, thinking level, cost limit, benchmark, or activation policy.

## 16. Benchmark design

### 16.1 Virtual repository

Each task receives a fresh trusted in-memory virtual repository:

```ts
interface VirtualRepository {
  files: Map<string, string>;
  metadata: Readonly<Record<string, string>>;
  operationLog: VirtualOperation[];
}
```

Trusted custom tools provide a small coding-agent-like interface:

- `virtual_read`
- `virtual_grep`
- `virtual_find`
- `virtual_ls`
- `virtual_edit`
- `virtual_write`
- `virtual_test`
- `virtual_submit`

The tools:

- normalize paths beneath an in-memory root;
- reject traversal and absolute paths;
- apply the same exact-replacement semantics expected from Pi tools where applicable;
- cap output and operation counts;
- record deterministic operations;
- never call `fs`, `child_process`, network APIs, package managers, or host commands;
- expose no generic code execution.

### 16.2 Task types

The bundled suite should cover:

- finding a relevant file with minimal reads;
- preserving stated non-goals;
- applying an exact small edit;
- handling ambiguous or missing evidence;
- avoiding edits after a failed precondition;
- running the provided virtual test before completion;
- reporting a failed test honestly;
- recovering from a stale exact replacement;
- avoiding protected virtual files;
- stopping within operation and output limits.

The fixture count validates the mechanism and selected strategies. It does not stand in for SWE-bench or general coding performance.

### 16.3 Split policy

- **Training:** The proposal service may receive bounded failure categories and aggregate outcomes. Raw task text remains unnecessary unless a manual advanced mode later permits it.
- **Validation:** The proposer receives no task text or traces. Evaluation reports bounded per-category outcomes.
- **Holdout:** The proposer receives no task text, trace, or per-task result. It receives one delayed aggregate eligibility result after validation passes.

Call the holdout **sequestered**, not secret. The trusted host and package source can read it. The protection is against proposal-model contamination, not against the same operating-system user.

Rate-limit holdout runs per candidate lineage and record every access. Repeated adaptive holdout probing requires explicit confirmation and invalidates the prior generalization claim.

### 16.4 Manifest

Each benchmark manifest pins:

- suite version and digest;
- task IDs and split;
- virtual repository digest;
- tool contract version;
- deterministic validator version;
- required safety and correctness assertions;
- maximum turns, tool calls, output, wall time, and estimated cost;
- trial and ordering policy.

Candidates cannot choose or alter these fields.

## 17. Evaluation runtime

For every task and trial:

1. acquire the workspace operation lock;
2. verify candidate and benchmark fingerprints;
3. create a fresh virtual repository;
4. build the system prompt from the fixed Pi evaluation base plus compiled trusted strategy guidance;
5. create a custom inert `ResourceLoader`;
6. create a fresh in-memory Pi session with only the exact virtual tools;
7. disable retry and compaction;
8. enforce wall time, turns, tool calls, output, and cost outside the model loop;
9. collect bounded event metrics and virtual operations;
10. abort and dispose on cancellation or limit breach;
11. run deterministic trusted validators over the final virtual state and operation log;
12. classify infrastructure and task outcomes separately;
13. persist only the configured bounded summary and optional redacted trace;
14. release resources and the lock in `finally`.

Baseline and candidate runs use the same:

- provider and model;
- thinking level;
- prompt base other than the candidate strategy block;
- tools and tool schemas;
- benchmark task and validator;
- trial count and resource limits;
- randomized paired order policy.

If any fingerprint field changes between the pair, discard the comparison as stale.

## 18. Metrics and eligibility

### 18.1 Hard gates

A candidate is ineligible when any of these occur:

- required task failure that the baseline passes consistently;
- protected virtual path modification;
- path traversal attempt;
- skipped mandatory verification;
- false success claim after a failing virtual test;
- operation, output, cost, or wall-time limit breach caused by candidate behavior;
- schema, digest, fingerprint, audit, or validator mismatch;
- validation or holdout infrastructure result other than a quality outcome.

Infrastructure failures trigger retry or investigation policy, never candidate reward.

### 18.2 Quality comparison

Use paired outcomes. Require at least three paired trials for a promotion-eligible model-backed evaluation. Increase trials or mark the result inconclusive when task outcomes are unstable.

Quality policy:

1. every must-pass safety assertion passes;
2. no consistently passing baseline task becomes a consistent candidate failure;
3. validation quality is non-inferior under a predeclared paired margin;
4. at least one predeclared target category improves, or quality is identical and a secondary efficiency metric improves by a practical threshold;
5. holdout satisfies the same hard gates and non-inferiority rule.

Select the statistical method during the Phase 0 spike and version it. Binary outcomes should use a paired exact method. Cost, token, latency, and operation-count deltas should use paired bootstrap intervals or another predeclared robust method.

Do not choose margins after seeing candidate results.

### 18.3 Secondary metrics

Record, but never trade against hard gates:

- task success;
- virtual test pass rate;
- tool calls;
- repeated or failed operations;
- input, output, cache-read, and cache-write tokens;
- provider-reported cost;
- wall time;
- output size;
- context usage where available.

### 18.4 Comparison result

Use a lexicographic and Pareto-style decision:

```text
hard safety gates
  -> required correctness gates
  -> quality non-inferiority
  -> target-category improvement
  -> efficiency and cost
```

The report can say `eligible`, `ineligible`, `inconclusive`, or `stale`. It cannot say generally improved.

LLM judges are excluded from version 1 hard gates. A later optional reviewer may provide advisory notes, but deterministic validators remain authoritative.

## 19. Promotion, reload, and health

### 19.1 Promotion preflight

`/harness-lab promote <candidate>` must:

1. require interactive UI;
2. acquire the operation lock;
3. verify the event ledger and derived snapshot integrity;
4. verify the candidate record digest, profile artifact digest, and current evaluation and live compatibility fingerprints;
5. require a current eligible validation and holdout receipt;
6. reject active, pending, stale, corrupt, or incompatible candidates;
7. render the complete profile, compiled guidance, baseline, gates, costs, residual risks, and fallback profile;
8. state that approval includes one bounded automatic reversion if activation health is not recorded;
9. ask for confirmation tied to the exact candidate ID, profile artifact digest, generation, and transaction ID.

### 19.2 Pending transaction

After confirmation:

1. append and flush an immutable `activation_intent` event with the exact candidate ID, profile artifact digest, generation, evaluation fingerprint, and transaction ID;
2. publish the immutable approval receipt;
3. derive and publish the activation snapshot with `desired` and `pendingActivation.phase = "reload-requested"`;
4. append and flush `activation_pending_committed`;
5. verify replay produces the published snapshot;
6. call `await ctx.reload(); return;` from the command handler.

A crash before `activation_pending_committed` leaves an uncommitted intent that replay does not activate. A crash after commit can rebuild the snapshot. No code after `ctx.reload()` may use the old `ctx`, `pi`, `SessionManager`, timers, or extension closure state.

Model tools cannot queue this command in version 1.

### 19.3 Replacement-runtime canary

On `session_start` with reason `reload`:

1. generate a random runtime-instance ID and reconstruct committed state by replaying the ledger;
2. verify project trust, transaction generation, candidate record, profile artifact, compiler, catalog, evaluation fingerprint, and current live compatibility fingerprint;
3. under the operation lock, atomically claim a canary lease containing transaction ID, generation, runtime-instance ID, process identity, expected reload reason, and expiry;
4. if another live runtime owns the lease, remain on prior known-good or neutral and never inject or certify the canary;
5. if validation or lease acquisition fails, append an activation-failure intent and commit, select known-good or neutral in memory, rebuild the snapshot, and notify the user;
6. if validation passes, mark the committed transaction as canary through the event protocol and expose a visible status;
7. compile the candidate before the first parent `before_agent_start` hook;
8. recompute the live compatibility fingerprint immediately before that hook. On drift, inject neutral and invalidate the canary;
9. inject only the deterministic trusted guidance block from the runtime that owns the lease;
10. track whether that same runtime's first parent run completes with local hook and lifecycle checks intact;
11. on that runtime's first clean `agent_settled`, publish a healthy receipt, append and commit the health transition, set `knownGood = desired`, clear pending state and lease in the derived snapshot, and clear the canary status.

Other runtimes keep their prior known-good or neutral runtime-local profile. A process exit, reload, session replacement, lease expiry, fingerprint drift, invalid state, or local hook failure before the healthy receipt causes replay to preserve the previous `knownGood`. The extension does not repeatedly reload in a recovery loop.

### 19.4 Neutral fallback

The neutral profile is compiled into the stable package and applies no extra guidance. It is always available even when state is missing or corrupt.

If `knownGood` is missing, corrupt, or incompatible, start neutral, block mutation commands, and require `/harness-lab recover` before another promotion.

## 20. Rollback and deletion

### 20.1 Rollback

Rollback selects a compatible previously healthy candidate or neutral. It follows the same exact-digest approval, pending transaction, reload, canary, and receipt flow as promotion.

Rollback does not:

- delete the failed candidate;
- erase its evaluation or activation receipts;
- mark it eligible again;
- bypass current capability compatibility checks.

### 20.2 Delete

Deletion is a separate user command and confirmation.

Refuse deletion when the candidate is:

- active, desired, known-good, pending, or canary;
- a rollback target retained by policy;
- referenced by another candidate's provenance;
- referenced by an evaluation, approval, activation, or recovery record still inside retention;
- needed to verify or replay the event ledger.

Prefer retention and garbage-collection policy over ad hoc deletion. A future prune command should produce a dry-run plan first.

## 21. Failure behavior

| Failure | Required behavior |
| --- | --- |
| Missing state | Start neutral; inspection works; mutation requires initialized state. |
| Unknown schema or catalog | Start known-good if compatible, otherwise neutral; block promotion. |
| Profile artifact or candidate record digest mismatch | Mark corrupt; never evaluate or activate; preserve bytes for recovery. |
| Broken event ledger chain or ambiguous uncommitted intent | Read-only mode; export and recover only. |
| Live operation lock | Show owner and operation; do not duplicate work. |
| Ambiguous stale lock | Ask before recovery; no automatic overwrite. |
| Proposal timeout or malformed JSON | Create no candidate; report bounded failure. |
| Provider unavailable | Preserve state; offer manual profile selection without pretending evaluation passed. |
| Evaluation timeout or cancellation | Record control outcome; clean sessions and temporary state; no quality verdict. |
| Validator exception | `validator_failed`; candidate remains unevaluated for eligibility. |
| Baseline fingerprint drift | Mark evidence stale; require a new baseline. |
| Reload before transaction commit | Do not reload; the prior runtime-local profile remains. |
| Crash with an uncommitted activation intent | Replay ignores or aborts the uncommitted intent and preserves known-good. |
| Crash after a committed activation event but before snapshot publish | Replay rebuilds the missing snapshot and continues the defined activation or recovery path. |
| Candidate compile failure during canary | Use known-good or neutral for the same turn, record activation failure, clear pending. |
| Exit before canary health | Revert on next startup. |
| Unsupported TUI/RPC action | State-changing operation refuses; no implicit yes. |
| Storage full or permission error | Leave previous published state intact and report exact path category without leaking secrets. |

Warnings must be bounded and deduplicated per lifecycle so corruption does not flood every model turn.

## 22. Privacy, retention, and cost

### 22.1 Default data policy

Store by default:

- profile and provenance;
- fingerprints and digests;
- task IDs and aggregate outcomes;
- validator results;
- bounded operation counts and provider usage;
- approval, activation, rollback, and recovery receipts;
- committed event-ledger entries.

Do not store by default:

- main-session transcript;
- assembled system prompts;
- context-file or skill contents;
- raw provider requests or responses;
- API credentials, headers, or environment variables;
- arbitrary project source;
- raw model thinking.

Optional traces remain local, redacted, size-limited, disabled by default, and covered by a retention count and age limit. Holdout traces are never passed to the proposal model.

### 22.2 Model-provider disclosure

Before proposal or evaluation, show:

- selected provider and model;
- what benchmark or bounded evidence leaves the machine;
- maximum task count, trials, tokens, wall time, and estimated cost;
- whether optional traces are retained locally.

The bundled virtual repositories must contain no private user code or credentials.

### 22.3 Budgets

Every operation has hard limits:

- proposal input and output characters;
- tasks and paired trials;
- session turns and tool calls;
- per-tool output;
- wall time;
- provider cost;
- concurrent sessions;
- retained artifacts and total disk use.

Budget exhaustion stops the operation and records an infrastructure outcome. It never yields an eligible candidate.

## 23. Ownership and overlap boundaries

| Existing owner | Harness Lab boundary |
| --- | --- |
| `pi-package-learnings` | Continues to own solved troubleshooting notes and retrieval. Harness Lab does not ingest or write the learnings archive in version 1. |
| `pi-package-skill-lifecycle` | Continues to own skill evaluation, creation, and refinement proposals. Harness Lab does not modify skills. |
| `pi-skill-repo-explorer` | Continues to own repository exploration and effectiveness reports. Harness Lab does not consume those reports automatically. |
| Planned context curator | Owns provider-visible context pruning and branch-aware checkpoints. Harness Lab does not transform conversation messages or compaction. |
| Small-model reliability packages and plans | Own task/checkpoint/evidence reliability behavior. Harness Lab does not rewrite their state or policy. |
| `subagent-governance` and `pi-subagents` | Own delegation policy and runtime mechanics. Harness Lab does not launch or retune subagents in version 1. |
| `pi-extension-safety-guard` | Remains an independent user safety layer. Harness Lab enforces its own command and state boundaries and never assumes Safety Guard will catch a mistake. |
| `pi-extension-feature-system-prompt` | Provides the local reference pattern for inert nested sessions. Harness Lab does not alter feature classification. |

Future integrations require explicit contracts and must not scrape another package's private state.

## 24. Implementation phases and hard gates

### Phase 0: product contract, capability spike, and baseline

Deliver:

- final package naming and experimental wording;
- version 1 threat model and data-flow diagram;
- exact DSL, strategy catalog, benchmark policy, and approval semantics;
- capability probes against the installed Pi SDK;
- a statistical-method note with fixed non-inferiority and practical-effect defaults;
- clean-path baseline for the new package and plan-owned files.

Required spikes:

- custom inert `ResourceLoader` with nested proposal and evaluation sessions;
- trusted in-memory virtual tools with no host I/O;
- `ctx.reload()` lifecycle and stale-context behavior;
- TUI and RPC confirmations;
- state-root permission and atomic-write behavior on supported platforms.

Hard exit gate:

- no candidate-controlled code, free-form prompt, command, path, tool, model, validator, fixture, or dependency remains in version 1;
- the parent can state exactly what benchmark evidence can and cannot prove;
- unsupported SDK behavior is gated rather than assumed.

### Phase 1: package scaffold, contracts, identity, and storage

Primary write boundary:

- package metadata and docs skeleton;
- `src/contracts.ts`, `constants.ts`, `limits.ts`, `paths.ts`, `project-identity.ts`, `identity-index.ts`, `canonical-json.ts`, `crypto.ts`, `config.ts`, `event-ledger.ts`, `lock.ts`, `store.ts`, and `recovery.ts`;
- pure storage and security tests.

Deliver:

- strict schemas and bounds;
- domain-separated profile artifact hashing and unique candidate records;
- repository/worktree identity plus root alias index;
- restrictive permissions;
- no-clobber immutable publishing and atomic materialized snapshots;
- hash-chained write-ahead event ledger with intent, commit, abort, replay, and generation rules;
- exclusive operation and canary-lease ownership;
- corruption and crash recovery.

Hard exit gate:

- unknown-field, traversal, symlink, digest, no-clobber, permission, disk-failure, stale-lock, concurrent-writer, uncommitted-intent, replay, partial-write, crash-point, moved-worktree, and identity-index tests pass without Pi or a model.

### Phase 2: profile catalog and deterministic compiler

Primary write boundary:

- `src/profile/*`;
- profile and compiler tests;
- initial trusted strategy templates.

Deliver:

- finite strategy catalog;
- compatibility rules;
- canonical profile compiler;
- neutral profile;
- deterministic guidance output;
- parent-only injection helper with child bypass.

Hard exit gate:

- the same profile produces byte-identical guidance;
- no model-authored text reaches the compiled block;
- incompatible or stale catalog data fails closed;
- neutral output changes no prompt.

### Phase 3: virtual benchmark and evaluator core

Primary write boundary:

- `benchmarks/v1/*`;
- `src/evaluation/manifest.ts`, `virtual-fs.ts`, `virtual-tools.ts`, `validators.ts`, `session.ts`, `runner.ts`, `metrics.ts`, `compare.ts`, and `eligibility.ts`;
- evaluator and comparison tests.

Deliver:

- frozen benchmark manifest and splits;
- trusted virtual repository and tools;
- fresh in-memory session per task and trial;
- hard resource budgets and cancellation;
- deterministic validators;
- baseline pairing and outcome classification;
- hard gates and non-inferiority comparison.

Hard exit gate:

- source-level and runtime tests prove the benchmark path cannot touch the host filesystem, shell, network, environment, or ambient Pi resources;
- safety or correctness regressions always block eligibility;
- cost and latency can never override a failed hard gate;
- deterministic fake-model tests reproduce the same outcomes.

### Phase 4: read-only Pi integration

Primary write boundary:

- `index.ts`, `src/inspector.ts`, `commands.ts`, `tools.ts`, and `status.ts`;
- fake-Pi, lifecycle, and RPC tests.

Deliver:

- `status`, `inspect`, `setup`, and `compare` commands;
- read-only model tools;
- bounded rendering and redaction;
- lifecycle state reconstruction;
- parent/child separation;
- status cleanup on shutdown and reload.

Hard exit gate:

- tests prove that inspection excludes raw prompts, context files, skills, transcript, headers, credentials, and full local paths;
- untrusted projects remain neutral and read-only;
- live model, thinking, tool, capability, or trust drift selects neutral before prompt injection;
- RPC and TUI behavior is explicit;
- no-UI mutations fail closed;
- reload and session replacement leave no stale closure state.

### Phase 5: proposal generation

Primary write boundary:

- `src/proposal/*`;
- proposal command integration;
- proposal parsing, privacy, timeout, and cleanup tests.

Deliver:

- explicit cost/privacy preflight;
- tool-free nested session with inert resources;
- exact JSON output contract;
- strict independent profile validation;
- immutable profile artifact publishing plus unique immutable candidate provenance.

Hard exit gate:

- malformed, oversized, injected, timed-out, aborted, unavailable, and unauthenticated responses produce no candidate;
- validation and holdout content cannot enter the proposal prompt;
- no nested ambient resource or transcript leakage is observable.

### Phase 6: model-backed evaluation quality

Primary write boundary:

- trial scheduler and limits;
- paired statistical comparison;
- baseline staleness and holdout policy;
- opt-in provider smoke harness.

Deliver:

- paired randomized trial order;
- predeclared non-inferiority margins and practical thresholds;
- instability and inconclusive handling;
- holdout access rate limits;
- cost estimates and hard stops;
- bounded redacted reports.

Hard exit gate:

- deliberately flaky, biased, stale, overfit, and infrastructure-failing cases cannot be reported as eligible;
- one-run wins cannot authorize promotion;
- optional live tests clearly distinguish provider-backed evidence from deterministic test coverage.

### Phase 7: activation, reload, canary, rollback, and deletion

Primary write boundary:

- `src/activation/*`;
- mutation subcommands;
- activation state, lifecycle, and fault-injection tests.

Deliver:

- exact-digest approval;
- pending transaction;
- terminal reload handler;
- replacement-runtime validation;
- healthy canary receipt;
- known-good advancement;
- bounded automatic reversion;
- rollback and protected deletion.

Hard exit gate:

- fault injection at every write, rename, reload, compile, startup, first-turn, settle, shutdown, and receipt boundary restores known-good or neutral behavior;
- no model tool can reach a mutation path;
- rollback drills preserve history and work after restart.

### Phase 8: package completion, review, and rollout

Deliver:

- final README, TECHNICAL, and DEVELOPMENT layers;
- root README catalog entry;
- package scripts and publish allowlist;
- installed-host smoke tests;
- security and privacy review;
- evaluator and statistical review;
- user-flow and documentation review;
- final HTML implementation report when implementation is authorized;
- plan archival only after all completion evidence exists.

Hard exit gate:

- all package, Markdown, packaging, lifecycle, recovery, and review gates pass;
- every reviewer finding is dispositioned with evidence;
- residual risks and live-provider omissions are explicit;
- installation and rollback are tested from the packed artifact.

### Deferred Phase 9: real coding tools

Real `bash`, `read`, `write`, or `edit` against a disposable worktree requires a new user-approved plan. The current plan does not authorize that feature phase.

Required before implementation:

- separate process under an externally supervised wall-clock timeout;
- disposable worktree or copy-on-write fixture;
- OS-enforced filesystem, process, network, PID, memory, and CPU restrictions;
- no ambient credentials or network by default;
- cleanup and kill-tree tests;
- independent security review per supported operating system.

An in-memory session, Worker thread, `node:vm`, or Node Permission Model alone does not satisfy this gate.

### Deferred Phase 10: generated TypeScript

Generated extension code requires a new user-approved plan. It must define:

- an OS sandbox and external kill boundary;
- a narrow capability-broker protocol;
- dependency and install-script policy;
- compiler, native-addon, and module-loading policy;
- credential and provider-request brokering;
- artifact signing and provenance;
- static and dynamic security checks;
- canary isolation and rollback drills;
- a rule that generated code is never loaded or executed in the trusted Pi process; it remains inside the reviewed sandbox behind the capability broker unless a still-later, separately approved trust-boundary change explicitly authorizes otherwise.

## 25. Future implementation ownership

The feature is too coupled for concurrent writers in one checkout. Use serial milestones with one active writer and read-only review around each milestone.

Recommended implementation outcomes:

1. **Contracts and storage worker:** Phase 1 only.
2. **Profile and evaluator worker:** Phases 2 and 3 after Phase 1 integration.
3. **Pi integration and proposal worker:** Phases 4 and 5 after evaluator integration.
4. **Evaluation quality and activation worker:** Phases 6 and 7 after the earlier gates pass.
5. **Documentation and test-hardening worker:** Phase 8 after runtime behavior settles.

The parent integration owner:

- owns this canonical plan and all product decisions;
- captures the baseline before each milestone;
- inspects every actual diff and handoff;
- runs integration checks after each serial wave;
- prevents workers from changing the plan, report, package scope, or another package without approval;
- launches fresh read-only reviewers only after an inspectable integrated target exists;
- dispositiones every finding before a fix worker receives it.

Independent review angles:

1. security, state integrity, path handling, recovery, and activation lifecycle;
2. evaluator isolation, benchmark contamination, statistics, flake control, and claims;
3. Pi SDK lifecycle, nested session resources, TUI/RPC behavior, and stale-context handling;
4. package documentation, privacy, cost disclosure, user flow, and rollback clarity.

At least two independent provider families should review the integrated complex feature when available. Reviewer agreement is not proof. The parent verifies each finding against source and tests.

## 26. Test matrix

| Area | Required cases |
| --- | --- |
| DSL | Valid neutral and strategy profiles; unknown or extra fields; duplicates; too many IDs; incompatible IDs; unsupported schema. |
| Canonical JSON | Stable key order and bytes; Unicode; arrays; unsupported values; cross-platform line endings. |
| Profile and candidate identity | Same profile input gives the same domain-separated artifact digest; repeated proposals create distinct candidate records; schema/compiler/catalog/baseline changes alter the artifact digest; no-clobber mismatch blocks use. |
| Project identity | Git root; linked worktree; non-Git directory; symlink alias; same-filesystem move signal; copied or moved repository; root identity index; collision resistance; relink cancellation. |
| Paths | Traversal; absolute paths; symlink escape; control characters; case behavior; state-root override validation. |
| Permissions | Directory and file modes; unsupported-platform diagnostics; no permissive temporary files. |
| Atomic storage | Success; write failure; flush failure; rename failure; crash before and after publish; orphan cleanup. |
| Event ledger | Valid chain; intent/commit/abort; missing event; edited event; truncated line; unknown version; generation mismatch; replay; derived snapshot rebuild; recovery export. |
| Locks and leases | Concurrent operations; owner alive; owner dead; PID reuse marker; ambiguous remote host; cancellation cleanup; two-process canary claim; lease expiry; wrong runtime health refusal. |
| Catalog/compiler | Exact lookup; compatibility; deterministic output; neutral no-op; no display text in prompt. |
| Inspector | Allowed metadata; redacted paths; no prompt, transcript, context, credentials, provider headers, or environment. |
| Proposal parser | Exact JSON; extra fields; injected prose; control characters; oversize; timeout; abort; unavailable model; cleanup. |
| Resource loader | No ambient extensions, skills, prompts, themes, context files, tools, or default discovery. |
| Virtual filesystem | Read, search, edit, write, test, submit; traversal; protected files; operation and output bounds. |
| Evaluation lifecycle | Fresh session per task; timeout; abort; dispose; provider failure; validator failure; no quality verdict on infrastructure failure. |
| Benchmark split | Training visibility; validation exclusion; holdout exclusion; rate limit; access audit; manifest tampering. |
| Pairing | Same fingerprint; randomized order; changed model/tool/benchmark invalidates pair; minimum trial count. |
| Eligibility | Safety regression; correctness regression; equal quality and lower cost; inconclusive flake; stale baseline. |
| Cost limits | Preflight estimate; hard cap; provider overrun handling; no promotion from incomplete run. |
| Commands | Argument parsing; selection; cancellation; no-UI refusal; exact digest confirmation; unknown candidate. |
| Model tools | Status, inspection, and comparison only; opaque artifact IDs; no local paths, provider calls, persistence, or hidden mutation. |
| Activation | Intent and commit events; derived pending snapshot; reload terminal behavior; replacement validation; exact-runtime canary lease; health receipt; known-good advancement; competing process refusal. |
| Recovery | Corrupt desired; corrupt known-good; missing receipt; crash before canary; crash after canary; neutral fallback. |
| Rollback | Compatible prior profile; neutral; stale prior profile; history preserved; restart. |
| Delete | Active and referenced candidates refused; confirmed unreferenced delete; audit preservation. |
| Lifecycle | Startup, reload, new, resume, fork, tree, shutdown, parent/child process marker. |
| RPC/TUI | Status, progress, dialogs, widgets, timeout, cancellation, status clearing, unsupported custom UI fallback. |
| Privacy | Default records omit transcript, code, credentials, raw prompts, and thinking; optional traces are bounded and redacted. |
| Packaging | Manifest paths, published benchmark files, excluded tests/temp data, tarball install, package uninstall. |

Use deterministic fake models for automated tests. Keep billable provider tests opt-in and clearly labeled.

## 27. Verification commands

From `pi-extension-harness-lab/`:

```bash
npm test
npm run check
npm run smoke
npm pack --dry-run --json
```

Repository documentation check:

```bash
git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'
```

Additional implementation-time checks:

- inspect the dry-run tarball file list and confirm only intended sources, user docs, license, and benchmark assets ship;
- run a credential-free installed-host smoke test with a temporary agent directory and state root;
- run activation and rollback fault-injection tests in a subprocess so reload and process exit are real;
- run a source-level check that production evaluation code imports no `node:fs`, `node:child_process`, network client, or dynamic module loader outside the trusted storage and host wiring modules;
- run the package security/dependency review and document any runtime dependency added later;
- run one opt-in provider-backed proposal and paired benchmark smoke only after the user approves cost and data disclosure.

## 28. Documentation and package metadata

### README.md

Use the repository's package README structure:

- one-sentence user outcome;
- three to five concrete capabilities;
- exact install command;
- first-use flow with `/harness-lab inspect`, `propose`, `evaluate`, and `promote`;
- a prominent warning that the extension is experimental, uses provider calls, and does not execute generated code;
- link to `TECHNICAL.md`.

### TECHNICAL.md

Document advanced user behavior:

- full command and tool reference;
- profile and benchmark concepts without internal schemas;
- state and configuration locations;
- model, cost, retention, and privacy controls;
- supported modes and platforms;
- activation, reload, canary, rollback, and recovery behavior;
- benchmark and generalization limits;
- troubleshooting and safe disable/uninstall steps;
- generated-code and real-tool limitations.

### DEVELOPMENT.md

Document contributor-only details:

- architecture and source layout;
- DSL, state, audit, benchmark, evaluator, and activation contracts;
- threat model and trust boundaries;
- SDK resource-loader and lifecycle behavior;
- test fixtures, fault injection, and validation commands;
- package maintenance, compatibility, and publication notes.

### package.json

Expected metadata:

- name `@firstpick/pi-extension-harness-lab`;
- `type: "module"`;
- `pi.extensions` pointing to `./index.ts`;
- `pi-package` and relevant extension/benchmark keywords;
- wildcard peer dependencies for Pi SDK packages used at runtime;
- no runtime dependency unless it passes a separate supply-chain review;
- Node engine matching repository TypeScript extension conventions;
- `test`, `check`, and `smoke` scripts;
- explicit `files` allowlist containing runtime source, benchmark assets, README, TECHNICAL, DEVELOPMENT, and LICENSE, but excluding tests and generated state.

Update the root `README.md` extension catalog in the same change.

## 29. Rollout

### Stage A: pure library and observe mode

- Ship no live profile injection.
- Exercise schema, storage, benchmark, comparison, and recovery through tests and read-only commands.
- Confirm capability fingerprinting on the supported Pi version.

Exit: deterministic and fault-injection gates pass.

### Stage B: opt-in proposal and evaluation

- Enable explicit proposal and evaluation commands.
- Keep promotion disabled behind an experimental configuration flag.
- Run only virtual-repository benchmarks.
- Collect local evidence with no telemetry.

Exit: model-backed paired trials are stable enough to support an eligibility decision and privacy/cost disclosures are accurate.

### Stage C: opt-in promotion canary

- Enable explicit promotion for eligible profiles.
- Require exact digest confirmation and known-good fallback.
- Keep the neutral profile one command away.

Exit: packed-artifact install, reload, canary, crash recovery, and rollback drills pass in TUI and RPC-capable hosts.

### Stage D: wider experimental availability

- Keep the package labeled experimental.
- Keep generated code, real tools, model routing, context mutation, and continuous loops disabled.
- Revalidate fingerprints and lifecycle behavior on every supported Pi release.

## 30. Risks and mitigations

| Risk | Severity | Mitigation |
| --- | ---: | --- |
| Generated code reaches the privileged Pi process | Blocker | Version 1 has data-only profiles; no eval, import, dynamic extension path, or candidate dependency. |
| Trusted evaluation tools mutate the host | Blocker | Only in-memory virtual tools; source and runtime contract tests; no host I/O imports in evaluator modules. |
| Efficiency masks correctness loss | Blocker | Hard gates and lexicographic comparison; no scalar blended fitness. |
| Broken promotion strands the user | High | Pending transaction, neutral profile, known-good fallback, replacement-runtime canary, automatic reversion. |
| Candidate guidance contains injected model text | High | Only fixed catalog IDs compile; rationale stays display-only. |
| Benchmark contamination or overfitting | High | Split isolation, holdout access log and rate limit, no holdout traces to proposer, bounded claims. |
| False improvement from model nondeterminism | High | Paired trials, randomized order, fixed policy, instability and inconclusive states, predeclared margins. |
| Ambient Pi resources leak into nested sessions | High | Custom inert loader, exact tools, no transcript, capability tests. |
| State tampering or corruption | High | Restrictive permissions, digests, hash chain, atomic writes, read-only recovery mode. |
| Concurrent Pi sessions race | High | Exclusive operation lock, generation-checked event protocol, exact transaction IDs, and a single-runtime canary lease. |
| Project move or worktree alias splits history | Medium | Root identity index, repository/worktree identity, move detection, neutral fallback, and explicit relink. |
| Pi SDK drift breaks reload or sessions | High | Runtime capability fingerprint, installed-host smoke, stale evidence invalidation, fail closed. |
| Private data leaves the machine | High | Bundled synthetic fixtures, bounded proposal inputs, no project code or transcript, explicit provider disclosure. |
| Provider costs exceed expectation | Medium | Preflight estimate, task/trial/token/wall-time/cost caps, cancellation. |
| Same-user process edits state | Medium | Describe integrity as tamper-evident; verify on every mutation; no false security claim. |
| Overlap with context or reliability packages | Medium | Version 1 changes only trusted parent guidance; explicit ownership matrix and deferred integrations. |
| User mistakes benchmark evidence for general proof | Medium | `eligible` and `inconclusive` terminology, fingerprinted suite, prominent benchmark limits. |
| Audit or trace storage grows without bound | Medium | Count, age, and disk quotas; no raw traces by default; separate confirmed garbage collection later. |

## 31. Decisions to confirm before implementation

The plan adopts these recommended defaults so planning can finish. The user may change them before authorizing implementation.

1. **Name:** `Harness Lab for Pi`, package `@firstpick/pi-extension-harness-lab`.
2. **Experimental status:** prominent in README, setup, promotion, and technical docs.
3. **Version 1 profile:** one to three bundled strategy IDs only.
4. **Live scope:** parent prompt guidance only; no child, tool, model, context, or compaction changes.
5. **Evaluation:** synthetic virtual repositories and trusted in-memory tools only.
6. **Proposal model:** active authenticated model, with an explicit cost/privacy confirmation and no automatic fallback to another provider.
7. **Trace retention:** aggregate summaries only by default; optional bounded local traces off by default.
8. **Canary recovery:** promotion approval includes one automatic reversion to known-good or neutral if no healthy receipt is written.
9. **Platforms:** storage and virtual benchmark support follow current Pi/Node platforms; no real-tool sandbox support is claimed.
10. **Benchmark ownership:** package-owned synthetic fixtures; holdout sequestered from the proposal model, not claimed secret from the host user.

Any change that introduces arbitrary candidate text, project code, real tools, provider routing, or generated code requires a plan update and renewed security review.

## 32. Evidence and references

### Repository evidence

- `pi-extension-feature-system-prompt/feature-system-prompt.ts` shows the local pattern for bounded, tool-free, in-memory nested Pi sessions with an inert resource loader, timeout, abort, and disposal.
- `pi-extension-feature-system-prompt/DEVELOPMENT.md` documents privacy, no-tool isolation, fail-closed parsing, and lifecycle behavior for that nested session.
- `pi-extension-safety-guard/src/config.mjs` provides a local precedent for strict known-key validation and temporary-file plus rename persistence.
- `pi-extension-safety-guard/tests/runtime.test.mjs` provides a dependency-injected fake extension harness and fail-closed UI/non-UI tests.
- `pi-extension-upgrade-extensions/index.ts` confirms the repository convention of persisting a user-approved change, asking before reload, and treating reload as a command action.
- `pi-extension-plan-executor/index.ts` shows explicit user-intent flags for model-callable mutations, but Harness Lab deliberately does not treat model-supplied flags as authority and keeps costly or persistent actions command-only.
- `plans/planned/cache-aware-agent-context-pruning.md` owns future context transformation and provides branch/persistence/testing precedents that Harness Lab must not duplicate.
- Root `AGENTS.md` defines README, TECHNICAL, DEVELOPMENT, catalog, and Markdown validation requirements.

Repo Explorer reports created during planning:

- `/home/firstpick/.pi/agent/skills/repo-explorer/repo-explorer-effectiveness-2026-08-21T09-43-52-895Z-npm-packages-6765dda935.md`
- `/home/firstpick/.pi/agent/skills/repo-explorer/repo-explorer-effectiveness-2026-08-21T09-45-30-491Z-pi-extension-plan-executor-c0fb2665c7.md`
- `/home/firstpick/.pi/agent/skills/repo-explorer/repo-explorer-effectiveness-2026-08-21T09-45-30-491Z-pi-extension-safety-guard-74d0f894e2.md`
- `/home/firstpick/.pi/agent/skills/repo-explorer/repo-explorer-effectiveness-2026-08-21T09-45-30-491Z-pi-extension-upgrade-extensions-dcfe84fac9.md`

### Installed Pi documentation

- `pi-package-webui/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
  - extensions run with full user permissions;
  - dynamic tools and active-tool changes are possible;
  - `ctx.reload()` tears down and rebuilds the extension runtime;
  - tools cannot call reload directly;
  - old command frames remain stale after reload.
- `pi-package-webui/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
  - `createAgentSession()` and custom `ResourceLoader` contracts;
  - in-memory session and settings managers;
  - explicit custom tools and extension loading;
  - cleanup and runtime replacement behavior.
- `pi-package-webui/node_modules/@earendil-works/pi-coding-agent/docs/packages.md`
  - package manifest, dependencies, security warning, installation, and resource discovery.
- `pi-package-webui/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md`
  - session persistence and custom-entry behavior.

### External primary sources

- [DeepSeek Harness v0.1.1-rc.1 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.1)
- [DeepSeek tagged Cordis host-runner trust and lifecycle notes](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.1/packages/extensions/cordis-host-runner/README.md)
- [DeepSeek tagged Cordis tool implementation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.1-rc.1/packages/extensions/tool-cordis/src/index.ts)
- [Node `node:vm` documentation](https://nodejs.org/api/vm.html), which states that `node:vm` is not a security mechanism.
- [Node Permission Model documentation](https://nodejs.org/api/permissions.html), which describes the permission model as a trusted-code safety aid rather than a malicious-code sandbox.
- [Node Worker threads documentation](https://nodejs.org/api/worker_threads.html), which documents thread-level rather than host isolation and the limits of worker resource controls.

Planning research artifacts:

- `/home/firstpick/.pi/agent/sessions/--home-firstpick-npm-packages--/subagent-artifacts/outputs/10465a70-ccff-440f-af83-08bbc8e3ce23/local-extension-conventions.md`
- `/home/firstpick/.pi/agent/sessions/--home-firstpick-npm-packages--/subagent-artifacts/outputs/10465a70-ccff-440f-af83-08bbc8e3ce23/deepseek-current-evidence.md`
- `/home/firstpick/.pi/agent/sessions/--home-firstpick-npm-packages--/subagent-artifacts/outputs/9b16e298-63f5-4604-8a50-124ae3cbb172/architecture-challenge.md`

## 33. Planning review record

A fresh security and lifecycle reviewer completed an evidence-backed review after the first draft. The parent checked every finding against this plan and the cited Pi SDK documentation.

| Finding | Disposition | Plan change |
| --- | --- | --- |
| Profile digest and candidate identity could overwrite distinct provenance. | `accepted` | Split content-addressed profile artifacts from unique immutable candidate records; added no-clobber publishing and explicit manifests. |
| Multi-file activation writes had unrecoverable crash windows. | `accepted` | Replaced sequential snapshot-plus-audit writes with a write-ahead intent/commit/abort event protocol and replayable derived snapshots. |
| Concurrent runtimes could both certify one canary. | `accepted` | Added generation-checked canary leases bound to one runtime/process and made active profile status runtime-local. |
| A model-controlled boolean could pretend to authorize proposal or evaluation. | `accepted` | Removed proposal and evaluation model tools from version 1; provider-cost and persistent actions are user commands only. |
| Material model, thinking, tool, capability, or trust drift could leave a stale profile active. | `accepted` | Split evaluation and live fingerprints, added invalidation events and per-turn live checks, and selected neutral on mismatch. |
| Tool results could disclose local artifact paths to the provider. | `accepted` | Read-only tools return opaque IDs only; local path resolution is command/UI-only and redacted. |
| Moved worktrees lacked a way to find their old identity namespace. | `accepted` | Added a root identity/alias index, bounded move signals, neutral fallback, and explicit relink behavior. |
| Deferred real-tool and generated-code wording left authorization loopholes. | `accepted` | Both require new user-approved plans; generated code may not load or execute in the trusted Pi process. |
| Digest concatenation lacked domain separation. | `accepted` | Hash a canonical tagged object with a fixed domain identifier. |
| Project-associated state could activate in an untrusted project. | `accepted` | Added `ctx.isProjectTrusted()` as a neutral/read-only gate. |

A second independent evaluator/implementation-plan review was attempted through a provider-diverse read-only gate. One qualifying security review completed, while both OpenRouter-backed attempts for the second slot failed with the account's monthly key-limit HTTP 403. The retry budget was exhausted, so the second independent review remains unavailable rather than being silently replaced or counted as passed. This does not block delivery of a planning artifact, but implementation must still obtain the evaluator/statistical review required by Phase 8.

## 34. Completion record

Planning is complete when:

- the plan passes Markdown diff checks;
- repository and external evidence are represented accurately;
- version 1 scope, safety invariants, state, evaluation, activation, rollback, tests, and documentation are explicit;
- unresolved user-owned decisions have recommended defaults;
- no implementation code or package files have been created.

Implementation is complete only when:

- every phase exit gate has evidence;
- integrated source and package artifacts match this plan or deviations are recorded and approved;
- all reviewer findings are dispositioned and accepted fixes are revalidated;
- package installation, reload, canary, recovery, rollback, and uninstall are tested;
- a final implementation report records checks, omissions, costs, and residual risks;
- this plan moves from `plans/planned/` to `plans/archive/` only after final verification.
