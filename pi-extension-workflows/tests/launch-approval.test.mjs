import assert from "node:assert/strict";
import { createWorkflowApprovalStore } from "../src/approval.ts";
import { requestWorkflowLaunchApproval } from "../src/launch-approval.ts";
import { hashWorkflowPolicy, sha256 } from "../src/persistence-schema.ts";

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
let selectCalls = 0;
let previewStarted;
let releasePreview;
const previewStartedPromise = new Promise((resolve) => { previewStarted = resolve; });
const previewReleasePromise = new Promise((resolve) => { releasePreview = resolve; });
const oncePromise = requestWorkflowLaunchApproval({
  approvals: onceStore,
  key,
  workflowName: "test",
  source: "export const meta = {};\nreturn 1",
  plan: "Repository: /repo\nIsolation: one git worktree per write agent\nCapabilities: write=true, shell=false, network=false\nLarge workflow: policy allows 30 agents",
  ctx: {
    hasUI: true,
    ui: {
      async select(title) { selectCalls++; approvalTitle = title; return choices.shift(); },
      async editor(title, prefill) {
        previews.push({ title, prefill });
        previewStarted();
        return await previewReleasePromise;
      },
    },
  },
});
await previewStartedPromise;
assert.equal(selectCalls, 1, "approval must remain suspended while the source preview is open");
releasePreview(undefined);
const once = await oncePromise;
assert.equal(once.source, "once");
assert.equal(selectCalls, 2, "approval must reopen only after the source preview closes");
assert.match(approvalTitle, /Repository: \/repo[\s\S]*one git worktree per write agent[\s\S]*write=true[\s\S]*Large workflow/);
assert.match(previews[0].title, /Raw workflow script.*edits are ignored/);
assert.match(previews[0].prefill, /export const meta/);
assert.equal(onceStore.isApproved(key), false, "one-shot approval must be consumed before launch");

const fallbackStore = createWorkflowApprovalStore();
const fallbackChoices = ["View raw workflow script", "Back to approval", "Run once"];
const fallbackDialogs = [];
const fallback = await requestWorkflowLaunchApproval({
  approvals: fallbackStore,
  key,
  workflowName: "fallback-test",
  source: "export const meta = { name: 'fallback' };\nreturn 2",
  ctx: {
    hasUI: true,
    ui: {
      async select(title, options) {
        fallbackDialogs.push({ title, options });
        return fallbackChoices.shift();
      },
    },
  },
});
assert.equal(fallback.source, "once");
assert.match(fallbackDialogs[1].title, /Raw workflow script[\s\S]*export const meta/);
assert.deepEqual(fallbackDialogs[1].options, ["Back to approval"]);
assert.equal(fallbackDialogs.length, 3, "select-only UIs must return to approval after the source preview");

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

const nestingPolicyKey = {
  ...key,
  policyHash: hashWorkflowPolicy({
    version: 1,
    maxConcurrency: 3,
    maxAgents: 50,
    maxNestingDepth: 16,
    timeoutMs: 1000,
    permissions: { write: false, shell: false, network: false },
  }),
};
const nestingApprovalStore = createWorkflowApprovalStore();
await requestWorkflowLaunchApproval({
  approvals: nestingApprovalStore,
  key: nestingPolicyKey,
  workflowName: "nesting-policy",
  source: "return 1",
  ctx: { hasUI: true, ui: { async select() { return "Remember approval for this exact script and policy"; } } },
});
await assert.rejects(
  () => requestWorkflowLaunchApproval({
    approvals: nestingApprovalStore,
    key: {
      ...nestingPolicyKey,
      policyHash: hashWorkflowPolicy({
        version: 1,
        maxConcurrency: 3,
        maxAgents: 50,
        maxNestingDepth: 17,
        timeoutMs: 1000,
        permissions: { write: false, shell: false, network: false },
      }),
    },
    workflowName: "nesting-policy-changed",
    source: "return 1",
    ctx: { hasUI: false },
  }),
  /interactive approval/,
  "maxNestingDepth-only policy changes must invalidate remembered launch consent",
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
