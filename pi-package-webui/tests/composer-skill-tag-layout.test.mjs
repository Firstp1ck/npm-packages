import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");
const css = await readFile(join(root, "public", "styles.css"), "utf8");

function functionSource(name, nextName) {
  const start = app.indexOf(`function ${name}(`);
  const end = app.indexOf(`\nfunction ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} should remain a standalone frontend helper`);
  return app.slice(start, end);
}

function chip(width) {
  return {
    hidden: false,
    textContent: "",
    title: "",
    attributes: new Map(),
    measurements: 0,
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    getBoundingClientRect() {
      this.measurements += 1;
      return { width };
    },
  };
}

const tags = [chip(50), chip(60), chip(70)];
const menuItems = [chip(50), chip(60), chip(70)];
const overflow = chip(22);
const overflowStateCalls = [];
const container = {
  hidden: false,
  clientWidth: 150,
  querySelectorAll: (selector) => {
    if (selector === ":scope > button.composer-skill-tag:not(.overflow)") return tags;
    if (selector === ".composer-skill-overflow-menu-item") return menuItems;
    return [];
  },
  querySelector: (selector) => selector === "button.composer-skill-tag.overflow" ? overflow : null,
};
const context = {
  elements: { sessionSkillTags: container },
  sessionSkillOverflowOpen: false,
  setSessionSkillOverflowOpen: (open) => overflowStateCalls.push(open),
  getComputedStyle: () => ({ columnGap: "5px", gap: "5px" }),
};
vm.runInNewContext(
  `${functionSource("fitSessionSkillTags", "scheduleSessionSkillTagLayout")}\nthis.fitSessionSkillTags = fitSessionSkillTags;`,
  context,
);

context.fitSessionSkillTags();
assert.deepEqual(tags.map((tag) => tag.hidden), [false, false, true], "the strip should show the maximum chip count that fits the measured width");
assert.deepEqual(menuItems.map((tag) => tag.hidden), [true, true, false], "the popup should contain only tags hidden from the strip");
assert.equal(overflow.hidden, false, "the overflow chip should remain visible while tags are hidden");
assert.equal(overflow.textContent, "+1", "the overflow chip should report the current hidden count");
assert.equal(overflow.attributes.get("aria-label"), "Show 1 more tracked skill", "the disclosure should announce its current hidden count");
assert.equal(overflow.measurements, 1, "fitting should measure one overflow width per digit count rather than forcing layout for every candidate");

container.clientWidth = 200;
context.fitSessionSkillTags();
assert.deepEqual(tags.map((tag) => tag.hidden), [false, false, false], "widening the input should reveal every tag without rerendering the session state");
assert.deepEqual(menuItems.map((tag) => tag.hidden), [true, true, true], "the popup should not duplicate tags visible in the strip");
assert.equal(overflow.hidden, true, "the overflow chip should disappear when every tag fits");
assert.deepEqual(overflowStateCalls, [false], "revealing every tag should close an open overflow surface");

container.clientWidth = 80;
context.fitSessionSkillTags();
assert.deepEqual(tags.map((tag) => tag.hidden), [false, true, true], "narrowing the input should compact the tag strip again");
assert.deepEqual(menuItems.map((tag) => tag.hidden), [true, false, false], "responsive compaction should update the selectable popup contents");
assert.equal(overflow.textContent, "+2", "responsive compaction should keep the overflow count current");

container.clientWidth = 0;
const zeroWidthState = tags.map((tag) => tag.hidden);
const zeroWidthOverflowText = overflow.textContent;
context.fitSessionSkillTags();
assert.deepEqual(tags.map((tag) => tag.hidden), zeroWidthState, "a temporarily unmeasurable strip should preserve its last stable visibility state");
assert.equal(overflow.textContent, zeroWidthOverflowText, "a zero-width pass should not expose a stale overflow count");

const disclosureSource = functionSource("setSessionSkillOverflowOpen", "fitSessionSkillTags");
const installSource = functionSource("installSessionSkillTagResizeHandling", "renderSessionSkillTags");
const renderStart = app.indexOf("function renderSessionSkillTags(");
const renderEnd = app.indexOf("\nconst INTERCOM_CONVERSATION_ID_PATTERN", renderStart);
const renderSource = app.slice(renderStart, renderEnd);
assert.match(disclosureSource, /classList\.toggle\("overflow-open", expanded\)[\s\S]*aria-expanded[\s\S]*menu\.hidden = !expanded/, "the disclosure should keep visual, accessible, and hidden state synchronized");
assert.match(installSource, /event\.key !== "Escape"[\s\S]*restoreFocus: true[\s\S]*document\.addEventListener\("pointerdown"/, "Escape and outside pointer interaction should dismiss the popup");
assert.match(renderSource, /make\("button", "composer-skill-tag overflow"[\s\S]*aria-haspopup[\s\S]*sessionSkillOverflowMenu[\s\S]*role", "dialog"/, "the overflow count should render as an accessible popup button");
assert.match(renderSource, /composer-skill-overflow-menu-item[\s\S]*setSessionSkillOverflowOpen\(false\);[\s\S]*openSkillEditor\(entry\)/, "every hidden tag should remain clickable through the existing editor action");
assert.match(css, /\.composer-skill-overflow-menu \{[\s\S]*position: absolute;[\s\S]*bottom: calc\(100% \+ 0\.42rem\);[\s\S]*max-height:[\s\S]*overflow-y: auto;/, "the bounded popup should expand upward above the compact strip");
assert.match(css, /\.composer-skill-overflow-menu \.composer-skill-tag \{[\s\S]*width: 100%;[\s\S]*max-width: none;/, "hidden tags should use the popup width instead of the compact-strip truncation limit");

console.log("composer skill tag layout tests passed");
