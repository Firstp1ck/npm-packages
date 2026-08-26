import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Lifecycle card for one tool call: name, safe argument summary, status, duration, and bounded output.
Rectangle {
    id: card

    required property QtObject theme
    property string toolName: ""
    property string toolSummary: ""
    property string toolStatus: "running"
    property int toolDurationMs: 0
    property string toolOutput: ""
    property string toolError: ""
    property bool compact: false
    property bool expanded: false

    readonly property string statusLabel: toolStatus === "ok" ? "Done" : toolStatus === "error" ? "Failed" : "Running"
    readonly property string durationLabel: toolStatus === "running" ? "" : (toolDurationMs >= 1000 ? (toolDurationMs / 1000).toFixed(1) + " s" : toolDurationMs + " ms")

    signal copyRequested(string text)

    implicitHeight: layout.implicitHeight + theme.space4Xl - theme.spaceXs
    radius: theme.radiusLarge
    color: theme.surface
    border.width: theme.borderWidth
    border.color: toolStatus === "error" ? theme.errorBorder : theme.toolBorder
    Accessible.role: Accessible.Grouping
    Accessible.name: "Tool " + toolName + ", " + statusLabel + (durationLabel.length > 0 ? ", " + durationLabel : "")

    ColumnLayout {
        id: layout
        anchors.fill: parent
        anchors.margins: card.theme.spaceLg
        spacing: card.theme.spaceSm

        RowLayout {
            Layout.fillWidth: true
            spacing: card.theme.spaceMd

            Label {
                text: "Tool"
                textFormat: Text.PlainText
                color: card.theme.muted
                font.pixelSize: card.theme.typeSmall
                font.bold: true
            }

            Label {
                Layout.fillWidth: true
                text: card.toolName
                textFormat: Text.PlainText
                color: card.theme.foreground
                font.family: card.theme.monospaceFamily
                font.pixelSize: card.theme.typeBody + 1
                font.bold: true
                elide: Text.ElideRight
            }

            Label {
                visible: card.durationLabel.length > 0
                text: card.durationLabel
                textFormat: Text.PlainText
                color: card.theme.muted
                font.pixelSize: card.theme.typeSmall
            }

            StatusBadge {
                theme: card.theme
                kind: card.toolStatus === "ok" ? "ok" : card.toolStatus === "error" ? "error" : "tool"
                text: card.statusLabel
                fontSize: 11
            }
        }

        Label {
            Layout.fillWidth: true
            visible: card.toolSummary.length > 0 && !card.compact
            text: card.toolSummary
            textFormat: Text.PlainText
            wrapMode: Text.Wrap
            maximumLineCount: 3
            elide: Text.ElideRight
            color: card.theme.muted
            font.family: card.theme.monospaceFamily
            font.pixelSize: card.theme.typeBody
        }

        Label {
            Layout.fillWidth: true
            visible: card.toolError.length > 0
            text: card.toolError
            textFormat: Text.PlainText
            wrapMode: Text.Wrap
            color: card.theme.errorPanelForeground
            font.pixelSize: card.theme.typeBody
        }

        RowLayout {
            Layout.fillWidth: true
            visible: card.toolOutput.length > 0

            AppButton {
                theme: card.theme
                variant: "ghost"
                text: card.expanded ? "Hide output" : "Show output (" + card.toolOutput.length + " chars)"
                accessibleName: (card.expanded ? "Hide" : "Show") + " output of tool " + card.toolName
                onClicked: card.expanded = !card.expanded
            }

            AppButton {
                theme: card.theme
                variant: "ghost"
                text: "Copy output"
                accessibleName: "Copy output of tool " + card.toolName
                onClicked: card.copyRequested(card.toolOutput)
            }
        }

        Rectangle {
            Layout.fillWidth: true
            visible: card.expanded && card.toolOutput.length > 0
            implicitHeight: outputEdit.implicitHeight + card.theme.space2Xl
            radius: card.theme.radiusSmall
            color: card.theme.codeBackground
            border.width: card.theme.borderWidth
            border.color: card.theme.codeBorder

            TextEdit {
                id: outputEdit
                anchors.fill: parent
                anchors.margins: card.theme.spaceMd
                text: card.toolOutput
                textFormat: TextEdit.PlainText
                readOnly: true
                selectByMouse: true
                wrapMode: TextEdit.WrapAnywhere
                color: card.theme.codeForeground
                selectionColor: card.theme.selection
                selectedTextColor: card.theme.codeForeground
                font.family: card.theme.monospaceFamily
                font.pixelSize: card.theme.typeBody
                Accessible.role: Accessible.StaticText
                Accessible.name: "Output of tool " + card.toolName
            }
        }
    }
}
