# MUSE-Autoskill Recommendations for the Pi Skill Ecosystem

**Source paper:** `~/Downloads/MUSE-AUtoskill-agent.pdf` — *MUSE-Autoskill: Self-Evolving Agents via Skill Creation, Memory, Management, and Evaluation*  
**Created:** 2026-05-29  
**Scope:** Practical, independently delegable implementation tasks for Firstpick's Pi skill ecosystem.  
**Overall confidence:** 91/100

## Executive Summary

The paper's most actionable idea is to treat skills as long-lived, managed, testable assets with a lifecycle:

```text
create → remember → manage/retrieve → evaluate → refine
```

Your current Pi setup already has strong foundations: Agent Skills-style `SKILL.md` packages, progressive disclosure, package-level skill symlinks, and several quality/research skills. The largest gaps are per-skill memory, systematic evaluation, lifecycle management, and a safe skill-creation/refinement pipeline.

Each task below is intentionally self-contained so it can be delegated to a separate agent/person and closed independently.

## Latest Staged Implementation Snapshot — 2026-05-29

The current staged changes implement the MUSE-inspired skill-management spine as concrete Pi packages and supporting docs:

| Task | Staged implementation status |
|---|---|
| 1. Skill bank manager | Implemented as vendored resources in `pi-package-skill-lifecycle/vendor/pi-skill-skill-bank-manager`. |
| 2. Per-skill memory | Implemented by extending `pi-extension-memory-helper` and vendoring it into `pi-package-skill-lifecycle/vendor/pi-extension-memory-helper`. |
| 3. Skill evaluator | Implemented as vendored resources in `pi-package-skill-lifecycle/vendor/pi-skill-skill-evaluator`. |
| 4. Skill creator | Implemented as vendored resources in `pi-package-skill-lifecycle/vendor/pi-skill-skill-creator`. |
| 5. Skill refinement loop | Implemented as vendored resources in `pi-package-skill-lifecycle/vendor/pi-skill-skill-refinement-loop`. |
| 6. Routing fixtures | Implemented as development-only fixtures under `tests/routing/` with `dev/scripts/validate-skill-routing-fixtures.mjs`; validator is schema-only by default and supports explicit `--settings`/`--skill-root` targets. |
| 7. Skill portability guidelines | Packaged into `pi-package-skill-lifecycle/vendor/pi-skill-skill-creator/skills/skill-creator/references/SKILL-PORTABILITY.md`. |
| 8. Lifecycle policy | Packaged into `docs/skill-lifecycle/SKILL-LIFECYCLE-POLICY.md` and referenced directly by the lifecycle skills. |
| Bundle package | Added `pi-package-skill-lifecycle` v0.1.0 as a self-contained package bundling memory helper, bank manager, evaluator, creator, and refinement-loop resources under `vendor/`. |

Main deviations from the original recommendations:

- Task 2 extends the existing memory helper instead of creating a dedicated `pi-extension-skill-memory` package.
- Task 3 is a standalone evaluator package, not folded into the skill-bank manager.
- Task 4 defaults drafts to `<pi-agent-dir>/drafts/skills/` because `<pi-agent-dir>/skills/` recursively discovers `SKILL.md` files and would risk exposing unreviewed drafts.
- Task 5 treats Task 2 and Task 3 as optional integrations: it writes per-skill memory directly and includes evaluator steps when `skill_eval_run` is available.
- Task 6 uses repository-level fixtures as development/evaluation data only, not production runtime resources. The validator no longer reads a maintainer's Pi config by default; use explicit `--settings` or `--skill-root` for coverage checks.
- Task 8 intentionally lives in the Pi agent policy area instead of this npm package repository.

---

## Task 1 — Build `pi-skill-skill-bank-manager`

**Owner type:** Pi extension/skill developer  
**Priority:** P1  
**Estimated size:** Medium  
**Dependencies:** None  
**Confidence:** 91/100  
**Status:** Implemented as vendored resources in `<repo-root>/pi-package-skill-lifecycle/vendor/pi-skill-skill-bank-manager/`.

### Objective

Create a Pi-native skill/package that audits, inventories, and manages the local skill bank.

### Rationale

