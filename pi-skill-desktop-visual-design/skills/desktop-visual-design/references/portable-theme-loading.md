# Portable theme loading

Standalone QML, GTK, Qt, Tauri, Electron, and web-view apps cannot assume access to a shell project's internal theme singletons. Give the app an explicit, user-configurable theme input and convert it into semantic tokens.

## Runtime contract

A portable integration should define these inputs:

| Input | What it provides |
|---|---|
| Palette file or toolkit color scheme | foreground, background, accent, muted, urgent |
| Optional style file | surface roles, control states, spacing, typography, borders |
| Desktop settings | corner radius, outer gaps, font family, reduced motion |
| Theme mode | light, dark, or automatic |
| Change signal | file watch, toolkit notification, desktop portal, or app reload hook |

Do not invent a global Linux theme path. Let users configure the source, validate it, and retain the last valid theme when reloading fails.

## System color-scheme selection

Automatic mode is the default for a standalone desktop app. Define which available source wins instead of accepting whichever one is easiest to read. Do not infer dark mode from one unrelated environment variable or silently choose light mode when the preference is unknown.

For standalone Linux Qt and Qt Quick apps, read the XDG desktop portal's explicit `org.freedesktop.appearance` `color-scheme` value at startup when available. Value `1` means dark, `2` means light, and `0` means no preference. Prefer a valid portal result because Qt platform-theme environment can differ between launchers and terminals. Fall back to `Qt.styleHints.colorScheme` for no preference, portal failure, and live Qt theme changes. Document how disagreement is resolved.

Keep complete light and dark fallback palettes in one theme owner. UI components receive semantic roles and must not contain literal palette colors. A user-selected override may choose light or dark, but automatic mode must remain available. Test automatic mode without a forced test value so an override cannot hide a missing integration path.

## Loading order

1. Start with safe built-in values that keep text legible.
2. Load the desktop or toolkit palette.
3. Apply the optional style file.
4. Apply user overrides last.
5. Derive state fills, borders, spacing, and typography from semantic values.
6. Publish one immutable theme snapshot to the UI.

Reload through the same pipeline. Debounce file events and swap snapshots only after the complete input validates.

## Minimal QML shape

The exact file and process APIs depend on the host runtime. Keep the theme object independent of those APIs:

```qml
pragma Singleton
import QtQuick

QtObject {
  id: root

  // The app validates and normalizes this from the XDG portal at startup.
  property string systemMode: "unknown"
  readonly property bool dark: systemMode === "dark"
    || (systemMode !== "light" && Qt.styleHints.colorScheme === Qt.Dark)
  readonly property color foreground: dark ? "#e5e7eb" : "#111827"
  readonly property color background: dark ? "#111827" : "#f9fafb"
  readonly property color accent: dark ? "#60a5fa" : "#2563eb"
  readonly property color urgent: dark ? "#f87171" : "#b91c1c"
  readonly property color muted: dark ? "#9ca3af" : "#6b7280"
  property int cornerRadius: 0
  property int edgeGap: 5
  property int fontBase: 12
  property string fontFamily: "monospace"

  readonly property real fontScale: Math.max(1 / 12, fontBase / 12)

  function alpha(color, value) {
    return Qt.rgba(color.r, color.g, color.b, value)
  }

  function space(px) {
    return Math.max(1, Math.round(px * fontScale))
  }

  function fontPx(multiplier) {
    return Math.max(1, Math.round(fontBase * multiplier))
  }

  readonly property color normalFill: alpha(foreground, 0.04)
  readonly property color hoverFill: alpha(foreground, 0.08)
  readonly property color selectedFill: alpha(foreground, 0.18)
  readonly property color pressedFill: alpha(foreground, 0.22)
  readonly property color normalBorder: alpha(foreground, 0.40)
  readonly property color hoverBorder: alpha(foreground, 0.25)
}
```

A separate loader should parse configured palette files, validate color and numeric ranges, query optional desktop settings, and update this object atomically. If the app has no external palette file, the live `dark` binding still selects the complete built-in fallback palette.

## Hyprland geometry

When Hyprland is running, read optional geometry with argument-array process calls:

```text
hyprctl -j getoption decoration:rounding
hyprctl -j getoption general:gaps_out
```

Validate JSON fields and non-negative values. Keep the previous value if the command fails. If the product chooses a transformed value, such as half the outer gap for panel-to-edge spacing, document and test that choice.

## Web-view mapping

Expose semantic CSS custom properties from the trusted host process:

```css
:root {
  --background: #101315;
  --foreground: #cacccc;
  --accent: #cacccc;
  --urgent: #a55555;
  --muted: #707880;
  --radius: 0px;
  --font: monospace;
  --font-base: 12px;
  --fill-normal: color-mix(in srgb, var(--foreground) 4%, transparent);
  --fill-hover: color-mix(in srgb, var(--foreground) 8%, transparent);
  --fill-selected: color-mix(in srgb, var(--foreground) 18%, transparent);
  --border-normal: color-mix(in srgb, var(--foreground) 40%, transparent);
  --border-hover: color-mix(in srgb, var(--foreground) 25%, transparent);
}
```

Do not let untrusted web content choose filesystem paths or execute theme commands. The host process owns reads and sends validated token values to the view.

## Failure behavior

- Missing theme input uses the documented fallback profile and reports the fallback once.
- Invalid reloads retain the last valid snapshot.
- Missing compositor commands keep prior geometry values.
- Unsupported gradients use a validated solid fallback.
- Theme watches need cleanup when the app exits or the configured source changes.
