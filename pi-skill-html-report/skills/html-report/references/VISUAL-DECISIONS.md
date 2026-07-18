# Visual Decision Guide

Visuals are explanatory evidence, not decoration. Start by naming the question the visual answers.

## Selection Matrix

| Information shape | Preferred visual | Use when | Avoid when |
|---|---|---|---|
| Exact categorical comparison | Horizontal/vertical bar chart | Values share a meaningful scale | Only qualitative ranks exist |
| Trend over ordered time | Line chart | At least several real time points exist | Dates are sparse or incomparable |
| Composition | Stacked bar or simple proportion chart | Parts sum to a meaningful whole | Categories overlap |
| Distribution | Histogram/box plot | Raw or summarized distribution data exists | Only averages exist |
| Process/sequence | Flow diagram | Order, handoff, or state transition matters | A numbered list is clearer |
| Dependency/architecture | Node-edge or layered diagram | Components and relationships are central | Edges would become unreadable |
| Decision logic | Decision tree | Branch criteria and outcomes are explicit | Criteria are subjective prose only |
| Schedule/phases | Timeline | Sequence and duration/milestones matter | Dates/durations are invented |
| Spatial/object context | Local image or annotated SVG | Appearance/location aids understanding | It adds only decoration |
| Dense exact values | Table | Readers need lookup precision | Pattern recognition is the main task |

## Decision Procedure

1. Write one sentence: “This visual helps the reader understand ___.”
2. Identify the actual data/relationships supporting it.
3. Select the simplest visual that answers the sentence.
4. Provide an equivalent caption or adjacent table/text.
5. Mark uncertainty and provenance.
6. Remove the visual if it repeats nearby prose without reducing cognitive load.

## Graph Contract

- Use real values only; never infer numeric magnitudes from adjectives such as “high” or “often.”
- Label axes, units, categories, and time periods.
- Use a zero baseline for bars unless a clearly disclosed exception is analytically necessary.
- Avoid 3D, gauge charts, and decorative gradients that distort comparison.
- Prefer direct labels over legends when practical.
- Include a concise source/provenance note in `<figcaption>` or `data-source`.
- Pair SVG graphs with a compact data table when exact values matter.

Recommended markup:

```html
<figure data-visual-kind="graph" data-purpose="Compare startup time by phase" data-source="Measured systemd-analyze output">
  <svg role="img" aria-labelledby="boot-chart-title boot-chart-desc" viewBox="0 0 720 320">
    <title id="boot-chart-title">Startup time by phase</title>
    <desc id="boot-chart-desc">Userspace is the longest phase at 48.6 seconds.</desc>
    <!-- chart shapes and text -->
  </svg>
  <figcaption>Measured values from the cited command output.</figcaption>
</figure>
```

## Diagram Contract

- Use explicit direction, labels, and a logical reading order.
- Keep node count low enough to scan; split complex architectures into layers or multiple diagrams.
- Differentiate observed, proposed, optional, and failed paths with text labels or line styles, not color alone.
- Provide a `<desc>` that explains the path or relationship in plain language.
- Put detailed component properties in an adjacent table rather than inside tiny SVG text.

## Images and Illustrations

Prefer, in order:

1. User-provided local images.
2. Task-generated inline SVGs.
3. Locally generated screenshots/figures with provenance.
4. Remote media only after user approval.

Requirements:

- Meaningful `alt` text for informative images.
- Empty `alt=""` only for genuinely decorative images.
- Captions for provenance or interpretation.
- Relative paths and existence checks for local files.
- No base64 embedding of large assets unless the user explicitly requires a single-file artifact and accepts the size.
- No copyrighted/third-party imagery without permission or a valid usage basis.

## Inline SVG Accessibility

Every informative SVG must include:

- `role="img"`;
- `aria-labelledby` or a clear `aria-label`;
- `<title>`;
- `<desc>` for non-trivial visuals;
- sufficient text/background contrast;
- a caption or nearby explanation.

Do not rely on hover-only tooltips. If interaction is useful, preserve all essential information without it.

## Semantic Color

Use green/yellow/red/blue consistently, but pair color with labels, patterns, icons, or line styles. A grayscale printout must remain understandable.

## When No Visual Is Appropriate

It is correct to omit graphs/diagrams/images when the evidence is purely narrative, the data is too sparse, or a table/list communicates more accurately. The overview table and strong component layout still apply.
