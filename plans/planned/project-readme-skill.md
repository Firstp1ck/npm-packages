# Project README skill — complex feature plan

Status: Awaiting template and plan approval  
Integration owner: Parent Pi session  
Classification: **Complex**  
Final report: [reports/project-readme-skill.html](../../reports/project-readme-skill.html) *(created after implementation)*  
Template draft: [project-readme-template-draft.md](project-readme-template-draft.md)  
Section decisions: [project-readme-section-decisions.md](project-readme-section-decisions.md)

## Classification rationale

The preliminary `complex` classification is confirmed. The feature has at least two independently verifiable slices: (1) a reusable README template and evidence-backed section policy, and (2) a portable Agent Skill contract with routing and package tests. It also crosses user documentation, skill routing, npm packaging, repository catalog, and review contracts. Separate implementation and test ownership materially improves confidence.

## Outcome and measurable success criteria

Create `@firstpick/pi-skill-project-readme`, with skill name `project-readme`, that inspects a repository and writes or reviews a harmonized project README without blindly forcing irrelevant sections.

Success requires:

1. A reviewable canonical template covering the common README path and clearly marked conditional sections.
2. A section catalog that inventories the inspected GitHub README headings and explains every template inclusion, conditional inclusion, relocation, or exclusion.
3. For user-oriented visual products, the workflow searches for a Main Window image and identifies two to four common visualizable features. When the Main Window image is missing, it asks the user for a path/capture or an explicit opt-out. When common visualizable features are missing or unclear, it asks the user to name them and requests paths/captures for missing feature images.
4. A portable `SKILL.md` with narrow routing, repository-policy precedence, evidence-first content generation, update/create/review branches, explicit user-oriented versus developer/library-oriented audience profiles, and checkable completion criteria.
5. An npm package following repository documentation layers and metadata conventions.
6. Contract and routing tests, `npm test`, routing JSON parse, `npm pack --dry-run --json`, Markdown diff checks, and skill evaluation all pass.
7. Two qualifying implementation-worker outcomes are centrally integrated and independently reviewed by two fresh-context reviewers.
8. A self-contained HTML completion report is mutually linked with this plan.

## Scope

- Analyze project-facing README patterns across `C:/Users/hdlea/Documents/GitHub`.
- Down-weight repetitive `pi-coding-agent-forge` package READMEs while preserving its repository rules for the new package.
- Add `pi-skill-project-readme/` with README, technical and development docs, package metadata, license, skill, references, and tests.
- Add the package to the root README skill catalog.
- Preserve existing user-authored files and unrelated changes.

## Non-goals

- Rewriting existing repository READMEs.
- Installing, enabling, publishing, or globally linking the package.
- Creating a universal README that ignores project type or local documentation policy.
- Moving contributor or implementation details automatically without evidence and explicit write scope.
- Generating badges, screenshots, commands, compatibility claims, or license text that cannot be verified from the repository.

## Approved decisions and invariants

These are proposed for approval with the linked template:

- Package directory: `pi-skill-project-readme/`.
- npm name: `@firstpick/pi-skill-project-readme`.
- skill name: `project-readme`.
- Model-invoked routing for requests to create, harmonize, restructure, audit, or update a project README.
- The skill adapts a stable section order to evidence, project type, and primary audience; it does not force all optional sections.
- User-oriented packages and repositories contain no development or implementation information. Prohibited content includes API calls or endpoints, request/response examples, schemas, architecture, technology stack, repository/source layout, internal algorithms, test commands or fixtures, benchmarks, contributor setup, source-build instructions, packaging/publication internals, and release-maintenance procedures. User-visible requirements, compatibility, install/update steps, configuration, safety, troubleshooting, and recovery remain allowed.
- Developer/library-oriented READMEs may include the public integration surface: minimal code example, supported runtimes, API/documentation links, verification, and concise technical orientation.
- For user-oriented visual products, use the exact `Main Window` heading and prefer two to four representative common-feature previews. Search verified repository assets and user-visible behavior first. If the Main Window image is missing, ask the user for a path/capture or explicit opt-out. If common visualizable features are missing or unclear, ask the user to name them; request paths/captures for missing feature images. Do not invent, generate, capture, or silently substitute features or images.
- Non-visual projects and explicit user opt-outs omit empty image sections and record the reason.
- Repository-local documentation rules and existing contributor/security/license files take precedence over the generic template.
- Essential safety, privacy, destructive-install, and compatibility warnings remain visible before risky steps.
- For user-oriented READMEs, all development and implementation information is linked or moved to appropriate API, technical, or contributor documents instead of being summarized inline.
- No installation, enablement, publication, or modification of existing sibling repositories is authorized by this plan.

