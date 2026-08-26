import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Shown while the transcript is empty. The workspace rail and header already provide context, so
// this panel stays focused on starting or resuming work and remains scrollable in a short window.
Item {
    id: empty

    required property QtObject theme
    property bool ready: false
    property bool backendReady: false

    signal restartRequested()
    signal focusComposerRequested()
    signal resumeRequested()
    signal openDirectoryRequested()

    implicitHeight: content.implicitHeight
    Accessible.role: Accessible.Grouping
    Accessible.name: "Empty transcript"

    Flickable {
        anchors.fill: parent
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        contentWidth: width
        contentHeight: Math.max(height, content.implicitHeight + 32)

        ColumnLayout {
            id: content
            x: Math.max(12, (parent.width - width) / 2)
            y: Math.max(16, (parent.height - implicitHeight) / 2)
            width: Math.max(0, Math.min(parent.width - 24, 420))
            spacing: 12

            Label {
                Layout.fillWidth: true
                text: empty.ready ? "Start a conversation" : empty.backendReady ? "Starting Pi…" : "Starting Qt WebUI…"
                textFormat: Text.PlainText
                color: empty.theme.heading
                font.pixelSize: 20
                font.bold: true
                horizontalAlignment: Text.AlignHCenter
            }

            Label {
                Layout.fillWidth: true
                text: empty.ready ? "Ask about this workspace, resume earlier work, or open another folder." : "Your workspace will be ready shortly."
                textFormat: Text.PlainText
                color: empty.theme.muted
                font.pixelSize: 12
                wrapMode: Text.Wrap
                horizontalAlignment: Text.AlignHCenter
            }

            Flow {
                Layout.fillWidth: true
                Layout.preferredHeight: childrenRect.height
                visible: empty.ready
                spacing: 8

                AppButton {
                    theme: empty.theme
                    text: "Focus prompt"
                    accessibleName: "Focus the prompt"
                    accessibleDescription: "Ctrl+L"
                    onClicked: empty.focusComposerRequested()
                }

                AppButton {
                    theme: empty.theme
                    text: "Resume session"
                    accessibleName: "Resume a saved session in this tab"
                    accessibleDescription: "Ctrl+Shift+O"
                    onClicked: empty.resumeRequested()
                }

                AppButton {
                    theme: empty.theme
                    text: "Open folder"
                    accessibleName: "Open another folder in a new tab"
                    accessibleDescription: "Ctrl+O"
                    onClicked: empty.openDirectoryRequested()
                }
            }

            Label {
                Layout.fillWidth: true
                visible: empty.ready
                text: "Enter sends  ·  Shift+Enter adds a line  ·  Ctrl+F searches  ·  Ctrl+K opens the palette"
                textFormat: Text.PlainText
                color: empty.theme.muted
                font.family: empty.theme.monospaceFamily
                font.pixelSize: 11
                wrapMode: Text.Wrap
                horizontalAlignment: Text.AlignHCenter
            }

            AppButton {
                Layout.alignment: Qt.AlignHCenter
                visible: !empty.ready
                theme: empty.theme
                variant: "warning"
                text: "Restart Pi"
                accessibleName: "Restart Pi"
                onClicked: empty.restartRequested()
            }
        }
    }
}
