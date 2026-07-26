# Phase-Scoped Workflow Tool Permissions — Implementation Plan

## Goal

Allow Workflow Mode agents to use `bash` and write tools only in the explicit workflow calls/phases that request them, while preserving deny-by-default ceilings, isolated worktrees, no automatic retry for mutation-capable calls, and defense-in-depth subprocess enforcement.

## Classification

**Complex security-sensitive feature.** It changes the workflow script/runtime contract, subprocess tool authorization, shell command validation, write isolation, retry behavior, documentation, and tests. Two implementation workstreams and provider-diverse independent review are required.

## Success criteria

1. A workflow whose effective policy grants `shell` may request `bash` on an individual `agent()` call; calls that do not request `bash` cannot use it.
2. A workflow whose effective policy grants `write` may request `write`, `edit`, or `apply_patch` on an individual call; calls that do not request those tools receive no write authority.
3. `bash` is accepted only for one simple allowlisted command. Shell operators, substitutions, redirections, newlines, ambiguous quoting, executable-path bypasses, and commands absent from the effective allowlist are denied before execution.
4. Any call requesting `bash` or a write tool is treated as mutation-capable: it receives an isolated git worktree and is never automatically retried.
5. Read-only planning/review calls remain read-only even after an earlier implementation/test phase used broader tools.
6. Global script permissions and user/project `workflow-policy.json` remain upper bounds; missing ceilings continue to deny broader authority.
7. Focused tests and the package test suite pass, and two provider-diverse reviewers approve or have every finding dispositioned.
8. A self-contained HTML report documents behavior, evidence, residual risks, and rollout guidance.

## Approved decisions and invariants

- **Explicit call scoping, not phase-name privilege.** Existing `phasePath` is lifecycle context only. Authority comes from each `agent(..., { tools: [...] })` declaration. A phase gains broader capability only through its explicitly configured calls.
- **Three-layer authorization.** A tool must be requested by the call, admitted by the workflow's effective permission ceiling, and accepted by the subprocess guard.
- **No ambient inheritance.** The subprocess policy receives the call's exact requested tool set and call-derived permissions, not the workflow-wide tool superset.
- **Deny by default.** This feature does not auto-create or relax `~/.pi/agent/workflow-policy.json` or project policy files.
- **Conservative shell grammar.** `bash` supports exactly one simple command. Compound shell syntax is intentionally unsupported.
- **Mutation-safe handling.** Because an allowlisted executable may mutate files, every `bash` call uses write-worktree isolation and the no-retry path, even when the prompt describes inspection.
- **Write application remains explicit.** Changes reach the target checkout only through the existing confirmed `/workflow apply` flow and configured verification.

## Scope

### In scope

- Shell command policy parser/validator and subprocess guard integration.
- Runner admission of `bash` under effective `permissions.shell`.
- Exact per-call tool/permission propagation.
- Worktree/no-retry coupling for shell and write calls.
- Mode prompt and README guidance for generated phase-specific calls.
- Focused regression tests and full package validation.
- Final report and review evidence.

### Non-goals

- Inferring privileges from phase names such as `implementation` or `test`.
- Automatically editing user/project workflow policy ceilings.
- Supporting pipes, command chains, redirects, substitutions, shell scripts, or arbitrary shell expressions.
- Claiming OS-level sandboxing or complete containment of an allowlisted executable.
- Changing `/workflow apply`, worktree merge semantics, network policy, or WebUI toggle behavior.

## Execution DAG

```text
Reconnaissance/design
        |
        v
WS-A shell validator + guard tests
        |
        v
WS-B1 runner call-scoping/isolation + runtime tests
        |
        v
WS-B2 mode guidance + documentation/tests
        |
        v
Integration owner inspection + focused/full tests
        |
        v
Two independent provider-diverse reviews
        |
        v
Accepted fixes (if any) + revalidation + HTML report
```

## Workstreams

### WS-A — Shell command validator and subprocess enforcement

- **Owner:** implementation worker A.
- **Prerequisites:** this plan; current `src/subprocess-policy-guard.ts`, policy schema, and guard tests.
- **Write boundary:**
  - `src/shell-command-policy.ts` (new)
  - `src/subprocess-policy-guard.ts`
  - `tests/shell-command-policy.test.mjs` (new)
  - `package.json` only if needed to add the focused test to `npm test`
- **Forbidden/shared paths:** no edits to `src/script-runner.ts`, `src/types.ts`, `src/mode.ts`, `README.md`, this plan, or report files.
- **Deliverable:** deterministic parsing/validation of one simple command; exact executable allowlist enforcement; guard checks for requested tool, call shell permission, and shell policy.
- **Validation:** focused shell-policy test plus existing policy/worktree test if unaffected.
- **Handoff:** `/tmp/phase-scoped-tools-ws-a.md`.
- **Stop/escalate:** stop before broadening grammar, adding dependencies, changing policy file schema, or weakening path/network guards.

