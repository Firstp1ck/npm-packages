import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [app, css, html] = await Promise.all([
  readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
]);

const between = (source, start, end) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
};

const helpers = between(app, "function formatStatsPercent", "function parseStatsWebuiPayloadRaw");
const charts = between(app, "const STATS_CHART_POINT_LIMIT", "function renderStatsOverview");
const overview = between(app, "function renderStatsOverview", "function renderStatsDaily");
const daily = between(app, "function renderStatsDaily", "function renderStatsModels");
const models = between(app, "function renderStatsModels", "function renderStatsSessions");
const sessions = between(app, "function renderStatsSessions", "function renderStatsCostCache");
const costCache = between(app, "function renderStatsCostCache", "function statsCalibrationButton");
const promptUi = between(app, "const STATS_PROMPT_SOURCE_LIMIT", "function renderStatsOverlayPane");
const promptInitial = between(app, "function renderStatsPromptInitial", "function statsPromptInventoryDetails");
const promptSnapshot = between(app, "function renderStatsPromptSnapshot", "function renderStatsPromptCurrent");
const promptCurrent = between(app, "function renderStatsPromptCurrent", "function renderStatsPrompt(payload)");
const promptDispatch = between(app, "function renderStatsPrompt(payload)", "function statsCommandOutputSection");
const rawOutput = between(app, "function renderStatsRaw", "function renderStatsOverlayPane");
const overlay = between(app, "function activateStatsOverlayTab", "function scheduleStatsRefreshAfterCalibration");

// Accurate cache terminology: no request-level "cache hit" label or savings claim in the stats UI.
const statsUi = helpers + charts + overview + daily + models + sessions + costCache + overlay;
assert.doesNotMatch(statsUi, /"Cache hit"/, "stats UI must not label any metric as a request-level cache hit");
assert.doesNotMatch(statsUi, /cache savings|estimated savings/i, "stats UI must not claim ungrounded monetary cache savings");
assert.match(statsUi, /Cached-input share/, "cached-input share label should be present");
assert.match(overview, /statsCachedInputShare\(summary, totals\)/, "overview should use the accurately named cached-input share");
assert.match(costCache, /statsCachedInputShare\(summary, totals\)/, "cost & cache should use the accurately named cached-input share");

