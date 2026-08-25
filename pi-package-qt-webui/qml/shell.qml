import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import "components"

ShellRoot {
    id: root

    Theme {
        id: appTheme
    }

    PiBridge {
        id: bridge
    }

    Component.onCompleted: {
        if (Quickshell.env("QT_WEBUI_SMOKE_MODE") === "1") {
            console.log("QT_WEBUI_SMOKE_THEME_" + (appTheme.dark ? "DARK" : "LIGHT"))
        }
    }

    FloatingWindow {
        id: window
        visible: true
        title: "Qt WebUI"
        implicitWidth: 760
        implicitHeight: 720
        minimumSize: Qt.size(520, 480)
        color: appTheme.windowBackground
        surfaceFormat.opaque: true

        Rectangle {
            parent: window.contentItem
            anchors.fill: parent
            color: appTheme.windowBackground

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 20
                spacing: 14

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 12

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 3

                        Label {
                            text: "Qt WebUI"
                            color: appTheme.foreground
                            font.pixelSize: 22
                            font.bold: true
                        }

                        Label {
                            Layout.fillWidth: true
                            text: bridge.callerCwd
                            textFormat: Text.PlainText
                            color: appTheme.muted
                            elide: Text.ElideMiddle
                            font.pixelSize: 12
                        }
                    }

                    Rectangle {
                        implicitWidth: statusLabel.implicitWidth + 24
                        implicitHeight: 30
                        radius: 15
                        color: appTheme.statusBackground(bridge.statusKind)
                        border.width: 1
                        border.color: appTheme.statusBorder(bridge.statusKind)

                        Behavior on color { ColorAnimation { duration: 120 } }

                        Label {
                            id: statusLabel
                            anchors.centerIn: parent
                            text: bridge.statusText
                            textFormat: Text.PlainText
                            color: appTheme.statusForeground(bridge.statusKind)
                            font.pixelSize: 12
                            font.bold: true
                        }
                    }
                }

                Rectangle {
                    Layout.fillWidth: true
                    visible: bridge.visibleError.length > 0
                    implicitHeight: errorLabel.implicitHeight + 20
                    radius: 8
                    color: appTheme.errorPanelBackground
                    border.width: 1
                    border.color: appTheme.errorPanelBorder

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

                ScrollView {
                    id: transcriptView
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    clip: true
                    ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

                    ListView {
                        id: transcriptList
                        model: bridge.transcriptModel
                        spacing: 12
                        boundsBehavior: Flickable.StopAtBounds
                        onCountChanged: Qt.callLater(positionViewAtEnd)

                        delegate: ChatMessage {
                            required property string messageRole
                            required property string messageText
                            width: transcriptList.width
                            theme: appTheme
                        }

                        Label {
                            anchors.centerIn: parent
                            visible: transcriptList.count === 0
                            text: bridge.ready ? "Send a prompt to begin." : "Starting Pi…"
                            color: appTheme.muted
                            font.pixelSize: 14
                        }
                    }
                }

                Composer {
                    id: composer
                    Layout.fillWidth: true
                    active: bridge.active
                    ready: bridge.ready
                    processRunning: bridge.processRunning
                    theme: appTheme
                    onSendRequested: text => {
                        if (bridge.sendPrompt(text)) clearAndFocus()
                    }
                    onAbortRequested: bridge.abortRun()
                    onRestartRequested: bridge.restartProcess()
                }
            }
        }
    }
}
