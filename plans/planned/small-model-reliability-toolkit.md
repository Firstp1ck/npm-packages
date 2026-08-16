# Small-model reliability toolkit for retrieval, agents, and coding

- **Status:** Proposed; implementation pending
- **Classification:** Complex
- **Feature slug:** `small-model-reliability-toolkit`
- **Target package:** `pi-extension-small-modal-reliability/` *(extend the existing package rather than create an overlapping package)*
- **Published package:** `@firstpick/pi-extension-small-modal-reliability`
- **User-facing name:** Small Model Reliability for Pi
- **Integration owner:** Primary Pi session
- **Priority order:** information retrieval → automatic context checkpoint/reset → bounded agentic use → coding → structured output and general reliability
- **Required final report:** `reports/small-model-reliability-toolkit.html` *(created during implementation and linked here before completion)*
- **Last updated:** 2026-08-12

## 1. Goal

Expand the existing small-model reliability extension into a package that combines portable Agent Skills, a deliberately small set of model-facing tools, and deterministic runtime guards for language models with 27 billion parameters or fewer.

The package must improve end-to-end reliability without claiming to increase the model's underlying intelligence. It should compensate for recurring small-model weaknesses by:

1. retrieving a small, relevant, attributable evidence set before synthesis;
2. requiring explicit scope, budgets, and stop conditions for agentic work;
3. constraining coding work to repository evidence, allowed files, exact dependency versions, and executable validation;
4. validating completion claims, structured output, citations, and authorization outside the model;
5. making abstention and escalation first-class successful outcomes;
6. automatically converting completed research and other finished phases into validated Markdown handoffs, then continuing from a fresh provider-visible context;
7. preserving compact, stable context instead of adding one large universal prompt;
8. remaining useful with standard Agent Skills-compatible harnesses while adding stronger enforcement when run in Pi.

## 2. Why this extends the existing package

The repository already contains `pi-extension-small-modal-reliability`, which provides persistent task state, planning, loop detection, context headers, supervisor/worker contracts, verification records, completion gating, and offline evaluation. A new standalone reliability package would duplicate its routing and runtime scope.

This plan therefore makes an additive, backward-compatible expansion:

- retain the npm package name to avoid breaking existing installs;
- correct only the user-facing wording from **Small Modal Reliability** to **Small Model Reliability**;
- add bundled skills through the package's `pi.skills` manifest;
- add only three new model-facing tools, using action enums to avoid a large tool catalog;
- enhance existing guards and state instead of replacing them;
- preserve existing `/reliability` commands and tool names;
- migrate persisted task state from schema version 1 to version 2 without deleting old task records.

Automatic context clearing uses a two-package contract rather than duplicating provider/session logic:

- this reliability package decides when a phase is complete, deterministically renders and validates a resume-ready Markdown handoff, and records the checkpoint in task state;
- the separately planned `pi-extension-context-curator` removes completed-phase transient messages from subsequent provider-visible input and starts a fresh continuation epoch;
- the original append-only Pi session and raw tool artifacts remain intact for audit and recovery;
- when the context curator is absent or the active provider cannot prove a safe continuation reset, this package still writes and validates the checkpoint but **does not claim that context was cleared**.

The companion `plans/planned/cache-aware-agent-context-pruning.md` must be revised before implementation to replace its explicit-agent-only trigger with this validated automatic phase-boundary contract. That package continues to own historical transformation, provider-cache behavior, branch reconstruction, fresh-continuation mechanics, and restoration. This toolkit owns checkpoint completeness, evidence/scope preservation, trigger eligibility, and post-reset resume verification.

## 3. Success criteria

### 3.1 Package and skill delivery

1. The package exposes its extension and all bundled skills through `package.json`.
2. Every skill follows the portable-core/Pi-adapter split and passes lifecycle evaluation before enablement.
3. Skill descriptions route narrowly and do not compete with `repo-explorer`, `deep-research`, `feature-development-workflow`, `code-security`, or `subagent-governance`.
4. Existing users can upgrade without changing commands or losing version-1 task data.
5. The package remains opt-in by default unless the user explicitly changes project configuration.

### 3.2 Retrieval reliability

1. A model can create a bounded evidence pack, register exact passages with source metadata, record claims, and request deterministic coverage checks.
2. The runtime rejects duplicate source IDs, malformed locators, empty passages, oversized evidence, unsupported citation references, and cross-task pack IDs.
3. An answer cannot pass the retrieval completion gate while a material claim has no supporting source, a cited source cannot be resolved, or a recorded conflict remains undispositioned.
4. Nonexistent-entity and missing-source fixtures end in `insufficient` or `escalate`, not an invented answer.
5. Retrieved content is treated as untrusted data; it cannot authorize tools or override task instructions.
6. The model-visible retrieval summary stays inside an explicit character, passage, and source budget.

### 3.3 Agentic reliability

1. Every supervised agentic task has an active scope containing allowed tools, path boundaries, action budgets, side-effect policy, stop conditions, and escalation conditions.
2. The runtime blocks out-of-scope tools, paths, repeated failed calls, and exhausted budgets before execution.
3. External side effects require user-originated approval; a model-facing tool can request approval but cannot grant it.
4. Parallel or delegated work follows the existing `subagent-governance` package and Pi subagent runtime rather than implementing a second delegation system.
5. The agent stops with `blocked` or `escalate` after the configured error/iteration limit instead of looping or silently broadening scope.

### 3.4 Coding reliability

1. Coding tasks begin from a repository handoff or an explicitly recorded small write scope.
2. Writes outside allowed paths are blocked before execution.
3. Dependency or API recommendations record the installed version and the local or official documentation source used.
4. Completion cannot pass while required validation is missing, failed, or unknown.
5. The final gate detects changed files outside scope, missing tests, unresolved API-version evidence, and unreviewed security-sensitive changes.
6. The package never treats generated code, compilation alone, or a model's statement as proof of behavioral correctness.

### 3.5 Cross-cutting reliability

1. The unified quality gate returns exactly `pass`, `fail`, or `escalate`, with machine-readable reasons and evidence references.
2. Context injection remains bounded and supports full, compact, and delta modes.
3. At every eligible phase boundary, the runtime automatically writes a validated Markdown checkpoint before attempting to clear transient provider-visible context.
4. A fresh continuation preserves the original user request, later authoritative user constraints, material findings with evidence references, decisions, active scope, unresolved questions, changed artifacts, validation state, and next action.
5. Raw web/search/fetch output and superseded working dialogue are absent from the fresh provider-visible context but remain recoverable from the original session or referenced artifacts.
6. An invalid, incomplete, unsupported, or unverifiable checkpoint leaves the current context unchanged and records why reset was skipped.
7. Existing repeat-call and completion guards continue to work after the schema migration.
8. Credential-free tests cover every deterministic guard.
9. A live evaluation with at least one ≤8B model and one 12B–27B model demonstrates fewer unsupported completions and invalid tool actions than an unguarded baseline, with no hidden use of a frontier model in the guarded path.

## 4. Scope

### In scope

- Add multiple skills to the existing package.
- Add three compact model-facing tools:
  - `reliability_evidence`
  - `reliability_scope`
  - `reliability_gate`
- Extend persistent task state with workflow lane, evidence packs, scope policy, budgets, approval requests, and gate results.
- Add deterministic guards for citations, scope, paths, budgets, side effects, dependency-version evidence, structured output, and completion.
- Add project configuration for guard limits and compatibility behavior.
- Add user commands for inspecting scope, evidence, gates, checkpoints, approval requests, and evaluations.
- Add deterministic automatic phase-boundary checkpoint generation and resume-readiness validation.
- Integrate through a versioned adapter with the context curator for provider-visible compaction and fresh continuation.
- Add credential-free fixtures plus optional live local-model evaluation.
- Update README, technical reference, contributor guide, package metadata, and repository catalog.

### Non-goals

- Training, fine-tuning, distilling, or quantizing a language model.
- Implementing a vector database, embedding model, web search provider, browser, or repository indexer.
- Replacing existing search, fetch, local wiki, `repo-explorer`, or source-check tools.
- Replacing `subagent-governance` or the Pi subagent runtime.
- Replacing `feature-development-workflow` for complex feature implementation.
- Replacing `code-security` for security review.
- Replacing `pi-extension-safety-guard` for broad shell/path danger detection; this package owns task scope and approval state, while Safety Guard may add stricter independent blocking.
- Automatically deciding that evidence semantically proves a claim. Deterministic checks can prove reference integrity and declared coverage, not truth.
- Deleting or rewriting prior session history; “clear” means replacing prior transient content in the next provider-visible context, not erasing audit history.
- Resetting context after every individual search or tool call.
- Running an unbounded model-authored summarizer as the source of truth for a checkpoint.
- Pretending a provider continuation was reset when transport-level evidence is unavailable.
- Dynamically changing the active tool catalog every turn; stable tools avoid cache churn and model confusion.
- Guaranteeing that every ≤27B model will improve on every task.

## 5. Design principles for small models

