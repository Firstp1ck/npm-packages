# Desktop Visual Design

Style desktop apps, Quickshell components, and system surfaces so they fit the user's existing desktop instead of looking bolted on. When no established style exists, the skill uses a restrained Omarchy-inspired fallback.

## Helpful when

- You are building a widget, panel, popup, launcher, or notification surface that should match an existing desktop.
- You are writing a QML, GTK, Tauri, Electron, or web-view app that should detect and follow the desktop's light or dark preference.
- A custom interface has inconsistent colors, borders, spacing, typography, focus states, or motion.

## What to share with Pi

- The UI code and the toolkit or shell it runs in.
- Screenshots or paths to existing components that define the target visual language.
- Available theme files, token objects, desktop settings, the current system color scheme, and any explicit light or dark override requirements.

## Try asking

> Restyle this Quickshell battery popup to match my desktop. Reuse its live palette, preserve keyboard focus, and retint when the theme changes.

## What you'll get

- A short inventory of the existing visual rules and reusable theme inputs.
- UI code built from named palette, state, spacing, typography, border, geometry, and motion tokens.
- A flat terminal-first fallback with monospace text, square controls, thin borders, opaque surfaces, one restrained accent family, and little motion when the target has no visual contract.
- Checks for component-owned palette literals, missing interaction states, forced light and dark modes, live switching, and visual consistency.

## Keep in mind

The skill reads existing theme sources and UI code before proposing changes. Existing project tokens and supplied references always override the bundled fallback. The skill does not edit desktop configuration or theme files unless you explicitly request those changes.

## Install

```bash
pi install npm:@firstpick/pi-skill-desktop-visual-design
```

## Technical details

See [TECHNICAL.md](TECHNICAL.md) for runtime inputs, compatibility, configuration, and limitations.

## Inspiration

This skill was inspired by [Omarchy](https://omarchy.org/) and its cohesive desktop visual language.
