import assert from "node:assert/strict";
import path from "node:path";
import { assertPlanIdentity, assertUpdatePlanDigest, createUpdatePlan, digestUpdatePlan } from "../lib/update/plan.mjs";

const ownerRoot = path.resolve("tmp", "agent", "npm", "node_modules");
let movingLatest = "2.0.0";
let resolutions = 0;
const identity = { canonicalId: "pi:/agent/pi-cli.js", version: "1.0.0" };
const plan = await createUpdatePlan({
  transactionId: "moving-latest",
  createdAt: "2026-08-07T00:00:00.000Z",
  registry: "https://registry.example.invalid/",
  identities: [identity],
  candidates: [{
    id: "pi",
    kind: "pi",
    packageName: "@earendil-works/pi-coding-agent",
    identityId: identity.canonicalId,
    currentVersion: "1.0.0",
    requested: "latest",
    owner: { manager: "npm", ownerRoot, packageRoot: path.join(ownerRoot, "@earendil-works", "pi-coding-agent") },
    commandForVersion: async (exact, registry) => ({ command: "npm", args: ["install", `@earendil-works/pi-coding-agent@${exact}`, "--registry", registry] }),
  }, {
    id: "optional:statsCommand",
    kind: "optional",
    packageName: "@firstpick/pi-extension-stats",
    identityId: identity.canonicalId,
    currentVersion: "1.0.0",
    requested: "latest",
    owner: { manager: "pi", ownerRoot, packageRoot: path.join(ownerRoot, "@firstpick", "pi-extension-stats"), optional: true, piOwned: true },
    commandForVersion: async (exact) => ({ command: "pi", args: ["install", `npm:@firstpick/pi-extension-stats@${exact}`] }),
  }, {
    id: "source-addon",
    packageName: "example-source-addon",
    currentVersion: "1.0.0",
    owner: { manager: "npm", ownerRoot, packageRoot: path.resolve("source"), sourceCheckout: true },
    commandForVersion: () => assert.fail("refused targets must not get commands"),
  }],
  resolveExactTarget: async ({ requested }) => {
    resolutions += 1;
    assert.equal(requested, "latest");
    return { version: movingLatest, metadata: { integrity: "sha512-fixture" } };
  },
});
assert.equal(resolutions, 2);
assert.equal(plan.targets[0].targetVersion, "2.0.0");
assert.deepEqual(plan.targets[0].command.args, ["install", "@earendil-works/pi-coding-agent@2.0.0", "--registry", "https://registry.example.invalid/"]);
assert.deepEqual(plan.targets[1].command.args, ["install", "npm:@firstpick/pi-extension-stats@2.0.0"], "Pi-owned optional packages should retain exact targets inside the same digest-bound plan");
assert.equal(plan.refusals[0].code, "source");
assertUpdatePlanDigest(plan, plan.digest);
assert.equal(plan.digest, digestUpdatePlan(plan));
assertPlanIdentity(plan.targets[0], identity);

movingLatest = "3.0.0";
assert.equal(plan.targets[0].targetVersion, "2.0.0", "confirmation remains bound to the originally resolved exact target");
assert.throws(() => assertUpdatePlanDigest({ ...plan, targets: [{ ...plan.targets[0], targetVersion: movingLatest }] }, plan.digest), { code: "UPDATE_PLAN_DIGEST_MISMATCH" });
assert.throws(() => assertPlanIdentity(plan.targets[0], { canonicalId: "pi:/different/cli.js" }), { code: "UPDATE_IDENTITY_CHANGED" });
console.log("update-plan.test.mjs passed");