### WS-B1 — Per-call runtime authority and isolation

- **Owner:** implementation worker B1, sequentially after WS-A.
- **Prerequisites:** WS-A integrated in the shared worktree; this plan.
- **Write boundary:**
  - `src/script-runner.ts`
  - `tests/policy-worktree.test.mjs`
- **Forbidden/shared paths:** no edits to WS-A files, mode/docs files, this plan, report files, or unrelated packages.
- **Deliverable:** admit `bash` only when the effective workflow shell permission allows it; derive exact call policy/tool set; isolate and disable retry for every shell/write call; test no authority inheritance across phases and shell/write worktree/no-retry coupling.
- **Validation:** focused policy/worktree test.
- **Handoff:** `/tmp/phase-scoped-tools-ws-b1.md`.
- **Stop/escalate:** stop before changing user/project policy defaults, application semantics, or phase API signatures.

### WS-B2 — Workflow Mode guidance and documentation

- **Owner:** implementation worker B2, sequentially after WS-B1.
- **Prerequisites:** WS-B1 integrated in the shared worktree; this plan.
- **Write boundary:**
  - `src/mode.ts`
  - `README.md`
  - `tests/mode.test.mjs`
- **Forbidden/shared paths:** no edits to WS-A/WS-B1 files, this plan, report files, or unrelated packages.
- **Deliverable:** generated-workflow guidance and documentation for global ceilings plus explicit per-call tools only in phases that need them; tests proving Workflow Mode does not infer authority from phase names or relax policy defaults.
- **Validation:** focused mode test.
- **Handoff:** `/tmp/phase-scoped-tools-ws-b2.md`.
- **Stop/escalate:** stop before changing runtime policy behavior, user/project defaults, or phase API signatures.

## Integration and acceptance checks

Integration owner: main Pi session.

1. Inspect both worker diffs and handoffs against write boundaries and this plan.
2. Confirm the effective subprocess policy contains only explicitly requested tools and call-derived permissions.
3. Confirm shell/write calls create worktrees and use one attempt; read-only calls do neither.
4. Run:
   - `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/shell-command-policy.test.mjs`
   - `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/policy-worktree.test.mjs`
   - `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/mode.test.mjs`
   - `npm test`
5. Inspect the final diff for unrelated changes and ensure pre-existing untracked WebUI files remain untouched.
6. Obtain two fresh read-only reviews from provider families distinct from each other and the primary implementation provider. Review architecture, security, grammar bypasses, isolation/retry coupling, tests, docs, and plan compliance.
7. Disposition every finding as `accepted`, `rejected`, `deferred`, or `needs verification`; apply only accepted fixes and rerun affected checks.
8. Create and strictly validate `reports/phase-scoped-tool-permissions.html`.

## Rollback

Revert the package files changed by WS-A/WS-B and remove the new shell-policy test/module. Existing policy files require no migration. Any already-created workflow worktrees remain governed by existing cleanup/recovery commands and must not be deleted automatically when they contain unmerged changes.

## Risks

| Risk | Mitigation |
|---|---|
| Shell syntax bypass admits multiple commands | Parse one conservative grammar and reject all operators/substitutions/newlines before tokenization. |
| Allowlisted executable reads/writes outside the worktree | Keep explicit user/project ceiling and document that executable capabilities are not an OS sandbox; default remains deny. |
| Read-only phase inherits workflow-wide write/shell authority | Pass exact requested tools and call-derived permissions to the subprocess guard. |
| Shell action is retried or mutates target checkout | Treat `bash` as mutation-capable, force isolated worktree, and cap attempts at one. |
| Existing workflows break | Read-only defaults and existing explicit write calls retain behavior; broader authority still requires explicit metadata, call tools, and ceiling. |
| Replay crosses privilege boundaries | Existing fingerprints include sorted requested tools; tests/inspection must verify this remains true. |

## Progress and decision record

- 2026-07-26: Repository and installed dependency traced to the sibling `pi-extension-workflows` package.
- 2026-07-26: Confirmed current write worktree isolation, global shell hard-denial, missing user/project ceilings, and explicit per-agent tool declarations.
- 2026-07-26: Selected exact per-call scoping rather than phase-name privilege or automatic policy relaxation.
- 2026-07-26: WS-A completed and passed its focused test.
- 2026-07-26: Original WS-B Anthropic worker failed twice before editing due provider rate limits. The integration owner split its distinct runtime and guidance outcomes into sequential WS-B1/WS-B2 fallback workstreams; no completion credit was assigned to the failed attempts.
- 2026-07-26: WS-B1 and WS-B2 completed sequentially in run `25e8205a-f75c-448b-9d21-cff331bc2401`; integration inspection confirmed their declared write boundaries and deliverables.
- 2026-07-26: Focused shell-policy, policy/worktree, and mode tests passed. The full `npm test` suite passed before and after accepted review fixes.

