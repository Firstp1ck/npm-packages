---
name: html-report
description: Creates polished self-contained HTML explanation reports for complex, multi-step topics using overview tables, evidence cards, adaptive graphs or diagrams, meaningful SVG/media, and accessible tabs for long pages. Use when the user requests a browser-readable diagnostic report, technical guide, decision analysis, implementation plan, investigation, or research synthesis as HTML.
license: MIT
compatibility: Portable Agent Skills-style skill; static HTML output requires only a modern browser, and the optional validator requires Python 3.10+.
---

# HTML Report

Create source-grounded, browser-readable explanation reports with the approved dark navy visual system. The output is a document, not an application: it should open locally without a build step, remain understandable when printed, and use visuals only when they clarify real information.

## When to Use

Use this skill when both are true:

- The user requests an HTML page/report or clearly wants a browser-readable artifact.
- The subject is complex or multi-step: diagnostics, investigations, implementation guidance, architecture, technical decisions, comparisons, research synthesis, or operational plans.

Do not use it for:

- Short answers that do not warrant a file.
- Slide presentations; use a presentation-specific skill instead.
- Product dashboards, landing pages, or application UI implementation.
- A generic technology comparison unless the user requests an HTML report.
- Content whose evidence is too incomplete to explain responsibly; collect evidence or mark uncertainty first.

### Should trigger

- “Create a self-contained HTML report explaining this multi-stage incident with evidence, diagrams, and recommendations.”
- “Turn this architecture analysis into a polished browser-readable explanation.”
- “Make an HTML implementation guide with a process diagram, overview, risks, and phased steps.”
- “Research these options and deliver a detailed HTML decision document.”

### Should not trigger

- “Explain this error in three bullets.”
- “Build an interactive product analytics dashboard.”
- “Create a 16:9 HTML slide deck.”
- “Compare React and Vue and recommend one.”

## Invocation Design

- Invocation mode: model-invoked after the package is explicitly enabled.
- Leading concept: **HTML explanation report**.
- Trigger branches:
  1. Complex or multi-step explanation explicitly requested as HTML.
  2. Technical diagnostic, guide, analysis, investigation, or synthesis needing a standalone browser report.
- The package is a disabled draft until the user explicitly installs/enables it; creation alone must not modify Pi settings.

## Inputs and Assumptions

Collect, as available:

- Source notes, logs, files, command output, research, and citations.
- The real question, audience, success criteria, and requested output path.
- Quantitative data suitable for charts and relationship/process data suitable for diagrams.
- User-provided local images or approved media. Do not assume remote assets are allowed.
- Existing HTML or project conventions if the report belongs to a repository.

If the user does not specify a filename, use a concise descriptive name ending in `.html`. Preserve uncertainty and distinguish observed facts, documentation, interpretation, and recommendations.

## Portable Workflow

1. **Establish the evidence model**
   - Identify the question, audience, claims, sources, uncertainty, and recommended actions.
   - Do not invent measurements, graph values, timelines, citations, or visual relationships.
   - Completion criterion: every major claim is traceable to supplied/verified evidence or explicitly labeled as interpretation.

2. **Plan the information architecture**
   - Build a section map before writing. Include a hero summary, mandatory overview table, main explanation, actionable steps, evidence/source notes, and limitations.
   - Read `references/CONTENT-ARCHITECTURE.md` when the page has multiple audiences, branches, or more than five major sections.
   - Completion criterion: the outline has one clear reading path and no duplicated sections.

3. **Select visuals deliberately**
   - Use the matrix in `references/VISUAL-DECISIONS.md`.
   - Add a graph for real quantitative comparisons/trends; a diagram for flows, dependencies, decisions, or architecture; and meaningful inline SVG/local media where spatial context helps.
   - If no visual materially improves comprehension, omit it and keep the layout strong rather than adding decoration.
   - Completion criterion: each visual has a stated explanatory purpose, accessible text, and source/provenance where applicable.

4. **Choose interaction and long-page navigation**
   - Read `references/INTERACTION-DESIGN.md` and name the reader task served by each proposed interaction.
   - Use accessible tabs when there are at least six major sections, roughly 2,500+ words, multiple independent reading paths, or excessive scrolling. For shorter reports, prefer normal sections and optional anchor navigation.
   - Add task-focused controls where they reduce friction: in-report search with highlighted matches, reading progress, optional focus mode, sequential previous/next navigation, session-only section completion, copy buttons for reusable commands or exact excerpts, expand/collapse controls for several disclosure blocks, print or deep-link actions, and filtering only for genuinely large tables.
   - Keep the executive conclusion and overview visible by default. Use native controls, keyboard support, visible focus, status announcements, URL hashes where relevant, and print rules that reveal content while suppressing meaningless controls.
   - Preserve progressive enhancement: the complete report must remain readable, selectable, and navigable when JavaScript, clipboard access, or optional interaction fails.
   - Completion criterion: every interaction has a clear purpose, works without pointer input, communicates its result, and leaves all essential content available without script enhancement and in print.

5. **Apply the approved design system**
   - Read `references/DESIGN-SYSTEM.md` and start from `assets/starter-template.html` when practical.
   - Preserve the navy radial background, rounded dark panels, blue-gray borders, restrained shadows, high-contrast typography, and semantic status colors.
   - Use metric cards, evidence tables, prioritized findings, numbered steps, callouts, and collapsible detail only where they fit the content.
   - Completion criterion: the report is visually coherent at desktop and mobile widths and does not depend on an external CDN.

