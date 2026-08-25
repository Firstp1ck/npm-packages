import QtQuick
import QtQuick.Controls
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
    property string pickerKind: ""
    property bool searchOpen: false
    property string searchQuery: ""
    property var searchMatches: []
    property int searchIndex: -1
    readonly property int searchMatchCount: searchMatches.length
    readonly property int searchCurrentRow: searchIndex >= 0 && searchIndex < searchMatches.length ? searchMatches[searchIndex] : -1

    // Metrics grouped by the publisher's own sections so related values share one frame.
    readonly property var statusGroups: groupStatusChips(bridge.statusChips, bridge.statusEntries)

    signal linkOpenResult(string url, var response)

    function groupStatusChips(chips, entries) {
        const groups = []
        const byName = {}
        const add = (name, entry) => {
            if (!byName[name]) {
                byName[name] = { name: name, entries: [] }
                groups.push(byName[name])
            }
            byName[name].entries.push(entry)
        }
        for (const chip of chips) add(chip.group === "meta" ? "Git" : "Session", chip)
        for (const entry of entries) add("Extensions", entry)
        return groups
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
        if (!bridge.ready || bridge.active || bridge.modelActionPending || pickerDialogItem.opened) return false
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
        if (!bridge.ready || bridge.active || bridge.modelActionPending || pickerDialogItem.opened) return false
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
        }
    }

    function compactContext() {
        return bridge.compactContext("")
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

                // Context line: where Pi works, and which model and thinking effort answer -------
                RowLayout {
                    Layout.fillWidth: true
                    spacing: 6
                    Accessible.role: Accessible.Grouping
                    Accessible.name: "Workspace " + bridge.callerCwd + (bridge.runtimeInfoText.length > 0 ? ", model " + bridge.runtimeInfoText : "")

                    Label {
                        Layout.fillWidth: true
                        text: bridge.displayCwd
                        textFormat: Text.PlainText
                        color: appTheme.muted
                        elide: Text.ElideMiddle
                        font.pixelSize: 12
                        Accessible.role: Accessible.StaticText
                        Accessible.name: "Workspace " + bridge.callerCwd
                    }

                    AppButton {
                        id: modelButton
                        visible: bridge.runtimeInfoText.length > 0
                        theme: appTheme
                        variant: "ghost"
                        text: bridge.currentProvider + "/" + bridge.currentModelId
                        accessibleName: "Model " + bridge.currentProvider + "/" + bridge.currentModelId + (bridge.currentModelName.length > 0 ? " (" + bridge.currentModelName + ")" : "") + ", choose a model"
                        accessibleDescription: "Ctrl+M opens the list, Ctrl+Shift+P cycles"
                        enabled: bridge.ready && !bridge.active && !bridge.modelActionPending
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
                        enabled: bridge.ready && !bridge.active && !bridge.modelActionPending
                        padding: 4
                        leftPadding: 8
                        rightPadding: 8
                        onClicked: root.openThinkingPicker()
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
                    onSendRequested: (text, mode) => {
                        if (bridge.sendPrompt(text, mode)) clearAndFocus()
                    }
                    onAbortRequested: bridge.abortRun()
                    onRestartRequested: bridge.restartProcess()
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
