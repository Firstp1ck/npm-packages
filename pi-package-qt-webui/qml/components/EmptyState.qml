import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Shown while the transcript is empty. The header already names the workspace and model, so this
// stays to a greeting, the essential shortcuts, and the one action that matters right now.
Item {
    id: empty

    required property QtObject theme
    property bool ready: false
    property bool backendReady: false

    signal restartRequested()
    signal focusComposerRequested()

    implicitHeight: column.implicitHeight
    Accessible.role: Accessible.Grouping
    Accessible.name: "Empty transcript"

    ColumnLayout {
        id: column
        anchors.centerIn: parent
        width: Math.min(parent.width - 40, 440)
        spacing: 14

        Label {
            Layout.fillWidth: true
            text: empty.ready ? "Ready when you are" : empty.backendReady ? "Starting Pi…" : "Starting Qt WebUI…"
            textFormat: Text.PlainText
            color: empty.theme.heading
            font.pixelSize: 20
            font.bold: true
            horizontalAlignment: Text.AlignHCenter
        }

        GridLayout {
            Layout.alignment: Qt.AlignHCenter
            columns: 2
            columnSpacing: 14
            rowSpacing: 4

            Repeater {
                model: [
                    "Enter", "Send · Shift+Enter adds a line",
                    "Ctrl+F", "Search the transcript",
                    "Ctrl+T", "Show or hide thinking",
                    "Ctrl+Shift+M", "Compact rows",
                ]
                delegate: Label {
                    required property int index
                    required property string modelData
                    text: modelData
                    textFormat: Text.PlainText
                    color: index % 2 === 0 ? empty.theme.foreground : empty.theme.muted
                    font.family: index % 2 === 0 ? empty.theme.monospaceFamily : Qt.application.font.family
                    font.pixelSize: 12
                    horizontalAlignment: index % 2 === 0 ? Text.AlignRight : Text.AlignLeft
                    Layout.alignment: index % 2 === 0 ? Qt.AlignRight : Qt.AlignLeft
                }
            }
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
