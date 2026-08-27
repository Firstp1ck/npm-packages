import QtQuick
import QtQuick.Controls

// Compact rectangular status punctuation. `kind` selects the palette role; text is always plain.
Rectangle {
    id: badge

    required property QtObject theme
    property string kind: "neutral"
    property string text: ""
    property int fontSize: theme.typeBody
    property real horizontalPadding: theme.spaceLg
    property real verticalPadding: theme.spaceLg / 2

    implicitWidth: label.implicitWidth + 2 * horizontalPadding
    implicitHeight: label.implicitHeight + 2 * verticalPadding
    radius: theme.radiusSmall
    color: theme.statusBackground(kind)
    border.width: theme.borderWidth
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
        font.family: badge.theme.monospaceFamily
        font.pixelSize: badge.fontSize
        font.bold: true
        font.capitalization: Font.AllUppercase
        font.letterSpacing: badge.theme.labelTracking
        elide: Text.ElideRight
        maximumLineCount: 1
    }
}