6. **Generate the self-contained report**
   - Prefer one HTML file with embedded CSS and minimal JavaScript. Inline SVG is preferred for custom charts and diagrams.
   - Local image files are acceptable when supplied or generated; use relative paths and meaningful `alt` text. Ask before overwriting user-authored output.
   - Treat the starter template placeholders as scaffolding and replace/remove all of them.
   - Completion criterion: the file opens directly in a browser, contains no unresolved placeholders, and has no missing local dependencies.

7. **Verify and report**
   - Run the bundled validator from the skill directory:

```bash
python3 ./scripts/validate_report.py <path-to-report.html> --strict
```

   - Also inspect the report at narrow/mobile width and print preview when browser tooling is available.
   - Completion criterion: validation passes, intentional warnings are disclosed, and the final response includes a clickable Markdown link to the report plus any unverified rendering caveat.

## Output Contract

The final assistant response must always end with a standalone clickable Markdown link to the generated report, using the report filename as the label and its absolute path as the target:

```markdown
[report-name.html](/absolute/path/to/report-name.html)
```

Do not provide only a plain-text path or wrap the link in a code block. Keep this link as the final non-empty line so it is easy to find and click.

Every generated report must include:

- A descriptive document title, language, viewport metadata, and semantic landmarks.
- A concise hero conclusion and scope/context.
- An **overview table** summarizing sections, findings, stages, options, or recommendations.
- Source-grounded narrative with uncertainty/confidence where relevant.
- Prioritized, actionable recommendations or next steps.
- Responsive and print CSS.
- References/evidence and limitations when claims depend on external or incomplete information.

Conditional components:

- Graphs only for quantitative data.
- Diagrams only for meaningful relationships or sequences.
- Images/SVG only when they improve comprehension.
- Tabs only when page length or independent reading paths justify them.
- Interactive controls only when they serve a concrete reader task; prefer native elements and progressive enhancement.
- Search, progress, focus, sequential navigation, completion, copy, disclosure, filtering, view, print, or deep-link controls only when their targets and fallback behavior remain useful without JavaScript.

## Scripts, References, and Dependencies

Bundled resources, relative to this skill directory:

- `assets/starter-template.html` — self-contained report shell with overview table, accessible tabs, graph, diagram, responsive layout, and print behavior.
- `references/DESIGN-SYSTEM.md` — visual tokens and component contract.
- `references/CONTENT-ARCHITECTURE.md` — section planning and tab thresholds.
- `references/VISUAL-DECISIONS.md` — graph/diagram/media selection, accessibility, and data integrity.
- `references/INTERACTION-DESIGN.md` — purposeful controls, progressive enhancement, accessibility, privacy, and interaction verification.
- `scripts/validate_report.py` — standard-library Python validator for generated reports.
- `tests/` — package contract tests and representative fixtures.

No runtime package or browser build dependency is required.

## Verification

For this package:

```bash
cd <package-root>
npm test
```

For a generated report:

```bash
cd <skill-directory>
python3 ./scripts/validate_report.py <path-to-report.html> --strict
```

Success means: valid core structure, overview table present, local assets resolved, no placeholders, image/SVG accessibility checks passed, tab wiring valid when tabs exist, long pages tabbed, and responsive/print rules detected.

## Quality Review

Before delivery, confirm:

- The routing scope is not confused with slide decks, dashboards, or short prose answers.
- The overview table gives a useful map rather than repeating headings mechanically.
- Every visual communicates evidence; no decorative chart junk or fabricated values exist.
- Tabs reduce cognitive load without hiding critical conclusions.
- Every other interaction serves a named reader task, uses semantic controls, reports outcomes, and degrades without hiding content.
- Long reference material stays in `references/`, not duplicated in this file.
- No private paths, secrets, stale source-report content, or user-specific facts were copied into the reusable package.

## Safety and Failure Modes

- Ask before overwriting an existing user-authored report or changing files outside the requested output scope.
- Do not embed secrets, private logs, personal data, or unredacted sensitive evidence in a shareable report.
- Do not hotlink external images, scripts, fonts, or styles unless the user approves the privacy and availability trade-off.
- Never turn qualitative statements into quantitative graphs without real values.
- If SVG complexity harms accessibility, replace it with a simpler diagram plus a text/table equivalent.
- If tabs fail validation, fall back to ordinary semantic sections rather than shipping inaccessible navigation.
- If copy, filtering, disclosure, or other enhancements fail, keep the underlying text and controls' targets directly usable; remove dead controls rather than making content script-dependent.
- Do not add telemetry, persistence, network-backed widgets, auto-advancing content, or copied sensitive data as interaction polish.
- If evidence is contradictory or incomplete, show the conflict and lower confidence; do not manufacture a single definitive story.

## Pi Adapter

- Use Pi file-reading and repository exploration tools to gather evidence before drafting.
- Use `write` for a new self-contained report and `edit` for targeted changes to an existing report.
- For multi-step creation, use Pi's todo progress UI and verify the final path.
- End the final response with the standalone Markdown report link required by the Output Contract; use the verified absolute file path as the link target.
- Do not install this local package or modify Pi settings without explicit user confirmation.
