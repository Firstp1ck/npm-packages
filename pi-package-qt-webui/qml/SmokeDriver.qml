import QtQuick

// Deterministic smoke scenario used only when QT_WEBUI_SMOKE_MODE=1. It drives the real UI
// objects (bridge, dialogs, search, settings) against the fake Pi fixture behind the real
// backend and prints markers that tests/qml-smoke.test.mjs asserts on.
Item {
    id: driver

    required property var bridge
    required property var shell
    property string phase: "boot"
    property string nextAction: ""
    property bool forceUnfocused: false
    property bool piReadyOnce: false
    property bool backendReadyOnce: false
    property int dialogsAnswered: 0
    property bool streamRunEnded: false
    property bool linkConfirmed: false
    property bool searchChecked: false
    property bool notificationChecked: false
    property bool crashObserved: false
    property string modelStep: ""

    function log(marker) {
        console.log(marker)
    }

    function fail(reason) {
        log("QT_WEBUI_SMOKE_FAILURE " + reason)
        const rows = []
        for (let index = 0; index < bridge.transcriptModel.count; index++) {
            const row = bridge.transcriptModel.get(index)
            rows.push(row.kind + ":" + row.rowId + ":" + (row.streaming ? "streaming:" : "") + JSON.stringify(String(row.text).slice(0, 40)) + ":" + row.toolStatus)
        }
        log("QT_WEBUI_SMOKE_ROWS " + rows.join(" | "))
        bridge.showError("Smoke failure: " + reason)
    }

    function schedule(action) {
        nextAction = action
        actionTimer.start()
    }

    function lastRowOfKind(kind) {
        for (let index = bridge.transcriptModel.count - 1; index >= 0; index--) {
            const row = bridge.transcriptModel.get(index)
            if (row.kind === kind) return row
        }
        return null
    }

    function findRowContaining(kind, needle) {
        for (let index = bridge.transcriptModel.count - 1; index >= 0; index--) {
            const row = bridge.transcriptModel.get(index)
            if (row.kind === kind && row.text.indexOf(needle) !== -1) return row
        }
        return null
    }

    function answerDialog(dialog) {
        if (!dialog || !dialog.request) return
        if (dialog.focusedOnOpen && dialogsAnswered === 0) log("QT_WEBUI_SMOKE_DIALOG_FOCUS")
        const id = dialog.requestId
        let accepted = false
        if (id === "dialog-select") accepted = dialog.selectOption("Block")
        else if (id === "dialog-confirm") accepted = dialog.confirm(true)
        else if (id === "dialog-input") {
            shell.extensionDialogInputText("typed value")
            accepted = dialog.submitText()
        } else if (id === "dialog-editor") {
            shell.extensionDialogEditorText("Line 1\nLine 2\nLine 3")
            accepted = dialog.submitText()
        } else if (id === "dialog-cancel") accepted = dialog.cancel()
        if (!accepted) fail("dialog " + id + " was not accepted")
        dialogsAnswered++
        if (dialog.submit({ "cancelled": true })) fail("dialog " + id + " accepted a second answer")
        maybeAdvanceFromStream()
    }

    // The fixture settles the run while dialogs may still be queued; advance once both are done.
    function maybeAdvanceFromStream() {
        if (phase !== "stream" || !streamRunEnded || dialogsAnswered < 5) return
        if (dialogsAnswered !== 5) return fail("expected 5 dialogs, saw " + dialogsAnswered)
        log("QT_WEBUI_SMOKE_AGENT_SETTLED")
        schedule("markdown")
    }

    function checkStreamPhase() {
        const text = lastRowOfKind("text")
        if (!text || text.text !== "authoritative final" || text.streaming) return fail("stream reconciliation")
        log("QT_WEBUI_SMOKE_STREAM_RECONCILED")
        const thinking = lastRowOfKind("thinking")
        if (!thinking || thinking.text !== "thinking about it") return fail("thinking row")
        log("QT_WEBUI_SMOKE_THINKING_RENDERED")
        const tool = lastRowOfKind("tool")
        if (!tool || tool.toolStatus !== "ok" || tool.toolName !== "<b>read</b>" || tool.toolDurationMs < 0 || tool.toolOutput !== "final tool output") return fail("tool card")
        log("QT_WEBUI_SMOKE_TOOL_CARD")
        streamRunEnded = true
        maybeAdvanceFromStream()
    }

    function checkMarkdownPhase() {
        const row = findRowContaining("text", "Heading one")
        if (!row) return fail("markdown row missing")
        let blocks = []
        try { blocks = JSON.parse(row.blocksJson) } catch (error) { return fail("blocks json") }
        const types = blocks.map(block => block.type)
        const styled = JSON.stringify(blocks.filter(block => block.type !== "code"))
        if (types.indexOf("heading") === -1 || types.indexOf("code") === -1 || types.indexOf("table") === -1 || types.indexOf("listItem") === -1) return fail("markdown block types " + types.join(","))
        if (styled.indexOf("&lt;script&gt;") === -1 || styled.indexOf("<img") !== -1 || styled.indexOf("javascript:alert(1))\"") !== -1) return fail("markdown escaping")
        if (styled.indexOf("<a href=\\\"https://example.com/docs\\\">") === -1) return fail("markdown safe link")
        log("QT_WEBUI_SMOKE_MARKDOWN_RENDERED")
        shell.confirmLink("https://example.com/docs")
        schedule("accept-link")
    }

    function checkSearch() {
        shell.openSearch("heading one")
        if (shell.searchMatchCount < 1) return fail("search matches " + shell.searchMatchCount)
        shell.searchNext()
        if (shell.searchCurrentRow < 0) return fail("search current row")
        const text = bridge.transcriptModel.get(shell.searchCurrentRow).text
        if (text.toLowerCase().indexOf("heading one") === -1) return fail("search original text")
        log("QT_WEBUI_SMOKE_SEARCH_MATCHED")
        shell.closeSearch()
        searchChecked = true
        forceUnfocused = true
        schedule("immediate")
    }

    // Models phase: open the real picker from the model inventory, pick through its own entry
    // points, cycle both values, then compact. Each step waits for the bridge state it changes.
    function startModels() {
        phase = "models"
        modelStep = "picker"
        if (!shell.openModelPicker()) return fail("model picker request refused")
    }

    function checkModelPicker() {
        const picker = shell.pickerDialog
        if (!picker.opened || picker.items.length !== 3) return fail("model picker items " + picker.items.length)
        if (picker.items[0].current !== true) return fail("current model not marked")
        picker.setFilter("fast")
        if (picker.visibleCount !== 1) return fail("model filter " + picker.visibleCount)
        log("QT_WEBUI_SMOKE_MODEL_PICKER")
        modelStep = "select"
        if (!picker.pickCurrent()) return fail("model pick refused")
    }

    function onModelRuntimeChanged() {
        if (phase !== "models") return
        if (modelStep === "select" && bridge.currentModelId === "fixture-fast" && bridge.currentThinkingLevel === "off") {
            log("QT_WEBUI_SMOKE_MODEL_SELECTED")
            modelStep = "thinking-picker"
            if (!shell.openThinkingPicker()) fail("thinking picker request refused")
        } else if (modelStep === "cycle-model" && bridge.currentModelId === "other-model") {
            log("QT_WEBUI_SMOKE_MODEL_CYCLED")
            modelStep = "cycle-thinking"
            if (!bridge.cycleThinkingLevel()) fail("thinking cycle refused")
        } else if (modelStep === "cycle-thinking" && bridge.currentThinkingLevel === "minimal") {
            log("QT_WEBUI_SMOKE_THINKING_CYCLED")
            modelStep = "compact"
            if (!shell.compactContext()) fail("compaction refused")
        }
    }

    function checkThinkingPicker() {
        const picker = shell.pickerDialog
        if (!picker.opened || picker.items.length !== 1 || picker.items[0].value !== "off" || picker.items[0].current !== true) return fail("thinking picker for a model without thinking")
        log("QT_WEBUI_SMOKE_THINKING_PICKER")
        modelStep = "cycle-model"
        // Picking the current level closes the picker; the bridge treats it as a no-op.
        if (!picker.pickValue("off") || picker.opened) return fail("thinking pick did not close the picker")
        if (!bridge.cycleModel()) fail("model cycle refused")
    }

    Timer {
        id: actionTimer
        interval: 40
        repeat: false
        onTriggered: {
            const action = driver.nextAction
            driver.nextAction = ""
            switch (action) {
            case "stream":
                driver.phase = "stream"
                driver.bridge.sendPrompt("__QT_WEBUI_STREAM__", "send")
                break
            case "markdown":
                driver.phase = "markdown"
                driver.bridge.sendPrompt("__QT_WEBUI_MARKDOWN__", "send")
                break
            case "accept-link":
                if (!driver.shell.linkDialogOpened) return driver.fail("link dialog did not open")
                driver.shell.acceptLink()
                break
            case "search":
                driver.checkSearch()
                break
            case "immediate":
                driver.phase = "immediate"
                driver.bridge.sendPrompt("__QT_WEBUI_IMMEDIATE__", "send")
                break
            case "provider-error":
                driver.phase = "provider-error"
                driver.bridge.sendPrompt("__QT_WEBUI_PROVIDER_ERROR__", "send")
                break
            case "failure":
                driver.phase = "failure"
                driver.bridge.sendPrompt("__QT_WEBUI_FAIL__", "send")
                break
            case "abort":
                driver.phase = "abort"
                driver.bridge.sendPrompt("__QT_WEBUI_DELAYED_ABORT__", "send")
                driver.schedule("abort-before-start")
                break
            case "abort-before-start":
                driver.bridge.abortRun()
                break
            case "limits":
                driver.phase = "limits"
                driver.bridge.sendPrompt("__QT_WEBUI_LIMITS__", "send")
                break
            case "settings":
                driver.phase = "settings"
                driver.bridge.updateSetting("compactTranscript", true)
                break
            case "models":
                driver.startModels()
                break
            case "check-model-picker":
                driver.checkModelPicker()
                break
            case "check-thinking-picker":
                driver.checkThinkingPicker()
                break
            case "exit":
                driver.phase = "exit"
                driver.bridge.sendPrompt("__QT_WEBUI_EXIT__", "send")
                break
            case "restart-failed":
                driver.phase = "restart-failed"
                driver.bridge.restartProcess()
                break
            case "restart-missing":
                driver.phase = "restart-missing"
                driver.bridge.restartProcess()
                break
            case "restart-recovered":
                driver.phase = "restart-recovered"
                driver.bridge.restartProcess()
                break
            case "backend-crash":
                driver.phase = "backend-crash"
                driver.bridge.request("debug_crash", {}, () => {})
                break
            case "backend-restart":
                driver.phase = "backend-restart"
                driver.bridge.restartProcess()
                break
            case "quit":
                driver.log("QT_WEBUI_SMOKE_COMPLETE")
                driver.bridge.shutdown()
                break
            default:
                break
            }
        }
    }

    Connections {
        target: driver.bridge

        function onBackendBecameReady() {
            if (!driver.backendReadyOnce) {
                driver.backendReadyOnce = true
                driver.log("QT_WEBUI_SMOKE_BACKEND_READY")
            } else if (driver.phase === "backend-restart") {
                driver.log("QT_WEBUI_SMOKE_BACKEND_RESTARTED")
            }
        }

        function onBackendExited(exitCode) {
            if (driver.phase === "backend-crash" && exitCode === 70) {
                driver.crashObserved = true
                driver.log("QT_WEBUI_SMOKE_BACKEND_CRASH_OBSERVED")
                driver.schedule("backend-restart")
            } else {
                driver.fail("unexpected backend exit " + exitCode)
            }
        }

        function onReadyChanged() {
            if (!driver.bridge.ready) return
            if (!driver.piReadyOnce) {
                driver.piReadyOnce = true
                driver.log("QT_WEBUI_SMOKE_READY")
                driver.schedule("stream")
            } else if (driver.phase === "restart-recovered") {
                driver.log("QT_WEBUI_SMOKE_RESTART_RECEIPT")
                driver.schedule("backend-crash")
            } else if (driver.phase === "backend-restart") {
                driver.log("QT_WEBUI_SMOKE_BACKEND_CRASH_RECOVERED")
                driver.schedule("quit")
            }
        }

        function onActiveChanged() {
            if (driver.phase === "immediate" && !driver.bridge.active && driver.bridge.statusKind === "ready") {
                driver.log("QT_WEBUI_SMOKE_IMMEDIATE_PROMPT_RECONCILED")
                driver.phase = "immediate-done"
                driver.schedule("provider-error")
            }
        }

        function onVisibleErrorChanged() {
            const error = driver.bridge.visibleError
            if (driver.phase === "failure" && error === "deterministic prompt rejection") {
                driver.log("QT_WEBUI_SMOKE_FAILED_RESPONSE_RECOVERED")
                driver.phase = "failure-done"
                driver.schedule("abort")
            } else if (driver.phase === "restart-failed" && error === "deterministic startup state failure") {
                driver.log("QT_WEBUI_SMOKE_FAILED_STATE_RECOVERABLE")
                driver.schedule("restart-missing")
            } else if (driver.phase === "restart-missing" && error === "Pi did not report readiness in time") {
                driver.log("QT_WEBUI_SMOKE_MISSING_STATE_RECOVERABLE")
                driver.schedule("restart-recovered")
            }
        }

        function onStatusTextChanged() {
            const text = driver.bridge.statusText
            if (driver.phase === "exit" && text === "Pi exited (23)") {
                driver.phase = "exit-done"
                driver.schedule("restart-failed")
            } else if (driver.phase === "restart-failed" && text === "Starting…") {
                driver.log("QT_WEBUI_SMOKE_FAILED_STATE_RESTART")
            } else if (driver.phase === "restart-missing" && text === "Starting…") {
                driver.log("QT_WEBUI_SMOKE_MISSING_STATE_RESTART")
            }
        }

        function onRunEnded(ok, aborted) {
            switch (driver.phase) {
            case "stream":
                driver.checkStreamPhase()
                break
            case "markdown":
                driver.checkMarkdownPhase()
                break
            case "provider-error":
                if (driver.bridge.statusKind !== "error" || driver.bridge.visibleError.indexOf("deterministic provider failure") !== 0
                        || driver.bridge.visibleError.length > driver.bridge.maxErrorCharacters || ok) return driver.fail("provider error preservation")
                driver.log("QT_WEBUI_SMOKE_PROVIDER_ERROR_PRESERVED")
                driver.schedule("failure")
                break
            case "abort":
                if (!aborted) return driver.fail("delayed abort was not honored")
                driver.log("QT_WEBUI_SMOKE_DELAYED_ABORT_RECEIPT")
                driver.schedule("limits")
                break
            case "limits": {
                let withinLimit = true
                for (let index = 0; index < driver.bridge.transcriptModel.count; index++) {
                    if (driver.bridge.transcriptModel.get(index).text.length > driver.bridge.maxMessageCharacters) withinLimit = false
                }
                if (driver.bridge.transcriptModel.count > driver.bridge.maxTranscriptRows || !withinLimit) return driver.fail("transcript bounds")
                driver.log("QT_WEBUI_SMOKE_TRANSCRIPT_BOUNDED rows=" + driver.bridge.transcriptModel.count)
                driver.schedule("settings")
                break
            }
            default:
                break
            }
        }

        function onCompactTranscriptChanged() {
            if (driver.phase === "settings" && driver.bridge.compactTranscript) {
                driver.log("QT_WEBUI_SMOKE_SETTINGS_PERSISTED")
                driver.schedule("models")
            }
        }

        function onCurrentModelIdChanged() {
            driver.onModelRuntimeChanged()
        }

        function onCurrentThinkingLevelChanged() {
            driver.onModelRuntimeChanged()
        }

        function onCompactionFinished(ok) {
            if (driver.phase !== "models" || driver.modelStep !== "compact") return
            if (!ok || driver.bridge.active || driver.bridge.compacting) return driver.fail("compaction result")
            driver.log("QT_WEBUI_SMOKE_CONTEXT_COMPACTED")
            driver.modelStep = ""
            driver.schedule("exit")
        }

        function onModelsLoaded(data) {
            if (driver.phase === "models" && driver.modelStep === "picker") driver.schedule("check-model-picker")
        }

        function onThinkingLevelsLoaded(data) {
            if (driver.phase === "models" && driver.modelStep === "thinking-picker") driver.schedule("check-thinking-picker")
        }

        function onDialogRequested(dialog) {
            dialogAnswerTimer.start()
        }
    }

    Timer {
        id: dialogAnswerTimer
        interval: 30
        repeat: false
        onTriggered: driver.answerDialog(driver.shell.extensionDialog)
    }

    Connections {
        target: driver.shell

        function onLinkOpenResult(url, response) {
            if (driver.linkConfirmed) return
            if (!response.ok || url !== "https://example.com/docs") return driver.fail("link confirmation")
            driver.linkConfirmed = true
            driver.log("QT_WEBUI_SMOKE_LINK_CONFIRMED")
            driver.schedule("search")
        }
    }

    Component.onCompleted: {
        log("QT_WEBUI_SMOKE_THEME_" + (shell.themeDark ? "DARK" : "LIGHT"))
    }
}
