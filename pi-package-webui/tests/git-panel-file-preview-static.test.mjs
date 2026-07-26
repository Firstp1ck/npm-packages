import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [app, css] = await Promise.all([
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
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
assert.match(openSource, /target\.tabId !== activeTabId[\s\S]*await switchTab\(target\.tabId\)[\s\S]*openFileInViewer\(target\.path\)/, "Git file opening should activate the owning tab before using the standard WebUI viewer");
assert.match(openSource, /its terminal tab is no longer available/, "a stale Git-card tab should produce visible failure feedback");
assert.match(renderSource, /row\.setAttribute\("role", "button"\)/, "Git file rows should expose button semantics");
assert.match(renderSource, /row\.addEventListener\("click", open\)/, "clicking a Git file row should open its preview");
assert.match(renderSource, /event\.repeat \|\| \(event\.key !== "Enter" && event\.key !== " "\)/, "Git file rows should support keyboard activation without key-repeat request bursts");
assert.match(renderSource, /openGitFileInViewer\(entry\.path, \{ root: card\.root, candidates: card\.candidates \}\)/, "Git file rows should pass repository context to the shared preview flow");
assert.match(css, /\.git-side-panel-file \{[^}]*cursor: pointer;[^}]*\}/, "Git file rows should visually indicate their primary open action");

console.log("git panel file preview static tests passed");
