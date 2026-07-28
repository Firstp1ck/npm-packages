import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [app, css, html] = await Promise.all([
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
  readFile(join(root, "public", "index.html"), "utf8"),
]);

function sourceBetween(startMarker, endMarker, label) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${label} should remain a standalone frontend helper`);
  return app.slice(start, end);
}

const normalizePathSource = sourceBetween("function normalizeFileTreePath(", "\nfunction fileApiPath(", "normalizeFileTreePath");
const targetSource = sourceBetween("function gitFileViewerTarget(", "\nasync function openGitFileInViewer(", "gitFileViewerTarget");
const openSource = sourceBetween("async function openGitFileInViewer(", "\nasync function openGitFileFromChanges(", "openGitFileInViewer");
const renderSource = sourceBetween("function renderGitPanelFile(", "\nfunction renderGitPanelTreeSection(", "renderGitPanelFile");
const categorySource = sourceBetween("const GIT_FILE_DIFF_CATEGORY_BY_PANEL = Object.freeze({", "\nasync function loadGitFileChangesSnapshot(", "gitFileDiffCategory");
const modeSource = sourceBetween("function resolveFileViewerMode(", "\nfunction setFileViewerMode(", "resolveFileViewerMode");
const setModeSource = sourceBetween("function setFileViewerMode(", "\nfunction setFileViewerDirty(", "setFileViewerMode");
const viewerUiSource = sourceBetween("function updateFileViewerUi(", "\nfunction fileViewerChangesNotice(", "updateFileViewerUi");
const changesRenderSource = sourceBetween("function fileViewerChangesNotice(", "\nfunction clearFileViewerSelection(", "file viewer changes rendering");
const combinedSyntaxSource = sourceBetween("function gitFileDiffUsesCombinedSyntax(", "\nfunction renderFileViewerUntrackedChanges(", "gitFileDiffUsesCombinedSyntax");
const snapshotSource = sourceBetween("async function loadGitFileChangesSnapshot(", "\nfunction gitFileChangesPlaceholder(", "loadGitFileChangesSnapshot");
const applySnapshotSource = sourceBetween("function gitFileChangesPlaceholder(", "\nasync function openFileInViewer(", "gitFileChangesPlaceholder");
const openFileSource = sourceBetween("async function openFileInViewer(", "\nasync function openAurReviewReportInViewer(", "openFileInViewer");
const viewerPersistenceSource = sourceBetween("function cacheActiveFileViewerForTab(", "\n// Side-panel Git categories are UI labels", "file viewer tab persistence");
const moveSource = sourceBetween("function updateActiveFileViewerAfterMove(", "\nfunction closeActiveFileViewerIfDeleted(", "updateActiveFileViewerAfterMove");
const resetActiveTabUiSource = sourceBetween("function resetActiveTabUi(", "\nfunction tabGroupStatusRank(", "resetActiveTabUi");
const switchTabSource = sourceBetween("async function switchTab(", "\nfunction currentDirectoryForNewTab(", "switchTab");
const closeTabsSource = sourceBetween("async function closeTerminalTabs(", "\nasync function closeTerminalTab(", "closeTerminalTabs");

const targets = JSON.parse(vm.runInNewContext(`${normalizePathSource}\n${targetSource}\nJSON.stringify([
  gitFileViewerTarget("sub/active.js", "/repo", [{ tabId: "repo-tab", cwd: "/repo" }]),
  gitFileViewerTarget("other/fallback.js", "/repo", [{ tabId: "repo-tab", cwd: "/repo" }]),
  gitFileViewerTarget("src/windows.js", "C:\\\\Repo", [{ tabId: "windows-tab", cwd: "c:\\\\repo" }]),
  gitFileViewerTarget("root.js", "/", [{ tabId: "root-tab", cwd: "/" }]),
  gitFileViewerTarget("outside.js", "/repo", [{ tabId: "nested-tab", cwd: "/repo/sub" }]),
])`, {
  activeTab: () => ({ id: "active-tab", cwd: "/repo/sub" }),
}));

assert.deepEqual(targets[0], { tabId: "active-tab", path: "active.js" }, "Git files inside the active cwd should stay on the active tab");
assert.deepEqual(targets[1], { tabId: "repo-tab", path: "other/fallback.js" }, "Git files outside the active cwd should use a repository tab that contains them");
assert.deepEqual(targets[2], { tabId: "windows-tab", path: "src/windows.js" }, "Git preview path translation should normalize Windows separators and compare drive paths case-insensitively");
assert.deepEqual(targets[3], { tabId: "root-tab", path: "root.js" }, "filesystem-root workspaces should retain a usable relative viewer path");
assert.equal(targets[4], null, "Git files outside every available tab cwd should fail closed");

assert.match(openSource, /gitFileViewerTarget\(repoRelPath, root, candidates\)/, "Git file opening should use the shared repo-to-workspace path resolver");
assert.match(openSource, /target\.tabId !== activeTabId[\s\S]*await switchTab\(target\.tabId\)[\s\S]*openFileInViewer\(target\.path/, "Git file opening should activate the owning tab before using the standard WebUI viewer");
assert.match(openSource, /its terminal tab is no longer available/, "a stale Git-card tab should produce visible failure feedback");
assert.match(renderSource, /row\.setAttribute\("role", "button"\)/, "Git file rows should expose button semantics");
assert.match(renderSource, /row\.addEventListener\("click", open\)/, "clicking a Git file row should open its preview");
assert.match(renderSource, /event\.repeat \|\| \(event\.key !== "Enter" && event\.key !== " "\)/, "Git file rows should support keyboard activation without key-repeat request bursts");
assert.match(renderSource, /openGitFileInViewer\(entry\.path, \{ root: card\.root, candidates: card\.candidates, category \}\)/, "Git file rows should pass repository and category context to the shared preview flow");
assert.match(css, /\.git-side-panel-file \{[^}]*cursor: pointer;[^}]*\}/, "Git file rows should visually indicate their primary open action");

// --- Changes mode DOM wiring ---

assert.match(
  html,
  /<div class="file-viewer-mode-toggle" role="group" aria-label="File view mode">\s*<button id="fileViewerChangesModeButton" type="button" aria-pressed="false" hidden>Changes<\/button>\s*<button id="fileViewerSourceModeButton"/,
  "the file viewer mode toggle should expose a Changes control that is hidden until a Git-originated open supplies one",
);
assert.match(
  html,
  /<div class="file-viewer-content">[\s\S]*<div id="fileViewerChanges" class="file-viewer-changes"[^>]*hidden><\/div>\s*<\/div>/,
  "the file viewer content area should own a dedicated, initially hidden Git changes surface",
);
assert.match(html, /id="fileViewerChanges"[^>]*aria-label="Git changes for this file"/, "the changes surface should be labelled for assistive technology");
assert.match(html, /id="fileViewerHelp"[^>]*>Files opened from Git start in Changes mode\./, "the viewer help should explain the Git-specific default mode");
assert.match(app, /fileViewerChangesModeButton: \$\("#fileViewerChangesModeButton"\)/, "the Changes mode button should be registered in the element map");
assert.match(app, /fileViewerChanges: \$\("#fileViewerChanges"\)/, "the changes surface should be registered in the element map");
assert.match(
  app,
  /elements\.fileViewerChangesModeButton\?\.addEventListener\("click", \(\) => setFileViewerMode\("changes"\)\);\nelements\.fileViewerSourceModeButton\?\.addEventListener\("click", \(\) => setFileViewerMode\("source"\)\);\nelements\.fileViewerPreviewModeButton\?\.addEventListener\("click", \(\) => setFileViewerMode\("preview"\)\);/,
  "Changes mode should be selectable alongside the untouched Source and Preview controls",
);

// --- Mode resolution: default selection, availability, and isolation ---

const modes = JSON.parse(vm.runInNewContext(`${modeSource}\nJSON.stringify([
  resolveFileViewerMode({ mode: "changes", gitChanges: { category: "unstaged" }, language: "text" }),
  resolveFileViewerMode({ mode: "changes", gitChanges: null, language: "text" }),
  resolveFileViewerMode({ mode: "source", gitChanges: { category: "unstaged" }, language: "text" }),
  resolveFileViewerMode({ mode: "preview", gitChanges: { category: "unstaged" }, language: "markdown" }),
  resolveFileViewerMode({ mode: "preview", language: "markdown" }),
  resolveFileViewerMode({ mode: "preview", language: "text" }),
  resolveFileViewerMode({ mode: "source", language: "markdown" }),
  resolveFileViewerMode({ mode: "source", sourceAvailable: false, gitChanges: { category: "staged" }, language: "text" }),
  resolveFileViewerMode({ mode: "source", sourceAvailable: false, language: "text" }),
  resolveFileViewerMode(null),
])`, {}));

assert.equal(modes[0], "changes", "a Git-originated viewer should stay in Changes mode when requested");
assert.equal(modes[1], "source", "Changes mode should fall back to Source when the viewer has no Git snapshot");
assert.equal(modes[2], "source", "a Git-originated viewer should still allow the live Source view");
assert.equal(modes[3], "preview", "Markdown Preview should remain reachable for Git-originated Markdown files");
assert.equal(modes[4], "preview", "normal Markdown opens should keep their Preview default");
assert.equal(modes[5], "source", "Preview should degrade to Source for non-Markdown files");
assert.equal(modes[6], "source", "Source stays Source for Markdown when explicitly selected");
assert.equal(modes[7], "changes", "a deleted tracked file without live source should resolve to Changes");
assert.equal(modes[8], "source", "a missing source without any Git snapshot should not invent a Changes view");
assert.equal(modes[9], "source", "mode resolution should fail closed without a viewer");

assert.match(setModeSource, /activeFileViewer\.mode = resolveFileViewerMode\(\{ \.\.\.activeFileViewer, mode \}\);/, "mode switching should route every request through the shared resolver");
assert.match(setModeSource, /if \(activeFileViewer\.mode === "changes" && previousMode !== "changes"\) clearFileViewerSelection\(\);/, "entering Changes mode should clear a stale Source or Preview selection bar");
assert.match(viewerUiSource, /const hasChanges = !!viewer\.gitChanges;/, "the viewer UI should derive Changes availability from the open-time snapshot");
assert.match(viewerUiSource, /elements\.fileViewerChangesModeButton\.hidden = !hasChanges;\s*elements\.fileViewerChangesModeButton\.disabled = !hasChanges;/, "the Changes control should stay hidden and disabled for non-Git opens");
assert.match(viewerUiSource, /elements\.fileViewerSourceModeButton\.disabled = !sourceAvailable;/, "Source should be disabled when the live file content is unavailable");
assert.match(viewerUiSource, /elements\.fileViewerPreviewModeButton\.hidden = !isMarkdown;\s*elements\.fileViewerPreviewModeButton\.disabled = !isMarkdown \|\| !sourceAvailable;/, "Markdown Preview should stay hidden for non-Markdown and disabled when live source is unavailable");
assert.match(viewerUiSource, /elements\.fileViewerEditor\.hidden = mode !== "source";/, "Source editing should remain bound to Source mode");
assert.match(
  viewerUiSource,
  /elements\.fileViewerChanges\.hidden = mode !== "changes";\s*if \(mode === "changes"\) renderFileViewerChanges\(viewer\.gitChanges\);\s*else elements\.fileViewerChanges\.replaceChildren\(\);/,
  "the changes surface should render only in Changes mode and clear itself otherwise",
);
assert.match(viewerUiSource, /elements\.fileViewerSaveButton\.disabled = viewer\.readOnly === true \|\| !viewer\.dirty;/, "save semantics should stay tied to read-only and dirty state");
assert.match(viewerUiSource, /\["source unavailable"\]/, "a viewer without live content should say so in its metadata line");

// --- Category mapping ---

const categories = JSON.parse(vm.runInNewContext(`${categorySource}\nJSON.stringify([
  gitFileDiffCategory("staged"),
  gitFileDiffCategory("changes"),
  gitFileDiffCategory("conflicted"),
  gitFileDiffCategory("untracked"),
  gitFileDiffCategory("history"),
  gitFileDiffCategory(""),
  gitFileDiffCategory(),
])`, {}));

assert.deepEqual(
  categories,
  ["staged", "unstaged", "conflicted", "untracked", "", "", ""],
  "side-panel categories should map onto the allowlisted API categories and fail closed for anything else",
);

// --- Backend request contract ---

assert.match(snapshotSource, /new URLSearchParams\(\{ path: repoRelPath, category \}\)/, "the changes request should send the repo-relative path and the mapped category");
assert.match(snapshotSource, /api\(`\/api\/git-file-diff\?\$\{params\.toString\(\)\}`, \{ tabId \}\)/, "the changes request should call the read-only Git file diff endpoint on the owning tab");
assert.match(snapshotSource, /if \(!response\.ok\) throw new Error\(response\.error \|\| "Failed to load Git changes for this file"\)/, "an ok:false response should surface a readable error");
assert.match(snapshotSource, /truncated: data\.truncated === true/, "truncation should be carried into the viewer snapshot");
assert.match(snapshotSource, /contentError: data\.error \? String\(data\.error\) : ""/, "an untracked read error should stay distinct from a request failure");
assert.match(snapshotSource, /return \{ \.\.\.snapshot, error: error\.message \|\| String\(error\) \};/, "a failed changes request should resolve to an error snapshot instead of rejecting the open");
assert.match(app, /let fileViewerGitChangesRequestSerial = 0;/, "Git changes opens should have a request identity counter");
assert.match(applySnapshotSource, /loading: true, requestSerial/, "the viewer should show an identified loading snapshot until the bounded diff arrives");
assert.match(
  applySnapshotSource,
  /const viewer = tabContext\.tabId === activeTabId \? activeFileViewer : fileViewersByTab\.get\(tabContext\.tabId\);\s*if \(!viewer\?\.gitChanges\?\.loading \|\| viewer\.path !== viewerPath \|\| viewer\.gitChanges\.requestSerial !== requestSerial\) return;/,
  "a late diff response should update the owning terminal's cached viewer while still rejecting stale viewer identities",
);

// --- Open flow: Git default, normal-open isolation, deleted files ---

assert.match(openSource, /category = "" \} = \{\}/, "Git opens should accept an optional side-panel category");
assert.match(openSource, /openFileInViewer\(target\.path, \{ gitCategory: category, gitPath: normalizeFileTreePath\(repoRelPath\) \}\)/, "Git opens should hand the category and repo path to the standard viewer");
assert.match(openFileSource, /async function openFileInViewer\(path = "", \{ gitCategory = "", gitPath = "" \} = \{\}\)/, "the standard viewer should accept optional Git context without changing its default signature");
assert.match(app, /let fileViewerOpenRequestSerial = 0;/, "file viewer opens should have a shared request identity counter");
assert.match(openFileSource, /const openRequestSerial = \+\+fileViewerOpenRequestSerial;/, "every viewer open should capture a unique request identity");
assert.match(openFileSource, /const category = gitFileDiffCategory\(gitCategory\);/, "the viewer should map the side-panel category through the shared allowlist");
assert.match(openFileSource, /const changesRequestSerial = category \? \+\+fileViewerGitChangesRequestSerial : 0;/, "each Git-originated open should receive a unique changes request identity");
assert.match(openFileSource, /const changesRequest = category \? loadGitFileChangesSnapshot\(changesPath, category, tabContext\.tabId\) : null;/, "only category-carrying opens should request a diff");
assert.match(openFileSource, /const gitChanges = changesRequest \? gitFileChangesPlaceholder\(category, changesPath, changesRequestSerial\) : null;/, "normal File-section opens should carry no Git snapshot at all");
assert.match(openFileSource, /applyGitFileChangesSnapshot\(changesRequest, tabContext, activeFileViewer\.path, changesRequestSerial\)/, "same-path Git requests should apply only through their captured request identity");
assert.match(openFileSource, /mode: gitChanges \? "changes" : data\.language === "markdown" \? "preview" : "source",/, "Git opens should default to Changes while normal opens keep the Markdown/Source default");
assert.match(openFileSource, /if \(!isCurrentTabContext\(tabContext\) \|\| openRequestSerial !== fileViewerOpenRequestSerial\) return;/, "the source-success path should reject stale same-tab viewer opens");
assert.match(openFileSource, /const gitChanges = changesRequest \? await changesRequest : null;\s*if \(!isCurrentTabContext\(tabContext\) \|\| openRequestSerial !== fileViewerOpenRequestSerial\) return;/, "the deleted-file fallback should reject stale same-tab viewer opens after awaiting the diff");
assert.match(openFileSource, /readOnly: false,\s*sourceAvailable: true,/, "a live Git-originated file should stay editable");
assert.match(
  openFileSource,
  /const gitChanges = changesRequest \? await changesRequest : null;\s*if \(!isCurrentTabContext\(tabContext\) \|\| openRequestSerial !== fileViewerOpenRequestSerial\) return;\s*if \(gitChanges && !gitChanges\.error\) \{/,
  "a current failed source load should fall back to the diff only when that diff actually loaded",
);
assert.match(openFileSource, /mode: "changes",\s*dirty: false,\s*readOnly: true,\s*sourceAvailable: false,/, "a deleted tracked file should open read-only in Changes mode");
assert.match(openFileSource, /setFileViewerStatus\("File content unavailable; showing Git changes \(read-only\)\.", "warn"\)/, "the deleted-file fallback should explain itself in the viewer status");
assert.match(openFileSource, /setFileViewerStatus\(message, "error"\);\s*addEvent\(`file open failed: \$\{message\}`, "error"\);/, "a total failure should still report the original open error");
assert.match(viewerPersistenceSource, /function resetFileViewerUi\(\) \{\s*fileViewerOpenRequestSerial \+= 1;\s*activeFileViewer = null;/, "resetting the visible viewer should invalidate pending source and deleted-file opens");
assert.match(viewerPersistenceSource, /elements\.fileViewerChanges\.hidden = true;\s*elements\.fileViewerChanges\.replaceChildren\(\);/, "resetting the visible viewer should clear the changes surface");
assert.match(moveSource, /gitChanges: null,/, "renaming the open file should drop its stale open-time diff snapshot");

// --- Per-terminal viewer persistence ---

assert.match(app, /let fileViewersByTab = new Map\(\);/, "open file viewers should be stored per terminal tab");
assert.match(app, /let fileViewerSelectionsByTab = new Map\(\);/, "viewer selections should be stored with their owning terminal tab");
assert.match(viewerPersistenceSource, /fileViewersByTab\.set\(tabId, activeFileViewer\)/, "caching a terminal should retain its active viewer object, including dirty edits and mode");
assert.match(viewerPersistenceSource, /fileViewerSelectionsByTab\.set\(tabId, fileViewerSelection\)/, "caching a terminal should retain its active file selection");
assert.match(viewerPersistenceSource, /activeFileViewer = activeTabId \? fileViewersByTab\.get\(activeTabId\) \|\| null : null;\s*fileViewerSelection = activeTabId \? fileViewerSelectionsByTab\.get\(activeTabId\) \|\| null : null;\s*updateFileViewerUi\(\);/, "activating a terminal should restore its own viewer and selection");
assert.match(viewerPersistenceSource, /function closeFileViewer\(\) \{\s*if \(activeTabId\) \{\s*fileViewersByTab\.delete\(activeTabId\);\s*fileViewerSelectionsByTab\.delete\(activeTabId\);/, "explicitly closing a viewer should remove only the active terminal's cached state");
assert.match(switchTabSource, /cacheActiveFileViewerForTab\(activeTabId\);\s*const tabContext = setActiveTabId\(tabId, \{ remember: true \}\);/, "switching terminals should cache the outgoing viewer before changing the active tab identity");
assert.match(resetActiveTabUiSource, /resetFileViewerUi\(\);\s*resetFileTreeState\(\);\s*restoreFileViewerForActiveTab\(\);/, "resetting tab UI should restore the incoming terminal's viewer instead of closing it");
assert.match(closeTabsSource, /fileViewersByTab\.delete\(id\);\s*fileViewerSelectionsByTab\.delete\(id\);/, "closing terminal tabs should discard their cached viewers and selections");

// --- Changes rendering contracts ---

const combined = JSON.parse(vm.runInNewContext(`${combinedSyntaxSource}\nJSON.stringify([
  gitFileDiffUsesCombinedSyntax("@@@ -1,4 -1,4 +1,6 @@@\\n context"),
  gitFileDiffUsesCombinedSyntax("diff --git a/x b/x\\n@@ -1,2 +1,3 @@\\n context"),
  gitFileDiffUsesCombinedSyntax(""),
])`, {}));

assert.deepEqual(combined, [true, false, false], "combined conflict hunks should be detected while ordinary unified hunks stay on the split renderer");

assert.match(changesRenderSource, /make\("section", `git-diff-section file-viewer-changes-section \$\{snapshot\.category \|\| ""\}`\.trim\(\)\)/, "the changes surface should reuse the shared Git diff section shell");
assert.match(changesRenderSource, /if \(snapshot\.loading\) wrapper\.append\(fileViewerChangesNotice\("Loading Git changes…"\)\);/, "a pending diff should render an explicit loading state");
assert.match(changesRenderSource, /else if \(snapshot\.error\) wrapper\.append\(fileViewerChangesNotice\(snapshot\.error, "error"\)\);/, "a failed diff should render an in-viewer error state");
assert.match(
  changesRenderSource,
  /wrapper\.append\(snapshot\.category === "untracked" \? renderFileViewerUntrackedChanges\(snapshot\) : renderFileViewerTrackedChanges\(snapshot\)\);/,
  "untracked files should use whole-file rendering while tracked categories use the diff renderer",
);
assert.match(changesRenderSource, /if \(snapshot\.truncated\) wrapper\.append\(renderFileViewerChangesTruncation\(snapshot\)\);/, "a truncated snapshot should be flagged in the viewer");
assert.match(changesRenderSource, /make\("div", "git-diff-truncated-notice"\)[\s\S]*formatBytes\(snapshot\.capBytes \|\| 0\)[\s\S]*make\("code", "git-tools-command", snapshot\.command \|\| "git diff"\)/, "the truncation notice should name the cap and the exact command");
assert.match(changesRenderSource, /if \(!diff\.trim\(\)\) return fileViewerChangesNotice\(`No \$\{String\(snapshot\.label \|\| "Git"\)\.toLowerCase\(\)\} changes for this file\.`\)/, "an empty diff should render an explicit empty state");
assert.match(changesRenderSource, /if \(gitFileDiffUsesCombinedSyntax\(diff\)\) return make\("pre", "git-diff-raw", diff\);/, "combined conflict syntax should fall back to readable raw diff text");
assert.match(changesRenderSource, /const files = parseGitUnifiedDiff\(diff\);[\s\S]*for \(const file of files\) fragment\.append\(renderGitDiffFile\(file\)\);/, "parsed diffs should render through the existing split Git grid");
assert.match(changesRenderSource, /if \(!files\.length\) return make\("pre", "git-diff-raw", diff\);/, "an unparsable diff should still show its raw text");
assert.match(changesRenderSource, /if \(entry\.error \|\| entry\.binary\) return renderGitUntrackedRawFile\(entry\);/, "binary or unreadable untracked files should show the shared notice instead of fake diff lines");
assert.match(changesRenderSource, /return renderGitDiffFile\(gitUntrackedEntryToDiffFile\(entry\)\);/, "verified untracked text should render as all-added lines");
assert.match(changesRenderSource, /if \(entry\.contentMissing\) return fileViewerChangesNotice\("Untracked file content is unavailable\.", "error"\);/, "an untracked response without content should not pretend the file is empty");
assert.doesNotMatch(changesRenderSource, /runGitFileAction|gitChangesFileActionsFor|gitFileActionButtons/, "the read-only changes surface must not expose staging or discard actions");

assert.match(css, /\.file-viewer-editor,\n\.file-viewer-preview,\n\.file-viewer-changes \{/, "the changes surface should share the file viewer content frame");
assert.match(css, /\.file-viewer-changes \{\n\s*padding: 0\.72rem;\n\}/, "the changes surface should have its own padding inside the shared frame");
assert.match(css, /\.file-viewer-changes \.git-diff-grid \{[\s\S]*grid-template-columns:[\s\S]*min-width: 30rem;[\s\S]*\}/, "the split diff grid should be narrowed for the file viewer pane");
assert.match(css, /\.file-viewer-changes-notice \{[\s\S]*font-size: var\(--text-xs\);[\s\S]*\}\n\.file-viewer-changes-notice\.error \{ color: var\(--ctp-red\); \}/, "changes notices should be readable and mark errors distinctly");

console.log("git panel file preview static tests passed");
