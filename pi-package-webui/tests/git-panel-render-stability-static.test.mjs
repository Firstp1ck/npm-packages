import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");

function functionBody(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should be defined`);
  const next = app.indexOf("\nfunction ", start + 1);
  return app.slice(start, next === -1 ? app.length : next);
}

const renderGitPanel = functionBody("renderGitPanel");
const renderGitPanelFolder = functionBody("renderGitPanelFolder");
const renderGitPanelRepositoryCard = functionBody("renderGitPanelRepositoryCard");
const updateGitPanelRepositoryMeta = functionBody("updateGitPanelRepositoryMeta");
const renderContextMeter = functionBody("renderContextMeter");
const renderWorkspaceDashboard = functionBody("renderWorkspaceDashboard");

assert.match(app, /openFolders: new Map\(\)/, "Git panel state should persist folder toggles");
assert.match(renderGitPanelFolder, /const defaultOpen = true;/, "folder rendering should expand every directory depth by default");
assert.match(renderGitPanelFolder, /details\.open = gitPanelState\.openFolders\.has\(folderKey\) \? gitPanelState\.openFolders\.get\(folderKey\) : defaultOpen;/, "folder rendering should prefer a stored override over its default");
assert.match(renderGitPanelFolder, /if \(details\.open === defaultOpen\) gitPanelState\.openFolders\.delete\(folderKey\);/, "folder toggles back to the default should remove the override");
assert.match(renderGitPanelFolder, /else gitPanelState\.openFolders\.set\(folderKey, details\.open\);/, "folder toggles away from the default should store an override");
assert.match(renderGitPanel, /gitPanelState\.openFolders\.keys\(\)/, "folder state for removed roots should be pruned");
assert.doesNotMatch(renderGitPanel, /\bsectionExpanded\b/, "Git panel signature should not include the always-true section state");

const gitGuard = renderGitPanel.indexOf("signature === gitPanelRenderSignature");
const gitRebuild = renderGitPanel.indexOf("elements.gitPanelGroups.replaceChildren");
assert.ok(gitGuard > 0 && gitGuard < gitRebuild, "Git panel signature guard should precede its DOM rebuild");
assert.doesNotMatch(renderGitPanel, /snapshot\?\.loadedAt|data\?\.generatedAt/, "Git panel signature should ignore refresh timestamps");
assert.match(renderGitPanel, /!data && !!snapshot\?\.loading/, "initial repository loads should still update their loading state");
assert.match(renderGitPanel, /gitPanelDataRenderSignature\(data\)/, "Git panel signature should still track rendered repository data");
assert.match(renderGitPanel, /gitPanelState\.activeViews\.get/, "Git panel signature should include active repository views");
assert.match(renderGitPanelRepositoryCard, /section\.dataset\.gitRoot = card\.root;/, "repository cards should expose a stable root for targeted metadata updates");
assert.match(updateGitPanelRepositoryMeta, /\.git-side-panel-repository-updated/, "refresh state should target only the update-time label");
assert.match(updateGitPanelRepositoryMeta, /snapshot\.loading \? "Refreshing…" : `Updated /, "the targeted label should reflect refresh progress and completion time");

const gitMetaUpdate = renderGitPanel.indexOf("updateGitPanelRepositoryMeta(cards)");
assert.ok(gitMetaUpdate > gitGuard && gitMetaUpdate < gitRebuild, "unchanged Git content should update metadata before returning without a DOM rebuild");

const contextGuard = renderContextMeter.indexOf("signature === contextMeterSignature");
const contextRebuild = renderContextMeter.lastIndexOf("root.replaceChildren");
assert.ok(contextGuard > 0 && contextGuard < contextRebuild, "context meter signature guard should precede its DOM rebuild");

const dashboardGuard = renderWorkspaceDashboard.indexOf("signature === workspaceDashboardSignature");
const dashboardRebuild = renderWorkspaceDashboard.indexOf("root.replaceChildren");
assert.ok(dashboardGuard > 0 && dashboardGuard < dashboardRebuild, "workspace dashboard signature guard should precede its DOM rebuild");

console.log("git-panel-render-stability-static.test.mjs passed");
