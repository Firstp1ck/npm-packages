const INTERACTIVE_TARGET_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  "option",
  "label",
  "summary",
  "[contenteditable]:not([contenteditable=\"false\"])",
  "[role=\"button\"]",
  "[data-middle-drag-scroll=\"ignore\"]",
].join(", ");

const AUTO_SCROLL_DEAD_ZONE_PX = 10;
const AUTO_SCROLL_SPEED_PER_PIXEL = 12;
const AUTO_SCROLL_MAX_SPEED_PX_PER_SECOND = 1200;
const AUTO_SCROLL_MAX_FRAME_MS = 50;

function targetElement(target) {
  if (target?.nodeType === 1) return target;
  return target?.parentElement || null;
}

function canScrollVertically(node, getStyle) {
  if (!node || node.scrollHeight <= node.clientHeight) return false;
  const overflowY = String(getStyle(node)?.overflowY || "").toLowerCase();
  return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
}

export function middleButtonAutoScrollVelocity(offsetY, {
  deadZone = AUTO_SCROLL_DEAD_ZONE_PX,
  speedPerPixel = AUTO_SCROLL_SPEED_PER_PIXEL,
  maxSpeed = AUTO_SCROLL_MAX_SPEED_PX_PER_SECOND,
} = {}) {
  const displacement = Number(offsetY);
  if (!Number.isFinite(displacement) || Math.abs(displacement) <= deadZone) return 0;
  const speed = Math.min(maxSpeed, (Math.abs(displacement) - deadZone) * speedPerPixel);
  return Math.sign(displacement) * speed;
}

export function findMiddleButtonDragScrollTarget(target, {
  root,
  getStyle,
} = {}) {
  const boundary = root?.nodeType === 1 ? root : null;
  let node = targetElement(target);
  while (node) {
    if (canScrollVertically(node, getStyle)) return node;
    if (node === boundary) break;
    node = node.parentElement;
  }
  return null;
}

export function installMiddleButtonDragScroll({
  root = document,
  eventTarget = window,
  classTarget = document.body,
  getStyle = (node) => window.getComputedStyle(node),
  requestFrame = (callback) => window.requestAnimationFrame(callback),
  cancelFrame = (frame) => window.cancelAnimationFrame(frame),
  onDirection = () => {},
} = {}) {
  let session = null;

  function restoreScrollBehavior(activeSession) {
    if (!activeSession?.target?.style) return;
    if (activeSession.previousScrollBehavior) activeSession.target.style.scrollBehavior = activeSession.previousScrollBehavior;
    else activeSession.target.style.removeProperty?.("scroll-behavior");
  }

  function scrollFrame(timestamp) {
    if (!session) return;
    const activeSession = session;
    const frameTime = Number.isFinite(timestamp) ? timestamp : 0;
    const elapsed = activeSession.lastFrameAt === null
      ? 1000 / 60
      : Math.min(AUTO_SCROLL_MAX_FRAME_MS, Math.max(0, frameTime - activeSession.lastFrameAt));
    activeSession.lastFrameAt = frameTime;
    const offsetY = activeSession.currentClientY - activeSession.startClientY;
    const velocity = middleButtonAutoScrollVelocity(offsetY);
    if (velocity !== 0) activeSession.target.scrollTop += velocity * (elapsed / 1000);
    activeSession.frame = requestFrame(scrollFrame);
  }

  function finish(event) {
    if (!session) return;
    if (event?.pointerId !== undefined && event.pointerId !== session.pointerId) return;
    const completed = session;
    session = null;
    if (completed.frame !== null) cancelFrame(completed.frame);
    eventTarget.removeEventListener("pointermove", move, { capture: true });
    eventTarget.removeEventListener("pointerup", finish, { capture: true });
    eventTarget.removeEventListener("pointercancel", finish, { capture: true });
    eventTarget.removeEventListener("blur", finish);
    restoreScrollBehavior(completed);
    classTarget?.classList?.remove("middle-button-auto-scrolling");
  }

  function move(event) {
    if (!session || (event.pointerId !== undefined && event.pointerId !== session.pointerId)) return;
    const clientY = Number(event.clientY);
    if (!Number.isFinite(clientY)) return;
    session.currentClientY = clientY;
    const offsetY = clientY - session.startClientY;
    event.preventDefault?.();
    if (Math.abs(offsetY) > AUTO_SCROLL_DEAD_ZONE_PX) onDirection({ target: session.target, offsetY, event });
  }

  function begin(event) {
    if (session || event.defaultPrevented || event.button !== 1) return;
    if (event.pointerType && event.pointerType !== "mouse") return;
    const source = targetElement(event.target);
    if (!source || source.closest?.(INTERACTIVE_TARGET_SELECTOR)) return;
    const target = findMiddleButtonDragScrollTarget(source, { root, getStyle });
    if (!target) return;

    const startClientY = Number(event.clientY);
    if (!Number.isFinite(startClientY)) return;
    event.preventDefault?.();
    session = {
      pointerId: event.pointerId,
      target,
      startClientY,
      currentClientY: startClientY,
      lastFrameAt: null,
      frame: null,
      previousScrollBehavior: target.style?.scrollBehavior || "",
    };
    if (target.style) target.style.scrollBehavior = "auto";
    classTarget?.classList?.add("middle-button-auto-scrolling");
    eventTarget.addEventListener("pointermove", move, { capture: true, passive: false });
    eventTarget.addEventListener("pointerup", finish, { capture: true });
    eventTarget.addEventListener("pointercancel", finish, { capture: true });
    eventTarget.addEventListener("blur", finish);
    session.frame = requestFrame(scrollFrame);
  }

  function preventNativeMouseAutoscroll(event) {
    if (session && event.button === 1) event.preventDefault?.();
  }

  root.addEventListener("pointerdown", begin, { capture: true, passive: false });
  root.addEventListener("mousedown", preventNativeMouseAutoscroll, { capture: true, passive: false });

  return {
    destroy() {
      finish();
      root.removeEventListener("pointerdown", begin, { capture: true });
      root.removeEventListener("mousedown", preventNativeMouseAutoscroll, { capture: true });
    },
  };
}
