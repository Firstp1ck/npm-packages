import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Rectangle {
    id: composer

    required property QtObject theme
    property alias text: prompt.text
    property bool active: false
    property bool ready: false
    property bool processRunning: false

    signal sendRequested(string text)
    signal abortRequested()
    signal restartRequested()

    implicitHeight: 132
    radius: 10
    color: theme.surface
    border.width: prompt.activeFocus ? 2 : 1
    border.color: prompt.activeFocus ? theme.accent : theme.border

    Behavior on border.color {
        ColorAnimation { duration: 100 }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 10

        ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true

            TextArea {
                id: prompt
                placeholderText: composer.ready ? "Ask Pi…" : "Waiting for Pi…"
                enabled: composer.ready && !composer.active
                wrapMode: TextEdit.Wrap
                textFormat: TextEdit.PlainText
                selectByMouse: true
                focus: true
                color: composer.theme.foreground
                placeholderTextColor: composer.theme.muted
                background: null
                KeyNavigation.tab: primaryButton
                Keys.onPressed: event => {
                    if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter)
                            && (event.modifiers & Qt.ControlModifier)) {
                        composer.trySend()
                        event.accepted = true
                    }
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: 8

            Label {
                Layout.fillWidth: true
                text: composer.active ? "Pi is working" : "Ctrl+Enter to send"
                color: composer.theme.muted
                font.pixelSize: 12
            }

            Button {
                id: primaryButton
                text: composer.active ? "Abort" : (composer.ready ? "Send" : "Restart")
                enabled: composer.active || !composer.ready || prompt.text.trim().length > 0
                focusPolicy: Qt.StrongFocus
                onClicked: {
                    if (composer.active) composer.abortRequested()
                    else if (!composer.ready) composer.restartRequested()
                    else composer.trySend()
                }
                background: Rectangle {
                    implicitWidth: 92
                    implicitHeight: 38
                    radius: 7
                    color: !primaryButton.enabled ? composer.theme.disabledSurface
                        : composer.active ? composer.theme.destructive
                        : !composer.ready ? composer.theme.warning : composer.theme.accent
                    border.width: primaryButton.activeFocus ? 2 : 0
                    border.color: composer.theme.foreground
                    Behavior on color { ColorAnimation { duration: 100 } }
                }
                contentItem: Label {
                    text: primaryButton.text
                    color: primaryButton.enabled ? composer.theme.buttonForeground : composer.theme.disabledForeground
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                    font.bold: true
                }
            }
        }
    }

    function trySend() {
        const value = prompt.text.trim()
        if (!ready || active || value.length === 0) return
        sendRequested(value)
    }

    function clearAndFocus() {
        prompt.text = ""
        prompt.forceActiveFocus()
    }
}
