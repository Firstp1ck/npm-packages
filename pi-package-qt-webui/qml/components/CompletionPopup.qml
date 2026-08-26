import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Inline suggestion list for the composer: slash commands and workspace paths. It never sends
// anything; the composer decides what accepting a suggestion means. Keyboard navigation comes
// from the composer's editor so focus never leaves the prompt.
Rectangle {
    id: popup

    required property QtObject theme
    property var items: []
    property string kind: ""
    property int currentIndex: -1
    property string emptyText: ""
    readonly property int count: items.length

    signal accepted(int index)

    visible: kind.length > 0 && (count > 0 || emptyText.length > 0)
    implicitHeight: visible ? column.implicitHeight + 12 : 0
    radius: 8
    color: theme.surfaceRaised
    border.width: 1
    border.color: theme.border
    Accessible.role: Accessible.List
    Accessible.name: kind === "command" ? "Command suggestions" : "Path suggestions"

    function move(delta) {
        if (count === 0) return
        currentIndex = currentIndex < 0 ? 0 : (currentIndex + delta + count) % count
    }

    // A fresh list always starts on its first entry so Tab or Enter has a deterministic target.
    onItemsChanged: currentIndex = items.length > 0 ? 0 : -1
    onCountChanged: if (currentIndex < 0 && count > 0) currentIndex = 0
    else if (currentIndex >= count) currentIndex = count > 0 ? 0 : -1

    ColumnLayout {
        id: column
        anchors.fill: parent
        anchors.margins: 6
        spacing: 4

        Label {
            Layout.fillWidth: true
            text: popup.kind === "command" ? "Commands · Tab or Enter completes, Escape closes" : "Workspace paths · Tab or Enter completes, Escape closes"
            textFormat: Text.PlainText
            color: popup.theme.muted
            font.pixelSize: 11
            elide: Text.ElideRight
        }

        Label {
            Layout.fillWidth: true
            visible: popup.count === 0 && popup.emptyText.length > 0
            text: popup.emptyText
            textFormat: Text.PlainText
            color: popup.theme.muted
            font.pixelSize: 12
        }

        ListView {
            id: list
            Layout.fillWidth: true
            Layout.preferredHeight: Math.min(contentHeight, 180)
            visible: popup.count > 0
            model: popup.items
            clip: true
            currentIndex: popup.currentIndex
            onCurrentIndexChanged: if (currentIndex >= 0) positionViewAtIndex(currentIndex, ListView.Contain)

            ScrollBar.vertical: ScrollBar {
                policy: ScrollBar.AsNeeded
            }

            delegate: Rectangle {
                id: entry
                required property int index
                required property var modelData
                width: list.width
                implicitHeight: entryRow.implicitHeight + 8
                radius: 5
                color: index === popup.currentIndex ? popup.theme.selection : "transparent"
                Accessible.role: Accessible.ListItem
                Accessible.name: String(modelData.label || "") + (String(modelData.detail || "").length > 0 ? ", " + String(modelData.detail) : "")
                Accessible.selected: index === popup.currentIndex

                RowLayout {
                    id: entryRow
                    anchors.fill: parent
                    anchors.margins: 4
                    spacing: 8

                    Label {
                        text: String(entry.modelData.label || "")
                        textFormat: Text.PlainText
                        color: popup.theme.foreground
                        font.family: popup.theme.monospaceFamily
                        font.pixelSize: 12
                        elide: Text.ElideMiddle
                        Layout.maximumWidth: entryRow.width * 0.6
                    }

                    Label {
                        Layout.fillWidth: true
                        text: String(entry.modelData.detail || "")
                        textFormat: Text.PlainText
                        color: popup.theme.muted
                        font.pixelSize: 11
                        elide: Text.ElideRight
                    }
                }

                HoverHandler {
                    cursorShape: Qt.PointingHandCursor
                }

                TapHandler {
                    onTapped: popup.accepted(entry.index)
                }
            }
        }
    }
}