## Implementation and integration evidence

| Workstream | Run/model | Outcome | Integration disposition |
|---|---|---|---|
| WS-A shell validator/guard | `1750d3bb-1bf6-4af2-a2f6-3c03cefeb78c`; OpenAI Codex GPT-5.6 Terra xhigh | Added conservative simple-command validation, exact allowlist enforcement, guard integration, and focused tests. | **Accepted.** Scoped diff and handoff inspected; focused test passed. |
| WS-B1 runtime scoping/isolation | `25e8205a-f75c-448b-9d21-cff331bc2401`; OpenAI Codex GPT-5.6 Terra xhigh | Added per-call permissions/tools, shell admission, mutation worktrees, one-attempt behavior, and non-inheritance tests. | **Accepted.** Runtime diff, worktree records, fake-runner policy evidence, and focused test inspected. |
| WS-B2 mode/docs | `25e8205a-f75c-448b-9d21-cff331bc2401`; OpenAI Codex GPT-5.6 Sol high | Added generated-workflow guidance, README usage/security documentation, and prompt contract tests. | **Accepted.** Scoped three-file diff and focused mode test inspected. |

Concurrent unrelated edits in `index.ts`, `src/webui-subagents.ts`, `tests/extension.test.mjs`, and `tests/webui-subagents.test.mjs` were excluded from this feature's implementation/review scope and left untouched.

## Independent review quorum

| Reviewer | Runtime/provider family | Result | Qualification |
|---|---|---|---|
| Security/correctness review | Run `a5a70a69-3607-4876-8d7b-3d1c43af44b8`; `openrouter/moonshotai/kimi-k3:high` (Moonshot/Kimi family) | No blocker/high/medium findings; four low hardening/documentation/test notes. | **Qualifying success.** Fresh, read-only, independent from the OpenAI implementation provider. |
| Architecture/security replacement review | Recovered run `68454de2` from `e5594e23-9df7-48bf-b8e1-47460e1ce923`; `openrouter/google/gemini-3.6-flash:high` (Google family) | Approved clean; no findings. | **Qualifying success.** Fresh review state, read-only, provider family distinct from Kimi and OpenAI. |

The original Anthropic review attempt failed from provider rate limits/turn-budget exhaustion and did not count. A DeepSeek replacement failed before a review result because it followed a nonexistent helper-path hint and did not count.

## Reviewer finding dispositions

| Finding | Severity | Disposition | Evidence/rationale |
|---|---|---|---|
| Unquoted glob, tilde, brace, and comment syntax could change bash argv after validation. | Low | **Accepted · fixed.** | Parser now rejects `*?[]{}~#` outside quotes; focused adversarial tests pass. |
| Network-capable shell executables are outside the network-tool host allowlist. | Low | **Accepted · fixed in documentation.** | README now states the host filter applies to Web/network tools, not admitted shell executables. |
| An allowlisted executable retains full capability and is not OS-sandboxed. | Low/duplicate | **Accepted · fixed in documentation.** | README explicitly warns about subcommands, file arguments, child processes, network access, and possible access outside the worktree. |
| Malformed subprocess policy shapes could throw later instead of failing clearly at load. | Low | **Accepted · fixed.** | Guard validates permission booleans and all tool/host allowlist arrays at extension load; malformed-policy regression passes. |
| Add env-prefix, expansion/comment, empty-argument, and control-character cases. | Low | **Accepted · fixed.** | Focused test includes these cases and passes. |
| Add a dedicated replay fingerprint test. | Note | **Deferred.** | Existing `call-fingerprint.ts` includes sorted requested tools and runner admission checks denied tools before replay; inspected and covered by the existing replay suite. A dedicated one-line regression is useful but not required for this bounded feature. |
| Google-family reviewer reported no findings. | — | **Accepted as clean review.** | Independent review approved the integrated architecture and focused tests. |

## Validation evidence

Final integrated checks from `/home/firstpick/npm-packages/pi-extension-workflows`:

- `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/shell-command-policy.test.mjs` — **PASS**.
- `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/policy-worktree.test.mjs` — **PASS**.
- `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types tests/mode.test.mjs` — **PASS**.
- `npm test` — **PASS** after accepted review fixes; all package test commands completed successfully.
- Scoped `git diff --check` — **PASS**.
- `python3 /home/firstpick/.pi/agent/skills/html-report/scripts/validate_report.py reports/phase-scoped-tool-permissions.html --strict` — **PASS** with no errors or warnings.

## Final report

Final, strictly validated report: [`reports/phase-scoped-tool-permissions.html`](reports/phase-scoped-tool-permissions.html).