// Legacy v1 fallbacks: absent fields are computed client-side, explicit null renders as n/a (never fake zeroes).
assert.match(helpers, /key in summary/, "fallback resolvers should distinguish absent fields from explicit nulls");
assert.match(helpers, /cachedInputShare[\s\S]*statsNumber\(totals\?\.input\) \+ statsNumber\(totals\?\.cacheRead\) \+ statsNumber\(totals\?\.cacheWrite\)/, "legacy cached-input share fallback should use the prompt-side denominator");
assert.match(helpers, /effectiveCostPerMillionTokens[\s\S]*1_000_000/, "legacy effective-cost fallback should compute cost per million total tokens");
assert.match(helpers, /return number === null \? "n\/a"/, "nullable percentages should render n/a rather than a fake zero");
assert.match(helpers, /function formatStatsNullableTokens\(value\) \{\s*const number = statsNullableNumber\(value\);\s*return number === null \? "n\/a" : `\$\{formatStatsTokens\(number\)\} tok`;/, "nullable token averages should render n/a rather than a fake zero");
assert.match(costCache, /formatStatsNullableTokens\(statsAverageTokensPerSession\(summary, payload\)\)/, "average tokens per session should stay nullable in the UI");
assert.doesNotMatch(app, /Cache hit rate|estimated savings/i, "raw command-output descriptions must not promise request-level hit rates or savings estimates");
assert.match(helpers, /statsNullableNumber\(payload\?\.sessionCount\)/, "scoped session count should fall back to the legacy session-file count");
assert.match(overview, /sessions in range[\s\S]*session files/, "overview should label scoped sessions and legacy session files deliberately");
assert.match(costCache, /requires the latest stats extension/, "missing spend comparison should be disclosed rather than faked");

// Safe collection coercion for malformed payloads.
assert.match(helpers, /function statsArray\(value\) \{\s*return Array\.isArray\(value\) \? value : \[\];/, "statsArray should coerce malformed collections to an empty list");
for (const [name, section] of [["daily", daily], ["models", models], ["sessions", sessions]]) {
  assert.match(section, /statsArray\(payload\?\./, `${name} view should coerce payload collections defensively`);
}

// Chart clamping, caps, and independent scales.
assert.match(charts, /const STATS_CHART_POINT_LIMIT = 31;/, "long charts should be capped at the latest 31 points");
assert.match(charts, /slice\(-STATS_CHART_POINT_LIMIT\)/, "chart windowing should keep the latest points");
assert.match(charts, /latest \$\{STATS_CHART_POINT_LIMIT\} of \$\{total\}/, "the point cap should be disclosed");
assert.match(charts, /Math\.min\(100, Math\.max\(statsNumber\(row\.total\) > 0 \? 1\.5 : 0, \(statsNumber\(row\.total\) \/ maxTokens\) \* 100\)\)/, "token bars should be clamped without drawing a false non-zero sliver");
assert.match(charts, /Math\.min\(100, Math\.max\(statsNumber\(row\.cost\) > 0 \? 1\.5 : 0, \(statsNumber\(row\.cost\) \/ maxCost\) \* 100\)\)/, "cost bars should be clamped on their own scale while keeping non-zero spend visible");
assert.match(charts, /Daily tab lists every recorded day/, "truncated charts should direct users to the actual full-data view");
assert.match(charts, /statsChartWindowNote\(windowed, "active days"\)/, "daily usage chart should disclose that its cap counts active days");
assert.match(charts, /token and cost bars use independent scales/, "the independent token/cost scales should be disclosed in the legend");
assert.match(charts, /Math\.min\(100, Math\.max\(row\.cost > 0 \? 3 : 0, \(row\.cost \/ maxCost\) \* 100\)\)/, "spend bars should clamp heights and keep non-zero spend visible");
assert.match(charts, /Math\.min\(100, Math\.max\(0, \(segment\.value \/ total\) \* 100\)\)/, "composition segments should clamp widths");
assert.match(charts, /total <= 0/, "zero-usage composition and spend data should short-circuit safely");
assert.match(charts, /aria-label[\s\S]*Total \$\{formatStatsCost\(total\)\}; peak/, "spend chart should expose an accessible text summary");
assert.match(charts, /Token composition: \$\{segments/, "composition should expose an accessible text summary");
assert.match(charts, /stats-overlay-chart-caption/, "charts should carry visible captions with values");

// Cost & cache replaces raw command-output blocks with structured visuals.
assert.doesNotMatch(costCache, /statsLineBlock/, "cost & cache should no longer render raw command-output blocks");
assert.match(costCache, /renderStatsSpendChart\(payload\?\.daily\)/, "cost & cache should render the daily spend chart");
assert.match(costCache, /renderStatsComposition\(totals\)/, "cost & cache should render the token/cache composition");
assert.match(costCache, /renderStatsTopDrivers\(payload\)/, "cost & cache should render ranked cost drivers");
assert.match(costCache, /blended rate, not provider list pricing/, "effective cost should be labeled as blended rather than list pricing");
assert.match(costCache, /vs prior \$\{comparison\.windowDays\}d/, "spend comparison should disclose its equal window length");

// Visual ranks for models and sessions.
assert.match(models, /renderStatsDriverList\(statsModelDriverEntries\(payload\)/, "models view should include visual spend ranks");
assert.match(sessions, /renderStatsDriverList\(statsSessionDriverEntries\(payload\)/, "sessions view should include visual spend ranks");
assert.match(helpers + charts, /statsCostShareOf[\s\S]*total > 0 \? \(statsNumber\(cost\) \/ total\) \* 100 : null/, "driver shares should be nullable when total cost is zero");

// Prompt/context native rendering is isolated from legacy line blocks; only fallback and raw output use them.
for (const [name, section] of [["initial", promptInitial], ["snapshot", promptSnapshot], ["current", promptCurrent]]) {
  assert.doesNotMatch(section, /statsLineBlock/, `${name} native Prompt/context rendering must not render raw command lines`);
}
assert.match(promptDispatch, /initialPrompt \? renderStatsPromptInitial\(initialPrompt\) : statsPromptLegacyFallback\("Initial prompt composition", payload\?\.lines\?\.promptInjection\)/, "initial prompt should fall back only to promptInjection lines");
assert.match(promptDispatch, /snapshot \? renderStatsPromptSnapshot\(snapshot\) : statsPromptLegacyFallback\("Prompt inventory", payload\?\.lines\?\.promptDetailed\)/, "snapshot should fall back only to promptDetailed lines");
assert.match(promptDispatch, /currentContext \? renderStatsPromptCurrent\(currentContext\) : statsPromptLegacyFallback\("Current context", payload\?\.lines\?\.tokenBreakdown\)/, "current context should fall back only to tokenBreakdown lines");
assert.match(rawOutput, /\[\.\.\.\(payload\?\.lines\?\.promptInjection \|\| \[\]\), "", \.\.\.\(payload\?\.lines\?\.promptDetailed \|\| \[\]\)\]/, "Command outputs should retain raw prompt injection and detailed lines");
assert.doesNotMatch(promptUi, /innerHTML|insertAdjacentHTML/, "Prompt/context payload labels must stay on text-safe DOM construction paths");

class FakeNode {
  constructor(tagName, className = "", text = "") {
    this.tagName = tagName;
    this.className = className || "";
    this.textContent = text === undefined ? "" : String(text);
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
  }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  get lastElementChild() { return this.children.at(-1); }
}

function fakeNodesWithClass(root, className) {
  const matches = [];
  const visit = (node) => {
    if (!(node instanceof FakeNode)) return;
    if (node.className.split(/\s+/).includes(className)) matches.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return matches;
}

const promptContext = {
  console,
  make: (tagName, className, text) => new FakeNode(tagName, className, text),
  formatStatsTokens: (value) => Number(value).toLocaleString(),
  statsPromptEstimateSourceLabel: (estimate = {}) => estimate.source === "export-html" ? "export-backed" : estimate.source || "estimate",
  renderStatsCalibrationPanel: () => new FakeNode("section", "fixture-calibration"),
  statsMetricCard: (label, value, detail = "", tone = "") => {
    const card = new FakeNode("div", `stats-overlay-card ${tone}`.trim());
    card.append(new FakeNode("span", "stats-overlay-card-label", label), new FakeNode("strong", "", value));
    if (detail) card.append(new FakeNode("span", "stats-overlay-card-detail", detail));
    return card;
  },
  statsLineBlock: (lines = []) => new FakeNode("pre", "stats-overlay-lines", (Array.isArray(lines) ? lines : []).join("\n") || "No data."),
};
promptContext.statsCommandOutputSection = (_title, _command, _description, lines) => {
  const section = new FakeNode("section", "fixture-command-output");
  section.append(promptContext.statsLineBlock(lines));
  return section;
};
vm.runInNewContext(`${promptUi}\n;globalThis.promptTestApi = { normalizeStatsPromptInitial, normalizeStatsPromptSnapshot, normalizeStatsPromptCurrent, renderStatsPrompt, renderStatsRaw };`, promptContext);

const hostileLabel = `<img src=x onerror="globalThis.fixturePwned=true"> & "quoted"`;
const structuredPromptPayload = {
  promptContext: {
    initialPrompt: {
      totalTokens: 100, lowTokens: 90, highTokens: 110, confidence: "fixture", source: "export-html", warning: null,
      estimateMethod: "weighted-character-estimate", components: [
        { id: "system-1", kind: "system-prompt", label: hostileLabel, chars: null, uncalibratedTokens: 100, tokens: 100, percent: 100 },
        { id: "framing-1", kind: "framing", label: "Zero", chars: 0, uncalibratedTokens: 0, tokens: 0, percent: 0 },
      ],
    },
    snapshot: {
      source: "export-html", settled: true, attempts: 0, warning: null, systemPromptChars: 0,
      estimateComponents: { promptText: 0, toolSchemas: 0, framing: 0, calibration: { multiplier: 1, samples: 0 } },
      metadata: { currentDate: null, cwdDisplay: null, extraGuidelineCount: 0 },
      tools: { totalCount: 0, omittedCount: 0, items: [] },
      toolPromptEntries: { totalCount: 0, omittedCount: 0, names: [] },
      skills: { totalCount: 0, omittedCount: 0, items: [] },
      contextFiles: { totalCount: 1, omittedCount: 0, items: [{ displayPath: "zero.md", chars: 0 }] },
    },
    currentContext: {
      usage: { tokens: 0, contextWindow: null, percent: 0 },
      breakdown: {
        estimateMethod: "weighted-character-estimate", reconstruction: "complete", estimatedTotalTokens: 0, actualMinusEstimatedTokens: 0,
        sources: [{ id: "user-1", kind: "user-messages", label: "Zero context", chars: 0, estimatedTokens: 0, percent: 0 }],
      },
    },
  },
  lines: {
    promptInjection: ["RAW_PROMPT_INJECTION <keep>& exact"],
    promptDetailed: ["RAW_PROMPT_DETAILED </pre> exact"],
    tokenBreakdown: ["RAW_CONTEXT_BREAKDOWN <raw> exact"],
  },
};

const normalizedInitial = promptContext.promptTestApi.normalizeStatsPromptInitial(structuredPromptPayload.promptContext.initialPrompt);
const normalizedSnapshot = promptContext.promptTestApi.normalizeStatsPromptSnapshot(structuredPromptPayload.promptContext.snapshot);
const normalizedCurrent = promptContext.promptTestApi.normalizeStatsPromptCurrent(structuredPromptPayload.promptContext.currentContext);
assert.equal(normalizedInitial.components[0].label, hostileLabel, "hostile-looking labels should remain literal text values");
assert.equal(normalizedInitial.components[1].tokens, 0, "real zero component tokens should survive normalization");
assert.equal(normalizedInitial.components[0].chars, null, "explicit null component chars should survive normalization");
assert.equal(normalizedSnapshot.systemPromptChars, 0, "real zero snapshot metrics should survive normalization");
assert.equal(normalizedSnapshot.metadata.currentDate, null, "explicit null metadata should survive normalization");
assert.equal(normalizedSnapshot.contextFiles.items[0].chars, 0, "real zero context-file chars should survive normalization");
assert.deepEqual({ ...normalizedCurrent.usage }, { tokens: 0, contextWindow: null, percent: 0 }, "current usage should preserve zero separately from null");
assert.equal(promptContext.promptTestApi.normalizeStatsPromptSnapshot({ ...structuredPromptPayload.promptContext.snapshot, systemPromptChars: "0" }), null, "numeric strings should reject only the malformed snapshot subsection");

const nativePrompt = promptContext.promptTestApi.renderStatsPrompt(structuredPromptPayload);
assert.equal(fakeNodesWithClass(nativePrompt, "stats-overlay-lines").length, 0, "fully valid structured Prompt/context must render no raw line blocks");
assert.equal(fakeNodesWithClass(nativePrompt, "stats-prompt-initial").length, 1);
assert.equal(fakeNodesWithClass(nativePrompt, "stats-prompt-snapshot").length, 1);
assert.equal(fakeNodesWithClass(nativePrompt, "stats-prompt-current").length, 1);

for (const [sectionName, expectedRaw] of [
  ["initialPrompt", "RAW_PROMPT_INJECTION <keep>& exact"],
  ["snapshot", "RAW_PROMPT_DETAILED </pre> exact"],
  ["currentContext", "RAW_CONTEXT_BREAKDOWN <raw> exact"],
]) {
  const payload = structuredClone(structuredPromptPayload);
  payload.promptContext[sectionName] = { malformed: true };
  const rendered = promptContext.promptTestApi.renderStatsPrompt(payload);
  const rawLines = fakeNodesWithClass(rendered, "stats-overlay-lines");
  assert.equal(rawLines.length, 1, `${sectionName} should fall back independently`);
  assert.equal(rawLines[0].textContent, expectedRaw, `${sectionName} should map to its matching legacy lines`);
}

const rawPane = promptContext.promptTestApi.renderStatsRaw(structuredPromptPayload);
const rawText = fakeNodesWithClass(rawPane, "stats-overlay-lines").map((node) => node.textContent).join("\n");
assert.match(rawText, /RAW_PROMPT_INJECTION <keep>& exact\n\nRAW_PROMPT_DETAILED <\/pre> exact/, "raw Command outputs should preserve prompt/detail content byte-for-byte");
assert.match(rawText, /RAW_CONTEXT_BREAKDOWN <raw> exact/, "raw Command outputs should preserve the current context breakdown");

// Tab/tabpanel relationships and keyboard navigation.
assert.match(overlay, /button\.id = `statsOverlayTab-\$\{tab\.id\}`;/, "tabs should have stable ids");
assert.match(overlay, /setAttribute\("aria-controls", "statsOverlayBody"\)/, "tabs should control the shared tabpanel");
assert.match(overlay, /button\.tabIndex = active \? 0 : -1;/, "tabs should use a roving tabindex");
assert.match(overlay, /button\.addEventListener\("click", \(\) => activateStatsOverlayTab\(tab\.id, \{ focus: true \}\)\)/, "click and keyboard activation should restore focus after the tablist rerenders");
assert.match(overlay, /setAttribute\("aria-labelledby", `statsOverlayTab-\$\{statsOverlayActiveTab\}`\)/, "tabpanel should be labelled by the active tab");
assert.match(app, /elements\.statsOverlayTabs\?\.addEventListener\("keydown"[\s\S]*ArrowRight[\s\S]*Home[\s\S]*End[\s\S]*activateStatsOverlayTab\(STATS_OVERLAY_TABS\[nextIndex\]\.id, \{ focus: true \}\)/, "tablist should support arrow/Home/End keyboard navigation with focus follow");
assert.match(html, /<div id="statsOverlayTabs" class="stats-overlay-tabs" role="tablist"/, "tablist role should remain in markup");
assert.match(html, /<div id="statsOverlayBody" class="stats-overlay-body" role="tabpanel" tabindex="0">/, "tabpanel semantics should be in markup");

// Table captions and header scopes.
assert.match(app, /if \(caption\) table\.append\(make\("caption", "stats-overlay-table-caption", caption\)\);/, "stats tables should support captions");
assert.match(app, /th\.scope = "col";/, "stats table headers should declare column scope");
assert.match(daily, /"Daily tokens and cost by UTC day"/, "daily table should have a caption");
assert.match(models, /"Model token and cost comparison"/, "models table should have a caption");
assert.match(sessions, /"Most expensive sessions in the selected range"/, "sessions table should have a caption");

// Catppuccin styles for the new visuals and responsive behavior.
for (const selector of [
  ".stats-overlay-spend-chart",
  ".stats-overlay-spend-bar",
  ".stats-overlay-composition-track",
  ".stats-overlay-composition-segment.seg-cache-read",
  ".stats-overlay-driver-row",
  ".stats-overlay-driver-bar-fill",
  ".stats-overlay-legend-swatch",
  ".stats-overlay-chart-caption",
  ".stats-overlay-bar-lane",
  ".stats-overlay-bar-fill.cost",
  ".stats-overlay-table-caption",
]) {
  assert.ok(css.includes(selector), `styles.css should define ${selector}`);
}
assert.match(css, /\.stats-overlay-bar-fill\.cost \{[^}]*var\(--ctp-green\)/s, "cost lane should use a distinct Catppuccin scale from tokens");
assert.match(css, /\.stats-overlay-spend-bar \{[^}]*var\(--ctp-green\)/s, "spend bars should use the Catppuccin palette");

const responsive = between(css, ".extension-dialog.stats-overlay-dialog {\n    inset:", ".extension-dialog.release-dialog form {");
assert.match(responsive, /\.stats-overlay-drivers \{ grid-template-columns: 1fr; \}/, "narrow screens should stack driver sections");
assert.match(responsive, /\.stats-overlay-driver-row \.stats-overlay-driver-bar \{ grid-column: 1 \/ -1; \}/, "narrow screens should wrap driver bars");
assert.match(responsive, /\.stats-overlay-spend-chart \{ height: 5\.5rem; \}/, "narrow screens should shrink the spend chart");
assert.match(responsive, /\.stats-prompt-inventory \{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}/, "narrow screens should stack Prompt/context inventory groups");
assert.match(responsive, /\.stats-prompt-table,[\s\S]*\.stats-prompt-table td \{\s*display: block;\s*width: 100%;\s*\}/, "narrow Prompt/context tables should become row cards rather than nested scrollers");
assert.match(responsive, /\.stats-prompt-table td::before \{\s*content: attr\(data-label\);/, "responsive Prompt/context row cards should retain visible column labels");
assert.match(css, /\.stats-prompt-table-wrap \{\s*overflow: visible;\s*\}/, "Prompt/context tables should not create a nested horizontal scroller");
assert.match(css, /\.stats-prompt-file-list li span:first-child \{[^}]*white-space: normal;/s, "long context paths should wrap");

// No chart dependency, canvas, or remote asset introduced by the stats section.
assert.doesNotMatch(statsUi, /canvas|new Image\(|https?:\/\//i, "stats visuals must stay dependency-free DOM/CSS");
assert.match(css, /\.stats-overlay-card\.tone-sky/, "tone-sky card style should exist for the overview effective-cost card");

console.log("stats-dashboard-static: all assertions passed");
