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

    implicitWidth: statusFlow.contentImplicitWidth + theme.spaceXl
    width: Math.min(implicitWidth, availableWidth)
    implicitHeight: statusFlow.contentImplicitHeight + theme.spaceMd
    radius: theme.radiusSmall
    color: theme.surfaceRaised
    border.width: theme.borderWidth
    border.color: theme.frameBorder
    Accessible.role: Accessible.Grouping
    Accessible.name: groupName

    Flow {
        id: statusFlow
        readonly property real contentImplicitWidth: {
            let total = 0
            for (let index = 0; index < statusRepeater.count; index++) {
                const item = statusRepeater.itemAt(index)
                if (item) total += item.implicitWidth
            }
            return total
        }
        readonly property real contentImplicitHeight: childrenRect.height

        anchors.fill: parent
        anchors.margins: segment.theme.spaceSm
        spacing: 0

        Repeater {
            id: statusRepeater
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
                        font.family: segment.theme.monospaceFamily
                        font.pixelSize: segment.theme.typeSmall
                    }

                    SelectableText {
                        visible: String(entry.modelData.label || "").length > 0
                        Layout.maximumWidth: Math.max(48, entry.width * 0.35)
                        theme: segment.theme
                        text: String(entry.modelData.label || "")
                        color: segment.theme.muted
                        font.family: segment.theme.monospaceFamily
                        font.pixelSize: segment.theme.typeSmall
                    }

                    SelectableText {
                        id: valueLabel
                        Layout.fillWidth: true
                        Layout.minimumWidth: 48
                        theme: segment.theme
                        text: entry.valueText
                        color: entry.tone === "error" ? segment.theme.errorForeground
                            : entry.tone === "warning" ? segment.theme.toolForeground
                            : entry.tone === "ok" ? segment.theme.readyForeground : segment.theme.foreground
                        font.family: segment.theme.monospaceFamily
                        font.pixelSize: segment.theme.typeSmall
                        font.bold: true
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
