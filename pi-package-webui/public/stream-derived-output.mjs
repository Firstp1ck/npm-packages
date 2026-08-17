const THINKING_FORMAT_OPEN_TAG_REGEX = /^<think\b[^>]*>/i;
const THINKING_FORMAT_CLOSE_TAG_REGEX = /<\/think\s*>/i;
const CHANNEL_THINKING_FORMAT_OPEN_TAG_REGEX = /^<\|([a-z][\w-]*)>/i;
const TODO_PROGRESS_LINE_REGEX = /^\s*(?:(?:[-*]|\d+[.)])\s*)?\[(?: |x|X|-)\]\s+.+$/;
const TODO_PROGRESS_PARTIAL_LINE_REGEX = /^\s*(?:(?:[-*]|\d+[.)])\s*)?\[(?: |x|X|-)?\]?\s*.*$/;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textLines(raw) {
  const value = String(raw || "");
  const lines = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "\n") continue;
    const end = index > start && value[index - 1] === "\r" ? index - 1 : index;
    lines.push(value.slice(start, end));
    start = index + 1;
  }
  if (start <= value.length) lines.push(value.slice(start));
  return lines;
}

export function stripTodoProgressLinesAuthoritative(text, { streaming = false, todoProgressDetected = true } = {}) {
  if (!todoProgressDetected) return String(text || "");
  let inFence = false;
  const kept = [];
  const raw = String(text || "");
  const hasTrailingNewline = /\r?\n$/.test(raw);
  const lines = textLines(raw);

  lines.forEach((line, index) => {
    const isUnfinishedTail = streaming && !hasTrailingNewline && index === lines.length - 1;
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      kept.push(line);
      return;
    }
    if (!inFence && TODO_PROGRESS_LINE_REGEX.test(line)) return;
    if (!inFence && isUnfinishedTail && TODO_PROGRESS_PARTIAL_LINE_REGEX.test(line)) return;
    kept.push(line);
  });

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isPartialThinkingFormatOpenTag(text) {
  const value = String(text || "").trimStart().toLowerCase();
  if (!value) return false;
  if ("<think>".startsWith(value)) return true;
  if (value === "<|" || /^<\|[a-z][\w-]*$/i.test(value)) return true;
  return /^<think\b[^>]*$/i.test(value);
}

function stripPartialThinkingFormatClose(text, closeTag = "</think>") {
  const value = String(text || "");
  const lower = value.toLowerCase();
  const expected = String(closeTag || "").toLowerCase();
  const start = lower.lastIndexOf("<");
  if (start < 0) return value;
  const partial = lower.slice(start).trimEnd();
  return expected.startsWith(partial) ? value.slice(0, start) : value;
}

function stripThinkingFormatOutputSeparator(text) {
  return String(text || "").replace(/^(?:[ \t]*\r?\n)+/, "").replace(/^[ \t]+/, "");
}

function joinedThinkingFormatParts(parts) {
  return parts.map((part) => String(part || "")).filter((part) => part.length > 0).join("\n\n");
}

function thinkingFormatOpenMatch(text) {
  const value = String(text || "");
  const think = THINKING_FORMAT_OPEN_TAG_REGEX.exec(value);
  if (think) return { kind: "think", raw: think[0], closeRegex: THINKING_FORMAT_CLOSE_TAG_REGEX, closeTag: "</think>" };
  const channel = CHANNEL_THINKING_FORMAT_OPEN_TAG_REGEX.exec(value);
  if (!channel) return null;
  const name = channel[1];
  return { kind: "channel", raw: channel[0], closeRegex: new RegExp(`<${escapeRegExp(name)}\\|>`, "i"), closeTag: `<${name}|>` };
}

function thinkingFormatCloseMatch(text, open) {
  const value = String(text || "");
  if (open?.kind !== "think") return open?.closeRegex?.exec(value) || null;
  const tokens = /<think\b[^>]*>|<\/think\s*>/gi;
  let depth = 1;
  let match = null;
  while ((match = tokens.exec(value))) {
    if (/^<\s*\/think/i.test(match[0])) {
      depth -= 1;
      if (depth === 0) return match;
    } else {
      depth += 1;
    }
  }
  return null;
}

