import QtQuick
import QtQuick.Controls

// Plain-text reading surface with native mouse/keyboard selection. Long selectable values clip
// instead of eliding so the visible glyphs and selected source always use the same layout.
Item {
    id: root

    required property QtObject theme
    property string text: ""
    property int maximumLineCount: 0
    property real leftPadding: 0
    property real rightPadding: 0
    property real topPadding: 0
    property real bottomPadding: 0
    property alias color: editor.color
    property alias font: editor.font
    property alias wrapMode: editor.wrapMode
    property alias horizontalAlignment: editor.horizontalAlignment
    property alias verticalAlignment: editor.verticalAlignment
    property alias selectedText: editor.selectedText

    signal tapped()

    readonly property real oneLineHeight: lineMetrics.implicitHeight
    implicitWidth: editor.implicitWidth + leftPadding + rightPadding
    implicitHeight: (maximumLineCount > 0
        ? Math.min(editor.contentHeight, maximumLineCount * oneLineHeight) : editor.contentHeight)
        + topPadding + bottomPadding

    Text {
        id: lineMetrics
        visible: false
        text: "M"
        font: editor.font
    }

    TextEdit {
        id: editor
        anchors.fill: parent
        anchors.leftMargin: root.leftPadding
        anchors.rightMargin: root.rightPadding
        anchors.topMargin: root.topPadding
        anchors.bottomMargin: root.bottomPadding
        text: root.text
        textFormat: TextEdit.PlainText
        readOnly: true
        selectByMouse: true
        selectByKeyboard: true
        wrapMode: TextEdit.NoWrap
        selectionColor: root.theme.selection
        selectedTextColor: root.theme.selectionForeground
        color: root.theme.foreground
        clip: true

        HoverHandler {
            cursorShape: Qt.IBeamCursor
        }

        TapHandler {
            acceptedButtons: Qt.LeftButton
            gesturePolicy: TapHandler.DragThreshold
            onTapped: root.tapped()
        }
    }
}
