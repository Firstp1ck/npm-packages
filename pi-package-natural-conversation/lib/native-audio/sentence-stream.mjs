// Incremental sentence extractor for streamed assistant text (plan Phase 4).
// Consumes raw markdown deltas and returns speakable-complete head segments,
// holding everything inside an open ``` fence until the fence closes so the
// TTS pipeline never voices half a code block.

const BOUNDARY_RE = /[.!?…][)"'”’\]]*\s/g;

export function createSentenceStream() {
  let buffer = "";

  function fenceCountBefore(index) {
    let count = 0;
    let pos = 0;
    while ((pos = buffer.indexOf("```", pos)) !== -1 && pos < index) {
      count += 1;
      pos += 3;
    }
    return count;
  }

  // Latest sentence boundary or paragraph break that is outside all fences.
  function findCut() {
    let cut = -1;
    BOUNDARY_RE.lastIndex = 0;
    let match;
    while ((match = BOUNDARY_RE.exec(buffer)) !== null) {
      if (fenceCountBefore(match.index) % 2 === 0) cut = match.index + match[0].length;
    }
    const paragraph = buffer.lastIndexOf("\n\n");
    if (paragraph >= 0 && fenceCountBefore(paragraph) % 2 === 0) cut = Math.max(cut, paragraph + 2);
    return cut;
  }

  /** Append a delta; returns completed raw text ready to speak, or "". */
  function push(delta) {
    buffer += typeof delta === "string" ? delta : "";
    const cut = findCut();
    if (cut <= 0) return "";
    const head = buffer.slice(0, cut);
    buffer = buffer.slice(cut);
    return head;
  }

  /** Drain whatever remains (end of a text block). */
  function flush() {
    const rest = buffer;
    buffer = "";
    return rest;
  }

  function reset() {
    buffer = "";
  }

  return { push, flush, reset, pending: () => buffer };
}