export function splitThinkingFormatTextAuthoritative(text, { streaming = false } = {}) {
  let rest = String(text ?? "").trimStart();
  if (!rest) return null;
  if (!thinkingFormatOpenMatch(rest)) {
    return streaming && isPartialThinkingFormatOpenTag(rest)
      ? { hasThinkingFormat: true, thinkingText: "", finalText: "", complete: false }
      : null;
  }

  const thinkingParts = [];
  let open = thinkingFormatOpenMatch(rest);
  while (open) {
    const afterOpen = rest.slice(open.raw.length);
    const close = thinkingFormatCloseMatch(afterOpen, open);
    if (!close) {
      thinkingParts.push(streaming ? stripPartialThinkingFormatClose(afterOpen, open.closeTag) : afterOpen);
      return { hasThinkingFormat: true, thinkingText: joinedThinkingFormatParts(thinkingParts), finalText: "", complete: false };
    }

    thinkingParts.push(afterOpen.slice(0, close.index));
    rest = afterOpen.slice(close.index + close[0].length);
    const next = rest.trimStart();
    open = thinkingFormatOpenMatch(next);
    if (open) {
      rest = next;
      continue;
    }
    break;
  }

  return {
    hasThinkingFormat: true,
    thinkingText: joinedThinkingFormatParts(thinkingParts),
    finalText: stripThinkingFormatOutputSeparator(rest),
    complete: true,
  };
}

export function deriveStreamOutputAuthoritative(rawText, { todoProgressDetected = true } = {}) {
  const raw = String(rawText || "");
  const assistantText = stripTodoProgressLinesAuthoritative(raw, { streaming: true, todoProgressDetected });
  const thinkingFormat = splitThinkingFormatTextAuthoritative(assistantText, { streaming: true });
  const finalText = thinkingFormat?.hasThinkingFormat
    ? stripTodoProgressLinesAuthoritative(thinkingFormat.finalText, { streaming: true, todoProgressDetected })
    : assistantText;
  return { rawText: raw, assistantText, thinkingFormat, finalText };
}

function isWhitespace(char) {
  return /\s/u.test(char);
}

function isDotCharacter(char) {
  return /./u.test(char);
}

function createLineMeta() {
  return {
    prefixPhase: "leading",
    partialCandidate: true,
    partialMask: 0,
    bracketReached: false,
    fullPhase: "prefix",
    fullValid: false,
    fullInvalid: false,
    separatorCount: 0,
    fencePhase: "leading",
    fence: false,
  };
}

