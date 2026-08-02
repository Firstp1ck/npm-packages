import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = await readFile(join(packageRoot, "bin", "pi-webui.mjs"), "utf8");

assert.match(
  server,
  /function updateStatusForRequest\(status, req\)[\s\S]*updateInProgress: privilegedUpdateInProgress\(\)[\s\S]*componentUpdates: componentUpdatesForRequest\(req\)/,
  "update status should preserve top-level single-flight state and add per-component public state",
);
assert.match(
  server,
  /url\.pathname === "\/api\/component-update" && req\.method === "POST"[\s\S]*requireLocalhostRoute\(req, url\.pathname\)[\s\S]*readJsonBody\(req\)[\s\S]*validateComponentUpdateRequest\(body\)[\s\S]*startComponentUpdate\(validation\.target\)[\s\S]*sendJson\(res, 202/,
  "component update starts should be localhost-only, validated, asynchronous 202 responses",
);
assert.match(
  server,
  /function startComponentUpdate\(target\)[\s\S]*piUpdateInProgress \|\| componentUpdateState\.hasRunning\(\)[\s\S]*componentUpdateState\.begin\(target\)[\s\S]*setImmediate\(\(\) => \{ void runComponentUpdate\(target\); \}\)/,
  "component starts should reserve shared single-flight state before scheduling background execution",
);
assert.match(
  server,
  /async function runPiUpdateAndPrepareRestart[\s\S]*if \(componentUpdateState\.hasRunning\(\)\) throw makeHttpError\(409/,
  "legacy updates should conflict with running component jobs",
);
assert.match(
  server,
  /async function resolveComponentUpdateTasks\(target\)[\s\S]*target === "pi"[\s\S]*resolvePiUpdateCommands\(\{ all: false \}\)[\s\S]*target === "webui"[\s\S]*currentWebuiComponentUpdateTask/,
  "component resolution should keep Pi-only and WebUI-only paths separate",
);
assert.match(
  server,
  /async function currentWebuiComponentUpdateTask\(npmRuntime = \{\}\)[\s\S]*webuiComponentUpdateUnavailableReason\(\)[\s\S]*global Bun Web UI package[\s\S]*`\$\{WEBUI_PACKAGE\}@latest`[\s\S]*npmPrefixUpdateTask\("current Web UI package", installRoot, \[WEBUI_PACKAGE\], npmRuntime\)/,
  "Web UI updates should refuse source mode and update only the Web UI package in supported Bun/npm topologies",
);
assert.match(
  server,
  /function webuiComponentUpdateUnavailableReason\(\)[\s\S]*webuiDevServer \|\| !String\(packageRoot\).*includes\("node_modules"\)[\s\S]*source or development checkout/,
  "source and development checkouts should fail closed",
);
assert.match(
  server,
  /target === "webui"[\s\S]*let npmRuntime = \{\}[\s\S]*resolvePiUpdateCommands\(\{ all: false \}\)[\s\S]*preferredDirectories:[\s\S]*piInstallDirectory[\s\S]*catch[\s\S]*webui_component_update_npm_resolution_fallback[\s\S]*currentWebuiComponentUpdateTask\(npmRuntime\)/,
  "the Web UI updater should prefer npm from the selected Pi installation and fall back when Pi resolution is unavailable",
);
assert.match(
  server,
  /url\.pathname === "\/api\/update" && req\.method === "POST"[\s\S]*runPiUpdateAndPrepareRestart\(\{ all: queryAll \|\| bodyAll \}\)[\s\S]*sendJson\(res, 200[\s\S]*shutdown\("api update", \{ preserveSessions: true \}\)/,
  "the legacy update route should retain update-all selection, 200 completion, restart, and session preservation",
);
const targetedWebuiUpdater = server.match(/async function currentWebuiComponentUpdateTask\([^)]*\)[\s\S]*?\n}\n\nasync function resolveComponentUpdateTasks/)?.[0];
assert.ok(targetedWebuiUpdater, "the targeted Web UI updater source should be inspectable");
assert.doesNotMatch(
  targetedWebuiUpdater,
  /UPDATE_PACKAGE_NAMES|packagesPresentInInstallPrefix|optionalFeature|projectPackageRoot/,
  "the targeted Web UI updater must not broaden into package-root or optional package updates",
);
assert.match(
  server,
  /catch \(error\) \{\n\s*updateStatusCache = null;\n\s*updateStatusCacheAt = 0;\n\s*componentUpdateState\.fail/,
  "failed component updates should invalidate cached package status before publishing terminal state",
);

console.log("component update API static tests passed");
