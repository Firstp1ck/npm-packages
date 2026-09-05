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
    implicitHeight: visible ? column.implicitHeight + theme.spaceXl : 0
    radius: theme.radiusMedium
    color: theme.surfaceRaised
    border.width: theme.borderWidth
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
        anchors.margins: popup.theme.spaceSm
        spacing: popup.theme.spaceXs

        SelectableText {
            Layout.fillWidth: true
            theme: popup.theme
            text: popup.kind === "command" ? "Commands · Tab or Enter completes, Escape closes" : "Workspace paths · Tab or Enter completes, Escape closes"
            color: popup.theme.muted
            font.pixelSize: popup.theme.typeSmall
        }

        SelectableText {
            Layout.fillWidth: true
            visible: popup.count === 0 && popup.emptyText.length > 0
            theme: popup.theme
            text: popup.emptyText
            color: popup.theme.muted
            font.pixelSize: popup.theme.typeBody
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
                readonly property bool selected: index === popup.currentIndex
                implicitHeight: entryRow.implicitHeight + popup.theme.spaceMd
                radius: popup.theme.radiusSmall
                color: popup.theme.interactiveFill(selected, entryHover.hovered, entryTap.pressed)
                border.width: popup.theme.focusBorderWidth
                border.color: popup.theme.interactiveBorder(selected, selected)
                Behavior on color { ColorAnimation { duration: popup.theme.motionNormal } }
                Behavior on border.color { ColorAnimation { duration: popup.theme.motionNormal } }
                Accessible.role: Accessible.ListItem
                Accessible.name: String(modelData.label || "") + (String(modelData.detail || "").length > 0 ? ", " + String(modelData.detail) : "")
                Accessible.selected: index === popup.currentIndex

                function activateRow() {
                    popup.currentIndex = entry.index
                    popup.accepted(entry.index)
                }

                RowLayout {
                    id: entryRow
                    anchors.fill: parent
                    anchors.margins: popup.theme.spaceXs
                    spacing: popup.theme.spaceMd

                    SelectableText {
                        theme: popup.theme
                        text: String(entry.modelData.label || "")
                        color: entry.selected ? popup.theme.selectionForeground : popup.theme.foreground
                        font.family: popup.theme.monospaceFamily
                        font.pixelSize: popup.theme.typeBody
                        Layout.maximumWidth: entryRow.width * 0.6
                        onTapped: entry.activateRow()
                    }

                    SelectableText {
                        Layout.fillWidth: true
                        theme: popup.theme
                        text: String(entry.modelData.detail || "")
                        color: popup.theme.muted
                        font.pixelSize: popup.theme.typeSmall
                        onTapped: entry.activateRow()
                    }
                }

                HoverHandler {
                    id: entryHover
                    cursorShape: Qt.PointingHandCursor
                }

                TapHandler {
                    id: entryTap
                    acceptedButtons: Qt.LeftButton
                    gesturePolicy: TapHandler.DragThreshold
                    onTapped: entry.activateRow()
                }
            }
        }
    }
}
