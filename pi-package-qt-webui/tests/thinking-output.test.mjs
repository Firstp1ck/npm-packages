import assert from "node:assert/strict";
import test from "node:test";
import { rowsFromHistory } from "../lib/backend/transcript.mjs";

test("history combines consecutive thinking, drops empty parts, and renders Markdown", () => {
  const history = rowsFromHistory([
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "**Planning**" },
        { type: "thinking", thinking: "   " },
        { type: "thinking", thinking: "**Checking**" },
        { type: "text", text: "Answer" },
        { type: "thinking", thinking: "**Separate**" },
      ],
      stopReason: "stop",
    },
  ]);

  assert.deepEqual(history.rows.map((row) => row.kind), ["thinking", "text", "thinking"]);
  assert.equal(history.rows[0].text, "**Planning**\n\n**Checking**");
  assert.deepEqual(JSON.parse(history.rows[0].blocksJson).map((block) => block.styled), ["<b>Planning</b>", "<b>Checking</b>"]);
  assert.equal(history.rows[2].text, "**Separate**");
  assert.equal(JSON.parse(history.rows[2].blocksJson)[0].styled, "<b>Separate</b>");
  assert(!history.rows.some((row) => row.kind === "thinking" && row.text.trim().length === 0));
});
