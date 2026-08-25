import QtQuick
import QtQuick.Controls

// Reusable themed button: always framed, hover feedback with a hand cursor, a visible focus ring,
// an accessible name, and keyboard activation.
Button {
    id: control

    required property QtObject theme
    property string variant: "secondary" // primary | secondary | destructive | warning | ghost
    property string accessibleName: text
    property string accessibleDescription: ""
    property bool active: false // toggle-style buttons render a checked look
    readonly property color baseColor: !enabled ? theme.disabledSurface
        : active ? theme.userBubble
        : variant === "primary" ? theme.accent
        : variant === "destructive" ? theme.destructive
        : variant === "warning" ? theme.warning
        : variant === "ghost" ? theme.surface
        : theme.surfaceRaised
    readonly property bool filled: variant === "primary" || variant === "destructive" || variant === "warning"

    focusPolicy: Qt.StrongFocus
    hoverEnabled: true
    Accessible.role: Accessible.Button
    Accessible.name: accessibleName
    Accessible.description: accessibleDescription
    Accessible.checked: active
    Accessible.onPressAction: if (enabled) clicked()
    padding: 8
    leftPadding: 14
    rightPadding: 14

    HoverHandler {
        cursorShape: control.enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
    }

    background: Rectangle {
        implicitWidth: 72
        implicitHeight: 34
        radius: 7
        color: control.enabled && (control.hovered || control.down)
            ? Qt.lighter(control.baseColor, control.theme.dark ? (control.down ? 1.35 : 1.2) : (control.down ? 0.92 : 0.96))
            : control.baseColor
        border.width: control.activeFocus ? 2 : 1
        border.color: control.activeFocus ? control.theme.focusRing
            : !control.enabled ? control.theme.disabledSurface
            : control.filled ? Qt.darker(control.baseColor, 1.25)
            : control.active || control.hovered ? control.theme.accent : control.theme.border
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
        font.bold: control.variant !== "ghost"
        font.pixelSize: 13
        elide: Text.ElideRight
    }
}
