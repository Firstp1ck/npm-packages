# @firstpick/pi-skill-html-report

Portable Pi/Agent Skill package for creating polished, self-contained HTML reports that explain complex or multi-step material.

The visual system reproduces the approved dark technical report style:

- deep navy radial background;
- rounded dark panels and restrained shadows;
- semantic status badges and callouts;
- hero conclusions, metric/finding cards, numbered steps, evidence tables, and print styling;
- responsive browser-readable output without a build step.

It adds the requested capabilities:

- a mandatory overview table;
- data-grounded graphs when quantitative comparisons or trends warrant them;
- process, dependency, decision, and architecture diagrams when relationships warrant them;
- meaningful inline SVG or local media with accessibility/provenance rules;
- accessible tabs for long reports, including keyboard navigation, URL hashes, no-JavaScript fallback, and print-all-panels behavior.

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

## Install or enable

The package is intentionally **not installed or enabled automatically**. Review it first. If approved later, install the local checkout with:

```bash
pi install <absolute-path-to-package>
```

Installing or enabling a package changes the active Pi runtime configuration and requires explicit confirmation.

## Dependencies

- Generated reports: modern browser only.
- Validator/tests: Python 3.10+ standard library.
- No npm runtime dependencies and no required CDN.
