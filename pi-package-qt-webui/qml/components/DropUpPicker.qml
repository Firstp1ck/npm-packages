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
    property bool reorderable: false
    property string filter: ""
    property int currentIndex: -1
    property int dragFromIndex: -1
    property int dragTargetIndex: -1
    property real maximumWidth: 480
    property real maximumHeight: 300
    property real edgeMargin: theme.edgeGap
    property real anchorGap: theme.spaceSm
    readonly property var visibleItems: filterItems(items, filter)
    readonly property int visibleCount: visibleItems.length
    readonly property bool reorderEnabled: reorderable && items.length >= 2 && String(filter || "").trim().length === 0
    property point anchorPosition: Qt.point(edgeMargin, boundsItem.height)
    readonly property real dropUpAvailableHeight: Math.max(0, anchorPosition.y - edgeMargin - anchorGap)
    readonly property bool focusedOnOpen: filterField.activeFocus || optionList.activeFocus
    readonly property bool optionsFocused: optionList.activeFocus

    signal picked(string value)
    signal reordered(var values)
    signal cancelled()

    parent: boundsItem
    modal: false
    focus: true
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
    padding: theme.spaceMd
    width: Math.min(maximumWidth, Math.max(160, boundsItem.width - edgeMargin * 2))
    height: Math.min(implicitHeight, maximumHeight, dropUpAvailableHeight)
    x: Math.max(edgeMargin, Math.min(anchorPosition.x, boundsItem.width - width - edgeMargin))
    y: Math.max(edgeMargin, anchorPosition.y - height - anchorGap)
    implicitHeight: pickerColumn.implicitHeight + topPadding + bottomPadding

    background: Rectangle {
        radius: popup.theme.radiusMedium
        color: popup.theme.surfaceRaised
        border.width: popup.theme.borderWidth
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
        reorderable = config.reorderable === true
        items = Array.isArray(config.items) ? config.items : []
        filter = ""
        dragFromIndex = -1
        dragTargetIndex = -1
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

    function moveItem(fromIndex, toIndex) {
        if (!opened || !reorderEnabled || fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length || fromIndex === toIndex) return false
        const selectedValue = currentIndex >= 0 && currentIndex < items.length ? String(items[currentIndex].value) : ""
        const reorderedItems = items.slice()
        const moved = reorderedItems.splice(fromIndex, 1)[0]
        reorderedItems.splice(toIndex, 0, moved)
        items = reorderedItems
        currentIndex = selectedValue.length > 0 ? 0 : -1
        for (let index = 0; index < reorderedItems.length; index++) {
            if (String(reorderedItems[index].value) === selectedValue) currentIndex = index
        }
        reordered(reorderedItems.map(item => String(item.value)))
        return true
    }

    function moveCurrentItem(delta) {
        if (!reorderEnabled || currentIndex < 0) return false
        const target = Math.max(0, Math.min(items.length - 1, currentIndex + delta))
        return moveItem(currentIndex, target)
    }

    function handleReorderKey(key, modifiers) {
        const moveModifier = (modifiers & Qt.ControlModifier) !== 0 && (modifiers & Qt.ShiftModifier) !== 0
        if (!reorderEnabled || !moveModifier || (key !== Qt.Key_Up && key !== Qt.Key_Down)) return false
        moveCurrentItem(key === Qt.Key_Up ? -1 : 1)
        return true
    }

    function handleOptionListKey(key, modifiers) {
        if (handleReorderKey(key, modifiers || Qt.NoModifier)) return true
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

    function updateDragTarget(fromIndex, centerY) {
        if (!reorderEnabled || fromIndex < 0) return
        let target = optionList.indexAt(1, centerY)
        if (target < 0 && centerY <= optionList.contentY) target = 0
        if (target < 0 && centerY >= optionList.contentY + optionList.height) target = items.length - 1
        if (target >= 0) dragTargetIndex = target
    }

    function finishDrag() {
        const fromIndex = dragFromIndex
        const targetIndex = dragTargetIndex
        dragFromIndex = -1
        dragTargetIndex = -1
        if (fromIndex >= 0 && targetIndex >= 0) moveItem(fromIndex, targetIndex)
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
        spacing: popup.theme.spaceXs + 1
        Accessible.role: Accessible.Dialog
        Accessible.name: popup.title

        Label {
            Layout.fillWidth: true
            text: popup.title
            textFormat: Text.PlainText
            color: popup.theme.heading
            font.pixelSize: popup.theme.typeBody + 1
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
            font.pixelSize: popup.theme.typeSmall
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
                radius: popup.theme.radiusSmall
                color: popup.theme.controlSurface
                border.width: filterField.activeFocus ? popup.theme.focusBorderWidth : popup.theme.borderWidth
                border.color: filterField.activeFocus ? popup.theme.focusRing : popup.theme.border
            }
            Accessible.role: Accessible.EditableText
            Accessible.name: "Filter " + popup.title
            Accessible.description: popup.reorderable ? "Arrow keys move the selection; Ctrl+Shift+Up or Ctrl+Shift+Down reorders when the filter is empty; Enter chooses; Escape closes" : "Arrow keys move the selection, Enter chooses, Escape closes"
            onTextChanged: popup.filter = text
            Keys.onPressed: event => {
                if (popup.handleReorderKey(event.key, event.modifiers)) {
                    event.accepted = true
                } else if (event.key === Qt.Key_Down) {
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
            font.pixelSize: popup.theme.typeBody
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
                if (popup.handleOptionListKey(event.key, event.modifiers)) event.accepted = true
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
                readonly property bool selected: index === popup.currentIndex
                readonly property bool focused: selected && (optionList.activeFocus || filterField.activeFocus)
                implicitHeight: optionColumn.implicitHeight + popup.theme.spaceXl
                radius: popup.theme.radiusSmall
                color: popup.theme.interactiveFill(selected, optionHover.hovered, optionTap.pressed)
                border.width: popup.theme.focusBorderWidth
                border.color: popup.theme.interactiveBorder(selected, focused)
                z: reorderDrag.active ? 1 : 0
                transform: Translate { y: reorderDrag.active ? reorderDrag.translation.y : 0 }
                Behavior on color { ColorAnimation { duration: popup.theme.motionNormal } }
                Behavior on border.color { ColorAnimation { duration: popup.theme.motionNormal } }
                Accessible.role: Accessible.ListItem
                Accessible.name: String(modelData.label || "") + (String(modelData.detail || "").length > 0 ? ", " + String(modelData.detail) : "") + (current ? ", current" : "")
                Accessible.description: popup.reorderable ? (popup.reorderEnabled ? "Drag the reorder handle or press Ctrl+Shift+Up or Ctrl+Shift+Down to move this item" : "Clear the filter to reorder items") : ""
                Accessible.focusable: true
                Accessible.selected: index === popup.currentIndex

                RowLayout {
                    anchors.fill: parent
                    anchors.margins: popup.theme.spaceSm
                    spacing: popup.theme.spaceSm

                    ColumnLayout {
                        id: optionColumn
                        Layout.fillWidth: true
                        spacing: popup.theme.spaceXxs / 2

                        Label {
                            Layout.fillWidth: true
                            text: String(optionRow.modelData.label || "")
                            textFormat: Text.PlainText
                            elide: Text.ElideMiddle
                            color: optionRow.selected ? popup.theme.selectionForeground : popup.theme.foreground
                            font.pixelSize: popup.theme.typeBody
                            font.bold: optionRow.current
                        }

                        Label {
                            Layout.fillWidth: true
                            visible: String(optionRow.modelData.detail || "").length > 0
                            text: String(optionRow.modelData.detail || "")
                            textFormat: Text.PlainText
                            elide: Text.ElideRight
                            color: popup.theme.muted
                            font.pixelSize: popup.theme.typeCaption
                        }
                    }

                    Item {
                        id: reorderHandle
                        visible: popup.reorderable
                        enabled: popup.reorderEnabled
                        Layout.preferredWidth: 26
                        Layout.preferredHeight: 26
                        Layout.alignment: Qt.AlignVCenter
                        Accessible.role: Accessible.Button
                        Accessible.name: "Move " + String(optionRow.modelData.label || "")
                        Accessible.description: enabled ? "Drag to reorder, or focus the list and press Ctrl+Shift+Up or Ctrl+Shift+Down" : "Clear the filter to reorder"

                        Label {
                            anchors.centerIn: parent
                            text: "≡"
                            color: reorderHandle.enabled ? popup.theme.foreground : popup.theme.muted
                            font.pixelSize: popup.theme.typeSubtitle
                            Accessible.ignored: true
                        }

                        HoverHandler {
                            cursorShape: reorderHandle.enabled ? Qt.OpenHandCursor : Qt.ArrowCursor
                        }

                        DragHandler {
                            id: reorderDrag
                            enabled: reorderHandle.enabled
                            target: null
                            xAxis.enabled: false
                            onActiveChanged: {
                                if (active) {
                                    popup.dragFromIndex = optionRow.index
                                    popup.dragTargetIndex = optionRow.index
                                } else {
                                    popup.finishDrag()
                                }
                            }
                            onTranslationChanged: if (active) popup.updateDragTarget(optionRow.index, optionRow.y + optionRow.height / 2 + translation.y)
                        }
                    }

                    StatusBadge {
                        visible: optionRow.current
                        theme: popup.theme
                        kind: "ok"
                        text: "current"
                        fontSize: 9
                        horizontalPadding: popup.theme.spaceMd
                        verticalPadding: popup.theme.spaceXxs
                        Layout.alignment: Qt.AlignVCenter
                    }
                }

                HoverHandler {
                    id: optionHover
                    cursorShape: Qt.PointingHandCursor
                }

                TapHandler {
                    id: optionTap
                    onTapped: popup.pickIndex(optionRow.index)
                }
            }
        }

        Label {
            Layout.fillWidth: true
            text: popup.visibleCount + " of " + popup.items.length + (popup.reorderable ? (popup.reorderEnabled ? " · Drag ≡ or Ctrl+Shift+↑/↓ to reorder" : " · Clear the filter to reorder") : "") + " · Enter or Space chooses · Escape closes"
            textFormat: Text.PlainText
            color: popup.theme.muted
            font.pixelSize: popup.theme.typeCaption
            elide: Text.ElideRight
        }
    }
}
