import QtQuick
import QtQuick.Controls

// Animated "Pi is working" row shown under the last transcript entry while a run is active.
Item {
    id: indicator

    required property QtObject theme
    property bool running: false
    property string statusText: ""

    implicitHeight: running ? row.implicitHeight + 12 : 0
    visible: running
    Accessible.role: Accessible.StaticText
    Accessible.name: statusText.length > 0 ? statusText : "Pi is working"

    Row {
        id: row
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        spacing: 10

        Row {
            anchors.verticalCenter: parent.verticalCenter
            spacing: 5

            Repeater {
                model: 3

                Rectangle {
                    required property int index
                    width: 8
                    height: 8
                    radius: 4
                    color: indicator.theme.accent
                    opacity: 0.3

                    SequentialAnimation on opacity {
                        running: indicator.running
                        loops: Animation.Infinite
                        PauseAnimation { duration: index * 160 }
                        NumberAnimation { to: 1.0; duration: 320; easing.type: Easing.InOutQuad }
                        NumberAnimation { to: 0.3; duration: 320; easing.type: Easing.InOutQuad }
                        PauseAnimation { duration: (2 - index) * 160 }
                    }
                }
            }
        }

        Label {
            anchors.verticalCenter: parent.verticalCenter
            text: indicator.statusText.length > 0 && indicator.statusText !== "Running" ? indicator.statusText : "Pi is working…"
            textFormat: Text.PlainText
            color: indicator.theme.muted
            font.pixelSize: 12
            font.italic: true
            elide: Text.ElideRight
        }
    }
}
