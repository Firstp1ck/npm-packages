import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Bounded status details anchored above one compact trigger. The publisher-owned grouping and
// values remain intact, while long text moves into a scrollable vertical reading order.
Popup {
    id: popup

    required property QtObject theme
    required property Item boundsItem
    property Item anchorItem: null
    property Item returnFocusItem: anchorItem
    property var groups: []
    property real maximumWidth: 640
    property real maximumHeight: 420
    property real edgeMargin: theme.edgeGap
    property real anchorGap: theme.spaceSm
    readonly property int entryCount: {
        let count = 0
        for (const group of groups) count += Array.isArray(group.entries) ? group.entries.length : 0
        return count
    }
    property point anchorPosition: Qt.point(edgeMargin, boundsItem.height)
    readonly property real dropUpAvailableHeight: Math.max(0, anchorPosition.y - edgeMargin - anchorGap)

    parent: anchorItem ? anchorItem : boundsItem
    modal: false
    focus: true
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutsideParent
    padding: theme.space2Xl
    width: Math.min(maximumWidth, Math.max(280, boundsItem.width - edgeMargin * 2))
    height: Math.min(implicitHeight, maximumHeight, dropUpAvailableHeight)
    x: Math.max(edgeMargin, Math.min(anchorPosition.x, boundsItem.width - width - edgeMargin))
        - (anchorItem ? anchorPosition.x : 0)
    y: Math.max(edgeMargin, anchorPosition.y - height - anchorGap)
        - (anchorItem ? anchorPosition.y : 0)
    implicitHeight: statusColumn.implicitHeight + topPadding + bottomPadding

    background: Rectangle {
        radius: popup.theme.radiusMedium
        color: popup.theme.surfaceRaised
        border.width: popup.theme.borderWidth
        border.color: popup.theme.frameBorder
    }

    function valueColor(tone) {
        if (tone === "error") return theme.errorForeground
        if (tone === "warning") return theme.toolForeground
        if (tone === "ok") return theme.readyForeground
        return theme.foreground
    }

    function updateAnchorPosition() {
        anchorPosition = anchorItem ? anchorItem.mapToItem(boundsItem, 0, 0) : Qt.point(edgeMargin, boundsItem.height)
    }

    function scheduleAnchorUpdate() {
        if (opened) Qt.callLater(updateAnchorPosition)
    }

    function present() {
        if (entryCount === 0) return false
        updateAnchorPosition()
        open()
        Qt.callLater(() => closeButton.forceActiveFocus())
        return true
    }

    onGroupsChanged: if (opened && entryCount === 0) close()
    onAnchorItemChanged: updateAnchorPosition()
    onClosed: if (returnFocusItem) returnFocusItem.forceActiveFocus()

    Connections {
        target: popup.boundsItem
        function onWidthChanged() { popup.scheduleAnchorUpdate() }
        function onHeightChanged() { popup.scheduleAnchorUpdate() }
    }

    Connections {
        target: popup.anchorItem
        function onXChanged() { popup.scheduleAnchorUpdate() }
        function onYChanged() { popup.scheduleAnchorUpdate() }
        function onWidthChanged() { popup.scheduleAnchorUpdate() }
        function onHeightChanged() { popup.scheduleAnchorUpdate() }
        function onVisibleChanged() { if (!popup.anchorItem.visible && popup.opened) popup.close() }
    }

    contentItem: ColumnLayout {
        id: statusColumn
        spacing: popup.theme.spaceMd
        Accessible.role: Accessible.Dialog
        Accessible.name: "Session details"
        Accessible.description: popup.entryCount + " status entries in " + popup.groups.length + " groups"

        RowLayout {
            Layout.fillWidth: true
            spacing: popup.theme.spaceMd

            ColumnLayout {
                Layout.fillWidth: true
                spacing: popup.theme.spaceXxs

                Label {
                    Layout.fillWidth: true
                    text: "SESSION DETAILS"
                    textFormat: Text.PlainText
                    color: popup.theme.heading
                    font.family: popup.theme.monospaceFamily
                    font.pixelSize: popup.theme.typeSubtitle
                    font.bold: true
                    font.letterSpacing: popup.theme.labelTracking
                    Accessible.role: Accessible.Heading
                }

                Label {
                    Layout.fillWidth: true
                    text: popup.groups.length + (popup.groups.length === 1 ? " group" : " groups") + " · "
                        + popup.entryCount + (popup.entryCount === 1 ? " entry" : " entries")
                    textFormat: Text.PlainText
                    color: popup.theme.muted
                    font.family: popup.theme.monospaceFamily
                    font.pixelSize: popup.theme.typeCaption
                }
            }

            AppButton {
                id: closeButton
                theme: popup.theme
                variant: "ghost"
                text: "Close"
                accessibleName: "Close session details"
                onClicked: popup.close()
            }
        }

        Rectangle {
            Layout.fillWidth: true
            height: popup.theme.borderWidth
            color: popup.theme.border
        }

        ScrollView {
            id: statusScroll
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.minimumHeight: 72
            Layout.preferredHeight: Math.min(groupsColumn.implicitHeight, 320)
            clip: true
            contentWidth: availableWidth
            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
            ScrollBar.vertical.policy: ScrollBar.AsNeeded

            ColumnLayout {
                id: groupsColumn
                width: statusScroll.availableWidth
                spacing: popup.theme.spaceXl

                Repeater {
                    model: popup.groups

                    delegate: ColumnLayout {
                        id: groupSection
                        required property var modelData
                        Layout.fillWidth: true
                        spacing: popup.theme.spaceSm

                        Label {
                            Layout.fillWidth: true
                            text: String(groupSection.modelData.name || "Status").toUpperCase()
                            textFormat: Text.PlainText
                            color: popup.theme.accentForeground
                            font.family: popup.theme.monospaceFamily
                            font.pixelSize: popup.theme.typeCaption
                            font.bold: true
                            font.letterSpacing: popup.theme.labelTracking
                            Accessible.role: Accessible.Heading
                        }

                        Rectangle {
                            id: groupFrame
                            Layout.fillWidth: true
                            implicitHeight: entriesColumn.implicitHeight + popup.theme.spaceXl
                            radius: popup.theme.radiusSmall
                            color: popup.theme.surface
                            border.width: popup.theme.borderWidth
                            border.color: popup.theme.frameBorder
                            Accessible.role: Accessible.Grouping
                            Accessible.name: String(groupSection.modelData.name || "Status")

                            ColumnLayout {
                                id: entriesColumn
                                anchors.fill: parent
                                anchors.margins: popup.theme.spaceSm
                                spacing: 0

                                Repeater {
                                    model: groupSection.modelData.entries

                                    delegate: Item {
                                        id: statusEntry
                                        required property int index
                                        required property var modelData
                                        readonly property string entryLabel: String(modelData.label || "")
                                        readonly property string entryValue: String(modelData.value || "")
                                        readonly property string detailText: String(modelData.title || "")
                                        readonly property string tone: String(modelData.tone || "")
                                        Layout.fillWidth: true
                                        implicitHeight: entryColumn.implicitHeight
                                        Accessible.role: Accessible.StaticText
                                        Accessible.name: entryLabel + (entryLabel.length > 0 ? " " : "") + entryValue
                                            + (detailText.length > 0 ? ", " + detailText : "")

                                        ColumnLayout {
                                            id: entryColumn
                                            width: statusEntry.width
                                            spacing: popup.theme.spaceXs

                                            Rectangle {
                                                visible: statusEntry.index > 0
                                                Layout.fillWidth: true
                                                height: popup.theme.borderWidth
                                                color: popup.theme.border
                                            }

                                            RowLayout {
                                                Layout.fillWidth: true
                                                Layout.topMargin: statusEntry.index > 0 ? popup.theme.spaceSm : 0
                                                spacing: popup.theme.spaceSm

                                                Label {
                                                    visible: String(statusEntry.modelData.icon || "").length > 0
                                                    text: String(statusEntry.modelData.icon || "")
                                                    textFormat: Text.PlainText
                                                    color: popup.theme.muted
                                                    font.family: popup.theme.monospaceFamily
                                                    font.pixelSize: popup.theme.typeSmall
                                                }

                                                Label {
                                                    visible: statusEntry.entryLabel.length > 0
                                                    Layout.preferredWidth: 104
                                                    Layout.maximumWidth: 144
                                                    text: statusEntry.entryLabel
                                                    textFormat: Text.PlainText
                                                    color: popup.theme.muted
                                                    font.family: popup.theme.monospaceFamily
                                                    font.pixelSize: popup.theme.typeSmall
                                                    wrapMode: Text.Wrap
                                                }

                                                Label {
                                                    Layout.fillWidth: true
                                                    text: statusEntry.entryValue
                                                    textFormat: Text.PlainText
                                                    color: popup.valueColor(statusEntry.tone)
                                                    font.family: popup.theme.monospaceFamily
                                                    font.pixelSize: popup.theme.typeSmall
                                                    font.bold: true
                                                    wrapMode: Text.WrapAnywhere
                                                    horizontalAlignment: Text.AlignRight
                                                }
                                            }

                                            Label {
                                                visible: statusEntry.detailText.length > 0
                                                Layout.fillWidth: true
                                                Layout.leftMargin: String(statusEntry.modelData.icon || "").length > 0 ? popup.theme.space2Xl : 0
                                                Layout.bottomMargin: popup.theme.spaceSm
                                                text: statusEntry.detailText
                                                textFormat: Text.PlainText
                                                color: popup.theme.muted
                                                font.family: popup.theme.monospaceFamily
                                                font.pixelSize: popup.theme.typeCaption
                                                wrapMode: Text.WrapAnywhere
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Label {
            Layout.fillWidth: true
            text: "Escape or click outside to close"
            textFormat: Text.PlainText
            color: popup.theme.muted
            font.family: popup.theme.monospaceFamily
            font.pixelSize: popup.theme.typeCaption
            horizontalAlignment: Text.AlignRight
        }
    }
}
