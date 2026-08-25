import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../components"

// Presents one queued extension request (select, confirm, input, editor) and answers it exactly
// once. Closing the dialog without an explicit answer cancels the request.
AppDialog {
    id: dialog

    required property var bridge
    property var request: null
    property bool answered: false
    readonly property string method: request ? String(request.method) : ""
    readonly property string requestId: request ? String(request.requestId) : ""
    readonly property var options: request && Array.isArray(request.options) ? request.options : []

    title: request ? request.title : ""
    message: request ? request.message : ""
    initialFocusItem: method === "select" ? optionList
        : method === "confirm" ? yesButton
        : method === "input" ? inputField
        : method === "editor" ? editorArea : cancelButton

    function present(nextRequest) {
        request = nextRequest
        answered = false
        inputField.text = ""
        editorArea.text = nextRequest && typeof nextRequest.prefill === "string" ? nextRequest.prefill : ""
        optionList.currentIndex = options.length > 0 ? 0 : -1
        open()
    }

    function submit(answer) {
        if (answered || !request) return false
        answered = true
        const accepted = bridge.answerDialog(requestId, answer)
        close()
        return accepted
    }

    function selectOption(value) {
        if (method !== "select" || options.indexOf(value) === -1) return false
        return submit({ "value": value })
    }

    function selectCurrent() {
        if (optionList.currentIndex < 0 || optionList.currentIndex >= options.length) return false
        return selectOption(options[optionList.currentIndex])
    }

    function confirm(value) {
        if (method !== "confirm") return false
        return submit({ "confirmed": value === true })
    }

    function submitText() {
        if (method === "input") return submit({ "value": inputField.text })
        if (method === "editor") return submit({ "value": editorArea.text })
        return false
    }

    function cancel() {
        if (answered || !request) return false
        return submit({ "cancelled": true })
    }

    function setInputText(value) {
        inputField.text = String(value)
    }

    function setEditorText(value) {
        editorArea.text = String(value)
    }

    onClosed: {
        if (!answered && request) {
            answered = true
            bridge.answerDialog(requestId, { "cancelled": true })
        }
        request = null
    }

    Label {
        Layout.fillWidth: true
        visible: request && request.timeoutMs > 0
        text: request && request.timeoutMs > 0 ? "This request expires after " + Math.round(request.timeoutMs / 1000) + " seconds" : ""
        textFormat: Text.PlainText
        color: dialog.theme.muted
        font.pixelSize: 11
    }

    ListView {
        id: optionList
        Layout.fillWidth: true
        Layout.preferredHeight: Math.min(contentHeight, 280)
        visible: dialog.method === "select"
        model: dialog.options
        clip: true
        keyNavigationEnabled: true
        keyNavigationWraps: true
        focus: visible
        activeFocusOnTab: true
        Accessible.role: Accessible.List
        Accessible.name: "Options"
        Keys.onReturnPressed: dialog.selectCurrent()
        Keys.onEnterPressed: dialog.selectCurrent()
        Keys.onSpacePressed: dialog.selectCurrent()

        delegate: Rectangle {
            id: optionRow
            required property int index
            required property var modelData
            width: optionList.width
            implicitHeight: optionLabel.implicitHeight + 16
            radius: 6
            color: ListView.isCurrentItem ? dialog.theme.selection : "transparent"
            border.width: ListView.isCurrentItem && optionList.activeFocus ? 2 : 0
            border.color: dialog.theme.focusRing
            Accessible.role: Accessible.ListItem
            Accessible.name: String(modelData)
            Accessible.focusable: true
            Accessible.selected: ListView.isCurrentItem

            Label {
                id: optionLabel
                anchors.fill: parent
                anchors.margins: 8
                text: String(optionRow.modelData)
                textFormat: Text.PlainText
                wrapMode: Text.Wrap
                color: dialog.theme.foreground
                font.pixelSize: 13
            }

            TapHandler {
                onTapped: {
                    optionList.currentIndex = optionRow.index
                    dialog.selectCurrent()
                }
            }
        }
    }

    TextField {
        id: inputField
        Layout.fillWidth: true
        visible: dialog.method === "input"
        placeholderText: dialog.request ? dialog.request.placeholder : ""
        color: dialog.theme.foreground
        placeholderTextColor: dialog.theme.muted
        selectionColor: dialog.theme.selection
        background: Rectangle {
            radius: 6
            color: dialog.theme.surfaceRaised
            border.width: inputField.activeFocus ? 2 : 1
            border.color: inputField.activeFocus ? dialog.theme.focusRing : dialog.theme.border
        }
        Accessible.role: Accessible.EditableText
        Accessible.name: dialog.title
        onAccepted: dialog.submitText()
    }

    ScrollView {
        Layout.fillWidth: true
        Layout.preferredHeight: 180
        visible: dialog.method === "editor"
        clip: true

        TextArea {
            id: editorArea
            wrapMode: TextEdit.Wrap
            textFormat: TextEdit.PlainText
            selectByMouse: true
            color: dialog.theme.foreground
            selectionColor: dialog.theme.selection
            background: Rectangle {
                radius: 6
                color: dialog.theme.surfaceRaised
                border.width: editorArea.activeFocus ? 2 : 1
                border.color: editorArea.activeFocus ? dialog.theme.focusRing : dialog.theme.border
            }
            Accessible.role: Accessible.EditableText
            Accessible.name: dialog.title
            Accessible.description: "Ctrl+Enter saves, Escape cancels"
            Keys.onPressed: event => {
                if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && (event.modifiers & Qt.ControlModifier)) {
                    dialog.submitText()
                    event.accepted = true
                }
            }
        }
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: 8

        Item { Layout.fillWidth: true }

        AppButton {
            id: cancelButton
            theme: dialog.theme
            text: dialog.method === "confirm" ? "No" : "Cancel"
            accessibleName: dialog.method === "confirm" ? "Answer no" : "Cancel request"
            onClicked: dialog.method === "confirm" ? dialog.confirm(false) : dialog.cancel()
        }

        AppButton {
            id: yesButton
            visible: dialog.method === "confirm"
            theme: dialog.theme
            variant: "primary"
            text: "Yes"
            accessibleName: "Answer yes"
            onClicked: dialog.confirm(true)
        }

        AppButton {
            visible: dialog.method === "select"
            theme: dialog.theme
            variant: "primary"
            text: "Choose"
            accessibleName: "Choose highlighted option"
            enabled: optionList.currentIndex >= 0
            onClicked: dialog.selectCurrent()
        }

        AppButton {
            visible: dialog.method === "input" || dialog.method === "editor"
            theme: dialog.theme
            variant: "primary"
            text: dialog.method === "editor" ? "Save" : "OK"
            accessibleName: dialog.method === "editor" ? "Save text" : "Submit value"
            onClicked: dialog.submitText()
        }
    }
}