1. **Retrieve, then reason.** Search and source selection must be a distinct phase from answer synthesis.
2. **Small evidence sets.** Prefer five directly relevant passages over an entire document collection.
3. **One meaning per tool.** Use three clearly separated tool names; action enums may vary operations within one domain.
4. **Deterministic enforcement outside the prompt.** Paths, counts, budgets, schema checks, and authorization are runtime concerns.
5. **Explicit unknowns.** `insufficient`, `blocked`, and `escalate` are valid outcomes.
6. **Short horizons.** One current step, bounded calls, bounded errors, and visible stop conditions.
7. **Evidence IDs, not copied context.** Persistent state should reference bounded evidence rather than repeatedly injecting raw results.
8. **Stable context.** Inject only current lane, current step, latest warnings, compact evidence coverage, and gate status.
9. **No self-issued permission.** The model may request a side effect but only a user or trusted host policy may approve it.
10. **Executable verification.** Use parsers, schemas, compilers, tests, and source checks whenever a deterministic checker exists.
11. **Escalate by risk, not eloquence.** A fluent response does not lower required evidence or review.
12. **Fail closed on action; fail open on context.** Uncertain tool authorization blocks execution, while uncertain context transformation retains more original information.
13. **Checkpoint, validate, then clear.** A reset never happens before its Markdown handoff passes deterministic completeness and reference checks.
14. **Reset at semantic boundaries, not arbitrary turns.** Prefer research → planning, planning → implementation, implementation → review, and review → final transitions.
15. **Rebuild from canonical state.** New checkpoints are rendered from the original request and current structured evidence/decisions, not by recursively summarizing earlier summaries.

### Approved decisions and invariants

| Decision | Approved default | Invariant |
|---|---|---|
| Package ownership | Extend `pi-extension-small-modal-reliability` | Do not create a competing reliability extension. |
| Tool surface | Add exactly three domain-separated tools | Do not add synonym tools or per-action tool names without a measured routing need. |
| Skill shape | Six narrow skills with portable cores and Pi adapters | No universal catch-all skill and no duplicate repository/delegation/feature/security workflow. |
| Retrieval | Evidence ledger plus deterministic integrity checks | Never equate citation integrity with semantic truth. |
| Agency | Explicit scope, budgets, stop conditions, and user-attributable approval | A model cannot broaden authoritative scope or approve its own side effects. |
| Coding | Repository evidence, bounded writes, version evidence when relevant, executable checks | Compilation or model confidence alone never proves completion. |
| State | Additive version-1 to version-2 migration | Never delete, silently reinterpret, or automatically downgrade task records. |
| Context | Automatic validated checkpoint and fresh continuation at eligible phase boundaries | Never clear provider-visible context before the handoff is complete, recoverable, and transport-safe. |
| Guard posture | Fail closed for uncertain mutation; preserve context on transformation uncertainty | No partial state mutation after a validation failure. |
| Rollout | Observe-only, strict opt-in, then balanced | New balanced enforcement waits for false-block evidence. |
| Publication | Separate explicit approval | Planning and implementation do not authorize installation, enablement, or release. |

Open implementation risks are recorded in section 28. No product, architecture, security, migration, compatibility, deployment, or interface decision may be invented by a worker; unapproved changes stop and return to the integration owner.

## 6. Package architecture

```text
pi-extension-small-modal-reliability/
├── index.ts
├── package.json
├── README.md
├── TECHNICAL.md
├── DEVELOPMENT.md
├── LICENSE
├── skills/
│   ├── evidence-first-retrieval/
│   │   ├── SKILL.md
│   │   ├── references/
│   │   │   ├── SOURCE-SELECTION.md
│   │   │   └── CONFLICT-AND-ABSTENTION.md
│   │   └── tests/test_skill_contract.py
│   ├── bounded-agent-execution/
│   │   ├── SKILL.md
│   │   ├── references/
│   │   │   └── ACTION-AND-ESCALATION-CONTRACT.md
│   │   └── tests/test_skill_contract.py
│   ├── bounded-code-repair/
│   │   ├── SKILL.md
│   │   ├── references/
│   │   │   └── CODE-SCOPE-AND-VALIDATION.md
│   │   └── tests/test_skill_contract.py
│   ├── version-aware-docs/
│   │   ├── SKILL.md
│   │   ├── references/
│   │   │   └── VERSION-EVIDENCE.md
│   │   └── tests/test_skill_contract.py
│   ├── validated-structured-output/
│   │   ├── SKILL.md
│   │   ├── references/
│   │   │   └── SCHEMA-VALIDATION.md
│   │   └── tests/test_skill_contract.py
│   └── small-model-regression-eval/
│       ├── SKILL.md
│       ├── references/
│       │   └── EVALUATION-POLICY.md
│       └── tests/test_skill_contract.py
├── src/
│   ├── existing modules...
│   ├── workflow-lane.ts
│   ├── evidence-contracts.ts
│   ├── evidence-state.ts
│   ├── evidence-gate.ts
│   ├── scope-contracts.ts
│   ├── scope-state.ts
│   ├── scope-guard.ts
│   ├── approval-state.ts
│   ├── quality-gate.ts
│   ├── structured-output.ts
│   ├── checkpoint-contracts.ts
│   ├── checkpoint-renderer.ts
│   ├── checkpoint-validator.ts
│   ├── context-reset-coordinator.ts
│   ├── state-migration.ts
│   └── live-evaluation.ts
└── tests/
    ├── reliability-harness.test.mjs
    ├── evidence.test.mjs
    ├── scope-guard.test.mjs
    ├── approval.test.mjs
    ├── quality-gate.test.mjs
    ├── state-migration.test.mjs
    ├── structured-output.test.mjs
    ├── routing.test.mjs
    └── fixtures/
        ├── retrieval/
        ├── agentic/
        ├── coding/
        └── structured-output/
```

`index.ts` remains registration and lifecycle wiring. State reducers, validation, policy decisions, and gate evaluation must be pure modules with direct tests.

## 7. Skill portfolio

### 7.1 `evidence-first-retrieval`

**Priority:** P0

**Trigger:** Fact finding, document Q&A, local knowledge-base lookup, source-backed comparison, current information, or any request where a material answer should be grounded in retrieved evidence.

**Should not trigger:** Pure creative writing, exact-response tests, repository exploration, or a request already governed by the deeper `deep-research` workflow.

**Portable workflow:**

1. Normalize the question and split compound requests into atomic claims.
2. Decide source requirements, freshness, authority, and acceptable domains.
3. Search or query available sources using harness-native retrieval tools.
4. Deduplicate and rerank results.
5. Select a bounded set of exact passages.
6. Record sources and claims in an evidence pack when the Pi adapter is available.
7. Identify missing, stale, or contradictory evidence.
8. Answer only from the selected pack and attach source IDs to material claims.
9. Run the evidence gate.
10. Return `supported`, `partial`, `conflicting`, or `insufficient`.

**Pi adapter:** Use existing search, local-wiki, fetch, and source-check tools. Use `reliability_evidence` only for provenance and checks; it is not a search provider.

**Overlap boundary:** `deep-research` remains the route for rigorous multi-source scientific/high-stakes research. This skill is the normal bounded retrieval workflow.

### 7.2 `bounded-agent-execution`

**Priority:** P0

**Trigger:** Multi-step work requiring several tool calls, file or system interaction, iterative investigation, or an explicit autonomous/agentic request.

**Should not trigger:** One read, one deterministic edit, simple explanation, or delegated multi-agent governance decisions.

**Portable workflow:**

1. Define one outcome and success criteria.
2. Establish allowed tools, resources, paths, call budget, iteration budget, and stop conditions.
3. Break work into short dependency-ordered steps.
4. Execute one active step at a time.
5. Inspect every tool result before choosing the next action.
6. Stop on repeated errors, missing authorization, or an unapproved decision.
7. Verify the outcome and report unresolved risks.

**Pi adapter:** Record scope through `reliability_scope`; use existing supervisor/worker tools for current-step contracts. Delegation remains governed by `subagent-governance`.

### 7.3 `bounded-code-repair`

**Priority:** P0

**Trigger:** Focused bug repair, small behavior-preserving refactor, unit-test addition, or a bounded code change with an inspectable target.

**Should not trigger:** New complex feature delivery, broad architecture work, security audit, documentation-only work, or an unfamiliar-repository question without requested modification.

**Portable workflow:**

1. State the bug or desired bounded behavior and acceptance criteria.
2. Explore the repository using the existing repository-exploration route.
3. Identify relevant symbols, callers, tests, dependency versions, and validation commands.
4. Define allowed write paths and forbidden/shared paths.
5. Implement the smallest patch.
6. Run targeted checks, then affected broader checks.
7. Inspect the final diff against scope.
8. Permit at most two repair iterations after failed validation.
9. Escalate architecture, security, migration, dependency, or multi-subsystem decisions.
10. Pass the coding quality gate before completion.

**Default scope:** Up to three files and one behavioral objective. The user, repository plan, or feature workflow may approve a larger explicit boundary.

**Overlap boundary:** Complex new features route to `feature-development-workflow`; repository mapping stays in `repo-explorer`; security review stays in `code-security`.

### 7.4 `version-aware-docs`

**Priority:** P1

**Trigger:** Coding or configuration work depending on a library, framework, CLI, runtime, API, or schema version.

**Should not trigger:** Version-independent language syntax or a purely local symbol whose implementation is already in the repository.

**Portable workflow:**

1. Inspect manifests and lockfiles.
2. Resolve the exact installed version and enabled feature flags.
3. Prefer installed source/types and version-matched local documentation.
4. Use official versioned documentation or the exact source tag when local evidence is insufficient.
5. Extract exact signatures, options, deprecations, and minimal examples.
6. Record the version, source locator, and relevant passage in the active evidence pack.
7. Reject advice based only on another major version.

### 7.5 `validated-structured-output`

**Priority:** P2

**Trigger:** Extraction, classification, conversion, or generation that must satisfy JSON, YAML, CSV, enum, table, or other strict output requirements.

**Should not trigger:** Free-form prose with no machine-consumed contract.

**Portable workflow:**

