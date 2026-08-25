# Feature plan: Omarchy Plugin skill

**Status:** planned
**Classification:** complex
**Integration owner:** parent Pi session
**Feature root:** `pi-skill-omarchy-plugin/`
**Final report:** [`../../reports/omarchy-plugin-skill.html`](../../reports/omarchy-plugin-skill.html)

## Outcome

Create a portable, model-invoked Agent Skill package named `@firstpick/pi-skill-omarchy-plugin` that helps an agent develop, validate, review, and prepare Omarchy Quattro plugins for Marketplace submission from the official development and publishing guides.

## Classification rationale

The inherited `complex` classification is retained. Repository evidence requires several coordinated contracts: package metadata, a portable skill workflow, progressive-disclosure references, routing fixtures and contract tests, three documentation layers, and the repository catalog. The feature has two meaningful implementation slices and benefits from separate content and verification/documentation ownership, followed by central integration and independent review.

## Success criteria

1. `pi-skill-omarchy-plugin/` follows repository package and documentation conventions and uses the exact npm name `@firstpick/pi-skill-omarchy-plugin`.
2. The skill routes Omarchy Quattro plugin development, validation, troubleshooting, review, and publication-preparation requests while excluding unrelated Hyprland plugins, generic QML, and requests that only install an existing plugin.
3. The portable workflow covers plugin-kind/entry-point selection, cloning into the user-owned plugin directory, manifest design, QML implementation, static validation, runtime lifecycle checks, permanent namespacing, repository preparation, and Marketplace submission readiness.
4. Safety rules state that Omarchy plugins share the long-running shell process, run unsandboxed with user permissions, must not start another Quickshell process, cannot contain symlinks, and require explicit confirmation before submission or other external side effects.
5. Progressive-disclosure references preserve actionable details from the official development and publishing guides without making `SKILL.md` a copied tutorial.
6. Contract tests and routing fixtures pass; `npm pack --dry-run --json` contains only intended files; Markdown diff checks pass.
7. Two implementation worker outcomes are integrated and two fresh, read-only reviewer outputs from distinct provider families are dispositioned.
8. A self-contained HTML report records the design, evidence, validation, review findings, and residual risks.

## Scope

### In scope

- New package metadata, license, and package file allowlist.
- `skills/omarchy-plugin/SKILL.md`.
- Development and publishing reference documents.
- Contract tests and routing fixture.
- User `README.md`, advanced-user `TECHNICAL.md`, contributor `DEVELOPMENT.md`.
- One repository catalog entry in the root `README.md`.
- Plan, worker handoffs, validation evidence, review dispositions, and final report.

### Non-goals

- Creating or publishing a specific Omarchy plugin.
- Installing, enabling, disabling, or submitting any plugin.
- Publishing the npm package.
- Modifying Omarchy, Quickshell, Hyprland, Pi settings, or global package state.
- Reproducing the complete official guides or vendoring upstream source.

## Approved decisions and invariants

- **Invocation:** model-invoked portable Agent Skill; Pi-specific behavior is isolated in a `Pi adapter` section.
- **Source authority:** the two requested `omarchyplugins.com` guides are the primary product source; the official Omarchy shell/plugin reference remains the runtime authority when a contract differs or evolves.
- **Reference design:** keep the ordered decision workflow in `SKILL.md`; move detailed development and publication checklists into `references/`.
- **Safety posture:** inspection and validation are read-only by default. Runtime enable/disable/restart/removal, repository pushes, issue submission, installation, and publication require the user's existing authorization or a new explicit confirmation.
- **Publishing boundary:** the skill may prepare and validate submission material, but it must stop before opening or submitting the Marketplace issue when authorization is absent.
- **Portability:** no private paths, Pi-only tools, or workstation-only commands in the portable core. User paths use `$HOME` or placeholders.
- **Packaging:** version starts at `0.1.0`, license is MIT, no runtime dependencies, and npm contents are controlled by `files`.
- **No automatic enablement:** creating this package does not install or enable the skill.

## Open risks

- Upstream Omarchy Quattro contracts may change after this implementation; the skill must direct users to re-check the official shell/plugin reference.
- `omarchy`, `omarchy-shell`, `qmllint`, `jq`, and a running Omarchy Quattro environment may be unavailable in CI; contract tests validate guidance, while live plugin validation remains environment-dependent.
- The Marketplace validates listing structure, not plugin security; source and dependency review remain the author and user's responsibility.

## Execution DAG and ownership

### Wave 1 — Core skill contract (`WS-CORE`)

**Owner:** implementation worker 1, sequential writer in the shared working tree.

**May write:**

