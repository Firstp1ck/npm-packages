# Desktop Visual Design

Style desktop apps, Quickshell components, and system surfaces so they fit the user's existing desktop instead of looking bolted on.

## Helpful when

- You are building a widget, panel, popup, launcher, or notification surface that should match an existing desktop.
- You are writing a QML, GTK, Tauri, Electron, or web-view app that should follow live theme changes.
- A custom interface has inconsistent colors, borders, spacing, typography, focus states, or motion.

## What to share with Pi

- The UI code and the toolkit or shell it runs in.
- Screenshots or paths to existing components that define the target visual language.
- Available theme files, token objects, desktop settings, and any light or dark mode requirements.

## Try asking

> Restyle this Quickshell battery popup to match my desktop. Reuse its live palette, preserve keyboard focus, and retint when the theme changes.

## What you'll get

- A short inventory of the existing visual rules and reusable theme inputs.
- UI code built from named palette, state, spacing, typography, border, geometry, and motion tokens.
- Checks for hardcoded palette values, missing interaction states, theme-switch behavior, and visual consistency.

## Keep in mind

The skill reads existing theme sources and UI code before proposing changes. It does not edit desktop configuration or theme files unless you explicitly request those changes.

## Install

```bash
pi install npm:@firstpick/pi-skill-desktop-visual-design
```

## Technical details

See [TECHNICAL.md](TECHNICAL.md) for runtime inputs, compatibility, configuration, and limitations.

## Inspiration

This skill was inspired by [Omarchy](https://omarchy.org/) and its cohesive desktop visual language.