1. Define the schema and semantic constraints.
2. Separate source data from instructions.
3. Generate one bounded candidate.
4. Parse and validate deterministically.
5. Repair only validation errors, with at most two attempts.
6. Return `fail` or `escalate` if semantic requirements cannot be verified.

### 7.6 `small-model-regression-eval`

**Priority:** P2; user-invoked by default

**Trigger:** Comparing a local model, quantization, prompt, skill revision, or guard profile on a fixed task suite.

**Should not trigger:** Normal task execution.

**Workflow:** Run deterministic fixtures, optional configured live models, baseline-vs-guarded comparisons, and produce a bounded Markdown/JSON report. This skill must not enable or publish a model or package.

## 8. Model-facing tool surface

The package currently exposes seven `reliability_*` tools. Add only the following three so the active reliability tool catalog remains at ten. Avoid multiple similarly named tools such as `add_source`, `add_claim`, and `check_claim`, because smaller models confuse adjacent schemas.

### 8.1 `reliability_evidence`

Purpose: maintain bounded, task-local provenance and run deterministic integrity/coverage checks.

Actions:

```ts
type ReliabilityEvidenceInput =
  | {
      action: "start";
      question: string;
      requirements?: string[];
      maxSources?: number;
      maxPassages?: number;
    }
  | {
      action: "add-source";
      packId: string;
      sourceId: string;
      title: string;
      locator: string;
      sourceKind: "local-file" | "official-doc" | "primary" | "peer-reviewed" | "web" | "community";
      publishedAt?: string;
      retrievedAt: string;
      passages: Array<{ passageId: string; text: string; location?: string }>;
    }
  | {
      action: "add-claim";
      packId: string;
      claimId: string;
      claim: string;
      material: boolean;
      support: Array<{ sourceId: string; passageIds: string[] }>;
      contradicts?: Array<{ sourceId: string; passageIds: string[] }>;
    }
  | {
      action: "disposition-conflict";
      packId: string;
      claimId: string;
      disposition: "prefer-source" | "report-conflict" | "exclude-claim" | "escalate";
      rationale: string;
      preferredSourceIds?: string[];
    }
  | {
      action: "assess" | "get";
      packId: string;
      view?: "compact" | "full";
    };
```

Deterministic guarantees:

- Pack IDs are task-local and cannot be supplied from another task directory.
- Source and passage IDs must be unique and bounded.
- Locators accept validated local paths or HTTP(S) URLs only.
- Passages must be non-empty, size-limited, and stored exactly as submitted.
- Claims may reference only registered source/passage IDs.
- `assess` checks citation resolution, declared coverage, unresolved conflicts, freshness requirements, source/passages limits, and material unsupported claims.
- `assess` does not claim semantic truth; it reports `integrity_passed` separately from `semantic_review_required`.

Default bounds:

- 12 sources per pack;
- 24 passages per pack;
- 4 passages per source;
- 2,000 characters per passage;
- 30 material claims;
- 8,000 characters in compact injected evidence state.

### 8.2 `reliability_scope`

Purpose: declare and inspect execution boundaries that the runtime can enforce before tool execution.

Actions:

```ts
type ReliabilityScopeInput =
  | {
      action: "set";
      lane: "retrieval" | "agentic" | "coding" | "structured-output" | "general";
      allowedTools: string[];
      allowedReadPaths?: string[];
      allowedWritePaths?: string[];
      forbiddenPaths?: string[];
      maxToolCalls: number;
      maxErrors: number;
      maxIterations: number;
      externalSideEffects: "forbidden" | "approval-required" | "pre-approved";
      validationCommands?: string[];
      stopConditions: string[];
      escalationConditions: string[];
    }
  | {
      action: "request-approval";
      description: string;
      toolName: string;
      normalizedEffect: string;
      reversible: boolean;
    }
  | {
      action: "status" | "check";
      candidateTool?: string;
      candidateInput?: unknown;
    };
```

Rules:

- The model may set or narrow scope but may not broaden a user- or plan-imposed boundary.
- A scope change that broadens tools, write paths, side effects, or budgets becomes a pending request.
- `request-approval` records a request only; approval must come from a user command or native confirmation dialog.
- Validation commands are data for the verifier, not permission to execute arbitrary shell.
- Paths are normalized against the task cwd; traversal and symlink-escape checks occur before protected writes.

### 8.3 `reliability_gate`

Purpose: evaluate phase and final completion using evidence already recorded by the package.

Actions:

```ts
type ReliabilityGateInput =
  | {
      action: "record";
      gate: "retrieval" | "agentic" | "coding" | "structured-output" | "final";
      criterion: string;
      status: "passed" | "failed" | "unknown";
      evidence: string;
      artifactRefs?: string[];
    }
  | {
      action: "assess";
      gate: "retrieval" | "agentic" | "coding" | "structured-output" | "final";
    }
  | {
      action: "escalate";
      reason: string;
      decisionNeeded: string;
      evidence?: string[];
    }
  | {
      action: "status";
      gate?: "retrieval" | "agentic" | "coding" | "structured-output" | "final";
    };
```

`assess` returns:

```ts
type GateDecision = {
  decision: "pass" | "fail" | "escalate";
  reasons: string[];
  failedCriteria: string[];
  unknownCriteria: string[];
  unresolvedConflicts: string[];
  scopeViolations: string[];
  approvalRequests: string[];
  evidenceRefs: string[];
};
```

The tool combines existing verification records with lane-specific checks. It may not convert `unknown` to `passed` based on model confidence.

## 9. Runtime guard matrix

| Guard | Event or boundary | Default behavior | Failure result |
|---|---|---|---|
| Evidence bounds | `reliability_evidence` execution | Reject oversized or malformed packs | Tool error; state unchanged |
| Citation integrity | Retrieval/final gate | Resolve every claim reference | `fail` |
| Conflict disposition | Retrieval/final gate | Require explicit disposition | `escalate` |
| Retrieval injection | `context` | Inject compact coverage and unresolved issues only | Retain existing context on error |
| Untrusted retrieval | `before_agent_start` / context guidance | Mark retrieved instructions as data | Cannot grant authorization |
| Tool allowlist | `tool_call` | Compare active scope with tool name | Block |
| Read/write path scope | `tool_call` | Normalize and compare paths | Block |
| Tool-call budget | `tool_call` | Count attempted calls, including blocked calls separately | Block and mark task blocked |
| Error/iteration budget | `tool_result` / turn end | Stop after configured threshold | `escalate` |
| Repeat-loop guard | Existing `tool_call` guard | Keep current hash-based blocking | Block |
| Side-effect approval | `tool_call` | Require user-originated active approval | Block or prompt |
| Shell command boundary | `tool_call` for Bash | Permit only declared validation commands or explicitly approved actions | Block |
| Coding write boundary | write/edit tool call | Require allowed write path | Block |
| Dependency-version evidence | Coding gate | Require manifest/lockfile and docs/source record when API-dependent | `unknown` or `escalate` |
| Validation evidence | Coding/final gate | Require recorded command result | `fail`/`unknown` |
| Structured output | Candidate finalization | Parse and validate schema | Repair or `fail` |
| Completion claim | Existing `message_end` gate | Evaluate lane and final gates | Follow-up in strict mode |
| Phase-boundary detection | Passed lane gate plus requested next lane | Queue one checkpoint per completed phase | Skip reset until boundary is valid |
| Checkpoint completeness | Before context reset | Validate required sections, references, scope, decisions, and next action | Keep current context |
| Checkpoint durability | Before context reset | Atomic write, reopen, parse, and hash verification | Keep current context |
| Provider reset capability | Before fresh continuation | Require supported context-curator adapter and transport capability | Checkpoint only; no clear claim |
| Post-reset resume | First request in new context epoch | Verify task/checkpoint IDs, scope hash, evidence refs, and next action | Restore prior epoch or pause |
| Context budget | `context` | Trigger checkpoint eligibility; truncate only display summaries, never canonical handoff facts | Warning; preserve essential state |
| State migration | Session/task load | Parse v1/v2 and migrate in memory | Retain v1 and disable new guards on failure |

### Guard ordering

1. Trust and project configuration validation.
2. Active task and scope resolution.
3. User-approval resolution.
4. Tool and path allowlist.
5. Budget and repeat checks.
6. Existing independent safety extensions.
7. Tool execution.
8. Result normalization and verification parsing.
9. Lane gate and phase-boundary detection.
10. Atomic checkpoint render, validation, and persistence.
11. Context-curator capability check and fresh-continuation transition.
12. Post-reset resume verification.
13. Final completion gate.

If extension load order prevents proving that another guard ran, this package must not claim that it did. Its own checks remain independently enforced.

## 10. Workflow lanes

Every task receives one primary lane:

- `retrieval`
- `agentic`
- `coding`
- `structured-output`
- `general`

Lane selection may be suggested from the prompt but becomes authoritative only when recorded in task state. A task may transition in this order:

```text
retrieval → agentic → coding → structured-output/general → final gate
```

Not every task uses every lane. Transitions must preserve completed evidence and scope records. A transition cannot silently broaden tools or paths. A passed lane gate followed by a different next lane is the primary automatic checkpoint trigger.

### Retrieval lane

```text
Question
  → source requirements
  → search/fetch/local lookup
  → bounded evidence pack
  → coverage/conflict assessment
  → grounded synthesis or abstention
```

### Agentic lane

```text
Outcome
  → scope + budgets + stop conditions
  → one current step
  → tool action
  → inspect result
  → continue / block / escalate
  → agentic gate
```

### Coding lane

```text
Acceptance criteria
  → repo-explorer handoff
  → version-aware docs when needed
  → write boundary
  → minimal patch
  → tests/checks
  → diff/scope inspection
  → coding gate
```

