import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateUpdateApplyRequest, validateUpdatePlanRequest } from "../lib/component-update-state.mjs";
import { exactNpmInstallArgs, exactPackageSpec, updatePlanConfirmationText } from "../lib/update-commands.mjs";

assert.deepEqual(validateUpdatePlanRequest({ targets: ["pi", "webui"] }), { ok: true, targets: ["pi", "webui"] });
for (const invalid of [{}, { targets: [] }, { targets: ["all"] }, { targets: ["pi", "pi"] }, { targets: ["pi"], registry: "https://evil.test" }]) {
  assert.equal(validateUpdatePlanRequest(invalid).ok, false);
}
const digest = "a".repeat(64);
assert.deepEqual(validateUpdateApplyRequest({ transactionId: "tx-1", planDigest: digest }), { ok: true, transactionId: "tx-1", planDigest: digest });
for (const invalid of [{ transactionId: "tx-1" }, { transactionId: "../x", planDigest: digest }, { transactionId: "tx", planDigest: digest, command: "npm" }]) {
  assert.equal(validateUpdateApplyRequest(invalid).ok, false);
}
assert.equal(exactPackageSpec("@firstpick/pi-package-webui", "1.2.3"), "@firstpick/pi-package-webui@1.2.3");
assert.throws(() => exactPackageSpec("pkg", "latest"), /exact version/);
const installArgs = exactNpmInstallArgs({ installRoot: "/private/runtime", packageName: "pkg", version: "1.2.3", registry: "https://registry.example.test" });
assert.deepEqual(installArgs.slice(-3), ["--registry", "https://registry.example.test/", "pkg@1.2.3"]);
assert.doesNotMatch(installArgs.join(" "), /--all|--extensions|@latest/);
assert.match(updatePlanConfirmationText({ transactionId: "tx", digest, targets: [{ id: "webui", currentVersion: "1.0.0", targetVersion: "1.1.0" }], refusals: [] }), new RegExp(digest));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = await readFile(path.join(root, "bin", "pi-webui.mjs"), "utf8");
assert.match(server, /\/api\/update\/plan[\s\S]*validateUpdatePlanRequest[\s\S]*createServerOwnedUpdatePlan/);
assert.match(server, /\/api\/update\/apply[\s\S]*validateUpdateApplyRequest[\s\S]*applyServerOwnedUpdate/);
assert.match(server, /Legacy update mutation is disabled/);
assert.match(server, /assertUpdatePlanDigest\(journal\.plan, planDigest\)/);
assert.match(server, /acquireInstallLock\(agentDir\)[\s\S]*assertPlanIdentity/);
assert.match(server, /bootIdentity/);
assert.doesNotMatch(server, /function resolveUpdateTasks|function projectPackageRootUpdateTasks|function npmGlobalPackageRootUpdateTask|function bunGlobalPackageRootUpdateTask/);

async function freePort() {
  const listener = createNetServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}
const registryPort = await freePort();
const webuiPort = await freePort();
const registry = createHttpServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(req.url === "/pi-latest" ? { version: "9.9.9" } : { version: "9.9.9" }));
});
await new Promise((resolve) => registry.listen(registryPort, "127.0.0.1", resolve));
const temp = await mkdtemp(path.join(tmpdir(), "pi-webui-update-api-"));
const fakePi = path.join(temp, "fake-pi-with-version.mjs");
await writeFile(fakePi, `if (process.argv.includes("--version")) { console.log("0.84.0"); process.exit(0); } await import(${JSON.stringify(pathToFileURL(path.join(root, "tests", "fixtures", "fake-pi.mjs")).href)});\n`, "utf8");
const child = spawn(process.execPath, [path.join(root, "bin", "pi-webui.mjs"), "--cwd", temp, "--host", "127.0.0.1", "--port", String(webuiPort), "--pi", fakePi], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PI_WEBUI_RPC_SUPERVISOR: "0",
    PI_CODING_AGENT_DIR: path.join(temp, "agent"),
    PI_WEBUI_SETTINGS_FILE: path.join(temp, "settings.json"),
    PI_WEBUI_PI_LATEST_VERSION_URL: `http://127.0.0.1:${registryPort}/pi-latest`,
    PI_WEBUI_NPM_REGISTRY_URL: `http://127.0.0.1:${registryPort}`,
  },
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
try {
  let health;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${webuiPort}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { health = await response.json(); break; }
    } catch {}
    await delay(100);
  }
  assert.ok(health?.bootIdentity, output);
  const planResponse = await fetch(`http://127.0.0.1:${webuiPort}/api/update/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targets: ["pi", "webui"] }) });
  const planPayload = await planResponse.json();
  assert.equal(planResponse.status, 201, JSON.stringify(planPayload));
  const plan = planPayload.data.plan;
  assert.equal(plan.targets.length, 1, "the exact explicit Pi executable should own its delegated update while source WebUI remains refused");
  assert.equal(plan.targets[0].id, "pi");
  assert.equal(plan.targets[0].strategy, "delegate-exact-pi");
  assert.deepEqual(plan.targets[0].command.args.slice(-2), ["update", "--self"]);
  assert.doesNotMatch(plan.targets[0].command.args.join(" "), /@latest/);
  assert.deepEqual(plan.refusals.map((item) => item.id), ["webui"]);

  const sourcePlanResponse = await fetch(`http://127.0.0.1:${webuiPort}/api/update/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targets: ["webui"] }) });
  const sourcePlanPayload = await sourcePlanResponse.json();
  assert.equal(sourcePlanResponse.status, 201, JSON.stringify(sourcePlanPayload));
  const sourcePlan = sourcePlanPayload.data.plan;
  assert.equal(sourcePlan.targets.length, 0);
  assert.deepEqual(sourcePlan.refusals.map((item) => item.id), ["webui"]);
  const tampered = await fetch(`http://127.0.0.1:${webuiPort}/api/update/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionId: sourcePlan.transactionId, planDigest: "0".repeat(64) }) });
  assert.equal(tampered.status, 500);
  const apply = await fetch(`http://127.0.0.1:${webuiPort}/api/update/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionId: sourcePlan.transactionId, planDigest: sourcePlan.digest }) });
  const applyPayload = await apply.json();
  assert.equal(apply.status, 200, JSON.stringify(applyPayload));
  assert.equal(applyPayload.data.outcome, "failed");
  const legacy = await fetch(`http://127.0.0.1:${webuiPort}/api/update`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(legacy.status, 410);
} finally {
  child.kill("SIGTERM");
  if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
  await new Promise((resolve) => registry.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
console.log("update API harness passed");
