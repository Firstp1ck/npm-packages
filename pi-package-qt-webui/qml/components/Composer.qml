import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Prompt editor with explicit run modes: Send while idle; Steer, Follow-up, and Abort while a run
// is active; Restart while Pi is unavailable. The editor stays usable during a run so queued
// messages can be prepared.
Rectangle {
    id: composer

    required property QtObject theme
    property alias text: prompt.text
    property bool active: false
    property bool ready: false
    property bool processRunning: false
    property int maxCharacters: 8192
    readonly property bool overLimit: prompt.text.length > maxCharacters
    readonly property bool hasText: prompt.text.trim().length > 0 && !overLimit

    signal sendRequested(string text, string mode)
    signal abortRequested()
    signal restartRequested()

    implicitHeight: 150
    radius: 10
    color: theme.surface
    border.width: prompt.activeFocus ? 2 : 1
    border.color: prompt.activeFocus ? theme.focusRing : theme.border

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

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 8

        ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true

            TextArea {
                id: prompt
                placeholderText: composer.ready ? (composer.active ? "Steer or queue a follow-up…" : "Ask Pi…") : "Waiting for Pi…"
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
                Accessible.description: composer.active ? "Enter steers the current run, Alt+Enter queues a follow-up, Shift+Enter inserts a new line" : "Enter sends the prompt, Shift+Enter inserts a new line"
                KeyNavigation.tab: primaryButton
                Keys.onPressed: event => {
                    const enter = event.key === Qt.Key_Return || event.key === Qt.Key_Enter
                    if (!enter) return
                    if (event.modifiers & Qt.ShiftModifier) return // default: insert a new line
                    if (event.modifiers & Qt.AltModifier) composer.trySend(composer.active ? "followUp" : "send")
                    else composer.trySend(composer.active ? "steer" : "send")
                    event.accepted = true
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
