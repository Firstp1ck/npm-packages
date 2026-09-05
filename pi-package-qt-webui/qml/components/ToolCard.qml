import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

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

    implicitHeight: layout.implicitHeight + theme.spaceXs * 2
    radius: theme.radiusLarge
    color: theme.surface
    border.width: theme.borderWidth
    border.color: toolStatus === "error" ? theme.errorBorder : theme.toolBorder
    Accessible.role: Accessible.Grouping
    Accessible.name: "Tool " + toolName + ", " + statusLabel + (durationLabel.length > 0 ? ", " + durationLabel : "")

    ColumnLayout {
        id: layout
        anchors.fill: parent
        anchors.leftMargin: card.theme.spaceMd
        anchors.rightMargin: card.theme.spaceMd
        anchors.topMargin: card.theme.spaceXs
        anchors.bottomMargin: card.theme.spaceXs
        spacing: card.theme.spaceSm

        RowLayout {
            Layout.fillWidth: true
            spacing: card.theme.spaceMd

            AppButton {
                theme: card.theme
                variant: "ghost"
                implicitWidth: card.theme.controlHeight
                implicitHeight: card.theme.controlHeight
                text: card.expanded ? "▾" : "▸"
                accessibleName: (card.expanded ? "Collapse" : "Expand") + " tool " + card.toolName
                active: card.expanded
                enabled: card.toolSummary.length > 0 || card.toolError.length > 0 || card.toolOutput.length > 0
                ToolTip.visible: hovered || activeFocus
                ToolTip.text: accessibleName
                onClicked: card.expanded = !card.expanded
            }

            Item {
                id: toolHeading
                Layout.fillWidth: true
                Layout.minimumWidth: 0
                implicitWidth: toolNameLabel.implicitWidth
                implicitHeight: Math.max(toolNameLabel.implicitHeight, inlineSummaryLabel.implicitHeight)

                SelectableText {
                    id: toolNameLabel
                    objectName: "toolNameLabel"
                    anchors.left: parent.left
                    anchors.verticalCenter: parent.verticalCenter
                    width: Math.min(implicitWidth, parent.width)
                    maximumLineCount: 1
                    theme: card.theme
                    text: card.toolName
                    color: card.theme.foreground
                    font.family: card.theme.monospaceFamily
                    font.pixelSize: card.theme.typeBody + 1
                    font.bold: true
                }

                SelectableText {
                    id: inlineSummaryLabel
                    objectName: "inlineToolSummary"
                    anchors.verticalCenter: parent.verticalCenter
                    x: toolNameLabel.width + card.theme.spaceSm
                    width: Math.max(0, parent.width - x)
                    readonly property bool truncated: summaryMetrics.advanceWidth > width
                    visible: text.length > 0 && width > 0 && (!truncated || width >= summaryDots.implicitWidth)
                    maximumLineCount: 1
                    rightPadding: truncated ? Math.min(width, summaryDots.implicitWidth) : 0
                    theme: card.theme
                    text: card.toolSummary.replace(/\s+/g, " ").trim()
                    color: card.theme.muted
                    font.family: card.theme.monospaceFamily
                    font.pixelSize: card.theme.typeBody

                    TextMetrics {
                        id: summaryMetrics
                        font: inlineSummaryLabel.font
                        text: inlineSummaryLabel.text
                    }

                    // Reserve the suffix separately so selection still copies the full summary.
                    Text {
                        id: summaryDots
                        objectName: "inlineToolSummaryDots"
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        visible: inlineSummaryLabel.truncated
                        text: "..."
                        textFormat: Text.PlainText
                        font: inlineSummaryLabel.font
                        color: inlineSummaryLabel.color
                    }
                }
            }

            SelectableText {
                visible: card.durationLabel.length > 0
                theme: card.theme
                text: card.durationLabel
                color: card.theme.muted
                font.pixelSize: card.theme.typeSmall
            }

            StatusBadge {
                theme: card.theme
                kind: card.toolStatus === "ok" ? "ok" : card.toolStatus === "error" ? "error" : "tool"
                text: card.statusLabel
                fontSize: card.theme.typeSmall
            }

            AppButton {
                theme: card.theme
                variant: "ghost"
                implicitWidth: card.theme.controlHeight
                implicitHeight: card.theme.controlHeight
                text: "⧉"
                accessibleName: "Copy output of tool " + card.toolName
                enabled: card.toolOutput.length > 0
                ToolTip.visible: hovered || activeFocus
                ToolTip.text: enabled ? accessibleName : "No tool output to copy"
                onClicked: card.copyRequested(card.toolOutput)
            }
        }

        SelectableText {
            id: toolSummaryLabel
            objectName: "expandedToolSummary"
            Layout.fillWidth: true
            visible: card.expanded && card.toolSummary.length > 0
            theme: card.theme
            text: card.toolSummary
            wrapMode: TextEdit.Wrap
            maximumLineCount: 3
            color: card.theme.muted
            font.family: card.theme.monospaceFamily
            font.pixelSize: card.theme.typeBody
        }

        TextEdit {
            id: toolErrorLabel
            Layout.fillWidth: true
            visible: card.expanded && card.toolError.length > 0
            text: card.toolError
            textFormat: TextEdit.PlainText
            readOnly: true
            selectByMouse: true
            selectByKeyboard: true
            wrapMode: TextEdit.Wrap
            selectionColor: card.theme.selection
            selectedTextColor: card.theme.selectionForeground
            color: card.theme.errorPanelForeground
            font.pixelSize: card.theme.typeBody
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
                selectByKeyboard: true
                wrapMode: TextEdit.WrapAnywhere
                color: card.theme.codeForeground
                selectionColor: card.theme.selection
                selectedTextColor: card.theme.selectionForeground
                font.family: card.theme.monospaceFamily
                font.pixelSize: card.theme.typeBody
                Accessible.role: Accessible.StaticText
                Accessible.name: "Output of tool " + card.toolName
            }
        }
    }
}
