import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Global saved-session navigation. Saved sessions and open tabs stay separate concepts: an open
// tab is annotated onto its matching catalog row, while unsaved fresh tabs get a temporary row.
Rectangle {
    id: sessionList

    required property QtObject theme
    property var sessions: []
    property var tabs: []
    property var pendingSettlements: ({})
    property bool settleAllPending: false
    property string activeTabId: ""
    property int maxTabs: 8
    property string homeDirectory: ""
    property bool loading: false
    property string errorText: ""
    property bool settledExpanded: true
    property double ageClockMs: Date.now()
    property var orderedSessions: []
    property var committedSortModifiedByKey: ({})
    property alias searchQuery: workspaceSearchField.text

    readonly property int activitySortGraceMs: 5 * 60 * 1000
    readonly property string normalizedSearchQuery: searchQuery.trim().toLowerCase()
    readonly property bool searchActive: normalizedSearchQuery.length > 0
    readonly property var workingSessions: filterSessions(buildWorkingSessions())
    readonly property var settledSessions: filterSessions(buildSettledSessions())
    readonly property int unsettledSavedSessionCount: countUnsettledSavedSessions()

    signal sessionRequested(var session)
    signal settlementRequested(string sessionPath, bool settled)
    signal settleAllRequested()
    signal closeRequested(string tabId)
    signal newTabRequested()
    signal openDirectoryRequested()
    signal refreshRequested()

    color: theme.surfaceRaised
    border.width: theme.borderWidth
    border.color: theme.frameBorder
    radius: theme.radiusMedium
    Accessible.role: Accessible.Grouping
    Accessible.name: (searchActive ? "Filtered workspaces, " : "") + workingSessions.length + " working sessions and " + settledSessions.length + " settled sessions"

    function titleFor(session) {
        if (session.name && String(session.name).length > 0) return String(session.name)
        if (session.firstMessage && String(session.firstMessage).length > 0) return String(session.firstMessage)
        return String(session.id || "Untitled session")
    }

    function shortPath(cwd) {
        const text = String(cwd || "")
        if (homeDirectory.length > 1 && text.indexOf(homeDirectory + "/") === 0) return "~" + text.slice(homeDirectory.length)
        return text === homeDirectory && homeDirectory.length > 0 ? "~" : text
    }

    function sessionAgeLabel(session, nowMs) {
        if (!session || typeof session !== "object") return ""
        const modified = Number(session.modified)
        const suppliedAge = Number(session.ageMs)
        const requestedNow = Number(nowMs)
        const currentTime = Number.isFinite(requestedNow) ? requestedNow : ageClockMs
        const ageMs = Number.isFinite(modified) && modified > 0
            ? Math.max(0, currentTime - modified)
            : suppliedAge
        if (!Number.isFinite(ageMs) || ageMs < 0) return ""

        const minuteMs = 60 * 1000
        const hourMs = 60 * minuteMs
        const dayMs = 24 * hourMs
        if (ageMs > 30 * dayMs) {
            if (!Number.isFinite(modified) || modified <= 0) return ""
            const date = new Date(modified)
            if (!Number.isFinite(date.getTime())) return ""
            const day = date.getDate() < 10 ? "0" + date.getDate() : String(date.getDate())
            const monthNumber = date.getMonth() + 1
            const month = monthNumber < 10 ? "0" + monthNumber : String(monthNumber)
            return day + "." + month + "." + date.getFullYear()
        }
        if (ageMs >= dayMs) return Math.floor(ageMs / dayMs) + "d"
        if (ageMs >= hourMs) return Math.floor(ageMs / hourMs) + "h"
        if (ageMs >= minuteMs) return Math.floor(ageMs / minuteMs) + "m"
        return "now"
    }

    function sessionSortKey(session, index) {
        const sessionPath = String(session.path || "")
        if (sessionPath.length > 0) return "path:" + sessionPath
        const identity = String(session.identity || "")
        if (identity.length > 0) return "identity:" + identity
        return "id:" + String(session.id || "") + ":" + index
    }

    function deferredSessionOrder(sourceSessions, committedByKey, nowMs) {
        const currentTime = Number(nowMs)
        const previous = committedByKey && typeof committedByKey === "object" ? committedByKey : ({})
        const nextCommitted = ({})
        const sortable = []
        for (let index = 0; index < sourceSessions.length; index += 1) {
            const session = sourceSessions[index]
            const key = sessionSortKey(session, index)
            const modified = Number(session.modified)
            const hasPrevious = Object.prototype.hasOwnProperty.call(previous, key)
            const ageMs = Number.isFinite(currentTime) && Number.isFinite(modified)
                ? Math.max(0, currentTime - modified) : activitySortGraceMs
            // Keep the last committed key until activity has been quiet for the full grace period.
            const committed = hasPrevious && ageMs < activitySortGraceMs
                ? Number(previous[key]) : (Number.isFinite(modified) ? modified : 0)
            nextCommitted[key] = Number.isFinite(committed) ? committed : 0
            sortable.push({ "session": session, "sourceIndex": index, "committed": nextCommitted[key] })
        }
        sortable.sort((left, right) => right.committed - left.committed || left.sourceIndex - right.sourceIndex)
        return {
            "sessions": sortable.map(item => item.session),
            "committedByKey": nextCommitted
        }
    }

    function reconcileSessionOrder(nowMs) {
        const result = deferredSessionOrder(sessions, committedSortModifiedByKey, nowMs)
        committedSortModifiedByKey = result.committedByKey
        orderedSessions = result.sessions
    }

    function searchText(session) {
        return [session.title, session.name, session.sessionName, session.firstMessage, session.id, session.cwd, shortPath(session.cwd)]
            .map(value => String(value || "").toLowerCase()).join("\n")
    }

    function filterSessions(rows) {
        if (!searchActive) return rows
        const matches = []
        for (const session of rows) if (searchText(session).indexOf(normalizedSearchQuery) !== -1) matches.push(session)
        return matches
    }

    function tabForId(tabId) {
        const id = String(tabId || "")
        if (id.length === 0) return null
        for (const tab of tabs) if (String(tab.id || "") === id) return tab
        return null
    }

    function enriched(session) {
        const tab = tabForId(session.openTabId)
        return Object.assign({}, session, {
            "title": titleFor(session),
            "openTabId": tab ? String(tab.id) : String(session.openTabId || ""),
            "open": tab !== null,
            "active": tab ? tab.active === true : false,
            "ready": tab ? tab.ready === true : false,
            "statusKind": tab ? String(tab.statusKind || "stopped") : "saved",
            "statusText": tab ? String(tab.statusText || "") : "",
            "activityState": tab ? String(tab.activityState || "idle") : "",
            "needsInput": tab ? Number(tab.needsInput || 0) : 0,
            "current": tab ? String(tab.id) === activeTabId : false,
            "openOnly": false
        })
    }

    function buildWorkingSessions() {
        const rows = []
        const catalogPaths = ({})
        const catalogTabIds = ({})
        for (const session of orderedSessions) {
            const path = String(session.path || "")
            const openTabId = String(session.openTabId || "")
            if (path.length > 0) catalogPaths[path] = true
            if (openTabId.length > 0) catalogTabIds[openTabId] = true
            if (session.settled !== true) rows.push(enriched(session))
        }
        // A brand-new tab may not have a persisted Pi session file yet. Keep it selectable and
        // closable without pretending it is part of the saved-session catalog.
        for (const tab of tabs) {
            const path = String(tab.sessionFile || "")
            if (catalogTabIds[String(tab.id || "")] === true || (path.length > 0 && catalogPaths[path] === true)) continue
            rows.unshift({
                path: path,
                cwd: String(tab.cwd || ""),
                id: "open-" + String(tab.id),
                name: String(tab.name || ""),
                sessionName: String(tab.sessionName || ""),
                firstMessage: "",
                title: String(tab.name || tab.sessionName || titleFor({ id: tab.id })),
                settled: false,
                openTabId: String(tab.id),
                open: true,
                active: tab.active === true,
                ready: tab.ready === true,
                statusKind: String(tab.statusKind || "stopped"),
                statusText: String(tab.statusText || ""),
                activityState: String(tab.activityState || "idle"),
                needsInput: Number(tab.needsInput || 0),
                current: String(tab.id) === activeTabId,
                openOnly: true
            })
        }
        return rows
    }

    function buildSettledSessions() {
        const rows = []
        for (const session of orderedSessions) if (session.settled === true) rows.push(enriched(session))
        return rows
    }

    function countUnsettledSavedSessions() {
        let count = 0
        for (const session of sessions) if (session && session.settled !== true) count += 1
        return count
    }

    function activityStateFor(session) {
        const state = String(session.activityState || "")
        if (state === "blocked") return "blocked"
        if (state === "working") return "working"
        if (state === "done") return "done"
        return "idle"
    }

    function conditionDescription(session) {
        const conditions = []
        if (session.statusKind === "error") {
            const detail = String(session.statusText || "").trim()
            conditions.push(detail.length > 0 ? "error: " + detail : "error")
        } else if (!session.ready) {
            conditions.push("starting")
        }
        // A blocked row already says that input is pending; repeating it adds noise for screen readers.
        if (Number(session.needsInput || 0) > 0 && activityStateFor(session) !== "blocked") conditions.push("needs input")
        return conditions.join(", ")
    }

    function statusFor(session) {
        if (!session.open) return "saved · " + shortPath(session.cwd)
        return activityStateFor(session) + " · " + shortPath(session.cwd)
    }

    function statusTooltip(session) {
        const condition = conditionDescription(session)
        return statusFor(session) + (condition.length > 0 ? "\n" + condition : "")
    }

    function openRow(session) {
        if (session.openOnly) {
            if (session.openTabId.length > 0) sessionRequested(session)
            return
        }
        sessionRequested(session)
    }

    function toggleSettled() {
        settledExpanded = !settledExpanded
        return settledExpanded
    }

    onSessionsChanged: reconcileSessionOrder(Date.now())
    Component.onCompleted: reconcileSessionOrder(Date.now())

    Timer {
        interval: 60 * 1000
        running: true
        repeat: true
        onTriggered: {
            const now = Date.now()
            sessionList.ageClockMs = now
            sessionList.reconcileSessionOrder(now)
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: sessionList.theme.spaceXs
        spacing: sessionList.theme.spaceXs

        RowLayout {
            Layout.fillWidth: true
            spacing: sessionList.theme.spaceXs

            TextField {
                id: workspaceSearchField
                Layout.fillWidth: true
                Layout.minimumWidth: 0
                maximumLength: 256
                placeholderText: "Search workspaces"
                color: sessionList.theme.foreground
                placeholderTextColor: sessionList.theme.muted
                selectionColor: sessionList.theme.selection
                selectedTextColor: sessionList.theme.selectionForeground
                font.family: sessionList.theme.monospaceFamily
                font.pixelSize: sessionList.theme.typeBody
                background: Rectangle {
                    radius: sessionList.theme.radiusSmall
                    color: sessionList.theme.surface
                    border.width: sessionList.theme.borderWidth
                    border.color: workspaceSearchField.activeFocus ? sessionList.theme.focusRing : sessionList.theme.border
                }
                Accessible.role: Accessible.EditableText
                Accessible.name: "Search workspaces"
                Accessible.description: "Filter by session title, identifier, or folder. Escape clears the search."
                Keys.onPressed: event => {
                    if (event.key === Qt.Key_Escape && text.length > 0) {
                        clear()
                        event.accepted = true
                    } else if (event.key === Qt.Key_Down && sessionList.workingSessions.length > 0) {
                        workingList.currentIndex = 0
                        workingList.forceActiveFocus()
                        event.accepted = true
                    } else if (event.key === Qt.Key_Down && sessionList.settledExpanded && sessionList.settledSessions.length > 0) {
                        settledList.currentIndex = 0
                        settledList.forceActiveFocus()
                        event.accepted = true
                    }
                }
            }

            AppButton {
                visible: workspaceSearchField.text.length > 0
                Layout.preferredWidth: 28
                implicitWidth: 28
                theme: sessionList.theme
                variant: "ghost"
                text: "×"
                accessibleName: "Clear workspace search"
                padding: 0
                onClicked: {
                    workspaceSearchField.clear()
                    workspaceSearchField.forceActiveFocus()
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: sessionList.theme.spaceXs

            Label {
                Layout.fillWidth: true
                text: "WORKING  " + sessionList.workingSessions.length
                textFormat: Text.PlainText
                color: sessionList.theme.muted
                font.family: sessionList.theme.monospaceFamily
                font.pixelSize: sessionList.theme.typeCaption
                font.bold: true
                font.letterSpacing: sessionList.theme.labelTracking
                elide: Text.ElideRight
                Accessible.role: Accessible.Heading
            }

            AppButton {
                Layout.preferredWidth: 28
                implicitWidth: 28
                theme: sessionList.theme
                variant: "ghost"
                text: "↻"
                accessibleName: "Refresh all saved sessions"
                enabled: !sessionList.loading
                padding: 0
                onClicked: sessionList.refreshRequested()
            }
        }

        Label {
            Layout.fillWidth: true
            visible: (sessionList.loading && sessionList.sessions.length === 0) || sessionList.errorText.length > 0
            text: sessionList.loading ? "Loading saved sessions…" : sessionList.errorText
            textFormat: Text.PlainText
            color: sessionList.errorText.length > 0 ? sessionList.theme.errorForeground : sessionList.theme.muted
            font.family: sessionList.theme.monospaceFamily
            font.pixelSize: sessionList.theme.typeCaption
            wrapMode: Text.Wrap
            maximumLineCount: 2
            elide: Text.ElideRight
            Accessible.role: sessionList.errorText.length > 0 ? Accessible.AlertMessage : Accessible.StaticText
        }

        Label {
            Layout.fillWidth: true
            visible: sessionList.searchActive && sessionList.workingSessions.length === 0 && sessionList.settledSessions.length === 0
            text: "No matching workspaces"
            textFormat: Text.PlainText
            color: sessionList.theme.muted
            font.family: sessionList.theme.monospaceFamily
            font.pixelSize: sessionList.theme.typeCaption
            wrapMode: Text.Wrap
            Accessible.role: Accessible.StaticText
        }

        ListView {
            id: workingList
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.minimumHeight: 64
            model: sessionList.workingSessions
            spacing: sessionList.theme.spaceXs
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            keyNavigationEnabled: true
            keyNavigationWraps: true
            activeFocusOnTab: count > 0
            Accessible.role: Accessible.List
            Accessible.name: "Working sessions"
            Keys.onReturnPressed: if (currentItem) sessionList.openRow(currentItem.modelData)
            Keys.onEnterPressed: if (currentItem) sessionList.openRow(currentItem.modelData)
            Keys.onSpacePressed: if (currentItem) sessionList.openRow(currentItem.modelData)

            ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

            delegate: Rectangle {
                id: workingRow
                required property int index
                required property var modelData
                readonly property bool keyboardCursor: index === workingList.currentIndex && workingList.activeFocus
                readonly property string ageText: sessionList.sessionAgeLabel(modelData)
                readonly property string conditionText: sessionList.conditionDescription(modelData)
                width: workingList.width
                height: 66
                radius: sessionList.theme.radiusSmall
                color: sessionList.theme.interactiveFill(modelData.current, keyboardCursor || workingRowMouseArea.containsMouse, workingRowMouseArea.pressed)
                border.width: sessionList.theme.focusBorderWidth
                border.color: sessionList.theme.interactiveBorder(modelData.current, keyboardCursor)
                Accessible.role: Accessible.ListItem
                Accessible.name: modelData.title + (ageText.length > 0 ? ", " + ageText : "") + ", " + sessionList.statusFor(modelData)
                    + (conditionText.length > 0 ? ", " + conditionText : "")
                Accessible.selected: modelData.current
                Accessible.onPressAction: sessionList.openRow(modelData)

                ToolTip.visible: modelData.open && workingRowMouseArea.containsMouse
                ToolTip.text: sessionList.statusTooltip(modelData)
                ToolTip.delay: 500

                MouseArea {
                    id: workingRowMouseArea
                    anchors.fill: parent
                    acceptedButtons: Qt.LeftButton
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        workingList.currentIndex = workingRow.index
                        sessionList.openRow(workingRow.modelData)
                    }
                }

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: sessionList.theme.spaceSm
                    spacing: 1

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: sessionList.theme.spaceXs

                        Label {
                            Layout.fillWidth: true
                            Layout.minimumWidth: 0
                            text: workingRow.modelData.title
                            textFormat: Text.PlainText
                            color: sessionList.theme.foreground
                            font.family: sessionList.theme.monospaceFamily
                            font.pixelSize: sessionList.theme.typeBody
                            font.bold: workingRow.modelData.current
                            elide: Text.ElideRight
                        }

                        Label {
                            visible: workingRow.ageText.length > 0
                            text: workingRow.ageText
                            textFormat: Text.PlainText
                            color: sessionList.theme.muted
                            font.family: sessionList.theme.monospaceFamily
                            font.pixelSize: sessionList.theme.typeCaption
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: sessionList.theme.spaceXxs

                        Rectangle {
                            width: 4
                            height: 12
                            radius: 0
                            color: workingRow.modelData.statusKind === "error" ? sessionList.theme.destructive
                                : sessionList.activityStateFor(workingRow.modelData) === "blocked" ? sessionList.theme.warning
                                : sessionList.activityStateFor(workingRow.modelData) === "working" ? sessionList.theme.runningForeground
                                : sessionList.activityStateFor(workingRow.modelData) === "done" ? sessionList.theme.readyForeground
                                : sessionList.theme.muted
                        }

                        Label {
                            Layout.fillWidth: true
                            text: sessionList.statusFor(workingRow.modelData)
                            textFormat: Text.PlainText
                            color: sessionList.theme.muted
                            font.family: sessionList.theme.monospaceFamily
                            font.pixelSize: sessionList.theme.typeCaption
                            elide: Text.ElideMiddle
                        }

                        AppButton {
                            visible: !workingRow.modelData.openOnly && String(workingRow.modelData.path || "").length > 0
                            Layout.preferredWidth: 78
                            implicitWidth: 78
                            theme: sessionList.theme
                            variant: "ghost"
                            text: sessionList.pendingSettlements[String(workingRow.modelData.path)] === true ? "…" : "Settle"
                            accessibleName: "Settle " + workingRow.modelData.title
                            accessibleDescription: workingRow.modelData.active ? "Available when this session is idle" : "Move this session to Settled"
                            enabled: !workingRow.modelData.active && sessionList.pendingSettlements[String(workingRow.modelData.path)] !== true
                            padding: 0
                            onClicked: sessionList.settlementRequested(String(workingRow.modelData.path), true)
                        }

                        AppButton {
                            visible: workingRow.modelData.openTabId.length > 0
                            Layout.preferredWidth: 26
                            implicitWidth: 26
                            theme: sessionList.theme
                            variant: "ghost"
                            text: "×"
                            accessibleName: "Close tab " + workingRow.modelData.title
                            padding: 0
                            onClicked: sessionList.closeRequested(workingRow.modelData.openTabId)
                        }
                    }
                }
            }
        }

        AppButton {
            id: settledToggle
            Layout.fillWidth: true
            theme: sessionList.theme
            variant: "ghost"
            text: (sessionList.settledExpanded ? "⌄  " : "›  ") + "SETTLED  " + sessionList.settledSessions.length
            accessibleName: (sessionList.settledExpanded ? "Collapse" : "Expand") + " settled sessions"
            accessibleDescription: sessionList.settledSessions.length + " sessions"
            active: sessionList.settledExpanded
            onClicked: sessionList.toggleSettled()
        }

        ListView {
            id: settledList
            Layout.fillWidth: true
            Layout.preferredHeight: sessionList.settledExpanded ? Math.min(contentHeight, Math.max(52, sessionList.height * 0.34)) : 0
            Layout.maximumHeight: Math.max(52, sessionList.height * 0.34)
            visible: sessionList.settledExpanded
            model: sessionList.settledSessions
            spacing: sessionList.theme.spaceXs
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            keyNavigationEnabled: true
            keyNavigationWraps: true
            activeFocusOnTab: visible && count > 0
            Accessible.role: Accessible.List
            Accessible.name: "Settled sessions"
            Keys.onReturnPressed: if (currentItem) sessionList.openRow(currentItem.modelData)
            Keys.onEnterPressed: if (currentItem) sessionList.openRow(currentItem.modelData)
            Keys.onSpacePressed: if (currentItem) sessionList.openRow(currentItem.modelData)

            ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

            delegate: Rectangle {
                id: settledRow
                required property int index
                required property var modelData
                readonly property bool keyboardCursor: index === settledList.currentIndex && settledList.activeFocus
                readonly property string ageText: sessionList.sessionAgeLabel(modelData)
                width: settledList.width
                height: 42
                radius: sessionList.theme.radiusSmall
                color: sessionList.theme.interactiveFill(modelData.current, keyboardCursor || settledRowMouseArea.containsMouse, settledRowMouseArea.pressed)
                border.width: sessionList.theme.focusBorderWidth
                border.color: sessionList.theme.interactiveBorder(modelData.current, keyboardCursor)
                Accessible.role: Accessible.ListItem
                Accessible.name: modelData.title + (ageText.length > 0 ? ", " + ageText : "") + ", settled"
                Accessible.selected: modelData.current
                Accessible.onPressAction: sessionList.openRow(modelData)

                MouseArea {
                    id: settledRowMouseArea
                    anchors.fill: parent
                    acceptedButtons: Qt.LeftButton
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        settledList.currentIndex = settledRow.index
                        sessionList.openRow(settledRow.modelData)
                    }
                }

                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: sessionList.theme.spaceSm
                    anchors.rightMargin: sessionList.theme.spaceXs
                    spacing: sessionList.theme.spaceXs

                    Label {
                        Layout.fillWidth: true
                        text: settledRow.modelData.title
                        textFormat: Text.PlainText
                        color: sessionList.theme.foreground
                        font.family: sessionList.theme.monospaceFamily
                        font.pixelSize: sessionList.theme.typeBody
                        elide: Text.ElideRight
                    }

                    Label {
                        visible: settledRow.ageText.length > 0
                        text: settledRow.ageText
                        textFormat: Text.PlainText
                        color: sessionList.theme.muted
                        font.family: sessionList.theme.monospaceFamily
                        font.pixelSize: sessionList.theme.typeCaption
                    }

                    AppButton {
                        Layout.preferredWidth: 86
                        implicitWidth: 86
                        theme: sessionList.theme
                        variant: "ghost"
                        text: sessionList.pendingSettlements[String(settledRow.modelData.path)] === true ? "…" : "Restore"
                        accessibleName: "Return " + settledRow.modelData.title + " to Working"
                        enabled: sessionList.pendingSettlements[String(settledRow.modelData.path)] !== true
                        padding: 0
                        onClicked: sessionList.settlementRequested(String(settledRow.modelData.path), false)
                    }
                }
            }
        }

        RowLayout {
            id: workspaceActions
            Layout.fillWidth: true
            spacing: sessionList.theme.spaceXs

            AppButton {
                Layout.preferredWidth: 34
                implicitWidth: 34
                theme: sessionList.theme
                variant: "ghost"
                text: "+"
                accessibleName: "New tab in the same folder"
                accessibleDescription: "Ctrl+N"
                enabled: sessionList.tabs.length < sessionList.maxTabs
                padding: 0
                onClicked: sessionList.newTabRequested()
            }

            AppButton {
                Layout.fillWidth: true
                theme: sessionList.theme
                variant: "ghost"
                text: "Open folder…"
                accessibleName: "Open a folder in a new tab"
                accessibleDescription: "Ctrl+O"
                enabled: sessionList.tabs.length < sessionList.maxTabs
                padding: 2
                onClicked: sessionList.openDirectoryRequested()
            }
        }
    }

    AppButton {
        id: settleAllButton
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.rightMargin: sessionList.theme.spaceSm
        anchors.bottomMargin: workspaceActions.height + sessionList.theme.spaceMd + sessionList.theme.spaceXs
        z: 2
        visible: sessionList.unsettledSavedSessionCount > 100
        theme: sessionList.theme
        variant: "primary"
        text: sessionList.settleAllPending ? "Settling…" : "Settle All"
        accessibleName: "Settle all idle saved sessions"
        accessibleDescription: "Move every idle saved session from Working to Settled"
        enabled: !sessionList.settleAllPending
        padding: sessionList.theme.spaceSm
        onClicked: sessionList.settleAllRequested()
    }
}
