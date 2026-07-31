import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");

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
    measurements: 0,
    getBoundingClientRect() {
      this.measurements += 1;
      return { width };
    },
  };
}

const tags = [chip(50), chip(60), chip(70)];
const overflow = chip(22);
const container = {
  hidden: false,
  clientWidth: 150,
  querySelectorAll: (selector) => selector === "button.composer-skill-tag" ? tags : [],
  querySelector: (selector) => selector === ".composer-skill-tag.overflow" ? overflow : null,
};
const context = {
  elements: { sessionSkillTags: container },
  getComputedStyle: () => ({ columnGap: "5px", gap: "5px" }),
};
vm.runInNewContext(
  `${functionSource("fitSessionSkillTags", "scheduleSessionSkillTagLayout")}\nthis.fitSessionSkillTags = fitSessionSkillTags;`,
  context,
);

context.fitSessionSkillTags();
assert.deepEqual(tags.map((tag) => tag.hidden), [false, false, true], "the strip should show the maximum chip count that fits the measured width");
assert.equal(overflow.hidden, false, "the overflow chip should remain visible while tags are hidden");
assert.equal(overflow.textContent, "+1", "the overflow chip should report the current hidden count");
assert.equal(overflow.measurements, 1, "fitting should measure one overflow width per digit count rather than forcing layout for every candidate");

container.clientWidth = 200;
context.fitSessionSkillTags();
assert.deepEqual(tags.map((tag) => tag.hidden), [false, false, false], "widening the input should reveal every tag without rerendering the session state");
assert.equal(overflow.hidden, true, "the overflow chip should disappear when every tag fits");

container.clientWidth = 80;
context.fitSessionSkillTags();
assert.deepEqual(tags.map((tag) => tag.hidden), [false, true, true], "narrowing the input should compact the tag strip again");
assert.equal(overflow.textContent, "+2", "responsive compaction should keep the overflow count current");

container.clientWidth = 0;
const zeroWidthState = tags.map((tag) => tag.hidden);
const zeroWidthOverflowText = overflow.textContent;
context.fitSessionSkillTags();
assert.deepEqual(tags.map((tag) => tag.hidden), zeroWidthState, "a temporarily unmeasurable strip should preserve its last stable visibility state");
assert.equal(overflow.textContent, zeroWidthOverflowText, "a zero-width pass should not expose a stale overflow count");

console.log("composer skill tag layout tests passed");
