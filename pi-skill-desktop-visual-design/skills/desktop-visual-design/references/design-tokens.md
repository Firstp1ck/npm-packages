# Desktop design tokens

Use this reference profile only when the target project has no complete token system. Existing theme files, shared components, and user-provided references take priority.

## Palette roles

| Role | Use | Fallback |
|---|---|---|
| `foreground` | text, icons, state washes | toolkit foreground |
| `background` | primary surfaces and scrims | toolkit background |
| `accent` | selection, focus punctuation, progress | foreground |
| `urgent` | errors and critical attention | a validated error color |
| `muted` | placeholders, dividers, metadata | foreground at reduced alpha |

Keep palette roles semantic. Components should never depend on color names such as blue or gray. A standalone app needs complete light and dark values for every role, selected by the toolkit or desktop color-scheme signal in automatic mode. Keep those literal fallback values in the theme owner rather than in components.

When no project palette or visual reference exists, use an Omarchy-inspired relationship between roles rather than copying screenshot colors: one dark or light base, one slightly separated surface, high-contrast foreground, clearly dimmed metadata, one cool pastel accent, and a distinct urgent color. Selection, focus, and progress share the accent family. Avoid decorative secondary accents, gradients, glow, and translucent glass. This relationship applies to both light and dark modes and must not force a dark scheme.

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

Recommended paint priority is pressed, focus, hover or keyboard cursor, selected, active, then idle. Reserve the largest border width in the layout so state changes do not move adjacent content.

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

Prefer the desktop's configured monospace UI alias across controls, labels, values, and body copy when no stronger project convention exists. Keep long prose at a comfortable line height. Use uppercase with `0.08em` to `0.12em` tracking only for short section labels and metadata. Use font weight, not a second accent color, when selected text needs more emphasis.

## Geometry

Reuse geometry from the target project or compositor when available. On Hyprland, `decoration:rounding` is a useful corner-radius source and `general:gaps_out` can inform screen-edge spacing. Treat any transformation, such as halving an outer gap for panel margins, as a documented design choice rather than a platform rule.

When no geometry source exists, use `0px` panel and control radii. A radius up to `2px` is acceptable when the renderer clips square corners poorly. Reserve pill geometry for compact statuses or toggles whose shape communicates meaning. Never use rounded cards merely to make a layout look modern.

## Surface recipes

- Popup cards use an opaque background, a 1px themed border, square geometry, and popup padding.
- Notifications share the popup treatment. Use accent for progress and urgent only for critical states.
- Menus use one flat background and one selected-row state. Add a scrim only when it is needed to separate a modal layer.
- Tooltips use body-small text, a short delay, a flat fill, and a subtle border.
- Authentication surfaces need mutually exclusive idle, active, and error states with visible keyboard focus.
- Bars use the same monospace typography and state tokens as popup controls.
- Dividers and empty space establish hierarchy before extra cards, badges, shadows, or nested containers.

## Borders

Use a solid 1px border by default. Increase contrast for focus instead of changing width, which keeps geometry stable. Use per-side borders for structural separators or status punctuation. Use gradient borders only when a verified target surface already contains them.

## Motion

| Purpose | Duration | Easing |
|---|---:|---|
| state or hover color | 90 to 120ms | linear or toolkit color interpolation |
| popup opacity | 100 to 120ms | cubic ease-out |
| toggles | 100 to 140ms | cubic ease-out |
| functional short reveal | no more than 160ms | cubic ease-out |
| spinner rotation | about 900ms per turn | linear |

Do not add positional hover movement, spring, bounce, parallax, or ambient pulsing without evidence from the target. Honor reduced-motion settings and remove nonessential animation in reduced-motion mode.
