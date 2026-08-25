# Development guide: Omarchy Plugin

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Package contents

- `skills/omarchy-plugin/SKILL.md` — routing boundary, ordered workflow, output contract, and portable safety rules.
- `skills/omarchy-plugin/references/DEVELOPMENT-WORKFLOW.md` — plugin-kind mapping, clone workflow, manifest/QML checks, and lifecycle validation.
- `skills/omarchy-plugin/references/PUBLISHING-CHECKLIST.md` — permanent identity, repository audit, candidate validation, and submission boundary.
- `tests/skill-contract.test.mjs` — executable package, workflow, authority, safety, publication, documentation, and routing contracts.
- `tests/routing/omarchy-plugin.json` — positive, negative, and ambiguous model-routing cases.

The package has no runtime dependencies. npm contents are controlled by the `files` allowlist in `package.json`.

## Source authority

The official development and publishing guides at `omarchyplugins.com` are the primary product sources. The current official Omarchy shell/plugin reference is authoritative when runtime contracts differ or evolve.

Keep the top-level skill as an ordered decision workflow rather than copying upstream tutorials. Preserve detailed, actionable development and publication checks in the references. When upstream changes, review the workflow, both references, routing cases, tests, and user documentation together.

## Contract boundaries

The implementation and tests must continue to enforce:

- exact package name `@firstpick/pi-skill-omarchy-plugin` and skill name `omarchy-plugin`;
- routing for Omarchy Quattro authoring, validation, troubleshooting, review, and publication preparation;
- exclusion of unrelated Hyprland plugins, generic QML, and requests that only install an existing plugin;
- explicit plugin-kind and entry-point agreement, including internal ownership of a bar widget's nested panel;
- a user-owned development path and disclosure that cloning discovers and enables the copy;
- static validation before authorized runtime lifecycle checks;
- unsandboxed execution with user permissions in the shared, long-running shell process;
- dependency and command review, no second Quickshell process, and no symlinks;
- permanent author-controlled identity, removal of clone-only metadata, and rejection of `omarchy.*` for third-party IDs;
- the distinction between Marketplace structure validation and plugin security; and
- explicit confirmation before unapproved runtime changes, repository pushes, issue submission, publication, or other external side effects.

Pi-specific instructions belong only in the skill's `Pi Adapter` section. The portable workflow must use `$HOME` or placeholders rather than private workstation paths or Pi-only tools.

## Routing fixture

The routing fixture uses the repository's native skill-routing shape:

- `should_trigger` contains direct Omarchy Quattro plugin authoring, review, troubleshooting, validation, and submission-preparation requests;
- `should_not_trigger` contains near-neighbor requests for unrelated Hyprland plugins, generic QML, and existing-plugin installation, plus unrelated work; and
- `ambiguous` records context needed to decide whether the Omarchy plugin contract is actually involved.

Changing these boundaries is a product-contract change and requires review with the plan and skill contract.

## Contract test design

The Node test suite uses only built-in modules. Tests deliberately assert decisive phrases and relationships instead of reproducing every paragraph. It reads package metadata, the portable skill, both progressive-disclosure references, all three documentation layers, the root catalog, and the routing fixture.

A failing content assertion should first be checked against current upstream guidance and the approved plan. Do not weaken a safety or authorization assertion merely to accommodate a prose rewrite; preserve the behavior and update the assertion to the clearest stable expression when appropriate.

## Verification

From the package directory, run:

```bash
npm test
node -e "JSON.parse(require('node:fs').readFileSync('tests/routing/omarchy-plugin.json', 'utf8')); console.log('routing JSON: PASS')"
npm pack --dry-run --json
```

From the repository root, run:

```bash
git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'
git diff --cached --quiet
```

Inspect the dry-run tarball listing against `package.json`; JSON output alone does not prove that the allowlist is correct. Live Omarchy, shell, QML, clone, lifecycle, repository, and Marketplace operations are outside package contract testing and must not be run as routine contributor validation.
