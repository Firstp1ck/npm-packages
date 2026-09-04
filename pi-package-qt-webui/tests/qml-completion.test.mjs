import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../qml/components/Composer.qml", import.meta.url), "utf8");

function composerHarness() {
  const context = vm.createContext({
    prompt: { text: "", cursorPosition: 0 },
    completions: [], completionKind: "", completionQuery: "", completionEmptyText: "",
    completionIdentity: "", completionGeneration: 0, completionResultGeneration: -1,
    completionLoading: false, suppressedCompletion: "", completionRequested() {},
  });
  for (const name of ["completionContext", "contextIdentity", "invalidateCompletion", "refreshCompletion", "setCompletionResults", "dismissCompletion", "acceptCompletion"]) {
    const start = source.indexOf(`    function ${name}(`);
    assert(start >= 0, name);
    const open = source.indexOf("{", start);
    let depth = 1;
    let end = open + 1;
    while (depth && end < source.length) {
      if (source[end] === "{") depth++;
      if (source[end] === "}") depth--;
      end++;
    }
    vm.runInContext(source.slice(start, end), context);
  }
  const setText = (text, cursor = text.length) => {
    context.prompt.text = text;
    context.prompt.cursorPosition = cursor;
    context.refreshCompletion();
  };
  return { context, setText };
}

const result = [{ value: "old/file.txt", directory: false }];

test("completion invalidates old results before debounce and rejects delayed replies", () => {
  const { context: c, setText } = composerHarness();
  setText("@old");
  const old = c.completionGeneration;
  assert(c.setCompletionResults(old, result, ""));
  setText("@new");
  assert.equal(c.completions.length, 0);
  assert.equal(c.completionLoading, true);
  assert.equal(c.acceptCompletion(0), false);
  assert.equal(c.setCompletionResults(old, result, ""), false);
  assert.equal(c.prompt.text, "@new");
  const current = c.completionGeneration;
  assert(c.setCompletionResults(current, [{ value: "new/file.txt" }], ""));
  assert(c.acceptCompletion(0));
  assert.equal(c.prompt.text, "@new/file.txt ");
});

test("completion generations distinguish revisits, dismissal, kinds, and cursor positions", () => {
  const { context: c, setText } = composerHarness();
  setText("@old");
  const old = c.completionGeneration;
  setText("@new");
  setText("@old");
  assert.equal(c.setCompletionResults(old, result, ""), false);
  const revisit = c.completionGeneration;
  c.dismissCompletion();
  assert.equal(c.setCompletionResults(revisit, result, ""), false);
  setText("@old");
  assert.equal(c.completionKind, "");
  setText("");
  setText("@old");
  assert.equal(c.completionKind, "path", "leaving the token clears dismissal");
  setText("/old");
  assert.equal(c.completionKind, "command");
  assert.equal(c.setCompletionResults(revisit, result, ""), false);
  setText("@old @old", 4);
  const firstToken = c.completionGeneration;
  assert(c.setCompletionResults(firstToken, result, ""));
  setText("@old @old", 9);
  assert.equal(c.completionQuery, "old");
  assert.equal(c.acceptCompletion(0), false);
  assert.equal(c.setCompletionResults(firstToken, result, ""), false);
});

test("acceptance independently checks the context even before a change signal runs", () => {
  const { context: c, setText } = composerHarness();
  setText("@old");
  assert(c.setCompletionResults(c.completionGeneration, result, ""));
  c.prompt.text = "@new";
  assert.equal(c.acceptCompletion(0), false);
  assert.equal(c.prompt.text, "@new");
});
