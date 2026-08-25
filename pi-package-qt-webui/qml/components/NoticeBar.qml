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
    implicitHeight: visible ? label.implicitHeight + 16 : 0
    radius: 8
    color: theme.noticeBackground(level)
    border.width: 1
    border.color: theme.noticeBorder(level)
    Accessible.role: Accessible.Notification
    Accessible.name: (level === "error" ? "Error: " : level === "warning" ? "Warning: " : "") + message

    function show(newLevel, newMessage) {
        level = newLevel
        message = newMessage
        hideTimer.restart()
    }

    Label {
        id: label
        anchors.left: parent.left
        anchors.right: dismiss.left
        anchors.verticalCenter: parent.verticalCenter
        anchors.margins: 10
        text: bar.message
        textFormat: Text.PlainText
        wrapMode: Text.Wrap
        maximumLineCount: 3
        elide: Text.ElideRight
        color: bar.theme.noticeForeground(bar.level)
        font.pixelSize: 12
    }

    AppButton {
        id: dismiss
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        anchors.rightMargin: 6
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
