import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [css, app] = await Promise.all([
  readFile(join(root, "public", "styles.css"), "utf8"),
  readFile(join(root, "public", "app.js"), "utf8"),
]);

function rule(selector, label) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${label} should be present`);
  const end = css.indexOf("}", start);
  assert.ok(end > start, `${label} should be complete`);
  return css.slice(start, end + 1);
}

const container = rule(".composer-intercom-tags", "conversation tag container styles");
const denseContainer = rule(".composer-intercom-tags.dense", "dense conversation tag container styles");
const containerRules = [...css.matchAll(/\.composer-intercom-tags(?:\.dense)?\s*\{([^}]*)\}/g)].map((match) => match[1]).join("\n");
const tag = rule(".composer-intercom-tag", "conversation tag styles");
const label = rule(".composer-intercom-tag-label", "conversation tag label styles");
const icon = rule(".composer-intercom-tag-icon", "conversation tag icon styles");
const count = rule(".composer-intercom-tag-count", "conversation tag count styles");

assert.match(container, /display:\s*grid;/, "conversation tags should use a bounded grid instead of a scroller");
assert.match(container, /grid-auto-flow:\s*column;/, "ordinary conversation counts should remain on one row");
assert.match(container, /grid-auto-columns:\s*minmax\(0,\s*1fr\);/, "ordinary conversation tags should receive equal shares of the available inline width");
assert.match(denseContainer, /grid-auto-flow:\s*row;/, "dense conversation counts should wrap into rows");
assert.match(denseContainer, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(44px,\s*1fr\)\);/, "dense rows should retain a 44px minimum inline target");
assert.match(container, /min-width:\s*0;/, "the conversation tag container should shrink with its composer surface");
assert.doesNotMatch(containerRules, /overflow(?:-x|-inline)?\s*:[^;]*(?:auto|scroll)/, "conversation tag containers must not restore horizontal auto/scroll overflow");
assert.doesNotMatch(container, /scrollbar|overscroll-behavior-inline/, "conversation tag layout should not retain scroller-only behavior");

assert.match(tag, /width:\s*100%;[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/, "each equal-share tag should fill and shrink inside its grid track");
assert.match(tag, /overflow:\s*hidden;/, "tag contents should not expand the equal-share track");
assert.match(label, /flex:\s*1 1 auto;[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/, "long visual labels should produce a real single-line ellipsis");
assert.match(icon, /flex:\s*0 0 auto;/, "the conversation icon should stay stable while the label shrinks");
assert.match(count, /flex:\s*0 0 auto;/, "the conversation count should stay stable while the label shrinks");
assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.composer-intercom-tag \{ min-height: 44px; \}/, "narrow and coarse-pointer tags should retain a 44px activation target");
assert.match(app, /container\.classList\.toggle\("dense", orderedTags\.length > 8\);/, "the documented dense threshold should activate only above eight conversations");
assert.match(app, /const visualSignature = JSON\.stringify\(\[label, conversation\.messageCount\]\);[\s\S]*if \(tag\.dataset\.intercomVisualSignature !== visualSignature\)[\s\S]*tag\.replaceChildren\(\.\.\.children\);[\s\S]*tag\.dataset\.intercomVisualSignature = visualSignature;/, "unchanged tag visuals should retain their existing children inside the polite live region");

console.log("intercom-tag-layout-static.test.mjs passed");
