export const STREAMING_MARKDOWN_PLAIN_TAIL_LIMIT = 16 * 1024;

const LINE_LEADING = "leading";
const LINE_TICKS = "ticks";
const LINE_AFTER_TICKS = "after-ticks";
const LINE_LANGUAGE = "language";
const LINE_TRAILING = "trailing";
const LINE_INVALID = "invalid";

function initialLineState() {
  return {
    lineBlank: true,
    lineStage: LINE_LEADING,
    lineTicks: 0,
    lineLanguage: "",
  };
}

function initialState() {
  return {
    value: "",
    scanOffset: 0,
    boundary: 0,
    inFence: false,
    fenceContentOffset: -1,
    fenceLanguage: "",
    fenceTicks: 0,
    scannedChars: 0,
    fallback: false,
    ...initialLineState(),
  };
}

function isLineWhitespace(character) {
  return character !== "\n" && /\s/.test(character);
}

function isFenceLanguageCharacter(character) {
  return /[A-Za-z0-9_.+-]/.test(character);
}

function invalidateLineFence(state) {
  state.lineStage = LINE_INVALID;
  state.lineLanguage = "";
}

function advanceOpeningFenceCandidate(state, character) {
  if (isLineWhitespace(character)) {
    if (state.lineStage === LINE_LANGUAGE) state.lineStage = LINE_TRAILING;
    else if (state.lineStage !== LINE_TRAILING) state.lineStage = LINE_AFTER_TICKS;
    return;
  }
  if (isFenceLanguageCharacter(character) && state.lineStage !== LINE_TRAILING) {
    state.lineStage = LINE_LANGUAGE;
    state.lineLanguage += character;
    return;
  }
  invalidateLineFence(state);
}

function advanceLineCharacter(state, character) {
  // An invalid delimiter candidate necessarily already contains a non-space;
  // later code/paragraph characters need only advance the outer scan cursor.
  if (state.lineStage === LINE_INVALID) return;
  const whitespace = isLineWhitespace(character);
  if (!whitespace) state.lineBlank = false;

  if (state.lineStage === LINE_LEADING) {
    if (whitespace) return;
    if (character === "`") {
      state.lineStage = LINE_TICKS;
      state.lineTicks = 1;
      return;
    }
    invalidateLineFence(state);
    return;
  }

  if (state.lineStage === LINE_TICKS) {
    // CommonMark fences are three OR MORE backticks (```` ````md ```` wraps nested ``` blocks).
    if (character === "`") {
      state.lineTicks += 1;
      return;
    }
    if (state.lineTicks < 3) {
      invalidateLineFence(state);
      return;
    }
    state.lineStage = LINE_AFTER_TICKS;
  }

  if (state.inFence) {
    if (!whitespace) invalidateLineFence(state);
    return;
  }
  advanceOpeningFenceCandidate(state, character);
}

function lineIsFenceDelimiter(state) {
  if (state.lineTicks < 3 || state.lineStage === LINE_INVALID) return false;
  // A closing fence needs at least as many backticks as the opening one.
  if (state.inFence) return state.lineTicks >= (state.fenceTicks || 3) && (state.lineStage === LINE_TICKS || state.lineStage === LINE_AFTER_TICKS);
  return [LINE_TICKS, LINE_AFTER_TICKS, LINE_LANGUAGE, LINE_TRAILING].includes(state.lineStage);
}

function finishLine(state, nextOffset) {
  const fenceDelimiter = lineIsFenceDelimiter(state);
  const blank = state.lineBlank;
  if (state.inFence) {
    if (fenceDelimiter) {
      state.inFence = false;
      state.fenceContentOffset = -1;
      state.fenceLanguage = "";
      state.fenceTicks = 0;
      // A closed fence is an independently stable block. Committing it here
      // prevents later prose from causing the completed code to tokenize again.
      state.boundary = nextOffset;
    }
  } else if (fenceDelimiter) {
    state.inFence = true;
    state.fenceContentOffset = nextOffset;
    state.fenceLanguage = state.lineLanguage;
    state.fenceTicks = state.lineTicks;
  }
  if (!state.inFence && blank) state.boundary = nextOffset;
  Object.assign(state, initialLineState());
}

function scanSuffix(state, value, start) {
  for (let offset = start; offset < value.length; offset += 1) {
    const character = value[offset];
    state.scannedChars += 1;
    if (character === "\n") finishLine(state, offset + 1);
    else advanceLineCharacter(state, character);
  }
  state.scanOffset = value.length;
}

/**
 * Advances streaming Markdown boundary state from only a caller-confirmed
 * appended suffix. A non-append snapshot deliberately rebuilds from the full
 * authoritative value and reports that fallback through `fallback`.
 */
export function advanceStreamingMarkdownTail(previous, text, { complete = false, appendOnly = false, plainTailLimit = STREAMING_MARKDOWN_PLAIN_TAIL_LIMIT } = {}) {
  const value = String(text || "");
  const incremental = !!previous && appendOnly && value.length >= previous.value.length;
  const state = incremental ? { ...previous } : initialState();
  const start = incremental ? previous.value.length : 0;
  state.scannedChars = 0;
  state.fallback = !!previous && !incremental;
  scanSuffix(state, value, start);
  state.value = value;

  if (complete) {
    return {
      boundary: value.length,
      state,
      scannedChars: state.scannedChars,
      fallback: state.fallback,
      tailKind: "complete",
      liveMode: "authoritative",
      fenceContentOffset: -1,
      fenceLanguage: "",
    };
  }

  const pendingFence = lineIsFenceDelimiter(state);
  const pendingClose = state.inFence && pendingFence;
  const pendingOpening = !state.inFence && pendingFence;
  const tailLength = value.length - state.boundary;
  let liveMode = "markdown";
  let tailKind = "text";
  let fenceContentOffset = state.fenceContentOffset;
  let fenceLanguage = state.fenceLanguage;

  if (pendingClose) {
    // The existing parser already recognizes this delimiter as a close even
    // before a trailing newline arrives, so render the tail authoritatively once.
    liveMode = "authoritative";
    tailKind = "closed-fence";
  } else if (state.inFence) {
    liveMode = "open-fence";
    tailKind = "open-fence";
  } else if (pendingOpening) {
    liveMode = "open-fence";
    tailKind = "open-fence";
    fenceContentOffset = value.length;
    fenceLanguage = state.lineLanguage;
  } else if (tailLength > Math.max(0, Number(plainTailLimit) || 0)) {
    liveMode = "plain";
    tailKind = "long-text";
  }

  return {
    boundary: state.boundary,
    state,
    scannedChars: state.scannedChars,
    fallback: state.fallback,
    tailKind,
    liveMode,
    fenceContentOffset,
    fenceLanguage,
  };
}
