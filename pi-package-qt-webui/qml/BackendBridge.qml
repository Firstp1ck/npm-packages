import QtQuick
import Quickshell
import Quickshell.Io

// Owns the Node backend process and turns its typed events into QML state. QML never sees a
// raw Pi record: the backend translates, bounds, and renders content before it reaches here.
Scope {
    id: bridge

    readonly property int protocolVersion: 1
    readonly property int maxTranscriptRows: 80
    readonly property int maxMessageCharacters: 8192
    readonly property int maxErrorCharacters: 512
    readonly property int maxRuntimeInfoCharacters: 160
    readonly property int maxNotices: 200
    property int noticeRevision: 0
    property var usage: null
    property var recentActions: []
    readonly property int maxPendingRequests: 64
    readonly property int defaultRequestTimeoutMs: 10000
    readonly property int backendStartupMs: 8000
    readonly property bool smokeMode: Quickshell.env("QT_WEBUI_SMOKE_MODE") === "1"
    readonly property string callerCwd: String(Quickshell.env("QT_WEBUI_CALLER_CWD") || "")
    readonly property string homeDirectory: String(Quickshell.env("HOME") || "")
    readonly property int maxTabs: 8
    // Tabs: one Pi session per tab. Only the active tab is materialized here; the backend keeps a
    // bounded mirror of every tab and replays it when the active tab changes.
    property var tabs: []
    property string activeTabId: ""
    readonly property int tabCount: tabs.length
    readonly property var activeTab: tabById(activeTabId)
    readonly property string workspaceCwd: activeTab ? String(activeTab.cwd) : callerCwd
    readonly property string displayCwd: shortenPath(workspaceCwd)
    readonly property string runtimeInfoText: currentProvider.length > 0
        && currentModelId.length > 0 && currentThinkingLevel.length > 0
        ? currentProvider + "/" + currentModelId + " · thinking " + currentThinkingLevel
        : ""

    property alias transcriptModel: transcript
    property alias noticeModel: notices
    property bool backendRunning: backendProcess.running
    property bool backendReady: false
    property bool ready: false
    property bool active: false
    property bool quitting: false
    property string statusKind: "stopped"
    property string statusText: "Starting…"
    property string visibleError: ""
    property string currentProvider: ""
    property string currentModelId: ""
    property string currentModelName: ""
    property bool currentModelReasoning: false
    property string currentThinkingLevel: ""
    property bool modelActionPending: false
    property bool compacting: false
    property string sessionName: ""
    property string sessionFile: ""
    // Drafts follow the Pi session file when one exists and the tab's workspace otherwise.
    readonly property string draftKey: sessionFile.length > 0 ? sessionFile : workspaceCwd
    property var attachments: []
    property var commands: []
    property bool commandsLoaded: false
    property bool syntaxHighlighting: true
    property string extensionStatusText: ""
    property var statusChips: []
    property var statusTexts: ({})
    property var statusEntries: []
    property bool restarting: false
    property var steeringQueue: []
    property var followUpQueue: []
    property bool compactTranscript: false
    property bool showThinking: true
    property bool desktopNotifications: true
    property bool windowActive: true
    property int requestSerial: 0
    property var pendingRequests: ({})
    property int pendingRequestCount: 0
    property int staleResponses: 0
    property int droppedEvents: 0
    property var requestTimeouts: ({})
    property var dialogQueue: []
    property var activeDialog: null
    property int backendExitCode: 0
    property bool backendRestartPending: false
    property string windowTitle: "Qt WebUI"

    signal backendBecameReady()
    signal runStarted()
    signal runEnded(bool ok, bool aborted)
    signal dialogRequested(var dialog)
    signal dialogFinished(string requestId)
    signal noticePosted(string level, string message)
    signal composerTextRequested(string text)
    signal eventReceived(var event)
    signal backendExited(int exitCode)
    signal modelsLoaded(var data)
    signal thinkingLevelsLoaded(var data)
    signal compactionFinished(bool ok)
    signal draftLoaded(string key, string text)
    signal sequenceRan(string sequenceId)
    signal tabSwitched(string tabId)
    signal sessionsLoaded(var data)

    ListModel {
        id: transcript
    }

    ListModel {
        id: notices
    }

    // ---- bounded helpers -------------------------------------------------------------

    function boundedText(value, limit) {
        const text = typeof value === "string" ? value : String(value ?? "")
        const max = limit || maxMessageCharacters
        if (text.length <= max) return text
        return text.slice(0, max - 1) + "…"
    }

    function boundedError(value) {
        return boundedText(typeof value === "string" && value.length > 0 ? value : "Unknown error", maxErrorCharacters)
    }

    function showError(value) {
        visibleError = boundedError(value)
        statusKind = "error"
        statusText = "Error"
    }

    function shortenPath(value) {
        const text = String(value || "")
        if (homeDirectory.length > 1 && text.indexOf(homeDirectory + "/") === 0) return "~" + text.slice(homeDirectory.length)
        return text === homeDirectory && homeDirectory.length > 0 ? "~" : text
    }

    function tabById(tabId) {
        for (const tab of tabs) if (tab.id === tabId) return tab
        return null
    }

    function tabLabel(tab) {
        if (!tab) return ""
        if (tab.name && tab.name.length > 0) return tab.name
        if (tab.sessionName && tab.sessionName.length > 0) return tab.sessionName
        const parts = String(tab.cwd || "").split("/").filter(part => part.length > 0)
        return parts.length > 0 ? parts[parts.length - 1] : "/"
    }

    function postNotice(level, message, tab) {
        const text = boundedText(message, maxErrorCharacters)
        while (notices.count >= maxNotices) notices.remove(0)
        notices.append({ "level": level, "message": text, "at": Date.now(), "tab": typeof tab === "string" ? tab : "" })
        noticeRevision++
        noticePosted(level, text)
    }

    function clearNotices() {
        notices.clear()
        noticeRevision++
    }

    // ---- transcript model ------------------------------------------------------------

    function rowIndexById(rowId) {
        for (let index = transcript.count - 1; index >= 0; index--) {
            if (transcript.get(index).rowId === rowId) return index
        }
        return -1
    }

    function appendRow(row) {
        while (transcript.count >= maxTranscriptRows) transcript.remove(0)
        transcript.append({
            "rowId": row.rowId,
            "messageId": row.messageId || "",
            "role": row.role,
            "kind": row.kind,
            "text": boundedText(row.text || ""),
            "blocksJson": row.blocksJson || "[]",
            "truncated": row.truncated === true,
            "streaming": row.streaming === true,
            "modeLabel": row.modeLabel || "",
            "attachments": row.attachments || "",
            "toolName": row.toolName || "",
            "toolSummary": row.toolSummary || "",
            "toolStatus": row.toolStatus || "",
            "toolDurationMs": row.toolDurationMs || 0,
            "toolOutput": row.toolOutput || "",
            "toolError": row.toolError || ""
        })
        return transcript.count - 1
    }

    function setRow(rowId, values) {
        const index = rowIndexById(rowId)
        if (index < 0) return false
        for (const key in values) transcript.setProperty(index, key, values[key])
        return true
    }

    function messageText(messageId) {
        let text = ""
        for (let index = 0; index < transcript.count; index++) {
            const row = transcript.get(index)
            if (row.messageId !== messageId) continue
            if (row.kind !== "text" && row.kind !== "user") continue
            text += (text.length > 0 ? "\n\n" : "") + row.text
        }
        return text
    }

    function copyToClipboard(text) {
        if (typeof text !== "string" || text.length === 0) return false
        Quickshell.clipboardText = text
        postNotice("info", "Copied " + text.length + " characters")
        return true
    }

    // ---- requests ----------------------------------------------------------------------

    function timeoutFor(type) {
        const configured = requestTimeouts && typeof requestTimeouts[type] === "number" ? requestTimeouts[type] : 0
        return configured > 0 ? configured : defaultRequestTimeoutMs
    }

    function request(type, fields, callback) {
        if (!backendProcess.running) {
            if (callback) callback({ ok: false, error: { code: "not_running", message: "Backend is not running" } })
            return ""
        }
        if (pendingRequestCount >= maxPendingRequests) {
            if (callback) callback({ ok: false, error: { code: "busy", message: "Too many requests are pending" } })
            return ""
        }
        requestSerial++
        const id = "q-" + requestSerial
        const frame = Object.assign({ "v": protocolVersion, "id": id, "type": type }, fields || {})
        if (activeTabId.length > 0 && frame.tab === undefined) frame.tab = activeTabId
        const pending = pendingRequests
        pending[id] = { type: type, callback: callback || null, deadline: Date.now() + timeoutFor(type) }
        pendingRequests = pending
        pendingRequestCount++
        pendingSweepTimer.start()
        backendProcess.write(JSON.stringify(frame) + "\n")
        return id
    }

    function settlePending(id, response) {
        const pending = pendingRequests
        const entry = pending[id]
        if (!entry) return false
        delete pending[id]
        pendingRequests = pending
        pendingRequestCount = Math.max(0, pendingRequestCount - 1)
        if (pendingRequestCount === 0) pendingSweepTimer.stop()
        if (entry.callback) entry.callback(response)
        return true
    }

    function failAllPending(code, message) {
        const pending = pendingRequests
        for (const id in pending) settlePending(id, { ok: false, error: { code: code, message: message } })
    }

    function sweepPending() {
        const now = Date.now()
        const pending = pendingRequests
        for (const id in pending) {
            if (pending[id].deadline <= now) {
                const type = pending[id].type
                settlePending(id, { ok: false, error: { code: "timeout", message: type + " timed out in the client" } })
            }
        }
    }

    // ---- public actions ------------------------------------------------------------------

    function sendPrompt(text, mode) {
        const message = typeof text === "string" ? text.trim() : ""
        if (!ready || message.length === 0 || message.length > maxMessageCharacters) return false
        const promptMode = mode || (active ? "steer" : "send")
        if (promptMode === "send" && active) return false
        visibleError = ""
        const attachmentIds = attachments.map(attachment => String(attachment.id))
        request("prompt", { "message": message, "mode": promptMode, "attachments": attachmentIds }, response => {
            if (!response.ok) showError(response.error.message)
            // The backend consumes attachments once the prompt is accepted for delivery; only a
            // refusal before that point (busy, not ready, backend gone) leaves them attached.
            const kept = !response.ok && ["busy", "not_ready", "not_running"].indexOf(response.error.code) !== -1
            if (attachmentIds.length > 0 && !kept) attachments = []
        })
        return true
    }

    // ---- composer support: commands, paths, attachments, drafts, sequences --------------

    function loadCommands(callback) {
        if (!ready) return false
        request("commands_list", {}, response => {
            if (!response.ok) postNotice("error", "Could not list commands: " + response.error.message)
            else {
                commands = response.data.commands
                commandsLoaded = true
            }
            if (callback) callback(response)
        })
        return true
    }

    function completePath(query, callback) {
        request("path_complete", { "query": boundedText(query, 256) }, response => {
            if (callback) callback(response)
        })
    }

    function addAttachment(path, granted, callback) {
        request("attachment_add", { "path": String(path), "granted": granted === true }, response => {
            if (!response.ok) postNotice("error", "Could not attach file: " + response.error.message)
            else attachments = response.data.attachments
            if (callback) callback(response)
        })
    }

    function updateAttachment(attachmentId, text, callback) {
        request("attachment_update", { "attachmentId": String(attachmentId), "text": String(text) }, response => {
            if (!response.ok) postNotice("error", "Could not update attachment: " + response.error.message)
            else attachments = response.data.attachments
            if (callback) callback(response)
        })
    }

    function removeAttachment(attachmentId, callback) {
        request("attachment_remove", { "attachmentId": String(attachmentId) }, response => {
            if (!response.ok && response.error.code !== "stale_request") postNotice("error", "Could not remove attachment: " + response.error.message)
            if (response.ok) attachments = response.data.attachments
            else attachments = attachments.filter(attachment => String(attachment.id) !== String(attachmentId))
            if (callback) callback(response)
        })
    }

    function loadDraft(callback) {
        const key = draftKey
        request("draft_get", { "key": key }, response => {
            if (response.ok) draftLoaded(key, String(response.data.text || ""))
            if (callback) callback(response)
        })
    }

    function saveDraft(text) {
        return saveDraftFor(draftKey, text)
    }

    function saveDraftFor(key, text) {
        if (typeof key !== "string" || key.length === 0) return ""
        return request("draft_set", { "key": key, "text": boundedText(String(text || ""), 8192) }, () => {})
    }

    function loadSequences(callback) {
        request("sequences_list", {}, response => {
            if (!response.ok) postNotice("error", "Could not load sequences: " + response.error.message)
            if (callback) callback(response)
        })
    }

    function saveSequence(sequenceId, name, entries, callback) {
        const fields = { "name": boundedText(name, 64), "entries": entries }
        if (typeof sequenceId === "string" && sequenceId.length > 0) fields["sequenceId"] = sequenceId
        request("sequence_save", fields, response => {
            if (!response.ok) postNotice("error", "Could not save sequence: " + response.error.message)
            if (callback) callback(response)
        })
    }

    function deleteSequence(sequenceId, callback) {
        request("sequence_delete", { "sequenceId": String(sequenceId) }, response => {
            if (!response.ok) postNotice("error", "Could not delete sequence: " + response.error.message)
            if (callback) callback(response)
        })
    }

    function moveSequence(sequenceId, delta, callback) {
        request("sequence_move", { "sequenceId": String(sequenceId), "delta": delta < 0 ? -1 : 1 }, response => {
            if (!response.ok) postNotice("error", "Could not reorder sequences: " + response.error.message)
            if (callback) callback(response)
        })
    }

    // Runs only from the sequences dialog's explicit Run action; the backend sends the first
    // entry and queues the rest as follow-ups.
    function runSequence(sequenceId, callback) {
        if (!ready || active) {
            if (callback) callback({ ok: false, error: { code: "busy", message: "Pi is busy" } })
            return false
        }
        visibleError = ""
        request("sequence_run", { "sequenceId": String(sequenceId) }, response => {
            if (!response.ok) showError("Sequence failed: " + response.error.message)
            else {
                postNotice("info", "Sequence started: 1 prompt sent, " + response.data.queued + " queued")
                sequenceRan(String(sequenceId))
            }
            if (callback) callback(response)
        })
        return true
    }

    function abortRun() {
        if (!active) return false
        statusKind = "running"
        statusText = "Stopping…"
        request("abort", {}, response => {
            if (!response.ok && response.error.code !== "not_running") showError(response.error.message)
        })
        return true
    }

    function restartProcess() {
        if (!backendProcess.running) {
            backendRestartPending = false
            startBackend()
            return true
        }
        if (restarting || active) return false
        restarting = true
        statusKind = "running"
        statusText = "Restarting…"
        visibleError = ""
        postNotice("info", "Restarting Pi…")
        request("restart", {}, response => {
            if (!response.ok) {
                restarting = false
                if (response.error.code !== "busy") showError(response.error.message)
            }
        })
        return true
    }

    function refreshState() {
        return request("state", {}, () => {})
    }

    function updateSetting(name, value) {
        const values = {}
        values[name] = value
        request("settings_set", { "values": values }, response => {
            if (!response.ok) postNotice("error", "Could not save setting: " + response.error.message)
            else applySettings(response.data.settings)
        })
    }

    function applySettings(settings) {
        if (!settings || typeof settings !== "object") return
        if (typeof settings.compactTranscript === "boolean") compactTranscript = settings.compactTranscript
        if (typeof settings.showThinking === "boolean") showThinking = settings.showThinking
        if (typeof settings.desktopNotifications === "boolean") desktopNotifications = settings.desktopNotifications
        if (typeof settings.syntaxHighlighting === "boolean") syntaxHighlighting = settings.syntaxHighlighting
    }

    function openLink(url, callback) {
        request("open_link", { "url": String(url) }, response => {
            if (!response.ok) postNotice("error", "Could not open link: " + response.error.message)
            else if (response.data && response.data.suppressed) postNotice("info", "Link opening is suppressed in this mode")
            if (callback) callback(response)
        })
    }

    function notifyDesktop(title, body) {
        if (!desktopNotifications || windowActive) return false
        request("notify", { "title": boundedText(title, 256), "body": boundedText(body || "", 256) }, response => {
            if (smokeMode && response.ok) console.log("QT_WEBUI_SMOKE_NOTIFICATION_REQUESTED")
        })
        return true
    }

    // ---- models, thinking, and compaction ------------------------------------------------

    function loadModels(callback) {
        if (!ready) return false
        request("models_list", {}, response => {
            if (!response.ok) postNotice("error", "Could not list models: " + response.error.message)
            else modelsLoaded(response.data)
            if (callback) callback(response)
        })
        return true
    }

    function selectModel(provider, modelId) {
        if (!ready || active || modelActionPending) return false
        if (provider === currentProvider && modelId === currentModelId) return false
        modelActionPending = true
        request("model_set", { "provider": String(provider), "modelId": String(modelId) }, response => {
            modelActionPending = false
            if (!response.ok) postNotice("error", "Could not change the model: " + response.error.message)
            else postNotice("info", "Model: " + response.data.model.provider + "/" + response.data.model.id + " · thinking " + response.data.thinkingLevel)
        })
        return true
    }

    function cycleModel() {
        if (!ready || active || modelActionPending) return false
        modelActionPending = true
        request("model_cycle", {}, response => {
            modelActionPending = false
            if (!response.ok) postNotice("error", "Could not change the model: " + response.error.message)
            else if (!response.data.changed) postNotice("info", "Only one model is configured")
            else postNotice("info", "Model: " + response.data.model.provider + "/" + response.data.model.id + " · thinking " + response.data.thinkingLevel)
        })
        return true
    }

    function loadThinkingLevels(callback) {
        if (!ready) return false
        request("thinking_levels", {}, response => {
            if (!response.ok) postNotice("error", "Could not list thinking levels: " + response.error.message)
            else thinkingLevelsLoaded(response.data)
            if (callback) callback(response)
        })
        return true
    }

    function setThinkingLevel(level) {
        if (!ready || active || modelActionPending) return false
        if (level === currentThinkingLevel) return false
        modelActionPending = true
        request("thinking_set", { "level": String(level) }, response => {
            modelActionPending = false
            if (!response.ok) postNotice("error", "Could not change the thinking level: " + response.error.message)
            else postNotice("info", "Thinking " + response.data.level)
        })
        return true
    }

    function cycleThinkingLevel() {
        if (!ready || active || modelActionPending) return false
        modelActionPending = true
        request("thinking_cycle", {}, response => {
            modelActionPending = false
            if (!response.ok) postNotice("error", "Could not change the thinking level: " + response.error.message)
            else if (!response.data.changed) postNotice("info", "This model has no thinking levels")
            else postNotice("info", "Thinking " + response.data.level)
        })
        return true
    }

    function compactContext(instructions) {
        if (!ready || active || compacting) return false
        compacting = true
        visibleError = ""
        const fields = typeof instructions === "string" && instructions.trim().length > 0 ? { "instructions": boundedText(instructions.trim(), 1024) } : {}
        request("compact", fields, response => {
            compacting = false
            if (!response.ok && response.error.code !== "busy") showError("Compaction failed: " + response.error.message)
            compactionFinished(response.ok === true)
        })
        return true
    }

    // ---- tabs, sessions, directories, worktrees ------------------------------------------

    // Everything scoped to one Pi session. Pending dialogs belong to the other tab and stay
    // pending in the backend; they are dropped here without being answered.
    function resetTabState() {
        transcript.clear()
        visibleError = ""
        statusKind = "stopped"
        statusText = "Starting…"
        ready = false
        active = false
        currentProvider = ""
        currentModelId = ""
        currentModelName = ""
        currentModelReasoning = false
        currentThinkingLevel = ""
        sessionName = ""
        sessionFile = ""
        steeringQueue = []
        followUpQueue = []
        attachments = []
        commands = []
        commandsLoaded = false
        statusChips = []
        statusEntries = []
        statusTexts = ({})
        extensionStatusText = ""
        compacting = false
        modelActionPending = false
        restarting = false
        const wasActive = activeDialog ? activeDialog.requestId : ""
        dialogQueue = []
        activeDialog = null
        if (wasActive.length > 0) dialogFinished(wasActive)
    }

    function beginTabSwitch(tabId) {
        if (tabId === activeTabId) return
        activeTabId = tabId
        resetTabState()
        usage = null
        tabSwitched(tabId)
    }

    // Applies a backend snapshot ({tab, session, attachments}); the transcript itself arrives as
    // transcript.reset and transcript.row events before the snapshot response.
    function applySnapshot(data) {
        if (!data || !data.session) return
        if (data.tab && data.tab.id !== activeTabId) beginTabSwitch(String(data.tab.id))
        const snapshot = data.session
        statusKind = String(snapshot.statusKind || "stopped")
        statusText = boundedText(snapshot.statusText || "", maxRuntimeInfoCharacters)
        ready = snapshot.ready === true
        active = snapshot.active === true
        compacting = snapshot.compacting === true
        modelActionPending = false
        restarting = false
        handleRuntime(snapshot.runtime || {})
        visibleError = typeof snapshot.error === "string" ? boundedError(snapshot.error) : ""
        if (visibleError.length === 0 && statusKind === "error") statusKind = "stopped"
        steeringQueue = snapshot.queues && Array.isArray(snapshot.queues.steering) ? snapshot.queues.steering : []
        followUpQueue = snapshot.queues && Array.isArray(snapshot.queues.followUp) ? snapshot.queues.followUp : []
        statusChips = []
        statusEntries = []
        statusTexts = ({})
        extensionStatusText = ""
        for (const record of Array.isArray(snapshot.statusRecords) ? snapshot.statusRecords : []) handleExtensionStatus(record)
        attachments = Array.isArray(data.attachments) ? data.attachments : []
        for (const dialog of Array.isArray(snapshot.dialogs) ? snapshot.dialogs : []) enqueueDialog(dialog, false)
        presentNextDialog()
        if (ready) usageTimer.restart()
    }

    function selectTab(tabId, callback) {
        const tab = tabById(tabId)
        if (!tab || tabId === activeTabId) return false
        request("tab_select", { "tab": tabId }, response => {
            if (!response.ok) postNotice("error", "Could not switch tabs: " + response.error.message)
            else applySnapshot(response.data)
            if (callback) callback(response)
        })
        return true
    }

    function selectTabIndex(index) {
        if (index < 0 || index >= tabs.length) return false
        return selectTab(String(tabs[index].id))
    }

    function cycleTab(delta) {
        if (tabs.length < 2) return false
        let index = 0
        for (let position = 0; position < tabs.length; position++) if (tabs[position].id === activeTabId) index = position
        return selectTabIndex((index + delta + tabs.length) % tabs.length)
    }

    function openTab(cwd, sessionPath, callback) {
        if (tabs.length >= maxTabs) {
            postNotice("warning", "At most " + maxTabs + " tabs can be open")
            return false
        }
        const fields = {}
        if (typeof cwd === "string" && cwd.length > 0) fields["cwd"] = cwd
        if (typeof sessionPath === "string" && sessionPath.length > 0) fields["sessionPath"] = sessionPath
        request("tab_open", fields, response => {
            if (!response.ok) postNotice("error", "Could not open a tab: " + response.error.message)
            else applySnapshot(response.data)
            if (callback) callback(response)
        })
        return true
    }

    // Refused by the backend with `busy` while a run is active unless force is true; the shell
    // asks for confirmation before forcing.
    function closeTab(tabId, force, callback) {
        if (!tabById(tabId)) return false
        request("tab_close", { "tab": tabId, "force": force === true }, response => {
            if (!response.ok) {
                if (response.error.code !== "busy") postNotice("error", "Could not close the tab: " + response.error.message)
            } else if (response.data && response.data.session) applySnapshot(response.data)
            if (callback) callback(response)
        })
        return true
    }

    function renameTab(tabId, name, callback) {
        request("tab_rename", { "tab": tabId, "name": boundedText(name, 64) }, response => {
            if (!response.ok) postNotice("error", "Could not rename the tab: " + response.error.message)
            if (callback) callback(response)
        })
        return true
    }

    function moveTab(tabId, delta) {
        request("tab_move", { "tab": tabId, "delta": delta < 0 ? -1 : 1 }, response => {
            if (!response.ok) postNotice("error", "Could not move the tab: " + response.error.message)
        })
    }

    function loadSessionStats(callback) {
        if (!ready) return false
        request("session_stats", {}, response => {
            if (response.ok) usage = response.data
            if (callback) callback(response)
        })
        return true
    }

    function loadDiagnostics(callback) {
        request("diagnostics", {}, response => {
            if (callback) callback(response)
        })
    }

    // Local files (for example a skill file) open only after the shell confirmed the exact path.
    function openPath(path, callback) {
        request("open_path", { "path": String(path) }, response => {
            if (!response.ok) postNotice("error", "Could not open the file: " + response.error.message)
            else if (response.data && response.data.suppressed) postNotice("info", "Opening files is suppressed in this mode")
            if (callback) callback(response)
        })
    }

    function recordAction(action) {
        request("recent_action", { "action": boundedText(String(action), 128) }, response => {
            if (response.ok) recentActions = response.data.recentActions
        })
    }

    function refreshTabs(callback) {
        request("tabs_list", {}, response => {
            if (response.ok) {
                tabs = response.data.tabs
                if (typeof response.data.activeTab === "string" && response.data.activeTab !== activeTabId) beginTabSwitch(response.data.activeTab)
            }
            if (callback) callback(response)
        })
    }

    function listWorktrees(callback) {
        request("worktrees_list", {}, response => {
            if (!response.ok) postNotice("error", "Could not list worktrees: " + response.error.message)
            if (callback) callback(response)
        })
    }

    function listSessions(callback) {
        if (!ready) return false
        request("sessions_list", {}, response => {
            if (!response.ok) postNotice("error", "Could not list sessions: " + response.error.message)
            else sessionsLoaded(response.data)
            if (callback) callback(response)
        })
        return true
    }

    function switchSession(sessionPath, callback) {
        if (!ready || active) return false
        visibleError = ""
        request("session_switch", { "sessionPath": String(sessionPath) }, response => {
            if (!response.ok) postNotice("error", "Could not resume the session: " + response.error.message)
            else postNotice("info", "Resumed " + (response.data.sessionName || "session") + " (" + response.data.rows + " entries shown)")
            if (callback) callback(response)
        })
        return true
    }

    function newSession(callback) {
        if (!ready || active) return false
        visibleError = ""
        request("session_new", {}, response => {
            if (!response.ok) postNotice("error", "Could not start a new session: " + response.error.message)
            else postNotice("info", "Started a new session")
            if (callback) callback(response)
        })
        return true
    }

    function listDirectory(path, showHidden, callback) {
        request("directory_list", { "path": String(path || ""), "showHidden": showHidden === true }, response => {
            if (callback) callback(response)
        })
    }

    function createDirectory(path, name, callback) {
        request("directory_create", { "path": String(path), "name": String(name) }, response => {
            if (callback) callback(response)
        })
    }

    function pinDirectory(path, callback) {
        request("directory_pin", { "path": String(path) }, response => {
            if (callback) callback(response)
        })
    }

    function planWorktree(branch, callback) {
        request("worktree_plan", { "branch": boundedText(branch, 128) }, response => {
            if (!response.ok) postNotice("error", "Cannot create a worktree: " + response.error.message)
            if (callback) callback(response)
        })
        return true
    }

    // Only called after the user confirmed the exact branch, base, and path from worktree_plan.
    function createWorktree(branch, base, path, callback) {
        request("worktree_create", { "branch": boundedText(branch, 128), "base": String(base || ""), "path": String(path || ""), "confirmed": true, "openTab": true }, response => {
            if (!response.ok) postNotice("error", "Worktree creation failed: " + response.error.message)
            else {
                postNotice("info", "Created worktree " + response.data.worktree.path)
                if (response.data.tab) applySnapshot(response.data.tab)
            }
            if (callback) callback(response)
        })
        return true
    }

    // Events from tabs that are not shown: keep the user informed without touching the view.
    function handleInactiveTabEvent(event) {
        const label = tabLabel(tabById(event.tab)) || String(event.tab)
        switch (event.type) {
        case "extension.request":
            postNotice("warning", label + " needs your input", label)
            notifyDesktop("Pi needs your input", label)
            break
        case "run.end":
            postNotice(event.ok ? "info" : "error", label + (event.aborted ? " stopped" : event.ok ? " finished" : " failed"), label)
            notifyDesktop(event.aborted ? "Pi stopped" : event.ok ? "Pi finished" : "Pi failed", label)
            break
        case "pi.error":
            if (typeof event.message === "string" && event.message.length > 0) postNotice("error", label + ": " + event.message, label)
            break
        case "pi.exit":
            if (event.code !== 0) postNotice("error", label + ": Pi exited (" + (event.code ?? event.signal ?? "unknown") + ")", label)
            break
        case "notice":
            postNotice(String(event.level || "info"), label + ": " + String(event.message || ""), label)
            break
        default:
            break
        }
    }

    // ---- extension dialogs -----------------------------------------------------------

    function enqueueDialog(event, notify) {
        const requestId = String(event.requestId)
        if ((activeDialog && activeDialog.requestId === requestId) || dialogQueue.some(entry => entry.requestId === requestId)) return false
        const queue = dialogQueue
        queue.push({
            requestId: requestId, method: String(event.method), title: String(event.title || ""),
            message: String(event.message || ""), options: Array.isArray(event.options) ? event.options : [],
            placeholder: String(event.placeholder || ""), prefill: String(event.prefill || ""),
            timeoutMs: Number(event.timeoutMs) || 0, answered: false
        })
        dialogQueue = queue
        if (notify) notifyDesktop("Pi needs your input", String(event.title || event.method))
        return true
    }

    function presentNextDialog() {
        if (activeDialog !== null || dialogQueue.length === 0) return
        const queue = dialogQueue
        activeDialog = queue.shift()
        dialogQueue = queue
        dialogRequested(activeDialog)
    }

    function answerDialog(requestId, answer) {
        if (!activeDialog || activeDialog.requestId !== requestId || activeDialog.answered) return false
        const dialog = activeDialog
        dialog.answered = true
        activeDialog = dialog
        const fields = Object.assign({ "requestId": requestId }, answer)
        request("extension_response", fields, response => {
            if (!response.ok && response.error.code !== "stale_request") postNotice("error", "Dialog answer failed: " + response.error.message)
            finishDialog(requestId)
        })
        return true
    }

    function finishDialog(requestId) {
        if (activeDialog && activeDialog.requestId === requestId) {
            activeDialog = null
            dialogFinished(requestId)
        } else {
            dialogQueue = dialogQueue.filter(entry => entry.requestId !== requestId)
        }
        presentNextDialog()
    }

    function clearDialogs(reason) {
        const wasActive = activeDialog ? activeDialog.requestId : ""
        dialogQueue = []
        activeDialog = null
        if (wasActive.length > 0) dialogFinished(wasActive)
        if (reason) postNotice("warning", reason)
    }

    // ---- event handling ------------------------------------------------------------------

    function handleStatus(event) {
        statusKind = String(event.statusKind || "stopped")
        statusText = boundedText(event.text || "", maxRuntimeInfoCharacters)
        ready = event.ready === true
        active = event.active === true
        if (restarting && (ready || statusKind === "error")) {
            restarting = false
            if (ready) postNotice("info", "Pi restarted")
        }
    }

    function handleExtensionStatus(event) {
        const key = String(event.key || "")
        const texts = statusTexts
        const chips = Array.isArray(event.chips) ? event.chips.slice(0, 18) : []
        if (chips.length > 0) {
            statusChips = chips
            delete texts[key]
        } else if (typeof event.text === "string" && event.text.length > 0) {
            texts[key] = { text: boundedText(event.text, maxRuntimeInfoCharacters), hint: boundedText(event.hint || "", maxErrorCharacters) }
        } else {
            delete texts[key]
            if (key === "git-footer-webui") statusChips = []
        }
        statusTexts = texts
        const entries = []
        const parts = []
        for (const name in texts) {
            // The header already shows the workspace; pi-extension-cd's "cwd …" status repeats it.
            if (texts[name].text.indexOf("cwd ") === 0) continue
            // The Git footer's plain TUI strings repeat its structured metrics when both are published.
            if (statusChips.length > 0 && name.indexOf("git-footer") === 0 && name !== "git-footer-webui") continue
            const label = statusLabel(name)
            const value = texts[name].text
            // "remote webui" + "Remote WebUI": keep the value only when it already names the extension.
            const shownLabel = value.toLowerCase().replace(/[^a-z0-9]+/g, "") === label.toLowerCase().replace(/[^a-z0-9]+/g, "") ? "" : label
            entries.push({ key: name, label: shownLabel, value: value, title: texts[name].hint, icon: "", tone: "" })
            parts.push((shownLabel.length > 0 ? shownLabel + " " : "") + value)
        }
        statusEntries = entries
        extensionStatusText = boundedText(parts.join(" · "), maxRuntimeInfoCharacters)
    }

    // "pi-remote-webui:controls" → "remote webui", "plan-mode" → "plan mode".
    function statusLabel(key) {
        let name = String(key || "")
        const colon = name.indexOf(":")
        if (colon > 0) name = name.slice(0, colon)
        name = name.replace(/^pi-(?:extension-|package-)?/, "").replace(/[-_]+/g, " ").trim()
        return boundedText(name, 32)
    }

    function handleRuntime(event) {
        currentProvider = boundedText(event.provider || "", maxRuntimeInfoCharacters)
        currentModelId = boundedText(event.modelId || "", maxRuntimeInfoCharacters)
        currentModelName = boundedText(event.modelName || "", maxRuntimeInfoCharacters)
        currentModelReasoning = event.modelReasoning === true
        currentThinkingLevel = boundedText(event.thinkingLevel || "", maxRuntimeInfoCharacters)
        sessionName = boundedText(event.sessionName || "", maxRuntimeInfoCharacters)
        sessionFile = typeof event.sessionFile === "string" ? event.sessionFile : ""
        if (smokeMode && runtimeInfoText.length > 0) console.log("QT_WEBUI_SMOKE_RUNTIME_INFO")
    }

    function handlePartRender(event) {
        const blocksJson = Array.isArray(event.blocks) ? JSON.stringify(event.blocks) : "[]"
        const values = {
            "text": boundedText(event.text || ""),
            "blocksJson": blocksJson,
            "truncated": event.truncated === true,
            "streaming": event.final !== true
        }
        if (!setRow(event.partId, values)) {
            appendRow({
                rowId: event.partId, messageId: event.messageId, role: "assistant", kind: event.partKind,
                text: event.text, blocksJson: blocksJson, truncated: event.truncated, streaming: event.final !== true
            })
        }
    }

    function handleEvent(event) {
        eventReceived(event)
        // Session events name their tab; only the active tab drives the view.
        if (typeof event.tab === "string" && event.tab !== activeTabId) {
            handleInactiveTabEvent(event)
            return
        }
        switch (event.type) {
        case "backend.ready":
            backendReady = true
            requestTimeouts = event.limits && event.limits.requestTimeoutMs ? event.limits.requestTimeoutMs : {}
            backendStartupTimer.stop()
            request("hello", {}, response => {
                if (!response.ok) return
                applySettings(response.data.settings)
                if (Array.isArray(response.data.recentActions)) recentActions = response.data.recentActions
                if (response.data.tabs) {
                    tabs = response.data.tabs.tabs
                    if (typeof response.data.tabs.activeTab === "string" && response.data.tabs.activeTab !== activeTabId) beginTabSwitch(response.data.tabs.activeTab)
                }
                applySnapshot({ tab: tabById(activeTabId), session: response.data.session, attachments: response.data.attachments })
            })
            backendBecameReady()
            break
        case "tabs.update":
            tabs = Array.isArray(event.tabs) ? event.tabs : []
            if (typeof event.activeTab === "string" && event.activeTab !== activeTabId) beginTabSwitch(event.activeTab)
            break
        case "transcript.reset":
            transcript.clear()
            break
        case "transcript.row":
            if (event.row && typeof event.row === "object") appendRow(event.row)
            break
        case "backend.closing":
            break
        case "backend.fatal":
            showError("Backend failure: " + String(event.message || "unknown"))
            break
        case "pi.status":
            handleStatus(event)
            break
        case "pi.error":
            if (typeof event.message === "string" && event.message.length > 0) showError(event.message)
            else visibleError = ""
            break
        case "pi.runtime":
            handleRuntime(event)
            break
        case "pi.started":
            visibleError = ""
            commands = []
            commandsLoaded = false
            break
        case "pi.exit":
            modelActionPending = false
            compacting = false
            commands = []
            commandsLoaded = false
            clearDialogs(activeDialog || dialogQueue.length > 0 ? "Pending extension dialogs were cancelled because Pi exited" : "")
            steeringQueue = []
            followUpQueue = []
            extensionStatusText = ""
            statusChips = []
            statusEntries = []
            statusTexts = ({})
            break
        case "message.user":
            appendRow({ rowId: "user-" + event.messageId, messageId: event.messageId, role: "user", kind: "user", text: event.text,
                        modeLabel: event.mode === "steer" ? "Steering" : event.mode === "followUp" ? "Follow-up" : "",
                        attachments: Array.isArray(event.attachments) ? event.attachments.map(name => String(name)).join(", ") : "" })
            break
        case "message.begin":
            break
        case "part.begin":
            appendRow({ rowId: event.partId, messageId: event.messageId, role: "assistant", kind: event.partKind, text: "", streaming: true })
            break
        case "part.render":
            handlePartRender(event)
            break
        case "part.remove": {
            const index = rowIndexById(event.partId)
            if (index >= 0) transcript.remove(index)
            break
        }
        case "message.end":
            if (event.truncatedParts > 0) postNotice("warning", event.truncatedParts + " message parts were omitted to stay within limits")
            break
        case "tool.start":
            appendRow({ rowId: "tool-" + event.toolCallId, messageId: event.messageId, role: "assistant", kind: "tool",
                        toolName: event.name, toolSummary: event.summary, toolStatus: "running" })
            break
        case "tool.update":
            setRow("tool-" + event.toolCallId, { "toolOutput": boundedText(event.output || "", 4096) })
            break
        case "tool.end":
            if (!setRow("tool-" + event.toolCallId, {
                    "toolStatus": event.ok ? "ok" : "error",
                    "toolDurationMs": Number(event.durationMs) || 0,
                    "toolOutput": boundedText(event.output || "", 4096),
                    "toolError": boundedText(event.error || "", maxErrorCharacters),
                    "toolName": event.name || ""
                })) {
                appendRow({ rowId: "tool-" + event.toolCallId, role: "assistant", kind: "tool", toolName: event.name,
                            toolStatus: event.ok ? "ok" : "error", toolDurationMs: Number(event.durationMs) || 0,
                            toolOutput: event.output, toolError: event.error })
            }
            break
        case "run.start":
            runStarted()
            break
        case "run.end":
            runEnded(event.ok === true, event.aborted === true)
            usageTimer.restart()
            if (event.aborted) notifyDesktop("Pi stopped", "The run was aborted")
            else if (event.ok) notifyDesktop("Pi finished", sessionName.length > 0 ? sessionName : workspaceCwd)
            else notifyDesktop("Pi failed", visibleError)
            break
        case "extension.request":
            enqueueDialog(event, true)
            presentNextDialog()
            break
        case "extension.cancelled":
            finishDialog(String(event.requestId))
            break
        case "extension.answered":
            break
        case "extension.notify":
            postNotice(String(event.level || "info"), String(event.message || ""))
            if (smokeMode && typeof event.message === "string" && event.message.indexOf("QT_WEBUI_SMOKE_") === 0) console.log(event.message)
            break
        case "extension.status":
            handleExtensionStatus(event)
            break
        case "composer.setText":
            composerTextRequested(String(event.text || ""))
            break
        case "window.title":
            windowTitle = typeof event.title === "string" && event.title.length > 0 ? boundedText(event.title, 120) : "Qt WebUI"
            break
        case "queue.update":
            steeringQueue = Array.isArray(event.steering) ? event.steering : []
            followUpQueue = Array.isArray(event.followUp) ? event.followUp : []
            break
        case "notice":
            postNotice(String(event.level || "info"), String(event.message || ""))
            if (smokeMode && /invalid Pi RPC record/i.test(String(event.message))) console.log("QT_WEBUI_SMOKE_PARSE_RECOVERED")
            break
        case "events.dropped":
            droppedEvents += Number(event.count) || 0
            postNotice("warning", (Number(event.count) || 0) + " backend events were dropped while the window was busy")
            break
        case "settings.changed":
            applySettings(event.settings)
            break
        default:
            break
        }
    }

    function handleFrame(frame) {
        if (!frame || typeof frame !== "object") return
        if (frame.v !== protocolVersion) {
            showError("Backend protocol version mismatch: " + String(frame.v))
            return
        }
        if (frame.kind === "response") {
            if (!settlePending(String(frame.id), frame)) staleResponses++
            return
        }
        if (frame.kind === "event" && typeof frame.type === "string") handleEvent(frame)
    }

    function handleLine(data) {
        let line = typeof data === "string" ? data : String(data)
        if (line.endsWith("\r")) line = line.slice(0, -1)
        if (line.length === 0) return
        try {
            handleFrame(JSON.parse(line))
        } catch (error) {
            showError("Invalid backend record: " + error)
        }
    }

    // ---- backend lifecycle ---------------------------------------------------------------

    function startBackend() {
        if (backendProcess.running) return
        backendReady = false
        ready = false
        active = false
        visibleError = ""
        statusKind = "stopped"
        statusText = "Starting…"
        backendProcess.running = true
    }

    function shutdown() {
        quitting = true
        if (backendProcess.running) request("shutdown", {}, () => {})
        shutdownTimer.start()
    }

    // Usage statistics are re-read shortly after a run ends or a tab is shown.
    Timer {
        id: usageTimer
        interval: 250
        repeat: false
        onTriggered: bridge.loadSessionStats()
    }

    Timer {
        id: pendingSweepTimer
        interval: 500
        repeat: true
        onTriggered: bridge.sweepPending()
    }

    Timer {
        id: backendStartupTimer
        interval: bridge.backendStartupMs
        repeat: false
        onTriggered: if (!bridge.backendReady && backendProcess.running) bridge.showError("Backend did not report readiness in time")
    }

    Timer {
        id: shutdownTimer
        interval: 1500
        repeat: false
        onTriggered: {
            backendProcess.running = false
            Qt.quit()
        }
    }

    Process {
        id: backendProcess
        command: [
            String(Quickshell.env("QT_WEBUI_NODE_EXECUTABLE") || ""),
            String(Quickshell.env("QT_WEBUI_BACKEND_ENTRY") || "")
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
                if (String(data).trim().length > 0) bridge.postNotice("error", "Backend: " + String(data))
            }
        }

        onStarted: {
            bridge.backendReady = false
            bridge.ready = false
            bridge.active = false
            bridge.statusKind = "stopped"
            bridge.statusText = "Starting…"
            backendStartupTimer.start()
        }

        onExited: (exitCode, exitStatus) => {
            backendStartupTimer.stop()
            bridge.backendReady = false
            bridge.ready = false
            bridge.active = false
            bridge.backendExitCode = exitCode
            bridge.restarting = false
            bridge.statusChips = []
            bridge.currentProvider = ""
            bridge.currentModelId = ""
            bridge.currentModelName = ""
            bridge.currentModelReasoning = false
            bridge.currentThinkingLevel = ""
            bridge.modelActionPending = false
            bridge.compacting = false
            bridge.attachments = []
            bridge.commands = []
            bridge.commandsLoaded = false
            bridge.tabs = []
            bridge.activeTabId = ""
            bridge.usage = null
            bridge.failAllPending("not_running", "Backend exited")
            bridge.clearDialogs(bridge.activeDialog || bridge.dialogQueue.length > 0 ? "Pending extension dialogs were cancelled because the backend exited" : "")
            if (bridge.quitting) {
                Qt.quit()
                return
            }
            bridge.statusKind = "error"
            bridge.statusText = "Backend exited (" + exitCode + ")"
            bridge.visibleError = bridge.boundedError("The Qt WebUI backend exited with code " + exitCode + ". Use Restart to start it again.")
            bridge.backendExited(exitCode)
        }
    }
}
