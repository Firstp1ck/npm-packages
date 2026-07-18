# Content Architecture and Long-Page Navigation

Use this reference after collecting evidence and before writing HTML.

## Default Reading Path

A strong complex explanation report usually follows:

1. **Hero conclusion** — what the reader should know first.
2. **Overview table** — the complete map of findings, stages, options, or actions.
3. **Context and scope** — what was investigated and what was not.
4. **Core explanation** — prioritized findings or conceptual sections.
5. **Visual model** — quantitative graph and/or process/relationship diagram when justified.
6. **Recommended steps** — ordered actions with completion signals and safety boundaries.
7. **Evidence and alternatives** — decisive excerpts, trade-offs, rejected explanations, or details.
8. **Sources, limitations, and confidence** — provenance and residual uncertainty.

Change labels to fit the task. Do not add empty sections merely to match this sequence.

## Mandatory Overview Table

The overview table answers “What does this whole report contain?” in under a minute. Select the schema that best matches the task:

| Task | Recommended columns |
|---|---|
| Diagnostic | Finding, evidence, impact, likelihood, next check |
| Implementation guide | Stage, objective, action, dependency, done-when |
| Decision analysis | Option, strengths, trade-offs, fit, recommendation |
| Architecture explanation | Component, responsibility, inputs, outputs, risks |
| Research synthesis | Theme, evidence, consensus/conflict, implication |
| Incident review | Time/stage, event, effect, evidence, response |

Do not mechanically repeat section titles. Use concise cells and link to section anchors when useful.

## When to Use Tabs

Use tabs when one or more thresholds are met:

- Six or more major content sections.
- Roughly 2,500 or more visible words.
- More than one independent reader path (for example technical details versus action plan).
- The expected page exceeds about six viewport heights and readers will revisit sections.
- Dense evidence or appendices would otherwise dominate the main narrative.

Do not use tabs when:

- The report is short enough to scan naturally.
- The content is a strict linear tutorial where hiding later stages harms comprehension.
- There are only two or three small sections.
- Print/PDF is the primary medium and the browser view gains little from tabbing.

## Tab Grouping

Prefer three to five tabs:

1. **Overview** — conclusion, overview table, headline metrics.
2. **Analysis** — findings, explanation, graphs, diagrams.
3. **Action plan** — recommendations, phases, checklists.
4. **Evidence** — logs, methods, alternatives, expanded tables.
5. **Sources** — references, limitations, confidence.

Avoid more than seven tabs. If more are needed, the document architecture is probably too fragmented.

## Accessibility and Resilience Contract

- Tab labels are `<button>` elements, never links or clickable `<div>` elements.
- Use `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, and `aria-controls`.
- Each panel uses `aria-labelledby` pointing back to its tab.
- ArrowLeft/ArrowRight move among tabs; Home/End jump to first/last.
- Activation updates the URL hash without forcing a page reload.
- Source order remains meaningful.
- All panels are visible before JavaScript enhancement and in print.
- A reader can reach all information with a keyboard.

## Progressive Disclosure

Use `<details>` for bounded secondary evidence, not for the main answer. Good candidates:

- raw log excerpts;
- alternative hypotheses;
- methodology detail;
- command explanations;
- long source notes.

Keep critical warnings, conclusions, and required actions visible.

## Length Control

Tabs do not excuse verbosity. Before adding navigation:

1. Remove repeated conclusions.
2. Summarize repetitive evidence.
3. Move raw material to details/appendix.
4. Merge sections that answer the same question.
5. Then add tabs if the remaining structure still benefits.