function feedLineMeta(meta, char) {
  if (!meta.fence && meta.fencePhase !== "invalid") {
    if (meta.fencePhase === "leading") {
      if (isWhitespace(char)) {
        // Keep looking for the first backtick.
      } else if (char === "`") meta.fencePhase = "tick1";
      else meta.fencePhase = "invalid";
    } else if (meta.fencePhase === "tick1") {
      meta.fencePhase = char === "`" ? "tick2" : "invalid";
    } else if (meta.fencePhase === "tick2") {
      if (char === "`") meta.fence = true;
      else meta.fencePhase = "invalid";
    }
  }

  if (!meta.bracketReached && meta.partialCandidate) {
    if (meta.prefixPhase === "leading") {
      if (isWhitespace(char)) {
        // Leading whitespace is accepted.
      } else if (char === "[") {
        meta.bracketReached = true;
        meta.partialMask = 0b1111;
        meta.fullPhase = "status";
      } else if (char === "-" || char === "*") meta.prefixPhase = "marker-space";
      else if (/[0-9]/.test(char)) meta.prefixPhase = "digits";
      else meta.partialCandidate = false;
    } else if (meta.prefixPhase === "digits") {
      if (/[0-9]/.test(char)) {
        // Continue the ordered-list marker.
      } else if (char === "." || char === ")") meta.prefixPhase = "marker-space";
      else meta.partialCandidate = false;
    } else if (meta.prefixPhase === "marker-space") {
      if (isWhitespace(char)) {
        // Whitespace between marker and bracket is accepted.
      } else if (char === "[") {
        meta.bracketReached = true;
        meta.partialMask = 0b1111;
        meta.fullPhase = "status";
      } else meta.partialCandidate = false;
    }
    if (!meta.partialCandidate) meta.fullInvalid = true;
    return;
  }

  let nextPartialMask = 0;
  if ((meta.partialMask & 0b0001) && (char === " " || char === "x" || char === "X" || char === "-")) nextPartialMask |= 0b1110;
  if ((meta.partialMask & 0b0011) && char === "]") nextPartialMask |= 0b1100;
  if ((meta.partialMask & 0b0111) && isWhitespace(char)) nextPartialMask |= 0b1100;
  if (meta.partialMask && isDotCharacter(char)) nextPartialMask |= 0b1000;
  meta.partialMask = nextPartialMask;
  meta.partialCandidate = nextPartialMask !== 0;

  if (meta.fullInvalid) return;
  if (meta.fullPhase === "status") {
    if (char === " " || char === "x" || char === "X" || char === "-") meta.fullPhase = "close";
    else meta.fullInvalid = true;
  } else if (meta.fullPhase === "close") {
    if (char === "]") meta.fullPhase = "separator";
    else meta.fullInvalid = true;
  } else if (meta.fullPhase === "separator") {
    if (isWhitespace(char)) {
      meta.separatorCount += 1;
      meta.fullValid = meta.separatorCount >= 2 && isDotCharacter(char);
    } else if (meta.separatorCount >= 1 && isDotCharacter(char)) {
      meta.fullValid = true;
      meta.fullPhase = "content";
    } else meta.fullInvalid = true;
  } else if (meta.fullPhase === "content") {
    if (!isDotCharacter(char)) meta.fullInvalid = true;
  }
  if (meta.fullValid && !meta.fullInvalid && meta.fullPhase !== "separator") meta.fullPhase = "content";
}

function appendCollapsedNewlines(base, addition) {
  if (!addition) return base;
  let leading = 0;
  while (addition[leading] === "\n") leading += 1;
  if (leading === 0) return base + addition;
  let trailing = 0;
  while (base.length > trailing && base[base.length - trailing - 1] === "\n") trailing += 1;
  const allowed = Math.max(0, 2 - trailing);
  return base + "\n".repeat(Math.min(allowed, leading)) + addition.slice(leading);
}

function createTodoFilter(todoProgressDetected) {
  return {
    detected: !!todoProgressDetected,
    inFence: false,
    committed: "",
    keptCount: 0,
    line: "",
    meta: createLineMeta(),
    pendingCR: false,
    rawText: "",
  };
}

function commitTodoLine(state) {
  const line = state.pendingCR ? state.line.slice(0, -1) : state.line;
  const keep = !state.detected || state.meta.fence || state.inFence || !state.meta.fullValid || state.meta.fullInvalid;
  if (keep) {
    const addition = `${state.keptCount ? "\n" : ""}${line}`;
    state.committed = appendCollapsedNewlines(state.committed, addition);
    state.keptCount += 1;
  }
  if (state.detected && state.meta.fence) state.inFence = !state.inFence;
  state.line = "";
  state.meta = createLineMeta();
  state.pendingCR = false;
}

function feedTodoFilter(state, suffix) {
  const text = String(suffix || "");
  state.rawText += text;
  if (!state.detected) return;
  for (const char of text) {
    if (char === "\n") {
      commitTodoLine(state);
      continue;
    }
    if (state.pendingCR) {
      feedLineMeta(state.meta, "\r");
      state.pendingCR = false;
    }
    state.line += char;
    if (char === "\r") state.pendingCR = true;
    else feedLineMeta(state.meta, char);
  }
}

function todoFilterValue(state) {
  if (!state.detected) return state.rawText;
  let meta = state.meta;
  if (state.pendingCR) {
    meta = structuredClone(meta);
    feedLineMeta(meta, "\r");
  }
  const keepTail = meta.fence || state.inFence || !meta.partialCandidate || !meta.bracketReached;
  const addition = keepTail ? `${state.keptCount ? "\n" : ""}${state.line}` : "";
  return appendCollapsedNewlines(state.committed, addition).trim();
}

