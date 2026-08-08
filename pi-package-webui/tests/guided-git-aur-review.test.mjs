import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  guidedGitReviewCanRequestStagedContent,
  guidedGitReviewHasApprovedBinding,
  guidedGitReviewProcessNavigationAllowed,
  guidedGitReviewProcessSelectionPatch,
  guidedGitReviewTransition,
  guidedGitReviewWidgetRemovalTransition,
} from "../public/guided-git-review-state.mjs";
import { guidedGitReviewAvailableForTabCatalog, resolveRpcSlashCommandForTabCatalog } from "../public/guided-git-command-state.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");
const fingerprint = "a".repeat(64);
const stagedContentHash = "c".repeat(64);
const repoRoot = "/workspace/repository";
const pendingPayload = {
  scope: "staged",
  origin: "guided-git",
  repoRoot,
  fingerprint,
  stagedContentHash,
  updatedAt: "2026-06-01T00:00:02.000Z",
  decision: { state: "pending" },
};
const requestingWorkflow = {
  active: true,
  step: "reviewRequesting",
  guidedReviewStatus: "requesting",
  guidedReviewRequestedAt: Date.parse("2026-06-01T00:00:01.000Z"),
  guidedReviewFingerprint: "",
  guidedReviewRepoRoot: "",
  guidedReviewStagedContentHash: "",
  guidedReviewDeclinedStagedContentHash: "",
};
const pendingWorkflow = {
  ...requestingWorkflow,
  step: "review",
  guidedReviewStatus: "pending",
  guidedReviewRequired: true,
  guidedReviewFingerprint: fingerprint,
  guidedReviewRepoRoot: repoRoot,
  guidedReviewStagedContentHash: stagedContentHash,
};

assert.equal(guidedGitReviewTransition(requestingWorkflow, pendingPayload), "pending", "only a fresh staged/guided-git pending payload may bind a request");
assert.equal(guidedGitReviewTransition(pendingWorkflow, { ...pendingPayload, decision: { state: "approved", decidedAt: "2026-06-01T00:00:03.000Z", reviewedFingerprint: fingerprint, reviewedStagedContentHash: stagedContentHash } }), "approved", "matching approval may advance the matching flow");
assert.equal(guidedGitReviewTransition(pendingWorkflow, { ...pendingPayload, decision: { state: "declined", decidedAt: "2026-06-01T00:00:03.000Z", reviewedFingerprint: fingerprint, reviewedStagedContentHash: stagedContentHash } }), "declined", "matching decline must reset the matching flow");
assert.equal(guidedGitReviewTransition(pendingWorkflow, { ...pendingPayload, decision: { state: "closed" } }), "closed", "a matching closed payload must return the pending flow to recovery without approval");
assert.equal(guidedGitReviewTransition(requestingWorkflow, { ...pendingPayload, decision: { state: "closed" } }), "closed", "a freshly requested review may close before its pending card is replayed");
assert.equal(guidedGitReviewTransition(pendingWorkflow, { ...pendingPayload, origin: "standalone", scope: "working-tree", decision: { state: "approved", decidedAt: "2026-06-01T00:00:03.000Z", reviewedFingerprint: fingerprint, reviewedStagedContentHash: stagedContentHash } }), "ignore", "standalone payloads cannot advance Guided Git");
assert.equal(guidedGitReviewTransition(pendingWorkflow, { ...pendingPayload, fingerprint: "b".repeat(64), decision: { state: "approved", decidedAt: "2026-06-01T00:00:03.000Z", reviewedFingerprint: "b".repeat(64), reviewedStagedContentHash: stagedContentHash } }), "ignore", "a stale/wrong review cannot advance Guided Git");
assert.equal(guidedGitReviewTransition(pendingWorkflow, { ...pendingPayload, decision: { state: "approved", decidedAt: "2026-06-01T00:00:03.000Z", reviewedFingerprint: fingerprint, reviewedStagedContentHash: "d".repeat(64) } }), "ignore", "approval must bind the exact staged-content hash");
assert.equal(guidedGitReviewTransition({ ...pendingWorkflow, active: false }, { ...pendingPayload, decision: { state: "approved", decidedAt: "2026-06-01T00:00:03.000Z", reviewedFingerprint: fingerprint, reviewedStagedContentHash: stagedContentHash } }), "ignore", "a payload for another tab's inactive flow cannot advance this tab");
assert.equal(guidedGitReviewWidgetRemovalTransition(pendingWorkflow), "closed", "clearing a matching pending widget is equivalent to close");
assert.equal(guidedGitReviewWidgetRemovalTransition({ ...pendingWorkflow, step: "add", guidedReviewStatus: "" }), "ignore", "a replayed widget removal cannot disturb a recovered staging flow");

