import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Bounded non-modal picker anchored above a compact control. Items are plain data
// ({value, label, detail, current}); navigation never selects without explicit activation.
Popup {
    id: popup

    required property QtObject theme
    required property Item boundsItem
    property Item anchorItem: null
    property Item returnFocusItem: anchorItem
    property var items: []
    property string title: ""
    property string message: ""
    property string emptyText: "Nothing to choose from"
    property bool searchable: true
    property string filter: ""
    property int currentIndex: -1
    property real maximumWidth: 480
    property real maximumHeight: 300
    property real edgeMargin: 8
    property real anchorGap: 6
    readonly property var visibleItems: filterItems(items, filter)
    readonly property int visibleCount: visibleItems.length
    property point anchorPosition: Qt.point(edgeMargin, boundsItem.height)
    readonly property real dropUpAvailableHeight: Math.max(0, anchorPosition.y - edgeMargin - anchorGap)
    readonly property bool focusedOnOpen: filterField.activeFocus || optionList.activeFocus
    readonly property bool optionsFocused: optionList.activeFocus

    signal picked(string value)
    signal cancelled()

    parent: boundsItem
    modal: false
    focus: true
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
    padding: 8
    width: Math.min(maximumWidth, Math.max(160, boundsItem.width - edgeMargin * 2))
    height: Math.min(implicitHeight, maximumHeight, dropUpAvailableHeight)
    x: Math.max(edgeMargin, Math.min(anchorPosition.x, boundsItem.width - width - edgeMargin))
    y: Math.max(edgeMargin, anchorPosition.y - height - anchorGap)
    implicitHeight: pickerColumn.implicitHeight + topPadding + bottomPadding

    background: Rectangle {
        radius: 8
        color: popup.theme.surfaceRaised
        border.width: 1
        border.color: popup.theme.border
    }

    function filterItems(list, query) {
        const needle = String(query || "").trim().toLowerCase()
        const result = []
        for (const item of list) {
            if (!item || typeof item !== "object") continue
            const haystack = (String(item.label || "") + " " + String(item.detail || "") + " " + String(item.value || "")).toLowerCase()
            if (needle.length === 0 || haystack.indexOf(needle) !== -1) result.push(item)
        }
        return result
    }

    function selectCurrentItem() {
        let selected = visibleItems.length > 0 ? 0 : -1
        for (let index = 0; index < visibleItems.length; index++) {
            if (visibleItems[index].current === true) selected = index
        }
        currentIndex = selected
    }

    function updateAnchorPosition() {
        anchorPosition = anchorItem ? anchorItem.mapToItem(boundsItem, 0, 0) : Qt.point(edgeMargin, boundsItem.height)
    }

    function scheduleAnchorUpdate() {
        if (opened) Qt.callLater(updateAnchorPosition)
    }

    function present(config) {
        title = String(config.title || "")
        message = String(config.message || "")
        emptyText = String(config.emptyText || "Nothing to choose from")
        searchable = config.searchable !== false
        items = Array.isArray(config.items) ? config.items : []
        filter = ""
        filterField.text = ""
        selectCurrentItem()
        updateAnchorPosition()
        open()
        Qt.callLater(() => {
            updateAnchorPosition()
            if (searchable) filterField.forceActiveFocus()
            else optionList.forceActiveFocus()
        })
    }

    function moveSelection(delta) {
        if (visibleCount === 0) return
        currentIndex = currentIndex < 0 ? 0 : (currentIndex + delta + visibleCount) % visibleCount
    }

    function handleOptionListKey(key) {
        if (key === Qt.Key_Down) {
            moveSelection(1)
            return true
        }
        if (key === Qt.Key_Up) {
            moveSelection(-1)
            return true
        }
        if (key === Qt.Key_Return || key === Qt.Key_Enter || key === Qt.Key_Space) {
            pickCurrent()
            return true
        }
        return false
    }

    function focusOptions() {
        optionList.forceActiveFocus()
    }

    function pickIndex(index) {
        if (index < 0 || index >= visibleItems.length || !opened) return false
        const value = String(visibleItems[index].value)
        picked(value)
        close()
        return true
    }

    function pickCurrent() {
        return pickIndex(currentIndex)
    }

    function pickValue(value) {
        for (let index = 0; index < visibleItems.length; index++) {
            if (String(visibleItems[index].value) === String(value)) return pickIndex(index)
        }
        return false
    }

    function setFilter(text) {
        filterField.text = String(text)
    }

    onAnchorItemChanged: updateAnchorPosition()
    onFilterChanged: selectCurrentItem()
    onCurrentIndexChanged: if (currentIndex >= 0) optionList.positionViewAtIndex(currentIndex, ListView.Contain)
    onClosed: {
        cancelled()
        if (returnFocusItem) returnFocusItem.forceActiveFocus()
    }

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
    }

    contentItem: ColumnLayout {
        id: pickerColumn
        spacing: 5
        Accessible.role: Accessible.Dialog
        Accessible.name: popup.title

        Label {
            Layout.fillWidth: true
            text: popup.title
            textFormat: Text.PlainText
            color: popup.theme.heading
            font.pixelSize: 13
            font.bold: true
            elide: Text.ElideRight
            Accessible.role: Accessible.Heading
        }

        Label {
            Layout.fillWidth: true
            visible: popup.message.length > 0
            text: popup.message
            textFormat: Text.PlainText
            color: popup.theme.muted
            font.pixelSize: 11
            wrapMode: Text.Wrap
            maximumLineCount: 2
            elide: Text.ElideRight
        }

        TextField {
            id: filterField
            Layout.fillWidth: true
            visible: popup.searchable
            placeholderText: "Type to filter"
            color: popup.theme.foreground
            placeholderTextColor: popup.theme.muted
            selectionColor: popup.theme.selection
            background: Rectangle {
                radius: 6
                color: popup.theme.controlSurface
                border.width: filterField.activeFocus ? 2 : 1
                border.color: filterField.activeFocus ? popup.theme.focusRing : popup.theme.border
            }
            Accessible.role: Accessible.EditableText
            Accessible.name: "Filter " + popup.title
            Accessible.description: "Arrow keys move the selection, Enter chooses, Escape closes"
            onTextChanged: popup.filter = text
            Keys.onPressed: event => {
                if (event.key === Qt.Key_Down) {
                    popup.moveSelection(1)
                    event.accepted = true
                } else if (event.key === Qt.Key_Up) {
                    popup.moveSelection(-1)
                    event.accepted = true
                } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                    popup.pickCurrent()
                    event.accepted = true
                }
            }
        }

        Label {
            Layout.fillWidth: true
            visible: popup.visibleCount === 0
            text: popup.items.length === 0 ? popup.emptyText : "No matches"
            textFormat: Text.PlainText
            color: popup.theme.muted
            font.pixelSize: 12
        }

        ListView {
            id: optionList
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.minimumHeight: visible ? 36 : 0
            Layout.preferredHeight: Math.min(contentHeight, 210)
            visible: popup.visibleCount > 0
            model: popup.visibleItems
            clip: true
            currentIndex: popup.currentIndex
            keyNavigationEnabled: true
            keyNavigationWraps: true
            activeFocusOnTab: true
            Accessible.role: Accessible.List
            Accessible.name: popup.title + " options"
            Keys.onPressed: event => {
                if (popup.handleOptionListKey(event.key)) event.accepted = true
            }

            ScrollBar.vertical: ScrollBar {
                policy: ScrollBar.AsNeeded
            }

            delegate: Rectangle {
                id: optionRow
                required property int index
                required property var modelData
                readonly property bool current: modelData.current === true
                width: optionList.width
                implicitHeight: optionColumn.implicitHeight + 12
                radius: 6
                color: index === popup.currentIndex ? popup.theme.selection : "transparent"
                border.width: index === popup.currentIndex && (optionList.activeFocus || filterField.activeFocus) ? 2 : 0
                border.color: popup.theme.focusRing
                Accessible.role: Accessible.ListItem
                Accessible.name: String(modelData.label || "") + (String(modelData.detail || "").length > 0 ? ", " + String(modelData.detail) : "") + (current ? ", current" : "")
                Accessible.focusable: true
                Accessible.selected: index === popup.currentIndex

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: 6
                    spacing: 6

                    ColumnLayout {
                        id: optionColumn
                        Layout.fillWidth: true
                        spacing: 1

                        Label {
                            Layout.fillWidth: true
                            text: String(optionRow.modelData.label || "")
                            textFormat: Text.PlainText
                            elide: Text.ElideMiddle
                            color: popup.theme.foreground
                            font.pixelSize: 12
                            font.bold: optionRow.current
                        }

                        Label {
                            Layout.fillWidth: true
                            visible: String(optionRow.modelData.detail || "").length > 0
                            text: String(optionRow.modelData.detail || "")
                            textFormat: Text.PlainText
                            elide: Text.ElideRight
                            color: popup.theme.muted
                            font.pixelSize: 10
                        }
                    }

                    StatusBadge {
                        visible: optionRow.current
                        theme: popup.theme
                        kind: "ok"
                        text: "current"
                        fontSize: 9
                    }
                }

                HoverHandler {
                    cursorShape: Qt.PointingHandCursor
                }

                TapHandler {
                    onTapped: popup.pickIndex(optionRow.index)
                }
            }
        }

        Label {
            Layout.fillWidth: true
            text: popup.visibleCount + " of " + popup.items.length + " · Enter or Space chooses · Escape closes"
            textFormat: Text.PlainText
            color: popup.theme.muted
            font.pixelSize: 10
            elide: Text.ElideRight
        }
    }
}
