import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../index.ts", import.meta.url), "utf8");

assert.doesNotMatch(source, /pi\.registerCommand\("tools"/, "the tools extension must own /tools");
assert.doesNotMatch(source, /pi\.registerCommand\("skills"/, "the skills extension must own /skills");
assert.doesNotMatch(source, /registerTuiResourceController/, "WebUI must not manage TUI tool or skill state");

console.log("resource-tui-extension.test.mjs passed");