const freshAvailableWorkflow = {
  ...requestingWorkflow,
  step: "add",
  process: "stage",
  guidedReviewRequired: true,
};
for (const process of ["message", "commit", "push"]) {
  assert.equal(guidedGitReviewProcessNavigationAllowed(requestingWorkflow, process), false, `${process} navigation must be rejected while review request is outstanding`);
  assert.equal(guidedGitReviewProcessNavigationAllowed(pendingWorkflow, process), false, `${process} navigation must be rejected while review is pending`);
  assert.equal(guidedGitReviewProcessNavigationAllowed(freshAvailableWorkflow, process), false, `a fresh available-review flow must block ${process} before staging and approval`);
  assert.equal(guidedGitReviewProcessSelectionPatch(freshAvailableWorkflow, process), null, `a fresh available-review flow must not transition to ${process}`);
}
assert.equal(guidedGitReviewProcessNavigationAllowed(pendingWorkflow, "stage"), true, "staging recovery remains available while review is pending");
assert.equal(guidedGitReviewProcessNavigationAllowed(pendingWorkflow, "review"), true, "review recovery remains available while review is pending");

const approvedWorkflow = {
  ...pendingWorkflow,
  step: "generate",
  process: "message",
  guidedReviewStatus: "approved",
  guidedReviewRequired: false,
};
assert.equal(guidedGitReviewHasApprovedBinding(approvedWorkflow), true, "approval must carry the exact repo, fingerprint, and staged-content binding");
for (const process of ["message", "commit", "push"]) {
  assert.equal(guidedGitReviewProcessNavigationAllowed(approvedWorkflow, process), true, `matching approval may navigate to ${process}`);
  const patch = guidedGitReviewProcessSelectionPatch(approvedWorkflow, process);
  assert.equal(patch?.guidedReviewStatus, "approved", `${process} navigation must preserve approval status`);
  assert.equal(patch?.guidedReviewRepoRoot, repoRoot, `${process} navigation must preserve the approved repo root`);
  assert.equal(patch?.guidedReviewFingerprint, fingerprint, `${process} navigation must preserve the approved fingerprint`);
  assert.equal(patch?.guidedReviewStagedContentHash, stagedContentHash, `${process} navigation must preserve the approved staged-content hash`);
  assert.equal(patch?.guidedReviewRequired, false, `${process} navigation must not convert matching approval to legacy state`);
}
for (const process of ["stage", "review"]) {
  const patch = guidedGitReviewProcessSelectionPatch(approvedWorkflow, process);
  assert.equal(patch?.guidedReviewRequired, true, `${process} must re-arm required review after approval`);
  assert.equal(patch?.guidedReviewStatus, "", `${process} must clear prior approval status`);
  assert.equal(patch?.guidedReviewRepoRoot, "", `${process} must clear prior repo binding`);
  assert.equal(patch?.guidedReviewFingerprint, "", `${process} must clear prior fingerprint binding`);
  assert.equal(patch?.guidedReviewStagedContentHash, "", `${process} must clear prior staged-content binding`);
  const rearmedWorkflow = { ...approvedWorkflow, ...patch, step: process === "stage" ? "add" : "review", process };
  for (const laterProcess of ["message", "commit", "push"]) {
    assert.equal(guidedGitReviewProcessNavigationAllowed(rearmedWorkflow, laterProcess), false, `${laterProcess} must remain blocked after approval is cleared via ${process}`);
  }
}

const legacyWorkflow = {
  ...requestingWorkflow,
  step: "add",
  process: "stage",
  guidedReviewRequired: false,
};
for (const process of ["message", "commit", "push"]) {
  assert.equal(guidedGitReviewProcessNavigationAllowed(legacyWorkflow, process), true, `a flow started without aur-review retains legacy ${process} navigation`);
  assert.equal(guidedGitReviewProcessSelectionPatch(legacyWorkflow, process)?.guidedReviewRequired, false, `legacy ${process} navigation must remain ungated`);
}

