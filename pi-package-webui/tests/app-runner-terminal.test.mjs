import assert from "node:assert/strict";
import { consumeAppRunnerTerminalChunk } from "../lib/app-runner-terminal.mjs";

function consume(chunks) {
  let state = { line: "", carriageReturnPending: false };
  const lines = [];
  for (const chunk of chunks) {
    const result = consumeAppRunnerTerminalChunk(state, chunk);
    lines.push(...result.lines);
    state = result;
  }
  return { lines, line: state.line, carriageReturnPending: state.carriageReturnPending };
}

assert.deepEqual(
  consume(["Discovering packages\nChecking package statuses: 1/77\rChecking package statuses: 2/77\rChecking package statuses: 3/77"]),
  {
    lines: ["Discovering packages"],
    line: "Checking package statuses: 3/77",
    carriageReturnPending: false,
  },
  "bare carriage returns should replace one live progress line instead of adding scrollback",
);

assert.deepEqual(
  consume(["first\r", "\nsecond\r\nthird\n"]),
  {
    lines: ["first", "second", "third"],
    line: "",
    carriageReturnPending: false,
  },
  "CRLF should commit one line even when the pair is split across chunks",
);

assert.deepEqual(
  consume(["50% complete\r", "51% complete"]),
  {
    lines: [],
    line: "51% complete",
    carriageReturnPending: false,
  },
  "a trailing carriage return should replace the live line when the next chunk arrives",
);

assert.deepEqual(
  consume(["progress 1\r\u001b[2Kprogress \u001b[32m2\u001b[0m\n"]),
  {
    lines: ["\u001b[2Kprogress \u001b[32m2\u001b[0m"],
    line: "",
    carriageReturnPending: false,
  },
  "ANSI control and SGR sequences should remain intact for the browser renderer",
);

assert.deepEqual(
  consume(["abc\bD"]),
  {
    lines: [],
    line: "abD",
    carriageReturnPending: false,
  },
  "backspace should update the current line without exposing a control glyph",
);

console.log("app runner terminal reducer tests passed");
