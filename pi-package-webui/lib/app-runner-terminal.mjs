function terminalLineState(state = {}) {
  return {
    line: String(state.line ?? ""),
    carriageReturnPending: state.carriageReturnPending === true,
  };
}

/**
 * Reduce one streamed process chunk into terminal-style committed and live lines.
 * A bare carriage return moves back to the start of the current line, so the
 * next printable data replaces that line instead of creating scrollback.
 */
export function consumeAppRunnerTerminalChunk(state, chunk) {
  const current = terminalLineState(state);
  const lines = [];

  for (const character of String(chunk ?? "")) {
    if (character === "\r") {
      current.carriageReturnPending = true;
      continue;
    }
    if (character === "\n") {
      lines.push(current.line);
      current.line = "";
      current.carriageReturnPending = false;
      continue;
    }
    if (current.carriageReturnPending) {
      current.line = "";
      current.carriageReturnPending = false;
    }
    if (character === "\b") {
      current.line = [...current.line].slice(0, -1).join("");
      continue;
    }
    current.line += character;
  }

  return { lines, ...current };
}
