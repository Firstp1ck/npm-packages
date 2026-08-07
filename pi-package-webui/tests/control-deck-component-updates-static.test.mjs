import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [html, css, app, server, readme] = await Promise.all([
  readFile(join(root, "public", "index.html"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "bin", "pi-webui.mjs"), "utf8"),
  readFile(join(root, "README.md"), "utf8"),
]);

function functionSource(name, nextName) {
  const start = app.indexOf(`function ${name}(`);
  const end = app.indexOf(`\nfunction ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} should remain a standalone frontend helper`);
  return app.slice(start, end);
}

const piDialog = html.match(/<dialog id="piReleaseNotesDialog"[\s\S]*?<\/dialog>/)?.[0] || "";
assert.match(piDialog, /aria-labelledby="piReleaseNotesTitle"/, "the Pi version tag should keep its accessible release-notes dialog");
assert.match(piDialog, /id="piComponentUpdateStatus"[^>]*role="status"[^>]*aria-live="polite"/, "the Pi dialog should announce component update state");
assert.match(piDialog, /id="piComponentUpdateButton"[^>]*>Update Pi<\/button>/, "the Pi dialog should expose a targeted update action");

const webuiDialog = html.match(/<dialog id="webuiPackageDialog"[\s\S]*?<\/dialog>/)?.[0] || "";
assert.match(html, /id="webuiVersionButton"[^>]*aria-haspopup="dialog"[^>]*aria-controls="webuiPackageDialog"/, "the Web UI version tag should control its dedicated package dialog");
assert.match(webuiDialog, /aria-labelledby="webuiPackageTitle"/, "the Web UI package dialog should have an accessible title");
assert.match(webuiDialog, /<dt>Installed<\/dt>[\s\S]*id="webuiPackageCurrentVersion"[\s\S]*<dt>Latest on npm<\/dt>[\s\S]*id="webuiPackageLatestVersion"/, "the Web UI dialog should show installed and latest versions");
assert.match(webuiDialog, /id="webuiPackageNpmButton"[^>]*>View on npm<\/button>/, "the Web UI dialog should retain the npm package action");
assert.match(webuiDialog, /id="webuiComponentUpdateStatus"[^>]*role="status"[^>]*aria-live="polite"/, "the Web UI dialog should announce component update state");
assert.match(webuiDialog, /id="webuiComponentUpdateButton"[^>]*>Update Web UI<\/button>/, "the Web UI dialog should expose a targeted update action");
assert.match(app, /webuiPackageNpmButton\?\.addEventListener\("click", \(\) => \{[\s\S]*confirmOpenWebuiNpmPage\(\)/, "the package dialog npm action should reuse the guarded external-link flow");

for (const state of ["available", "running", "succeeded", "failed"]) {
  assert.match(css, new RegExp(`\\.pi-version-button\\[data-update-state="${state}"\\]::after[\\s\\S]*\\.webui-version-button\\[data-update-state="${state}"\\]::after`), `both component tags should render the ${state} indicator`);
}
assert.match(css, /prefers-reduced-motion: reduce[\s\S]*data-update-state="running"/, "the running indicator should respect reduced-motion preferences");

const renderPiVersionButtonSource = functionSource("renderPiVersionButton", "renderWebuiVersionButton");
const renderWebuiVersionButtonSource = functionSource("renderWebuiVersionButton", "renderWebuiDevBadge");
assert.match(renderPiVersionButtonSource, /componentUpdateTagState\("pi"\)[\s\S]*setAttribute\("aria-label", stateText/, "the Pi tag should use Pi-only state in its accessible name");
assert.match(renderWebuiVersionButtonSource, /componentUpdateTagState\("webui"\)[\s\S]*setAttribute\("aria-label", stateText/, "the Web UI tag should use Web-UI-only state in its accessible name");

const componentBlockStart = app.indexOf('const COMPONENT_UPDATE_TARGETS = ["pi", "webui"];');
const componentBlockEnd = app.indexOf("\nfunction initializeUpdateNotifications()", componentBlockStart);
assert.ok(componentBlockStart >= 0 && componentBlockEnd > componentBlockStart, "component update helpers should remain a focused frontend block");
const componentBlock = app.slice(componentBlockStart, componentBlockEnd);

const calls = [];
const events = [];
const scheduled = [];
const cleared = [];
const makeButton = () => ({
  hidden: false,
  textContent: "",
  title: "",
  disabled: false,
  dataset: {},
  attributes: {},
  setAttribute(name, value) { this.attributes[name] = value; },
});
const makeStatus = () => ({ textContent: "", hidden: false, dataset: {} });
const elements = {
  piVersionButton: makeButton(),
  webuiVersionButton: makeButton(),
  piComponentUpdateStatus: makeStatus(),
  piComponentUpdateButton: makeButton(),
  webuiComponentUpdateStatus: makeStatus(),
  webuiComponentUpdateButton: makeButton(),
  webuiPackageCurrentVersion: makeStatus(),
  webuiPackageLatestVersion: makeStatus(),
  webuiPackageDialog: { open: false, showModal() { this.open = true; } },
};
let nextTimer = 1;
let refreshShouldFail = false;
const context = {
  elements,
  console,
  setTimeout(callback, delay) {
    const id = nextTimer++;
    scheduled.push({ id, callback, delay });
    return id;
  },
  clearTimeout(id) { cleared.push(id); },
  formatWebuiVersion(value) {
    const text = String(value || "").trim();
    return text ? (text.startsWith("v") ? text : `v${text}`) : "";
  },
  packageUpdateText(label, status = {}) {
    return `${label} ${status.currentVersion || ""} → ${status.latestVersion || ""}`.trim();
  },
  appConfirmText: async (_message, options) => {
    calls.push({ kind: "confirm", options });
    return true;
  },
  api: async (path, options) => {
    calls.push({ kind: "api", path, options });
    return { data: { target: options.body.target, state: "running", canStart: false, message: "Update is running." } };
  },
  addEvent(message, level) { events.push({ message, level }); },
  refreshUpdateStatus: async () => {
    if (refreshShouldFail) throw new Error("temporary status failure");
    return null;
  },
};
vm.runInNewContext(`
let latestUpdateStatus = null;
let piVersion = "0.83.0";
let webuiVersion = "0.8.1";
let componentUpdatePollTimer = null;
let componentUpdateStartInProgress = false;
let updateRequestInProgress = false;
const COMPONENT_UPDATE_POLL_MS = 1000;
${renderPiVersionButtonSource}
${renderWebuiVersionButtonSource}
${componentBlock}
globalThis.componentHarness = {
  setStatus(value) { latestUpdateStatus = value; },
  getStatus() { return latestUpdateStatus; },
  tagState: componentUpdateTagState,
  statusText: componentUpdateStatusText,
  buttonState: componentUpdateButtonState,
  renderIndicators: renderComponentUpdateIndicators,
  renderDialogs: renderComponentUpdateDialogs,
  syncPolling: syncComponentUpdatePolling,
  pollTimer() { return componentUpdatePollTimer; },
  start: startComponentUpdate,
};
`, context);
const harness = context.componentHarness;

harness.setStatus({
  updateInProgress: false,
  pi: { currentVersion: "0.83.0", latestVersion: "0.84.0", updateAvailable: true },
  webui: { currentVersion: "0.8.1", latestVersion: "0.8.1", updateAvailable: false, checked: true },
  componentUpdates: {
    pi: { target: "pi", state: "idle", canStart: true },
    webui: { target: "webui", state: "idle", canStart: true },
  },
});
harness.renderIndicators();
assert.equal(elements.piVersionButton.dataset.updateState, "available", "Pi availability should mark only the Pi tag");
assert.equal(elements.piVersionButton.attributes["aria-label"], "View Pi v0.83.0 release notes, update available", "Pi availability should be present in the accessible name");
assert.equal(elements.webuiVersionButton.dataset.updateState, undefined, "Pi availability should not mark the Web UI tag");
assert.doesNotMatch(elements.webuiVersionButton.attributes["aria-label"], /update available/, "Pi availability should not leak into the Web UI accessible name");

harness.setStatus({
  updateInProgress: false,
  pi: { updateAvailable: true },
  webui: { updateAvailable: true },
  componentUpdates: {
    pi: { state: "succeeded", canStart: true, message: "Pi update completed." },
    webui: { state: "failed", canStart: true, message: "Web UI update failed.", error: "bounded failure" },
  },
});
assert.equal(harness.tagState("pi"), "succeeded", "terminal Pi success should outrank stale availability");
assert.equal(harness.tagState("webui"), "failed", "terminal Web UI failure should outrank stale availability");
assert.match(harness.statusText("pi").text, /New or reloaded Pi sessions use the update; already-running tabs keep their current runtime/, "Pi success should explain activation without interrupting active tabs");
assert.match(harness.statusText("webui").text, /bounded failure[\s\S]*retry the update/, "Web UI failure should remain visible and permit retry");
assert.equal(harness.buttonState("webui").label, "Retry Web UI update", "a failed Web UI update should expose retry");
assert.equal(harness.buttonState("webui").disabled, false, "retry should be enabled when no update is running");

harness.setStatus({
  updateInProgress: false,
  webui: { currentVersion: "0.8.1", latestVersion: "0.8.2", updateAvailable: true },
  componentUpdates: {
    pi: { state: "idle", canStart: true },
    webui: { state: "idle", canStart: false, unavailableReason: "Automatic Web UI update is unavailable from a source or development checkout." },
  },
});
assert.equal(harness.buttonState("webui").disabled, true, "source/development Web UI self-update should be disabled");
assert.match(harness.statusText("webui").text, /source or development checkout/, "source/development refusal should be explained in the live status");

harness.setStatus({
  updateInProgress: true,
  pi: { updateAvailable: true },
  webui: { updateAvailable: true },
  componentUpdates: {
    pi: { state: "running", canStart: false, message: "Updating Pi…" },
    webui: { state: "idle", canStart: false },
  },
});
assert.equal(harness.buttonState("pi").disabled, true, "the running target should reject duplicate starts");
assert.equal(harness.buttonState("webui").disabled, true, "a running Pi update should disable the conflicting Web UI start");
harness.syncPolling();
assert.equal(scheduled.length, 1, "a running update should create one short polling timer");
assert.equal(scheduled[0].delay, 1000, "running status should poll at the bounded one-second interval");
harness.syncPolling();
assert.equal(scheduled.length, 1, "re-rendering while running should not create duplicate poll timers");
refreshShouldFail = true;
scheduled[0].callback();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(scheduled.length, 2, "a transient status failure should re-arm polling while the last known job remains running");
assert.match(events.at(-1)?.message || "", /status check failed/i, "a transient polling failure should remain visible in the event log");
refreshShouldFail = false;
const rearmedTimer = harness.pollTimer();
harness.setStatus({
  updateInProgress: false,
  componentUpdates: {
    pi: { state: "succeeded", canStart: true },
    webui: { state: "idle", canStart: true },
  },
});
harness.syncPolling();
assert.deepEqual(cleared, [rearmedTimer], "terminal state should clear the re-armed running poll");
assert.equal(harness.pollTimer(), null, "terminal state should release the polling timer reference");

calls.length = 0;
harness.setStatus({
  updateInProgress: false,
  pi: { currentVersion: "0.83.0", latestVersion: "0.84.0", updateAvailable: true },
  webui: { updateAvailable: false },
  componentUpdates: {
    pi: { state: "idle", canStart: true },
    webui: { state: "idle", canStart: true },
  },
});
await harness.start("pi");
const piStartCall = calls.find((call) => call.kind === "api");
assert.equal(piStartCall?.path, "/api/component-update", "the Pi dialog should use the component-update endpoint");
assert.equal(piStartCall?.options.method, "POST", "component update starts should use POST");
assert.equal(piStartCall?.options.scoped, false, "component update starts should not inherit a Pi tab scope");
assert.equal(JSON.stringify(piStartCall?.options.body), '{"target":"pi"}', "the Pi dialog should send only the exact Pi target");
assert.equal(harness.getStatus().componentUpdates.pi.state, "running", "the accepted 202-shaped state should render immediately as running");
assert.equal(harness.buttonState("pi").disabled, true, "the accepted job should immediately disable duplicate starts");
assert.match(componentBlock, /statusElement\.hidden = false;[\s\S]*statusElement\.textContent = text;/, "component live regions should remain rendered before their status text changes");
assert.match(app, /openPiReleaseNotes\(\)[\s\S]*latestUpdateStatus\?\.pi\?\.updateAvailable[\s\S]*latestUpdateStatus\.pi\.latestVersion[\s\S]*refreshUpdateStatus\(\{ notify: false \}\)/, "opening Pi details should prefer the advertised update version while refreshing component status");
assert.match(app, /async function refreshUpdateStatus[\s\S]*latestUpdateStatus\?\.pi\?\.currentVersion[\s\S]*setPiVersion\(latestUpdateStatus\.pi\.currentVersion\)/, "refreshed update status should replace stale startup Pi version labels");
assert.match(server, /async function piReleaseNotes\(\)[\s\S]*updateStatusCache\.pi[\s\S]*checkLatestPiReleaseStatus\(\)[\s\S]*piStatus\?\.currentVersion[\s\S]*piStatus\?\.updateAvailable[\s\S]*latestVersion/, "the release-notes endpoint should use the detected runtime version, select a valid available Pi version, and otherwise fall back to the installed release");

assert.match(
  server,
  /url\.pathname === "\/api\/component-update" && req\.method === "POST"[\s\S]*requireLocalhostRoute\(req, url\.pathname\)[\s\S]*validateComponentUpdateRequest\(body\)[\s\S]*sendJson\(res, 202/,
  "the server should keep exact validation, localhost restriction, and 202 acceptance for component starts",
);
assert.match(
  app,
  /async function runPiUpdateAndRestart\([\s\S]*api\(all \? "\/api\/update\?all=1" : "\/api\/update", \{ method: "POST", scoped: false \}\)[\s\S]*waitForServerRestart\(\)/,
  "the legacy browser update-and-restart flow should remain compatible",
);
assert.match(
  server,
  /url\.pathname === "\/api\/update" && req\.method === "POST"[\s\S]*runPiUpdateAndPrepareRestart\(\{ all: queryAll \|\| bodyAll \}\)[\s\S]*sendJson\(res, 200[\s\S]*shutdown\("api update", \{ preserveSessions: true \}\)/,
  "the legacy server route should retain update-all selection, completion response, restart, and managed-session preservation",
);
assert.match(readme, /Control Deck component updates[\s\S]*component-specific `available`, `running`, `succeeded`, or `failed` status/, "README should explain the component-specific tag indicators");
assert.match(readme, /Update Pi[\s\S]*does not restart the Web UI or interrupt managed Pi tabs[\s\S]*Update Web UI[\s\S]*restart the Web UI after success/, "README should explain Pi and Web UI activation behavior");
assert.match(readme, /only from localhost[\s\S]*disabled for source\/development checkouts[\s\S]*verify the installed version before retrying[\s\S]*broader legacy behavior/, "README should document security, source refusal, recovery, and legacy compatibility");

console.log("control deck component update static tests passed");
