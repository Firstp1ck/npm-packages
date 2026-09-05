import QtQuick
import QtQuick.Controls
import QtTest

Item {
    width: 480
    height: 360
    TranscriptUnderTest { id: view }
    Item { id: otherFocus }

    TestCase {
        name: "TranscriptScroll"
        when: windowShown

        function init() {
            view.autoScroll.stop()
            view.enabled = true
            view.cancelFlick()
            view.followOutput = false
            view.cacheBuffer = 400
            view.selectableRows = false
            view.rows.clear()
            for (let i = 0; i < 60; i++) view.rows.append({ rowHeight: i % 3 === 0 ? 150 : 60 })
            view.forceLayout()
            view.jumpToLatest()
            wait(100)
            verify(view.atYEnd)
            verify(view.followOutput)
        }

        function scrollUp(delta) {
            mouseWheel(view, 100, 100, 0, delta)
            tryVerify(() => !view.atYEnd, 1000)
            tryVerify(() => !view.moving, 1000)
            verify(!view.followOutput, "wheel input must pause following even near the bottom")
        }

        function test_wheelMovesTwiceTheQtBaseline() {
            // Fully realize rows so changing height estimates cannot alter the measured distance.
            view.cacheBuffer = view.contentHeight * 2
            wait(200)
            view.jumpToLatest()
            wait(100)
            const before = view.contentY
            mouseWheel(view, 100, 100, 0, 120)
            wait(100)
            compare(before - view.contentY, Qt.styleHints.wheelScrollLines * 24 * 2)
            verify(!view.followOutput)
        }

        function test_pixelScrollingDoublesDistanceAndPrefersPixels() {
            const before = view.contentY
            verify(view.scrollWheel(120, 20))
            compare(before - view.contentY, 40)
            verify(view.scrollWheel(-120, -10))
            compare(before - view.contentY, 20)
            verify(!view.followOutput)
            verify(!view.scrollWheel(0, 0))
            compare(before - view.contentY, 20)
        }

        function test_wheelClampsAtBothEnds() {
            verify(view.scrollWheel(0, 100000))
            compare(view.contentY, view.originY)
            verify(!view.followOutput)
            view.forceLayout()
            verify(view.scrollWheel(0, -100000))
            verify(view.atYEnd)
            wait(100)
            verify(view.followOutput)
        }

        function test_queuedFollowCannotUndoSmallWheelScroll() {
            Qt.callLater(view.followToEnd)
            scrollUp(15)
            const position = view.contentY
            verify(!view.followOutput)
            view.rows.append({ rowHeight: 180 })
            wait(200)
            verify(!view.followOutput)
            verify(!view.atYEnd)
            verify(Math.abs(view.contentY - position) < 2, "new rows must not move a paused viewport")
        }

        function test_layoutCannotResumeFollowing() {
            scrollUp(120)
            view.rows.setProperty(view.rows.count - 1, "rowHeight", 240)
            view.forceLayout()
            wait(100)
            verify(!view.followOutput)
            // Even a layout-driven return to the end is not a request to follow.
            view.positionViewAtEnd()
            wait(100)
            verify(view.atYEnd)
            verify(!view.followOutput)
            view.rows.append({ rowHeight: 120 })
            wait(100)
            verify(!view.followOutput)
        }

        function test_latestResumesStreaming() {
            scrollUp(120)
            view.jumpToLatest()
            view.rows.append({ rowHeight: 240 })
            wait(200)
            verify(view.followOutput)
            verify(view.atYEnd)
            view.rows.setProperty(view.rows.count - 1, "rowHeight", 320)
            wait(200)
            verify(view.followOutput)
            verify(view.atYEnd)
        }

        function test_scrollBackToEndResumesFollowing() {
            scrollUp(120)
            mouseWheel(view, 100, 100, 0, -1200)
            tryVerify(() => view.atYEnd && !view.moving)
            tryVerify(() => view.followOutput)
        }

        function test_contentDragPausesFollowing() {
            mousePress(view, 100, 100)
            mouseMove(view, 100, 140, 50)
            mouseMove(view, 100, 240, 50)
            wait(200)
            mouseRelease(view, 100, 240)
            tryVerify(() => !view.moving, 3000)
            verify(!view.atYEnd)
            verify(!view.followOutput)
            view.rows.append({ rowHeight: 240 })
            wait(100)
            verify(!view.atYEnd)
            verify(!view.followOutput)
        }

        function cleanup() {
            view.autoScroll.stop()
        }

        function prepareAutoscroll() {
            view.cacheBuffer = view.contentHeight * 2
            wait(200)
            view.jumpToLatest()
            wait(100)
            mouseMove(view, 100, 180)
            mouseClick(view, 100, 180, Qt.MiddleButton)
            verify(view.autoScroll.scrolling, "a middle click must latch autoscroll after release")
            verify(!view.followOutput)
        }

        function test_autoscroll_data() {
            return [
                { tag: "plain rows", selectable: false },
                { tag: "selectable text", selectable: true }
            ]
        }

        function test_autoscroll(data) {
            view.selectableRows = data.selectable
            prepareAutoscroll()
            const bottom = view.contentY
            wait(100)
            compare(view.contentY, bottom, "the starting point must be a dead zone")
            mouseMove(view, 100, 80)
            verify(view.autoScroll.velocity < 0)
            wait(120)
            const first = view.contentY
            verify(first < bottom, "above the anchor must scroll up")
            wait(120)
            verify(view.contentY < first, "scrolling must continue without further mouse movement")
            Qt.callLater(view.followToEnd)
            wait(50)
            verify(!view.atYEnd)
            verify(!view.followOutput)
            mouseMove(view, 100, 180)
            const stopped = view.contentY
            wait(100)
            compare(view.contentY, stopped, "returning to the anchor must pause movement")
            verify(view.autoScroll.scrolling)
            mouseMove(view, 100, 220)
            const slow = view.autoScroll.velocity
            verify(slow > 0)
            mouseMove(view, 100, 280)
            verify(view.autoScroll.velocity > slow, "farther from the anchor must scroll faster")
            wait(100)
            verify(view.contentY > stopped, "below the anchor must scroll down")
            mouseClick(view, 100, 280, Qt.MiddleButton)
            verify(!view.autoScroll.scrolling)
            const released = view.contentY
            wait(100)
            compare(view.contentY, released)
        }

        function test_autoscrollStop_data() {
            return [
                { tag: "middle click", action: "middle" },
                { tag: "left click", action: "left" },
                { tag: "right click", action: "right" },
                { tag: "Escape", action: "escape" },
                { tag: "wheel", action: "wheel" },
                { tag: "disabled view", action: "disabled" },
                { tag: "focus loss", action: "focus" },
                { tag: "leave transcript", action: "leave" },
                { tag: "empty transcript", action: "empty" },
                { tag: "Latest", action: "latest" }
            ]
        }

        function test_autoscrollStop(data) {
            prepareAutoscroll()
            mouseMove(view, 100, 80)
            wait(60)
            if (data.action === "middle") mouseClick(view, 100, 80, Qt.MiddleButton)
            else if (data.action === "left") mouseClick(view, 100, 80, Qt.LeftButton)
            else if (data.action === "right") mouseClick(view, 100, 80, Qt.RightButton)
            else if (data.action === "escape") keyClick(Qt.Key_Escape)
            else if (data.action === "wheel") mouseWheel(view, 100, 80, 0, 120)
            else if (data.action === "disabled") view.enabled = false
            else if (data.action === "focus") otherFocus.forceActiveFocus()
            else if (data.action === "leave") mouseMove(view, view.width + 20, 80)
            else if (data.action === "empty") view.rows.clear()
            else view.jumpToLatest()
            tryCompare(view.autoScroll, "scrolling", false, 500)
            wait(100)
            const stopped = view.contentY
            wait(100)
            compare(view.contentY, stopped)
        }

        function test_heldAutoscrollStopsOnRelease() {
            mousePress(view, 100, 180, Qt.MiddleButton)
            mouseMove(view, 100, 80)
            verify(view.autoScroll.scrolling)
            wait(100)
            const first = view.contentY
            wait(100)
            verify(view.contentY < first)
            mouseRelease(view, 100, 80, Qt.MiddleButton)
            verify(!view.autoScroll.scrolling)
            const stopped = view.contentY
            wait(100)
            compare(view.contentY, stopped)
        }

        function test_autoscrollPreservesFollowPauseAndBounds() {
            prepareAutoscroll()
            const held = view.contentY
            view.rows.append({ rowHeight: 240 })
            wait(100)
            verify(!view.followOutput)
            compare(view.contentY, held)
            view.scrollByPixels(-100000)
            mouseMove(view, 100, 80)
            wait(100)
            verify(view.atYBeginning)
            verify(view.autoScroll.scrolling)
            view.scrollByPixels(100000)
            mouseMove(view, 100, 280)
            wait(100)
            verify(view.atYEnd)
            verify(!view.followOutput)
            verify(view.autoScroll.scrolling)
            view.autoScroll.stop()
            wait(100)
            verify(view.followOutput)
        }

        function test_scrollbarDragCancelsQueuedFollow() {
            const bar = view.scrollBar
            const y = (bar.visualPosition + bar.visualSize / 2) * bar.height
            mousePress(bar, bar.width / 2, y)
            verify(bar.pressed)
            verify(!view.followOutput)
            Qt.callLater(view.followToEnd)
            mouseMove(bar, bar.width / 2, y - 120, 50)
            mouseRelease(bar, bar.width / 2, y - 120)
            wait(100)
            verify(!view.atYEnd)
            verify(!view.followOutput)
            view.rows.append({ rowHeight: 240 })
            wait(100)
            verify(!view.atYEnd)
            verify(!view.followOutput)
        }

        function test_nonzeroOriginStillResumesAtEnd() {
            view.rows.remove(0, 20)
            view.forceLayout()
            view.jumpToLatest()
            wait(100)
            verify(Math.abs(view.originY) > 1, "fixture must exercise a shifted ListView origin")
            scrollUp(120)
            mouseWheel(view, 100, 100, 0, -1200)
            tryVerify(() => view.atYEnd && !view.moving)
            tryVerify(() => view.followOutput)
        }
    }
}