function createOpenDetector() {
  return { buffer: "", phase: "start", index: 0, invalid: false, complete: null };
}

function feedOpenDetector(detector, char) {
  if (detector.invalid || detector.complete) return;
  detector.buffer += char;
  if (detector.phase === "start") {
    if (char === "<") detector.phase = "after-lt";
    else detector.invalid = true;
  } else if (detector.phase === "after-lt") {
    if (char === "|") detector.phase = "channel-first";
    else if (char.toLowerCase() === "t") {
      detector.phase = "think-name";
      detector.index = 1;
    } else detector.invalid = true;
  } else if (detector.phase === "think-name") {
    const expected = "think";
    if (char.toLowerCase() !== expected[detector.index]) detector.invalid = true;
    else if (++detector.index === expected.length) detector.phase = "think-boundary";
  } else if (detector.phase === "think-boundary") {
    if (char === ">") detector.complete = { kind: "think", raw: detector.buffer, closeTag: "</think>" };
    else if (/\w/.test(char)) detector.invalid = true;
    else detector.phase = "think-attrs";
  } else if (detector.phase === "think-attrs") {
    if (char === ">") detector.complete = { kind: "think", raw: detector.buffer, closeTag: "</think>" };
  } else if (detector.phase === "channel-first") {
    if (/[a-z]/i.test(char)) detector.phase = "channel-name";
    else detector.invalid = true;
  } else if (detector.phase === "channel-name") {
    if (char === ">") {
      const name = detector.buffer.slice(2, -1);
      detector.complete = { kind: "channel", raw: detector.buffer, closeTag: `<${name}|>` };
    } else if (!/[\w-]/.test(char)) detector.invalid = true;
  }
}

function openDetectorIsPartial(detector) {
  return !detector.invalid && !detector.complete && detector.buffer.length > 0;
}

function createInsideState(open) {
  return {
    open,
    depth: 1,
    stable: "",
    token: null,
  };
}

function createThinkToken() {
  return { buffer: "<", phase: "after-lt", index: 0, kind: "", hidden: true };
}

function restartThinkToken(inside, buffer) {
  const lastIsOpen = buffer.endsWith("<");
  inside.stable += lastIsOpen ? buffer.slice(0, -1) : buffer;
  inside.token = lastIsOpen ? createThinkToken() : null;
}

function feedThinkToken(inside, char) {
  const token = inside.token;
  if (token.phase === "inner-close-complete") {
    inside.stable += token.buffer;
    inside.token = null;
    return feedThinkInside(inside, char);
  }
  token.buffer += char;
  if (token.phase === "after-lt") {
    if (char === "/") {
      token.kind = "close";
      token.phase = "close-name";
      token.index = 0;
      token.hidden = true;
    } else if (char.toLowerCase() === "t") {
      token.kind = "open";
      token.phase = "open-name";
      token.index = 1;
      token.hidden = false;
    } else restartThinkToken(inside, token.buffer);
    return null;
  }

  if (token.phase === "open-name") {
    const expected = "think";
    if (char.toLowerCase() !== expected[token.index]) restartThinkToken(inside, token.buffer);
    else if (++token.index === expected.length) token.phase = "open-boundary";
    return null;
  }
  if (token.phase === "open-boundary") {
    if (char === ">") {
      inside.stable += token.buffer;
      inside.depth += 1;
      inside.token = null;
    } else if (/\w/.test(char)) restartThinkToken(inside, token.buffer);
    else token.phase = "open-attrs";
    return null;
  }
  if (token.phase === "open-attrs") {
    if (char === ">") {
      inside.stable += token.buffer;
      inside.depth += 1;
      inside.token = null;
    }
    return null;
  }
  if (token.phase === "close-name") {
    const expected = "think";
    if (char.toLowerCase() === expected[token.index]) {
      token.index += 1;
      if (token.index === expected.length) token.phase = "close-end";
    } else if (isWhitespace(char)) token.phase = "close-hide-only";
    else restartThinkToken(inside, token.buffer);
    return null;
  }
  if (token.phase === "close-hide-only") {
    if (!isWhitespace(char)) restartThinkToken(inside, token.buffer);
    return null;
  }
  if (token.phase === "close-end") {
    if (char === ">") return finishThinkClose(inside);
    if (isWhitespace(char)) token.phase = "close-space";
    else restartThinkToken(inside, token.buffer);
    return null;
  }
  if (token.phase === "close-space") {
    if (char === ">") return finishThinkClose(inside);
    if (!isWhitespace(char)) restartThinkToken(inside, token.buffer);
  }
  return null;
}

