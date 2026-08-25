import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [skill, portableTheme, quickshellStyling, routing] = await Promise.all([
  readFile(path.join(root, "skills", "desktop-visual-design", "SKILL.md"), "utf8"),
  readFile(path.join(root, "skills", "desktop-visual-design", "references", "portable-theme-loading.md"), "utf8"),
  readFile(path.join(root, "skills", "desktop-visual-design", "references", "quickshell-plugin-styling.md"), "utf8"),
  readFile(path.join(root, "tests", "routing", "desktop-visual-design.json"), "utf8").then(JSON.parse),
]);

test("standalone apps must follow the live system color scheme", () => {
  assert.match(skill, /current system color-scheme preference/);
  assert.match(skill, /Automatic mode must update when its authoritative preference changes/);
  assert.match(skill, /UI components own no palette literals/);
  assert.match(skill, /Force both light and dark branches/);
  assert.match(skill, /automatic-mode acceptance check with no test override/);
  assert.match(portableTheme, /Qt\.styleHints\.colorScheme/);
  assert.match(portableTheme, /Prefer a valid portal result/);
  assert.match(portableTheme, /Test automatic mode without a forced test value/);
  assert.match(portableTheme, /must not contain literal palette colors/);
  assert.match(quickshellStyling, /parent: window\.contentItem/);
  assert.match(quickshellStyling, /surfaceFormat\.opaque: true/);
  assert.match(skill, /visual root belongs to `contentItem`/);
});

test("routing recognizes forced-light desktop regressions", () => {
  assert(routing.should_trigger.some((prompt) => /forcing light mode.*system dark preference/i.test(prompt)));
});
