import QtQuick
import QtQuick.Controls

// Animated "Pi is working" row shown under the last transcript entry while a run is active.
Item {
    id: indicator

    required property QtObject theme
    property bool running: false
    property string statusText: ""

    implicitHeight: running ? row.implicitHeight + theme.spaceXl : 0
    visible: running
    Accessible.role: Accessible.StaticText
    Accessible.name: statusText.length > 0 ? statusText : "Pi is working"

    Row {
        id: row
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        spacing: indicator.theme.spaceLg

        Row {
            anchors.verticalCenter: parent.verticalCenter
            spacing: indicator.theme.spaceXs + 1

            Repeater {
                model: 3

                Rectangle {
                    required property int index
                    width: 8
                    height: 8
                    radius: indicator.theme.radiusSmall
                    color: indicator.theme.accent
                    opacity: indicator.theme.reducedMotion ? 1.0 : 0.3

                    SequentialAnimation on opacity {
                        running: indicator.running && !indicator.theme.reducedMotion
                        loops: Animation.Infinite
                        PauseAnimation { duration: index * indicator.theme.motionSlow }
                        NumberAnimation { to: 1.0; duration: indicator.theme.motionSlow * 2; easing.type: Easing.InOutQuad }
                        NumberAnimation { to: 0.3; duration: indicator.theme.motionSlow * 2; easing.type: Easing.InOutQuad }
                        PauseAnimation { duration: (2 - index) * indicator.theme.motionSlow }
                    }
                }
            }
        }

        Label {
            anchors.verticalCenter: parent.verticalCenter
            text: indicator.statusText.length > 0 && indicator.statusText !== "Running" ? indicator.statusText : "Pi is working…"
            textFormat: Text.PlainText
            color: indicator.theme.muted
            font.pixelSize: indicator.theme.typeBody
            font.italic: true
            elide: Text.ElideRight
        }
    }
}
