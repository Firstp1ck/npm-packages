import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// One transcript row: a user message, an assistant text part, a thinking part, or a tool card.
Item {
    id: row

    required property QtObject theme
    required property string rowId
    required property string messageId
    required property string role
    required property string kind
    required property string text
    required property string blocksJson
    required property bool truncated
    required property bool streaming
    required property string modeLabel
    required property string toolName
    required property string toolSummary
    required property string toolStatus
    required property int toolDurationMs
    required property string toolOutput
    required property string toolError
    property bool compact: false
    property bool showThinking: true
    property bool searchMatch: false
    property bool searchCurrent: false

    readonly property bool fromUser: kind === "user"
    readonly property bool hidden: kind === "thinking" && !showThinking
    readonly property string roleLabel: fromUser ? "You" : kind === "thinking" ? "Thinking" : kind === "tool" ? "Tool" : "Pi"

    signal copyRequested(string text)
    signal linkActivated(string link)

    implicitHeight: hidden ? 0 : bubble.implicitHeight
    visible: !hidden
    Accessible.role: Accessible.Grouping
    Accessible.name: roleLabel + (streaming ? ", streaming" : "") + (truncated ? ", shortened" : "")

    Rectangle {
        id: bubble
        anchors.left: row.fromUser ? undefined : parent.left
        anchors.right: row.fromUser ? parent.right : undefined
        width: row.kind === "tool" ? parent.width
            : Math.min(parent.width * (row.compact ? 0.98 : 0.92), Math.max(row.fromUser ? 120 : 240, content.implicitWidth + 32))
        implicitHeight: content.implicitHeight + (row.compact ? 16 : 24)
        radius: 10
        color: row.kind === "tool" ? "transparent"
            : row.searchCurrent ? row.theme.searchHighlight
            : row.fromUser ? row.theme.userBubble
            : row.kind === "thinking" ? row.theme.thinkingBackground
            : row.theme.assistantBubble
        border.width: row.kind === "tool" ? 0 : (row.searchMatch ? 2 : 1)
        border.color: row.searchCurrent ? row.theme.focusRing
            : row.searchMatch ? row.theme.accent
            : row.fromUser ? row.theme.userBorder
            : row.kind === "thinking" ? row.theme.thinkingBorder
            : row.theme.assistantBorder

        Behavior on color { ColorAnimation { duration: row.theme.animationDuration } }

        ColumnLayout {
            id: content
            anchors.fill: parent
            anchors.margins: row.kind === "tool" ? 0 : (row.compact ? 8 : 12)
            spacing: row.compact ? 3 : 6

            RowLayout {
                Layout.fillWidth: true
                visible: row.kind !== "tool"
                spacing: 8

                Label {
                    text: row.roleLabel
                    textFormat: Text.PlainText
                    color: row.fromUser ? row.theme.accentForeground
                        : row.kind === "thinking" ? row.theme.thinkingForeground : row.theme.muted
                    font.bold: true
                    font.pixelSize: 12
                }

                Label {
                    visible: row.modeLabel.length > 0
                    text: row.modeLabel
                    textFormat: Text.PlainText
                    color: row.theme.muted
                    font.pixelSize: 11
                }

                Label {
                    visible: row.streaming
                    text: "streaming…"
                    textFormat: Text.PlainText
                    color: row.theme.muted
                    font.pixelSize: 11
                    font.italic: true
                }

                Label {
                    visible: row.truncated
                    text: "shortened"
                    textFormat: Text.PlainText
                    color: row.theme.warning
                    font.pixelSize: 11
                }

                Item { Layout.fillWidth: true }

                AppButton {
                    visible: row.text.length > 0
                    theme: row.theme
                    variant: "ghost"
                    text: "Copy"
                    accessibleName: "Copy " + row.roleLabel + " message"
                    onClicked: row.copyRequested(row.text)
                }
            }

            Label {
                Layout.fillWidth: true
                visible: row.kind === "user" || row.kind === "thinking"
                text: row.text
                textFormat: Text.PlainText
                wrapMode: Text.Wrap
                color: row.kind === "thinking" ? row.theme.thinkingForeground : row.theme.foreground
                font.pixelSize: row.compact ? 13 : 14
                font.italic: row.kind === "thinking"
                lineHeight: 1.2
            }

            MarkdownBlocks {
                Layout.fillWidth: true
                visible: row.kind === "text"
                theme: row.theme
                compact: row.compact
                blocksJson: row.kind === "text" ? row.blocksJson : "[]"
                onLinkActivated: link => row.linkActivated(link)
                onCopyRequested: text => row.copyRequested(text)
            }

            ToolCard {
                Layout.fillWidth: true
                visible: row.kind === "tool"
                theme: row.theme
                compact: row.compact
                toolName: row.toolName
                toolSummary: row.toolSummary
                toolStatus: row.toolStatus
                toolDurationMs: row.toolDurationMs
                toolOutput: row.toolOutput
                toolError: row.toolError
                onCopyRequested: text => row.copyRequested(text)
            }
        }
    }
}
