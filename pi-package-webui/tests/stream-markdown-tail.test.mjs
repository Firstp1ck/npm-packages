import assert from "node:assert/strict";
import {
  STREAMING_MARKDOWN_PLAIN_TAIL_LIMIT,
  advanceStreamingMarkdownTail,
} from "../public/stream-markdown-tail.mjs";

function append(state, text, options = {}) {
  return advanceStreamingMarkdownTail(state, text, { appendOnly: !!state, ...options });
}

function referenceTail(text, plainTailLimit = STREAMING_MARKDOWN_PLAIN_TAIL_LIMIT) {
  const value = String(text || "");
  const lines = value.split("\n");
  // CommonMark: an opening fence is 3+ backticks (optionally followed by an info string); the
  // closing fence must have at least as many backticks and nothing but whitespace after them.
  let inFence = false;
  let fenceTicks = 0;
  let boundary = 0;
  let offset = 0;
  let fenceContentOffset = -1;
  let fenceLanguage = "";
  const closingFence = (line) => {
    const match = line.match(/^\s*(`{3,})\s*$/);
    return Boolean(match && match[1].length >= fenceTicks);
  };
  const openingFence = (line) => {
    const match = line.match(/^\s*(`{3,})\s*([\w.+-]*)\s*$/);
    return match ? { ticks: match[1].length, language: match[2] || "" } : null;
  };
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index];
    if (inFence) {
      if (closingFence(line)) {
        inFence = false;
        fenceTicks = 0;
        fenceContentOffset = -1;
        fenceLanguage = "";
        boundary = offset + line.length + 1;
      }
    } else {
      const opening = openingFence(line);
      if (opening) {
        inFence = true;
        fenceTicks = opening.ticks;
        fenceContentOffset = offset + line.length + 1;
        fenceLanguage = opening.language;
      }
    }
    offset += line.length + 1;
    if (!inFence && !line.trim()) boundary = offset;
  }
  const pendingRaw = lines.at(-1) || "";
  const pending = pendingRaw.endsWith("\r") ? pendingRaw.slice(0, -1) : pendingRaw;
  const pendingOpening = !inFence ? openingFence(pending) : null;
  const pendingClose = inFence && closingFence(pending);
  if (pendingClose) return { boundary, liveMode: "authoritative", tailKind: "closed-fence", fenceContentOffset, fenceLanguage };
  if (inFence) return { boundary, liveMode: "open-fence", tailKind: "open-fence", fenceContentOffset, fenceLanguage };
  if (pendingOpening) return { boundary, liveMode: "open-fence", tailKind: "open-fence", fenceContentOffset: value.length, fenceLanguage: pendingOpening.language };
  if (value.length - boundary > plainTailLimit) return { boundary, liveMode: "plain", tailKind: "long-text", fenceContentOffset, fenceLanguage };
  return { boundary, liveMode: "markdown", tailKind: "text", fenceContentOffset, fenceLanguage };
}

for (const sample of [
  "paragraph without a newline",
  "alpha\r\n\r\n  ``` ts  \r\nconst value = `x`;\r\n```\r\nafter",
  "```mermaid\nflowchart LR\n```\n",
  "```js\ncode\n```` still code\n```",
  "  ``` c++\nline one\nline two\n  ```   \r\n",
]) {
  let state = null;
  for (let end = 1; end <= sample.length; end += 1) {
    const text = sample.slice(0, end);
    const result = append(state, text);
    state = result.state;
    const expected = referenceTail(text);
    assert.deepEqual(
      {
        boundary: result.boundary,
        liveMode: result.liveMode,
        tailKind: result.tailKind,
        fenceContentOffset: result.fenceContentOffset,
        fenceLanguage: result.fenceLanguage,
      },
      expected,
      `incremental line state must match authoritative boundary semantics at split ${end} of ${JSON.stringify(sample)}`,
    );
    assert.equal(result.scannedChars, 1);
    assert.equal(state.scanOffset, text.length);
  }
}

{
  let state = null;
  let text = "stable paragraph\n\n";
  let result = append(state, text);
  state = result.state;
  assert.equal(result.boundary, text.length);
  assert.equal(result.scannedChars, text.length);

  for (const suffix of ["```js", "\n", "const smile = '😀';", "\nconsole.log(smile);"]) {
    text += suffix;
    result = append(state, text);
    state = result.state;
    assert.equal(result.scannedChars, suffix.length, "only the newly appended UTF-16 suffix may be boundary-scanned");
    assert.equal(result.boundary, "stable paragraph\n\n".length, "the committed prefix must not be rescanned or moved inside an open fence");
    assert.equal(result.liveMode, "open-fence");
    assert.equal(result.tailKind, "open-fence");
  }

  text += "\n```";
  result = append(state, text);
  state = result.state;
  assert.equal(result.scannedChars, 4);
  assert.equal(result.liveMode, "authoritative", "a recognized closing delimiter must request one authoritative tail render");
  assert.equal(result.tailKind, "closed-fence");

  text += "\n";
  result = append(state, text);
  assert.equal(result.scannedChars, 1);
  assert.equal(result.boundary, text.length, "a newline-terminated closed fence becomes a safe committed block checkpoint");
}