- `pi-skill-omarchy-plugin/package.json`
- `pi-skill-omarchy-plugin/LICENSE`
- `pi-skill-omarchy-plugin/skills/omarchy-plugin/SKILL.md`
- `pi-skill-omarchy-plugin/skills/omarchy-plugin/references/DEVELOPMENT-WORKFLOW.md`
- `pi-skill-omarchy-plugin/skills/omarchy-plugin/references/PUBLISHING-CHECKLIST.md`
- `plans/handoffs/omarchy-plugin-core.md`

**Deliverable:** portable skill and source-grounded progressive-disclosure references with explicit safety and publication boundaries.

**Acceptance:** frontmatter/name/layout are valid; referenced files exist; no private paths or automatic install/publish action; JSON metadata parses.

### Wave 2 — Documentation and verification (`WS-VERIFY`)

**Prerequisite:** `WS-CORE` has settled, its files and handoff exist, and the verification worker has read them. The verification worker must stop instead of normalizing missing, contradictory, or out-of-bound core work; central acceptance remains with the integration owner after both sequential outcomes.

**Owner:** implementation worker 2, sequential writer in the same working tree after Wave 1 settles.

**May write:**

- `pi-skill-omarchy-plugin/README.md`
- `pi-skill-omarchy-plugin/TECHNICAL.md`
- `pi-skill-omarchy-plugin/DEVELOPMENT.md`
- `pi-skill-omarchy-plugin/tests/skill-contract.test.mjs`
- `pi-skill-omarchy-plugin/tests/routing/omarchy-plugin.json`
- `README.md` (one Skills catalog entry only)
- `plans/handoffs/omarchy-plugin-verification.md`

**Deliverable:** repository-compliant documentation layers, routing cases, executable contract checks, and catalog discoverability.

**Acceptance:** package docs satisfy `AGENTS.md`; tests enforce decisive upstream and safety contracts; routing JSON parses; root README has one correctly placed entry.

### Wave 3 — Central integration and validation

**Owner:** integration owner only.

Inspect actual changes and both handoffs, resolve boundary drift, then run:

```bash
cd pi-skill-omarchy-plugin
npm test
npm pack --dry-run --json
node -e "JSON.parse(require('node:fs').readFileSync('tests/routing/omarchy-plugin.json', 'utf8')); console.log('routing JSON: PASS')"
cd ..
git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'
```

Also run the installed skill evaluator when available and inspect the dry-run tarball allowlist.

### Wave 4 — Independent review quorum

Two fresh-context read-only reviewers inspect the integrated result. Use distinct provider families from each other and, when available, from the primary implementation provider.

- **Reviewer A:** correctness, upstream-guide fidelity, safety boundaries, routing, and tests.
- **Reviewer B:** portability, package/docs policy, maintainability, edge cases, and publication readiness.

Each finding must identify the affected file/symbol, violated requirement or failure mode, evidence, severity, and minimal remediation. The integration owner records exactly one disposition: `accepted`, `rejected`, `deferred`, or `needs verification`.

### Wave 5 — Report and completion

Create `reports/omarchy-plugin-skill.html`, link it from this plan, record validation and review evidence, then move this plan to `plans/archive/omarchy-plugin-skill.md` only after all completion gates pass.

## Rollback

Before publication or installation, rollback is deletion of the new `pi-skill-omarchy-plugin/` tree, removal of its single root README catalog line, removal of generated handoff/report artifacts, and restoration of the plan state. Do not touch unrelated untracked `pi-package-qt-webui/plans/` content.

## Decision record

- **2026-08-25:** Retained complex classification based on multiple package contracts and required independent implementation/review outcomes.
- **2026-08-25:** Chose sequential shared-tree workers because the repository contains unrelated untracked content and governance forbids automatic isolated-worktree fanout from a dirty tree.
- **2026-08-25:** Chose a development reference plus publishing checklist instead of copying the full official tutorials into the top-level skill.
- **2026-08-25:** No blocking product or architecture decision remains; npm publication, skill enablement, and Marketplace submission are explicitly outside current authorization.

## Progress and integration record

- [x] Official development and publishing guides inspected.
- [x] Repository package, documentation, test, and lifecycle conventions inspected.
- [x] Classification and worker boundaries approved by the integration owner.
- [ ] `WS-CORE` worker handoff inspected and accepted.
- [ ] `WS-VERIFY` worker handoff inspected and accepted.
- [ ] Integrated validation passed.
- [ ] Reviewer quorum completed and findings dispositioned.
- [ ] Accepted fixes revalidated.
- [ ] Final HTML report created and mutually linked.
- [ ] Plan archived.

## Reviewer findings and dispositions

To be populated after integration. No finding may be applied before independent verification and disposition by the integration owner.
