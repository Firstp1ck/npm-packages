import QtQuick
import QtQuick.Controls

Item {
    id: message

    required property string messageRole
    required property string messageText
    required property QtObject theme
    readonly property bool fromUser: messageRole === "user"

    implicitHeight: bubble.implicitHeight

    Rectangle {
        id: bubble
        anchors.left: message.fromUser ? undefined : parent.left
        anchors.right: message.fromUser ? parent.right : undefined
        width: Math.min(parent.width * 0.88, content.implicitWidth + 32)
        implicitHeight: content.implicitHeight + 24
        radius: 10
        color: message.fromUser ? message.theme.userBubble : message.theme.assistantBubble
        border.width: 1
        border.color: message.fromUser ? message.theme.userBorder : message.theme.assistantBorder

        Behavior on color {
            ColorAnimation { duration: 120 }
        }

        Column {
            id: content
            anchors.fill: parent
            anchors.margins: 12
            spacing: 5

            Label {
                text: message.fromUser ? "You" : "Pi"
                color: message.fromUser ? message.theme.accentForeground : message.theme.muted
                font.bold: true
                font.pixelSize: 12
            }

            Label {
                width: Math.min(implicitWidth, message.width * 0.88 - 32)
                text: message.messageText
                color: message.theme.foreground
                wrapMode: Text.Wrap
                textFormat: Text.PlainText
                font.pixelSize: 14
                lineHeight: 1.2
            }
        }
    }
}