MUSE shows that skill quality depends on lifecycle management: retrieval, merging, pruning, and maintenance. Your current skill ecosystem has many skills, but no dedicated manager that reports stale, duplicate, untested, or low-quality skills.

### Deliverables

- New package:

```text
<repo-root>/pi-package-skill-lifecycle/vendor/pi-skill-skill-bank-manager/
```

- Skill file:

```text
skills/skill-bank-manager/SKILL.md
```

- Optional extension tools:

```text
skillbank_audit
skillbank_find_overlap
skillbank_prune_plan
skillbank_run_tests
```

- Markdown report output format, e.g.:

```text
/tmp/pi-skill-bank-audit.md
```

### Required Capabilities

- Discover enabled and installed skills.
- Detect missing `tests/`, `scripts/`, `references/`, and validation metadata.
- Detect likely duplicate skill scopes from frontmatter descriptions.
- Detect vague descriptions that hurt routing.
- Produce merge/update/prune recommendations without mutating files.
- Respect Pi's native skill/package structure and symlink workflow.

### Acceptance Criteria

- [x] Running the audit lists all currently enabled skills from `<pi-agent-dir>/settings.json`.
- [x] Running the audit lists all top-level symlinked skills under `<pi-agent-dir>/skills`.
- [x] Report includes at least these columns: skill, enabled status, package path, has tests, has scripts, has references, risk, recommendation.
- [x] Tool is read-only by default.
- [x] Any prune/merge action is emitted as a plan only, not applied automatically.
- [x] Package can be enabled through the existing Pi skill setup flow.

### Suggested Verification

```bash
cd <repo-root>/pi-package-skill-lifecycle/vendor/pi-skill-skill-bank-manager
npm test || bun test
pi --version
```

Manual check:

```bash
ls -l <pi-agent-dir>/skills
cat <pi-agent-dir>/settings.json
```

### Done Definition

The task is done when the package exists, the audit command produces a useful read-only report, and the report correctly covers enabled + installed skills.

Implementation verification: `npm test`, `bun --check`, `bun scripts/skillbank-audit.ts /tmp/pi-skill-bank-audit.md`, `pi --version`, `npm pack --dry-run`, and manual `ls -l <pi-agent-dir>/skills` checks passed on 2026-05-29.

---

## Task 2 — Add Per-Skill Memory Store

**Owner type:** Pi extension developer  
**Priority:** P1  
**Estimated size:** Medium  
**Dependencies:** None  
**Confidence:** 90/100  
**Status:** Implemented in `<repo-root>/pi-extension-memory-helper/` as version `0.1.9`.

### Objective

Implement per-skill memory outside reusable package directories.

### Rationale

The paper's unique contribution is skill-level memory: each skill accumulates usage observations, failure modes, and successful patterns over time. For Pi, memory should not be stored inside package directories by default, because that would dirty repos and may mix personal experience with portable package code.

### Recommended Storage Layout

```text
~/.pi/agent/memory/skills/<skill-name>.md
```

Example:

```md
## 2026-05-29 22:10 UTC
- Observation: repo-explorer gives better results before broad grep/read passes.
- Failure mode: compact budget may omit enough evidence for final citations.
- Next invocation hint: retry with includeEvidence=true when exact snippets matter.
```

### Deliverables

- New or extended extension package, likely under:

```text
<repo-root>/pi-extension-memory-helper/
```

or a dedicated package:

```text
<repo-root>/pi-extension-skill-memory/
```

- Tools:

```text
skill_memory_read
skill_memory_add
skill_memory_search
skill_memory_list
```

- Clear memory format documentation.

### Required Capabilities

- Append-only writes.
- Search across skill memory notes.
- Read memory for a specific skill by name.
- Avoid secrets by default; include redaction guidance.
- Keep memory local and personal; do not package it for publishing.

### Acceptance Criteria

- [x] `skill_memory_add` creates `~/.pi/agent/memory/skills/<skill>.md` if missing.
- [x] Memory entries are timestamped and append-only.
- [x] `skill_memory_read` returns only the requested skill's memory.
- [x] `skill_memory_search` can find entries across skill memory files.
- [x] Tool docs warn against storing secrets.
- [x] No package skill directory is modified during normal memory writes.