function finishThinkClose(inside) {
  const raw = inside.token.buffer;
  inside.depth -= 1;
  if (inside.depth === 0) {
    inside.token = null;
    return { closed: true, raw };
  }
  inside.token.phase = "inner-close-complete";
  inside.token.hidden = true;
  return null;
}

function feedThinkInside(inside, char) {
  if (inside.token) return feedThinkToken(inside, char);
  if (char === "<") inside.token = createThinkToken();
  else inside.stable += char;
  return null;
}

function createChannelToken(expected) {
  return { expected: expected.toLowerCase(), buffer: "<", matchIndex: 1, trailingWhitespace: false, hidden: true };
}

function restartChannelToken(inside, buffer) {
  const lastIsOpen = buffer.endsWith("<");
  inside.stable += lastIsOpen ? buffer.slice(0, -1) : buffer;
  inside.token = lastIsOpen ? createChannelToken(inside.open.closeTag) : null;
}

function feedChannelInside(inside, char) {
  if (!inside.token) {
    if (char === "<") inside.token = createChannelToken(inside.open.closeTag);
    else inside.stable += char;
    return null;
  }
  const token = inside.token;
  token.buffer += char;
  if (token.trailingWhitespace) {
    if (!isWhitespace(char)) restartChannelToken(inside, token.buffer);
    return null;
  }
  if (char.toLowerCase() === token.expected[token.matchIndex]) {
    token.matchIndex += 1;
    if (token.matchIndex === token.expected.length) {
      inside.token = null;
      return { closed: true, raw: token.buffer };
    }
  } else if (isWhitespace(char) && token.matchIndex < token.expected.length) {
    token.trailingWhitespace = true;
  } else restartChannelToken(inside, token.buffer);
  return null;
}

function insideValue(inside) {
  return inside.stable + (inside.token?.hidden ? "" : inside.token?.buffer || "");
}

function createSeparatorState() {
  return { phase: "leading", pendingSpaces: "", pendingCR: false, output: "" };
}

function feedSeparator(state, char) {
  if (state.phase === "output") {
    state.output += char;
    return;
  }
  if (state.pendingCR) {
    if (char === "\n") {
      state.pendingSpaces = "";
      state.pendingCR = false;
      return;
    }
    state.output += `\r${char}`;
    state.pendingSpaces = "";
    state.pendingCR = false;
    state.phase = "output";
    return;
  }
  if (char === " " || char === "\t") state.pendingSpaces += char;
  else if (char === "\n") state.pendingSpaces = "";
  else if (char === "\r") {
    state.pendingSpaces = "";
    state.pendingCR = true;
  } else {
    state.output += char;
    state.pendingSpaces = "";
    state.phase = "output";
  }
}

function separatorValue(state) {
  return state.output + (state.pendingCR ? "\r" : "");
}

function createThinkingState() {
  return {
    input: "",
    mode: "leading",
    leading: "",
    opener: null,
    hasThinkingFormat: false,
    joined: "",
    inside: null,
    betweenRaw: "",
    betweenTrimmedStarted: false,
    betweenOpener: null,
    separator: null,
    finalText: "",
  };
}

function appendThinkingPart(state, part) {
  if (!part) return;
  state.joined += `${state.joined ? "\n\n" : ""}${part}`;
}

function thinkingTextValue(state) {
  if (!state.hasThinkingFormat) return "";
  const current = state.mode === "inside" ? insideValue(state.inside) : "";
  if (!current) return state.joined;
  return state.joined ? `${state.joined}\n\n${current}` : current;
}

