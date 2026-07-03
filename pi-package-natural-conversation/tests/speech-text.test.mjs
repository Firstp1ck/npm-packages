import test from "node:test";
import assert from "node:assert/strict";
import { isLikelySttHallucination, speakableTextFromMarkdown, splitIntoSpeechChunks } from "../lib/native-audio/speech-text.mjs";
import { isSelfEcho, tokenOverlapRatio } from "../lib/native-audio/self-echo.mjs";

test("known whisper hallucination phrases are flagged; real requests are not", () => {
  for (const phrase of ["Thank you.", "Thank you!", "Thanks for watching!", "you", "Bye.", "Vielen Dank.", "Untertitelung des ZDF, 2020", "Subtitles by the Amara.org community", "..."]) {
    assert.equal(isLikelySttHallucination(phrase), true, phrase);
  }
  for (const phrase of ["Thank you, now open the readme", "What does this function do?", "Kannst du das erklären?", "stop"]) {
    assert.equal(isLikelySttHallucination(phrase), false, phrase);
  }
});

test("markdown is reduced to speakable text with code blocks omitted", () => {
  const markdown = [
    "# Heading",
    "The `read` tool works like this:",
    "```js",
    "const secret = 42;",
    "```",
    "- first item",
    "- **bold** and *italic* and [a link](https://example.com)",
  ].join("\n");
  const text = speakableTextFromMarkdown(markdown);
  assert.ok(!text.includes("#"));
  assert.ok(!text.includes("```"));
  assert.ok(!text.includes("const secret"));
  assert.ok(text.includes("Code block omitted."));
  assert.ok(text.includes("bold and italic and a link"));
  assert.ok(!text.includes("https://example.com"));
});

test("URLs, deep paths, and emoji are made speakable", () => {
  const text = speakableTextFromMarkdown(
    "The endpoint is http://127.0.0.1:8178/inference and the voice lives at /home/user/.local/share/piper/de_DE-thorsten-medium.onnx. Great! 🎉",
  );
  assert.ok(!text.includes("http://"), "URLs must not be spoken verbatim");
  assert.ok(text.includes("Link"));
  assert.ok(!text.includes("/home/user"), "deep paths must not be spoken verbatim");
  assert.ok(text.includes("de_DE-thorsten-medium.onnx"), "the path basename is kept");
  assert.ok(!text.includes("🎉"));
});

test("sentence chunking merges short sentences up to minChars", () => {
  assert.deepEqual(splitIntoSpeechChunks(""), []);
  const chunks = splitIntoSpeechChunks("Yes. It works. This second sentence is quite a bit longer than the first ones. Done now.", { minChars: 20 });
  assert.ok(chunks.length >= 2);
  assert.ok(chunks[0].length >= 20 || chunks.length === 1);
  assert.equal(chunks.join(" "), "Yes. It works. This second sentence is quite a bit longer than the first ones. Done now.");
});

test("self-echo detection matches transcripts against recently spoken text", () => {
  const spoken = "The controller stores the previous tools and restores them when the mode is disabled.";
  assert.ok(isSelfEcho("controller stores the previous tools and restores them", spoken));
  assert.ok(!isSelfEcho("what is the weather like in Zurich today", spoken));
  assert.equal(tokenOverlapRatio("", spoken), 0);
  assert.equal(tokenOverlapRatio("anything", ""), 0);
});