### Suggested Verification

Inside Pi, use the tools below, or the slash-command equivalents `/skill-memory-add`, `/skill-memory-read`, `/skill-memory-search`, and `/skill-memory-list`:

```text
skill_memory_add repo-explorer "Test entry: compact budget was enough for structure-only audit."
skill_memory_read repo-explorer
skill_memory_search "compact budget"
skill_memory_list
```

Filesystem check:

```bash
ls ~/.pi/agent/memory/skills
```

Package verification:

```bash
cd <repo-root>/pi-extension-memory-helper
npm test
npm pack --dry-run --json --ignore-scripts
```

### Done Definition

The task is done when per-skill memory can be written, read, and searched without modifying skill package repos. Verified with `npm test` (7 passing tests) and `npm pack --dry-run --json --ignore-scripts`.

---

## Task 3 — Create a Skill Evaluation Harness

**Owner type:** QA/evaluation engineer  
**Priority:** P1  
**Estimated size:** Medium-large  
**Dependencies:** None  
**Confidence:** 88/100  
**Status:** Done 2026-05-29 — implemented as vendored resources in `<repo-root>/pi-package-skill-lifecycle/vendor/pi-skill-skill-evaluator/`.  
**Deviation:** Implemented as a dedicated package rather than integrating the evaluator into `pi-skill-skill-bank-manager`.

### Objective

Create a reusable evaluation harness that validates skill structure, routing quality, safety, and script behavior.

### Rationale

MUSE gates skill registration on tests. Your current ecosystem has many doc-only skills and only a small minority with `tests/`. Doc-only skills still need testable contracts: routing examples, required sections, safety boundaries, and output expectations.

### Deliverables

- New package:

```text
<repo-root>/pi-package-skill-lifecycle/vendor/pi-skill-skill-evaluator/
```

or integrated evaluator inside `pi-skill-skill-bank-manager`.

- Test conventions document:

```text
skills/<skill-name>/tests/
  test_skill_contract.py
  test_routing_examples.py
  fixtures/
```

- CLI/tool:

```text
skill_eval_run <skill-path>
skill_eval_all
```

### Required Checks

- Frontmatter exists and has valid `name` + `description`.
- Description is specific enough for routing.
- Skill body has useful sections: triggers/when-to-use, workflow, verification, safety/failure modes where relevant.
- Commands are not destructive without explicit confirmation language.
- Any scripts referenced in `SKILL.md` exist.
- Any `tests/` present can be run.
- Optional: should-trigger / should-not-trigger prompt fixtures.

### Acceptance Criteria

- [x] Evaluator can run against one skill path.
- [x] Evaluator can run against all enabled skills.
- [x] Evaluator returns machine-readable JSON and human-readable Markdown.
- [x] Evaluator exits non-zero on hard failures.
- [x] Evaluator distinguishes warnings from blocking failures.
- [x] At least three existing skills are evaluated as pilot cases.

### Implementation Notes

Implemented as `<repo-root>/pi-package-skill-lifecycle/vendor/pi-skill-skill-evaluator/` with CLI wrappers, Pi tools, a reusable evaluator script, tests, and test-conventions documentation. It registers both `skill_eval_run` and `skill_eval_all`, emits JSON and Markdown, exits non-zero on blocking failures, and validates frontmatter, required workflow/safety/verification sections, destructive command safeguards, referenced paths, per-skill routing fixtures, and runnable tests.

The evaluator is Pi-aware: it treats Agent Skills name/directory mismatches as warnings because Pi explicitly allows them. It also supports both `unittest` tests and simple pytest-style no-argument `test_*` functions without requiring pytest.

Current routing-fixture deviation: Task 6's central fixtures in repository-level `tests/routing/` are still validated by `dev/scripts/validate-skill-routing-fixtures.mjs`. The evaluator currently validates routing fixtures bundled under each skill directory and does not yet expose a `--routing-only` mode.

### Suggested Verification

```bash
cd <repo-root>/pi-package-skill-lifecycle/vendor/pi-skill-skill-evaluator
npm test
./bin/skill_eval_run ./skills/skill-evaluator/SKILL.md

skill_eval_run <pi-agent-dir>/skills/repo-explorer/SKILL.md
skill_eval_run <pi-agent-dir>/skills/deep-research/SKILL.md
skill_eval_all --enabled-only
npm pack --dry-run
```

