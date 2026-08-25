# Styling Quickshell components

Use these patterns for QML that runs inside an existing Quickshell configuration. Inspect the host project first. Reuse its palette singleton, spacing tokens, border helpers, and UI controls instead of building a second theme layer.

## Find the host contract

Before editing, identify:

- the palette and semantic surface roles;
- spacing, typography, geometry, and animation tokens;
- shared controls such as buttons, popup cards, panels, toggles, and text fields;
- the plugin entry-point contract and reload command;
- the signal or file watch used for live theme changes.

Do not assume singleton or import names. Examples below use `Theme`, `Tokens`, and `Ui` as placeholders for the host project's actual modules.

## Window content ownership

A Quickshell `QsWindow` or `FloatingWindow` stores ordinary child objects in its default `data` list. A visual root must belong to `window.contentItem`; otherwise the window can exist while its background and controls do not render. For an intentionally opaque application window, set an opaque window color and request an opaque surface before the window becomes visible.

```qml
FloatingWindow {
  id: window
  color: Theme.background
  surfaceFormat.opaque: true

  Rectangle {
    parent: window.contentItem
    anchors.fill: parent
    color: Theme.background
  }
}
```

Verify the rendered window itself instead of treating a successful QML load or process start as visual proof.

## Rules for native-looking components

1. Use the host border component or helper rather than literal `Rectangle.border` values.
2. Route every interactive fill through shared state helpers. Mouse hover and keyboard cursor should use the same state unless the host project distinguishes them.
3. Reserve border space so focus and hover never change component size.
4. Reuse shared controls before writing new chrome.
5. Anchor popups to their trigger, clamp them to available screen space, and use the host's edge-gap token.
6. Use semantic text roles for primary, secondary, metadata, placeholder, selected, and urgent content.
7. Keep keyboard focus visible. A pointer-only hover state is not enough.
8. Launch external commands with argument arrays instead of shell-built strings.

A typical state chain looks like this:

```qml
color: control.pressed ? Theme.pressedFill
  : control.activeFocus ? Theme.focusFill
  : control.hot ? Theme.hoverFill
  : control.selected ? Theme.selectedFill
  : Theme.normalFill

Behavior on color {
  ColorAnimation { duration: Tokens.motionFast }
}
```

## Popup anatomy

A popup normally needs:

- the host surface color and border treatment;
- shared corner radius and popup padding;
- focus capture or an equivalent outside-click dismissal mechanism;
- keyboard navigation and Escape handling;
- an opacity or short slide transition that honors reduced motion;
- screen-bound clamping that accounts for bars and margins.

## Verification

- Open the component next to an existing first-party surface.
- Compare border width, radius, fill alphas, spacing, and type sizes.
- Test pointer, keyboard, focus, selected, pressed, disabled, and urgent states.
- Switch themes and confirm every semantic color retints.
- Check fractional scaling and each supported bar edge.
- Run the host project's documented reload or validation command.
