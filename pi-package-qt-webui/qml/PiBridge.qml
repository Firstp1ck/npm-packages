import QtQuick
import Quickshell
import Quickshell.Io

Scope {
    id: bridge

    readonly property int maxTranscriptRows: 80
    readonly property int maxMessageCharacters: 8192
    readonly property int maxErrorCharacters: 512
    readonly property int maxRuntimeInfoCharacters: 160
    readonly property int promptReconciliationMilliseconds: 150
    readonly property int startupReadinessMilliseconds: 2000
    readonly property bool smokeMode: Quickshell.env("QT_WEBUI_SMOKE_MODE") === "1"
    readonly property string callerCwd: String(Quickshell.env("QT_WEBUI_CALLER_CWD") || "")
    readonly property string runtimeInfoText: currentProvider.length > 0
        && currentModelId.length > 0 && currentThinkingLevel.length > 0
        ? currentProvider + "/" + currentModelId + " · thinking " + currentThinkingLevel
        : ""

    property alias transcriptModel: transcript
    property bool ready: false
    property bool active: false
    property bool processRunning: rpcProcess.running
    property string statusKind: "stopped"
    property string statusText: "Starting…"
    property string visibleError: ""
    property string currentProvider: ""
    property string currentModelId: ""
    property string currentThinkingLevel: ""
    property int requestSerial: 0
    property string pendingPromptId: ""
    property bool promptLifecycleStarted: false
    property bool pendingPromptCancellation: false
    property bool preserveRunError: false
    property bool awaitingStartupState: false
    property bool restartPending: false
    property int streamingRow: -1
    property int smokePhase: 0
    property string smokeNextAction: ""

    signal promptSubmitted()

    ListModel {
        id: transcript
    }

    function boundedText(value) {
        const text = typeof value === "string" ? value : String(value ?? "")
        if (text.length <= maxMessageCharacters) return text
        return text.slice(0, maxMessageCharacters - 1) + "…"
    }

    function boundedError(value) {
        const text = typeof value === "string" ? value : String(value ?? "Unknown error")
        return text.length <= maxErrorCharacters ? text : text.slice(0, maxErrorCharacters - 1) + "…"
    }

    function boundedRuntimeInfoValue(value) {
        if (typeof value !== "string") return ""
        const text = value.trim()
        return text.length <= maxRuntimeInfoCharacters
            ? text
            : text.slice(0, maxRuntimeInfoCharacters - 1) + "…"
    }

    function clearRuntimeInfo() {
        currentProvider = ""
        currentModelId = ""
        currentThinkingLevel = ""
    }

    function updateRuntimeInfo(data) {
        const model = data && data.model && typeof data.model === "object" ? data.model : null
        currentProvider = boundedRuntimeInfoValue(model ? model.provider : "")
        currentModelId = boundedRuntimeInfoValue(model ? model.id : "")
        currentThinkingLevel = boundedRuntimeInfoValue(data ? data.thinkingLevel : "")
    }

    function showError(value) {
        visibleError = boundedError(value)
        statusKind = "error"
        statusText = "Error"
    }

    function appendMessage(messageRole, text) {
        while (transcript.count >= maxTranscriptRows) {
            transcript.remove(0)
            if (streamingRow >= 0) streamingRow--
        }
        transcript.append({ "messageRole": messageRole, "messageText": boundedText(text) })
        return transcript.count - 1
    }

    function replaceMessage(index, text) {
        if (index < 0 || index >= transcript.count) return
        transcript.setProperty(index, "messageText", boundedText(text))
    }

    function nextRequestId(prefix) {
        requestSerial++
        return "qt-webui-" + prefix + "-" + requestSerial
    }

    function sendCommand(value) {
        if (!rpcProcess.running || value === null || typeof value !== "object") return false
        rpcProcess.write(JSON.stringify(value) + "\n")
        return true
    }

    function requestState() {
        return sendCommand({ "id": nextRequestId("state"), "type": "get_state" })
    }

    function sendPrompt(text) {
        const message = typeof text === "string" ? text.trim() : ""
        if (!ready || active || !rpcProcess.running || message.length === 0) return false
        appendMessage("user", message)
        pendingPromptId = nextRequestId("prompt")
        promptLifecycleStarted = false
        pendingPromptCancellation = false
        preserveRunError = false
        promptReconciliationTimer.stop()
        active = true
        statusKind = "running"
        statusText = "Running"
        visibleError = ""
        sendCommand({ "id": pendingPromptId, "type": "prompt", "message": message })
        promptSubmitted()
        return true
    }

    function abortRun() {
        if (!active || !rpcProcess.running) return false
        if (pendingPromptId.length > 0 && !promptLifecycleStarted) pendingPromptCancellation = true
        statusKind = "running"
        statusText = "Stopping…"
        return sendCommand({ "id": nextRequestId("abort"), "type": "abort" })
    }

    function restartProcess() {
        if (restartPending || (rpcProcess.running && ready)) return false
        startupReadinessTimer.stop()
        promptReconciliationTimer.stop()
        awaitingStartupState = false
        ready = false
        active = false
        pendingPromptId = ""
        promptLifecycleStarted = false
        pendingPromptCancellation = false
        preserveRunError = false
        streamingRow = -1
        visibleError = ""
        clearRuntimeInfo()
        statusKind = "stopped"
        statusText = "Restarting…"
        if (rpcProcess.running) {
            restartPending = true
            rpcProcess.running = false
        } else {
            rpcProcess.running = true
        }
        return true
    }

    function assistantText(message) {
        if (!message || message.role !== "assistant") return null
        if (typeof message.content === "string") return message.content
        if (!Array.isArray(message.content)) return ""
        let text = ""
        for (const part of message.content) {
            if (part && part.type === "text" && typeof part.text === "string") text += part.text
        }
        return text
    }

    function handleResponse(event) {
        if (event.command === "get_state") {
            if (awaitingStartupState) {
                awaitingStartupState = false
                startupReadinessTimer.stop()
            }
            if (event.success !== true) {
                ready = false
                active = false
                clearRuntimeInfo()
                showError(event.error || "Pi did not become ready")
                if (smokeMode && smokePhase === 8) {
                    console.log("QT_WEBUI_SMOKE_FAILED_STATE_RECOVERABLE")
                    scheduleSmoke("restart-missing")
                }
                return
            }
            updateRuntimeInfo(event.data)
            if (smokeMode && runtimeInfoText.length > 0) console.log("QT_WEBUI_SMOKE_RUNTIME_INFO")
            ready = true
            active = !!(event.data && (event.data.isStreaming === true || event.data.isCompacting === true))
            if (!active) {
                pendingPromptId = ""
                promptLifecycleStarted = false
                pendingPromptCancellation = false
                promptReconciliationTimer.stop()
            }
            if (preserveRunError && !active) {
                statusKind = "error"
                statusText = "Error"
            } else {
                statusKind = active ? "running" : "ready"
                statusText = active ? "Running" : "Ready"
            }
            if (smokeMode && smokePhase === 2 && !active) {
                console.log("QT_WEBUI_SMOKE_IMMEDIATE_PROMPT_RECONCILED")
                scheduleSmoke("provider-error")
            }
            if (smokeMode) smokeReady()
            return
        }

        if (event.command === "prompt" && event.success === true && event.id === pendingPromptId) {
            if (!promptLifecycleStarted) {
                promptReconciliationTimer.stop()
                promptReconciliationTimer.start()
            }
            return
        }

        if (event.success === false) {
            if (event.command === "prompt") {
                active = false
                pendingPromptId = ""
                promptLifecycleStarted = false
                pendingPromptCancellation = false
                promptReconciliationTimer.stop()
            }
            showError(event.error || (String(event.command || "Command") + " failed"))
            if (event.command !== "get_state") requestState()
            if (smokeMode && smokePhase === 4 && event.command === "prompt") {
                console.log("QT_WEBUI_SMOKE_FAILED_RESPONSE_RECOVERED")
                scheduleSmoke("abort")
            }
        }
    }

    function handleMessageUpdate(event) {
        const update = event.assistantMessageEvent
        if (!update || update.type !== "text_delta" || typeof update.delta !== "string") return
        if (streamingRow < 0 || streamingRow >= transcript.count) streamingRow = appendMessage("assistant", "")
        const current = transcript.get(streamingRow).messageText
        replaceMessage(streamingRow, current + update.delta)
    }

    function handleMessageEnd(event) {
        const finalText = assistantText(event.message)
        if (finalText === null) return
        if (streamingRow >= 0 && streamingRow < transcript.count) replaceMessage(streamingRow, finalText)
        else if (finalText.length > 0) appendMessage("assistant", finalText)
        streamingRow = -1
        if (event.message.stopReason === "error") {
            preserveRunError = true
            showError(event.message.errorMessage || "Pi provider request failed")
        }
    }

    function handleExtensionRequest(event) {
        const blocking = event.method === "select" || event.method === "confirm"
            || event.method === "input" || event.method === "editor"
        if (blocking && typeof event.id === "string" && event.id.length > 0) {
            showError("Unsupported extension dialog was cancelled: " + event.method)
            sendCommand({ "type": "extension_ui_response", "id": event.id, "cancelled": true })
            return
        }
        if (smokeMode && event.method === "notify"
                && (event.message === "QT_WEBUI_SMOKE_DIALOG_CANCEL_RECEIPT"
                    || event.message === "QT_WEBUI_SMOKE_DELAYED_AGENT_ABORTED")) {
            console.log(event.message)
        }
    }

    function handleRecord(record) {
        if (!record || typeof record.type !== "string") return
        switch (record.type) {
        case "response":
            handleResponse(record)
            break
        case "agent_start":
            promptLifecycleStarted = true
            promptReconciliationTimer.stop()
            active = true
            statusKind = "running"
            statusText = "Running"
            if (pendingPromptCancellation) {
                pendingPromptCancellation = false
                sendCommand({ "id": nextRequestId("abort"), "type": "abort" })
            }
            break
        case "agent_settled":
            promptReconciliationTimer.stop()
            active = false
            pendingPromptId = ""
            promptLifecycleStarted = false
            pendingPromptCancellation = false
            streamingRow = -1
            statusKind = preserveRunError ? "error" : "ready"
            statusText = preserveRunError ? "Error" : "Ready"
            if (smokeMode) smokeSettled()
            break
        case "message_update":
            handleMessageUpdate(record)
            break
        case "message_end":
            handleMessageEnd(record)
            break
        case "tool_execution_start":
            statusKind = "tool"
            statusText = "Tool · " + boundedText(record.toolName || "working")
            break
        case "tool_execution_end":
            statusKind = active ? "running" : "ready"
            statusText = active ? "Running" : "Ready"
            if (record.isError === true) showError("Tool failed: " + String(record.toolName || "unknown"))
            break
        case "extension_error":
            showError(record.error || "Extension error")
            break
        case "extension_ui_request":
            handleExtensionRequest(record)
            break
        default:
            break
        }
    }

    function handleLine(data) {
        let line = typeof data === "string" ? data : String(data)
        if (line.endsWith("\r")) line = line.slice(0, -1)
        if (line.length === 0) return
        try {
            handleRecord(JSON.parse(line))
        } catch (error) {
            showError("Invalid Pi RPC record: " + error)
            if (smokeMode) console.log("QT_WEBUI_SMOKE_PARSE_RECOVERED")
        }
    }

    function smokeReady() {
        if (smokePhase === 10) {
            console.log("QT_WEBUI_SMOKE_RESTART_RECEIPT")
            console.log("QT_WEBUI_SMOKE_COMPLETE")
            scheduleSmoke("quit")
            return
        }
        if (smokePhase !== 0) return
        smokePhase = 1
        console.log("QT_WEBUI_SMOKE_READY")
        scheduleSmoke("stream")
    }

    function scheduleSmoke(action) {
        smokeNextAction = action
        smokeTimer.start()
    }

    function smokeSettled() {
        if (smokePhase === 1) {
            const last = transcript.count > 0 ? transcript.get(transcript.count - 1).messageText : ""
            if (last !== "authoritative final") {
                showError("Smoke stream reconciliation failed")
                return
            }
            console.log("QT_WEBUI_SMOKE_STREAM_RECONCILED")
            console.log("QT_WEBUI_SMOKE_AGENT_SETTLED")
            scheduleSmoke("immediate")
        } else if (smokePhase === 3) {
            if (statusKind !== "error" || visibleError.indexOf("deterministic provider failure") !== 0
                    || visibleError.length > maxErrorCharacters) {
                showError("Smoke provider error preservation failed")
                return
            }
            console.log("QT_WEBUI_SMOKE_PROVIDER_ERROR_PRESERVED")
            scheduleSmoke("failure")
        } else if (smokePhase === 5) {
            console.log("QT_WEBUI_SMOKE_DELAYED_ABORT_RECEIPT")
            scheduleSmoke("limits")
        } else if (smokePhase === 6) {
            let withinTextLimit = true
            for (let index = 0; index < transcript.count; index++) {
                if (transcript.get(index).messageText.length > maxMessageCharacters) withinTextLimit = false
            }
            if (transcript.count <= maxTranscriptRows && withinTextLimit) {
                console.log("QT_WEBUI_SMOKE_TRANSCRIPT_BOUNDED rows=" + transcript.count)
                scheduleSmoke("exit")
            } else {
                showError("Smoke transcript bounds failed")
            }
        }
    }

    Timer {
        id: promptReconciliationTimer
        interval: bridge.promptReconciliationMilliseconds
        repeat: false
        onTriggered: {
            if (bridge.pendingPromptId.length > 0 && !bridge.promptLifecycleStarted
                    && bridge.active && rpcProcess.running) bridge.requestState()
        }
    }

    Timer {
        id: startupReadinessTimer
        interval: bridge.startupReadinessMilliseconds
        repeat: false
        onTriggered: {
            if (!bridge.awaitingStartupState || !rpcProcess.running) return
            bridge.awaitingStartupState = false
            bridge.ready = false
            bridge.active = false
            bridge.showError("Pi did not report readiness in time")
            if (bridge.smokeMode && bridge.smokePhase === 9) {
                console.log("QT_WEBUI_SMOKE_MISSING_STATE_RECOVERABLE")
                bridge.scheduleSmoke("restart-recovered")
            }
        }
    }

    Timer {
        id: smokeTimer
        interval: 40
        repeat: false
        onTriggered: {
            const action = smokeNextAction
            smokeNextAction = ""
            if (action === "stream") {
                smokePhase = 1
                sendPrompt("__QT_WEBUI_STREAM__")
            } else if (action === "immediate") {
                smokePhase = 2
                sendPrompt("__QT_WEBUI_IMMEDIATE__")
            } else if (action === "provider-error") {
                smokePhase = 3
                sendPrompt("__QT_WEBUI_PROVIDER_ERROR__")
            } else if (action === "failure") {
                smokePhase = 4
                sendPrompt("__QT_WEBUI_FAIL__")
            } else if (action === "abort") {
                smokePhase = 5
                sendPrompt("__QT_WEBUI_DELAYED_ABORT__")
                scheduleSmoke("abort-before-start")
            } else if (action === "abort-before-start") {
                abortRun()
            } else if (action === "limits") {
                smokePhase = 6
                sendPrompt("__QT_WEBUI_LIMITS__")
            } else if (action === "exit") {
                smokePhase = 7
                sendPrompt("__QT_WEBUI_EXIT__")
            } else if (action === "restart-failed") {
                smokePhase = 8
                restartProcess()
            } else if (action === "restart-missing") {
                smokePhase = 9
                restartProcess()
            } else if (action === "restart-recovered") {
                smokePhase = 10
                restartProcess()
            } else if (action === "quit") {
                rpcProcess.running = false
                Qt.quit()
            }
        }
    }

    Process {
        id: rpcProcess
        command: [
            String(Quickshell.env("QT_WEBUI_NODE_EXECUTABLE") || ""),
            String(Quickshell.env("QT_WEBUI_PI_CLI_ENTRY") || ""),
            "--mode",
            "rpc"
        ]
        workingDirectory: bridge.callerCwd
        stdinEnabled: true
        running: true

        stdout: SplitParser {
            splitMarker: "\n"
            onRead: data => bridge.handleLine(data)
        }

        stderr: SplitParser {
            splitMarker: "\n"
            onRead: data => {
                if (String(data).length > 0) bridge.showError("Pi: " + data)
            }
        }

        onStarted: {
            bridge.ready = false
            bridge.active = false
            bridge.pendingPromptId = ""
            bridge.promptLifecycleStarted = false
            bridge.pendingPromptCancellation = false
            bridge.preserveRunError = false
            bridge.streamingRow = -1
            bridge.visibleError = ""
            bridge.clearRuntimeInfo()
            bridge.statusKind = "stopped"
            bridge.statusText = "Starting…"
            bridge.awaitingStartupState = true
            startupReadinessTimer.start()
            bridge.requestState()
            if (bridge.smokeMode && bridge.smokePhase === 9) console.log("QT_WEBUI_SMOKE_FAILED_STATE_RESTART")
            if (bridge.smokeMode && bridge.smokePhase === 10) console.log("QT_WEBUI_SMOKE_MISSING_STATE_RESTART")
        }

        onExited: (exitCode, exitStatus) => {
            startupReadinessTimer.stop()
            promptReconciliationTimer.stop()
            bridge.awaitingStartupState = false
            bridge.ready = false
            bridge.active = false
            bridge.pendingPromptId = ""
            bridge.promptLifecycleStarted = false
            bridge.pendingPromptCancellation = false
            bridge.streamingRow = -1
            bridge.clearRuntimeInfo()
            if (bridge.restartPending) {
                bridge.restartPending = false
                rpcProcess.running = true
                return
            }
            bridge.preserveRunError = false
            bridge.statusKind = exitCode === 0 ? "stopped" : "error"
            bridge.statusText = exitCode === 0 ? "Stopped" : "Pi exited (" + exitCode + ")"
            if (exitCode !== 0) bridge.visibleError = bridge.boundedError("Pi process exited with code " + exitCode)
            if (bridge.smokeMode && bridge.smokePhase === 7) bridge.scheduleSmoke("restart-failed")
        }
    }
}
