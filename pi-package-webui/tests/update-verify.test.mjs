import assert from "node:assert/strict";
import { failedTargetReceipt, reduceUpdateReceipts, rolledBackTargetReceipt, verifyTargetResult } from "../lib/update/verify.mjs";

const pi = { id: "pi", kind: "pi", currentVersion: "1.0.0", targetVersion: "2.0.0" };
const webui = { id: "webui", kind: "webui", currentVersion: "0.8.6", targetVersion: "0.9.0" };
const identity = { canonicalId: "pi:/active/cli.js" };
for (const target of [pi, webui]) {
  const unchanged = verifyTargetResult(target, { beforeIdentity: identity, afterIdentity: identity, afterVersion: target.currentVersion });
  assert.equal(unchanged.status, "failed");
  assert.match(unchanged.message, /without changing/i, `${target.kind} exit-zero/no-change must fail`);
}
const wrong = verifyTargetResult(pi, { beforeIdentity: identity, afterIdentity: identity, afterVersion: "1.5.0" });
assert.equal(wrong.status, "failed");
assert.match(wrong.message, /Expected exact version 2\.0\.0/);
const changedIdentity = verifyTargetResult(pi, { beforeIdentity: identity, afterIdentity: { canonicalId: "pi:/path/cli.js" }, afterVersion: "2.0.0" });
assert.equal(changedIdentity.status, "failed");
const success = verifyTargetResult(pi, { beforeIdentity: identity, afterIdentity: identity, afterVersion: "2.0.0" });
assert.equal(success.status, "success");

const partial = reduceUpdateReceipts([success, failedTargetReceipt(webui, "fixture failure")]);
assert.equal(partial.outcome, "partial");
assert.deepEqual(partial.receipts.map((item) => item.targetId), ["pi", "webui"], "partial receipts retain target order");
assert.deepEqual(partial.counts, { success: 1, failed: 1, rolledBack: 0 });
const optional = { id: "optional:statsCommand", kind: "optional", currentVersion: "1.0.0", targetVersion: "2.0.0" };
const webuiSuccess = verifyTargetResult(webui, { beforeIdentity: { canonicalId: "webui:/active" }, afterIdentity: { canonicalId: "webui:/active" }, afterVersion: "0.9.0" });
const optionalPartial = reduceUpdateReceipts([webuiSuccess, failedTargetReceipt(optional, "fixture optional-package failure")]);
assert.equal(optionalPartial.outcome, "partial", "a verified WebUI target plus a failed Pi-owned optional package must remain partial");
assert.deepEqual(optionalPartial.receipts.map((item) => item.targetId), ["webui", "optional:statsCommand"]);
assert.equal(reduceUpdateReceipts([failedTargetReceipt(pi, "failed")]).outcome, "failed");
assert.equal(reduceUpdateReceipts([rolledBackTargetReceipt(webui, "restored")]).outcome, "rolled-back");
console.log("update-verify.test.mjs passed");
