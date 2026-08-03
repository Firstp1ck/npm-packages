import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createQuestionnaireRuntime } from "../src/runtime.ts";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "..");
const PI_ROOT = join(REPOSITORY_ROOT, "node_modules", "@earendil-works", "pi-coding-agent");
const PI_TYPES_PATH = join(PI_ROOT, "dist", "core", "extensions", "types.d.ts");
const PI_KEYBINDINGS_PATH = join(PI_ROOT, "dist", "core", "keybindings.js");
const WEBUI_PATH = join(REPOSITORY_ROOT, "pi-package-webui", "public", "app.js");
const RUNTIME_PATH = join(PACKAGE_ROOT, "src", "runtime.ts");
const ENTRY_PATH = join(PACKAGE_ROOT, "index.ts");

const readContract = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    assert.fail(`native compatibility evidence is unavailable at ${path}: ${error.message}`);
  }
};

const singleQuestion = {
  id: "delivery",
  label: "Delivery",
  prompt: "How should this be delivered?",
  type: "single",
  options: [{ id: "standard", label: "Standard" }],
  allowOther: true,
};

const multiQuestion = {
  id: "features",
  label: "Features",
  prompt: "Which features should be included?",
  type: "multi",
  options: [{ id: "alpha", label: "Alpha" }, { id: "beta", label: "Beta" }],
  allowOther: true,
  minSelections: 1,
  maxSelections: 3,
};

function scriptedContext(mode) {
  const calls = [];
  const forbidden = [];
  const selectSteps = [
    (options) => options.find((option) => option.startsWith("Other…")),
    (options) => options.find((option) => option.includes("[ ] Alpha")),
    (options) => options.find((option) => option.startsWith("Add Other…")),
    (options) => options.find((option) => option === "Continue with 2 selection(s)"),
  ];
  const inputSteps = ["courier", "gamma"];

  const ui = new Proxy({}, {
    get(_target, property) {
      if (property === "select") {
        return async (title, options) => {
          calls.push({ method: "select", title, options: [...options] });
          const choose = selectSteps.shift();
          assert.ok(choose, `[${mode}] unexpected native select call: ${title}`);
          const value = choose(options);
          assert.notEqual(value, undefined, `[${mode}] scripted native select option was not present in ${JSON.stringify(options)}`);
          return value;
        };
      }
      if (property === "input") {
        return async (title, placeholder) => {
          calls.push({ method: "input", title, placeholder });
          assert.ok(inputSteps.length > 0, `[${mode}] unexpected native input call: ${title}`);
          return inputSteps.shift();
        };
      }
      forbidden.push(String(property));
      return async () => {
        throw new Error(`[${mode}] questionnaire invoked forbidden UI method ${String(property)}`);
      };
    },
  });

  return {
    calls,
    forbidden,
    pending: () => ({ selects: selectSteps.length, inputs: inputSteps.length }),
    ctx: {
      mode,
      hasUI: true,
      ui,
      sessionManager: { getBranch: () => [] },
    },
  };
}

test("real runtime uses only native select/input methods in both TUI and RPC modes", async () => {
  for (const mode of ["tui", "rpc"]) {
    const scripted = scriptedContext(mode);
    const execute = createQuestionnaireRuntime({ createId: () => `native-${mode}` });
    const result = await execute({ action: "start", questions: [singleQuestion, multiQuestion] }, undefined, scripted.ctx);

    assert.equal(result.details.status, "completed", `[${mode}] scripted native flow must complete`);
    assert.deepEqual(result.details.answers, [
      { questionId: "delivery", selectedOptionIds: [], other: "courier" },
      { questionId: "features", selectedOptionIds: ["alpha"], other: "gamma" },
    ]);
    assert.deepEqual(scripted.calls.map((call) => call.method), ["select", "input", "select", "select", "input", "select"]);
    assert.deepEqual(scripted.forbidden, [], `[${mode}] runtime accessed a non-native questionnaire UI method`);
    assert.deepEqual(scripted.pending(), { selects: 0, inputs: 0 }, `[${mode}] scripted flow did not consume every expected native interaction`);
  }
});

