import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [app, css] = await Promise.all([
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
]);

function sourceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${label} source should be present`);
  return source.slice(start, end);
}

const ignoreHelpers = sourceBetween(app, "function fileTreeEntryGitIgnored(", "\nfunction fileTreeGitStatusClasses(", "Git-ignore helpers");
const renderSignature = sourceBetween(app, "function fileTreeEntryRenderSignature(", "\nfunction fileTreeRenderSignature(", "file tree entry render signature");
const searchEntry = sourceBetween(app, "function appendFileSearchEntry(", "\nasync function revealFileTreeEntry(", "file search entry renderer");
const treeEntry = sourceBetween(app, "function appendFileTreeEntry(", "\nasync function loadFileTreeDirectory(", "file tree entry renderer");
const ignoredCss = sourceBetween(css, ".file-tree-node.git-ignored > .file-tree-item {", "\n.file-tree-git-badge {", "Git-ignored row styles");

// Renderer source contract: additive payload consumption without disabling or hiding anything.
for (const [label, source] of [["browse", treeEntry], ["search", searchEntry]]) {
  assert.match(source, /const gitIgnored = fileTreeEntryGitIgnored\(entry\);/, `the ${label} renderer should read the additive Git-ignore decoration from the entry payload`);
  assert.match(source, /\$\{gitIgnored \? " git-ignored" : ""\}/, `the ${label} renderer should add a stable git-ignored node class`);
  assert.match(source, /button\.title = \[path \|\| "\.", fileTreeGitIgnoredTitle\(gitIgnored\), fileTreeGitStatusTitle\(gitStatus\)/, `the ${label} renderer should place ignore context in the row title without replacing Git status context`);
  assert.doesNotMatch(source, /disabled|aria-disabled|hidden|pointer-events/, `the ${label} renderer should never disable or hide ignored rows`);
}
assert.match(ignoreHelpers, /function fileTreeGitIgnoredTitle\(gitIgnored = false\) \{\s*return gitIgnored \? "Ignored by Git" : "";/, "ignored rows should carry the plain-language “Ignored by Git” explanation");
assert.match(renderSignature, /fileTreeEntryGitIgnored\(entry\),/, "entry render identity should include ignored state so live refreshes repaint changed rows");

// Render identity: an ignore-only transition must produce a different signature.
const signatureRuntime = { normalizeFileTreePath: (value) => String(value || "").replace(/^\/+|\/+$/g, "") };
vm.runInNewContext(`${ignoreHelpers}\n${renderSignature}\nthis.signature = fileTreeEntryRenderSignature;`, signatureRuntime);
const normalEntry = { name: "build.log", path: "build.log", type: "file", extension: ".log" };
const ignoredEntry = { ...normalEntry, gitIgnored: true };
assert.notDeepEqual(signatureRuntime.signature(ignoredEntry), signatureRuntime.signature(normalEntry), "an ignore-only change should invalidate the cached render signature");
assert.equal(signatureRuntime.signature(ignoredEntry).includes(true), true, "the signature should carry the ignored boolean");
assert.equal(signatureRuntime.signature(normalEntry).includes(true), false, "ordinary entries should keep a false ignored signature component");

function fakeNode(tag, className = "", text = "") {
  return {
    tag,
    className,
    textContent: text,
    title: "",
    children: [],
    attributes: new Map(),
    listeners: {},
    dataset: {},
    style: { setProperty() {} },
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    addEventListener(name, listener) { this.listeners[name] = listener; },
  };
}

const dragBindings = [];
const openedFiles = [];
const contextMenuEntries = [];
const fileTreeState = {
  expanded: new Set(["ignored-dir"]),
  loading: new Set(),
  selectedPath: "",
  searchQuery: "log",
  entriesByPath: new Map([["ignored-dir", [{ name: "nested.log", path: "ignored-dir/nested.log", type: "file", extension: ".log", gitIgnored: true }]]]),
  gitStatusByPath: new Map(),
};
const runtime = {
  fileTreeState,
  normalizeFileTreePath: signatureRuntime.normalizeFileTreePath,
  fileTreeGitStatusForEntry: () => null,
  fileTreeGitStatusClasses: () => "",
  fileTreeGitStatusTitle: () => "",
  fileTreeGitStatusBadge: () => null,
  fileParentPath: (value) => String(value || "").split("/").slice(0, -1).join("/"),
  fileDisplayName: (value) => String(value || "").split("/").pop() || ".",
  make: fakeNode,
  fileTreeExpander: (expanded) => fakeNode("span", "file-tree-expander", expanded ? "▾" : "▸"),
  fileEntryIcon: () => "TXT",
  openFileInViewer: (path) => { openedFiles.push(path); },
  toggleFileTreeDirectory: async () => {},
  addEvent: () => {},
  showFileContextMenu: (event, entry) => { contextMenuEntries.push(entry); },
  bindFileTreeDragAndDrop: (button, item, entry) => { dragBindings.push(entry.path); },
  fileTreeOverflowButton: () => fakeNode("button", "file-tree-overflow-button", "⋯"),
};
vm.runInNewContext(`${ignoreHelpers}\n${searchEntry}\n${treeEntry}\nthis.renderSearchEntry = appendFileSearchEntry;\nthis.renderTreeEntry = appendFileTreeEntry;`, runtime);

const ignoredFile = { name: "build.log", path: "build.log", type: "file", extension: ".log", gitIgnored: true };
const ordinaryFile = { name: "index.js", path: "index.js", type: "file", extension: ".js" };
const ignoredDirectory = { name: "ignored-dir", path: "ignored-dir", type: "directory", directory: true, gitIgnored: true };

function renderRow(render, entry, ...rest) {
  const parent = fakeNode("ul");
  render(parent, entry, ...rest);
  const item = parent.children[0];
  return { item, button: item.children[0] };
}

for (const [label, render, extra] of [["browse", runtime.renderTreeEntry, [0]], ["search", runtime.renderSearchEntry, []]]) {
  fileTreeState.selectedPath = "";
  const ignoredRow = renderRow(render, ignoredFile, ...extra);
  const ordinaryRow = renderRow(render, ordinaryFile, ...extra);
  assert.match(ignoredRow.item.className, /(^| )git-ignored( |$)/, `${label} rows should expose a stable ignored class`);
  assert.doesNotMatch(ordinaryRow.item.className, /git-ignored/, `${label} rows without the decoration should stay unmarked`);
  assert.equal(ignoredRow.button.title, "build.log\nIgnored by Git", `${label} rows should explain the ignored state in the row title`);
  assert.equal(ordinaryRow.button.title, "index.js", `${label} rows should keep the plain path title when not ignored`);
  assert.match(ignoredRow.button.className, /file-tree-item/, `${label} ignored rows should keep the normal row button class`);
  assert.equal(ignoredRow.button.attributes.get("role"), "treeitem", `${label} ignored rows should stay tree items`);
  assert.equal(ignoredRow.button.attributes.get("aria-selected"), "false", `${label} ignored rows should keep selection semantics`);
  assert.equal(ignoredRow.button.attributes.has("aria-disabled"), false, `${label} ignored rows should never be marked disabled`);
  assert.equal(ignoredRow.button.attributes.has("hidden"), false, `${label} ignored rows should never be hidden`);
  assert.equal(typeof ignoredRow.button.listeners.click, "function", `${label} ignored rows should keep their activation handler`);
  assert.equal(typeof ignoredRow.button.listeners.contextmenu, "function", `${label} ignored rows should keep their context menu`);
  assert.equal(ignoredRow.item.children.at(-1).className, "file-tree-overflow-button", `${label} ignored rows should keep the overflow action`);
  ignoredRow.button.listeners.click();
  ignoredRow.button.listeners.contextmenu({});
  assert.equal(fileTreeState.selectedPath, "build.log", `${label} ignored rows should still become the selected entry`);
}
fileTreeState.selectedPath = "";
assert.deepEqual(openedFiles, ["build.log", "build.log"], "ignored files should still open in the viewer from both renderers");
assert.deepEqual(contextMenuEntries, [ignoredFile, ignoredFile], "ignored rows should still reach the file context menu from both renderers");
assert.deepEqual(dragBindings.filter((path) => path === "build.log").length, 2, "ignored rows should keep drag-and-drop wiring in both renderers");

const nestedSearchRow = renderRow(runtime.renderSearchEntry, ignoredDirectory);
assert.match(nestedSearchRow.item.className, /git-ignored/, "ignored directories should be marked in search results");
const nestedList = nestedSearchRow.item.children.find((child) => child.className === "file-tree-list");
assert.ok(nestedList, "expanded ignored directories should still render their children");
assert.match(nestedList.children[0].className, /git-ignored/, "nested rows inside an ignored directory should be marked from their own payload");
assert.equal(nestedList.children[0].children[0].title, "ignored-dir/nested.log\nIgnored by Git", "nested ignored rows should carry the same explanation");

// Styling contract: explicit muted colors, no resting whole-row opacity, stronger state feedback retained.
assert.match(ignoredCss, /\.file-tree-node\.git-ignored > \.file-tree-item \{[^}]*color: rgba\(var\(--ctp-overlay-rgb\)[^}]*border-color: rgba\([^}]*background: rgba\(var\(--ctp-crust-rgb\)/, "the resting ignored row should use explicit muted color, border, and background values");
assert.doesNotMatch(ignoredCss, /opacity:/, "the muted treatment should not rely on whole-row opacity that would hurt readability");
for (const [label, selector] of [
  ["hover and focus", /\.file-tree-node\.git-ignored > \.file-tree-item:hover,\s*\.file-tree-node\.git-ignored > \.file-tree-item:focus-visible \{[^}]*box-shadow: inset 2px 0 0 var\(--ctp-blue\)/],
  ["selection", /\.file-tree-node\.git-ignored\.selected > \.file-tree-item,\s*\.file-tree-node\.git-ignored > \.file-tree-item\[aria-selected="true"\] \{[^}]*box-shadow: inset 3px 0 0 var\(--ctp-teal\)/],
  ["Git status", /\.file-tree-node\.git-ignored\.git-changed > \.file-tree-item \{[^}]*box-shadow: inset 2px 0 0 var\(--file-tree-git-color\)/],
  ["drag", /\.file-tree-node\.git-ignored\.dragging > \.file-tree-item \{[^}]*cursor: grabbing/],
  ["drop target", /\.file-tree-node\.git-ignored\.drop-target > \.file-tree-item \{[^}]*box-shadow: inset 2px 0 0 var\(--ctp-green\)/],
  ["blocked drop", /\.file-tree-node\.git-ignored\.drop-blocked > \.file-tree-item \{[^}]*box-shadow: inset 2px 0 0 var\(--ctp-red\)/],
]) {
  assert.match(ignoredCss, selector, `${label} feedback should still win over the resting muted treatment`);
}
assert.match(ignoredCss, /\.file-tree-node\.git-ignored > \.file-tree-item \.file-tree-kind,\s*\.file-tree-node\.git-ignored > \.file-tree-item \.file-tree-search-path \{/, "browse and search metadata should be muted together");

console.log("file-tree-git-ignored-static.test.mjs passed");
