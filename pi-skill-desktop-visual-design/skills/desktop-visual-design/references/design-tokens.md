# Desktop design tokens

Use this reference profile only when the target project has no complete token system. Existing theme files, shared components, and user-provided references take priority.

## Palette roles

| Role | Use | Fallback |
|---|---|---|
| `foreground` | text, icons, state washes | toolkit foreground |
| `background` | primary surfaces and scrims | toolkit background |
| `accent` | selection, focus punctuation, progress | foreground |
| `urgent` | errors and critical attention | a validated error color |
| `success` | confirmed completion or healthy status, when needed | a validated success color |
| `muted` | placeholders, dividers, metadata | foreground at reduced alpha |

Keep palette roles semantic. Components should never depend on color names such as blue or gray. A standalone app needs complete light and dark values for every role, selected by the toolkit or desktop color-scheme signal in automatic mode. Keep those literal fallback values in the theme owner rather than in components.

When no project palette or visual reference exists, use an Omarchy-inspired relationship between roles rather than copying screenshot colors:

| Relationship | Dark branch | Coherent light counterpart |
|---|---|---|
| Base | charcoal with a restrained violet cast | softly violet-tinted near-white |
| Raised or inset surface | opaque and slightly separated from the base | opaque and separated by a subtle lightness step |
| Foreground | high-contrast pale foreground | high-contrast charcoal foreground |
| Muted | visibly dimmer than foreground while remaining readable | visibly softer than foreground while remaining readable |
| Structural accent | periwinkle-like and lighter than its surrounding surface | a deeper related violet-periwinkle that remains clear on light surfaces |
| Semantic punctuation | validated urgent and success colors | corresponding validated urgent and success colors |

These are relative roles, not literal colors. Selection, focus, and progress share the structural accent family. Green is reserved for semantic success rather than navigation, framing, or general selection. Urgent remains reserved for errors and critical attention. Avoid decorative secondary accents, gradients, glow, and translucent glass. Both branches must be complete, and this relationship must not force dark mode.

## Interactive states

State fills are translucent role colors composited over the current surface.

| State | Fill alpha | Border alpha | Suggested border width |
|---|---:|---:|---:|
| normal | 0.00 | 0.35 | 1px |
| hover or cursor | 0.06 | 0.60 | 1px |
| focus | 0.06 | 1.00 | 1px |
| selected | 0.16 | 0.72 | 1px |
| pressed | 0.22 | 0.88 | 1px |
| text selection | 0.30 | none | 0px |

Recommended paint priority is pressed, focus, hover or keyboard cursor, selected, active, then idle. Keep state shapes rectangular in the fallback. Reserve the 1px border in the layout and change contrast or alpha, not width, so focus and pointer states do not move adjacent content. Apply `success` and `urgent` only when they communicate status; neither replaces the structural accent for ordinary selection.

## Spacing

At a 12px base font, use this measured scale:

`xxs 2, xs 4, sm 6, md 8, lg 10, xl 12, xxl 16, xxxl 20, huge 24`

Useful component values are control gap 8, horizontal control padding 12, vertical control padding 8, control height 36, row gap 10, row horizontal padding 12, panel gap 16, panel padding 20, and popup padding 18. Keep related values aligned in rows, but leave visible space between sections.

Scale spacing with the effective font scale unless the target project explicitly keeps layout density fixed.

## Typography

Use a single base size and named multipliers:

| Token | Multiplier | Pixels at 12px |
|---|---:|---:|
| caption | 0.833 | 10 |
| body-small | 0.917 | 11 |
| body | 1.0 | 12 |
| subtitle | 1.083 | 13 |
| title | 1.167 | 14 |
| heading | 1.333 | 16 |
| display | 2.0 | 24 |
| display-large | 2.333 | 28 |

Prefer the desktop's configured monospace UI alias across controls, labels, values, and body copy when no stronger project convention exists. Keep long prose at a comfortable line height. Reserve `display` and `display-large` for one dominant title, value, or empty-state landmark; use body through heading tokens for the rest. Use uppercase with `0.08em` to `0.12em` tracking only for short section labels and metadata. Use font weight, not a second accent color, when selected text needs more emphasis.

## Geometry

Reuse geometry from the target project or compositor when available. On Hyprland, `decoration:rounding` is a useful corner-radius source and `general:gaps_out` can inform screen-edge spacing. Treat any transformation, such as halving an outer gap for panel margins, as a documented design choice rather than a platform rule.

When no geometry source exists, use `0px` panel and control radii. A radius up to `2px` is acceptable when the renderer clips square corners poorly. Reserve pill geometry for compact statuses or toggles whose shape communicates meaning. Never use rounded cards merely to make a layout look modern.

## Surface recipes

- App shells use one thin, square outer frame when the reference treats the window as a composed object. Major regions may share that frame rather than becoming separate floating cards.
- Primary modules use an opaque surface and a 1px structural border. Frame navigation, content, and composer regions when doing so clarifies composition; do not box every row.
- Empty states pair one restrained text landmark with a display-scale title or value and concise body guidance. The landmark must be functional, render safely in the available font, and have an accessible name; do not add an icon dependency.
- Popup cards use an opaque background, a 1px themed border, square geometry, and popup padding.
- Notifications share the popup treatment. Use accent for progress, success only for confirmed completion, and urgent only for critical states.
- Menus use one flat background and one rectangular selected-row state. Add a scrim only when it is needed to separate a modal layer.
- Tooltips use body-small text, a short delay, a flat fill, and a subtle border.
- Authentication surfaces need mutually exclusive idle, active, success, and error states with visible keyboard focus.
- Bars use the same monospace typography and state tokens as popup controls.
- Dividers and empty space establish hierarchy before extra cards, badges, shadows, or nested containers.

## Borders

Use a solid 1px border by default. Increase contrast for focus instead of changing width, which keeps geometry stable. Use the strongest border contrast for the outer frame, focused control, or currently important module; use quieter borders and per-side separators inside dense regions. Framing should reveal the composition, not create a card grid. Use gradient borders only when a verified target surface already contains them.

## Motion

| Purpose | Duration | Easing |
|---|---:|---|
| state or hover color | 90 to 120ms | linear or toolkit color interpolation |
| popup opacity | 100 to 120ms | cubic ease-out |
| toggles | 100 to 140ms | cubic ease-out |
| functional short reveal | no more than 160ms | cubic ease-out |
| spinner rotation | about 900ms per turn | linear |

Do not add positional hover movement, spring, bounce, parallax, or ambient pulsing without evidence from the target. Honor reduced-motion settings and remove nonessential animation in reduced-motion mode.
