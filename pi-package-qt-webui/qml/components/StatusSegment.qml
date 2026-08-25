import QtQuick
import QtQuick.Controls

// One framed group of related status entries separated by thin dividers. Grouping related
// metrics into a single frame keeps every value visible without a border and padding per value.
Rectangle {
    id: segment

    required property QtObject theme
    property var entries: []
    property string groupName: ""

    implicitWidth: row.implicitWidth + 12
    implicitHeight: row.implicitHeight + 8
    radius: 6
    color: theme.surfaceRaised
    border.width: 1
    border.color: theme.border
    Accessible.role: Accessible.Grouping
    Accessible.name: groupName

    Row {
        id: row
        anchors.centerIn: parent
        spacing: 0

        Repeater {
            model: segment.entries

            delegate: Row {
                id: entry
                required property int index
                required property var modelData
                readonly property string tone: String(modelData.tone || "")
                readonly property string title: String(modelData.title || "")
                spacing: 4
                leftPadding: index === 0 ? 0 : 8
                rightPadding: 8
                Accessible.role: Accessible.StaticText
                Accessible.name: String(modelData.label || "") + " " + String(modelData.value || "") + (title.length > 0 ? ", " + title : "")

                Rectangle {
                    visible: entry.index > 0
                    width: 1
                    height: valueLabel.implicitHeight
                    anchors.verticalCenter: parent.verticalCenter
                    color: segment.theme.border
                }

                Label {
                    visible: String(entry.modelData.icon || "").length > 0
                    text: String(entry.modelData.icon || "")
                    textFormat: Text.PlainText
                    color: segment.theme.muted
                    font.pixelSize: 11
                    anchors.verticalCenter: parent.verticalCenter
                }

                Label {
                    visible: String(entry.modelData.label || "").length > 0
                    text: String(entry.modelData.label || "")
                    textFormat: Text.PlainText
                    color: segment.theme.muted
                    font.pixelSize: 11
                    anchors.verticalCenter: parent.verticalCenter
                }

                Label {
                    id: valueLabel
                    text: String(entry.modelData.value || "")
                    textFormat: Text.PlainText
                    color: entry.tone === "error" ? segment.theme.errorForeground
                        : entry.tone === "warning" ? segment.theme.toolForeground
                        : entry.tone === "ok" ? segment.theme.readyForeground : segment.theme.foreground
                    font.pixelSize: 11
                    font.bold: true
                    anchors.verticalCenter: parent.verticalCenter
                }

                HoverHandler {
                    id: hover
                    cursorShape: entry.title.length > 0 ? Qt.WhatsThisCursor : Qt.ArrowCursor
                }

                ToolTip.visible: hover.hovered && entry.title.length > 0
                ToolTip.text: entry.title
                ToolTip.delay: 400
            }
        }
    }
}