const recoveredWorkflow = {
  ...pendingWorkflow,
  step: "add",
  process: "stage",
  guidedReviewStatus: "",
  guidedReviewFingerprint: "",
  guidedReviewRepoRoot: "",
  guidedReviewStagedContentHash: "",
  guidedReviewDeclinedStagedContentHash: stagedContentHash,
  guidedReviewRequired: true,
};
for (const process of ["message", "commit", "push"]) {
  assert.equal(guidedGitReviewProcessNavigationAllowed(recoveredWorkflow, process), false, `${process} remains blocked after Stage/Review recovery`);
}
assert.equal(guidedGitReviewProcessNavigationAllowed(recoveredWorkflow, "stage"), true, "recovery stage remains available with durable requirement");
assert.equal(guidedGitReviewProcessNavigationAllowed(recoveredWorkflow, "review"), true, "recovery review remains available with durable requirement");
const rerequestedWorkflow = { ...pendingWorkflow, guidedReviewRequired: true };
assert.equal(guidedGitReviewTransition(rerequestedWorkflow, { ...pendingPayload, decision: { state: "approved", decidedAt: "2026-06-01T00:00:03.000Z", reviewedFingerprint: fingerprint, reviewedStagedContentHash: stagedContentHash } }), "approved", "a new matching approval advances the recovered review flow");
assert.equal(guidedGitReviewCanRequestStagedContent(recoveredWorkflow, stagedContentHash), false, "an unchanged declined staged hash must be rejected");
assert.equal(guidedGitReviewCanRequestStagedContent(recoveredWorkflow, "d".repeat(64)), true, "changed/restaged content may request a new review");

const catalogByTab = new Map();
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
await Promise.all([
  (async () => { await delay(12); catalogByTab.set("tab-a", { raw: [{ name: "git-staged-msg", source: "extension" }], available: [{ name: "git-staged-msg", source: "extension" }] }); })(),
  (async () => { await delay(1); catalogByTab.set("tab-b", { raw: [{ name: "aur-review:2", source: "extension" }], available: [{ name: "aur-review:2", invokeName: "aur-review:2", duplicateCount: 2, source: "extension" }] }); })(),
]);
assert.equal(guidedGitReviewAvailableForTabCatalog(catalogByTab.get("tab-a")), false, "tab A cannot inherit tab B's review command after async tab switching");
assert.equal(resolveRpcSlashCommandForTabCatalog(catalogByTab.get("tab-a"), "/aur-review start --scope staged"), "/aur-review start --scope staged", "tab A cannot inherit tab B's alias");
assert.equal(guidedGitReviewAvailableForTabCatalog(catalogByTab.get("tab-b")), true, "tab B retains its own review command");
assert.equal(resolveRpcSlashCommandForTabCatalog(catalogByTab.get("tab-b"), "/aur-review start --scope staged"), "/aur-review:2 start --scope staged", "tab B resolves only its own alias");

