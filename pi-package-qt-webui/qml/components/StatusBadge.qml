import QtQuick
import QtQuick.Controls

// Semantic status pill. `kind` selects the palette role; text is always plain.
Rectangle {
    id: badge

    required property QtObject theme
    property string kind: "neutral"
    property string text: ""
    property int fontSize: 12

    implicitWidth: label.implicitWidth + 20
    implicitHeight: label.implicitHeight + 10
    radius: height / 2
    color: theme.statusBackground(kind)
    border.width: 1
    border.color: theme.statusBorder(kind)
    Accessible.role: Accessible.StaticText
    Accessible.name: text

    Behavior on color { ColorAnimation { duration: badge.theme.animationDuration } }

    Label {
        id: label
        anchors.centerIn: parent
        text: badge.text
        textFormat: Text.PlainText
        color: badge.theme.statusForeground(badge.kind)
        font.pixelSize: badge.fontSize
        font.bold: true
        elide: Text.ElideRight
        maximumLineCount: 1
    }
}
