import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Base modal dialog: dims the window, contains focus, gives the initial focus to one control,
// closes on Escape, and returns focus to the item that owned it before opening.
Popup {
    id: dialog

    required property QtObject theme
    property string title: ""
    property string message: ""
    property Item initialFocusItem: null
    property Item returnFocusItem: null
    property bool focusedOnOpen: false
    default property alias content: body.data

    parent: Overlay.overlay
    anchors.centerIn: parent
    width: Math.min(parent ? parent.width - 40 : 560, 560)
    modal: true
    focus: true
    closePolicy: Popup.CloseOnEscape
    padding: 18

    Overlay.modal: Rectangle {
        color: dialog.theme.dialogOverlay
    }

    background: Rectangle {
        radius: 12
        color: dialog.theme.surface
        border.width: 1
        border.color: dialog.theme.border
    }

    onOpened: {
        const target = initialFocusItem
        if (target) {
            target.forceActiveFocus()
            focusedOnOpen = target.activeFocus
        } else {
            focusedOnOpen = dialog.activeFocus
        }
    }

    onClosed: if (returnFocusItem) returnFocusItem.forceActiveFocus()

    contentItem: ColumnLayout {
        spacing: 12
        Accessible.role: Accessible.Dialog
        Accessible.name: dialog.title

        Label {
            Layout.fillWidth: true
            text: dialog.title
            textFormat: Text.PlainText
            wrapMode: Text.Wrap
            maximumLineCount: 3
            elide: Text.ElideRight
            color: dialog.theme.heading
            font.pixelSize: 17
            font.bold: true
            Accessible.role: Accessible.Heading
        }

        Label {
            Layout.fillWidth: true
            visible: dialog.message.length > 0
            text: dialog.message
            textFormat: Text.PlainText
            wrapMode: Text.Wrap
            maximumLineCount: 12
            elide: Text.ElideRight
            color: dialog.theme.foreground
            font.pixelSize: 13
        }

        ColumnLayout {
            id: body
            Layout.fillWidth: true
            spacing: 10
        }
    }
}