### Automatic compact/clear strategy

#### Meaning of “clear”

The system never deletes the original user messages, assistant messages, or tool results from Pi's append-only session. A clear creates a new **context epoch** whose provider-visible seed contains only trusted runtime instructions plus the validated continuation bundle. The previous epoch remains recoverable but is not resent during normal continuation.

#### Automatic triggers

A checkpoint/reset is queued when all mandatory conditions hold:

1. a semantic phase boundary is detected: retrieval → planning/agentic/coding, planning → implementation, implementation → review, or review → final;
2. the outgoing lane gate is `pass`, or is `escalate` with the unresolved decision explicitly preserved and the next action limited to obtaining that decision;
3. no tool call or parallel result batch is unresolved;
4. task state is durably saved;
5. the checkpoint validator can produce a resume-ready artifact.

The runtime may also queue the same process inside a long phase when either default pressure threshold is crossed:

- eligible transient content is at least 12,000 estimated tokens; or
- provider-visible input reaches 35% of the model's usable context window.

Pressure-triggered reset still requires a stable subphase boundary and a valid next action. At 70% context pressure, failure to produce a valid handoff pauses further nonessential exploration and requests repair/escalation; it never silently drops context. Apply a four-turn cooldown and permit at most one automatic reset per phase/subphase ID.

Do **not** reset after each web search. A research reset occurs after the evidence pack is assessed and the next lane is known. Several search/fetch calls should be batched into one checkpoint transition so the provider prefix changes once.

#### Canonical checkpoint artifact

Write atomically to:

```text
.pi/tasks/{task_id}/checkpoints/{sequence}-{from_lane}-to-{to_lane}.md
```

The directory is local task state, excluded from Git by default, and created with user-only permissions where the host supports them. The Markdown must be independently sufficient to resume and use this stable structure:

```markdown
# Context checkpoint

## Identity
- Task ID, checkpoint ID, schema version, source and target lane, creation time

## Original user request
- Exact original request or lossless local reference plus integrity hash

## Later authoritative user instructions
- Subsequent constraints, corrections, approvals, and scope changes with session-entry references

## Current objective and success criteria
## Material findings
- Claim, status, source IDs, exact passage/artifact references

## Conflicts, unknowns, and pending decisions
## Decisions and rejected alternatives
## Active scope and safety boundaries
## Files and artifacts
## Validation and gate state
## Next action
## Recovery references
- Previous context epoch, raw session branch, evidence packs, prior checkpoint

## Integrity manifest
- Canonical state hash, evidence-pack hashes, scope hash, artifact hash
```

The renderer builds this document from canonical task state, evidence packs, user-message references, plans, approvals, and verification records. It must not rely on a free-form recursive summary. Model-authored prose may populate bounded finding/rationale fields only when linked to canonical IDs.

#### Validation before reset

The reset coordinator must atomically write the artifact, reopen it, parse required headings, and verify:

- original request and all later authoritative user changes are present or losslessly referenced;
- every material finding resolves to an evidence source/passage or is labeled unsupported/unknown;
- unresolved conflicts, risks, user decisions, and pending approvals are preserved;
- active read/write/tool scope, budgets, stop conditions, and escalation conditions match canonical state;
- files changed, artifacts created, commands run, failures, and validation status are current;
- the next action is singular and executable without hidden conversation context;
- referenced local artifacts exist and belong to the task;
- hashes match the just-persisted canonical records;
- the rendered continuation seed fits the configured budget.

Any failed check leaves the current context untouched, records `checkpoint-invalid`, and allows one bounded repair. A second failure pauses automatic reset for the phase and escalates rather than summarizing more aggressively.

#### Fresh continuation seed

After validation, the context curator starts a new provider continuation containing only:

1. the host-rebuilt system, developer, project, and enabled-skill instructions;
2. the exact original user request and later authoritative user changes;
3. a compact task header with task/checkpoint IDs and target lane;
4. the validated Markdown checkpoint, or a bounded deterministic projection with a file reference when the full artifact exceeds budget;
5. the next action.

Do not include raw search results, superseded reasoning, failed exploratory branches already dispositioned, duplicate tool schemas, or older checkpoint prose. Exact evidence remains in evidence packs and is loaded on demand by ID.

A new checkpoint is always rebuilt from canonical state plus the original request; it may reference older checkpoints for recovery but may not summarize a summary as its sole input.

#### Post-reset handshake and recovery

Before executing a mutating tool in the new epoch, the coordinator verifies the context-curator reset receipt and the deterministic seed manifest against the expected task ID, checkpoint ID, target lane, scope hash, unresolved-decision count, and next action. This is a runtime payload/state comparison, not a model self-attestation or a second LLM summary.

Unused side-effect approvals expire at reset and must be reconfirmed. Pending approval requests and prior approval/rejection history remain recorded. Read/write boundaries and budgets carry forward without broadening.

If the handshake fails, the context curator restores the pre-reset provider-visible epoch when supported. Otherwise it pauses the task, retains both artifacts, and asks the user to resume from the checkpoint. No mutation is allowed between failed handshake detection and recovery.

## 11. Persistent state version 2

Extend `TaskState` without embedding large raw tool results:

```ts
type TaskStateV2 = Omit<TaskStateV1, "schema_version"> & {
  schema_version: 2;
  lane: "retrieval" | "agentic" | "coding" | "structured-output" | "general";
  evidence_packs: EvidencePackSummary[];
  active_evidence_pack_id?: string;
  scope?: ScopePolicy;
  budgets: {
    tool_calls_used: number;
    blocked_calls: number;
    errors_used: number;
    iterations_used: number;
  };
  approval_requests: ApprovalRequest[];
  gate_results: GateResult[];
  dependency_evidence: DependencyEvidence[];
  structured_output_checks: StructuredOutputCheck[];
  context_epoch: number;
  context_checkpoints: ContextCheckpointSummary[];
  active_checkpoint_id?: string;
  reset_state: {
    status: "idle" | "queued" | "rendering" | "validated" | "resetting" | "verifying" | "complete" | "skipped" | "failed";
    phaseId?: string;
    lastAttemptAt?: string;
    lastReason?: string;
    cooldownUntilTurn?: number;
  };
};
```

```ts
type ContextCheckpointSummary = {
  checkpointId: string;
  sequence: number;
  schemaVersion: 1;
  fromLane: TaskStateV2["lane"];
  toLane: TaskStateV2["lane"] | "planning" | "review" | "final";
  phaseId: string;
  artifactPath: string;
  artifactSha256: string;
  canonicalStateSha256: string;
  scopeSha256?: string;
  evidencePackIds: string[];
  contextEpochBefore: number;
  contextEpochAfter?: number;
  trigger: "phase-boundary" | "context-pressure" | "manual-retry";
  status: "written" | "validated" | "reset-complete" | "checkpoint-only" | "invalid" | "recovery-required";
  createdAt: string;
};
```

Full evidence pack records belong under:

```text
.pi/tasks/{task_id}/evidence/{pack_id}.json
```

Only compact summaries enter `state.json` and the model context. Exact passages stay local and bounded in the evidence file.

### Migration

- Parse version 1 with the current contract.
- Create version-2 fields with conservative defaults.
- Do not infer prior authorization, evidence, or passed gates.
- Mark migrated validation and evidence as `unknown` until explicitly recorded.
- Save version 2 only on the next normal state write.
- Keep existing event logs and scratchpads.
- Add a migration event to `state-events.jsonl`.
- If migration fails, load the version-1 task in legacy mode and disable new enforcement rather than corrupting it.

## 12. Approval model

Approval must be attributable to the user or trusted project policy.

```ts
type ApprovalRequest = {
  requestId: string;
  createdAt: string;
  description: string;
  toolName: string;
  normalizedEffect: string;
  reversible: boolean;
  status: "pending" | "approved" | "rejected" | "expired";
  approvedBy?: "user-command" | "native-confirmation" | "trusted-project-policy";
  expiresAfterUse: boolean;
};
```

User commands:

- `/reliability approvals`
- `/reliability approve <request-id>`
- `/reliability reject <request-id>`

Rules:

- Model tool calls cannot set `approvedBy`.
- Approval is single-use by default.
- Tool name and normalized effect must match the approved request.
- Changed arguments invalidate approval.
- No-UI/headless operation blocks approval-required actions unless trusted project policy explicitly pre-approves the exact action class.
- Destructive, credential, publication, deployment, and external communication actions still require any stricter repository/system policy.

## 13. Configuration

Extend `.pi/reliability.json` with optional fields:

```json
{
  "enabled": false,
  "profile": "balanced",
  "retrieval": {
    "maxSources": 12,
    "maxPassages": 24,
    "maxPassageChars": 2000,
    "maxClaims": 30,
    "requireMaterialClaimCitations": true,
    "requireConflictDisposition": true
  },
  "scope": {
    "requireForAgentic": true,
    "requireForCoding": true,
    "defaultMaxToolCalls": 24,
    "defaultMaxErrors": 3,
    "defaultMaxIterations": 8,
    "externalSideEffects": "approval-required"
  },
  "coding": {
    "defaultMaxWriteFiles": 3,
    "maxRepairAttempts": 2,
    "requireVersionEvidence": true,
    "requireValidation": true
  },
  "structuredOutput": {
    "maxRepairAttempts": 2,
    "maxCandidateChars": 50000
  },
  "contextReset": {
    "mode": "automatic",
    "phaseBoundaries": true,
    "eligibleTransientTokens": 12000,
    "contextUsageRatio": 0.35,
    "hardContextUsageRatio": 0.70,
    "cooldownTurns": 4,
    "maxAutomaticResetsPerPhase": 1,
    "maxCheckpointChars": 24000,
    "maxContinuationSeedChars": 16000,
    "unsupportedTransport": "checkpoint-only",
    "expireUnusedApprovals": true
  },
  "evaluation": {
    "liveModels": [],
    "timeoutMs": 120000,
    "maxCases": 50
  }
}
```