test("runtime surface and installed Pi types retain the public select/input seam without a private RPC dependency", () => {
  const runtimeSource = readContract(RUNTIME_PATH);
  const entrySource = readContract(ENTRY_PATH);
  const piTypes = readContract(PI_TYPES_PATH);
  const uiInterface = /export interface NativeQuestionnaireUi\s*\{([\s\S]*?)\n\}/.exec(runtimeSource);

  assert.ok(uiInterface, `NativeQuestionnaireUi interface not found in ${RUNTIME_PATH}`);
  assert.deepEqual(
    [...uiInterface[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*\(/gm)].map((match) => match[1]),
    ["select", "input"],
    `${RUNTIME_PATH} must expose exactly Pi's native select/input questionnaire seam`,
  );
  assert.match(piTypes, /select\(title:\s*string,\s*options:\s*string\[\]/, `${PI_TYPES_PATH} must declare native select(title, options)`);
  assert.match(piTypes, /input\(title:\s*string,\s*placeholder\?:\s*string/, `${PI_TYPES_PATH} must declare native input(title, placeholder)`);

  for (const [path, source] of [[RUNTIME_PATH, runtimeSource], [ENTRY_PATH, entrySource]]) {
    assert.doesNotMatch(source, /\b(?:ctx\.)?ui\.custom\s*\(/, `${path} must not depend on ctx.ui.custom()`);
    assert.doesNotMatch(source, /extension_ui_(?:request|response)/, `${path} must not implement the RPC transport or private request methods`);
    assert.doesNotMatch(source, /\bmethod\s*:\s*["']questionnaire/i, `${path} must not introduce a questionnaire-specific RPC method`);
  }
});

test("installed Pi selector defaults provide Up, Down, and Enter behavior", async () => {
  let keybindings;
  try {
    ({ KEYBINDINGS: keybindings } = await import(pathToFileURL(PI_KEYBINDINGS_PATH).href));
  } catch (error) {
    assert.fail(`could not load installed Pi keybindings from ${PI_KEYBINDINGS_PATH}: ${error.message}`);
  }

  const expected = {
    "tui.select.up": "up",
    "tui.select.down": "down",
    "tui.select.confirm": "enter",
  };
  for (const [binding, key] of Object.entries(expected)) {
    assert.ok(keybindings?.[binding], `${PI_KEYBINDINGS_PATH} is missing ${binding}`);
    assert.equal(keybindings[binding].defaultKeys, key, `${binding} must retain its native ${key} selector default`);
  }
});

test("current WebUI renders generic select buttons whose click response returns the exact option string", () => {
  const webuiSource = readContract(WEBUI_PATH);
  const selectStart = webuiSource.indexOf('if (request.method === "select") {');
  const selectEnd = webuiSource.indexOf('} else if (request.method === "confirm") {', selectStart);

  assert.ok(selectStart >= 0, `select dialog branch not found in ${WEBUI_PATH}`);
  assert.ok(selectEnd > selectStart, `select dialog branch boundary not found in ${WEBUI_PATH}`);
  const selectBranch = webuiSource.slice(selectStart, selectEnd);

  assert.match(selectBranch, /for\s*\(const option of request\.options\s*\|\|\s*\[\]\)/, `${WEBUI_PATH} must render every native select option`);
  assert.match(selectBranch, /const optionLabel\s*=\s*String\(option\)/, `${WEBUI_PATH} must preserve the option as one exact string`);
  assert.match(selectBranch, /make\(\s*["']button["']\s*,\s*undefined\s*,\s*optionLabel\s*\)/, `${WEBUI_PATH} must render each select string as a button`);
  assert.match(selectBranch, /button\.addEventListener\(\s*["']click["']\s*,\s*\(\)\s*=>\s*sendDialogResponse\(\s*\{[\s\S]*?\bvalue:\s*optionLabel\b[\s\S]*?\}\s*\)\s*\)/, `${WEBUI_PATH} click handler must return the exact optionLabel string`);
  assert.doesNotMatch(selectBranch, /questionnaire/i, `${WEBUI_PATH} must remain a generic native select handler, not a questionnaire-specific protocol`);
});
