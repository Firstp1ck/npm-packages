import QtQuick
import QtQuick.Controls

MouseArea {
    id: control
    required property var view
    required property var theme
    property bool scrolling: false
    property real anchorX: 0
    property real anchorY: 0
    property real pointerY: 0
    property bool movedWhileHeld: false
    property var previousFocus: null
    readonly property real deadZone: 12
    readonly property real velocity: Math.sign(pointerY - anchorY)
        * Math.min(1800, Math.max(0, Math.abs(pointerY - anchorY) - deadZone) * 8)
    readonly property bool windowActive: Window.active

    anchors.fill: parent
    z: 1
    enabled: view.count > 0
    acceptedButtons: scrolling ? Qt.AllButtons : Qt.MiddleButton
    hoverEnabled: scrolling
    preventStealing: true
    cursorShape: scrolling ? Qt.SizeVerCursor : Qt.ArrowCursor

    function start(x, y) {
        view.cancelFlick()
        view.followOutput = false
        anchorX = x
        anchorY = y
        pointerY = y
        movedWhileHeld = false
        previousFocus = Window.window ? Window.window.activeFocusItem : null
        scrolling = true
        forceActiveFocus()
    }

    function stop() {
        if (!scrolling) return
        scrolling = false
        const restore = previousFocus
        previousFocus = null
        if (activeFocus && restore) restore.forceActiveFocus()
        Qt.callLater(view.resumeFollowingAtEnd)
    }

    onPressed: mouse => {
        if (scrolling) stop()
        else if (mouse.button === Qt.MiddleButton) start(mouse.x, mouse.y)
    }
    onPositionChanged: mouse => {
        if (!scrolling) return
        pointerY = mouse.y
        if (pressed && Math.abs(pointerY - anchorY) > deadZone) movedWhileHeld = true
    }
    onReleased: if (movedWhileHeld) stop()
    onCanceled: stop()
    onExited: if (!pressed) stop()
    onEnabledChanged: if (!enabled) stop()
    onVisibleChanged: if (!visible) stop()
    onWindowActiveChanged: if (!windowActive) stop()
    onActiveFocusChanged: if (scrolling && !activeFocus) stop()
    onWheel: event => {
        stop()
        event.accepted = false
    }

    Shortcut {
        sequence: "Escape"
        enabled: control.scrolling
        onActivated: control.stop()
    }

    Timer {
        interval: 16
        repeat: true
        running: control.scrolling
        property double lastTick: 0
        onRunningChanged: lastTick = Date.now()
        onTriggered: {
            const now = Date.now()
            // Bound the catch-up distance after a blocked event loop or system resume.
            const seconds = Math.min(50, Math.max(0, now - lastTick)) / 1000
            lastTick = now
            if (control.velocity !== 0) control.view.scrollByPixels(control.velocity * seconds)
        }
    }

    Rectangle {
        visible: control.scrolling
        x: Math.max(0, Math.min(control.width - width, control.anchorX - width / 2))
        y: Math.max(0, Math.min(control.height - height, control.anchorY - height / 2))
        width: control.theme.space4Xl
        height: width
        radius: width / 2
        color: control.theme.surfaceRaised
        border.width: control.theme.borderWidth
        border.color: control.theme.focusRing
        Accessible.role: Accessible.Indicator
        Accessible.name: "Autoscroll active. Move above or below this point; click or press Escape to stop."

        Text {
            anchors.centerIn: parent
            text: "↕"
            color: control.theme.foreground
            font.family: control.theme.monospaceFamily
            font.pixelSize: control.theme.space2Xl
        }
    }
}
