import assert from "node:assert/strict";
import {
  findMiddleButtonDragScrollTarget,
  installMiddleButtonDragScroll,
  middleButtonAutoScrollVelocity,
} from "../public/middle-button-drag-scroll.mjs";

class FakeEventTarget {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
  }
}

function frameHarness() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    requestFrame(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancelFrame(id) { callbacks.delete(id); },
    run(timestamp) {
      const entry = callbacks.entries().next().value;
      assert.ok(entry, "an animation frame should be pending");
      const [id, callback] = entry;
      callbacks.delete(id);
      callback(timestamp);
    },
    get pending() { return callbacks.size; },
  };
}

function fakeElement({ parentElement = null, scrollHeight = 0, clientHeight = 0, scrollTop = 0, overflowY = "visible", interactive = false } = {}) {
  const style = {
    scrollBehavior: "",
    removeProperty(name) {
      if (name === "scroll-behavior") this.scrollBehavior = "";
    },
  };
  return {
    nodeType: 1,
    parentElement,
    scrollHeight,
    clientHeight,
    scrollTop,
    overflowY,
    interactive,
    style,
    closest() { return this.interactive ? this : null; },
  };
}

function pointerEvent(overrides = {}) {
  return {
    button: 1,
    pointerId: 7,
    pointerType: "mouse",
    clientY: 200,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    ...overrides,
  };
}

const getStyle = (node) => ({ overflowY: node.overflowY });

assert.equal(middleButtonAutoScrollVelocity(10), 0, "the center dead zone should suppress accidental scrolling");
assert.equal(middleButtonAutoScrollVelocity(20), 120, "downward displacement should produce downward velocity");
assert.equal(middleButtonAutoScrollVelocity(-20), -120, "upward displacement should produce upward velocity");
assert.equal(middleButtonAutoScrollVelocity(1000), 1200, "automatic scrolling should have a bounded maximum speed");

{
  const outer = fakeElement({ scrollHeight: 1200, clientHeight: 300, overflowY: "auto" });
  const inner = fakeElement({ parentElement: outer, scrollHeight: 800, clientHeight: 200, overflowY: "scroll" });
  const child = fakeElement({ parentElement: inner });
  assert.equal(findMiddleButtonDragScrollTarget(child, { getStyle }), inner, "the nearest vertical scroll surface should win");
  inner.scrollHeight = inner.clientHeight;
  assert.equal(findMiddleButtonDragScrollTarget(child, { getStyle }), outer, "a non-overflowing child should fall back to its scrollable parent");
}

{
  const root = new FakeEventTarget();
  const eventTarget = new FakeEventTarget();
  const frames = frameHarness();
  const activeClasses = new Set();
  const classTarget = { classList: { add: (name) => activeClasses.add(name), remove: (name) => activeClasses.delete(name) } };
  const surface = fakeElement({ scrollHeight: 1200, clientHeight: 300, scrollTop: 500, overflowY: "auto" });
  surface.style.scrollBehavior = "smooth";
  const child = fakeElement({ parentElement: surface });
  const directions = [];
  const controller = installMiddleButtonDragScroll({
    root,
    eventTarget,
    classTarget,
    getStyle,
    requestFrame: (callback) => frames.requestFrame(callback),
    cancelFrame: (frame) => frames.cancelFrame(frame),
    onDirection: (direction) => directions.push(direction),
  });

  const down = pointerEvent({ target: child });
  root.emit("pointerdown", down);
  assert.equal(down.defaultPrevented, true, "an accepted middle press should suppress native browser autoscroll");
  assert.equal(surface.style.scrollBehavior, "auto", "smooth scrolling should be disabled during automatic movement");
  assert.equal(activeClasses.has("middle-button-auto-scrolling"), true);
  assert.equal(frames.pending, 1);

  const mouseDown = pointerEvent({ target: child });
  root.emit("mousedown", mouseDown);
  assert.equal(mouseDown.defaultPrevented, true, "the compatibility mouse event should also suppress native browser autoscroll");

  const moveDown = pointerEvent({ target: child, clientY: 260 });
  eventTarget.emit("pointermove", moveDown);
  assert.equal(moveDown.defaultPrevented, true);
  assert.equal(surface.scrollTop, 500, "pointer movement should select direction without directly grabbing content");
  assert.deepEqual({ target: directions[0].target, offsetY: directions[0].offsetY }, { target: surface, offsetY: 60 });

  frames.run(0);
  assert.equal(surface.scrollTop, 510, "a displaced pointer should scroll down on the next animation frame");
  frames.run(100);
  assert.equal(surface.scrollTop, 540, "scrolling should continue while the pointer remains displaced and stationary");

  const moveUp = pointerEvent({ target: child, clientY: 140 });
  eventTarget.emit("pointermove", moveUp);
  assert.equal(directions.at(-1).offsetY, -60);
  frames.run(150);
  assert.equal(surface.scrollTop, 510, "moving above the press point should reverse automatic scrolling upward");

  eventTarget.emit("pointerup", pointerEvent({ target: child, clientY: 140 }));
  assert.equal(frames.pending, 0, "releasing the middle button should cancel automatic scrolling immediately");
  assert.equal(surface.style.scrollBehavior, "smooth", "the previous inline scroll behavior should be restored");
  assert.equal(activeClasses.has("middle-button-auto-scrolling"), false);

  controller.destroy();
  assert.equal(root.listeners.get("pointerdown")?.size, 0, "destroy should remove the delegated pointer listener");
}

{
  const root = new FakeEventTarget();
  const eventTarget = new FakeEventTarget();
  const surface = fakeElement({ scrollHeight: 1000, clientHeight: 200, scrollTop: 300, overflowY: "auto" });
  const interactiveChild = fakeElement({ parentElement: surface, interactive: true });
  installMiddleButtonDragScroll({ root, eventTarget, classTarget: null, getStyle });

  const leftClick = pointerEvent({ target: surface, button: 0 });
  root.emit("pointerdown", leftClick);
  assert.equal(leftClick.defaultPrevented, false, "left-button interactions must remain untouched");

  const middleClick = pointerEvent({ target: interactiveChild });
  root.emit("pointerdown", middleClick);
  assert.equal(middleClick.defaultPrevented, false, "interactive targets should retain native middle-click behavior");
  eventTarget.emit("pointermove", pointerEvent({ target: interactiveChild, clientY: 260 }));
  assert.equal(surface.scrollTop, 300);
}

console.log("middle-button-drag-scroll.test.mjs passed");