const runGitAdd = app.slice(app.indexOf("async function runGitAdd"), app.indexOf("async function acceptCurrentGitStaging"));
const acceptStaging = app.slice(app.indexOf("async function acceptCurrentGitStaging"), app.indexOf("async function loadGitWorkflowDefaultCommitMessage"));
assert.match(runGitAdd, /workflow\.preferences\?\.reviewProcessEnabled !== false && guidedGitReviewAvailable\(tabId\)[\s\S]*\|\| workflow\.guidedReviewRequired === true[\s\S]*await requestGuidedGitReview\(tabId, \{ output \}\)/s, "git add . must honor the saved review-process option while keeping an already-required gate fail-closed");
assert.match(acceptStaging, /workflow\.preferences\?\.reviewProcessEnabled !== false && guidedGitReviewAvailable\(tabId\)[\s\S]*\|\| workflow\.guidedReviewRequired === true[\s\S]*await requestGuidedGitReview\(tabId, \{ output \}\)/s, "accepting a staged set must honor the saved review-process option while keeping an already-required gate fail-closed");
const reconcileReview = app.slice(app.indexOf("function reconcileGuidedGitReviewPayload"), app.indexOf("async function startGitWorkflow"));
assert.match(reconcileReview, /transition === "approved"[\s\S]*step: "generate"[\s\S]*guidedReviewDeclinedStagedContentHash: ""/s, "only approval advances to message generation and clears an older decline binding");
assert.match(reconcileReview, /transition === "pending"[\s\S]*guidedReviewDeclinedStagedContentHash[\s\S]*same staged content that was declined/s, "extension payload replay cannot retry an unchanged declined staged hash");
assert.match(reconcileReview, /transition === "closed"[\s\S]*resetGuidedGitReviewToStaging/s, "closed payloads must reset the matching flow to staging");
assert.match(reconcileReview, /function reconcileGuidedGitReviewWidgetRemoval[\s\S]*guidedGitReviewWidgetRemovalTransition[\s\S]*resetGuidedGitReviewToStaging/s, "matching widget removal must reset the gate rather than imply approval");
const resetReviewToStaging = app.slice(app.indexOf("function resetGuidedGitReviewToStaging"), app.indexOf("function reconcileGuidedGitReviewPayload"));
assert.match(resetReviewToStaging, /step: "add"[\s\S]*stage: false/s, "decline and close return the flow to staging and require restaging");
const workflowRender = app.slice(app.indexOf("function renderGitWorkflow"), app.indexOf("async function gitWorkflowRequest"));
assert.match(workflowRender, /preferences\.reviewProcessEnabled !== false && guidedGitReviewAvailable\(activeTabId\)[\s\S]*\|\| gitWorkflow\.guidedReviewRequired === true/, "the Review process should be shown only when enabled and available, while an active required gate remains visible");
assert.match(workflowRender, /item\.disabled = !!gitWorkflow\.busy \|\| !guidedGitReviewProcessNavigationAllowed\(gitWorkflow, process\.value\);/, "the UI must disable later process buttons while the review gate is active");
const processSelection = app.slice(app.indexOf("function selectGitWorkflowProcess"), app.indexOf("function gitWorkflowTitle"));
assert.match(processSelection, /const guidedReviewPatch = guidedGitReviewProcessSelectionPatch\(workflow, process\);[\s\S]*if \(!guidedReviewPatch\) return;[\s\S]*\.\.\.guidedReviewPatch/s, "process selection must use the tested patch that preserves approval or re-arms review");
assert.doesNotMatch(processSelection, /resetGuidedGitReviewPatch/, "process selection must not share a reset that drops an approved binding during later navigation");
const startWorkflow = app.slice(app.indexOf("async function startGitWorkflow"), app.indexOf("async function startGitInitWorkflow"));
assert.match(startWorkflow, /guidedReviewRequired: preferences\.reviewProcessEnabled !== false && guidedGitReviewAvailable\(tabId\)/, "a fresh standard flow must require review only when setup enables it and aur-review is available in its originating tab");
assert.match(app, /function guidedGitReviewAvailable\(tabId = activeTabId\)[\s\S]*commandCatalogForTab\(tabId\)/, "Guided Git availability must read the originating tab catalog");
assert.match(app, /resolveRpcSlashCommandMessage\(guidedGitReviewCommand\(\), \{ tabId \}\)/, "Guided Git review requests must resolve aliases from the originating tab catalog");
assert.match(app, /message = resolveRpcSlashCommandMessage\(message, \{ tabId: targetTabId \}\)/, "generic targeted slash-command dispatch must resolve aliases from its captured target tab");
for (const [name, action] of [["runGitMessagePrompt", "commit-message generation"], ["commitGitWorkflow", "commit"], ["createGitPrBranchWithSuggestion", "PR worktree creation"]]) {
  const start = app.indexOf(`async function ${name}`);
  const next = app.indexOf("\nasync function ", start + 1);
  const source = app.slice(start, next === -1 ? undefined : next);
  assert.match(source, /assertGuidedGitStagedContentBinding/, `${name} must recheck the approved staged-content hash at its action boundary`);
  assert.match(source, /expectedStagedContentHash/, `${name} must send the approved staged-content hash to its gated endpoint`);
}
assert.match(app, /function requestGuidedGitReview[\s\S]*readGuidedGitStagedContent[\s\S]*git add \. produced no substantive staged changes[\s\S]*guideded|function requestGuidedGitReview[\s\S]*readGuidedGitStagedContent[\s\S]*git add \. produced no substantive staged changes/s, "manual-review requests must preflight no-staged content instead of waiting for a card");
assert.match(app, /guidedGitReviewUnavailableMessage[\s\S]*No message, commit, worktree, or push action was performed/, "a disappeared extension after a required gate must remain fail-closed with recovery guidance");
assert.match(app, /commandCatalogsByTab\.set\(tabContext\.tabId, catalog\)[\s\S]*if \(!isCurrentTabContext\(tabContext\)\) return;/, "async command refresh must cache inactive-tab results rather than discard or activate them");
assert.match(app, /widgetKey === AUR_REVIEW_RPC_WIDGET_KEY[\s\S]*else if \(!Array\.isArray\(request\.widgetLines\)\) reconcileGuidedGitReviewWidgetRemoval\(requestTabId\)/s, "active-tab widget clearing must reconcile a matching pending review");
assert.match(app, /AUR_REVIEW_RPC_WIDGET_KEY\)[\s\S]*else if \(!Array\.isArray\(event\.widgetLines\)\) reconcileGuidedGitReviewWidgetRemoval\(event\.tabId\)/s, "inactive-tab widget clearing must reconcile the owning tab only");
assert.match(app, /handleInactiveTabEvent[\s\S]*AUR_REVIEW_RPC_WIDGET_KEY[\s\S]*reconcileGuidedGitReviewPayload\(event\.tabId, payload\)/s, "tab-local review events must reconcile using their event tab id");
console.log("guided Git aur-review tests passed");