## Rejected or deferred options

- **One rigid README for every repository — rejected.** The corpus spans desktop/web apps, TUIs, scripts, configuration repositories, rewrites, and stubs.
- **Copy the forge skill README structure for project READMEs — rejected.** It is package-specific and was explicitly deprioritized.
- **Always include badges, screenshots, a table of contents, roadmap, acknowledgments, or architecture tree — rejected.** Corpus use is inconsistent and relevance is project-dependent.
- **Auto-enable or publish the skill — deferred.** Requires separate explicit authorization after review.

## Execution DAG and ownership

```text
Approval
  ├─ W1: package/docs/template references (isolated worktree)
  └─ W2: skill/routing/contract tests (isolated worktree)
          ↓
Central integration by parent
          ↓
Affected + cross-workstream validation
          ↓
Two independent fresh-context reviewers
          ↓
Finding disposition → accepted-fix pass if needed → revalidation
          ↓
HTML report + archive completed plan
```

### W1 — package foundation and user documentation

Owner: implementation worker 1 in an isolated worktree.  
May create only:

- `pi-skill-project-readme/package.json`
- `pi-skill-project-readme/LICENSE`
- `pi-skill-project-readme/README.md`
- `pi-skill-project-readme/TECHNICAL.md`
- `pi-skill-project-readme/DEVELOPMENT.md`
- `pi-skill-project-readme/skills/project-readme/references/PROJECT-README-TEMPLATE.md`
- `pi-skill-project-readme/skills/project-readme/references/SECTION-DECISIONS.md`

Must not edit the canonical plan, root README, `SKILL.md`, tests, settings, or other packages.  
Unique handoff artifact: `plans/handoffs/project-readme-w1-package-docs.md` in the worker artifact/worktree record.

### W2 — skill contract and tests

Owner: implementation worker 2 in a separate isolated worktree.  
May create only:

- `pi-skill-project-readme/skills/project-readme/SKILL.md`
- `pi-skill-project-readme/skills/project-readme/tests/test_skill_contract.py`
- `pi-skill-project-readme/tests/routing/project-readme.json`

Must not edit the canonical plan, root README, package metadata, package docs, references, settings, or other packages.  
Unique handoff artifact: `plans/handoffs/project-readme-w2-skill-tests.md` in the worker artifact/worktree record.

### Central integration

The parent integration owner will inspect and integrate both patches, resolve only approved contract mismatches, add the root README catalog entry, update this plan's progress/decision/review records, and run combined validation. Workers do not merge each other or update shared plan state.

## Worker handoff contract

Each worker must report workstream/run identity and status; base/result revision; changed files; implementation summary; commands with exit codes; omitted checks; deviations/assumptions; unresolved decisions and residual risks; integration notes; and its unique artifact path. Any unapproved product, package-name, interface, dependency, security, or ownership decision is a stop-and-escalate condition.

## Acceptance and validation

Affected checks:

```bash
cd pi-skill-project-readme
npm test
node -e "JSON.parse(require('node:fs').readFileSync('tests/routing/project-readme.json', 'utf8')); console.log('routing JSON: PASS')"
npm pack --dry-run --json
```

Cross-workstream checks:

```bash
git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'
```

Additional gates:

- `skill_eval_run pi-skill-project-readme/skills/project-readme/SKILL.md`
- Verify package tarball contains only declared distributable files.
- Verify all relative documentation/reference links resolve.
- Verify no private paths, credentials, copied demo passwords, volatile model IDs, or unsupported claims are packaged.
- Verify the template renders as valid Markdown after instructional comments are removed.
- Verify contract tests reject user-oriented README guidance that permits API calls/endpoints, request/response examples, schemas, architecture, technology stacks, source layouts, test commands, contributor setup, source builds, or publication/release-maintenance internals.
- Verify contract tests require the user-oriented visual branch to search for a `Main Window` image, ask the user to name common visualizable features when missing or unclear, request missing image paths/captures, preserve descriptive alt text, and allow omission only for non-visual projects or explicit user opt-out.
- Verify the root README uses the exact published package name and catalog location.

## Independent review contract

After integration, launch two distinct, read-only, fresh-context reviewers from different provider families when available:

1. **Correctness and routing reviewer:** template/skill agreement, evidence-first behavior, update/create/review branches, routing boundaries, safety, edge cases, and tests.
2. **Documentation and package reviewer:** repository documentation-layer compliance, npm package contents, links, maintainability, usability, and section-decision traceability.

Each finding must name reviewer/run/provider/model, affected file or symbol, requirement/failure mode, evidence, severity, and one disposition: `accepted`, `rejected`, `deferred`, or `needs verification`. The parent independently verifies every finding. Only accepted findings enter a bounded fix pass; all accepted fixes are revalidated.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Template becomes a bloated checklist | Core/conditional split; project-type adaptation; token-budget guidance. |
| Skill invents project facts | Require repository evidence and explicit placeholders/gaps instead of guesses. |
| Local repository policies conflict | Local policy wins; skill records adaptations. |
| Existing READMEs lose useful detail | Update mode preserves verified content and moves detail only when a destination exists or is in scope. |
| Repetitive forge READMEs bias results | Primary corpus is non-forge; forge contributes only package/documentation conventions. |
| Delegated implementation unavailable | Stop at the implementation gate and request an explicit waiver or named alternative; do not claim completion. |
| Overlapping worker edits | Isolated worktrees and exact non-overlapping file ownership. |

## Rollback

Before publication or installation, rollback is limited to removing the newly added `pi-skill-project-readme/` directory and its single root README catalog entry. Preserve this plan and review evidence unless the user explicitly requests removal. No sibling repository README is modified.

## Decision record

| Decision | Status | Evidence |
| --- | --- | --- |
| Complex classification | Proposed/recorded | Two implementation slices plus package, routing, docs, and review contracts. |
| Adaptive template over rigid template | Proposed | README corpus spans multiple project types and section depth. |
| User-oriented READMEs contain no development/implementation information | User-requested/approved | Root product documentation is exclusively for choosing, installing, configuring, using, updating, recovering, and safely removing the product; technical material is linked elsewhere. |
| Ask for missing Main Window and common-feature images | User-requested/approved | User-facing visual products should orient readers visually without fabricated or silently substituted assets. |
| `project-readme` / `pi-skill-project-readme` naming | Proposed | Narrow, predictable routing and repository naming convention. |
| Package remains uninstalled/unpublished | Approved by policy unless separately authorized | Skill lifecycle and repository rules. |

## Progress record

- 2026-08-10: Loaded feature, delegation, package, portability, and skill-quality policies.
- 2026-08-10: Inventoried all top-level GitHub project READMEs plus meaningful nested project READMEs; down-weighted forge package README repetition.
- 2026-08-10: Drafted template and section decision rationale for user review.
- 2026-08-10: Revised the template to distinguish user-oriented and developer/library-oriented profiles.
- 2026-08-10: Strengthened the user-oriented profile: development and implementation information, including API calls, is prohibited rather than merely optional.
- 2026-08-10: Added a visual-assets gate for user-oriented products: ask for a Main Window image and common-feature images when verified repository assets are missing.
- Implementation, integration, review, report, and archival are pending explicit plan/template approval.
