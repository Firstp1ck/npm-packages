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

const searchEntry = sourceBetween(app, "function appendFileSearchEntry(", "\nasync function revealFileTreeEntry(", "file search entry renderer");
const revealSearchEntry = sourceBetween(app, "async function revealFileTreeEntry(", "\nfunction appendFileTreeEntry(", "file search reveal behavior");
const clearSearch = sourceBetween(app, "function focusVisibleFileTreeSelection(", "\nasync function runFileTreeSearch(", "file search clear behavior");
const searchLabelCss = sourceBetween(css, ".file-tree-search-label {", "\n.file-tree-kind {", "file search row styles");

assert.match(
  searchEntry,
  /const contextPath = fileParentPath\(path\) \|\| "\.";[\s\S]*make\("span", "file-tree-name"[\s\S]*make\("span", "file-tree-search-path", contextPath\)/,
  "search results should pair the prominent match name with compact parent-path context",
);
assert.doesNotMatch(searchEntry, /clearFileTreeSearch\(/, "opening a file or directory search result should not clear the active query");
assert.match(
  searchEntry,
  /const expanded = isDirectory && fileTreeState\.expanded\.has\(path\);[\s\S]*aria-expanded[\s\S]*fileTreeExpander\(expanded\)[\s\S]*toggleFileTreeDirectory\(path\)/,
  "directory search results should expose and toggle their live expansion state without leaving search",
);
assert.match(
  searchEntry,
  /if \(isDirectory && expanded\)[\s\S]*entriesByPath\.get\(path\)[\s\S]*appendFileTreeEntry\(childList, child, 1\)/,
  "expanded search directories should render their loaded children as a nested tree",
);
assert.doesNotMatch(revealSearchEntry, /clearFileTreeSearch\(/, "revealing a directory should preserve search while preparing the underlying tree state");
assert.match(
  revealSearchEntry,
  /fileTreeState\.selectedPath = targetPath;[\s\S]*loadFileTreeDirectory\(FILE_TREE_ROOT_PATH\)[\s\S]*fileTreeState\.expanded\.add/,
  "context-menu reveal should still select, load, and expand the target behind the active search",
);
assert.match(
  clearSearch,
  /const selectedPath = normalizeFileTreePath[\s\S]*const selectedEntry = fileTreeState\.searchEntries\.find[\s\S]*const commitClear = \(\) => \{[\s\S]*fileTreeState\.searchQuery = "";[\s\S]*renderFileTree\(\);[\s\S]*focusVisibleFileTreeSelection\(selectedPath\)[\s\S]*revealFileTreeEntry\(selectedEntry, \{ expandTarget: selectedDirectoryExpanded \}\)\.then\(commitClear\)/,
  "clearing search should prepare the selected branch before atomically restoring and focusing the normal tree",
);
assert.match(
  searchLabelCss,
  /\.file-tree-search-label \{[\s\S]*display: flex;[\s\S]*align-items: baseline;[\s\S]*white-space: nowrap;/,
  "search result labels should remain on one compact line",
);
assert.match(
  searchLabelCss,
  /\.file-tree-search-item \{\s*grid-template-columns: auto auto minmax\(0, 1fr\) auto auto;/,
  "search rows should preserve the normal tree column order for expander, icon, label, Git badge, and kind",
);
assert.doesNotMatch(searchLabelCss, /\.file-tree-search-label \{[\s\S]*?display: grid;/, "search labels should not return to the former two-line grid layout");

function fakeNode(tag, className = "", text = "") {
  return {
    tag,
    className,
    textContent: text,
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

const toggledPaths = [];
const renderedChildren = [];
const fileTreeState = {
  expanded: new Set(),
  loading: new Set(),
  selectedPath: "",
  searchQuery: "webui",
  entriesByPath: new Map([["packages", [{ name: "child.js", path: "packages/child.js", type: "file" }]]]),
};
const runtime = {
  fileTreeState,
  normalizeFileTreePath: (value) => String(value || "").replace(/^\/+|\/+$/g, ""),
  fileTreeGitStatusForEntry: () => null,
  fileTreeGitStatusClasses: () => "",
  fileTreeGitStatusTitle: () => "",
  fileParentPath: (value) => String(value || "").split("/").slice(0, -1).join("/"),
  fileDisplayName: (value) => String(value || "").split("/").pop() || ".",
  make: fakeNode,
  fileTreeExpander: (expanded) => fakeNode("span", "file-tree-expander", expanded ? "▾" : "▸"),
  fileEntryIcon: () => "DIR",
  fileTreeGitStatusBadge: () => null,
  openFileInViewer: () => {},
  toggleFileTreeDirectory: async (path) => { toggledPaths.push(path); },
  addEvent: () => {},
  showFileContextMenu: () => {},
  bindFileTreeDragAndDrop: () => {},
  fileTreeOverflowButton: () => fakeNode("button", "file-tree-overflow-button", "⋯"),
  appendFileTreeEntry: (parent, child, depth) => { renderedChildren.push({ child, depth }); parent.append(fakeNode("li", "file-tree-node", child.name)); },
};
vm.runInNewContext(`${searchEntry}\nthis.renderSearchEntry = appendFileSearchEntry;`, runtime);

const directory = { name: "packages", path: "packages", type: "directory", directory: true };
const collapsedParent = fakeNode("ul");
runtime.renderSearchEntry(collapsedParent, directory);
const collapsedButton = collapsedParent.children[0].children[0];
assert.equal(collapsedButton.attributes.get("aria-expanded"), "false", "search directories should initially report their collapsed state");
collapsedButton.listeners.click();
await Promise.resolve();
assert.deepEqual(toggledPaths, ["packages"], "clicking a search directory should toggle that directory in place");
assert.equal(fileTreeState.searchQuery, "webui", "clicking a search directory should preserve the active query");

fileTreeState.expanded.add("packages");
const expandedParent = fakeNode("ul");
runtime.renderSearchEntry(expandedParent, directory);
const expandedItem = expandedParent.children[0];
assert.equal(expandedItem.children[0].attributes.get("aria-expanded"), "true", "expanded search directories should expose their state");
assert.equal(expandedItem.children[2].className, "file-tree-list", "expanded search directories should append a nested child list");
assert.deepEqual(renderedChildren, [{ child: fileTreeState.entriesByPath.get("packages")[0], depth: 1 }], "expanded search directories should render cached children one level deeper");

function focusableTreeItem(path) {
  return {
    dataset: { path },
    focusCalls: 0,
    scrollCalls: 0,
    focus() { this.focusCalls += 1; },
    scrollIntoView() { this.scrollCalls += 1; },
  };
}

const nestedFile = { name: "child.js", path: "packages/child.js", type: "file" };
const clearState = {
  selectedPath: nestedFile.path,
  searchQuery: "child",
  searchEntries: [nestedFile],
  searchLoading: false,
  searchTruncated: false,
  searchTotal: 1,
  expanded: new Set(["packages"]),
  entriesByPath: new Map([["", [{ name: "packages", path: "packages", type: "directory", directory: true }]]]),
};
const selectedRow = focusableTreeItem(nestedFile.path);
let visibleRows = [];
let revealCall = null;
let resolveReveal;
let renderCalls = 0;
const revealReady = new Promise((resolve) => { resolveReveal = resolve; });
const searchInput = { value: "child", focusCalls: 0, focus() { this.focusCalls += 1; } };
const clearRuntime = {
  fileTreeState: clearState,
  fileTreeSearchTimer: null,
  fileTreeSearchRequestSerial: 0,
  FILE_TREE_ROOT_PATH: "",
  elements: { fileTreeSearchInput: searchInput },
  clearTimeout: () => {},
  normalizeFileTreePath: runtime.normalizeFileTreePath,
  fileTreeSearchQueryText: () => searchInput.value.trim(),
  fileEntryByPath: () => nestedFile,
  updateFileTreeSearchControls: () => {},
  fileTreeEntriesStatus: () => "1 item.",
  setFileTreeStatus: () => {},
  renderFileTree: () => { renderCalls += 1; },
  visibleFileTreeItems: () => visibleRows,
  revealFileTreeEntry: (entry, options) => { revealCall = { entry, options }; return revealReady; },
  addEvent: () => {},
};
vm.runInNewContext(`${clearSearch}\nthis.clearSearch = clearFileTreeSearch;`, clearRuntime);
clearRuntime.clearSearch({ focus: true });
assert.equal(searchInput.value, "", "clearing search should empty the field immediately");
assert.equal(clearState.searchQuery, "child", "the search result tree should remain rendered while the selected branch is prepared");
assert.equal(renderCalls, 0, "clearing should not flash a fully collapsed root tree before reveal completes");
assert.equal(revealCall?.entry, nestedFile, "the selected nested entry should be prepared before clearing search state");
assert.equal(revealCall?.options?.expandTarget, false, "revealing a selected file should not treat it as an expandable directory");

visibleRows = [selectedRow];
resolveReveal();
await revealReady;
await Promise.resolve();
assert.equal(clearState.searchQuery, "", "search state should clear after the selected branch is ready");
assert.equal(clearState.searchEntries.length, 0, "search matches should clear only during the final tree transition");
assert.equal(renderCalls, 1, "the prepared normal tree should render in one committed transition");
assert.equal(selectedRow.focusCalls, 1, "the selected row should receive focus after its ancestors are ready");
assert.equal(selectedRow.scrollCalls, 1, "the selected row should be scrolled into view after the transition");
assert.equal(searchInput.focusCalls, 0, "the search input should not steal focus back from the selected row");

const packageDirectory = { name: "package", path: "package", type: "directory", directory: true };
const libDirectory = { name: "lib", path: "package/lib", type: "directory", directory: true };
const integrationFile = { name: "remote-core.mjs", path: "package/lib/remote-core.mjs", type: "file" };
const integrationRow = focusableTreeItem(integrationFile.path);
const integrationState = {
  selectedPath: integrationFile.path,
  searchQuery: "webui",
  searchEntries: [libDirectory],
  searchLoading: false,
  searchTruncated: false,
  searchTotal: 1,
  expanded: new Set([libDirectory.path]),
  entriesByPath: new Map([
    ["", [packageDirectory]],
    [libDirectory.path, [integrationFile]],
  ]),
};
const integrationInput = { value: "webui", focusCalls: 0, focus() { this.focusCalls += 1; } };
const integrationRenderModes = [];
const integrationLoadCalls = [];
let integrationVisibleRows = [];
const integrationRuntime = {
  fileTreeState: integrationState,
  fileTreeSearchTimer: null,
  fileTreeSearchRequestSerial: 0,
  FILE_TREE_ROOT_PATH: "",
  elements: { fileTreeSearchInput: integrationInput },
  clearTimeout: () => {},
  normalizeFileTreePath: runtime.normalizeFileTreePath,
  fileParentPath: runtime.fileParentPath,
  fileTreeSearchQueryText: () => integrationInput.value.trim(),
  fileEntryByPath: (path) => {
    for (const entries of integrationState.entriesByPath.values()) {
      const entry = entries.find((candidate) => candidate.path === path);
      if (entry) return entry;
    }
    return null;
  },
  updateFileTreeSearchControls: () => {},
  fileTreeEntriesStatus: () => "1 item.",
  setFileTreeStatus: () => {},
  visibleFileTreeItems: () => integrationVisibleRows,
  loadFileTreeDirectory: async (path) => {
    integrationLoadCalls.push(path);
    if (path === packageDirectory.path) integrationState.entriesByPath.set(path, [libDirectory]);
    return integrationState.entriesByPath.get(path) || [];
  },
  renderFileTree: () => {
    const mode = integrationState.searchQuery ? "search" : "tree";
    integrationRenderModes.push(mode);
    if (mode === "tree" && integrationState.expanded.has(packageDirectory.path) && integrationState.expanded.has(libDirectory.path)) {
      integrationVisibleRows = [integrationRow];
    }
  },
  addEvent: () => {},
};
vm.runInNewContext(`${revealSearchEntry}\n${clearSearch}\nthis.clearSearch = clearFileTreeSearch;`, integrationRuntime);
integrationRuntime.clearSearch({ focus: true });
for (let index = 0; index < 12; index += 1) await Promise.resolve();
assert.deepEqual(integrationLoadCalls, ["", packageDirectory.path, libDirectory.path], "clearing should load the selected file's complete ancestor chain");
assert.equal(integrationState.expanded.has(packageDirectory.path), true, "the selected file's top-level directory should remain expanded");
assert.equal(integrationState.expanded.has(libDirectory.path), true, "the directory opened during search should remain expanded");
assert.equal(integrationRenderModes.at(-1), "tree", "the final render should restore the normal tree");
assert.equal(integrationRenderModes.slice(0, -1).every((mode) => mode === "search"), true, "ancestor preparation should retain the search results until the normal tree is ready");
assert.equal(integrationRow.focusCalls, 1, "the selected file should receive focus in the restored normal tree");
assert.equal(integrationRow.scrollCalls, 1, "the restored normal tree should scroll to the selected file");

console.log("file-tree-search-layout-static.test.mjs passed");