Requirements:

- Read project configuration only in trusted projects.
- Clamp all numeric values to package-defined safe bounds.
- Reject unknown enum values with a visible warning.
- Do not accept credentials, API keys, arbitrary executable hooks, or user-configured checkpoint templates.
- `automatic` means automatic only inside an enabled reliability profile and only after validation/capability gates pass.
- Clamp `contextUsageRatio` below `hardContextUsageRatio`; reject an invalid ordering.
- `unsupportedTransport` may be only `checkpoint-only` or `retain-context`; neither may claim a reset occurred.
- Project policy may raise reset thresholds or disable automatic reset, but may not bypass checkpoint validation or post-reset verification.
- Existing configuration remains valid.

## 14. Commands and user experience

Retain existing `/reliability` behavior and add:

```text
/reliability lane [retrieval|agentic|coding|structured-output|general]
/reliability evidence [status|list|show <pack-id>]
/reliability scope [status|clear]
/reliability gate [retrieval|agentic|coding|structured-output|final]
/reliability checkpoint [status|list|show <checkpoint-id>|retry|auto-on|auto-off]
/reliability approvals
/reliability approve <request-id>
/reliability reject <request-id>
/reliability eval --suite retrieval|agentic|coding|all [--model provider/id] [--write]
```

Use Pi's native list/select implementation whenever choices are presented. Commands must degrade cleanly without TUI support and must not expose full sensitive evidence in autocomplete, status badges, or logs.

Progress UI should show only:

- active lane;
- current step;
- tool budget used/maximum;
- evidence coverage summary;
- unresolved gate count;
- pending approval count;
- current context epoch and checkpoint/reset status.

`checkpoint show` displays the validated Markdown artifact through the normal file viewer or bounded text fallback. `retry` is allowed only after an invalid/skipped automatic attempt and reruns the same deterministic renderer against current canonical state. `auto-off` is session-scoped and stops future resets without deleting checkpoints or restoring old context; restoration remains owned by the context curator.

## 15. Retrieval policy details

### Source priority

1. Current local project files or local authoritative documentation for the installed system.
2. Official version-matched documentation and primary sources.
3. Peer-reviewed or standards sources when applicable.
4. Reputable secondary sources.
5. Community sources, clearly labeled and never sole support for high-risk claims.

### Selection rules

- Search queries should vary by source need rather than repeat synonyms.
- Deduplicate canonical URLs and overlapping passages.
- Prefer exact passages that directly answer one claim.
- Record retrieval date and source publication/update date when available.
- Keep source authority and freshness separate from relevance.
- A high-authority source that does not support the claim is not evidence for it.
- A snippet is provisional when decisive wording requires fetching the source.

### Prompt-injection handling

- Retrieved content is always untrusted.
- Instructions inside documents, pages, code comments, or metadata never modify scope or grant approval.
- Evidence passages must preserve source wording but may be marked suspicious.
- Suspicious content remains available for analysis but is excluded from operational instructions.

## 16. Coding policy details

### Repository evidence

- Use the installed `repo-explorer` path before modifying unfamiliar repositories.
- Do not create a duplicate repository-mapping skill.
- Require relevant files, symbols, callers, tests, validation commands, and risks in the handoff.
- Use targeted reads only for gaps explicitly identified by exploration.

### Dependency and API evidence

```ts
type DependencyEvidence = {
  package: string;
  installedVersion: string;
  manifestPath: string;
  lockfilePath?: string;
  featureFlags?: string[];
  sourceKind: "installed-source" | "installed-types" | "official-versioned-docs" | "official-tag";
  locator: string;
  exactPassage?: string;
  recordedAt: string;
};
```

The coding gate requires dependency evidence only when the patch depends on an external API or configuration contract. Pure local logic changes do not need artificial documentation records.

### Validation order

1. Syntax or parser check.
2. Focused unit/contract test.
3. Type/lint/static checks relevant to changed files.
4. Affected package test suite.
5. Broader repository checks only when scope or policy requires them.
6. Diff and write-boundary inspection.

A pre-existing unrelated test failure must be reported separately and cannot be presented as proof that the patch failed or passed.

## 17. Structured-output policy

The extension should support deterministic validators for:

- JSON parsing and JSON Schema-compatible structural checks;
- YAML parsing only when a package dependency is intentionally accepted;
- CSV column/count validation;
- enum and bounded-string validation;
- Markdown checklist/status contract checks used by package workflows.

Do not add a general code-execution validator. Validation implementations must be explicit and allowlisted.

A syntactically valid document can still be semantically wrong. Gate output must distinguish:

- `syntax_valid`;
- `schema_valid`;
- `semantic_checks_passed`;
- `human_review_required`.

## 18. Evaluation strategy

### 18.1 Credential-free deterministic suite

Retrieval fixtures:

- nonexistent entity;
- missing source;
- conflicting official sources;
- stale versus current source;
- citation to unknown passage;
- answer buried among distractors;
- prompt injection inside a source;
- access-restricted source metadata;
- duplicate sources and passages;
- oversized pack.

Agentic fixtures:

- unauthorized external side effect;
- tool outside allowlist;
- write path outside scope;
- repeated failing call;
- exhausted call budget;
- changed arguments after approval;
- no-UI approval request;
- unapproved architecture decision;
- successful bounded multi-step task.

Coding fixtures:

- wrong API major version in generic web docs;
- exact version present in lockfile;
- decoy symbol with similar name;
- required two-file patch;
- attempted fourth file under a three-file limit;
- compile success but failing behavior test;
- unrelated pre-existing failure;
- security-sensitive file change;
- test weakening or deletion signal;
- two failed repair attempts.

Structured-output fixtures:

- malformed JSON;
- valid JSON with wrong types;
- missing required field;
- enum violation;
- syntactically valid but unverifiable semantics;
- successful repair on first retry;
- repair budget exhausted.

Context checkpoint/reset fixtures:

- successful research → planning checkpoint with multiple large web results;
- no reset after one search when the retrieval phase remains open;
- exact original request and later corrective user instruction preserved;
- missing material source reference blocks reset;
- unresolved conflict preserved with decision-only next action;
- active tool call or parallel batch delays reset;
- 35% pressure trigger at a stable subphase boundary;
- 70% pressure with invalid checkpoint pauses nonessential exploration;
- four-turn cooldown and one-reset-per-phase enforcement;
- atomic-write interruption leaves prior context active;
- reopened Markdown hash mismatch blocks reset;
- unsupported or stateful transport yields `checkpoint-only`;
- fresh seed omits raw search output and superseded reasoning;
- fresh seed preserves scope, artifacts, failures, validation, and next action;
- recursive-summary drift fixture proves reconstruction from canonical state;
- post-reset task/checkpoint/scope handshake success;
- handshake mismatch blocks mutation and restores/pauses safely;
- unused approval expiry and pending-request preservation;
- resume/reload/branch behavior and task isolation;
- checkpoint path/permission/redaction boundary checks.

### 18.2 Live local-model evaluation

Run the same sanitized suite in two modes:

1. baseline: skills and new guards disabled;
2. guarded: relevant skill loaded and balanced profile enabled.

Minimum model coverage before release:

- one model with 8B parameters or fewer;
- one model from 12B through 27B;
- at least one 4-bit quantized checkpoint if local hardware supports it.

Metrics:

- supported-answer rate;
- unsupported material-claim rate;
- correct abstention rate;
- citation integrity rate;
- invalid tool-call rate;
- out-of-scope action block rate;
- repeated-action rate;
- coding task pass rate after tests;
- schema-valid output rate;
- average tool calls, tokens, and wall time;
- false-block rate on valid actions;
- checkpoint completeness rate;
- context-reset success/skip/recovery rate;
- material-information retention after reset;
- provider-visible token reduction per context epoch;
- task-success delta before versus after automatic reset.

Release target:

- 100% deterministic blocking for explicit policy violations in fixtures;
- 100% citation-reference integrity in guarded fixture outputs;
- at least 20% relative reduction in unsupported completion or invalid action rate across the combined live suite;
- no more than 5 percentage points absolute regression in valid task completion;
- false-block rate below 5% on the approved-action fixture set;
- 100% retention of required checkpoint fields and resolvable evidence/scope references in deterministic fixtures;
- zero mutating calls after a failed post-reset handshake;
- at least 50% provider-visible token reduction in the large-research reset fixture;
- no more than 5 percentage points absolute live-task regression attributable to automatic reset versus guarded mode with reset disabled.

If the live target is not met, the package may ship the deterministic guards only if documentation clearly labels live model benefit as unproven and the release decision is explicitly reviewed.

## 19. Implementation workstreams

### Execution DAG

```text
Wave 0: contracts, overlap review, baselines
  ├──► Wave 1: retrieval skill + evidence runtime
  └──► Wave 2: agentic skill + scope/approval runtime
          │
Wave 1 ───┼──► Wave 3: coding + version-aware documentation
Wave 2 ───┘          │
                     └──► Wave 4: unified gate + structured output + evaluation
                                  │
                                  └──► Wave 4A: checkpoint renderer/validator + reset adapter
                                               │
                                               └──► Wave 5: migration + integration + docs
                                                            │
                                                            └──► Wave 6: independent review + report
```

