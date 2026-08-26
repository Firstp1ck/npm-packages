---
name: desktop-visual-design
description: Use when building or styling desktop apps, Quickshell QML components, bars, panels, popups, launchers, notifications, or widgets that should fit an existing system theme. Derives reusable palette, interaction, spacing, typography, border, geometry, and motion tokens from the target project and desktop instead of guessing values.
---

# Desktop Visual Design

Build system-native desktop interfaces from the visual rules already present in the user's environment. Inspect the target first, turn repeated values into semantic tokens, reuse host components, and verify the result across interaction states and theme changes. When the target has no visual contract, use the restrained terminal-first fallback defined here rather than inventing a glossy web-app style.

Installing this Pi package makes the skill available to Pi. It does not modify desktop settings, themes, or application code by itself.

## When to use

Trigger for:

- Quickshell widgets, panels, bars, popups, overlays, launchers, and notifications.
- Desktop apps built with QML, Qt, GTK, Tauri, Electron, or embedded web views.
- UI reviews focused on palette, hierarchy, spacing, typography, borders, geometry, focus states, and motion.
- Requests to make a desktop interface match an existing system theme or first-party surface.

Do not trigger for server-side work, CLI output formatting, compositor configuration unrelated to application appearance, or general public-website design without a desktop-integration requirement.

## Principles

1. **Inspect before styling.** Existing theme files, token objects, shared controls, and first-party surfaces are the source of truth.
2. **Honor the active color scheme.** Standalone apps must read the toolkit, portal, or host-shell light or dark preference before choosing a built-in palette. For Linux Qt apps, prefer an explicit XDG portal result at startup because Qt platform-theme environment can differ between launchers; use Qt style hints as the fallback and live-change input. Automatic mode must update when its authoritative preference changes.
3. **Use semantic roles.** Components depend on foreground, background, accent, urgent, muted, and named surface roles instead of literal palette colors.
4. **Define every interaction state.** Cover idle, hover, keyboard cursor, focus, selected, pressed, disabled, and urgent states where they apply.
5. **Keep geometry stable.** Reserve border and focus-ring space so interaction never shifts layout.
6. **Use one scale.** Derive spacing and typography from named tokens and a documented base size.
7. **Retheme through one path.** Parse, validate, and publish an atomic theme snapshot. Theme changes must not leave mixed old and new values on screen.
8. **Match existing motion.** Honor the target's motion language and reduced-motion settings. When no motion language exists, animate only short color or opacity changes.
9. **Restrain decoration.** Without an explicit reference, prefer opaque flat surfaces, one accent family, thin borders, square geometry, and no gradients, glow, blur, hover lift, or decorative shadows.

## Token model

### Palette

Start with semantic roles:

| Role | Use |
|---|---|
| `foreground` | text, icons, and state washes |
| `background` | primary surfaces and scrims |
| `accent` | selection, focus punctuation, and progress |
| `urgent` | errors and critical attention |
| `muted` | placeholders, dividers, and metadata |

Add surface-specific roles only when the target already distinguishes them. Do not name component tokens after a hue. The fallback uses one cool accent family for selection, focus, and progress, with urgent reserved for errors. Do not introduce multi-hue decorative palettes, gradients, glow, or translucent glass unless the target already uses them.

### Interaction states

If the target project has no state model, use this compact reference profile:

| State | Fill alpha | Border alpha | Border width |
|---|---:|---:|---:|
| normal | 0.00 | 0.35 | 1px |
| hover or keyboard cursor | 0.06 | 0.60 | 1px |
| focus | 0.06 | 1.00 | 1px |
| selected | 0.16 | 0.72 | 1px |
| pressed | 0.22 | 0.88 | 1px |
| text selection | 0.30 | none | 0px |

Apply state precedence in this order: pressed, focus, hover or cursor, selected, active, idle. Use visible focus even when hover and focus share a fill.

### Spacing and typography

At a 12px base font, the fallback spacing scale is:

`xxs 2, xs 4, sm 6, md 8, lg 10, xl 12, xxl 16, xxxl 20, huge 24`

Fallback type multipliers are caption 0.833, body-small 0.917, body 1.0, subtitle 1.083, title 1.167, heading 1.333, display 2.0, and display-large 2.333. Prefer the desktop's monospace UI alias across controls, labels, and data. Use uppercase labels with restrained `0.08em` to `0.12em` tracking for short section headings, not for paragraphs or long actions.

