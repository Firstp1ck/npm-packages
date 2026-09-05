import QtQuick
import QtQuick.Controls
import QtTest

Item {
    width: 860
    height: 760
    Theme { id: theme }
    ToolCard {
        id: card
        x: 10
        y: 10
        width: 800
        theme: theme
    }
    SignalSpy { id: copied; target: card; signalName: "copyRequested" }

    TestCase {
        name: "CompactToolRows"
        when: windowShown

        function find(item, predicate) {
            if (predicate(item)) return item
            for (const child of item.children) {
                const match = find(child, predicate)
                if (match) return match
            }
            return null
        }

        function button(prefix) {
            return find(card, item => item.accessibleName !== undefined && item.accessibleName.indexOf(prefix) === 0)
        }

        function init() {
            card.width = 800
            card.expanded = false
            card.compact = false
            card.toolName = "read"
            card.toolStatus = "ok"
            card.toolDurationMs = 1234
            card.toolSummary = "Read /fixture/file.txt"
            card.toolError = ""
            card.toolOutput = "<b>literal output</b>\nsecond line\n"
            copied.clear()
            wait(30)
        }

        function test_one_line_data() {
            return [
                { tag: "light-detailed", mode: "light", compact: false },
                { tag: "dark-compact", mode: "dark", compact: true },
                { tag: "dark-detailed", mode: "dark", compact: false },
                { tag: "light-compact", mode: "light", compact: true }
            ]
        }

        function test_one_line(data) {
            theme.requestedMode = data.mode
            card.compact = data.compact
            card.width = 320
            card.toolName = "a_very_long_tool_name_that_must_not_wrap\nor_grow_the_header"
            wait(30)
            const expand = button("Expand")
            const copy = button("Copy")
            verify(expand !== null && copy !== null)
            compare(card.height, theme.controlHeight + theme.spaceXs * 2)
            const origin = expand.mapToItem(card, 0, 0)
            const copyOrigin = copy.mapToItem(card, 0, 0)
            compare(origin.y, copyOrigin.y)
            verify(copyOrigin.x + copy.width <= card.width)
            verify(copyOrigin.x > origin.x + expand.width)
            const summary = findChild(card, "expandedToolSummary")
            const output = find(card, item => item.text === card.toolOutput)
            verify(!summary.visible && !output.visible)
            mouseClick(copy)
            compare(copied.count, 1)
            compare(copied.signalArguments[0][0], card.toolOutput)
            verify(!card.expanded)
            const collapsedHeight = card.height
            mouseClick(expand)
            tryCompare(card, "expanded", true)
            tryVerify(() => card.height > collapsedHeight)
            verify(summary.visible && output.visible)
            compare(expand.text, "▾")
            expand.forceActiveFocus()
            keyClick(Qt.Key_Space)
            tryCompare(card, "expanded", false)
            tryCompare(card, "height", collapsedHeight)
            keyClick(Qt.Key_Space)
            tryCompare(card, "expanded", true)
            keyClick(Qt.Key_Tab)
            verify(copy.activeFocus)
            keyClick(Qt.Key_Space)
            compare(copied.count, 2)
        }

        function test_inline_summary_data() {
            return [{ tag: "light", mode: "light" }, { tag: "dark", mode: "dark" }]
        }

        function test_inline_summary(data) {
            theme.requestedMode = data.mode
            card.toolSummary = "path=/fixture/a-long-directory/file.txt\n  offset=120\tlimit=80 <b>plain text</b> " + "detail ".repeat(40)
            const summary = findChild(card, "inlineToolSummary")
            const name = findChild(card, "toolNameLabel")
            const expandedSummary = findChild(card, "expandedToolSummary")
            wait(30)
            verify(summary.visible)
            verify(!expandedSummary.visible)
            compare(summary.text, card.toolSummary.replace(/\s+/g, " ").trim())
            compare(summary.color, theme.muted)
            compare(name.color, theme.foreground)
            compare(summary.x, name.width + theme.spaceSm)
            compare(summary.width, summary.parent.width - summary.x)
            compare(name.width, name.implicitWidth)
            const editor = find(summary, item => item.readOnly === true)
            verify(editor !== null)
            compare(editor.textFormat, TextEdit.PlainText)
            compare(editor.wrapMode, TextEdit.NoWrap)
            verify(editor.clip && editor.contentWidth > editor.width)
            const dots = findChild(card, "inlineToolSummaryDots")
            verify(summary.truncated && dots.visible)
            compare(dots.text, "...")
            compare(dots.color, theme.muted)
            compare(dots.x + dots.width, summary.width)
            compare(editor.width + dots.width, summary.width)
            editor.selectAll()
            compare(editor.selectedText, summary.text)
            verify(!card.expanded)
            editor.deselect()
            const wideWidth = summary.width
            const collapsedHeight = card.height
            card.width = 380
            wait(30)
            verify(summary.width > 0 && summary.width < wideWidth)
            compare(card.height, collapsedHeight)
            compare(name.width, name.implicitWidth)
            verify(dots.visible)
            compare(editor.width + dots.width, summary.width)
            const copy = button("Copy")
            verify(copy.mapToItem(card, 0, 0).x + copy.width <= card.width)
            card.width = 1000
            wait(30)
            verify(summary.width > wideWidth)
            card.toolSummary = "command=git status"
            tryCompare(summary, "text", "command=git status")
            tryCompare(dots, "visible", false)
            compare(summary.rightPadding, 0)
            compare(editor.width, summary.width)
            card.width = 320
            tryCompare(dots, "visible", true)
            card.width = 1000
            tryCompare(dots, "visible", false)
            compare(card.height, collapsedHeight)
            card.toolStatus = "running"
            wait(30)
            const runningWidth = summary.width
            card.toolStatus = "error"
            wait(30)
            verify(summary.width < runningWidth)
            theme.requestedMode = data.mode === "dark" ? "light" : "dark"
            wait(30)
            compare(summary.color, theme.muted)
            card.width = 320
            card.toolName = "long_tool_name_".repeat(20)
            wait(30)
            compare(summary.width, 0)
            verify(!summary.visible)
            compare(card.height, collapsedHeight)
            card.toolName = "read"
            card.toolSummary = " \n\t "
            tryCompare(summary, "visible", false)
            card.toolSummary = "path=restored.txt"
            tryCompare(summary, "visible", true)
        }

        function test_running_updates_and_errors() {
            card.toolStatus = "running"
            card.toolOutput = ""
            const expand = button("Expand")
            const copy = button("Copy")
            verify(!copy.enabled)
            const collapsedHeight = card.height
            card.toolOutput = "partial"
            tryCompare(copy, "enabled", true)
            compare(card.height, collapsedHeight)
            mouseClick(expand)
            card.toolOutput = "final output\nnew line"
            wait(30)
            mouseClick(copy)
            compare(copied.signalArguments[0][0], card.toolOutput)
            verify(card.expanded)
            card.toolStatus = "error"
            card.toolError = "Something failed\nError detail"
            wait(30)
            mouseClick(expand)
            tryCompare(card, "expanded", false)
            tryCompare(card, "height", collapsedHeight)
            compare(card.statusLabel, "Failed")
            const error = find(card, item => item.text === card.toolError)
            verify(!error.visible)
            card.toolOutput = ""
            tryCompare(copy, "enabled", false)
            mouseClick(expand)
            verify(error.visible)
            verify(!copy.enabled)
        }

        function test_empty_call() {
            card.toolSummary = ""
            card.toolOutput = ""
            card.toolStatus = "running"
            verify(!button("Expand").enabled)
            verify(!button("Copy").enabled)
            compare(card.height, theme.controlHeight + theme.spaceXs * 2)
        }
    }
}