Waves 1 and 2 may run concurrently only in isolated worktrees after Wave 0 freezes shared contracts. Waves 3–5 integrate sequentially because they share task state, gate types, checkpoint integrity data, `index.ts`, and package metadata. Wave 4A may not begin until the context-curator adapter contract and provider-reset capability semantics are approved in both plans.

### Required worker outcomes and handoffs

At least two independently verifiable implementation-worker outcomes are mandatory. The planned minimum is five:

| Workstream | Worker deliverable | Owned paths | Required handoff artifact |
|---|---|---|---|
| `WS-R1` Retrieval | Evidence contracts, persistence, gate, skill, and tests | Wave 1 write boundary only | `pi-extension-small-modal-reliability/dev/handoffs/ws-r1-retrieval.md` |
| `WS-A1` Agentic | Scope, approval, guard, skill, and tests | Wave 2 write boundary only | `pi-extension-small-modal-reliability/dev/handoffs/ws-a1-agentic.md` |
| `WS-C1` Coding | Coding/version skills, dependency evidence, and coding tests | Wave 3 write boundary only | `pi-extension-small-modal-reliability/dev/handoffs/ws-c1-coding.md` |
| `WS-G1` General gate | Unified gate, structured output, evaluation skill, and tests | Wave 4 write boundary only | `pi-extension-small-modal-reliability/dev/handoffs/ws-g1-quality-gate.md` |
| `WS-X1` Context reset | Checkpoint renderer/validator, context-curator adapter, handshake, and tests | Wave 4A write boundary only | `pi-extension-small-modal-reliability/dev/handoffs/ws-x1-context-reset.md` |

Each handoff must include workstream and run identity, status, base/result revision, changed files, validation commands with exit codes, omitted checks, deviations, assumptions, unresolved decisions, residual risks, and integration notes. Handoff artifacts are contributor records and belong in the package's ignored `dev/handoffs/` area unless repository policy selects another ignored handoff path before implementation.

### Wave 0 — contracts, overlap review, and baselines

- Record baseline behavior of the current package and its existing tests.
- Confirm no implemented package already owns evidence packs or task scope enforcement.
- Reconcile boundaries with the planned context-curator package and update its explicit-only trigger contract to accept validated automatic reset requests.
- Freeze a versioned adapter contract covering request, capability, reset result, rollback result, branch identity, and context epoch identity.
- Finalize version-2 state, tool schemas, checkpoint schema, guard ordering, and live-evaluation fixtures.
- Create sanitized baseline outputs for at least two available local models when practical.

**Completion criterion:** Contracts are reviewed, overlaps are resolved, and baseline artifacts are saved without modifying runtime behavior.

### Wave 1 — evidence-first retrieval

Write boundary:

- `src/evidence-contracts.ts`
- `src/evidence-state.ts`
- `src/evidence-gate.ts`
- `skills/evidence-first-retrieval/**`
- retrieval fixtures/tests

Deliver:

- evidence pack persistence;
- `reliability_evidence` tool;
- compact evidence context section;
- citation integrity and conflict gates;
- retrieval skill and routing tests.

**Completion criterion:** Every retrieval fixture reaches the expected supported/partial/conflicting/insufficient result and malformed packs cannot change state.

### Wave 2 — bounded agentic use

Write boundary:

- `src/scope-contracts.ts`
- `src/scope-state.ts`
- `src/scope-guard.ts`
- `src/approval-state.ts`
- `skills/bounded-agent-execution/**`
- agentic fixtures/tests

Deliver:

- `reliability_scope` tool;
- user approval commands;
- tool/path/budget/side-effect guards;
- short-horizon agent skill;
- compatibility tests with existing loop and supervisor guards.

**Completion criterion:** Explicitly forbidden actions never execute in fixtures; approved exact actions execute once; changed or expired approvals fail closed.

### Wave 3 — coding workflow

Write boundary:

- coding extensions to scope and gate modules;
- dependency-evidence state;
- `skills/bounded-code-repair/**`
- `skills/version-aware-docs/**`
- coding fixtures/tests

Deliver:

- write-boundary enforcement;
- dependency/API evidence contract;
- repair-attempt limits;
- coding gate integration with existing verification parsers;
- repo-explorer and feature-workflow routing boundaries.

**Completion criterion:** Coding fixtures detect scope drift, wrong-version evidence, failed behavior tests, and exhausted repair attempts while allowing the valid bounded patch path.

### Wave 4 — unified gate and general reliability

Write boundary:

- `src/quality-gate.ts`
- `src/structured-output.ts`
- `skills/validated-structured-output/**`
- `skills/small-model-regression-eval/**`
- structured-output and gate tests

Deliver:

- `reliability_gate` tool;
- lane and final gate decisions;
- structured-output validation;
- escalation records;
- offline/live evaluation reporting.

**Completion criterion:** All gates return stable pass/fail/escalate decisions and completion claims cannot bypass unresolved lane gates.

### Wave 4A — automatic checkpoint and fresh-continuation integration

Write boundary:

- `src/checkpoint-contracts.ts`
- `src/checkpoint-renderer.ts`
- `src/checkpoint-validator.ts`
- `src/context-reset-coordinator.ts`
- checkpoint/reset fixtures and adapter-contract tests

Deliver:

- deterministic phase/subphase-boundary and context-pressure trigger evaluation;
- atomic Markdown checkpoint generation from canonical state;
- completeness, reference, hash, path, and continuation-budget validation;
- versioned context-curator adapter with explicit `supported`, `checkpoint-only`, `reset-complete`, and `recovery-required` outcomes;
- fresh-context seed projection and post-reset handshake;
- approval expiry, scope preservation, cooldown, reset deduplication, and recovery behavior;
- integration evidence against the companion context-curator implementation or a contract-faithful fake when that package is not yet implemented.

**Completion criterion:** Deterministic fixtures prove that only validated checkpoints trigger supported resets, required information survives, transient research disappears from the new provider-visible epoch, and no mutation follows a failed handshake. Shipping automatic clearing remains blocked until the real context-curator provider/transport suite passes; checkpoint-only behavior may ship independently.

### Wave 5 — migration, integration, and documentation

Write boundary:

- `src/state-migration.ts`
- `src/types.ts`
- `src/core.ts`
- `index.ts`
- `package.json`
- `README.md`
- `TECHNICAL.md`
- `DEVELOPMENT.md`
- repository `README.md`
- integration/migration/package tests

Deliver:

- schema migration;
- extension registration and commands;
- package skill manifest;
- user, advanced-user, and contributor documentation;
- package catalog entry update;
- tarball contents and local install smoke test.

**Completion criterion:** Existing commands/tests pass, version-1 tasks migrate safely, all skills are discovered, documentation layers comply with repository policy, and package dry-run contains every required resource.

### Wave 6 — independent review and release evidence

- Run all deterministic and available live evaluations.
- Obtain independent read-only reviews focused on:
  1. retrieval provenance, injection resistance, and truthful gate semantics;
  2. scope/approval enforcement, coding safety, migration, and backward compatibility;
  3. checkpoint completeness, provider reset truthfulness, resume handshake, recovery, and recursive-summary drift.
- Disposition each finding as `accepted`, `rejected`, `deferred`, or `needs verification`.
- Apply accepted fixes through one integration owner and rerun affected checks.
- Do not install globally, enable, publish, or release without explicit user approval.

## 20. Writer and integration boundaries

This is a complex feature. Implementation must follow the active feature workflow and subagent governance.

- One integration owner controls `index.ts`, `src/core.ts`, `src/types.ts`, `package.json`, shared tests, checkpoint/adapter integration, and canonical plan updates.
- Concurrent workers require isolated worktrees and non-overlapping write sets.
- Retrieval, agentic, coding, and general-gate workers may work independently only after shared contracts are frozen.
- Skills and runtime modules that share schemas must be integrated sequentially through the owner.
- Reviewers inspect the integrated result, not isolated worker branches.
- No worker may enable, install, publish, or modify user settings.

## 21. Test matrix

### Acceptance checks