### Done Definition

The task is done when skill evaluation produces repeatable pass/warn/fail reports and can be used as a quality gate before enabling or publishing skills. Verified with `npm test` (6 passing tests), `skill_eval_run` pilot checks for `repo-explorer`, `patch-md`, and `learnings`, `skill_eval_all --enabled-only`, and `npm pack --dry-run`.

---

## Task 4 — Build Pi-Native Skill Creator Workflow

**Owner type:** Agent workflow/tooling developer  
**Priority:** P2  
**Estimated size:** Large  
**Dependencies:** Task 3 recommended, but not strictly required  
**Confidence:** 86/100  
**Status:** Done 2026-05-29 — implemented as vendored resources in `<repo-root>/pi-package-skill-lifecycle/vendor/pi-skill-skill-creator/`.  
**Deviation:** Draft output defaults to `<pi-agent-dir>/drafts/skills/` instead of any path under `<pi-agent-dir>/skills/` to avoid accidental recursive skill discovery.

### Objective

Create a Pi-native workflow for drafting new skills from repeated successful work.

### Rationale

The paper's self-created skills were strongest when distilled from successful trajectories. The practical rule should be: create a skill only when a workflow is repeated, expensive, or likely to be reused at least three times.

### Deliverables

- New package:

```text
<repo-root>/pi-package-skill-lifecycle/vendor/pi-skill-skill-creator/
```

- Skill:

```text
skills/skill-creator/SKILL.md
```

- Optional tools:

```text
skill_create_draft
skill_create_from_notes
skill_create_from_patch
```

- Draft output location:

```text
<pi-agent-dir>/drafts/skills/<skill-name>/SKILL.md
```

> Correction: the originally proposed `<pi-agent-dir>/skills/drafts/<skill-name>/SKILL.md` path conflicts with the "not auto-enabled" requirement because Pi recursively discovers `SKILL.md` files under `<pi-agent-dir>/skills/`. Drafts should stay outside discovered skill roots until reviewed.

or package skeleton:

```text
<repo-root>/pi-skill-<skill-name>/skills/<skill-name>/SKILL.md
```

### Required Workflow

1. Confirm the task is reusable.
2. Extract a concise procedure from the successful trajectory.
3. Generate a portable Agent Skills-style `SKILL.md`.
4. Add fixtures or tests when possible.
5. Run the evaluator from Task 3 if available.
6. Ask before enabling the skill.

### Acceptance Criteria

- [x] Draft skill includes valid frontmatter.
- [x] Draft skill includes when-to-use, workflow, verification, and safety sections.
- [x] Draft skill avoids hardcoded private paths unless explicitly marked Pi-local.
- [x] Draft is not auto-enabled without confirmation.
- [x] Draft can run the skill evaluation harness when installed and falls back to built-in draft validation when it is unavailable.
- [x] A sample draft is generated from a simple known workflow.

### Implementation Notes

Implemented as `<repo-root>/pi-package-skill-lifecycle/vendor/pi-skill-skill-creator/` with `skill-creator` documentation, Pi extension tools (`skill_create_draft`, `skill_create_from_notes`, `skill_create_from_patch`), Node script wrappers, a drafting library, reference guide, example trajectory, and Python contract tests.

The implementation enforces a reusability gate, can write either disabled drafts or package skeletons, refuses discovered skill-root outputs by default, sanitizes private paths for portable drafts, can add contract tests, and can invoke the skill evaluator when available.

### Suggested Verification

```bash
cd <repo-root>/pi-package-skill-lifecycle/vendor/pi-skill-skill-creator
npm test

cd skills/skill-creator
node ./scripts/skill_create_draft.mjs \
  --name example-repeatable-workflow \
  --source-notes ./examples/example-successful-trajectory.md \
  --reusability repeated-3-plus \
  --reuse-count 3 \
  --reusability-evidence "Used successfully for three similar tasks." \
  --output <pi-agent-dir>/drafts/skills/example-repeatable-workflow \
  --with-tests

skill_eval_run <pi-agent-dir>/drafts/skills/example-repeatable-workflow/SKILL.md
```

