import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Transcript search: query field, match position, previous/next, and close. Searches original
// message text (not styled markup), so results match what Copy produces.
Rectangle {
    id: bar

    required property QtObject theme
    property int matchCount: 0
    property int currentIndex: -1
    property alias query: field.text

    signal queryEdited(string query)
    signal nextRequested()
    signal previousRequested()
    signal closeRequested()

    implicitHeight: layout.implicitHeight + theme.space2Xl
    radius: theme.radiusMedium
    color: theme.surface
    border.width: theme.borderWidth
    border.color: field.activeFocus ? theme.focusRing : theme.border
    Accessible.role: Accessible.Grouping
    Accessible.name: "Transcript search"

    function focusField() {
        field.forceActiveFocus()
        field.selectAll()
    }

    RowLayout {
        id: layout
        anchors.fill: parent
        anchors.margins: bar.theme.spaceMd
        spacing: bar.theme.spaceMd

        TextField {
            id: field
            Layout.fillWidth: true
            placeholderText: "Search transcript"
            color: bar.theme.foreground
            placeholderTextColor: bar.theme.muted
            selectionColor: bar.theme.selection
            background: Rectangle {
                radius: bar.theme.radiusSmall
                color: bar.theme.surfaceRaised
                border.width: bar.theme.borderWidth
                border.color: bar.theme.border
            }
            Accessible.role: Accessible.EditableText
            Accessible.name: "Search query"
            Accessible.description: "Enter moves to the next match, Shift+Enter to the previous, Escape closes search"
            onTextChanged: bar.queryEdited(text)
            Keys.onPressed: event => {
                if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                    if (event.modifiers & Qt.ShiftModifier) bar.previousRequested()
                    else bar.nextRequested()
                    event.accepted = true
                } else if (event.key === Qt.Key_Escape) {
                    bar.closeRequested()
                    event.accepted = true
                }
            }
        }

        Label {
            text: bar.matchCount === 0 ? (field.text.length > 0 ? "No matches" : "")
                : (bar.currentIndex + 1) + " of " + bar.matchCount
            textFormat: Text.PlainText
            color: bar.theme.muted
            font.pixelSize: bar.theme.typeBody
            Accessible.role: Accessible.StaticText
            Accessible.name: text
        }

        AppButton {
            theme: bar.theme
            text: "Previous"
            accessibleName: "Previous match"
            enabled: bar.matchCount > 0
            onClicked: bar.previousRequested()
        }

        AppButton {
            theme: bar.theme
            text: "Next"
            accessibleName: "Next match"
            enabled: bar.matchCount > 0
            onClicked: bar.nextRequested()
        }

        AppButton {
            theme: bar.theme
            variant: "ghost"
            text: "Close"
            accessibleName: "Close search"
            onClicked: bar.closeRequested()
        }
    }
}
