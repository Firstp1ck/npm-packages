import QtQuick
import QtQuick.Controls
import QtQuick.Effects
import QtQuick.Layouts

// Prompt editor with explicit run modes: Send while idle; Steer, Follow-up, and Abort while a run
// is active; Restart while Pi is unavailable. The editor stays usable during a run so queued
// messages can be prepared. It also hosts attachment chips and the inline completion list for
// `/` commands and `@` workspace paths; accepting a completion only edits the text.
Rectangle {
    id: composer

    required property QtObject theme
    property alias text: prompt.text
    property bool active: false
    property bool ready: false
    property bool processRunning: false
    property int maxCharacters: 8192
    property int maxAttachments: 8
    property var attachments: []
    property var completions: []
    property string completionKind: ""
    property string completionQuery: ""
    property string completionEmptyText: ""
    property string suppressedCompletion: ""
    readonly property bool overLimit: prompt.text.length > maxCharacters
    readonly property bool hasText: prompt.text.trim().length > 0 && !overLimit
    readonly property bool completionOpen: completionPopup.visible
    readonly property int completionIndex: completionPopup.currentIndex
    readonly property int cursorPosition: prompt.cursorPosition

    signal sendRequested(string text, string mode)
    signal abortRequested()
    signal restartRequested()
    signal attachRequested()
    signal sequencesRequested()
    signal attachmentRemoveRequested(string attachmentId)
    signal attachmentEditRequested(string attachmentId)
    signal completionRequested(string kind, string query)
    signal draftEdited(string text)

    implicitHeight: column.implicitHeight + 24
    radius: 12
    color: theme.composerSurface
    border.width: prompt.activeFocus ? 2 : 1
    border.color: prompt.activeFocus ? theme.focusRing : theme.composerBorder
    layer.enabled: true
    layer.effect: MultiEffect {
        shadowEnabled: true
        shadowColor: composer.theme.composerShadow
        shadowBlur: 0.45
        shadowVerticalOffset: 3
    }

    Behavior on border.color {
        ColorAnimation { duration: composer.theme.animationDuration }
    }

    function trySend(mode) {
        const value = prompt.text.trim()
        if (!ready || value.length === 0 || overLimit) return
        if (mode === "send" && active) return
        if ((mode === "steer" || mode === "followUp") && !active) mode = "send"
        sendRequested(value, mode)
    }

    function clearAndFocus() {
        prompt.text = ""
        dismissCompletion()
        prompt.forceActiveFocus()
    }

    function focusEditor() {
        prompt.forceActiveFocus()
    }

    function setText(value) {
        prompt.text = String(value || "")
        prompt.cursorPosition = prompt.text.length
        prompt.forceActiveFocus()
    }

    // ---- completion --------------------------------------------------------------------------

    // The token under the cursor decides the completion kind: a leading "/" while the cursor is
    // still inside the first word means a command; a word starting with "@" means a path.
    function completionContext() {
        const value = prompt.text
        const cursor = prompt.cursorPosition
        if (value.startsWith("/")) {
            const firstSpace = value.search(/\s/)
            const end = firstSpace === -1 ? value.length : firstSpace
            if (cursor <= end) return { kind: "command", query: value.slice(1, cursor), start: 0, end: end }
        }
        let start = cursor
        while (start > 0 && !/\s/.test(value[start - 1])) start--
        const token = value.slice(start, cursor)
        if (token.startsWith("@")) return { kind: "path", query: token.slice(1), start: start, end: cursor }
        return { kind: "", query: "", start: 0, end: 0 }
    }

    function refreshCompletion() {
        const context = completionContext()
        const identity = context.kind + ":" + context.query
        if (context.kind.length === 0 || identity === suppressedCompletion) {
            if (completionKind.length > 0) {
                completionKind = ""
                completionQuery = ""
                completions = []
                completionEmptyText = ""
                completionRequested("", "")
            }
            return
        }
        if (context.kind === completionKind && context.query === completionQuery) return
        completionKind = context.kind
        completionQuery = context.query
        completionRequested(context.kind, context.query)
    }

    function dismissCompletion() {
        const context = completionContext()
        suppressedCompletion = context.kind.length > 0 ? context.kind + ":" + context.query : ""
        completionKind = ""
        completionQuery = ""
        completions = []
        completionEmptyText = ""
    }

    // Replaces the token under the cursor with the chosen suggestion. Never sends.
    function acceptCompletion(index) {
        const context = completionContext()
        if (context.kind.length === 0 || index < 0 || index >= completions.length) return false
        const item = completions[index]
        const replacement = context.kind === "command"
            ? "/" + String(item.value) + " "
            : "@" + String(item.value) + (item.directory === true ? "/" : " ")
        const value = prompt.text
        prompt.text = value.slice(0, context.start) + replacement + value.slice(context.end)
        prompt.cursorPosition = context.start + replacement.length
        suppressedCompletion = ""
        refreshCompletion()
        return true
    }

    function acceptCurrentCompletion() {
        const index = completionPopup.currentIndex >= 0 ? completionPopup.currentIndex : (completions.length > 0 ? 0 : -1)
        return acceptCompletion(index)
    }

    function sizeLabel(bytes) {
        const size = Number(bytes) || 0
        if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + " MiB"
        if (size >= 1024) return Math.round(size / 1024) + " KiB"
        return size + " B"
    }

    ColumnLayout {
        id: column
        anchors.fill: parent
        anchors.margins: 12
        spacing: 7

        CompletionPopup {
            id: completionPopup
            Layout.fillWidth: true
            theme: composer.theme
            items: composer.completions
            kind: composer.completionKind
            emptyText: composer.completionEmptyText
            onAccepted: index => composer.acceptCompletion(index)
        }

        ScrollView {
            Layout.fillWidth: true
            Layout.preferredHeight: 84
            clip: true

            TextArea {
                id: prompt
                placeholderText: composer.ready ? (composer.active ? "Steer or queue a follow-up…" : "Ask Pi… ( / commands, @ paths )") : "Waiting for Pi…"
                enabled: composer.ready
                wrapMode: TextEdit.Wrap
                textFormat: TextEdit.PlainText
                selectByMouse: true
                focus: true
                color: composer.theme.foreground
                placeholderTextColor: composer.theme.muted
                selectionColor: composer.theme.selection
                background: null
                Accessible.role: Accessible.EditableText
                Accessible.name: "Prompt"
                Accessible.description: composer.completionOpen ? "Suggestions are open: Up and Down choose, Tab or Enter completes without sending, Escape closes"
                    : composer.active ? "Enter steers the current run, Alt+Enter queues a follow-up, Shift+Enter inserts a new line" : "Enter sends the prompt, Shift+Enter inserts a new line"
                KeyNavigation.tab: primaryButton
                onTextChanged: {
                    composer.refreshCompletion()
                    composer.draftEdited(text)
                }
                onCursorPositionChanged: composer.refreshCompletion()
                Keys.onPressed: event => {
                    if (composer.completionOpen) {
                        if (event.key === Qt.Key_Down) {
                            completionPopup.move(1)
                            event.accepted = true
                            return
                        }
                        if (event.key === Qt.Key_Up) {
                            completionPopup.move(-1)
                            event.accepted = true
                            return
                        }
                        if (event.key === Qt.Key_Escape) {
                            composer.dismissCompletion()
                            event.accepted = true
                            return
                        }
                        if ((event.key === Qt.Key_Tab || event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && event.modifiers === Qt.NoModifier) {
                            // Accepting a suggestion edits the prompt; it must never send.
                            composer.acceptCurrentCompletion()
                            event.accepted = true
                            return
                        }
                    }
                    const enter = event.key === Qt.Key_Return || event.key === Qt.Key_Enter
                    if (!enter) return
                    if (event.modifiers & Qt.ShiftModifier) return // default: insert a new line
                    if (event.modifiers & Qt.AltModifier) composer.trySend(composer.active ? "followUp" : "send")
                    else composer.trySend(composer.active ? "steer" : "send")
                    event.accepted = true
                }
            }
        }

        // Attachment chips: name, size, edit for text, remove --------------------------------
        Flow {
            Layout.fillWidth: true
            visible: composer.attachments.length > 0
            spacing: 6
            Accessible.role: Accessible.Grouping
            Accessible.name: composer.attachments.length + " attachments"

            Repeater {
                model: composer.attachments

                delegate: Rectangle {
                    id: chip
                    required property var modelData
                    implicitWidth: chipRow.implicitWidth + 12
                    width: Math.min(implicitWidth, parent ? parent.width : implicitWidth)
                    implicitHeight: chipRow.implicitHeight + 8
                    radius: 6
                    color: composer.theme.surfaceRaised
                    border.width: 1
                    border.color: composer.theme.border
                    Accessible.role: Accessible.Grouping
                    Accessible.name: "Attachment " + String(modelData.name) + ", " + String(modelData.kind) + ", " + composer.sizeLabel(modelData.size) + (modelData.edited ? ", edited" : "")

                    RowLayout {
                        id: chipRow
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.leftMargin: 6
                        anchors.rightMargin: 6
                        spacing: 6

                        Label {
                            Layout.fillWidth: true
                            Layout.minimumWidth: 48
                            Layout.maximumWidth: 240
                            text: String(chip.modelData.kind === "image" ? "🖼 " : "📄 ") + String(chip.modelData.name)
                            textFormat: Text.PlainText
                            color: composer.theme.foreground
                            font.pixelSize: 12
                            elide: Text.ElideMiddle
                        }

                        Label {
                            Layout.maximumWidth: 76
                            text: composer.sizeLabel(chip.modelData.size) + (chip.modelData.edited ? " · edited" : "")
                            textFormat: Text.PlainText
                            color: composer.theme.muted
                            font.pixelSize: 11
                            elide: Text.ElideRight
                        }

                        AppButton {
                            visible: chip.modelData.kind === "text"
                            theme: composer.theme
                            variant: "ghost"
                            text: "Edit"
                            accessibleName: "Edit attachment " + String(chip.modelData.name)
                            padding: 2
                            leftPadding: 6
                            rightPadding: 6
                            onClicked: composer.attachmentEditRequested(String(chip.modelData.id))
                        }

                        AppButton {
                            theme: composer.theme
                            variant: "ghost"
                            text: "Remove"
                            accessibleName: "Remove attachment " + String(chip.modelData.name)
                            padding: 2
                            leftPadding: 6
                            rightPadding: 6
                            onClicked: composer.attachmentRemoveRequested(String(chip.modelData.id))
                        }
                    }
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: 8

            Label {
                Layout.fillWidth: true
                text: composer.overLimit ? "Prompt exceeds " + composer.maxCharacters + " characters"
                    : composer.active ? "Pi is working · Enter steers · Alt+Enter queues a follow-up · Shift+Enter new line"
                    : composer.ready ? "Enter to send · Shift+Enter for a new line" : "Pi is not available"
                textFormat: Text.PlainText
                color: composer.overLimit ? composer.theme.destructive : composer.theme.muted
                font.pixelSize: 12
                elide: Text.ElideRight
            }

            Label {
                visible: prompt.text.length > composer.maxCharacters * 0.8
                text: prompt.text.length + " / " + composer.maxCharacters
                textFormat: Text.PlainText
                color: composer.overLimit ? composer.theme.destructive : composer.theme.muted
                font.pixelSize: 11
            }

            AppButton {
                id: attachButton
                visible: composer.ready
                theme: composer.theme
                variant: "ghost"
                text: "Attach"
                accessibleName: "Attach files"
                accessibleDescription: "Opens the file picker; text files and images can be attached"
                enabled: composer.attachments.length < composer.maxAttachments
                onClicked: composer.attachRequested()
            }

            AppButton {
                id: sequencesButton
                visible: composer.ready
                theme: composer.theme
                variant: "ghost"
                text: "Sequences"
                accessibleName: "Saved prompt sequences"
                accessibleDescription: "Ctrl+Shift+S"
                onClicked: composer.sequencesRequested()
            }

            AppButton {
                id: followUpButton
                visible: composer.active && composer.ready
                theme: composer.theme
                text: "Follow-up"
                accessibleName: "Queue as follow-up"
                enabled: composer.hasText
                onClicked: composer.trySend("followUp")
            }

            AppButton {
                id: steerButton
                visible: composer.active && composer.ready
                theme: composer.theme
                text: "Steer"
                accessibleName: "Send as steering message"
                enabled: composer.hasText
                onClicked: composer.trySend("steer")
            }

            AppButton {
                id: primaryButton
                theme: composer.theme
                variant: composer.active ? "destructive" : (composer.ready ? "primary" : "warning")
                text: composer.active ? "Abort" : (composer.ready ? "Send" : "Restart")
                accessibleName: composer.active ? "Abort the current run" : (composer.ready ? "Send prompt" : "Restart Pi")
                enabled: composer.active || !composer.ready || composer.hasText
                onClicked: {
                    if (composer.active) composer.abortRequested()
                    else if (!composer.ready) composer.restartRequested()
                    else composer.trySend("send")
                }
            }
        }
    }
}
