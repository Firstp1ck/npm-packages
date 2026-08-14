import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
assert.match(html, /id="piComponentUpdateStatus"[^>]*aria-live="polite"/);
assert.match(html, /id="webuiComponentUpdateStatus"[^>]*aria-live="polite"/);
for (const state of ["available", "running", "succeeded", "failed"]) assert.match(css, new RegExp(`data-update-state="${state}"`));
assert.match(app, /api\("\/api\/update\/plan", \{ method: "POST", body: \{ targets: \[target\] \}/);
assert.match(app, /Exact plan digest: \$\{plan\.digest\}/);
assert.match(app, /api\("\/api\/update\/apply", \{ method: "POST", body: \{ transactionId: plan\.transactionId, planDigest: plan\.digest \}/);
assert.match(app, /function piUpdateConfirmationText\(\{ all = false, plan = null \} = \{\}\)[\s\S]*Exact immutable plan digest/);
assert.match(app, /const planTargets = Array\.isArray\(plan\?\.targets\)[\s\S]*planTargets\.length === 0[\s\S]*No update targets were accepted/);
assert.match(app, /applyData\?\.state !== "activating"[\s\S]*completed without a Web UI restart[\s\S]*did not complete; no Web UI restart was requested/);
assert.match(html, /id="serverRestartPanel"[\s\S]*server-restart-spinner[\s\S]*id="serverRestartKicker"[\s\S]*id="serverRestartTitle"/);
assert.match(app, /function setServerRestartOverlay\(active[\s\S]*phase = "restarting"[\s\S]*phase === "updating"[\s\S]*Applying exact update/);
assert.match(app, /async function startComponentUpdate\(target\)[\s\S]*setServerRestartOverlay\(true, `Starting exact \$\{label\} update…`, \{ phase: "updating" \}\)[\s\S]*setServerRestartOverlay\(false\)/);
assert.match(app, /async function runPiUpdateAndRestart[\s\S]*setServerRestartOverlay\(true, progressMessage, \{ phase: "updating" \}\)/);
assert.match(app, /will not re-resolve latest or scan package roots/);
assert.match(app, /function separatePathPiPlanNotice\(plan\)[\s\S]*PATH Pi[\s\S]*separate installation[\s\S]*will remain untouched/);
assert.match(app, /async function waitForServerRestart\(previousBootIdentity = serverBootIdentity\)[\s\S]*Date\.now\(\) \+ 90_000[\s\S]*health\.bootIdentity === previousBootIdentity/);
assert.match(server, /bootIdentity,[\s\S]*startupPhase:/);
assert.match(server, /url\.pathname === "\/api\/update\/rollback"[\s\S]*assertUpdatePlanDigest/);
assert.match(readme, /exact-target plan|plan digest/i);
console.log("control deck component update static tests passed");
