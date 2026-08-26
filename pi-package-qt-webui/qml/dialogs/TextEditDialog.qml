import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../components"

// Multi-line editor dialog used for text attachments and other bounded plain-text values.
// Ctrl+Enter saves, Escape cancels; `saved` fires at most once per presentation.
AppDialog {
    id: dialog

    property string text: ""
    property int maxCharacters: 262144
    property bool answered: false
    readonly property bool overLimit: editor.text.length > maxCharacters

    signal saved(string text)
    signal cancelled()

    initialFocusItem: editor

    function present(config) {
        title = String(config.title || "Edit text")
        message = String(config.message || "")
        maxCharacters = Number(config.maxCharacters) > 0 ? Number(config.maxCharacters) : 262144
        text = String(config.text || "")
        editor.text = text
        answered = false
        open()
    }

    function save() {
        if (answered || overLimit) return false
        answered = true
        saved(editor.text)
        close()
        return true
    }

    function setText(value) {
        editor.text = String(value)
    }

    onClosed: if (!answered) cancelled()

    ScrollView {
        Layout.fillWidth: true
        Layout.preferredHeight: 260
        clip: true

        TextArea {
            id: editor
            wrapMode: TextEdit.Wrap
            textFormat: TextEdit.PlainText
            selectByMouse: true
            color: dialog.theme.foreground
            selectionColor: dialog.theme.selection
            font.family: dialog.theme.monospaceFamily
            font.pixelSize: 12
            background: Rectangle {
                radius: 6
                color: dialog.theme.surfaceRaised
                border.width: editor.activeFocus ? 2 : 1
                border.color: editor.activeFocus ? dialog.theme.focusRing : dialog.theme.border
            }
            Accessible.role: Accessible.EditableText
            Accessible.name: dialog.title
            Accessible.description: "Ctrl+Enter saves, Escape cancels"
            Keys.onPressed: event => {
                if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && (event.modifiers & Qt.ControlModifier)) {
                    dialog.save()
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
            text: dialog.overLimit ? "Text exceeds " + dialog.maxCharacters + " characters" : editor.text.length + " characters"
            textFormat: Text.PlainText
            color: dialog.overLimit ? dialog.theme.destructive : dialog.theme.muted
            font.pixelSize: 11
        }

        AppButton {
            theme: dialog.theme
            text: "Cancel"
            accessibleName: "Cancel editing"
            onClicked: dialog.close()
        }

        AppButton {
            theme: dialog.theme
            variant: "primary"
            text: "Save"
            accessibleName: "Save text"
            enabled: !dialog.overLimit
            onClicked: dialog.save()
        }
    }
}
