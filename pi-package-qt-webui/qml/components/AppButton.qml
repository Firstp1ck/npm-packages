import QtQuick
import QtQuick.Controls

// Reusable compact button with explicit hover, pressed, active, disabled, and focus states.
Button {
    id: control

    required property QtObject theme
    property string variant: "secondary" // primary | secondary | destructive | warning | ghost
    property string accessibleName: text
    property string accessibleDescription: ""
    property bool active: false
    readonly property bool filled: variant === "primary" || variant === "destructive" || variant === "warning"
    readonly property string interactionState: down ? "pressed" : hovered ? "hovered" : "idle"
    readonly property color baseColor: !enabled ? theme.disabledSurface
        : filled ? theme.filledButtonBackground(variant, interactionState)
        : active ? theme.controlActive
        : variant === "ghost" ? theme.transparent
        : theme.controlSurface
    readonly property color interactionColor: !enabled ? theme.disabledSurface
        : down && !filled ? theme.controlPressed
        : hovered && !filled ? theme.controlHover
        : baseColor
    readonly property color interactionForeground: !enabled ? theme.disabledForeground
        : filled ? theme.filledButtonForeground(variant, interactionState)
        : theme.foreground

    focusPolicy: Qt.StrongFocus
    hoverEnabled: true
    Accessible.role: Accessible.Button
    Accessible.name: accessibleName
    Accessible.description: accessibleDescription
    Accessible.checked: active
    Accessible.onPressAction: if (enabled) clicked()
    padding: theme.spaceXs + 1
    leftPadding: theme.spaceLg
    rightPadding: theme.spaceLg

    HoverHandler {
        cursorShape: control.enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
    }

    background: Rectangle {
        implicitWidth: 64
        implicitHeight: control.theme.controlHeight
        radius: control.theme.radiusSmall
        color: control.interactionColor
        border.width: control.activeFocus ? control.theme.focusBorderWidth : control.theme.borderWidth
        border.color: control.activeFocus ? control.theme.focusRing
            : !control.enabled ? control.theme.controlBorder
            : control.active ? control.theme.controlActiveBorder
            : control.filled ? control.interactionColor
            : control.variant === "ghost" && !control.hovered && !control.down ? control.theme.transparent
            : control.theme.controlBorder
        Behavior on color { ColorAnimation { duration: control.theme.animationDuration } }
        Behavior on border.color { ColorAnimation { duration: control.theme.animationDuration } }
    }

    contentItem: Label {
        text: control.text
        textFormat: Text.PlainText
        color: control.interactionForeground
        font.family: control.theme.monospaceFamily
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
        font.weight: control.variant === "primary" ? Font.DemiBold : Font.Medium
        font.pixelSize: control.theme.typeBody
        elide: Text.ElideRight
    }
}
