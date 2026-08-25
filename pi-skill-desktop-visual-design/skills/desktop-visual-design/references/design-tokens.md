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

## Interactive states

State fills are translucent role colors composited over the current surface.

| State | Fill alpha | Border alpha | Suggested border width |
|---|---:|---:|---:|
| normal | 0.04 | 0.40 | 1px |
| hover or cursor | 0.08 | 0.25 | 1px |
| focus | 0.08 | 0.25 | 1px |
| selected | 0.18 | 1.00 | 0px |
| pressed | 0.22 | inherit | inherit |
| text selection | 0.35 | none | 0px |

Recommended paint priority is pressed, focus, hover or keyboard cursor, selected, active, then idle. Reserve the largest border width in the layout so state changes do not move adjacent content.

## Spacing

At a 12px base font, use this compact scale:

`xxs 2, xs 3, sm 4, md 6, lg 8, xl 10, xxl 12, xxxl 14, huge 18`

Useful component values are control gap 8, horizontal control padding 10, vertical control padding 6, control height 28, row gap 8, row horizontal padding 12, panel gap 14, panel padding 18, and popup padding 14.

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

Prefer the desktop's configured UI or monospace alias over a resolved font family name. Use font weight, not a second accent color, when selected text needs more emphasis.

## Geometry

Reuse geometry from the target project or compositor when available. On Hyprland, `decoration:rounding` is a useful corner-radius source and `general:gaps_out` can inform screen-edge spacing. Treat any transformation, such as halving an outer gap for panel margins, as a documented design choice rather than a platform rule.

## Surface recipes

- Popup cards use an opaque or nearly opaque background, a 1px or 2px themed border, the shared corner radius, and popup padding.
- Notifications share the popup treatment. Use accent for progress and urgent only for critical states.
- Menus use a background scrim and one selected-row state. Do not add a separate decorative palette.
- Tooltips use body-small text, a short delay, and a subtle border.
- Authentication surfaces need mutually exclusive idle, active, and error states with visible keyboard focus.
- Bars use the same typography and state tokens as popup controls.

## Borders

A border token can be a solid color or a gradient when the toolkit supports it. Apply alpha to every gradient stop. Support per-side widths only when they communicate structure or state.

## Motion

| Purpose | Duration | Easing |
|---|---:|---|
| state or hover color | 120ms | linear or toolkit color interpolation |
| popup opacity | 140ms | cubic ease-out |
| toggles and short slides | 160 to 180ms | cubic ease-out |
| medium reveals | 200 to 260ms | cubic ease-out |
| large panels | no more than 420ms | cubic ease-out |
| spinner rotation | about 900ms per turn | linear |

Honor reduced-motion settings. Avoid spring and bounce motion unless the existing desktop uses them consistently.
