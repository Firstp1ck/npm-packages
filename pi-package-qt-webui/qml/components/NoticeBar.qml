import QtQuick
import QtQuick.Controls

// Transient notice shown at the bottom of the window; the bridge keeps the full bounded history.
Rectangle {
    id: bar

    required property QtObject theme
    property string level: "info"
    property string message: ""
    property int visibleMilliseconds: 6000

    visible: message.length > 0
    implicitHeight: visible ? label.implicitHeight + theme.space2Xl : 0
    radius: theme.radiusMedium
    color: theme.noticeBackground(level)
    border.width: theme.borderWidth
    border.color: theme.noticeBorder(level)
    Accessible.role: Accessible.Notification
    Accessible.name: (level === "error" ? "Error: " : level === "warning" ? "Warning: " : "") + message

    function show(newLevel, newMessage) {
        level = newLevel
        message = newMessage
        hideTimer.restart()
    }

    SelectableText {
        id: label
        anchors.left: parent.left
        anchors.right: dismiss.left
        anchors.verticalCenter: parent.verticalCenter
        anchors.margins: bar.theme.spaceLg
        theme: bar.theme
        text: bar.message
        wrapMode: TextEdit.Wrap
        maximumLineCount: 3
        color: bar.theme.noticeForeground(bar.level)
        font.pixelSize: bar.theme.typeBody
    }

    AppButton {
        id: dismiss
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        anchors.rightMargin: bar.theme.spaceSm
        theme: bar.theme
        variant: "ghost"
        text: "Dismiss"
        accessibleName: "Dismiss notice"
        onClicked: bar.message = ""
    }

    Timer {
        id: hideTimer
        interval: bar.visibleMilliseconds
        repeat: false
        onTriggered: bar.message = ""
    }
}