The target project's own values always win. See `references/design-tokens.md` for the complete fallback profile.

### Geometry and motion

Read geometry from project tokens or compositor settings when available. On Hyprland, `hyprctl -j getoption decoration:rounding` and `general:gaps_out` can inform radius and edge spacing. Validate command output and keep the last valid value on failure.

Without a geometry source, use square panels and controls with a `0px` radius, allowing up to `2px` only when needed to avoid harsh raster clipping. Use opaque surfaces, 1px borders, and simple separators. Do not use pill geometry unless shape itself communicates a compact status or toggle.

Without an existing motion language, use 90 to 120ms color or opacity transitions and no positional hover movement. Keep functional progress animation, such as a spinner, constant and subtle. Reduced-motion mode removes nonessential animation.

## Workflow

1. **Confirm the target.** Identify the toolkit, host shell or app, supported interaction methods, scale factors, supported theme modes, and the current system color-scheme preference. Completion: the runtime, active preference, and visual comparison target are explicit.
2. **Inventory the visual contract.** Find palette sources, color-scheme signals, theme objects, token modules, shared controls, font settings, geometry sources, motion constants, and first-party reference surfaces. Completion: each planned value has an owner or is marked as a fallback.
3. **Choose the integration path.** Inside a host project, reuse its theme and control modules. For a standalone app, define source precedence for automatic mode and an explicit app-owned input only for user overrides. A Linux Qt app should prefer a valid XDG portal light or dark result, then fall back to Qt style hints. Read the matching reference file.
4. **Create semantic tokens.** Map source values into complete light and dark palette, surface, state, spacing, typography, border, geometry, and motion roles. Keep literal fallback colors in the theme owner. Completion: UI components own no palette literals.
5. **Implement complete states.** Add pointer, keyboard, focus, selected, pressed, disabled, and urgent behavior as needed. Completion: keyboard use is visible and layout remains stable.
6. **Wire theme changes.** Subscribe to the toolkit, portal, host-shell, or validated file signal that owns the preference. Publish all changed tokens together and retain the last valid snapshot on input failure.
7. **Verify.** Force light and dark branches, return to automatic mode, change the live system preference, compare first-party surfaces, test scaling and input modes, scan components for palette literals, and run the project's checks.

## Invocation design

- Strong signals include desktop UI, Quickshell, QML, panel, popup, launcher, notification, native-looking, system theme, live retheme, and visual consistency.
- Branches are host-project component, standalone desktop app, portable web-view integration, theme-system design, and visual review.
- Do not route compositor keybinds, backend work, package maintenance, or unrelated web branding here.

## References

- `references/design-tokens.md` defines the fallback token profile and explains when project values take priority.
- `references/quickshell-plugin-styling.md` covers components that run inside an existing Quickshell configuration.
- `references/portable-theme-loading.md` covers explicit theme inputs, atomic reloads, Hyprland geometry, QML, and web-view mappings.

## Verification

- Search changed UI components for literal palette colors. Keep fallback literals only in the theme owner and justify any exception.
- Test pointer and keyboard focus, selected, pressed, disabled, and urgent states.
- Force both light and dark branches, then run a separate automatic-mode acceptance check with no test override and confirm it matches the desktop preference.
- Test no-preference, malformed, and unavailable source results plus any disagreement precedence between toolkit and portal values.
- Change the live desktop preference and confirm every semantic color tied to the live source updates together without restarting the app.
- Test supported scale factors, font changes, and bar or panel edges.
- Compare screenshots beside existing first-party surfaces. When the fallback is active, also check for flat opaque surfaces, monospace UI text, square geometry, thin borders, restrained accent use, and the absence of decorative glow or hover lift. For Quickshell windows, confirm the visual root belongs to `contentItem` and that intended opaque surfaces do not reveal the windows behind them.
- Run the target project's documented formatting, type, and UI checks.

## Safety and failure modes

- Keep inspection read-only until the user authorizes UI changes.
- Do not edit desktop settings or theme sources when the request only covers an app or component.
- Treat theme files and environment values as untrusted input. Validate colors, numbers, paths, and width lists.
- Use argument arrays for external commands. Never build shell commands from theme values.
- A missing or unknown system color-scheme preference uses the toolkit palette or a documented neutral fallback. It must not silently force light mode.
- Missing theme data uses a documented fallback and reports that fallback once.
- Invalid reloads retain the last valid theme instead of partially applying values.
- Make targeted edits to files containing private-use or Nerd Font glyphs.
