import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [server, state, launcher, activation, trust] = await Promise.all([
  readFile(join(root, "bin", "pi-webui.mjs"), "utf8"),
  readFile(join(root, "lib", "component-update-state.mjs"), "utf8"),
  readFile(join(root, "bin", "pi-webui-launcher.mjs"), "utf8"),
  readFile(join(root, "bin", "pi-webui-update-supervisor.mjs"), "utf8"),
  readFile(join(root, "lib", "trust-boundaries.mjs"), "utf8"),
]);
assert.match(state, /validateUpdatePlanRequest[\s\S]*targets must contain one or both exact values/);
assert.match(state, /validateUpdateApplyRequest[\s\S]*Apply accepts only transactionId and planDigest/);
assert.match(server, /url\.pathname === "\/api\/update\/plan"[\s\S]*requireLocalhostRoute[\s\S]*validateUpdatePlanRequest[\s\S]*sendJson\(res, 201/);
assert.match(server, /url\.pathname === "\/api\/update\/apply"[\s\S]*requireLocalhostRoute[\s\S]*validateUpdateApplyRequest[\s\S]*applyServerOwnedUpdate/);
assert.match(server, /assertActionableUpdatePlan\(plan\)[\s\S]*createUpdateJournal\(agentDir, plan\)/);
assert.match(server, /assertUpdatePlanDigest\(journal\.plan, planDigest\)[\s\S]*assertActionableUpdatePlan\(journal\.plan\)[\s\S]*acquireInstallLock\(agentDir\)/);
assert.match(server, /assertPlanIdentity\(target, active\)/);
assert.match(server, /probeCandidateRuntime\(serverEntry, \{ expectedVersion: target\.metadata\.webuiVersion, expectedPiVersion: target\.metadata\.piVersion \}\)/);
assert.match(server, /Legacy update mutation is disabled/);
assert.match(server, /optionalFeaturePackageStatuses\(options\.cwd\)[\s\S]*strategy: "pi-owned-optional"[\s\S]*optionalFeature: true/);
assert.match(trust, /"\/api\/update\/plan"[\s\S]*"\/api\/update\/apply"[\s\S]*"\/api\/update\/rollback"/);
assert.match(server, /updateTransactionRoute && req\.method === "GET"[\s\S]*requireLocalhost\(req, "Viewing update transactions is only allowed from localhost"\)/);
assert.doesNotMatch(server, /function resolveUpdateTasks|function projectPackageRootUpdateTasks|function npmGlobalPackageRootUpdateTask|function bunGlobalPackageRootUpdateTask/);
assert.match(launcher, /readRuntimePointer\(agentDir, "current"\)[\s\S]*pointer\?\.serverEntry \|\| bootstrapServer/);
assert.match(activation, /switchRuntimePointer[\s\S]*waitForHealth[\s\S]*rollbackRuntimePointer/);
console.log("component update API static tests passed");
