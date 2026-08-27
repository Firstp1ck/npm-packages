import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [skill, designTokens, portableTheme, quickshellStyling, routing] = await Promise.all([
  readFile(path.join(root, "skills", "desktop-visual-design", "SKILL.md"), "utf8"),
  readFile(path.join(root, "skills", "desktop-visual-design", "references", "design-tokens.md"), "utf8"),
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

test("fallback visual guidance follows the restrained Omarchy profile", () => {
  assert.match(skill, /restrained terminal-first fallback/);
  assert.match(skill, /opaque flat surfaces/);
  assert.match(skill, /Prefer the desktop's monospace UI alias/);
  assert.match(skill, /use square panels and controls with a `0px` radius/);
  assert.match(skill, /no positional hover movement/);
  assert.match(designTokens, /Omarchy-inspired relationship between roles/);
  assert.match(designTokens, /charcoal with a restrained violet cast/);
  assert.match(designTokens, /Coherent light counterpart/);
  assert.match(designTokens, /Green is reserved for semantic success/);
  assert.match(designTokens, /Both branches must be complete/);
  assert.match(designTokens, /Use a solid 1px border by default/);
  assert.match(designTokens, /change contrast or alpha, not width/);
  assert.match(designTokens, /Do not add positional hover movement/);
  assert.match(designTokens, /must not force dark mode/);
});

test("screenshot comparison evaluates relationships without copying pixels", () => {
  assert.match(skill, /Compare relationships, not sampled pixels/);
  assert.match(skill, /\*\*Analyze supplied screenshots\.\*\*/);
  assert.match(skill, /palette relationships; primary, secondary, and display hierarchy; density and composition/);
  assert.match(skill, /outer and module framing; typography scale and tracking; sparse functional landmark iconography/);
  assert.match(skill, /exact colors, unseen states, automatic-mode behavior, and the opposite color scheme/);
  assert.match(skill, /\*\*Compare the result\.\*\*/);
  assert.match(skill, /Record pass, difference, or not observable/);
  assert.match(skill, /Green or another success color must remain semantic punctuation/);
});

test("fallback recipes preserve framed hierarchy and restrained landmarks", () => {
  assert.match(designTokens, /App shells use one thin, square outer frame/);
  assert.match(designTokens, /do not box every row/);
  assert.match(designTokens, /display-scale title or value/);
  assert.match(designTokens, /have an accessible name; do not add an icon dependency/);
  assert.match(designTokens, /Framing should reveal the composition, not create a card grid/);
  assert.match(skill, /Keep status and selection treatments rectangular/);
});

test("routing recognizes forced-light desktop regressions", () => {
  assert(routing.should_trigger.some((prompt) => /forcing light mode.*system dark preference/i.test(prompt)));
});
