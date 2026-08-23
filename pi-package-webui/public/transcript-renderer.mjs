const DEFAULT_SURFACE_SELECTOR = "[data-transcript-surface], .markdown-body, .compact-live-text";
const DESTRUCTIVE_KINDS = new Set(["reconcile", "destructive", "authoritative"]);
const MUTATION_LOG_LIMIT = 80;

function groupableThinkingText(message) {
  if (message?.role !== "thinking") return null;
  if (typeof message.thinking === "string") return message.thinking;
  return typeof message.content === "string" ? message.content : null;
}

export function groupConsecutiveThinkingMessages(messages) {
  const grouped = [];
  let pending = [];

  const flush = () => {
    if (pending.length === 1) grouped.push(pending[0]);
    else if (pending.length > 1) {
      const first = pending[0];
      const thinking = pending.map(groupableThinkingText).join("\n\n");
      grouped.push({
        ...first,
        content: thinking,
        thinking,
        thinkingSegmentCount: pending.length,
      });
    }
    pending = [];
  };

  for (const message of messages || []) {
    if (groupableThinkingText(message) !== null) pending.push(message);
    else {
      flush();
      grouped.push(message);
    }
  }
  flush();
  return grouped;
}

export function groupConsecutiveThinkingItems(items, thinkingMessageForItem = (item) => item?.message) {
  const grouped = [];
  let pending = [];

  const flush = () => {
    if (pending.length === 1) grouped.push(pending[0].item);
    else if (pending.length > 1) {
      const first = pending[0].item;
      const message = groupConsecutiveThinkingMessages(pending.map((entry) => entry.message))[0];
      grouped.push({ ...first, message, thinkingGroupSourceCount: pending.length });
    }
    pending = [];
  };

  for (const item of items || []) {
    const message = thinkingMessageForItem(item);
    if (groupableThinkingText(message) !== null) pending.push({ item, message });
    else {
      flush();
      grouped.push(item);
    }
  }
  flush();
  return grouped;
}

function normalizedKey(value, fallback = "") {
  const key = String(value || "").trim();
  return key || fallback;
}

function textOffset(surface, node, offset) {
  if (!surface || !node || (node !== surface && !surface.contains(node))) return null;
  const range = document.createRange();
  try {
    range.selectNodeContents(surface);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

function textPoint(surface, offset, { forwardAffinity = false } = {}) {
  const target = Math.max(0, Number(offset) || 0);
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let last = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const next = consumed + node.data.length;
    if (target < next || (target === next && !forwardAffinity)) {
      return { node, offset: Math.max(0, target - consumed) };
    }
    consumed = next;
    last = node;
  }
  return last ? { node: last, offset: last.data.length } : { node: surface, offset: 0 };
}

function rangeForSnapshot(surface, snapshot) {
  const backward = snapshot.anchorOffset > snapshot.focusOffset;
  let anchorOffset = snapshot.anchorOffset;
  let focusOffset = snapshot.focusOffset;

  const resolve = () => {
    const start = textPoint(surface, Math.min(anchorOffset, focusOffset), { forwardAffinity: true });
    const end = textPoint(surface, Math.max(anchorOffset, focusOffset));
    const anchor = backward ? end : start;
    const focus = backward ? start : end;
    const range = document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    } catch {
      return null;
    }
    return range.toString() === snapshot.text ? { anchor, focus, range } : null;
  };

  const offsetMatch = resolve();
  if (offsetMatch) return offsetMatch;

  // Structural tool/Markdown changes can shift an unchanged selection within
  // the same semantic surface. Remap only when its exact text occurs once;
  // message/surface identity still prevents restoration into duplicate output.
  const surfaceText = surface.textContent || "";
  const exactStart = surfaceText.indexOf(snapshot.text);
  if (exactStart < 0 || surfaceText.indexOf(snapshot.text, exactStart + 1) !== -1) return null;
  const exactEnd = exactStart + snapshot.text.length;
  anchorOffset = backward ? exactEnd : exactStart;
  focusOffset = backward ? exactStart : exactEnd;
  return resolve();
}

/**
 * Owns transcript-local DOM mutations. The controller supplies rendering
 * callbacks, while this module keeps semantic ownership, pointer selection
 * sessions, exact selection fallback, and bounded streaming-tail state in one
 * place. It intentionally does not own scroll/follow policy or Markdown
 * syntax so existing visual rendering stays unchanged.
 */