### Done Definition

The task is done when a new reusable skill can be drafted, validated, reviewed, and manually enabled without touching existing skills. Staged implementation verified by the package's `npm test` contract suite and sample draft workflow.

---

## Task 5 — Implement Skill Refinement Loop

**Owner type:** Agent reliability engineer  
**Priority:** P2  
**Estimated size:** Medium  
**Dependencies:** Task 2 and Task 3 recommended  
**Confidence:** 89/100  
**Status:** Done 2026-05-29 — implemented as vendored resources in `<repo-root>/pi-package-skill-lifecycle/vendor/pi-skill-skill-refinement-loop/`.  
**Deviation:** Task 2 and Task 3 are treated as optional integrations. The refinement tool writes per-skill memory directly and includes evaluator verification when `skill_eval_run` is available.

### Objective

Turn user corrections, failed tests, and observed skill failures into structured skill improvement proposals.

### Rationale

MUSE refines skills when tests or runtime feedback fail. In your ecosystem, this should connect naturally to `patch-md`, `learnings`, and per-skill memory.

### Deliverables

- Workflow documentation in a new or existing skill.
- Optional tool:

```text
skill_refinement_plan
```

- Output format:

```text
<skill-package>/PATCH.md
```

or:

```text
/tmp/skill-refinement-<skill-name>.md
```

### Required Workflow

1. Detect correction/failure involving a skill.
2. Add a short per-skill memory entry.
3. Create a `PATCH.md` proposal.
4. Add or update a regression test if possible.
5. Run the skill evaluator.
6. Apply only after validation and user approval for risky changes.

### Acceptance Criteria

- [x] A failed skill invocation can produce a refinement plan.
- [x] Refinement plan includes evidence, root cause hypothesis, patch summary, and verification steps.
- [x] Per-skill memory is updated with the failure pattern.
- [x] Regression test is proposed or explicitly marked not applicable.
- [x] No automatic destructive edits occur.

### Implementation Notes

Implemented as `<repo-root>/pi-package-skill-lifecycle/vendor/pi-skill-skill-refinement-loop/` with `skill-refinement-loop` documentation, the `skill_refinement_plan` Pi tool, and a Bun mock test. The tool creates a non-destructive PATCH.md-style proposal, appends a concise per-skill memory note under `~/.pi/agent/memory/skills/<skill>.md`, refuses to overwrite explicit output paths unless `overwrite=true`, and supports `dryRun=true` previews.

The default proposal path is a unique `/tmp/skill-refinement-<skill>-<timestamp>.md`; writing into `<skill-package>/PATCH.md` remains a caller-selected option rather than the default, avoiding accidental package repo mutations.

### Suggested Verification

```bash
cd <repo-root>/pi-package-skill-lifecycle/vendor/pi-skill-skill-refinement-loop
bun tests/mocktest.ts
```

Simulated correction covered by the mock test:

```text
User: The repo-explorer skill should have used includeEvidence=true because I asked for exact code citations.
```

Expected output:

- Memory note added for `repo-explorer`.
- PATCH.md-style proposal generated.
- Regression/routing test proposed.

### Done Definition

The task is done when a real or simulated skill failure creates a complete, reviewable improvement package without directly mutating production skill behavior. Staged implementation verification is `bun tests/mocktest.ts`.

---

## Task 6 — Add Routing Simulation Tests for Enabled Skills

**Owner type:** QA/test engineer  
**Priority:** P2  
**Estimated size:** Medium  
**Dependencies:** Task 3 preferred  
**Confidence:** 87/100  
**Status:** Done 2026-05-29 — implemented central development fixtures in `tests/routing/` plus standalone validator `dev/scripts/validate-skill-routing-fixtures.mjs`.  
**Deviation:** Repository-level routing fixtures are development/evaluation data, not production runtime resources. The validator is schema-only by default and does not read a maintainer's Pi config unless `--settings` or `--skill-root` is provided.

### Objective

Create prompt fixtures that test when each enabled skill should and should not activate.

### Rationale

