import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// One button per tab (one Pi session in one directory), with a status dot, unread and
// needs-input badges, and a close control, plus actions to open a new tab in the same folder or
// another folder. The same tab model supports the top-strip and workspace-rail layouts.
Rectangle {
    id: strip

    required property QtObject theme
    property var tabs: []
    property string activeTabId: ""
    property int maxTabs: 8
    property string homeDirectory: ""
    property string orientation: "horizontal" // horizontal | vertical
    readonly property bool vertical: orientation === "vertical"

    signal selectRequested(string tabId)
    signal closeRequested(string tabId)
    signal newTabRequested()
    signal openDirectoryRequested()

    implicitWidth: vertical ? 196 : 520
    implicitHeight: vertical ? 260 : 46
    radius: 8
    color: theme.surfaceRaised
    border.width: 1
    border.color: theme.border
    Accessible.role: Accessible.PageTabList
    Accessible.name: tabs.length + " tabs"

    function tabLabel(tab) {
        if (tab.name && tab.name.length > 0) return tab.name
        if (tab.sessionName && tab.sessionName.length > 0) return tab.sessionName
        const parts = String(tab.cwd || "").split("/").filter(part => part.length > 0)
        return parts.length > 0 ? parts[parts.length - 1] : "/"
    }

    function shortPath(cwd) {
        const text = String(cwd || "")
        if (homeDirectory.length > 1 && text.indexOf(homeDirectory + "/") === 0) return "~" + text.slice(homeDirectory.length)
        return text === homeDirectory && homeDirectory.length > 0 ? "~" : text
    }

    function statusDescription(tab) {
        if (tab.statusKind === "error") return "error"
        if (!tab.ready) return "starting"
        if (tab.active) return "working"
        return "ready"
    }

    function revealActiveTab() {
        for (let index = 0; index < tabs.length; index++) {
            if (tabs[index].id === activeTabId) {
                tabList.positionViewAtIndex(index, ListView.Contain)
                return
            }
        }
    }

    onActiveTabIdChanged: Qt.callLater(revealActiveTab)
    onTabsChanged: Qt.callLater(revealActiveTab)

    GridLayout {
        anchors.fill: parent
        anchors.margins: 4
        columns: strip.vertical ? 1 : 2
        rows: strip.vertical ? 2 : 1
        rowSpacing: 4
        columnSpacing: 4

        ListView {
            id: tabList
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.minimumHeight: strip.vertical ? 80 : 34
            orientation: strip.vertical ? ListView.Vertical : ListView.Horizontal
            spacing: 4
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            model: strip.tabs
            Accessible.role: Accessible.PageTabList
            Accessible.name: strip.Accessible.name

            ScrollBar.vertical: ScrollBar {
                policy: strip.vertical ? ScrollBar.AsNeeded : ScrollBar.AlwaysOff
            }
            ScrollBar.horizontal: ScrollBar {
                policy: strip.vertical ? ScrollBar.AlwaysOff : ScrollBar.AsNeeded
            }

            delegate: Rectangle {
                id: tabItem
                required property int index
                required property var modelData
                readonly property bool current: modelData.id === strip.activeTabId
                readonly property string label: strip.tabLabel(modelData)
                width: strip.vertical ? tabList.width : Math.min(tabRow.implicitWidth + 16, 260)
                height: strip.vertical ? 46 : tabRow.implicitHeight + 10
                radius: 6
                color: current ? strip.theme.surface : "transparent"
                border.width: current ? 1 : 0
                border.color: current ? strip.theme.accent : "transparent"
                Accessible.role: Accessible.PageTab
                Accessible.name: "Tab " + (index + 1) + ": " + label + ", " + strip.statusDescription(modelData)
                    + (modelData.unread > 0 ? ", " + modelData.unread + " unread" : "")
                    + (modelData.needsInput > 0 ? ", needs input" : "") + (current ? ", selected" : "")
                Accessible.selected: current

                ToolTip.visible: tabHover.hovered
                ToolTip.text: strip.shortPath(modelData.cwd) + (modelData.sessionName ? "\n" + modelData.sessionName : "")
                ToolTip.delay: 500

                HoverHandler {
                    id: tabHover
                    cursorShape: Qt.PointingHandCursor
                }

                TapHandler {
                    onTapped: strip.selectRequested(tabItem.modelData.id)
                }

                RowLayout {
                    id: tabRow
                    anchors.fill: parent
                    anchors.leftMargin: 8
                    anchors.rightMargin: 4
                    anchors.topMargin: 4
                    anchors.bottomMargin: 4
                    spacing: 6

                    Rectangle {
                        width: 8
                        height: 8
                        radius: 4
                        color: tabItem.modelData.statusKind === "error" ? strip.theme.destructive
                            : !tabItem.modelData.ready ? strip.theme.muted
                            : tabItem.modelData.active ? strip.theme.runningForeground : strip.theme.readyForeground
                    }

                    ColumnLayout {
                        Layout.fillWidth: strip.vertical
                        spacing: 0

                        Label {
                            Layout.fillWidth: strip.vertical
                            Layout.maximumWidth: strip.vertical ? Number.POSITIVE_INFINITY : 150
                            text: tabItem.label
                            textFormat: Text.PlainText
                            elide: Text.ElideMiddle
                            color: strip.theme.foreground
                            font.pixelSize: 12
                            font.bold: tabItem.current
                        }

                        Label {
                            Layout.fillWidth: true
                            visible: strip.vertical
                            text: strip.shortPath(tabItem.modelData.cwd)
                            textFormat: Text.PlainText
                            elide: Text.ElideMiddle
                            color: strip.theme.muted
                            font.pixelSize: 10
                        }
                    }

                    Rectangle {
                        visible: tabItem.modelData.unread > 0
                        implicitWidth: unreadLabel.implicitWidth + 8
                        implicitHeight: unreadLabel.implicitHeight + 2
                        radius: height / 2
                        color: strip.theme.accent
                        Label {
                            id: unreadLabel
                            anchors.centerIn: parent
                            text: String(tabItem.modelData.unread)
                            textFormat: Text.PlainText
                            color: strip.theme.buttonForeground
                            font.pixelSize: 10
                            font.bold: true
                        }
                    }

                    Rectangle {
                        visible: tabItem.modelData.needsInput > 0
                        implicitWidth: inputLabel.implicitWidth + 8
                        implicitHeight: inputLabel.implicitHeight + 2
                        radius: 4
                        color: strip.theme.warning
                        Label {
                            id: inputLabel
                            anchors.centerIn: parent
                            text: "input"
                            textFormat: Text.PlainText
                            color: strip.theme.buttonForeground
                            font.pixelSize: 10
                            font.bold: true
                        }
                    }

                    AppButton {
                        theme: strip.theme
                        variant: "ghost"
                        text: "×"
                        accessibleName: "Close tab " + tabItem.label
                        padding: 0
                        leftPadding: 6
                        rightPadding: 6
                        implicitHeight: 20
                        onClicked: strip.closeRequested(tabItem.modelData.id)
                    }
                }
            }
        }

        RowLayout {
            Layout.fillWidth: strip.vertical
            spacing: 4

            AppButton {
                theme: strip.theme
                variant: "ghost"
                text: "+"
                accessibleName: "New tab in the same folder"
                accessibleDescription: "Ctrl+N"
                enabled: strip.tabs.length < strip.maxTabs
                padding: 2
                leftPadding: 10
                rightPadding: 10
                onClicked: strip.newTabRequested()
            }

            AppButton {
                Layout.fillWidth: strip.vertical
                theme: strip.theme
                variant: "ghost"
                text: "Open folder…"
                accessibleName: "Open a folder in a new tab"
                accessibleDescription: "Ctrl+O"
                enabled: strip.tabs.length < strip.maxTabs
                padding: 2
                leftPadding: 8
                rightPadding: 8
                onClicked: strip.openDirectoryRequested()
            }
        }
    }
}
