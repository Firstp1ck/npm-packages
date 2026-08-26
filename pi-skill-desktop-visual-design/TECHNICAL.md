# Technical reference: Desktop Visual Design

Advanced user information for the `desktop-visual-design` skill.

[Back to README](README.md)

## What the skill reads

The skill starts with the target project's existing theme contract. Useful inputs include:

| Input | Typical source |
|---|---|
| Palette and semantic color roles | theme files, CSS variables, QML singletons, GTK or Qt settings |
| Surface and control tokens | project token modules, style configuration, reusable components |
| Geometry | compositor settings, project configuration, or measured existing surfaces |
| Typography | toolkit settings, fontconfig aliases, and project font tokens |
| Color-scheme preference | toolkit style hints, desktop portal settings, or the host shell's theme service |
| Theme changes | file watches, toolkit notifications, a theme service, or an application reload hook |
| Visual reference | screenshots and existing first-party components |

These reads are non-destructive. The skill must identify which source owns each value before changing UI code.

## Compatibility

- Desktop UI work in QML, Quickshell, GTK, Qt, Tauri, Electron, CSS, and similar toolkits.
- Hyprland settings can provide optional corner radius and gap values through `hyprctl`.
- Other compositors and desktop environments are supported when the project exposes equivalent settings or visual references.
- The bundled token profile is a fallback and starting point. Existing project tokens take priority.
- With no project-owned visual contract, the fallback is Omarchy-inspired: monospace UI text, flat opaque surfaces, square or minimally rounded geometry, solid 1px borders, one cool accent family, sparse decoration, and no positional hover motion.

## Configuration

A portable app may accept an explicit theme directory or file path from its own configuration. Keep that path app-owned and user-configurable instead of assuming a distribution-specific location.

The Omarchy-inspired fallback is a design relationship, not a copied palette or a forced dark theme. Automatic mode still follows the authoritative desktop preference. In either color scheme, the theme owner provides the base, surface, foreground, muted, accent, and urgent values while components consume only those semantic roles.

For live retheming, watch only the authoritative theme inputs. Debounce file reloads, validate parsed values, and retain the last valid theme when a read fails. Toolkit color-scheme signals should update semantic tokens directly.

Automatic mode is the default for a standalone desktop app. The app must read the toolkit or desktop preference before selecting its built-in light or dark palette. On Linux Qt, prefer a valid XDG portal result at startup and use Qt style hints when the portal has no preference or cannot be read. An explicit override is appropriate only when the app exposes that choice to the user, and tests must exercise automatic mode without that override.

## Limitations

- There is no universal Linux desktop theme-file format. The skill must adapt to the target project's actual theme source.
- Screenshots can establish visual intent, but they cannot reliably reveal exact token values. Prefer source tokens when available.
- Toolkit rendering, font metrics, fractional scaling, and compositor effects can create small differences even when token values match.
- Files containing private-use or Nerd Font glyphs need targeted edits because some rewrite tools can damage multi-byte codepoints.