Pi relies heavily on skill descriptions for progressive disclosure. MUSE's efficiency depends on selecting the right skill instead of loading irrelevant ones. Routing tests make this measurable.

### Deliverables

For each enabled skill, add fixtures like:

```text
tests/routing/<skill-name>.json
```

Example schema:

```json
{
  "skill": "repo-explorer",
  "should_trigger": [
    "Find where authentication is implemented in this unknown repo",
    "Trace dependencies for this feature before editing"
  ],
  "should_not_trigger": [
    "Summarize this academic paper",
    "Troubleshoot Hyprland monitor scaling"
  ]
}
```

### Acceptance Criteria

- [x] Routing fixtures exist for the explicit repository target set, including `skill-bank-manager`, `skill-creator`, `skill-evaluator`, and `skill-refinement-loop`.
- [x] Each routing fixture has at least 3 should-trigger prompts.
- [x] Each routing fixture has at least 3 should-not-trigger prompts.
- [x] Ambiguous prompts are marked and reviewed manually.
- [x] Results identify overlapping descriptions between skills.

### Suggested Verification

```bash
node dev/scripts/validate-skill-routing-fixtures.mjs

# Separate structural/evaluator gate for enabled skills:
skill_eval_all --enabled-only --skip-tests
```

Observed current result: schema-only validation exits `0`; explicit settings validation against the current development environment exits `0` with 16 target skills and 16 fixture files.

Future integration opportunity: add central fixture ingestion and/or `--routing-only` to the skill evaluator if repository-level routing tests should become part of `skill_eval_all`.

### Done Definition

The task is done when enabled skill routing can be regression-tested with stable fixtures.

---

## Task 7 — Add Skill Portability Guidelines

**Owner type:** Documentation/standards owner  
**Priority:** P3  
**Estimated size:** Small  
**Dependencies:** None  
**Confidence:** 87/100  
**Status:** Done 2026-05-29 — packaged in `pi-package-skill-lifecycle/vendor/pi-skill-skill-creator/skills/skill-creator/references/SKILL-PORTABILITY.md`.

### Objective

Document rules for writing skills that remain portable across Pi, Claude Code, Codex, and other Agent Skills-compatible harnesses.

### Rationale

The paper's cross-agent transfer result is one of the strongest practical signals. Portable skills should avoid Pi-only assumptions in their core workflow and isolate Pi-specific helpers.

### Deliverables

- Packaged documentation file:

```text
<repo-root>/pi-package-skill-lifecycle/vendor/pi-skill-skill-creator/skills/skill-creator/references/SKILL-PORTABILITY.md
```


### Required Guidance

- Keep core workflow in generic Agent Skills format.
- Put Pi-specific commands under `## Pi adapter`.
- Avoid hardcoded private paths in portable sections.
- Prefer Python/shell/Node scripts with explicit dependencies.
- Keep personal runtime memory outside package directories.
- Include tests and fixtures when practical.

### Acceptance Criteria

- [x] Guidelines explain portable vs Pi-local skill content.
- [x] Guidelines include examples of good and bad path usage.
- [x] Guidelines define where personal memory belongs.
- [x] Guidelines define minimum sections for new skills.

### Done Definition

The task is done when future skill authors have a concise portability standard to follow.

---

## Task 8 — Add Skill Lifecycle Policy to AGENTS.md or Dedicated Doc

**Owner type:** Workspace policy maintainer  
**Priority:** P3  
**Estimated size:** Small  
**Dependencies:** None  
**Confidence:** 85/100  
**Status:** Done 2026-05-30 — moved into `docs/skill-lifecycle/SKILL-LIFECYCLE-POLICY.md` so the lifecycle package is self-contained and npm-publishable.

### Objective

Add a concise operational policy that tells agents when to create, update, evaluate, or retire skills.

### Rationale

Without a policy, agents may create too many low-value skills or fail to improve existing ones. The paper suggests skills should be created on demand, evaluated before reuse, and refined from feedback.

### Recommended Policy

Create or update a skill when at least one is true:

- The same workflow has been repeated 3+ times.
- The task is expensive in tokens/time and likely to recur.
- A user correction reveals a reusable failure mode.
- A successful trajectory captures non-obvious procedural knowledge.

