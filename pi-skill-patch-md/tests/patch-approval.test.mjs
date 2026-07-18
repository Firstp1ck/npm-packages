import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPatchApprovalMessage,
  parsePatchctlResult,
  runPatchApproval,
} from "../lib/patch-approval.mjs";

const REVIEWED_HASH = "a".repeat(64);
const FRESH_HASH = "b".repeat(64);

function reviewedPlan(overrides = {}) {
  return {
    action: "plan",
    ok: true,
    blocked: false,
    noop: false,
    patchId: "test.patch",
    patchVersion: "2.0.0",
    planHash: REVIEWED_HASH,
    writes: 2,
    targets: [
      {
        id: "native",
        roles: ["native-tui"],
        packageVersion: "1.2.3",
        status: "applicable",
        file: "/runtime/native.js",
      },
      {
        id: "webui",
        roles: ["webui-rpc"],
        packageVersion: "1.2.3",
        status: "applicable",
        file: "/runtime/webui.js",
      },
    ],
    risks: ["Mutates installed package files.", "Live provider verification is excluded."],
    ...overrides,
  };
}

test("native approval denial performs no apply", async () => {
  let approvalRequests = 0;
  let applyCalls = 0;
  const outcome = await runPatchApproval({
    patchPath: "/patch/PATCH.md",
    reviewedPlanHash: REVIEWED_HASH,
    requestPlan: async () => reviewedPlan(),
    requestApproval: async ({ title, message }) => {
      approvalRequests++;
      assert.equal(title, "Apply reviewed patch now?");
      assert.match(message, /Planned writes: 2/u);
      assert.match(message, new RegExp(REVIEWED_HASH, "u"));
      assert.match(message, /native-tui v1\.2\.3 \[applicable\]: \/runtime\/native\.js/u);
      assert.match(message, /does not install packages or run live provider verification/u);
      return false;
    },
    applyPlan: async () => {
      applyCalls++;
      throw new Error("must not run");
    },
  });

  assert.equal(outcome.status, "declined");
  assert.equal(approvalRequests, 1);
  assert.equal(applyCalls, 0);
});

test("stale reviewed hash fails before prompting or applying", async () => {
  let approvalRequests = 0;
  let applyCalls = 0;
  await assert.rejects(
    runPatchApproval({
      patchPath: "/patch/PATCH.md",
      reviewedPlanHash: REVIEWED_HASH,
      requestPlan: async () => reviewedPlan({ planHash: FRESH_HASH }),
      requestApproval: async () => {
        approvalRequests++;
        return true;
      },
      applyPlan: async () => {
        applyCalls++;
        return {};
      },
    }),
    /Plan hash changed.*reviewed.*current/u,
  );
  assert.equal(approvalRequests, 0);
  assert.equal(applyCalls, 0);
});

test("explicit native approval applies only the exact reviewed hash", async () => {
  let appliedHash;
  const outcome = await runPatchApproval({
    patchPath: "/patch/PATCH.md",
    reviewedPlanHash: REVIEWED_HASH,
    requestPlan: async () => reviewedPlan(),
    requestApproval: async () => true,
    applyPlan: async (planHash) => {
      appliedHash = planHash;
      return {
        action: "apply",
        ok: true,
        planHash,
        receiptPath: "/state/receipt.json",
        result: { writes: 2 },
      };
    },
  });

  assert.equal(appliedHash, REVIEWED_HASH);
  assert.equal(outcome.status, "applied");
  assert.equal(outcome.applied.result.writes, 2);
});

test("blocked plans and malformed patchctl output fail closed", async () => {
  await assert.rejects(
    runPatchApproval({
      patchPath: "/patch/PATCH.md",
      reviewedPlanHash: REVIEWED_HASH,
      requestPlan: async () => reviewedPlan({ blocked: true }),
      requestApproval: async () => true,
      applyPlan: async () => ({}),
    }),
    /plan is blocked/u,
  );

  assert.throws(
    () => parsePatchctlResult("plan", { code: 0, stdout: "", stderr: "" }),
    /invalid JSON/u,
  );
  assert.throws(
    () => parsePatchctlResult("apply", { code: 1, stdout: JSON.stringify({ ok: false, error: "drift" }), stderr: "" }),
    /patchctl apply failed: drift/u,
  );
});

test("approval message bounds untrusted plan text", () => {
  const message = formatPatchApprovalMessage(
    reviewedPlan({ risks: [`risk\n${"x".repeat(400)}`] }),
    "/patch/PATCH.md",
  );
  assert.doesNotMatch(message, /risk\n/u);
  assert.match(message, /…/u);
});
