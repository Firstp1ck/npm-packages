import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [app, gitFooterExtension] = await Promise.all([
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "..", "pi-extension-git-footer-status", "index.ts"), "utf8"),
]);
const readFunction = (name) => app.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))?.[0] || "";

test("PI footer metric always exposes the calibration click action", () => {
  const applyOptions = readFunction("applyGitFooterPiCalibrationOptions");
  assert.match(applyOptions, /if \(chip\?\.key !== "pi"\) return "";/);
  assert.doesNotMatch(applyOptions, /chip\?\.action|FOOTER_PAYLOAD_ACTIONS/);
  assert.match(applyOptions, /void runGitFooterPiCalibration\(\)/);
  assert.match(applyOptions, /ariaBusy/);
});

test("PI footer click dispatches exactly /calibrate in the background", () => {
  const runCalibration = readFunction("runGitFooterPiCalibration");
  assert.match(runCalibration, /resolveAvailableCommandName\("calibrate", \{ rpcOnly: true \}\)/);
  assert.match(runCalibration, /await sendPrompt\("prompt", `\/\$\{commandName\}`, \{ targetTabId: tabContext\.tabId, throwOnError: true \}\)/);
  assert.doesNotMatch(runCalibration, /commandName\} current|appConfirmText/);
  assert.match(runCalibration, /gitFooterPiCalibrationInFlightByTab\.has\(tabContext\.tabId\)/);
  assert.match(runCalibration, /currentState\?\.isStreaming \|\| currentState\?\.isCompacting/);
});

test("PI calibration schedules bounded delayed footer refreshes", () => {
  const scheduleRefresh = readFunction("scheduleGitFooterPiCalibrationRefresh");
  const runCalibration = readFunction("runGitFooterPiCalibration");
  assert.match(scheduleRefresh, /delays = \[5000, 14000, 30000\]/);
  assert.match(scheduleRefresh, /requestGitFooterWebuiPayload\(tabContext, \{ force: true \}\)/);
  assert.match(runCalibration, /scheduleGitFooterPiCalibrationRefresh\(tabContext\)/);
});

test("PI calibration busy state invalidates the footer render cache key", () => {
  const pickerStateKey = readFunction("gitFooterPickerStateKey");
  assert.match(pickerStateKey, /gitFooterPiCalibrationInFlightByTab\.has\(tabContext\.tabId\)/);
  assert.match(pickerStateKey, /piCalibrationInFlight \? 1 : 0/);
});

test("PI refresh scheduling survives an immediate tab switch", () => {
  const runCalibration = readFunction("runGitFooterPiCalibration");
  assert.match(runCalibration, /scheduleGitFooterPiCalibrationRefresh\(tabContext\);\s+if \(!isCurrentTabContext\(tabContext\)\) return;/);
});

test("explicit git-footer refresh invalidates stale calibration records", () => {
  assert.match(
    gitFooterExtension,
    /pi\.registerCommand\("git-footer-refresh"[\s\S]*promptCalibrationCache = null;\s+await refreshPromptInjectionEstimate\(ctx\)/,
  );
});