function thinkingResult(state) {
  if (!state.hasThinkingFormat) return null;
  return {
    hasThinkingFormat: true,
    thinkingText: thinkingTextValue(state),
    finalText: state.mode === "final"
      ? state.finalText
      : state.mode === "between"
        ? separatorValue(state.separator)
        : "",
    complete: state.mode === "between" || state.mode === "final",
  };
}

function beginInside(state, open) {
  state.hasThinkingFormat = true;
  state.mode = "inside";
  state.inside = createInsideState(open);
  state.betweenRaw = "";
  state.betweenTrimmedStarted = false;
  state.betweenOpener = null;
  state.separator = null;
}

function beginBetween(state) {
  appendThinkingPart(state, insideValue(state.inside));
  state.inside = null;
  state.mode = "between";
  state.betweenRaw = "";
  state.betweenTrimmedStarted = false;
  state.betweenOpener = createOpenDetector();
  state.separator = createSeparatorState();
}

function feedBetween(state, char) {
  state.betweenRaw += char;
  feedSeparator(state.separator, char);
  if (!state.betweenTrimmedStarted) {
    if (isWhitespace(char)) return;
    state.betweenTrimmedStarted = true;
  }
  feedOpenDetector(state.betweenOpener, char);
  if (state.betweenOpener.complete) {
    beginInside(state, state.betweenOpener.complete);
  } else if (state.betweenOpener.invalid) {
    state.mode = "final";
    state.finalText = separatorValue(state.separator);
    state.betweenOpener = null;
    state.separator = null;
  }
}

function feedThinkingState(state, suffix) {
  const text = String(suffix || "");
  state.input += text;
  for (const char of text) {
    if (state.mode === "none") continue;
    if (state.mode === "final") {
      state.finalText += char;
      continue;
    }
    if (state.mode === "leading") {
      if (isWhitespace(char)) {
        state.leading += char;
        continue;
      }
      state.mode = "opening";
      state.opener = createOpenDetector();
    }
    if (state.mode === "opening") {
      feedOpenDetector(state.opener, char);
      if (state.opener.complete) beginInside(state, state.opener.complete);
      else if (state.opener.invalid) {
        state.mode = "none";
        state.hasThinkingFormat = false;
      } else state.hasThinkingFormat = openDetectorIsPartial(state.opener);
      continue;
    }
    if (state.mode === "inside") {
      const closed = state.inside.open.kind === "think"
        ? feedThinkInside(state.inside, char)
        : feedChannelInside(state.inside, char);
      if (closed) beginBetween(state);
      continue;
    }
    if (state.mode === "between") feedBetween(state, char);
  }
}

function thinkingFinalSource(state, assistantText) {
  const parsed = thinkingResult(state);
  return parsed?.hasThinkingFormat ? parsed.finalText : assistantText;
}

