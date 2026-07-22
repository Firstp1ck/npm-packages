import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = await readFile(join(root, "public", "styles.css"), "utf8");

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `${selector} should have a CSS rule`);
  return match[1];
}

const filledDanger = ruleBody("button.danger");
assert.match(filledDanger, /color:\s*var\(--button-primary-text\)/, "filled danger buttons should retain dark high-contrast text");
assert.match(filledDanger, /background:\s*linear-gradient\([^;]*var\(--ctp-red\)[^;]*var\(--ctp-peach\)/, "filled danger buttons should retain their danger gradient");

for (const selector of [
  ".git-side-panel-context-menu button.danger",
  ".aur-review-action.danger",
  ".git-operation-button.danger",
  ".git-file-action.danger",
]) {
  const body = ruleBody(selector);
  assert.match(body, /color:\s*var\(--ctp-red\)/, `${selector} should retain its red outline-button text`);
  assert.match(body, /background:\s*rgba\(var\(--ctp-crust-rgb\),\s*0\.[0-9]+\)/, `${selector} should place red text on a neutral surface`);
  assert.doesNotMatch(body, /background:[^;]*(?:--ctp-red|--ctp-peach)/, `${selector} must not place red text on a red danger background`);
}

console.log("danger button contrast static tests passed");
