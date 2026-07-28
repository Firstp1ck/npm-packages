import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = await readFile(join(root, "public", "styles.css"), "utf8");

const selectionBarRule = css.match(/\.file-selection-bar \{[^}]*\}/)?.[0] || "";
assert.match(
  selectionBarRule,
  /position:\s*absolute;[^}]*right:\s*0\.72rem;[^}]*bottom:\s*1\.68rem;[^}]*left:\s*0\.72rem;[^}]*z-index:\s*7;/,
  "the file selection comment bar should overlay the viewer instead of shifting selected text",
);
assert.doesNotMatch(
  selectionBarRule,
  /flex:\s*0\s+0\s+auto;/,
  "the file selection comment bar must stay out of the viewer's flex layout",
);

console.log("file selection overlay static tests passed");
