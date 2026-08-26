import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Renders the bounded block list produced by the backend Markdown renderer. Inline content is
// StyledText that the backend already escaped and restricted to a small tag whitelist, so this
// component only lays blocks out; it never parses Markdown or HTML itself.
Column {
    id: root

    required property QtObject theme
    property string blocksJson: "[]"
    property bool compact: false
    property bool highlight: true
    readonly property var blocks: parseBlocks(blocksJson)

    signal linkActivated(string link)
    signal copyRequested(string text)

    spacing: compact ? 4 : 8

    function parseBlocks(json) {
        try {
            const parsed = JSON.parse(json)
            return Array.isArray(parsed) ? parsed : []
        } catch (error) {
            return []
        }
    }

    // Tokens are [kind, escapedText] pairs from the backend; only the color comes from the theme.
    // <pre> keeps newlines and indentation, which StyledText would otherwise collapse.
    function styledCode(tokens) {
        let markup = "<pre>"
        for (const token of tokens) {
            const kind = String(token[0])
            const text = String(token[1])
            if (kind === "text") markup += text
            else markup += "<font color=\"" + String(theme.syntaxColor(kind)) + "\">" + text + "</font>"
        }
        return markup + "</pre>"
    }

    function headingSize(level) {
        return [22, 19, 17, 15, 14, 13][Math.max(1, Math.min(6, level)) - 1]
    }

    Repeater {
        model: root.blocks

        delegate: Loader {
            id: blockLoader
            required property var modelData
            readonly property var block: modelData
            width: root.width
            sourceComponent: {
                switch (block.type) {
                case "heading": return headingComponent
                case "code": return codeComponent
                case "listItem": return listItemComponent
                case "table": return tableComponent
                case "rule": return ruleComponent
                case "notice": return noticeComponent
                default: return paragraphComponent
                }
            }
        }
    }

    Component {
        id: paragraphComponent
        Row {
            readonly property var block: parent.block
            spacing: 8
            leftPadding: block.depth > 0 ? Math.min(block.depth, 4) * 14 : 0

            Rectangle {
                visible: block.quote === true
                width: 3
                height: paragraphLabel.implicitHeight
                radius: 1
                color: root.theme.quoteBorder
            }

            Label {
                id: paragraphLabel
                width: parent.width - parent.leftPadding - (block.quote === true ? 11 : 0)
                text: block.styled || ""
                textFormat: Text.StyledText
                wrapMode: Text.Wrap
                color: block.quote === true ? root.theme.muted : root.theme.foreground
                linkColor: root.theme.link
                font.pixelSize: root.compact ? 13 : 14
                font.italic: block.quote === true
                lineHeight: 1.2
                Accessible.role: Accessible.Paragraph
                onLinkActivated: link => root.linkActivated(link)
                HoverHandler {
                    cursorShape: paragraphLabel.hoveredLink.length > 0 ? Qt.PointingHandCursor : Qt.ArrowCursor
                }
            }
        }
    }

    Component {
        id: headingComponent
        Label {
            readonly property var block: parent.block
            width: parent.width
            text: block.styled || ""
            textFormat: Text.StyledText
            wrapMode: Text.Wrap
            color: root.theme.heading
            linkColor: root.theme.link
            font.pixelSize: root.headingSize(block.level)
            font.bold: true
            topPadding: root.compact ? 2 : 6
            Accessible.role: Accessible.Heading
            onLinkActivated: link => root.linkActivated(link)
        }
    }

    Component {
        id: codeComponent
        Rectangle {
            id: codeBlock
            readonly property var block: parent.block
            readonly property bool hasTokens: Array.isArray(block.tokens) && block.tokens.length > 0
            // Highlighted code is styled text without selection; "Select text" swaps in the plain
            // editor so the user can select, then swaps back. Copy always uses the original text.
            property bool selectable: false
            readonly property bool highlighted: root.highlight && hasTokens && !selectable
            width: parent.width
            implicitHeight: codeColumn.implicitHeight + 16
            radius: 8
            color: root.theme.codeBackground
            border.width: 1
            border.color: root.theme.codeBorder

            ColumnLayout {
                id: codeColumn
                anchors.fill: parent
                anchors.margins: 8
                spacing: 4

                RowLayout {
                    Layout.fillWidth: true
                    Label {
                        Layout.fillWidth: true
                        text: (block.language && block.language.length > 0 ? block.language : "code") + (block.closed === false ? " · unterminated" : "")
                        textFormat: Text.PlainText
                        color: root.theme.muted
                        font.pixelSize: 11
                        font.family: root.theme.monospaceFamily
                        elide: Text.ElideRight
                    }
                    AppButton {
                        visible: root.highlight && codeBlock.hasTokens
                        theme: root.theme
                        variant: "ghost"
                        active: codeBlock.selectable
                        text: codeBlock.selectable ? "Highlight" : "Select text"
                        accessibleName: codeBlock.selectable ? "Show highlighted code" : "Show selectable plain code"
                        onClicked: codeBlock.selectable = !codeBlock.selectable
                    }
                    AppButton {
                        theme: root.theme
                        variant: "ghost"
                        text: "Copy"
                        accessibleName: "Copy code block"
                        onClicked: root.copyRequested(block.text || "")
                    }
                }

                Label {
                    Layout.fillWidth: true
                    visible: codeBlock.highlighted
                    text: codeBlock.highlighted ? root.styledCode(block.tokens) : ""
                    textFormat: Text.StyledText
                    wrapMode: Text.WrapAnywhere
                    color: root.theme.codeForeground
                    font.family: root.theme.monospaceFamily
                    font.pixelSize: root.compact ? 12 : 13
                    Accessible.role: Accessible.StaticText
                    Accessible.name: "Highlighted code block"
                }

                TextEdit {
                    Layout.fillWidth: true
                    visible: !codeBlock.highlighted
                    text: block.text || ""
                    textFormat: TextEdit.PlainText
                    readOnly: true
                    selectByMouse: true
                    selectByKeyboard: true
                    wrapMode: TextEdit.WrapAnywhere
                    color: root.theme.codeForeground
                    selectionColor: root.theme.selection
                    selectedTextColor: root.theme.codeForeground
                    font.family: root.theme.monospaceFamily
                    font.pixelSize: root.compact ? 12 : 13
                    Accessible.role: Accessible.StaticText
                    Accessible.name: "Code block"
                }
            }
        }
    }

    Component {
        id: listItemComponent
        Row {
            readonly property var block: parent.block
            spacing: 8
            leftPadding: Math.min(block.depth || 0, 4) * 18

            Label {
                width: 22
                text: block.task === true ? (block.checked === true ? "☑" : "☐")
                    : block.ordered === true ? String(block.index || 1) + "." : "•"
                textFormat: Text.PlainText
                color: root.theme.muted
                horizontalAlignment: Text.AlignRight
                font.pixelSize: root.compact ? 13 : 14
            }

            Label {
                id: itemLabel
                width: parent.width - parent.leftPadding - 30
                text: block.styled || ""
                textFormat: Text.StyledText
                wrapMode: Text.Wrap
                color: root.theme.foreground
                linkColor: root.theme.link
                font.pixelSize: root.compact ? 13 : 14
                font.strikeout: block.task === true && block.checked === true
                Accessible.role: Accessible.ListItem
                onLinkActivated: link => root.linkActivated(link)
                HoverHandler {
                    cursorShape: itemLabel.hoveredLink.length > 0 ? Qt.PointingHandCursor : Qt.ArrowCursor
                }
            }
        }
    }

    Component {
        id: tableComponent
        Flickable {
            id: tableFlick
            readonly property var block: parent.block
            readonly property int columnCount: Math.max(1, (block.header || []).length)
            width: parent.width
            implicitHeight: grid.implicitHeight + (block.droppedRows > 0 ? droppedLabel.implicitHeight + 4 : 0)
            contentWidth: grid.implicitWidth
            clip: true
            interactive: contentWidth > width
            Accessible.role: Accessible.Table

            GridLayout {
                id: grid
                // The GridLayout's parent is the Flickable's contentItem, so refer to the Flickable by id.
                columns: tableFlick.columnCount
                rowSpacing: 0
                columnSpacing: 0

                Repeater {
                    model: (block.header || []).concat((block.rows || []).reduce((all, row) => all.concat(row), []))
                    delegate: Rectangle {
                        required property int index
                        required property var modelData
                        readonly property bool isHeader: index < grid.columns
                        Layout.fillWidth: true
                        Layout.minimumWidth: 60
                        implicitWidth: cellLabel.implicitWidth + 16
                        implicitHeight: cellLabel.implicitHeight + 10
                        color: isHeader ? root.theme.surfaceRaised : "transparent"
                        border.width: 1
                        border.color: root.theme.tableBorder

                        Label {
                            id: cellLabel
                            anchors.fill: parent
                            anchors.margins: 5
                            text: String(modelData ?? "")
                            textFormat: Text.StyledText
                            wrapMode: Text.Wrap
                            color: root.theme.foreground
                            linkColor: root.theme.link
                            font.bold: parent.isHeader
                            font.pixelSize: root.compact ? 12 : 13
                            onLinkActivated: link => root.linkActivated(link)
                        }
                    }
                }
            }

            Label {
                id: droppedLabel
                anchors.top: grid.bottom
                anchors.topMargin: 4
                visible: block.droppedRows > 0
                text: visible ? block.droppedRows + " more rows omitted" : ""
                textFormat: Text.PlainText
                color: root.theme.muted
                font.pixelSize: 11
            }
        }
    }

    Component {
        id: ruleComponent
        Rectangle {
            readonly property var block: parent.block
            width: parent.width
            height: 1
            color: root.theme.border
        }
    }

    Component {
        id: noticeComponent
        Label {
            readonly property var block: parent.block
            width: parent.width
            text: block.styled || ""
            textFormat: Text.StyledText
            wrapMode: Text.Wrap
            color: root.theme.muted
            font.italic: true
            font.pixelSize: 12
        }
    }
}