1. Installing the built tarball exposes one extension and exactly six new skills, with no duplicate skill names.
2. Existing `/reliability` commands and seven existing model-facing tools retain their documented behavior.
3. A version-1 fixture loads, migrates conservatively, records a migration event, and preserves original task artifacts.
4. A nonexistent-entity retrieval fixture cannot pass the retrieval or final gate without evidence.
5. Every material claim reference resolves to an existing pack, source, and passage before retrieval completion passes.
6. A conflicting-source fixture returns `escalate` until an allowed disposition is recorded.
7. Retrieved prompt-injection text cannot change task scope, grant approval, or authorize a tool.
8. Out-of-scope tools and read/write paths are blocked before execution and leave protected files unchanged.
9. A user-approved action executes once only when tool name and normalized arguments match; model-authored, changed, expired, and no-UI approvals remain blocked.
10. Tool-call, error, iteration, and repair budgets stop their corresponding fixtures at the configured bound.
11. A coding fixture cannot pass with failed/unknown validation, out-of-bound changes, or missing version evidence when an external API contract is involved.
12. A valid bounded coding fixture passes targeted checks without requiring artificial dependency evidence for purely local logic.
13. Structured-output fixtures distinguish syntax, schema, semantics, and human-review status and stop after the repair limit.
14. Full, compact, and delta context modes remain within their configured budgets and never inject full oversized passages.
15. A completed retrieval phase automatically writes a parseable Markdown checkpoint containing the original request, later authoritative instructions, evidence-backed findings, unresolved matters, scope, artifacts, validation, and one next action.
16. The original append-only session remains unchanged while the next supported provider-visible context omits selected raw search/fetch output and superseded working dialogue.
17. An incomplete, hash-mismatched, oversized, unresolved-tool-batch, or unsupported-transport checkpoint attempt keeps the existing provider-visible context and never claims a clear occurred.
18. Context-pressure triggers, cooldown, and one-reset-per-phase behavior occur at exact configured bounds; a single search call does not itself trigger reset.
19. Each checkpoint is reconstructed from canonical task state and the original request, so a second reset does not accumulate summary-of-summary drift.
20. The fresh continuation seed and reset receipt match task, checkpoint, branch, lane, scope, evidence, and next-action hashes before any mutating tool can run.
21. A failed post-reset handshake permits zero mutation and either restores the prior epoch or pauses with a recoverable checkpoint.
22. Strict completion claims with unresolved lane gates are rejected; `unknown` is never silently converted to `passed`.
23. Deterministic policy-violation fixtures are blocked at 100%, approved-action false blocks remain below the release target, and checkpoint-required fields are retained at 100%.
24. The large-research fixture reduces provider-visible input by at least 50% without losing required continuation facts.
25. The live baseline-versus-guarded report identifies exact model/checkpoint/quantization, compares automatic reset enabled versus disabled, or clearly records why live evaluation was unavailable.
26. Package tests, skill evaluations, Markdown checks, tarball dry-run, local install, resource filtering, disablement, and rollback smoke tests pass.
27. Two independent fresh-context reviewer outputs are recorded, every finding is dispositioned, and accepted fixes are revalidated.
28. `reports/small-model-reliability-toolkit.html` is current, self-contained, evidence-based, and mutually linked with this plan.

| Area | Required coverage |
|---|---|
| Existing behavior | Current commands, plan mode, context modes, loop guard, verifier parsers, task list/resume/archive |
| Tool schemas | Every action, invalid action, missing field, unknown field policy, oversized input |
| Evidence | IDs, locators, passages, claims, conflicts, bounds, compact rendering, task isolation |
| Scope | Tool allowlist, read/write paths, traversal, symlink escape where testable, budgets, narrowing/broadening |
| Approval | Request, approve, reject, expiry, single use, argument mismatch, no-UI behavior |
| Guards | Ordering, multiple simultaneous violations, blocked-call accounting, state unchanged on block |
| Coding | Write scope, validation parsing, version evidence, repair limits, unrelated failures |
| Gates | Retrieval, agentic, coding, structured output, final, unknown preservation, escalation |
| Migration | Valid v1, valid v2, malformed state, interrupted save, legacy fallback |
| Context | Full/compact/delta; automatic boundary/pressure triggers; canonical Markdown rendering; required-section parsing; atomic write/reopen/hash; raw-result omission; fresh seed; cooldown/deduplication; handshake/recovery; reload/branch isolation; unsupported-transport checkpoint-only fallback |
| Skills | Frontmatter, routing positives/negatives, relative references, portable core, Pi adapter |
| Security | Retrieved prompt injection, path abuse, model self-approval, log redaction, secret-like inputs |
| Packaging | Skill discovery, extension discovery, tarball file list, local install, reload |
| Documentation | Links, balanced fences, layer policy, package catalog, exact npm name |
| Live models | Baseline/guarded parity, metrics, timeouts, partial/unavailable model reporting |

## 22. Verification commands

At minimum:

```bash
cd pi-extension-small-modal-reliability
npm test
npm pack --dry-run --json
python3 -m unittest discover -s skills/evidence-first-retrieval/tests -p 'test_*.py'
python3 -m unittest discover -s skills/bounded-agent-execution/tests -p 'test_*.py'
python3 -m unittest discover -s skills/bounded-code-repair/tests -p 'test_*.py'
python3 -m unittest discover -s skills/version-aware-docs/tests -p 'test_*.py'
python3 -m unittest discover -s skills/validated-structured-output/tests -p 'test_*.py'
python3 -m unittest discover -s skills/small-model-regression-eval/tests -p 'test_*.py'
```

Also run the installed skill evaluator for every new `SKILL.md` when available, a local tarball install smoke test, and repository Markdown checks:

```bash
git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'
```

Live model evaluation is a separate explicit command and must report unavailable models rather than silently substituting a cloud or larger model.

## 23. Documentation plan

### `README.md`

- Rename the friendly title to Small Model Reliability for Pi.
- Explain retrieval grounding, automatic validated research/phase handoffs, fresh continuation, bounded action, coding checks, and structured-output validation in plain language.
- Explain that “clear” removes transient material only from subsequent model input and never deletes session history.
- Keep installation, first-use flow, key commands, privacy warning, and technical-reference link.
- Do not include tool schemas, state formats, source layout, or contributor tests.

### `TECHNICAL.md`

- Document complete commands, configuration, storage locations, profiles, automatic trigger thresholds, checkpoint-only fallback, supported transports, disablement, recovery, privacy, rollback, and troubleshooting.
- Explain the phase-boundary/pressure algorithm, what the fresh seed retains, approval expiry, and how users inspect or stop automatic reset.
- Explain that skills guide behavior while extension guards enforce only explicitly implemented checks.
- Explain local-model evaluation setup without contributor fixture internals.
- Do not include internal event flow or tool payload schemas.

### `DEVELOPMENT.md`

- Document tool contracts, state version 2, checkpoint schema, canonical renderer/validator, context-curator adapter and receipts, provider epoch reset, handshake/recovery state machine, migration, guard ordering, event integration, source layout, fixtures, evaluation methodology, and test commands.
- Include navigation back to README and technical reference.

### Repository `README.md`

- Update the existing extension catalog description to mention retrieval, bounded tool use, and coding reliability.
- Do not add a second catalog entry because this extends the current package.

## 24. Security and privacy requirements

- Evidence packs, checkpoints, and task state remain local.
- Checkpoint files use atomic replacement and user-only permissions where supported; paths and references cannot escape the task directory.
- Raw tool logs remain disabled by default.
- Exact passages are bounded and must pass existing secret redaction before optional diagnostic display.
- Project configuration is ignored until project trust is active.
- Evidence from one task/session cannot be referenced by another without an explicit import design, which is out of scope for this release.
- Local file locators are normalized and displayed relative to task cwd where possible.
- No telemetry is added.
- Live evaluation prompts and outputs are local artifacts unless the user explicitly configures a remote model.
- The package must visibly warn that remote providers receive evaluation prompts when one is selected.
- Retrieved text never becomes an authorization source.
- Model confidence never becomes approval or verification evidence.
- Checkpoint rendering applies secret redaction and records redaction markers without copying secret-like values into the fresh seed.
- Remote providers receive only the fresh seed and later messages after reset; documentation must disclose that the checkpoint may contain user prompts, findings, paths, and validation summaries.
- Context reset expires unused side-effect approvals and cannot broaden scope, budgets, permissions, or trusted project state.
- The pre-reset epoch, reset receipt, and checkpoint hash remain available for recovery without exposing them to unrelated tasks.

## 25. Failure behavior

- Missing evidence: return `insufficient` or `unknown`; do not guess.
- Conflicting evidence: return `escalate` until dispositioned.
- Invalid evidence pack: reject atomically; preserve prior pack.
- No active scope for an agentic/coding action: block the action in balanced/strict profiles.
- Guard exception: block uncertain mutating actions; retain context and report the error for read-only operations.
- Approval UI unavailable: leave request pending and block execution.
- State migration failure: use legacy mode and leave the original file untouched.
- Validation command unavailable: record `unknown`, not `passed`.
- Live evaluation timeout: mark the case incomplete and continue within the configured suite budget.
- Checkpoint render/parse/reference/hash failure: retain the current context, record the exact failed check, permit one bounded rebuild, then pause automatic reset for that phase.
- Atomic checkpoint write interruption: keep the previous valid artifact and context epoch; remove or quarantine the incomplete temporary file.
- Context curator absent, incompatible, or transport-unsupported: save a validated `checkpoint-only` artifact and continue without claiming token reduction or clearing.
- Reset receipt or post-reset seed-manifest mismatch: block mutation and restore the previous epoch when supported; otherwise pause for user-guided resume.
- Context hard-pressure threshold reached without a valid handoff: stop nonessential exploration and escalate; never discard more aggressively.
- Skill not loaded: runtime guards still operate when enabled; do not claim the guided workflow ran.
- Extension disabled: skills remain advisory and must say enforcement is unavailable.

## 26. Rollout

### Phase A — observe-only

- Evidence and scope tools record state.
- Automatically detect phase/pressure candidates and render/validate checkpoints, but do not transform provider-visible context.
- Report estimated retained/removed content, trigger reason, and would-reset decisions.
- Guards report would-block decisions but do not block read-only operations.
- Mutating external side effects remain blocked under existing safety policy.
- Run deterministic fixtures and collect false-positive, missed-boundary, and information-loss findings.

### Phase B — strict opt-in enforcement

- Enable all new guards and automatic validated phase-boundary resets only under `/reliability profile strict` or explicit config.
- Pressure-triggered resets use conservative thresholds, and unsupported transports stay checkpoint-only.
- Run live local-model comparisons with reset enabled and disabled.
- Keep balanced profile on existing context behavior until retention, recovery, and false-block targets pass.

### Phase C — balanced defaults

- Enable evidence integrity, explicit coding scope, budgets, completion gates, and automatic validated semantic-boundary resets in balanced mode.
- Enable pressure-triggered resets only after provider-specific compatibility and live-regression targets pass; otherwise retain boundary-only automatic reset.
- Keep side effects approval-required and expire unused approvals at every reset.
- Keep `/reliability checkpoint auto-off` as a session override.
- Keep the package globally opt-in unless the user changes configuration.

