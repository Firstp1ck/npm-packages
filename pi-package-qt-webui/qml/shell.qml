import QtQuick
import QtQuick.Controls
import QtQuick.Dialogs
import QtQuick.Layouts
import Quickshell
import "components"
import "dialogs"

ShellRoot {
    id: root

    readonly property bool smokeMode: Quickshell.env("QT_WEBUI_SMOKE_MODE") === "1"
    readonly property bool themeDark: appTheme.dark
    readonly property var backendBridge: bridge
    readonly property var extensionDialog: extensionDialogItem
    readonly property bool linkDialogOpened: linkDialogItem.opened
    readonly property var pickerDialog: pickerDialogItem
    readonly property var composerItem: composer
    readonly property var sequencesDialog: sequencesDialogItem
    readonly property var attachmentEditor: attachmentEditorItem
    readonly property var directoryDialog: directoryDialogItem
    readonly property var confirmDialog: confirmDialogItem
    readonly property var inputDialog: inputDialogItem
    readonly property var eventsDialog: eventsDialogItem
    readonly property var diagnosticsDialog: diagnosticsDialogItem
    readonly property var resourceProfilesDialog: resourceProfilesDialogItem
    property var paletteModels: []
    property var paletteSessions: []
    property string draftKeyInUse: ""
    property string pickerKind: ""
    property string pendingPathQuery: ""
    property bool searchOpen: false
    property string searchQuery: ""
    property var searchMatches: []
    property int searchIndex: -1
    readonly property int searchMatchCount: searchMatches.length
    readonly property int searchCurrentRow: searchIndex >= 0 && searchIndex < searchMatches.length ? searchMatches[searchIndex] : -1

    // Metrics grouped by the publisher's own sections so related values share one frame.
    readonly property var statusGroups: groupStatusChips(bridge.statusChips, bridge.statusEntries, bridge.usage)

    signal linkOpenResult(string url, var response)

    function formatCount(value) {
        const number = Number(value) || 0
        if (number >= 1000000) return (number / 1000000).toFixed(1) + "M"
        if (number >= 1000) return Math.round(number / 1000) + "k"
        return String(number)
    }

    function groupStatusChips(chips, entries, usage) {
        const groups = []
        const byName = {}
        const add = (name, entry) => {
            if (!byName[name]) {
                byName[name] = { name: name, entries: [] }
                groups.push(byName[name])
            }
            byName[name].entries.push(entry)
        }
        // Usage from Pi's own statistics: context fill, token totals, and cost for this session.
        if (usage) {
            if (usage.context && usage.context.percent !== null) add("Usage", { key: "context", label: "context", value: Math.round(usage.context.percent) + "%", title: formatCount(usage.context.tokens) + " of " + formatCount(usage.context.contextWindow) + " tokens in the context window", icon: "", tone: usage.context.percent >= 90 ? "error" : usage.context.percent >= 75 ? "warning" : "" })
            else if (usage.context) add("Usage", { key: "context", label: "context", value: "—", title: "Context usage is unknown until the next answer", icon: "", tone: "" })
            add("Usage", { key: "tokens", label: "tokens", value: formatCount(usage.tokens.total), title: "input " + formatCount(usage.tokens.input) + ", output " + formatCount(usage.tokens.output) + ", cache read " + formatCount(usage.tokens.cacheRead) + ", cache write " + formatCount(usage.tokens.cacheWrite), icon: "", tone: "" })
            add("Usage", { key: "cost", label: "cost", value: "$" + Number(usage.cost).toFixed(usage.cost >= 10 ? 0 : 2), title: usage.totalMessages + " messages, " + usage.toolCalls + " tool calls", icon: "", tone: "" })
        }
        for (const chip of chips) add(chip.group === "meta" ? "Git" : "Session", chip)
        for (const entry of entries) add("Extensions", entry)
        return groups
    }

    // ---- command palette --------------------------------------------------------------------

    function paletteActions() {
        return [
            ["new-tab", "New tab in this folder", "Ctrl+N"], ["open-folder", "Open a folder in a new tab", "Ctrl+O"], ["close-tab", "Close this tab", "Ctrl+W"], ["rename-tab", "Rename this tab", "F2"],
            ["resume-session", "Resume a saved session", "Ctrl+Shift+O"], ["new-session", "Start a new session", "Ctrl+Shift+N"], ["worktree", "Create a Git worktree", "Ctrl+Shift+B"],
            ["attach", "Attach files", "Ctrl+Shift+A"], ["sequences", "Saved prompt sequences", "Ctrl+Shift+S"], ["search", "Search the transcript", "Ctrl+F"],
            ["toggle-thinking", (bridge.showThinking ? "Hide" : "Show") + " thinking sections", "Ctrl+T"], ["toggle-compact", bridge.compactTranscript ? "Use comfortable rows" : "Use compact rows", "Ctrl+Shift+M"],
            ["toggle-highlighting", bridge.syntaxHighlighting ? "Turn off syntax highlighting" : "Turn on syntax highlighting", ""], ["toggle-notifications", bridge.desktopNotifications ? "Turn off desktop notifications" : "Turn on desktop notifications", ""],
            ["choose-model", "Choose a model", "Ctrl+M"], ["cycle-model", "Cycle to the next model", "Ctrl+Shift+P"], ["choose-thinking", "Choose the thinking effort", "Ctrl+E"], ["cycle-thinking", "Cycle the thinking effort", "Ctrl+Shift+E"],
            ["resource-profiles", "Configure tools, skills, and sampling", "Ctrl+Shift+R"], ["compact-context", "Compact the conversation context", ""], ["abort", "Abort the current run", "Ctrl+Shift+X"], ["restart", "Restart Pi in this tab", ""],
            ["events", "Show events", "Ctrl+Shift+L"], ["diagnostics", "Show diagnostics", "Ctrl+Shift+D"], ["focus-prompt", "Focus the prompt", "Ctrl+L"],
        ]
    }

    // Grouped, stably ordered: recent actions first, then actions, tabs, models, sessions, and
    // Pi commands. Capability-dependent groups are reloaded every time the palette opens.
    function paletteItems() {
        const recents = bridge.recentActions
        const items = []
        const push = (group, value, label, detail) => items.push({ group: group, value: value, label: label, detail: detail, current: false })
        const actions = paletteActions()
        const byRecency = key => { const index = recents.indexOf(key); return index === -1 ? recents.length : index }
        const sorted = actions.slice().sort((a, b) => byRecency("action:" + a[0]) - byRecency("action:" + b[0]))
        for (const action of sorted) push(recents.indexOf("action:" + action[0]) !== -1 ? "Recent" : "Action", "action:" + action[0], action[1], action[2])
        for (const tab of bridge.tabs) push("Tab", "tab:" + tab.id, "Switch to " + bridge.tabLabel(tab), tab.id === bridge.activeTabId ? "current tab" : String(tab.cwd))
        for (const model of paletteModels) push("Model", "model:" + model.provider + "/" + model.id, "Use " + (model.name.length > 0 ? model.name : model.id), model.provider + "/" + model.id + (model.provider === bridge.currentProvider && model.id === bridge.currentModelId ? " · current" : ""))
        for (const session of paletteSessions) push("Session", "session:" + session.path, "Resume " + (session.name && session.name.length > 0 ? session.name : session.firstMessage && session.firstMessage.length > 0 ? session.firstMessage : session.id), ageLabel(session.ageMs) + " · " + session.messageCount + " messages")
        for (const command of bridge.commands) {
            push("Pi command", "command:" + command.name, "/" + command.name, command.description)
            if (command.source === "skill" && command.path.length > 0) push("Skill", "skill:" + command.path, "Open skill file " + command.name.replace(/^skill:/, ""), command.path)
        }
        return items
    }

    function openPalette() {
        if (pickerDialogItem.opened) return false
        root.pickerKind = "palette"
        pickerDialogItem.present({ title: "Command palette", message: "", items: paletteItems(), searchable: true, emptyText: "Nothing matches" })
        // Refresh the capability-dependent groups; the list updates in place while it is open.
        if (bridge.ready) {
            bridge.loadModels(response => { if (response.ok) { paletteModels = response.data.models; refreshPalette() } })
            bridge.listSessions(response => { if (response.ok) { paletteSessions = response.data.sessions.slice(0, 10); refreshPalette() } })
            if (!bridge.commandsLoaded) bridge.loadCommands(() => refreshPalette())
        }
        return true
    }

    function refreshPalette() {
        if (pickerDialogItem.opened && root.pickerKind === "palette") pickerDialogItem.items = paletteItems()
    }

    function runPaletteAction(key) {
        switch (key) {
        case "new-tab": return bridge.openTab("", "")
        case "open-folder": return root.openDirectoryPicker()
        case "close-tab": return root.closeTab(bridge.activeTabId)
        case "rename-tab": return root.renameActiveTab()
        case "resume-session": return root.openSessionsPicker()
        case "new-session": return root.newSessionInTab()
        case "worktree": return root.planWorktree()
        case "attach": if (bridge.ready) fileDialog.open(); return true
        case "sequences": return root.openSequences()
        case "search": root.openSearch(); return true
        case "toggle-thinking": bridge.updateSetting("showThinking", !bridge.showThinking); return true
        case "toggle-compact": bridge.updateSetting("compactTranscript", !bridge.compactTranscript); return true
        case "toggle-highlighting": bridge.updateSetting("syntaxHighlighting", !bridge.syntaxHighlighting); return true
        case "toggle-notifications": bridge.updateSetting("desktopNotifications", !bridge.desktopNotifications); return true
        case "choose-model": return root.openModelPicker()
        case "cycle-model": return bridge.cycleModel()
        case "choose-thinking": return root.openThinkingPicker()
        case "cycle-thinking": return bridge.cycleThinkingLevel()
        case "resource-profiles": return root.openResourceProfiles()
        case "compact-context": return root.compactContext()
        case "abort": return bridge.abortRun()
        case "restart": return bridge.restartProcess()
        case "events": return root.openEvents()
        case "diagnostics": return root.openDiagnostics()
        case "focus-prompt": composer.focusEditor(); return true
        default: return false
        }
    }

    // Palette values are typed by prefix; a Pi command is inserted into the prompt, never sent.
    function palettePicked(value) {
        const colon = value.indexOf(":")
        const kind = colon > 0 ? value.slice(0, colon) : ""
        const payload = colon > 0 ? value.slice(colon + 1) : ""
        if (kind === "action") {
            bridge.recordAction(value)
            paletteActionTimer.action = payload
            paletteActionTimer.start()
        } else if (kind === "tab") {
            bridge.selectTab(payload)
        } else if (kind === "model") {
            const slash = payload.indexOf("/")
            if (slash > 0) bridge.selectModel(payload.slice(0, slash), payload.slice(slash + 1))
        } else if (kind === "session") {
            bridge.switchSession(payload)
        } else if (kind === "command") {
            bridge.recordAction(value)
            composer.setText("/" + payload + " ")
        } else if (kind === "skill") {
            confirmDialogItem.present({ title: "Open skill file?", message: "The file opens in your default application.", detail: payload, confirmLabel: "Open file", destructive: false, context: { action: "open-path", path: payload } })
        }
    }

    function openEvents() {
        if (eventsDialogItem.opened) return false
        eventsDialogItem.present()
        return true
    }

    function openDiagnostics() {
        if (diagnosticsDialogItem.opened) return false
        diagnosticsDialogItem.present()
        return true
    }

    function openResourceProfiles() {
        if (!bridge.ready || bridge.active || bridge.modelActionPending || bridge.resourceActionPending || resourceProfilesDialogItem.opened) return false
        resourceProfilesDialogItem.present()
        return true
    }

    Theme {
        id: appTheme
    }

    BackendBridge {
        id: bridge
        windowActive: root.smokeMode && smokeLoader.item && smokeLoader.item.forceUnfocused ? false : contentRoot.Window.active
        onComposerTextRequested: text => composer.setText(text)
        onNoticePosted: (level, message) => noticeBar.show(level, message)
        onDialogRequested: dialog => extensionDialogItem.present(dialog)
        onDialogFinished: requestId => {
            if (extensionDialogItem.opened && extensionDialogItem.requestId === requestId) {
                extensionDialogItem.answered = true
                extensionDialogItem.close()
            }
        }
        onTranscriptModelChanged: root.runSearch()
    }

    // ---- search ---------------------------------------------------------------------------

    function rowSearchText(row) {
        if (row.kind === "tool") return row.toolName + "\n" + row.toolSummary + "\n" + row.toolOutput + "\n" + row.toolError
        return row.text
    }

    function runSearch() {
        const query = searchQuery.trim().toLowerCase()
        if (query.length === 0) {
            searchMatches = []
            searchIndex = -1
            return
        }
        const matches = []
        for (let index = 0; index < bridge.transcriptModel.count; index++) {
            if (rowSearchText(bridge.transcriptModel.get(index)).toLowerCase().indexOf(query) !== -1) matches.push(index)
        }
        searchMatches = matches
        if (matches.length === 0) searchIndex = -1
        else if (searchIndex < 0 || searchIndex >= matches.length) searchIndex = matches.length - 1
        revealSearchRow()
    }

    function revealSearchRow() {
        if (searchCurrentRow >= 0) {
            transcriptList.followOutput = false
            transcriptList.positionViewAtIndex(searchCurrentRow, ListView.Center)
        }
    }

    function openSearch(query) {
        searchOpen = true
        if (typeof query === "string") searchBar.query = query
        searchQuery = searchBar.query
        runSearch()
        searchBar.focusField()
    }

    function closeSearch() {
        searchOpen = false
        searchQuery = ""
        searchMatches = []
        searchIndex = -1
        composer.focusEditor()
    }

    function searchNext() {
        if (searchMatches.length === 0) return
        searchIndex = (searchIndex + 1) % searchMatches.length
        revealSearchRow()
    }

    function searchPrevious() {
        if (searchMatches.length === 0) return
        searchIndex = (searchIndex - 1 + searchMatches.length) % searchMatches.length
        revealSearchRow()
    }

    // ---- models, thinking, and compaction ------------------------------------------------

    function openModelPicker() {
        if (!bridge.ready || bridge.active || bridge.modelActionPending || bridge.resourceActionPending || pickerDialogItem.opened) return false
        return bridge.loadModels(response => {
            if (!response.ok) return
            const items = []
            for (const model of response.data.models) {
                const identity = model.provider + "/" + model.id
                const traits = [model.reasoning ? "thinking" : "no thinking", model.acceptsImages ? "images" : "", model.contextWindow > 0 ? Math.round(model.contextWindow / 1000) + "k context" : ""]
                items.push({ value: identity, label: model.name.length > 0 ? model.name + "  ·  " + identity : identity,
                             detail: traits.filter(trait => trait.length > 0).join(" · "),
                             current: model.provider === bridge.currentProvider && model.id === bridge.currentModelId })
            }
            root.pickerKind = "model"
            pickerDialogItem.present({ title: "Choose a model", message: response.data.omitted > 0 ? response.data.omitted + " configured models are not listed" : "", items: items, searchable: true, emptyText: "Pi reports no configured models" })
        })
    }

    function openThinkingPicker() {
        if (!bridge.ready || bridge.active || bridge.modelActionPending || bridge.resourceActionPending || pickerDialogItem.opened) return false
        return bridge.loadThinkingLevels(response => {
            if (!response.ok) return
            const items = []
            for (const level of response.data.levels) items.push({ value: level, label: level, detail: "", current: level === bridge.currentThinkingLevel })
            root.pickerKind = "thinking"
            pickerDialogItem.present({ title: "Thinking effort", message: response.data.levels.length <= 1 ? "The current model has no thinking levels" : "", items: items, searchable: false })
        })
    }

    function pickerPicked(value) {
        const kind = root.pickerKind
        root.pickerKind = ""
        if (kind === "model") {
            const slash = value.indexOf("/")
            if (slash > 0) bridge.selectModel(value.slice(0, slash), value.slice(slash + 1))
        } else if (kind === "thinking") {
            bridge.setThinkingLevel(value)
        } else if (kind === "session") {
            bridge.switchSession(value)
        } else if (kind === "palette") {
            root.palettePicked(value)
        }
    }

    // ---- tabs, sessions, directories, worktrees --------------------------------------------

    function ageLabel(ageMs) {
        const minutes = Math.round(Number(ageMs) / 60000)
        if (minutes < 2) return "just now"
        if (minutes < 60) return minutes + " min ago"
        const hours = Math.round(minutes / 60)
        if (hours < 48) return hours + " h ago"
        return Math.round(hours / 24) + " days ago"
    }

    function openSessionsPicker() {
        if (!bridge.ready || bridge.active || pickerDialogItem.opened) return false
        return bridge.listSessions(response => {
            if (!response.ok) return
            const items = []
            for (const session of response.data.sessions) {
                const label = session.name && session.name.length > 0 ? session.name : (session.firstMessage && session.firstMessage.length > 0 ? session.firstMessage : session.id)
                items.push({ value: session.path, label: label, detail: ageLabel(session.ageMs) + " · " + session.messageCount + (session.messageCount === 1 ? " message" : " messages") + (session.scanTruncated ? " (partial scan)" : ""),
                             current: session.path === response.data.current })
            }
            root.pickerKind = "session"
            pickerDialogItem.present({ title: "Resume a session", message: response.data.omitted > 0 ? response.data.omitted + " older sessions are not listed" : "", items: items, searchable: true, emptyText: "No saved sessions for this folder" })
        })
    }

    function newSessionInTab() {
        return bridge.newSession()
    }

    function openDirectoryPicker() {
        if (directoryDialogItem.opened) return false
        directoryDialogItem.present(bridge.workspaceCwd)
        return true
    }

    // Idle tabs close at once; a working tab asks first because closing aborts its run.
    function closeTab(tabId) {
        const tab = bridge.tabById(tabId)
        if (!tab) return false
        if (tab.active) {
            confirmDialogItem.present({
                title: "Close tab while Pi is working?",
                message: "Closing " + bridge.tabLabel(tab) + " aborts the current run and stops its Pi process.",
                detail: String(tab.cwd), confirmLabel: "Abort and close", destructive: true, context: { action: "close-tab", tabId: tabId }
            })
            return true
        }
        return bridge.closeTab(tabId, false)
    }

    function renameActiveTab() {
        const tab = bridge.activeTab
        if (!tab) return false
        inputDialogItem.present({ title: "Rename tab", message: "The name is also stored as the Pi session name.", placeholder: "Tab name", prefill: bridge.tabLabel(tab), maxCharacters: 64,
                                  validate: text => text.trim().length === 0 ? "Enter a name" : "", context: { action: "rename-tab", tabId: tab.id } })
        return true
    }

    function branchProblem(text) {
        const value = String(text || "").trim()
        if (value.length === 0) return "Enter a branch name"
        if (/[\s~^:?*\[\\]/.test(value) || value.indexOf("..") !== -1 || value.indexOf("@{") !== -1 || value.startsWith("-") || value.startsWith("/") || value.endsWith("/") || value.endsWith(".") || value.endsWith(".lock")) return "Branch names cannot contain spaces, ~ ^ : ? * [ \\, or \"..\", and cannot start with - or /"
        return ""
    }

    // Asks for a branch name (unless given), shows the exact path and base from the backend's
    // plan, and creates the worktree only after confirmation.
    function planWorktree(branch) {
        if (typeof branch !== "string") {
            inputDialogItem.present({ title: "New worktree", message: "Create a branch and check it out in a new folder next to the repository, then open it in a new tab.", placeholder: "feature/name", maxCharacters: 128,
                                      validate: root.branchProblem, submitLabel: "Continue", context: { action: "worktree" } })
            return true
        }
        return bridge.planWorktree(branch, response => {
            if (!response.ok) return
            const plan = response.data
            if (plan.problems.length > 0) {
                bridge.postNotice("error", "Cannot create the worktree: " + plan.problems.join("; "))
                return
            }
            confirmDialogItem.present({
                title: "Create worktree?",
                message: "Branch " + plan.branch + " from " + plan.base + (plan.detachedBase ? " (detached HEAD)" : "") + (plan.nested ? ", inside the repository" : "") + ". The worktree opens in a new tab.",
                detail: plan.path, confirmLabel: "Create worktree", destructive: false, context: { action: "worktree", plan: plan }
            })
        })
    }

    function confirmAccepted(context) {
        if (!context) return
        if (context.action === "close-tab") bridge.closeTab(String(context.tabId), true)
        else if (context.action === "worktree") bridge.createWorktree(context.plan.branch, context.plan.base, context.plan.path)
        else if (context.action === "open-path") bridge.openPath(String(context.path))
    }

    function inputSubmitted(text, context) {
        if (!context) return
        if (context.action === "rename-tab") bridge.renameTab(String(context.tabId), text)
        else if (context.action === "worktree") root.planWorktree(text)
    }

    // The composer belongs to the tab: save the unsent text under the previous key before the
    // new tab's draft is loaded.
    function handleDraftKeyChanged() {
        if (draftKeyInUse.length > 0 && draftKeyInUse !== bridge.draftKey && composer.text.trim().length > 0) bridge.saveDraftFor(draftKeyInUse, composer.text)
        draftKeyInUse = bridge.draftKey
        if (bridge.ready) bridge.loadDraft()
    }

    function compactContext() {
        return bridge.compactContext("")
    }

    // ---- composer: completion, attachments, drafts, sequences --------------------------------

    function commandSuggestions(query) {
        const needle = String(query || "").toLowerCase()
        const items = []
        for (const command of bridge.commands) {
            const name = String(command.name)
            if (needle.length > 0 && name.toLowerCase().indexOf(needle) !== 0) continue
            const source = command.source === "skill" ? "skill" : command.source === "prompt" ? "prompt template" : ""
            items.push({ value: name, label: "/" + name, detail: [command.description, source].filter(part => part && part.length > 0).join(" · ") })
            if (items.length >= 50) break
        }
        return items
    }

    function requestCompletion(kind, query) {
        if (kind === "command") {
            if (bridge.commandsLoaded) {
                composer.completions = commandSuggestions(query)
                composer.completionEmptyText = composer.completions.length === 0 ? "No matching command" : ""
            } else {
                bridge.loadCommands(response => {
                    if (composer.completionKind !== "command") return
                    composer.completions = commandSuggestions(composer.completionQuery)
                    composer.completionEmptyText = composer.completions.length === 0 ? (response.ok ? "No matching command" : "Commands are unavailable") : ""
                })
            }
        } else if (kind === "path") {
            pendingPathQuery = query
            pathCompletionTimer.restart()
        } else {
            composer.completions = []
            composer.completionEmptyText = ""
        }
    }

    function completePendingPath() {
        const query = pendingPathQuery
        bridge.completePath(query, response => {
            if (composer.completionKind !== "path" || composer.completionQuery !== query) return
            if (!response.ok) {
                composer.completions = []
                composer.completionEmptyText = "Paths are unavailable"
                return
            }
            composer.completions = response.data.suggestions.map(entry => ({
                value: entry.path, label: entry.path + (entry.directory ? "/" : ""), detail: entry.directory ? "directory" : "", directory: entry.directory === true
            }))
            composer.completionEmptyText = composer.completions.length === 0 ? "No matching workspace path" : ""
        })
    }

    function urlToPath(url) {
        let text = String(url)
        if (text.indexOf("file://") === 0) text = text.slice(7)
        try {
            return decodeURIComponent(text)
        } catch (error) {
            return text
        }
    }

    function editAttachment(attachmentId) {
        for (const attachment of bridge.attachments) {
            if (String(attachment.id) !== String(attachmentId) || attachment.kind !== "text") continue
            attachmentEditorItem.attachmentId = String(attachmentId)
            attachmentEditorItem.present({ title: "Edit " + attachment.name, text: attachment.text, maxCharacters: 262144 })
            return true
        }
        return false
    }

    function openSequences() {
        if (sequencesDialogItem.opened) return false
        sequencesDialogItem.present()
        return true
    }

    function restoreDraft(key, text) {
        if (key !== bridge.draftKey || text.length === 0 || composer.text.trim().length > 0) return
        composer.setText(text)
    }

    // ---- links and dialogs ---------------------------------------------------------------

    function confirmLink(url) {
        linkDialogItem.present(url)
    }

    function acceptLink() {
        linkDialogItem.accept()
    }

    function extensionDialogInputText(value) {
        extensionDialogItem.setInputText(value)
    }

    function extensionDialogEditorText(value) {
        extensionDialogItem.setEditorText(value)
    }

    FloatingWindow {
        id: window
        visible: true
        title: bridge.windowTitle
        implicitWidth: 860
        implicitHeight: 760
        minimumSize: Qt.size(560, 520)
        color: appTheme.windowBackground
        surfaceFormat.opaque: true

        Rectangle {
            id: contentRoot
            parent: window.contentItem
            anchors.fill: parent
            color: appTheme.windowBackground

            Shortcut {
                sequence: "Ctrl+F"
                onActivated: root.openSearch()
            }
            Shortcut {
                sequence: "Ctrl+T"
                onActivated: bridge.updateSetting("showThinking", !bridge.showThinking)
            }
            Shortcut {
                sequence: "Ctrl+Shift+M"
                onActivated: bridge.updateSetting("compactTranscript", !bridge.compactTranscript)
            }
            Shortcut {
                sequence: "Ctrl+Shift+X"
                onActivated: bridge.abortRun()
            }
            Shortcut {
                sequence: "Ctrl+L"
                onActivated: composer.focusEditor()
            }
            Shortcut {
                sequence: "Ctrl+M"
                onActivated: root.openModelPicker()
            }
            Shortcut {
                sequence: "Ctrl+Shift+P"
                onActivated: bridge.cycleModel()
            }
            Shortcut {
                sequence: "Ctrl+E"
                onActivated: root.openThinkingPicker()
            }
            Shortcut {
                sequence: "Ctrl+Shift+E"
                onActivated: bridge.cycleThinkingLevel()
            }
            Shortcut {
                sequence: "Ctrl+Shift+R"
                onActivated: root.openResourceProfiles()
            }
            Shortcut {
                sequence: "Ctrl+Shift+S"
                onActivated: root.openSequences()
            }
            Shortcut {
                sequence: "Ctrl+Shift+A"
                onActivated: if (bridge.ready) fileDialog.open()
            }
            Shortcut {
                sequence: "Ctrl+N"
                onActivated: bridge.openTab("", "")
            }
            Shortcut {
                sequence: "Ctrl+O"
                onActivated: root.openDirectoryPicker()
            }
            Shortcut {
                sequence: "Ctrl+W"
                onActivated: root.closeTab(bridge.activeTabId)
            }
            Shortcut {
                sequence: "Ctrl+Tab"
                onActivated: bridge.cycleTab(1)
            }
            Shortcut {
                sequence: "Ctrl+Shift+Tab"
                onActivated: bridge.cycleTab(-1)
            }
            Shortcut {
                sequence: "Ctrl+Shift+O"
                onActivated: root.openSessionsPicker()
            }
            Shortcut {
                sequence: "Ctrl+Shift+N"
                onActivated: root.newSessionInTab()
            }
            Shortcut {
                sequence: "Ctrl+Shift+B"
                onActivated: root.planWorktree()
            }
            Shortcut {
                sequence: "F2"
                onActivated: root.renameActiveTab()
            }
            Shortcut {
                sequence: "Ctrl+K"
                onActivated: root.openPalette()
            }
            Shortcut {
                sequence: "Ctrl+Shift+L"
                onActivated: root.openEvents()
            }
            Shortcut {
                sequence: "Ctrl+Shift+D"
                onActivated: root.openDiagnostics()
            }

            // Palette actions run after the picker has closed so dialogs they open get focus.
            Timer {
                id: paletteActionTimer
                property string action: ""
                interval: 30
                repeat: false
                onTriggered: root.runPaletteAction(action)
            }
            Instantiator {
                model: 8
                delegate: Shortcut {
                    required property int index
                    sequence: "Ctrl+" + (index + 1)
                    onActivated: bridge.selectTabIndex(index)
                }
            }

            // Drafts are saved shortly after typing stops and restored when the same session is
            // shown again with an empty editor.
            Timer {
                id: draftTimer
                interval: 600
                repeat: false
                onTriggered: bridge.saveDraft(composer.text)
            }

            Timer {
                id: pathCompletionTimer
                interval: 120
                repeat: false
                onTriggered: root.completePendingPath()
            }

            Connections {
                target: bridge
                function onReadyChanged() {
                    if (bridge.ready) {
                        root.draftKeyInUse = bridge.draftKey
                        bridge.loadDraft()
                    }
                }
                function onDraftKeyChanged() {
                    root.handleDraftKeyChanged()
                }
                function onDraftLoaded(key, text) {
                    root.restoreDraft(key, text)
                }
                function onTabSwitched(tabId) {
                    composer.text = ""
                    root.closeSearch()
                }
            }

            FileDialog {
                id: fileDialog
                title: "Attach files"
                fileMode: FileDialog.OpenFiles
                currentFolder: "file://" + bridge.workspaceCwd
                onAccepted: {
                    // Files chosen through the picker are explicitly granted, even outside the workspace.
                    for (const url of selectedFiles) bridge.addAttachment(root.urlToPath(url), true)
                    composer.focusEditor()
                }
                onRejected: composer.focusEditor()
            }

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 16
                spacing: 10

                // Top bar: identity and status on the left, view controls on the right --------
                RowLayout {
                    Layout.fillWidth: true
                    spacing: 10

                    Label {
                        text: "Qt WebUI"
                        textFormat: Text.PlainText
                        color: appTheme.heading
                        font.pixelSize: 18
                        font.bold: true
                        Accessible.role: Accessible.Heading
                    }

                    StatusBadge {
                        theme: appTheme
                        kind: bridge.statusKind
                        text: bridge.statusText
                        fontSize: 11
                        Accessible.name: "Status " + bridge.statusText
                    }

                    Label {
                        Layout.fillWidth: true
                        text: bridge.sessionName
                        textFormat: Text.PlainText
                        color: appTheme.muted
                        font.pixelSize: 12
                        elide: Text.ElideRight
                    }

                    AppButton {
                        theme: appTheme
                        variant: "ghost"
                        active: bridge.showThinking
                        text: "Thinking"
                        accessibleName: (bridge.showThinking ? "Hide" : "Show") + " thinking sections"
                        accessibleDescription: "Ctrl+T"
                        onClicked: bridge.updateSetting("showThinking", !bridge.showThinking)
                    }

                    AppButton {
                        theme: appTheme
                        variant: "ghost"
                        active: bridge.compactTranscript
                        text: "Compact"
                        accessibleName: bridge.compactTranscript ? "Use comfortable transcript rows" : "Use compact transcript rows"
                        accessibleDescription: "Ctrl+Shift+M"
                        onClicked: bridge.updateSetting("compactTranscript", !bridge.compactTranscript)
                    }

                    AppButton {
                        theme: appTheme
                        variant: "ghost"
                        text: "Palette"
                        accessibleName: "Open the command palette"
                        accessibleDescription: "Ctrl+K"
                        onClicked: root.openPalette()
                    }

                    AppButton {
                        theme: appTheme
                        variant: "ghost"
                        active: root.searchOpen
                        text: "Search"
                        accessibleName: "Search transcript"
                        accessibleDescription: "Ctrl+F"
                        onClicked: root.searchOpen ? root.closeSearch() : root.openSearch()
                    }

                    AppButton {
                        theme: appTheme
                        variant: bridge.backendRunning && bridge.ready ? "ghost" : "warning"
                        text: bridge.restarting ? "Restarting…" : (bridge.backendRunning ? "Restart Pi" : "Start backend")
                        accessibleName: bridge.restarting ? "Pi is restarting" : "Restart Pi"
                        enabled: !bridge.active && !bridge.restarting
                        onClicked: bridge.restartProcess()
                    }
                }

                // Tabs: one Pi session per tab ---------------------------------------------------
                TabStrip {
                    Layout.fillWidth: true
                    theme: appTheme
                    tabs: bridge.tabs
                    activeTabId: bridge.activeTabId
                    maxTabs: bridge.maxTabs
                    homeDirectory: bridge.homeDirectory
                    onSelectRequested: tabId => bridge.selectTab(tabId)
                    onCloseRequested: tabId => root.closeTab(tabId)
                    onNewTabRequested: bridge.openTab("", "")
                    onOpenDirectoryRequested: root.openDirectoryPicker()
                }

                // Context line: where Pi works, and which model and thinking effort answer -------
                RowLayout {
                    Layout.fillWidth: true
                    spacing: 6
                    Accessible.role: Accessible.Grouping
                    Accessible.name: "Workspace " + bridge.workspaceCwd + (bridge.runtimeInfoText.length > 0 ? ", model " + bridge.runtimeInfoText : "")

                    Label {
                        Layout.fillWidth: true
                        text: bridge.displayCwd
                        textFormat: Text.PlainText
                        color: appTheme.muted
                        elide: Text.ElideMiddle
                        font.pixelSize: 12
                        Accessible.role: Accessible.StaticText
                        Accessible.name: "Workspace " + bridge.workspaceCwd
                    }

                    AppButton {
                        visible: bridge.ready
                        theme: appTheme
                        variant: "ghost"
                        text: "Sessions"
                        accessibleName: "Resume a saved session in this tab"
                        accessibleDescription: "Ctrl+Shift+O opens the list, Ctrl+Shift+N starts a new session"
                        enabled: !bridge.active
                        padding: 4
                        leftPadding: 8
                        rightPadding: 8
                        onClicked: root.openSessionsPicker()
                    }

                    AppButton {
                        visible: bridge.ready
                        theme: appTheme
                        variant: "ghost"
                        text: "Worktree"
                        accessibleName: "Create a Git worktree in a new tab"
                        accessibleDescription: "Ctrl+Shift+B"
                        padding: 4
                        leftPadding: 8
                        rightPadding: 8
                        onClicked: root.planWorktree()
                    }

                    AppButton {
                        id: modelButton
                        visible: bridge.runtimeInfoText.length > 0
                        theme: appTheme
                        variant: "ghost"
                        text: bridge.currentProvider + "/" + bridge.currentModelId
                        accessibleName: "Model " + bridge.currentProvider + "/" + bridge.currentModelId + (bridge.currentModelName.length > 0 ? " (" + bridge.currentModelName + ")" : "") + ", choose a model"
                        accessibleDescription: "Ctrl+M opens the list, Ctrl+Shift+P cycles"
                        enabled: bridge.ready && !bridge.active && !bridge.modelActionPending && !bridge.resourceActionPending
                        padding: 4
                        leftPadding: 8
                        rightPadding: 8
                        onClicked: root.openModelPicker()
                        ToolTip.visible: hovered && bridge.currentModelName.length > 0
                        ToolTip.text: bridge.currentModelName
                        ToolTip.delay: 400
                    }

                    AppButton {
                        id: thinkingButton
                        visible: bridge.runtimeInfoText.length > 0
                        theme: appTheme
                        variant: "ghost"
                        text: "thinking " + bridge.currentThinkingLevel
                        accessibleName: "Thinking effort " + bridge.currentThinkingLevel + ", choose a level"
                        accessibleDescription: "Ctrl+E opens the list, Ctrl+Shift+E cycles"
                        enabled: bridge.ready && !bridge.active && !bridge.modelActionPending && !bridge.resourceActionPending
                        padding: 4
                        leftPadding: 8
                        rightPadding: 8
                        onClicked: root.openThinkingPicker()
                    }

                    AppButton {
                        id: resourceProfilesButton
                        visible: bridge.ready
                        theme: appTheme
                        variant: "ghost"
                        text: bridge.resourceLoading ? "Resources…" : "Resources"
                        accessibleName: "Configure tool, skill, and sampling profiles"
                        accessibleDescription: "Ctrl+Shift+R; session, exact-model, and global scopes"
                        enabled: !bridge.active && !bridge.modelActionPending && !bridge.resourceActionPending && !bridge.resourceLoading
                        padding: 4
                        leftPadding: 8
                        rightPadding: 8
                        onClicked: root.openResourceProfiles()
                    }

                    AppButton {
                        visible: bridge.ready && bridge.transcriptModel.count > 0
                        theme: appTheme
                        variant: "ghost"
                        text: bridge.compacting ? "Compacting…" : "Compact context"
                        accessibleName: bridge.compacting ? "Context compaction is running" : "Compact the conversation context"
                        accessibleDescription: "Summarizes older conversation so Pi keeps room for new work"
                        enabled: !bridge.active && !bridge.compacting
                        padding: 4
                        leftPadding: 8
                        rightPadding: 8
                        onClicked: root.compactContext()
                    }
                }

                // Error panel ----------------------------------------------------------------
                Rectangle {
                    Layout.fillWidth: true
                    visible: bridge.visibleError.length > 0
                    implicitHeight: errorLabel.implicitHeight + 20
                    radius: 8
                    color: appTheme.errorPanelBackground
                    border.width: 1
                    border.color: appTheme.errorPanelBorder
                    Accessible.role: Accessible.AlertMessage
                    Accessible.name: "Error: " + bridge.visibleError

                    Label {
                        id: errorLabel
                        anchors.fill: parent
                        anchors.margins: 10
                        text: bridge.visibleError
                        color: appTheme.errorPanelForeground
                        wrapMode: Text.Wrap
                        textFormat: Text.PlainText
                        font.pixelSize: 12
                    }
                }

                SearchBar {
                    id: searchBar
                    Layout.fillWidth: true
                    visible: root.searchOpen
                    theme: appTheme
                    matchCount: root.searchMatchCount
                    currentIndex: root.searchIndex
                    onQueryEdited: query => {
                        root.searchQuery = query
                        root.runSearch()
                    }
                    onNextRequested: root.searchNext()
                    onPreviousRequested: root.searchPrevious()
                    onCloseRequested: root.closeSearch()
                }

                // Transcript -------------------------------------------------------------------
                Item {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    clip: true

                    ListView {
                        id: transcriptList
                        anchors.fill: parent
                        anchors.rightMargin: 4
                        model: bridge.transcriptModel
                        spacing: bridge.compactTranscript ? 6 : 12
                        boundsBehavior: Flickable.StopAtBounds
                        cacheBuffer: 400
                        property bool followOutput: true
                        property bool positioning: false
                        Accessible.role: Accessible.List
                        Accessible.name: "Conversation transcript"

                        ScrollBar.vertical: ScrollBar {
                            policy: ScrollBar.AsNeeded
                        }

                        function followToEnd() {
                            positioning = true
                            positionViewAtEnd()
                            positioning = false
                        }

                        onContentYChanged: if (!positioning) followOutput = contentHeight - (contentY + height) < 48
                        onContentHeightChanged: if (followOutput) Qt.callLater(followToEnd)
                        onCountChanged: if (followOutput) Qt.callLater(followToEnd)

                        footer: WorkingIndicator {
                            width: transcriptList.width
                            theme: appTheme
                            running: bridge.active
                            statusText: bridge.statusText
                        }

                        delegate: TranscriptRow {
                            required property int index
                            width: transcriptList.width
                            theme: appTheme
                            compact: bridge.compactTranscript
                            showThinking: bridge.showThinking
                            highlightCode: bridge.syntaxHighlighting
                            searchMatch: root.searchMatches.indexOf(index) !== -1
                            searchCurrent: root.searchCurrentRow === index
                            onCopyRequested: text => bridge.copyToClipboard(text)
                            onLinkActivated: link => root.confirmLink(link)
                        }
                    }

                    EmptyState {
                        anchors.fill: parent
                        visible: transcriptList.count === 0
                        theme: appTheme
                        ready: bridge.ready
                        backendReady: bridge.backendReady
                        onRestartRequested: bridge.restartProcess()
                        onFocusComposerRequested: composer.focusEditor()
                        onResumeRequested: root.openSessionsPicker()
                        onOpenDirectoryRequested: root.openDirectoryPicker()
                    }
                }

                // Queue strip ------------------------------------------------------------------
                Rectangle {
                    Layout.fillWidth: true
                    visible: bridge.steeringQueue.length > 0 || bridge.followUpQueue.length > 0
                    implicitHeight: queueLabel.implicitHeight + 16
                    radius: 8
                    color: appTheme.surfaceRaised
                    border.width: 1
                    border.color: appTheme.border
                    Accessible.role: Accessible.StaticText
                    Accessible.name: queueLabel.text

                    Label {
                        id: queueLabel
                        anchors.fill: parent
                        anchors.margins: 8
                        text: (bridge.steeringQueue.length > 0 ? "Steering queued: " + bridge.steeringQueue.join(" · ") : "")
                            + (bridge.steeringQueue.length > 0 && bridge.followUpQueue.length > 0 ? "\n" : "")
                            + (bridge.followUpQueue.length > 0 ? "Follow-up queued: " + bridge.followUpQueue.join(" · ") : "")
                        textFormat: Text.PlainText
                        wrapMode: Text.Wrap
                        maximumLineCount: 4
                        elide: Text.ElideRight
                        color: appTheme.muted
                        font.pixelSize: 12
                    }
                }

                NoticeBar {
                    id: noticeBar
                    Layout.fillWidth: true
                    theme: appTheme
                }

                Composer {
                    id: composer
                    Layout.fillWidth: true
                    active: bridge.active
                    ready: bridge.ready
                    processRunning: bridge.backendRunning
                    theme: appTheme
                    maxCharacters: bridge.maxMessageCharacters
                    attachments: bridge.attachments
                    onSendRequested: (text, mode) => {
                        if (bridge.sendPrompt(text, mode)) {
                            clearAndFocus()
                            draftTimer.stop()
                            bridge.saveDraft("")
                        }
                    }
                    onAbortRequested: bridge.abortRun()
                    onRestartRequested: bridge.restartProcess()
                    onAttachRequested: fileDialog.open()
                    onSequencesRequested: root.openSequences()
                    onAttachmentRemoveRequested: attachmentId => bridge.removeAttachment(attachmentId)
                    onAttachmentEditRequested: attachmentId => root.editAttachment(attachmentId)
                    onCompletionRequested: (kind, query) => root.requestCompletion(kind, query)
                    onDraftEdited: text => draftTimer.restart()
                }

                // Footer: extension metrics as grouped segments; plain statuses on their own line -
                Flow {
                    Layout.fillWidth: true
                    visible: root.statusGroups.length > 0
                    spacing: 8
                    Accessible.role: Accessible.Grouping
                    Accessible.name: "Extension status"

                    Repeater {
                        model: root.statusGroups
                        delegate: StatusSegment {
                            required property var modelData
                            theme: appTheme
                            groupName: modelData.name
                            entries: modelData.entries
                        }
                    }
                }
            }

            ExtensionDialog {
                id: extensionDialogItem
                theme: appTheme
                bridge: bridge
                returnFocusItem: composer
            }

            LinkDialog {
                id: linkDialogItem
                theme: appTheme
                bridge: bridge
                returnFocusItem: composer
                onLinkOpened: (url, response) => root.linkOpenResult(url, response)
            }

            PickerDialog {
                id: pickerDialogItem
                theme: appTheme
                returnFocusItem: composer
                onPicked: value => root.pickerPicked(value)
                onCancelled: root.pickerKind = ""
            }

            SequencesDialog {
                id: sequencesDialogItem
                theme: appTheme
                bridge: bridge
                returnFocusItem: composer
                onLoadRequested: entries => composer.setText(entries.join("\n\n"))
            }

            EventsDialog {
                id: eventsDialogItem
                theme: appTheme
                bridge: bridge
                returnFocusItem: composer
            }

            DiagnosticsDialog {
                id: diagnosticsDialogItem
                theme: appTheme
                bridge: bridge
                returnFocusItem: composer
            }

            ResourceProfilesDialog {
                id: resourceProfilesDialogItem
                theme: appTheme
                bridge: bridge
                returnFocusItem: composer
            }

            DirectoryDialog {
                id: directoryDialogItem
                theme: appTheme
                bridge: bridge
                returnFocusItem: composer
                onChosen: path => bridge.openTab(path, "")
            }

            ConfirmDialog {
                id: confirmDialogItem
                theme: appTheme
                returnFocusItem: composer
                onConfirmed: context => root.confirmAccepted(context)
            }

            InputDialog {
                id: inputDialogItem
                theme: appTheme
                returnFocusItem: composer
                onSubmitted: (text, context) => root.inputSubmitted(text, context)
            }

            TextEditDialog {
                id: attachmentEditorItem
                property string attachmentId: ""
                theme: appTheme
                returnFocusItem: composer
                onSaved: text => bridge.updateAttachment(attachmentId, text)
            }

            Loader {
                id: smokeLoader
                active: root.smokeMode
                sourceComponent: SmokeDriver {
                    bridge: root.backendBridge
                    shell: root
                }
            }
        }
    }
}
