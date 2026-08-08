import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, css, producer, parser] = await Promise.all([
  readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../../pi-extension-git-footer-status/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../../pi-extension-git-footer-status/provider-usage.ts", import.meta.url), "utf8"),
]);

const between = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
};

const normalizeChip = between(app, "function normalizeFooterPayloadChip", "function currentGitFooterCacheCwd");
const usageNormalization = normalizeChip.slice(normalizeChip.indexOf("if (value.usageWindows"));
const applyUsage = between(app, "function applyFooterUsageWindows", "const FOOTER_MIDDLE_TRUNCATION_END_CHARS");
const shapeKey = between(app, "function gitFooterChipShapeKey", "function footerBranchPickerRenderKey");
const inPlaceUpdate = between(app, "function updateGitFooterChipNodeValue", "let gitFooterRenderCache");

assert.match(parser, /x-codex-primary-window-minutes/, "Codex parser should read the primary window duration");
assert.match(parser, /x-codex-secondary-window-minutes/, "Codex parser should read the secondary window duration");
assert.match(parser, /windowMinutes === 10_080\) return "weekly"/, "Codex weekly windows should have a truthful compact label");
assert.match(parser, /return fallback;/, "missing Codex durations should use neutral labels rather than guessed 5h\/7d labels");
assert.match(parser, /usage\.primary\.label[\s\S]*usage\.secondary\.label/, "formatted text should use snapshot labels");

assert.match(producer, /usageWindows\?:\s*\{\s*primaryPercent:\s*number;\s*secondaryPercent:\s*number;/s, "producer should type the optional usageWindows contract");
assert.match(producer, /usageWindows:\s*\{\s*primaryPercent:\s*providerUsage\.primary\.usedPercent,\s*secondaryPercent:\s*providerUsage\.secondary\.usedPercent,/s, "Usage chip should publish both normalized window percentages");
assert.match(app, /usage:\s*"Provider subscription usage\.[^"]*provider-reported primary and secondary rate windows\./, "Usage tooltip should explain both provider-reported windows rather than using generic fallback copy");

assert.match(usageNormalization, /value\.usageWindows\.primaryPercent/, "consumer should read structured primary metadata");
assert.match(usageNormalization, /value\.usageWindows\.secondaryPercent/, "consumer should read structured secondary metadata");
assert.match(usageNormalization, /Number\.isFinite\(primaryPercent\)\s*&&\s*Number\.isFinite\(secondaryPercent\)/, "consumer should require both finite window values");
assert.match(usageNormalization, /chip\.usageWindows\s*=\s*\{\s*primaryPercent,\s*secondaryPercent\s*\}/, "consumer should preserve the two structured values");
assert.doesNotMatch(usageNormalization, /chip\.value|value\.value|5h.*match|7d.*match/s, "usage-window normalization must not parse display text");

assert.match(app, /if \(chip\.usageWindows\) applyFooterUsageWindows\(node, chip\.usageWindows\);/, "initial rendering should apply Usage visuals");
assert.match(applyUsage, /Math\.min\(100, Math\.max\(0, primaryPercent\)\)/, "primary visual should clamp defensively");
assert.match(applyUsage, /Math\.min\(100, Math\.max\(0, secondaryPercent\)\)/, "secondary visual should clamp defensively");
assert.match(applyUsage, /--usage-primary/, "primary should have an independent CSS width variable");
assert.match(applyUsage, /--usage-secondary/, "secondary should have an independent CSS width variable");
assert.doesNotMatch(applyUsage, /\.value|5h.*match|7d.*match/s, "visual application must not parse display text");
assert.match(shapeKey, /key === "title" && chip\?\.key === "usage"/, "dynamic Usage titles should not force a full footer rebuild");
assert.match(shapeKey, /key === "usageWindows"[\s\S]*shape\.usageWindows = value \? true : false/, "shape key should track visual capability, not changing percentages");
assert.match(inPlaceUpdate, /chip\.key === "usage"[\s\S]*gitFooterPayloadTooltip\(chip\)/, "in-place Usage updates should rebuild the complete dynamic tooltip");
assert.match(inPlaceUpdate, /setAttribute\("aria-label", nextTooltip\.replace/, "in-place tooltip updates should keep the aria-label current");
assert.match(inPlaceUpdate, /if \(chip\.usageWindows\) applyFooterUsageWindows\(node, chip\.usageWindows\);/, "live updates should refresh both widths in place");

const sharedOverlay = css.match(/\.footer-usage-card\.has-usage-windows::before,\s*\.footer-usage-card\.has-usage-windows::after\s*\{([^}]+)\}/s)?.[1] ?? "";
const primaryLane = css.match(/\.footer-usage-card\.has-usage-windows::before\s*\{([^}]+)\}/s)?.[1] ?? "";
const secondaryLane = [...css.matchAll(/\.footer-usage-card\.has-usage-windows::after\s*\{([^}]+)\}/gs)]
  .map((match) => match[1] ?? "")
  .find((body) => /bottom:\s*0/.test(body)) ?? "";
const foreground = css.match(/\.footer-usage-card > \*\s*\{([^}]+)\}/s)?.[1] ?? "";

assert.match(sharedOverlay, /height:\s*50%/, "each usage lane should occupy half the chip height");
assert.match(sharedOverlay, /background:\s*var\(--context-card-gradient\)/, "usage lanes should reuse the Context gradient");
assert.match(sharedOverlay, /opacity:\s*0\.34/, "usage lanes should retain Context-like translucent contrast");
assert.match(primaryLane, /top:\s*0/, "primary lane should be the top lane");
assert.match(primaryLane, /border-bottom:\s*1px solid/, "the two lanes should have a subtle visual separator");
assert.match(primaryLane, /var\(--usage-primary\)/, "top lane width should use the primary percentage");
assert.match(secondaryLane, /bottom:\s*0/, "secondary lane should be the bottom lane");
assert.match(secondaryLane, /var\(--usage-secondary\)/, "bottom lane width should use the secondary percentage");
assert.match(foreground, /position:\s*relative/, "Usage content should establish foreground positioning");
assert.match(foreground, /z-index:\s*1/, "Usage text should stay above both overlays");

console.log("footer provider usage visual static tests passed");
