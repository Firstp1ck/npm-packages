import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");

function functionSource(name, nextName) {
  const start = app.indexOf(`function ${name}(`);
  const end = app.indexOf(`\nfunction ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} should remain a standalone frontend helper`);
  return app.slice(start, end);
}

class TestInputEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}

const context = { InputEvent: TestInputEvent };
vm.runInNewContext(
  `${functionSource("insertNumpadDecimal", "renderMessages")}\nthis.insertNumpadDecimal = insertNumpadDecimal;`,
  context,
);

function createInput(value, selectionStart, selectionEnd = selectionStart) {
  return {
    value,
    selectionStart,
    selectionEnd,
    disabled: false,
    readOnly: false,
    inputEvents: [],
    setRangeText(replacement, start, end, selectionMode) {
      assert.equal(selectionMode, "end");
      this.value = `${this.value.slice(0, start)}${replacement}${this.value.slice(end)}`;
      this.selectionStart = start + replacement.length;
      this.selectionEnd = this.selectionStart;
    },
    dispatchEvent(event) {
      this.inputEvents.push(event);
      return true;
    },
  };
}

function createKeyEvent(input, overrides = {}) {
  return {
    currentTarget: input,
    code: "NumpadDecimal",
    key: ",",
    keyCode: 0,
    location: 3,
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    preventDefault() { this.defaultPrevented = true; },
    ...overrides,
  };
}

const localizedInput = createInput("12,34", 2, 3);
const localizedEvent = createKeyEvent(localizedInput);
assert.equal(context.insertNumpadDecimal(localizedEvent), true, "localized numpad decimal should be handled");
assert.equal(localizedInput.value, "12.34", "localized numpad decimal should insert a dot at the selection");
assert.equal(localizedInput.selectionStart, 3, "cursor should follow the inserted dot");
assert.equal(localizedEvent.defaultPrevented, true, "native localized insertion should be replaced");
assert.equal(localizedInput.inputEvents.length, 1, "replacement should emit one input event");
assert.equal(localizedInput.inputEvents[0].type, "input");
assert.equal(localizedInput.inputEvents[0].data, ".");
assert.equal(localizedInput.inputEvents[0].inputType, "insertText");
assert.equal(localizedInput.inputEvents[0].bubbles, true);

const reportedDotInput = createInput("12", 2);
const reportedDotEvent = createKeyEvent(reportedDotInput, { key: "." });
assert.equal(context.insertNumpadDecimal(reportedDotEvent), true, "numpad decimal should be handled even when the browser reports a dot");
assert.equal(reportedDotInput.value, "12.", "explicit handling should not depend on native numpad insertion");
assert.equal(reportedDotEvent.defaultPrevented, true);

for (const overrides of [
  { code: "", key: "Decimal", location: 3 },
  { code: "", key: "Unidentified", keyCode: 110, location: 0 },
]) {
  const input = createInput("fallback", 8);
  assert.equal(context.insertNumpadDecimal(createKeyEvent(input, overrides)), true, `legacy numpad identity should be handled: ${JSON.stringify(overrides)}`);
  assert.equal(input.value, "fallback.");
}

for (const overrides of [
  { code: "Period", key: ".", location: 0 },
  { ctrlKey: true },
  { metaKey: true },
  { altKey: true },
  { shiftKey: true },
  { isComposing: true },
  { defaultPrevented: true },
]) {
  const input = createInput("unchanged", 4);
  const event = createKeyEvent(input, overrides);
  assert.equal(context.insertNumpadDecimal(event), false, `unrelated or modified key should not be handled: ${JSON.stringify(overrides)}`);
  assert.equal(input.value, "unchanged");
  assert.equal(input.inputEvents.length, 0);
}

const readOnlyInput = createInput("read only", 4);
readOnlyInput.readOnly = true;
assert.equal(context.insertNumpadDecimal(createKeyEvent(readOnlyInput)), false, "read-only fields should remain untouched");
assert.equal(readOnlyInput.value, "read only");

assert.match(
  app,
  /function renderAppRunnerInputForm\(run\)[\s\S]*input\.addEventListener\("keydown", \(event\) => \{\s*if \(insertNumpadDecimal\(event\)\) return;/,
  "app-runner stdin should apply the numpad decimal helper",
);
assert.match(
  app,
  /elements\.promptInput\.addEventListener\("keydown", \(event\) => \{\s*if \(event\.defaultPrevented \|\| insertNumpadDecimal\(event\)\) return;/,
  "main prompt should apply the numpad decimal helper",
);

console.log("numpad decimal input static tests passed");
