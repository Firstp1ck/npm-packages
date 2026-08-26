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
    readonly property color baseColor: !enabled ? theme.disabledSurface
        : active ? theme.controlActive
        : variant === "primary" ? theme.accent
        : variant === "destructive" ? theme.destructive
        : variant === "warning" ? theme.warning
        : variant === "ghost" ? "transparent"
        : theme.controlSurface
    readonly property color interactionColor: down ? (filled ? Qt.darker(baseColor, 1.12) : theme.controlPressed)
        : hovered ? (filled ? Qt.lighter(baseColor, theme.dark ? 1.12 : 1.06) : theme.controlHover)
        : baseColor

    focusPolicy: Qt.StrongFocus
    hoverEnabled: true
    Accessible.role: Accessible.Button
    Accessible.name: accessibleName
    Accessible.description: accessibleDescription
    Accessible.checked: active
    Accessible.onPressAction: if (enabled) clicked()
    padding: 5
    leftPadding: 10
    rightPadding: 10

    HoverHandler {
        cursorShape: control.enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
    }

    background: Rectangle {
        implicitWidth: 64
        implicitHeight: 30
        radius: 6
        color: control.interactionColor
        border.width: control.activeFocus ? 2 : 1
        border.color: control.activeFocus ? control.theme.focusRing
            : !control.enabled ? control.theme.disabledSurface
            : control.active ? control.theme.controlActiveBorder
            : control.filled ? Qt.darker(control.baseColor, 1.2)
            : control.variant === "ghost" && !control.hovered && !control.down ? "transparent"
            : control.theme.controlBorder
        Behavior on color { ColorAnimation { duration: control.theme.animationDuration } }
        Behavior on border.color { ColorAnimation { duration: control.theme.animationDuration } }
    }

    contentItem: Label {
        text: control.text
        textFormat: Text.PlainText
        color: !control.enabled ? control.theme.disabledForeground
            : control.filled ? control.theme.buttonForeground : control.theme.foreground
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
        font.weight: control.variant === "primary" ? Font.DemiBold : Font.Medium
        font.pixelSize: 12
        elide: Text.ElideRight
    }
}