export function createTranscriptRenderer({ chat, contextKey = () => "", surfaceSelector = DEFAULT_SURFACE_SELECTOR } = {}) {
  if (!chat) throw new Error("createTranscriptRenderer requires the transcript root");

  const markdownStates = new WeakMap();
  const deferredMutations = new Map();
  const mutationLog = [];
  let pointerSession = null;
  let selectionSession = null;
  let selectionIntentRevision = 0;
  let flushTimer = null;

  function semanticSurface(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const surface = element?.closest?.(surfaceSelector) || null;
    return surface && chat.contains(surface) ? surface : null;
  }

  function surfaceKey(surface) {
    return normalizedKey(surface?.dataset?.transcriptSurfaceKey, "");
  }

  function selectionSnapshot() {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const anchorSurface = semanticSurface(selection.anchorNode);
    const focusSurface = semanticSurface(selection.focusNode);
    // Cross-surface restoration is intentionally Phase 3. Retaining a range
    // that never detaches still works natively; only fallback restoration is
    // restricted to a single exact semantic surface.
    if (!anchorSurface || anchorSurface !== focusSurface) return null;
    const anchorOffset = textOffset(anchorSurface, selection.anchorNode, selection.anchorOffset);
    const focusOffset = textOffset(anchorSurface, selection.focusNode, selection.focusOffset);
    const text = selection.toString();
    if (anchorOffset === null || focusOffset === null || !text) return null;
    const bubble = anchorSurface.closest(".message");
    return {
      context: contextKey(),
      source: anchorSurface,
      messageKey: normalizedKey(bubble?.dataset?.transcriptMessageKey || bubble?.dataset?.itemKey),
      surfaceKey: surfaceKey(anchorSurface),
      anchorOffset,
      focusOffset,
      text,
    };
  }

  function selectionCandidates(snapshot) {
    const candidates = [];
    const add = (surface) => {
      if (surface && chat.contains(surface) && !candidates.includes(surface)) candidates.push(surface);
    };
    add(snapshot.source?.isConnected ? snapshot.source : null);
    if (snapshot.surfaceKey) {
      for (const surface of chat.querySelectorAll("[data-transcript-surface-key]")) {
        if (surface.dataset.transcriptSurfaceKey === snapshot.surfaceKey) add(surface);
      }
    }
    if (snapshot.messageKey) {
      for (const bubble of chat.querySelectorAll(".message[data-transcript-message-key], .message[data-item-key]")) {
        const key = bubble.dataset.transcriptMessageKey || bubble.dataset.itemKey || "";
        if (key !== snapshot.messageKey) continue;
        for (const surface of bubble.querySelectorAll(surfaceSelector)) add(surface);
      }
    }
    return candidates;
  }

  function restoreSelection(snapshot, { forceRemap = false } = {}) {
    if (!snapshot || snapshot.context !== contextKey()) return false;
    const selection = window.getSelection?.();
    if (!selection) return false;
    const currentText = selection.rangeCount && !selection.isCollapsed ? selection.toString() : "";
    const currentAnchor = semanticSurface(selection.anchorNode);
    const currentFocus = semanticSurface(selection.focusNode);
    const candidates = selectionCandidates(snapshot);
    if (!forceRemap && currentText === snapshot.text && currentAnchor === currentFocus && candidates.includes(currentAnchor)) return true;
    // Never replace a later meaningful user selection with an older bookmark.
    // During the synchronous destructive mutation that captured this bookmark,
    // an equal native Range may be transiently attached to removed descendants;
    // force a fresh semantic range before the browser collapses it asynchronously.
    if (currentText && currentAnchor && currentFocus
      && (!forceRemap || !candidates.includes(currentAnchor) || !candidates.includes(currentFocus))) return false;
    for (const surface of candidates) {
      const match = rangeForSnapshot(surface, snapshot);
      if (!match) continue;
      try {
        selection.removeAllRanges();
        if (snapshot.anchorOffset > snapshot.focusOffset && typeof selection.setBaseAndExtent === "function") {
          selection.setBaseAndExtent(match.anchor.node, match.anchor.offset, match.focus.node, match.focus.offset);
        } else {
          // For forward selections, the already-validated Range is the exact
          // browser representation. Rebuilding it with setBaseAndExtent can
          // absorb an adjacent block-boundary newline in Chromium.
          selection.addRange(match.range);
        }
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  function selectedSurfaceIntersects(surfaces = []) {
    const snapshot = selectionSnapshot() || selectionSession?.snapshot;
    const pointerSurface = pointerSession?.surface || null;
    const selectedSurface = snapshot?.source || pointerSurface;
    if (!selectedSurface) return false;
    for (const candidate of surfaces) {
      if (!candidate) continue;
      if (candidate === chat || candidate === selectedSurface) return true;
      if (candidate.contains?.(selectedSurface) || selectedSurface.contains?.(candidate)) return true;
    }
    return false;
  }

  function logMutation(entry) {
    mutationLog.push({ at: Date.now(), ...entry });
    if (mutationLog.length > MUTATION_LOG_LIMIT) mutationLog.splice(0, mutationLog.length - MUTATION_LOG_LIMIT);
  }

  function clearSelectionFor(surfaces) {
    if (!selectedSurfaceIntersects(surfaces)) return false;
    window.getSelection?.()?.removeAllRanges();
    selectionSession = null;
    return true;
  }

  function applyMutation({ key, context = contextKey(), kind = "append", surfaces = [], mutate, invalidateSelection = false }) {
    if (context !== contextKey()) return { applied: false, stale: true };
    const snapshot = selectionSnapshot() || selectionSession?.snapshot || null;
    const intersectsSelection = selectedSurfaceIntersects(surfaces);
    const invalidated = invalidateSelection && intersectsSelection;
    const forceRemap = DESTRUCTIVE_KINDS.has(kind) && intersectsSelection;
    const restoreIntentRevision = selectionIntentRevision;
    mutate?.();
    const restoredSelection = invalidated ? false : restoreSelection(snapshot, { forceRemap });
    if (restoredSelection && forceRemap && typeof requestAnimationFrame === "function") {
      // Chromium may apply its removed-descendant Range adjustment after the
      // mutation callback returns. Reassert the exact semantic bookmark on the
      // next frame; restoreSelection still rejects a newer meaningful range.
      requestAnimationFrame(() => {
        if (selectionIntentRevision !== restoreIntentRevision) return;
        restoreSelection(snapshot, { forceRemap: true });
      });
    }
    if (invalidated) clearSelectionFor(surfaces);
    logMutation({ key, kind, deferred: false, invalidated, hadSelectionSnapshot: !!snapshot, restoredSelection, surfaces: surfaces.map(surfaceKey).filter(Boolean) });
    return { applied: true, invalidated };
  }

  function flushDeferredMutations() {
    flushTimer = null;
    const pending = [...deferredMutations.values()];
    deferredMutations.clear();
    for (const entry of pending) applyMutation(entry);
  }

  function scheduleDeferredFlush() {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(flushDeferredMutations, 0);
  }

  function commitTranscriptMutation({ key = "transcript", context = contextKey(), kind = "append", surfaces = [], mutate, invalidateSelection = false } = {}) {
    const entry = { key, context, kind, surfaces, mutate, invalidateSelection };
    const shouldDefer = DESTRUCTIVE_KINDS.has(kind)
      && !invalidateSelection
      && pointerSession
      && pointerSession.context === context
      && selectedSurfaceIntersects(surfaces);
    if (shouldDefer) {
      deferredMutations.set(key, entry);
      logMutation({ key, kind, deferred: true, invalidated: false, surfaces: surfaces.map(surfaceKey).filter(Boolean) });
      return { applied: false, deferred: true };
    }
    return applyMutation(entry);
  }

  function ownMessage(bubble, { key, role = "message" } = {}) {
    if (!bubble) return "";
    const messageKey = normalizedKey(key, bubble.dataset.itemKey || `live:${role}`);
    bubble.dataset.transcriptMessageKey = messageKey;
    bubble.dataset.transcriptRole = role;
    return messageKey;
  }

  function ownSurface(surface, { messageKey, kind = "output", segment = "0" } = {}) {
    if (!surface) return "";
    const bubble = surface.closest?.(".message");
    const owner = normalizedKey(messageKey, bubble?.dataset?.transcriptMessageKey || bubble?.dataset?.itemKey || "live");
    const surfaceIdentity = `${owner}:${normalizedKey(kind, "output")}:${normalizedKey(segment, "0")}`;
    surface.dataset.transcriptSurface = kind;
    surface.dataset.transcriptSurfaceKey = surfaceIdentity;
    return surfaceIdentity;
  }

  function ownBlocks(nodes, { messageKey, kind, start = 0, tail = false } = {}) {
    let index = start;
    for (const node of nodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const blockKey = tail ? "tail" : `block:${index++}`;
      node.dataset.transcriptBlockKey = `${messageKey}:${kind}:${blockKey}`;
      node.dataset.transcriptBlock = tail ? "mutable-tail" : "committed";
      const nestedSurfaces = [
        ...(node.matches?.("[data-transcript-surface]") ? [node] : []),
        ...node.querySelectorAll?.("[data-transcript-surface]") || [],
      ];
      nestedSurfaces.forEach((surface, surfaceIndex) => ownSurface(surface, {
        messageKey,
        kind: surface.dataset.transcriptSurface || kind,
        segment: `${blockKey}:${surfaceIndex}`,
      }));
    }
    return index;
  }

  function reconcileMarkdownSurface({
    key,
    context = contextKey(),
    surface,
    messageKey,
    kind = "assistant-final",
    text = "",
    complete = false,
    stableBoundary,
    renderInto,
    renderLiveTail,
    appendLiveTail,
  } = {}) {
    if (!surface || typeof stableBoundary !== "function" || typeof renderInto !== "function") return { applied: false, invalid: true };
    const value = String(text || "");
    let state = markdownStates.get(surface);
    const diverged = !!state && !value.startsWith(state.value);
    const boundaryResult = stableBoundary(value, diverged ? null : state?.boundaryState, { complete, appendOnly: !!state && !diverged });
    const boundaryInfo = boundaryResult && typeof boundaryResult === "object"
      ? boundaryResult
      : { boundary: Number(boundaryResult) || 0, state: null, liveMode: "markdown", tailKind: "text", scannedChars: value.length };
    const stableFloor = diverged ? 0 : state?.stableText?.length || 0;
    const nextBoundary = Math.max(stableFloor, Math.min(value.length, Number(boundaryInfo.boundary) || 0));
    const nextTail = value.slice(nextBoundary);
    const canReuseLiveTail = !!state?.tailNodes?.length
      && typeof appendLiveTail === "function"
      && ["open-fence", "plain"].includes(boundaryInfo.liveMode)
      && state.tailMode === boundaryInfo.liveMode
      && state.tailBoundary === nextBoundary
      && nextTail.startsWith(state.tailText);
    const replacesMutableTail = !!state?.tailNodes?.length && !canReuseLiveTail;
    const mutation = commitTranscriptMutation({
      key: key || `markdown:${surfaceKey(surface)}`,
      context,
      // Replacing/reparsing an open tail is destructive and must wait for an
      // intersecting native drag. Suffix appends reuse the mounted live nodes.
      kind: diverged || replacesMutableTail ? "reconcile" : "append",
      surfaces: [surface],
      invalidateSelection: diverged,
      mutate: () => {
        ownSurface(surface, { messageKey, kind });
        state = markdownStates.get(surface);
        if (!state || diverged) {
          for (const node of [...surface.childNodes]) node.remove();
          state = { stableText: "", value: "", tailNodes: [], tailText: "", tailMode: "", tailBoundary: 0, boundaryState: null, committedBlocks: 0 };
          markdownStates.set(surface, state);
        }

        const boundary = Math.max(state.stableText.length, nextBoundary);
        const tail = value.slice(boundary);
        const reuse = !!state.tailNodes.length
          && typeof appendLiveTail === "function"
          && ["open-fence", "plain"].includes(boundaryInfo.liveMode)
          && state.tailMode === boundaryInfo.liveMode
          && state.tailBoundary === boundary
          && tail.startsWith(state.tailText);

        if (reuse) {
          appendLiveTail(state.tailNodes, state.tailText, tail, boundaryInfo);
        } else {
          const committedSlice = value.slice(state.stableText.length, boundary);
          const promotesMountedTail = !!state.tailNodes.length
            && ["markdown", "authoritative"].includes(state.tailMode)
            && committedSlice.startsWith(state.tailText)
            && !committedSlice.slice(state.tailText.length).trim();
          if (promotesMountedTail) {
            state.committedBlocks = ownBlocks(state.tailNodes, { messageKey, kind, start: state.committedBlocks });
            state.tailNodes = [];
            state.stableText = value.slice(0, boundary);
          } else {
            for (const node of state.tailNodes) node.remove();
            state.tailNodes = [];
            if (boundary > state.stableText.length) {
              const fragment = document.createDocumentFragment();
              renderInto(fragment, committedSlice);
              const nodes = [...fragment.childNodes];
              state.committedBlocks = ownBlocks(nodes, { messageKey, kind, start: state.committedBlocks });
              surface.append(fragment);
              state.stableText = value.slice(0, boundary);
            }
          }
          if (tail.trim()) {
            const fragment = document.createDocumentFragment();
            if (["open-fence", "plain"].includes(boundaryInfo.liveMode) && typeof renderLiveTail === "function") {
              renderLiveTail(fragment, tail, boundaryInfo);
            } else {
              renderInto(fragment, tail);
            }
            state.tailNodes = [...fragment.childNodes];
            ownBlocks(state.tailNodes, { messageKey, kind, tail: true });
            surface.append(fragment);
          }
        }
        state.value = value;
        state.tailText = tail;
        state.tailMode = boundaryInfo.liveMode || "markdown";
        state.tailBoundary = boundary;
        state.boundaryState = boundaryInfo.state || null;
      },
    });
    return { ...mutation, boundary: nextBoundary, tailKind: boundaryInfo.tailKind || "text", liveMode: boundaryInfo.liveMode || "markdown", scannedChars: Number(boundaryInfo.scannedChars) || 0, fallback: !!boundaryInfo.fallback, reusedTail: canReuseLiveTail };
  }

  function updateTextSurface({ key, context = contextKey(), surface, messageKey, kind = "compact-output", text = "" } = {}) {
    if (!surface) return { applied: false, invalid: true };
    const value = String(text || "");
    return commitTranscriptMutation({
      key: key || `text:${surfaceKey(surface)}`,
      context,
      kind: "append",
      surfaces: [surface],
      mutate: () => {
        ownSurface(surface, { messageKey, kind });
        let node = surface._transcriptTextNode;
        if (!node?.isConnected || node.parentNode !== surface) {
          node = surface.childNodes.length === 1 && surface.firstChild?.nodeType === Node.TEXT_NODE
            ? surface.firstChild
            : document.createTextNode("");
          if (!node.isConnected) surface.append(node);
          surface._transcriptTextNode = node;
        }
        if (value.startsWith(node.data)) node.appendData(value.slice(node.data.length));
        else node.data = value;
      },
    });
  }

  function replaceChildren(target, ...nodes) {
    target?.replaceChildren(...nodes);
  }

  function replaceHtml(target, html) {
    if (!target) return;
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    replaceChildren(target, template.content);
  }

  function invalidateSelection({ surfaces = [] } = {}) {
    return clearSelectionFor(surfaces);
  }

  function endSelectionSession() {
    pointerSession = null;
    selectionSession = null;
    scheduleDeferredFlush();
  }

  document.addEventListener("pointerdown", () => { selectionIntentRevision += 1; }, { capture: true, passive: true });
  document.addEventListener("keydown", () => { selectionIntentRevision += 1; }, { capture: true });
  chat.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const surface = semanticSurface(event.target);
    if (!surface) return;
    pointerSession = { pointerId: event.pointerId, context: contextKey(), surface };
  }, { capture: true, passive: true });
  window.addEventListener("pointerup", (event) => {
    if (!pointerSession || (event.pointerId !== undefined && event.pointerId !== pointerSession.pointerId)) return;
    pointerSession = null;
    selectionSession = { snapshot: selectionSnapshot() };
    scheduleDeferredFlush();
  }, { capture: true, passive: true });
  window.addEventListener("pointercancel", () => endSelectionSession(), { capture: true, passive: true });
  window.addEventListener("blur", () => endSelectionSession(), { passive: true });
  document.addEventListener("selectionchange", () => {
    const snapshot = selectionSnapshot();
    if (snapshot) selectionSession = { snapshot };
    else if (!pointerSession) selectionSession = null;
  });
  chat.addEventListener("copy", () => {
    // Allow the browser to read the selected text before applying queued work.
    endSelectionSession();
  }, { capture: true });

  return {
    commitTranscriptMutation,
    invalidateSelection,
    mutationLog: () => mutationLog.slice(),
    ownMessage,
    ownSurface,
    reconcileMarkdownSurface,
    replaceChildren,
    replaceHtml,
    updateTextSurface,
  };
}
