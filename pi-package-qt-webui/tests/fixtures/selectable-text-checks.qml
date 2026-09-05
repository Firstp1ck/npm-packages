import QtQuick
import QtQuick.Controls
import QtTest

Item {
    width: 540
    height: 760

    Theme { id: theme }

    SelectableText {
        id: clippedText
        x: 12
        y: 12
        width: 156
        theme: theme
        text: "<path>/left/middle/right/very-long-selectable-value</path>"
        color: theme.foreground
        font.family: theme.monospaceFamily
        font.pixelSize: theme.typeBody
        wrapMode: TextEdit.NoWrap
        horizontalAlignment: TextEdit.AlignLeft
        leftPadding: 6
        rightPadding: 8
    }

    SelectableText {
        id: wrappedText
        x: 12
        y: 54
        width: 176
        theme: theme
        text: "A wrapped selectable status detail keeps its complete original source even when its visible field is bounded."
        color: theme.muted
        font.family: theme.monospaceFamily
        font.pixelSize: theme.typeBody
        wrapMode: TextEdit.Wrap
        maximumLineCount: 2
        horizontalAlignment: TextEdit.AlignRight
        topPadding: 3
        bottomPadding: 5
    }

    SessionList {
        id: workspaces
        x: 12
        y: 150
        width: 420
        height: 590
        theme: theme
    }

    SignalSpy { id: opened; target: workspaces; signalName: "sessionRequested" }
    SignalSpy { id: settled; target: workspaces; signalName: "settlementRequested" }
    SignalSpy { id: closed; target: workspaces; signalName: "closeRequested" }

    TestCase {
        name: "SelectableText"
        when: windowShown

        function editorFor(selectable) {
            const editor = selectable.childAt(selectable.leftPadding + 2, selectable.topPadding + 2)
            verify(editor !== null, "selectable text must expose its editor over the actual text geometry")
            return editor
        }

        function selectableWithText(item, text) {
            if (item && item.text === text && item.selectedText !== undefined) return item
            for (const child of item.children) {
                const found = selectableWithText(child, text)
                if (found) return found
            }
            return null
        }

        function controlWithText(item, text) {
            if (item && item.text === text && item.selectedText === undefined && item.accessibleName !== undefined) return item
            for (const child of item.children) {
                const found = controlWithText(child, text)
                if (found) return found
            }
            return null
        }

        function resetWorkspaces() {
            workspaces.sessions = [{
                id: "selection-session",
                path: "/fixture/selection-session.jsonl",
                name: "A long workspace title that remains selectable without an ellipsis",
                cwd: "/fixture/project/with/a/long/path",
                openTabId: "tab-selection",
                settled: false,
                modified: Date.now() - 60 * 60 * 1000
            }]
            workspaces.tabs = [{
                id: "tab-selection",
                name: "Selection tab",
                active: false,
                ready: true,
                statusKind: "ok",
                statusText: "Ready",
                activityState: "idle",
                needsInput: 0,
                sessionFile: "/fixture/selection-session.jsonl",
                cwd: "/fixture/project/with/a/long/path"
            }]
            workspaces.settledExpanded = true
            workspaces.forceActiveFocus()
            wait(100)
            workspaces.testWorking.forceLayout()
            compare(workspaces.testWorking.count, 1)
            opened.clear()
            settled.clear()
            closed.clear()
        }

        function init() {
            theme.requestedMode = "dark"
            clippedText.width = 156
            wrappedText.width = 176
            resetWorkspaces()
        }

        function test_plainTextSelectionAndCopy_data() {
            return [
                { tag: "dark left", mode: "dark", source: "<left>one-line clipped source remains directly selectable</left>" },
                { tag: "dark middle", mode: "dark", source: "<middle>one-line clipped source remains directly selectable</middle>" },
                { tag: "dark right", mode: "dark", source: "<right>one-line clipped source remains directly selectable</right>" },
                { tag: "light left", mode: "light", source: "<left>one-line clipped source remains directly selectable</left>" },
                { tag: "light middle", mode: "light", source: "<middle>one-line clipped source remains directly selectable</middle>" },
                { tag: "light right", mode: "light", source: "<right>one-line clipped source remains directly selectable</right>" }
            ]
        }

        function test_plainTextSelectionAndCopy(data) {
            theme.requestedMode = data.mode
            clippedText.text = data.source
            const editor = editorFor(clippedText)
            compare(editor.textFormat, TextEdit.PlainText)
            compare(editor.readOnly, true)
            compare(editor.wrapMode, TextEdit.NoWrap, "one-line fields clip rather than elide through a second layout")
            compare(editor.selectionColor, theme.selection)
            compare(editor.selectedTextColor, theme.selectionForeground)
            compare(editor.x, clippedText.leftPadding)
            compare(editor.width, clippedText.width - clippedText.leftPadding - clippedText.rightPadding)
            editor.forceActiveFocus()
            keyClick(Qt.Key_A, Qt.ControlModifier)
            compare(clippedText.selectedText, clippedText.text, "Ctrl+A must select the exact HTML-like source as plain text")
            keyClick(Qt.Key_C, Qt.ControlModifier)
            compare(clippedText.selectedText, clippedText.text, "Ctrl+C must retain the native editor selection for copying")
            mousePress(clippedText, clippedText.leftPadding + 2, 8)
            mouseMove(clippedText, clippedText.width - clippedText.rightPadding - 4, 8, 80)
            mouseRelease(clippedText, clippedText.width - clippedText.rightPadding - 4, 8)
            verify(clippedText.selectedText.length > 0)
            verify(clippedText.text.indexOf(clippedText.selectedText) !== -1)
        }

        function test_resizeAndBoundedWrappedSelection() {
            const clippedEditor = editorFor(clippedText)
            clippedText.width = 92
            wait(20)
            compare(clippedEditor.width, 78)
            clippedText.width = 260
            wait(20)
            compare(clippedEditor.width, 246)

            const wrappedEditor = editorFor(wrappedText)
            compare(wrappedEditor.textFormat, TextEdit.PlainText)
            verify(wrappedEditor.contentHeight > wrappedEditor.height, "maximumLineCount must bound the rendered field by clipping")
            compare(wrappedEditor.y, wrappedText.topPadding)
            compare(wrappedEditor.height, wrappedText.height - wrappedText.topPadding - wrappedText.bottomPadding)
            wrappedEditor.forceActiveFocus()
            keyClick(Qt.Key_A, Qt.ControlModifier)
            compare(wrappedText.selectedText, wrappedText.text)
            keyClick(Qt.Key_C, Qt.ControlModifier)
            compare(wrappedText.selectedText, wrappedText.text)
        }

        function test_textClickAndBlankRowClickOpenExactlyOnce() {
            const row = workspaces.testWorking.currentItem
            const title = selectableWithText(row, "A long workspace title that remains selectable without an ellipsis")
            verify(title !== null)
            mouseClick(title, 8, Math.max(2, title.height / 2))
            compare(opened.count, 1, "a normal text click must activate the row exactly once")
            opened.clear()
            mouseClick(row, 2, row.height / 2)
            compare(opened.count, 1, "a normal blank-row click must activate the row exactly once")
        }

        function test_textDragSelectsWithoutOpening() {
            const row = workspaces.testWorking.currentItem
            const title = selectableWithText(row, "A long workspace title that remains selectable without an ellipsis")
            verify(title !== null)
            mousePress(title, 4, Math.max(2, title.height / 2))
            mouseMove(title, Math.min(title.width - 2, 150), Math.max(2, title.height / 2), 100)
            mouseRelease(title, Math.min(title.width - 2, 150), Math.max(2, title.height / 2))
            verify(title.selectedText.length > 0, "a title drag must create a native selection")
            compare(opened.count, 0, "a title drag must not activate the row")
        }

        function test_rowControlsRemainIndependent() {
            const row = workspaces.testWorking.currentItem
            const settleButton = controlWithText(row, "Settle")
            const closeButton = controlWithText(row, "×")
            verify(settleButton !== null)
            verify(closeButton !== null)
            mouseClick(settleButton, settleButton.width / 2, settleButton.height / 2)
            compare(settled.count, 1, "Settle must emit only its own action")
            compare(opened.count, 0, "Settle must not open the row")
            mouseClick(closeButton, closeButton.width / 2, closeButton.height / 2)
            compare(closed.count, 1, "Close must emit only its own action")
            compare(opened.count, 0, "Close must not open the row")
        }
    }
}