### Phase D — release

- Publish only after explicit approval, lifecycle evaluation, package dry-run, migration smoke test, documentation review, and accepted finding remediation.

## 27. Rollback and compatibility

- `/reliability off` disables runtime enforcement and future automatic resets without deleting task artifacts or rewriting the current context epoch.
- `/reliability checkpoint auto-off` disables only future automatic resets for the session; validated checkpoints remain inspectable.
- The context curator's explicit restore operation returns to the prior provider-visible epoch when supported and records a new transition; it does not delete the checkpoint.
- Version-2 task files retain fields needed by the existing status/scratchpad path.
- A rollback to an older package may not understand version 2; therefore write a version-1-compatible summary file or document that users should back up `.pi/tasks` before downgrade.
- Never downgrade task files in place automatically.
- New skills can be disabled individually through Pi package resource filtering.
- Package filtering may load the extension without skills or skills without the extension; both modes must be documented.
- Removing the package must not remove `.pi/tasks` artifacts, checkpoint Markdown, reset receipts, or original session history.
- If the reliability package and context curator versions are incompatible, automatic clearing disables itself and falls back to checkpoint-only mode.
- Branch/fork resume applies only checkpoints recorded on that branch; no context epoch or checkpoint may leak across tasks or branches.

## 28. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---:|---|
| Too many tools confuse small models | High | Add only three domain-separated tools; keep stable names and concise action enums. |
| Multiplexed tool schemas become too large | High | Bound actions/fields, concise descriptions, contract tests, and measure prompt/tool-schema tokens. |
| Evidence ledger gives false confidence | High | Separate reference integrity from semantic truth and preserve `semantic_review_required`. |
| Retrieved prompt injection changes behavior | High | Treat retrieval as untrusted data; never derive scope or approval from source text. |
| Model broadens its own scope | High | Runtime permits narrowing only; broadening becomes a user approval request. |
| Approval is forged by the model | High | Only commands, native confirmation, or trusted policy can set approval provenance. |
| Coding guard blocks legitimate generated paths | Medium | Explicit scope amendment flow, preview/check action, and false-block fixtures. |
| Existing package users break on schema change | High | Conservative v1→v2 migration, legacy fallback, compatibility tests. |
| Context-curator ownership or adapter drift | High | Freeze a versioned request/receipt contract in both plans; reliability owns checkpoint truth, curator owns provider/session transformation. |
| Automatic reset drops an instruction or unresolved decision | Critical | Required-section/reference/hash validation, exact authoritative-message references, canonical-state reconstruction, fail-open retention, and adversarial fixtures. |
| Summary-of-summary drift | High | Rebuild every checkpoint from original request plus canonical structured state; never use an older checkpoint as sole source. |
| Unsafe provider continuation claims to be fresh | Critical | Transport capability suite, reset receipts, provider-visible seed inspection, checkpoint-only fallback, and no clear claim without proof. |
| Reset occurs during unresolved tools or parallel work | High | Boundary gate requires no pending calls/batches and durable state before rendering. |
| Reset loops or harms prompt caching | High | One reset per phase/subphase, four-turn cooldown, batched research boundary, byte-stable seed, and cache diagnostics. |
| Post-reset mismatch leads to wrong mutation | Critical | Runtime manifest/receipt handshake; block all mutation until verified; restore or pause on mismatch. |
| Checkpoint persists sensitive data | High | Local user-only storage, bounded fields, redaction, remote-provider disclosure, and no raw-result duplication. |
| Overlap with safety/subagent/feature skills | Medium | Explicit ownership boundaries and routing fixtures. |
| Context header grows with evidence | High | Persist full packs separately; inject compact summaries with hard budgets and reset at validated boundaries. |
| Validation encourages test gaming | High | Final diff inspection, test-integrity signals, and no test weakening to achieve pass. |
| Live evaluation is hardware/provider-specific | Medium | Separate deterministic release gate from clearly labeled live evidence. |
| Strict guards reduce task completion | Medium | Observe-only rollout, profile controls, and false-block target. |
| Sensitive evidence is persisted | Medium | Local bounded storage, redaction, no telemetry, raw logs disabled. |

## 29. Evidence and references

### Current package evidence

- `pi-extension-small-modal-reliability/index.ts` — existing commands, seven reliability tools, context injection, loop guard, and completion integration.
- `pi-extension-small-modal-reliability/src/types.ts` — current schema-version-1 task/config contracts.
- `pi-extension-small-modal-reliability/DEVELOPMENT.md` — existing architecture, persistence, verifier, supervisor/worker, and plan-mode behavior.
- `pi-extension-small-modal-reliability/tests/reliability-harness.test.mjs` — current credential-free harness tests.

### Repository and lifecycle policy

- `AGENTS.md` — required README/TECHNICAL/DEVELOPMENT documentation layers.
- `docs/skill-lifecycle/SKILL-LIFECYCLE-POLICY.md` — create/update/evaluate/enable rules.
- Skill portability and quality references bundled with `skill-creator` — portable core, Pi adapter, routing, tests, and review requirements.
- `plans/planned/cache-aware-agent-context-pruning.md` — separate context-curation ownership boundary.

### Pi documentation

- Installed Pi `docs/extensions.md` — custom tools, lifecycle hooks, `tool_call` blocking, `tool_result` modification, context injection, project trust, and session state.
- Installed Pi `docs/skills.md` — skill discovery, frontmatter, progressive disclosure, and package loading.
- Installed Pi `docs/packages.md` — combined extension/skill package manifests, filtering, installation, and dependency rules.

### Research synthesis

- `docs/reliability/research/local-llm-under-27b-findings.md` — local research artifact covering retrieval, coding, tool use, long context, hallucination, quantization, and deployment failure modes.

### Exploration records

- Repo Explorer effectiveness report for repository package conventions: `/home/firstpick/.pi/agent/skills/repo-explorer/repo-explorer-effectiveness-2026-08-12T21-27-29-378Z-npm-packages-6765dda935.md`
- Repo Explorer effectiveness report for the current reliability package: `/home/firstpick/.pi/agent/skills/repo-explorer/repo-explorer-effectiveness-2026-08-12T21-28-20-881Z-pi-extension-small-modal-reliability-b47fdbb70e.md`

## 30. Decision and progress record

### Decisions

| Date | Decision | Evidence | Status |
|---|---|---|---|
| 2026-08-12 | Extend the existing small-model reliability package instead of creating an overlapping package. | Existing package already owns task state, loop guards, verification, and completion gating. | Approved for planning |
| 2026-08-12 | Prioritize retrieval, automatic validated context reset, bounded agency, coding, then general guards. | Local research synthesis and explicit user request for more frequent compact/clear continuation. | Approved for planning |
| 2026-08-12 | Limit the new model-facing surface to three tools and six narrowly routed skills. | Small models are vulnerable to adjacent tool/schema confusion and context growth. | Approved for planning |
| 2026-08-12 | Keep provider/session transformation in the separate context-curator package while making automatic checkpoint/reset coordination a reliability requirement. | Provider continuation and cache behavior require an independent package boundary; checkpoint completeness belongs with task reliability. | Approved for planning |
| 2026-08-12 | Automatically reset at validated semantic phase boundaries, with conservative pressure triggers and checkpoint-only fallback. | User requested automatic compaction/clearing that preserves the original prompt, findings, and continuation-critical information. | Approved for planning |

### Progress

| Date | Milestone | Evidence | Status |
|---|---|---|---|
| 2026-08-12 | Repository/package conventions inspected. | Repo Explorer reports and Pi package/extension/skill documentation cited in section 29. | Complete |
| 2026-08-12 | Architecture, skills, tool schemas, guard matrix, rollout, and tests planned. | This canonical plan. | Complete |
| 2026-08-12 | Automatic checkpoint/clear strategy added. | Sections 2–6, 9–14, 18–28, and acceptance checks. | Complete |
| — | Wave 0 contracts frozen. | To be recorded during implementation. | Pending |
| — | Worker outcomes integrated. | Required handoffs from section 19. | Pending |
| — | Independent reviews dispositioned. | Reviewer identities, findings, and revalidation evidence. | Pending |
| — | Final HTML report linked. | `reports/small-model-reliability-toolkit.html`. | Pending |

### Review finding disposition template

| Reviewer run/provider | Finding | File or symbol | Severity/evidence | Disposition | Rationale | Revalidation |
|---|---|---|---|---|---|---|
| Pending | Pending | Pending | Pending | `needs verification` | Review has not run. | Pending |

## 31. Completion record

Implementation is complete only when:

- all mandatory deterministic tests pass;
- existing package behavior remains compatible or every intentional change is documented;
- version-1 migration and legacy fallback are verified;
- all six skills pass contract, routing, portability, and lifecycle evaluation;
- retrieval, agentic, coding, checkpoint/reset, and final gates have inspectable evidence;
- every eligible supported phase boundary produces a validated Markdown handoff and verified fresh continuation, while unsupported transports are honestly checkpoint-only;
- original session history remains recoverable, required information survives reset, and failed handshakes permit no mutation;
- available live local-model evaluation, including automatic-reset enabled/disabled comparison, is reported honestly;
- independent review findings are dispositioned and accepted fixes are revalidated;
- README, TECHNICAL, DEVELOPMENT, package metadata, and repository catalog are updated;
- installation, filtering, disablement, and rollback are tested;
- no global install, enablement, or publication occurs without explicit user approval;
- this plan moves from `plans/planned/` to `plans/archive/` only after implementation and completion verification.
