import test from "node:test";
import assert from "node:assert/strict";
import { createSentenceStream } from "../lib/native-audio/sentence-stream.mjs";

test("sentences are released only at boundaries; partials stay buffered", () => {
  const stream = createSentenceStream();
  assert.equal(stream.push("Hello wor"), "");
  assert.equal(stream.push("ld. And then"), "Hello world. ");
  assert.equal(stream.pending(), "And then");
  assert.equal(stream.flush(), "And then");
  assert.equal(stream.pending(), "");
});

test("question and exclamation marks with closing quotes count as boundaries", () => {
  const stream = createSentenceStream();
  assert.equal(stream.push('He said "Stop!" then left'), 'He said "Stop!" ');
  assert.equal(stream.push(". Right? Yes"), "then left. Right? ");
  assert.equal(stream.flush(), "Yes");
});

test("paragraph breaks release text even without sentence punctuation", () => {
  const stream = createSentenceStream();
  assert.equal(stream.push("A heading line\n\nBody starts"), "A heading line\n\n");
  assert.equal(stream.pending(), "Body starts");
});

test("open code fences hold everything until the fence closes", () => {
  const stream = createSentenceStream();
  // The boundary before the fence is released; fence content is not.
  assert.equal(stream.push("Look here. \n```js\nconst x = f(); // done. yes\n"), "Look here. ");
  assert.equal(stream.push("more(). code\n"), "", "boundaries inside an open fence never cut");
  // Once the fence closes, the whole block flows out with the next boundary.
  const released = stream.push("```\nAfter the fence it works. And");
  assert.ok(released.includes("```js"), "closed fence is released for markdown conversion");
  assert.ok(released.endsWith("it works. "));
  assert.equal(stream.pending(), "And");
});

test("reset drops any buffered partial", () => {
  const stream = createSentenceStream();
  stream.push("Unfinished thought");
  stream.reset();
  assert.equal(stream.flush(), "");
});
