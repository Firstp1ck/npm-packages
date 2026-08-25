import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import "../components"

// External links open only after the user reads the full address and confirms.
AppDialog {
    id: dialog

    required property var bridge
    property string url: ""

    signal linkOpened(string url, var response)

    title: "Open external link?"
    initialFocusItem: cancelButton

    function present(link) {
        url = String(link)
        open()
    }

    function accept() {
        const target = url
        close()
        bridge.openLink(target, response => dialog.linkOpened(target, response))
    }

    TextEdit {
        Layout.fillWidth: true
        text: dialog.url
        textFormat: TextEdit.PlainText
        readOnly: true
        selectByMouse: true
        wrapMode: TextEdit.WrapAnywhere
        color: dialog.theme.foreground
        selectionColor: dialog.theme.selection
        font.family: dialog.theme.monospaceFamily
        font.pixelSize: 12
        Accessible.role: Accessible.StaticText
        Accessible.name: "Link address " + dialog.url
    }

    Label {
        Layout.fillWidth: true
        text: "The link opens in your default application."
        textFormat: Text.PlainText
        wrapMode: Text.Wrap
        color: dialog.theme.muted
        font.pixelSize: 12
    }

    RowLayout {
        Layout.fillWidth: true
        spacing: 8

        Item { Layout.fillWidth: true }

        AppButton {
            id: cancelButton
            theme: dialog.theme
            text: "Cancel"
            accessibleName: "Do not open the link"
            onClicked: dialog.close()
        }

        AppButton {
            theme: dialog.theme
            variant: "primary"
            text: "Open link"
            accessibleName: "Open the link in the default application"
            onClicked: dialog.accept()
        }
    }
}
