# Development guide: Project README

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Package contents

- `skills/project-readme/SKILL.md` — routing, evidence-first workflow, audience profiles, safety boundaries, and completion criteria.
- `skills/project-readme/references/PROJECT-README-TEMPLATE.md` — canonical adaptive template and profile-specific ordering guidance.
- `skills/project-readme/references/SECTION-DECISIONS.md` — rationale for including, conditionally including, relocating, or excluding README sections.
- `skills/project-readme/tests/test_skill_contract.py` — standard-library contract tests for routing and required workflow terms.
- `tests/routing/project-readme.json` — positive, negative, and ambiguous routing cases.

`TECHNICAL.md` and `DEVELOPMENT.md` are repository documentation and are intentionally excluded from the npm tarball, following neighboring skill-package convention. The published package includes the skill contract, references, tests, routing fixture, user README, and license.

## Intended routing

Use for requests to create, harmonize, restructure, audit, review, or update a project README. Do not route requests whose primary outcome is writing API reference material, contributor guides, release notes, generic prose, or unrelated implementation work.

The skill's model-invoked instructions guide behavior but do not install the package, modify runtime settings, or provide hard enforcement. Repository-local policy and explicit write authorization remain authoritative.

## Contract boundaries

The implementation must keep these behaviors aligned across the skill, template, references, and tests:

- inspect repository evidence before making project claims;
- choose a user-oriented or developer/library-oriented profile;
- preserve useful verified content in update mode;
- keep development and implementation information out of user-oriented READMEs;
- retain essential safety, privacy, destructive-operation, and compatibility warnings near affected user steps;
- require the visual-assets gate for visual user products without inventing images or features; and
- omit irrelevant optional sections rather than leaving empty scaffolding.

Changes to package naming, routing boundaries, profiles, required visual behavior, or documentation-layer policy are product-contract changes and should be reviewed together with the contract tests.

## Verification

From the package directory, run:

```bash
npm test
node -e "JSON.parse(require('node:fs').readFileSync('tests/routing/project-readme.json', 'utf8')); console.log('routing JSON: PASS')"
npm pack --dry-run --json
```

From the repository root, also run:

```bash
git diff --check -- '*.md' ':(exclude)**/node_modules/**' ':(exclude)**/vendor/**'
```

Tests require Python 3.10+ and use only the standard library. Review the dry-run tarball listing to confirm that only the paths declared in `package.json` are included. The package has no npm runtime dependencies.
