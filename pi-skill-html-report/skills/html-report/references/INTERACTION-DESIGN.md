# Interaction Design for Explanation Reports

Interaction should reduce reading or operational friction without turning the report into an application. Every report remains a complete, understandable document before JavaScript runs.

## Decision Rule

Add an interaction only when it helps the reader perform a concrete report task more efficiently. Name that task before implementing the control.

| Reader task | Appropriate interaction | Use when | Avoid when |
|---|---|---|---|
| Move among independent reading paths | Accessible tabs | The long-page thresholds are met | The report is short or strictly linear |
| Reveal secondary evidence | Native `<details>` / `<summary>` | Detail is useful but not part of the main answer | The content is a conclusion, warning, or required action |
| Review several disclosure blocks | Expand all / Collapse all buttons | A section contains multiple `<details>` blocks | There is only one small disclosure block |
| Reuse a command or exact excerpt | Copy button | The report contains copy-worthy code, commands, identifiers, or citations | Copying the content could be unsafe or misleading without context |
| Preserve or share the current reading location | Copy current link | Tabs or anchored sections provide stable deep links | The file contains sensitive local paths or private query data |
| Find a term across a long report | In-report search with highlighted matches | Multiple panels or dense evidence make browser find disorienting | The page is short enough to scan naturally |
| Understand remaining reading length | Passive reading-progress indicator | The report spans several viewport heights | It becomes a noisy metric or requires user input |
| Read linearly across independent panels | Previous/next section controls | Tabs otherwise force repeated trips to the navigation bar | The material is intentionally non-linear only |
| Reduce visual distraction | Focus-reading toggle | A narrower measure improves sustained prose reading | It hides evidence or permanently changes user preferences |
| Track a reading session | Session-only section completion | Readers revisit or work through several independent sections | Completion would imply evidence approval or be persisted without consent |
| Produce a paper/PDF version | Print button | Print is a likely report workflow | The browser's normal print path is already obvious enough for the audience |
| Narrow a large evidence table | Search/filter controls | The table is genuinely large and row labels are meaningful | A small table is faster to scan directly |
| Compare equivalent visual forms | Chart/table view control | Both views answer distinct reader needs and the data remains available | The control hides the only exact-value or accessible equivalent |

Do not add interactions merely to make the page feel dynamic. Avoid carousels, auto-advancing content, drag interactions, decorative counters, hover-only reveals, or dashboard-style controls.

## Progressive Enhancement Contract

- Source order contains the complete report.
- Essential conclusions, warnings, recommendations, evidence, and exact values do not depend on JavaScript.
- Controls are added only after their targets exist. If enhancement fails, no dead control should block reading.
- Tabs leave all panels visible until JavaScript adds the enhancement class.
- Copy actions retain selectable source text and provide a fallback when the Clipboard API is unavailable.
- Filtering never destroys rows; clearing the filter restores the full table.
- Print CSS reveals all tab panels and hides controls that have no meaning on paper.
- No interaction requires a network request, external runtime dependency, account, or build step by default.

## Accessibility Contract

- Prefer native `<button>`, `<input>`, `<details>`, and `<summary>` elements.
- Every control has a visible label or an accessible name.
- Keyboard operation, visible focus, and logical focus order are mandatory.
- State is exposed with native state or ARIA such as `aria-selected`, `aria-expanded`, `aria-pressed`, or `disabled` where appropriate.
- Copy, filter, and similar outcomes are announced through a polite status region without moving focus.
- Do not use color, animation, hover, or pointer position as the only carrier of state.
- Honor reduced-motion preferences and avoid surprise scrolling.
- Controls meet the same contrast and mobile touch-target expectations as the rest of the report.

## Safety and Privacy

- Copy buttons run only after explicit user activation.
- Never copy secrets, private logs, destructive commands, or sensitive local URLs without clear context and user intent.
- Do not persist report content, interaction history, completion state, or reader choices unless the user requests it; completion markers should remain session-only by default.
- Do not add analytics, telemetry, remote scripts, or third-party widgets.
- Print and copied-link actions must not silently transmit data.

## Verification

For every interaction, verify:

1. Its reader task is clear and the control is located near the target.
2. It works with keyboard input and has a visible focus indicator.
3. Success/failure state is perceivable without relying on color.
4. The report remains complete with JavaScript disabled.
5. All content is visible and controls are suppressed appropriately in print.
6. Mobile-width controls wrap without causing horizontal page scrolling.
