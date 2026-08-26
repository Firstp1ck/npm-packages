import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// One framed group of related status entries separated by thin dividers. Grouping related
// metrics into a single frame keeps every value visible without a border and padding per value.
Rectangle {
    id: segment

    required property QtObject theme
    property var entries: []
    property string groupName: ""

    readonly property real availableWidth: parent && parent.width > 0 ? parent.width : implicitWidth

    implicitWidth: statusFlow.implicitWidth + 12
    width: Math.min(implicitWidth, availableWidth)
    implicitHeight: statusFlow.implicitHeight + 8
    radius: 6
    color: theme.surfaceRaised
    border.width: 1
    border.color: theme.border
    Accessible.role: Accessible.Grouping
    Accessible.name: groupName

    Flow {
        id: statusFlow
        anchors.fill: parent
        anchors.margins: 6
        spacing: 0

        Repeater {
            model: segment.entries

            delegate: Item {
                id: entry
                required property int index
                required property var modelData
                readonly property string tone: String(modelData.tone || "")
                readonly property string title: String(modelData.title || "")
                readonly property string valueText: String(modelData.value || "")
                implicitWidth: entryLayout.implicitWidth + (index === 0 ? 8 : 16)
                width: Math.min(implicitWidth, statusFlow.width)
                implicitHeight: entryLayout.implicitHeight
                height: implicitHeight
                Accessible.role: Accessible.StaticText
                Accessible.name: String(modelData.label || "") + " " + valueText + (title.length > 0 ? ", " + title : "")

                RowLayout {
                    id: entryLayout
                    anchors.fill: parent
                    anchors.leftMargin: entry.index === 0 ? 0 : 8
                    anchors.rightMargin: 8
                    spacing: 4

                    Rectangle {
                        visible: entry.index > 0
                        width: 1
                        height: valueLabel.implicitHeight
                        color: segment.theme.border
                    }

                    Label {
                        visible: String(entry.modelData.icon || "").length > 0
                        text: String(entry.modelData.icon || "")
                        textFormat: Text.PlainText
                        color: segment.theme.muted
                        font.pixelSize: 11
                    }

                    Label {
                        visible: String(entry.modelData.label || "").length > 0
                        Layout.maximumWidth: Math.max(48, entry.width * 0.35)
                        text: String(entry.modelData.label || "")
                        textFormat: Text.PlainText
                        color: segment.theme.muted
                        font.pixelSize: 11
                        elide: Text.ElideRight
                    }

                    Label {
                        id: valueLabel
                        Layout.fillWidth: true
                        Layout.minimumWidth: 48
                        text: entry.valueText
                        textFormat: Text.PlainText
                        color: entry.tone === "error" ? segment.theme.errorForeground
                            : entry.tone === "warning" ? segment.theme.toolForeground
                            : entry.tone === "ok" ? segment.theme.readyForeground : segment.theme.foreground
                        font.pixelSize: 11
                        font.bold: true
                        elide: Text.ElideRight
                    }
                }

                HoverHandler {
                    id: hover
                    cursorShape: entry.title.length > 0 || entry.valueText.length > 0 ? Qt.WhatsThisCursor : Qt.ArrowCursor
                }

                ToolTip.visible: hover.hovered && (entry.title.length > 0 || entry.valueText.length > 0)
                ToolTip.text: entry.title.length > 0 ? entry.title : entry.valueText
                ToolTip.delay: 400
            }
        }
    }
}
