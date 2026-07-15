import assert from "node:assert/strict";
import { createWorkflowApprovalStore } from "../src/approval.ts";
import { requestWorkflowLaunchApproval } from "../src/launch-approval.ts";
import { sha256 } from "../src/persistence-schema.ts";

const key = {
  projectId: "project-test",
  scriptHash: sha256("script"),
  policyHash: sha256("policy"),
};

await assert.rejects(
  () => requestWorkflowLaunchApproval({ approvals: createWorkflowApprovalStore(), key, workflowName: "test", source: "return 1", ctx: { hasUI: false } }),
  /interactive approval or a remembered exact-script approval/,
);

const onceStore = createWorkflowApprovalStore();
const choices = ["View raw workflow script", "Run once"];
const previews = [];
let approvalTitle = "";
const once = await requestWorkflowLaunchApproval({
  approvals: onceStore,
  key,
  workflowName: "test",
  source: "export const meta = {};\nreturn 1",
  plan: "Repository: /repo\nIsolation: one git worktree per write agent\nCapabilities: write=true, shell=false, network=false\nLarge workflow: policy allows 30 agents",
  ctx: {
    hasUI: true,
    ui: {
      async select(title) { approvalTitle = title; return choices.shift(); },
      notify(message) { previews.push(message); },
    },
  },
});
assert.equal(once.source, "once");
assert.match(approvalTitle, /Repository: \/repo[\s\S]*one git worktree per write agent[\s\S]*write=true[\s\S]*Large workflow/);
assert.match(previews[0], /export const meta/);
assert.equal(onceStore.isApproved(key), false, "one-shot approval must be consumed before launch");

const rememberedStore = createWorkflowApprovalStore();
let prompts = 0;
const remembered = await requestWorkflowLaunchApproval({
  approvals: rememberedStore,
  key,
  workflowName: "test",
  source: "return 1",
  ctx: { hasUI: true, ui: { async select() { prompts++; return "Remember approval for this exact script and policy"; } } },
});
assert.equal(remembered.source, "remembered");
assert.equal(prompts, 1);
const reused = await requestWorkflowLaunchApproval({
  approvals: rememberedStore,
  key,
  workflowName: "test",
  source: "return 1",
  ctx: { hasUI: false },
});
assert.equal(reused.source, "remembered");
assert.equal(prompts, 1, "exact remembered approval must skip the dialog");

await assert.rejects(
  () => requestWorkflowLaunchApproval({
    approvals: rememberedStore,
    key: { ...key, scriptHash: sha256("changed") },
    workflowName: "changed",
    source: "return 2",
    ctx: { hasUI: false },
  }),
  /interactive approval/,
  "script changes must invalidate remembered launch consent",
);
await assert.rejects(
  () => requestWorkflowLaunchApproval({
    approvals: rememberedStore,
    key: { ...key, policyHash: sha256("changed-policy") },
    workflowName: "changed-policy",
    source: "return 1",
    ctx: { hasUI: false },
  }),
  /interactive approval/,
  "policy changes must invalidate remembered launch consent",
);

await assert.rejects(
  () => requestWorkflowLaunchApproval({
    approvals: createWorkflowApprovalStore(),
    key,
    workflowName: "cancelled",
    source: "return 1",
    ctx: { hasUI: true, ui: { async select() { return "Cancel"; } } },
  }),
  /approval was cancelled/,
);

console.log("launch approval tests passed");