Do not create a skill when:

- The task is one-off.
- A current skill already covers it.
- The solution depends on private one-time context.
- No verification path exists and the risk is high.

### Deliverables

Package the policy with the lifecycle package:

```text
<repo-root>/docs/skill-lifecycle/SKILL-LIFECYCLE-POLICY.md
```

Lifecycle skills should reference this bundled file directly when installed from npm.

### Acceptance Criteria

- [x] Policy defines create/update/merge/prune triggers.
- [x] Policy requires evaluation before enabling generated skills.
- [x] Policy requires user confirmation before auto-enabling or publishing skills.
- [x] Policy references per-skill memory location.

### Implementation Note

Implemented 2026-05-30 by moving the canonical policy into `docs/skill-lifecycle/SKILL-LIFECYCLE-POLICY.md`, including `docs/` in the package's npm `files`, and referencing the bundled policy from the lifecycle skills. This keeps active Pi config lean while making the policy publishable with the package.

### Done Definition

The task is done when agents have a clear rulebook for lifecycle-managed skills.

---

## Suggested Delegation / Ownership Plan

| Task | Best delegate | Staged status | Follow-up needed? |
|---|---|---|---|
| 1. Skill bank manager | Tooling agent/person | Done | Enable/publish only after review. |
| 2. Per-skill memory | Extension developer | Done | Use in real skill invocations and monitor secret-redaction behavior. |
| 3. Evaluation harness | QA/eval engineer | Done | Add central routing fixture ingestion / `--routing-only`. |
| 4. Skill creator | Workflow/tooling developer | Done | Exercise on real repeated workflows before publishing. |
| 5. Refinement loop | Reliability engineer | Done | Connect proposals to real skill patches and evaluator gates. |
| 6. Routing tests | QA/test engineer | Done | Optionally integrate standalone validator into evaluator or CI. |
| 7. Portability guidelines | Documentation owner | Done | Apply to future skill reviews. |
| 8. Lifecycle policy | Package maintainer | Done | Keep lifecycle skill references aligned with the packaged policy. |

## Recommended Next Sprint

The original first sprint items — skill bank manager, per-skill memory, evaluator MVP, and packaged lifecycle policy — are now implemented. The next useful sprint is hardening and integration:

1. Install/enable the staged packages in a controlled Pi session after explicit approval.
2. Run `node dev/scripts/validate-skill-routing-fixtures.mjs` schema-only and, when needed, rerun with explicit `--settings` or `--skill-root` targets.
3. Run `skillbank_audit` and `skill_eval_all --enabled-only --agent-dir <pi-agent-dir>` against the intended active environment.
4. Decide whether repository-level routing fixtures should be integrated into `pi-skill-skill-evaluator` or kept as development-only checks.
5. Use `skill-creator` and `skill-refinement-loop` on one real workflow each, then feed resulting lessons into per-skill memory and evaluator fixtures.
6. Publish/use only the self-contained `pi-package-skill-lifecycle` bundle; the former individual `pi-skill-skill-*` package directories were removed.

## Key Risks

- **Skill bloat:** Too many generated skills can reduce routing quality.
- **Overfitting:** A skill distilled from one success can encode fragile assumptions.
- **Repo pollution:** Runtime memory inside package dirs can dirty npm package repos.
- **False confidence:** Untested doc-only skills may look reliable but fail in edge cases.
- **Split routing validation:** Development-only `tests/routing/` fixtures and per-skill evaluator routing checks are not unified yet.
- **Security/privacy:** Skill memory may accidentally preserve private context if not redacted.

## Non-Goals

- Fully autonomous skill publishing.
- Automatic destructive pruning.
- Blindly enabling all generated skills.
- Moving personal memory into portable package artifacts.

## Final Recommendation

The staged changes have moved the MUSE recommendations from proposal to MVP implementation for Tasks 1–7, with Task 8 implemented in the active Pi policy workspace. They also add a self-contained `pi-package-skill-lifecycle` bundle for the resources that work together. Treat the next phase as hardening: enable deliberately, run the audit/evaluator/fixture gates against the intended environment, decide whether routing fixtures remain development-only, and only publish packages after review.

**Final confidence:** 91/100
