# Development guide: Html Report

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Package contents

- `skills/html-report/SKILL.md` — routing, workflow, safety, and output contract.
- `skills/html-report/assets/starter-template.html` — self-contained report shell demonstrating the design and components.
- `skills/html-report/references/DESIGN-SYSTEM.md` — canonical visual tokens and components.
- `skills/html-report/references/CONTENT-ARCHITECTURE.md` — overview/table structure and tab thresholds.
- `skills/html-report/references/VISUAL-DECISIONS.md` — graph, diagram, image, SVG, accessibility, and data-integrity rules.
- `skills/html-report/references/INTERACTION-DESIGN.md` — purposeful interaction and progressive-enhancement guidance.
- `skills/html-report/scripts/validate_report.py` — dependency-free report validator.
- `skills/html-report/tests/` — package contracts and report fixtures.
- `tests/routing/html-report.json` — representative model-routing fixtures for repository-level validation.

## Intended routing

Use for complex diagnostics, technical guides, implementation plans, architecture explanations, decision analyses, investigations, and research syntheses **when an HTML artifact is requested**.

Do not route short prose answers, slide decks, application dashboards, landing pages, or non-HTML technology comparisons here.

## Verification

```bash
cd <package-root>
npm test
npm run validate:fixture
```

Validate a generated report from the skill directory:

```bash
python3 ./scripts/validate_report.py <path-to-report.html> --strict
```