function sameThinkingFormat(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameDerived(left, right) {
  return left.rawText === right.rawText
    && left.assistantText === right.assistantText
    && left.finalText === right.finalText
    && sameThinkingFormat(left.thinkingFormat, right.thinkingFormat);
}

function buildIncremental(rawText, todoProgressDetected) {
  const raw = String(rawText || "");
  const todo = createTodoFilter(todoProgressDetected);
  feedTodoFilter(todo, raw);
  const assistantText = todoFilterValue(todo);
  const thinking = createThinkingState();
  feedThinkingState(thinking, assistantText);
  const finalSource = thinkingFinalSource(thinking, assistantText);
  const finalTodo = createTodoFilter(todoProgressDetected);
  feedTodoFilter(finalTodo, finalSource);
  return { todo, thinking, thinkingInput: assistantText, finalTodo, finalInput: finalSource };
}

export function createStreamDerivedOutputState({ todoProgressDetected = true, shadow = false } = {}) {
  let detected = !!todoProgressDetected;
  let rawText = "";
  let incremental = buildIncremental("", detected);
  let value = deriveStreamOutputAuthoritative("", { todoProgressDetected: detected });
  let degraded = false;
  let diagnostics = { scannedCodeUnits: 0, fallbackReason: "", shadowMismatch: false };

  function currentIncrementalValue() {
    const assistantText = todoFilterValue(incremental.todo);
    const thinkingFormat = thinkingResult(incremental.thinking);
    return {
      rawText,
      assistantText,
      thinkingFormat,
      finalText: thinkingFormat?.hasThinkingFormat ? todoFilterValue(incremental.finalTodo) : assistantText,
    };
  }

  function rebuild(reason, scannedCodeUnits = rawText.length) {
    incremental = buildIncremental(rawText, detected);
    const candidate = currentIncrementalValue();
    const authoritative = deriveStreamOutputAuthoritative(rawText, { todoProgressDetected: detected });
    const mismatch = !sameDerived(candidate, authoritative);
    degraded = degraded || mismatch;
    value = mismatch ? authoritative : candidate;
    diagnostics = { scannedCodeUnits, fallbackReason: reason, shadowMismatch: mismatch };
    return value;
  }

  function append(delta) {
    const suffix = String(delta || "");
    if (!suffix) {
      diagnostics = { scannedCodeUnits: 0, fallbackReason: "", shadowMismatch: false };
      return value;
    }
    rawText += suffix;
    if (degraded) return rebuild("shadow-mismatch", rawText.length);

    feedTodoFilter(incremental.todo, suffix);
    const assistantText = todoFilterValue(incremental.todo);
    if (!assistantText.startsWith(incremental.thinkingInput)) {
      incremental.thinking = createThinkingState();
      feedThinkingState(incremental.thinking, assistantText);
      diagnostics = { scannedCodeUnits: suffix.length + assistantText.length, fallbackReason: "assistant-divergence", shadowMismatch: false };
    } else {
      feedThinkingState(incremental.thinking, assistantText.slice(incremental.thinkingInput.length));
      diagnostics = { scannedCodeUnits: suffix.length, fallbackReason: "", shadowMismatch: false };
    }
    incremental.thinkingInput = assistantText;

    const finalSource = thinkingFinalSource(incremental.thinking, assistantText);
    if (!finalSource.startsWith(incremental.finalInput)) {
      incremental.finalTodo = createTodoFilter(detected);
      feedTodoFilter(incremental.finalTodo, finalSource);
      diagnostics.scannedCodeUnits += finalSource.length;
      diagnostics.fallbackReason ||= "final-divergence";
    } else {
      feedTodoFilter(incremental.finalTodo, finalSource.slice(incremental.finalInput.length));
    }
    incremental.finalInput = finalSource;
    value = currentIncrementalValue();

    if (shadow) {
      const authoritative = deriveStreamOutputAuthoritative(rawText, { todoProgressDetected: detected });
      if (!sameDerived(value, authoritative)) {
        degraded = true;
        diagnostics.shadowMismatch = true;
        diagnostics.fallbackReason ||= "shadow-mismatch";
        value = authoritative;
      }
    }
    return value;
  }

  return {
    append,
    replace(text, { reason = "snapshot", force = false } = {}) {
      const next = String(text || "");
      if (!force && next === rawText) {
        diagnostics = { scannedCodeUnits: 0, fallbackReason: "", shadowMismatch: false };
        return value;
      }
      rawText = next;
      degraded = false;
      return rebuild(reason, rawText.length);
    },
    reset({ todoProgressDetected: nextDetected = detected, reason = "reset" } = {}) {
      detected = !!nextDetected;
      rawText = "";
      degraded = false;
      incremental = buildIncremental("", detected);
      value = deriveStreamOutputAuthoritative("", { todoProgressDetected: detected });
      diagnostics = { scannedCodeUnits: 0, fallbackReason: reason, shadowMismatch: false };
      return value;
    },
    setTodoProgressDetected(nextDetected) {
      const next = !!nextDetected;
      if (next === detected) return value;
      detected = next;
      degraded = false;
      return rebuild("todo-mode-change", rawText.length);
    },
    value() {
      return value;
    },
    takeDiagnostics() {
      const result = diagnostics;
      diagnostics = { scannedCodeUnits: 0, fallbackReason: "", shadowMismatch: false };
      return result;
    },
  };
}
