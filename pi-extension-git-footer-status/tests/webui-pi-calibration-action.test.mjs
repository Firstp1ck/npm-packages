import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(join(root, "index.ts"), "utf8");

test("the WebUI PI chip always advertises the isolated /calibrate action when enabled", () => {
  const start = source.indexOf("function buildWebuiFooterPayload(");
  const end = source.indexOf("\nexport default function gitFooterStatus(", start);
  assert.ok(start >= 0 && end > start, "buildWebuiFooterPayload should remain inspectable");
  const buildPayload = source.slice(start, end);
  assert.match(
    buildPayload,
    /const piAction: WebuiFooterChip\["action"\] \| undefined = webuiFooterItemVisible\("webui-pi-calibration"\)\s*\? "calibrate-probe"\s*: undefined;/,
  );
  assert.doesNotMatch(buildPayload, /piIsUncalibrated|promptInjectionCanCalibrateCurrent|calibrate-current/);
  assert.match(buildPayload, /Click to run \/calibrate in an isolated background probe and refresh this value when it finishes\./);
  assert.match(buildPayload, /key: "pi"[\s\S]*action: piAction/);
});

test("git-footer-refresh bypasses cached calibration records before republishing", () => {
  assert.match(
    source,
    /pi\.registerCommand\("git-footer-refresh"[\s\S]*rememberFooterContext\(ctx\);[\s\S]*promptCalibrationCache = null;[\s\S]*await refreshPromptInjectionEstimate\(ctx\);/,
  );
});
