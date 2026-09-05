import QtQuick
import QtQuick.Controls
import QtTest
import "components"
import "dialogs"

Item {
    id: root
    width: 720
    height: 720

    Theme { id: theme }

    QtObject {
        id: extensionBridge
        property int answers: 0
        property int maxDialogValueCharacters: 16384
        function answerDialog(requestId, answer) {
            answers++
            return true
        }
        function updateDialogDraft(requestId, text) {}
    }

    QtObject {
        id: linkBridge
        property int opened: 0
        function openLink(url, callback) {
            opened++
            callback({ ok: true })
        }
    }

    QtObject {
        id: directoryBridge
        property int listCalls: 0
        function listDirectory(path, showHidden, callback) {
            listCalls++
            callback({ ok: true, data: { path: "/fixture", parent: "/", entries: [], recent: [], pinned: [] } })
        }
        function pinDirectory(path, callback) { callback({ ok: true, data: { pinned: [] } }) }
        function createDirectory(path, name, callback) { callback({ ok: false, error: { message: "unused" } }) }
    }

    Item {
        id: dropAnchor
        x: 360
        y: 580
        width: 120
        height: 28
    }

    CompletionPopup {
        id: completion
        x: 12
        y: 12
        width: 330
        theme: theme
        kind: "command"
        items: [{ label: "<completion-label>", detail: "/workspace/very/long/completion/path" }]
    }

    DropUpPicker {
        id: dropUp
        theme: theme
        boundsItem: root
        anchorItem: dropAnchor
        returnFocusItem: dropAnchor
        maximumWidth: 330
        maximumHeight: 260
    }

    TabStrip {
        id: tabStrip
        x: 12
        y: 94
        width: 680
        height: 48
        theme: theme
        homeDirectory: "/fixture"
        tabs: [{
            id: "tab-1",
            name: "<tab-selectable-title>",
            cwd: "/fixture/very/long/workspace/path",
            ready: true,
            active: false,
            activityState: "working",
            unread: 2,
            needsInput: 1,
            statusKind: "ok"
        }]
        activeTabId: "tab-1"
    }

    PickerDialog {
        id: picker
        theme: theme
    }

    ExtensionDialog {
        id: extension
        theme: theme
        bridge: extensionBridge
    }

    DirectoryDialog {
        id: directory
        theme: theme
        bridge: directoryBridge
    }

    LinkDialog {
        id: link
        theme: theme
        bridge: linkBridge
    }

    ConfirmDialog {
        id: confirm
        theme: theme
    }

    TextEdit {
        id: pasteSink
        x: 12
        y: 680
        width: 680
        height: 28
        textFormat: TextEdit.PlainText
        selectByMouse: true
        selectByKeyboard: true
    }

    SignalSpy { id: completionAccepted; target: completion; signalName: "accepted" }
    SignalSpy { id: dropUpPicked; target: dropUp; signalName: "picked" }
    SignalSpy { id: tabSelected; target: tabStrip; signalName: "selectRequested" }
    SignalSpy { id: pickerPicked; target: picker; signalName: "picked" }
    SignalSpy { id: confirmAccepted; target: confirm; signalName: "confirmed" }

    TestCase {
        name: "DialogSelectableText"
        when: windowShown

        function selectableWithText(item, text) {
            if (item && item.text === text && item.selectedText !== undefined) return item
            if (!item) return null
            if (item.contentItem && item.contentItem !== item) {
                const contentFound = selectableWithText(item.contentItem, text)
                if (contentFound) return contentFound
            }
            if (!item.children) return null
            for (const child of item.children) {
                const found = selectableWithText(child, text)
                if (found) return found
            }
            return null
        }

        function textEditWithText(item, text) {
            if (item && item.text === text && item.selectedText !== undefined && item.readOnly === true) return item
            if (!item) return null
            if (item.contentItem && item.contentItem !== item) {
                const contentFound = textEditWithText(item.contentItem, text)
                if (contentFound) return contentFound
            }
            if (!item.children) return null
            for (const child of item.children) {
                const found = textEditWithText(child, text)
                if (found) return found
            }
            return null
        }

        function editorFor(selectable) {
            const editor = selectable.childAt(Math.max(1, selectable.leftPadding + 1), Math.max(1, selectable.topPadding + 1))
            verify(editor !== null, "selectable text must render through a native editor")
            return editor
        }

        function copySelectable(selectable) {
            const editor = editorFor(selectable)
            editor.forceActiveFocus()
            keyClick(Qt.Key_A, Qt.ControlModifier)
            compare(selectable.selectedText, selectable.text, "Ctrl+A must select the exact PlainText source")
            keyClick(Qt.Key_C, Qt.ControlModifier)
            pasteSink.text = ""
            pasteSink.forceActiveFocus()
            keyClick(Qt.Key_V, Qt.ControlModifier)
            compare(pasteSink.text, selectable.text, "Ctrl+C must paste the exact source into a test-only editable sink")
        }

        function copyReadOnlyEditor(editor, source) {
            editor.forceActiveFocus()
            keyClick(Qt.Key_A, Qt.ControlModifier)
            compare(editor.selectedText, source)
            keyClick(Qt.Key_C, Qt.ControlModifier)
            pasteSink.text = ""
            pasteSink.forceActiveFocus()
            keyClick(Qt.Key_V, Qt.ControlModifier)
            compare(pasteSink.text, source, "native Ctrl+C must round-trip through the paste sink")
        }

        function dragSelect(selectable) {
            const y = Math.max(2, Math.floor(selectable.height / 2))
            mousePress(selectable, 3, y)
            mouseMove(selectable, Math.max(6, Math.floor(selectable.width - 3)), y, 100)
            mouseRelease(selectable, Math.max(6, Math.floor(selectable.width - 3)), y)
            verify(selectable.selectedText.length > 0, "a text drag must create a native selection")
        }

        function closeAll() {
            if (picker.opened) picker.close()
            if (extension.opened) extension.close()
            if (directory.opened) directory.close()
            if (link.opened) link.close()
            if (confirm.opened) confirm.close()
            if (dropUp.opened) dropUp.close()
            wait(30)
        }

        function init() {
            closeAll()
            completionAccepted.clear()
            dropUpPicked.clear()
            tabSelected.clear()
            pickerPicked.clear()
            confirmAccepted.clear()
            extensionBridge.answers = 0
            directoryBridge.listCalls = 0
            linkBridge.opened = 0
            pasteSink.text = ""
        }

        function test_selectableDialogAndInteractiveRows_data() {
            return [{ tag: "dark", mode: "dark" }, { tag: "light", mode: "light" }]
        }

        function test_selectableDialogAndInteractiveRows(data) {
            theme.requestedMode = data.mode

            const completionLabel = selectableWithText(completion, "<completion-label>")
            verify(completionLabel !== null)
            copySelectable(completionLabel)
            dragSelect(completionLabel)
            compare(completionAccepted.count, 0, "completion selection must not accept a result")
            mouseClick(completionLabel, 4, Math.max(2, completionLabel.height / 2))
            compare(completionAccepted.count, 1, "a normal completion click must accept once")

            const tabTitle = selectableWithText(tabStrip, "<tab-selectable-title>")
            verify(tabTitle !== null)
            copySelectable(tabTitle)
            dragSelect(tabTitle)
            compare(tabSelected.count, 0, "tab title selection must not select a tab")
            mouseClick(tabTitle, 4, Math.max(2, tabTitle.height / 2))
            compare(tabSelected.count, 1, "a normal tab click must select once")

            picker.present({
                title: "<picker-title>",
                message: "<picker-message>",
                items: [{ label: "<picker-option>", detail: "/fixture/picker/detail", current: true }]
            })
            wait(50)
            const pickerTitle = selectableWithText(picker, "<picker-title>")
            const pickerOption = selectableWithText(picker, "<picker-option>")
            verify(pickerTitle !== null)
            verify(pickerOption !== null)
            copySelectable(pickerTitle)
            copySelectable(pickerOption)
            dragSelect(pickerOption)
            compare(pickerPicked.count, 0, "picker selection must not choose an option")
            mouseClick(pickerOption, 4, Math.max(2, pickerOption.height / 2))
            compare(pickerPicked.count, 1, "a normal picker click must choose once")

            extension.present({
                requestId: "extension-request",
                method: "select",
                title: "<extension-title>",
                message: "<extension-message>",
                placeholder: "",
                options: ["<extension-option>"]
            })
            wait(50)
            const extensionTitle = selectableWithText(extension, "<extension-title>")
            const extensionOption = selectableWithText(extension, "<extension-option>")
            verify(extensionTitle !== null)
            verify(extensionOption !== null)
            copySelectable(extensionTitle)
            dragSelect(extensionOption)
            compare(extensionBridge.answers, 0, "extension option selection must not submit an answer")
            mouseClick(extensionOption, 4, Math.max(2, extensionOption.height / 2))
            compare(extensionBridge.answers, 1, "a normal extension option click must submit once")
            extension.close()
            wait(30)

            confirm.present({
                title: "<confirm-title>",
                message: "<confirm-message>",
                detail: "<confirm-detail>"
            })
            wait(50)
            const confirmDetail = selectableWithText(confirm, "<confirm-detail>")
            verify(confirmDetail !== null)
            copySelectable(confirmDetail)
            dragSelect(confirmDetail)
            compare(confirmAccepted.count, 0, "confirmation detail selection must not confirm")
            confirm.close()
            wait(30)

            directory.currentPath = "/fixture"
            directory.entries = [{ name: "<directory-selectable-entry>", path: "/fixture/entry", git: false, hidden: false }]
            directory.open()
            wait(50)
            const directoryEntry = selectableWithText(directory, "<directory-selectable-entry>")
            verify(directoryEntry !== null)
            copySelectable(directoryEntry)
            dragSelect(directoryEntry)
            compare(directoryBridge.listCalls, 0, "directory text selection must not navigate")
            mouseClick(directoryEntry, 4, Math.max(2, directoryEntry.height / 2))
            mouseClick(directoryEntry, 4, Math.max(2, directoryEntry.height / 2))
            compare(directoryBridge.listCalls, 0, "double-click word selection must not navigate into a directory")
            directory.close()
            wait(30)

            link.present("https://example.test/<link-address>")
            wait(50)
            const linkAddress = textEditWithText(link, "https://example.test/<link-address>")
            verify(linkAddress !== null)
            copyReadOnlyEditor(linkAddress, "https://example.test/<link-address>")
            link.close()
            wait(30)

            dropUp.present({
                title: "<drop-up-title>",
                message: "<drop-up-message>",
                searchable: false,
                items: [{ label: "<drop-up-option>", detail: "/fixture/drop-up/detail", value: "drop-up" }]
            })
            wait(50)
            const dropUpTitle = selectableWithText(dropUp, "<drop-up-title>")
            const dropUpOption = selectableWithText(dropUp, "<drop-up-option>")
            verify(dropUpTitle !== null)
            verify(dropUpOption !== null)
            copySelectable(dropUpTitle)
            dragSelect(dropUpOption)
            compare(dropUpPicked.count, 0, "drop-up selection must not pick an option")
            mouseClick(dropUpOption, 4, Math.max(2, dropUpOption.height / 2))
            compare(dropUpPicked.count, 1, "a normal drop-up click must pick once")
        }
    }
}