{
  const prefix = "alpha\n\n";
  let result = append(null, prefix);
  const previous = result.state;
  result = append(previous, `${prefix}beta`);
  assert.equal(result.scannedChars, 4);
  assert.equal(result.fallback, false);
  result = append(result.state, `${prefix}replacement`, { appendOnly: false });
  assert.equal(result.fallback, true, "a divergent snapshot must use the authoritative scanner fallback");
  assert.equal(result.scannedChars, `${prefix}replacement`.length);
}

{
  const longTail = "x".repeat(STREAMING_MARKDOWN_PLAIN_TAIL_LIMIT + 1);
  const result = append(null, longTail);
  assert.equal(result.liveMode, "plain", "ambiguous tails above the bound must use the cheap live representation");
  assert.equal(result.tailKind, "long-text");
  const completed = append(result.state, longTail, { complete: true });
  assert.equal(completed.boundary, longTail.length);
  assert.equal(completed.liveMode, "authoritative", "completion must restore authoritative Markdown semantics");
  assert.equal(completed.scannedChars, 0, "completion of an unchanged value does not rescan the committed prefix");
}

{
  let state = null;
  let text = "```mermaid\nflowchart LR";
  let result = append(state, text);
  state = result.state;
  assert.equal(result.liveMode, "open-fence", "incomplete Mermaid remains plain live code");
  assert.equal(result.fenceLanguage, "mermaid");
  text += "\n```";
  result = append(state, text);
  assert.equal(result.liveMode, "authoritative", "Mermaid becomes authoritative only after its close delimiter");
}

{
  let state = null;
  let text = "";
  let result;
  const length = STREAMING_MARKDOWN_PLAIN_TAIL_LIMIT + 4096;
  for (let index = 0; index < length; index += 1) {
    text += index === length - 1 ? "😀" : "x";
    const suffixLength = index === length - 1 ? 2 : 1;
    result = append(state, text);
    state = result.state;
    assert.equal(result.scannedChars, suffixLength, "a growing no-newline paragraph must examine exactly its new suffix");
  }
  assert.equal(result.liveMode, "plain");
  assert.equal(result.tailKind, "long-text");
  assert.equal(result.boundary, 0);
  assert.equal(state.scanOffset, text.length, "the scan cursor must advance past a known non-fence partial line");
  assert.equal(state.lineStage, "invalid", "a known non-fence line must retain only bounded classification state");
}

{
  let state = null;
  let text = "";
  let result;
  for (const suffix of [" ", "`", "`", "`", " ", "j", "s", "\r", "\n"]) {
    text += suffix;
    result = append(state, text);
    state = result.state;
    assert.equal(result.scannedChars, suffix.length, "split opening-fence and CRLF input must scan only each suffix");
  }
  assert.equal(result.liveMode, "open-fence");
  assert.equal(result.fenceLanguage, "js");
  assert.equal(result.fenceContentOffset, text.length);

  const codeLength = STREAMING_MARKDOWN_PLAIN_TAIL_LIMIT + 2048;
  for (let index = 0; index < codeLength; index += 3) {
    const suffix = "abc".slice(0, Math.min(3, codeLength - index));
    text += suffix;
    result = append(state, text);
    state = result.state;
    assert.equal(result.scannedChars, suffix.length, "a long open-fence code line must scan only its appended chunk");
    assert.equal(result.liveMode, "open-fence");
    assert.equal(result.fenceLanguage, "js");
    assert.equal(state.scanOffset, text.length, "open-fence code scanning must advance past the accumulated partial line");
  }
  assert.equal(state.lineStage, "invalid", "ordinary code content must stop fence-candidate work after its first decisive character");

  for (const suffix of ["\r", "\n", "`", "`", "`", " ", " ", "\r"]) {
    text += suffix;
    result = append(state, text);
    state = result.state;
    assert.equal(result.scannedChars, suffix.length, "split closing-fence input must scan only each suffix");
  }
  assert.equal(result.liveMode, "authoritative");
  assert.equal(result.tailKind, "closed-fence");
  text += "\n";
  result = append(state, text);
  assert.equal(result.scannedChars, 1);
  assert.equal(result.boundary, text.length);
}

console.log("stream-markdown-tail.test.mjs passed");
