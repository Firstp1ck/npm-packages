import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [server, watcher, app] = await Promise.all([
  readFile(join(root, "bin", "pi-webui.mjs"), "utf8"),
  readFile(join(root, "lib", "workspace-files-live-watcher.mjs"), "utf8"),
  readFile(join(root, "public", "app.js"), "utf8"),
]);

function functionBody(source, name) {
  const syncStart = source.indexOf(`function ${name}(`);
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = syncStart === -1 ? asyncStart : asyncStart === -1 ? syncStart : Math.min(syncStart, asyncStart);
  assert.notEqual(start, -1, `${name} should be defined`);
  const nextSync = source.indexOf("\nfunction ", start + 1);
  const nextAsync = source.indexOf("\nasync function ", start + 1);
  const candidates = [nextSync, nextAsync].filter((index) => index !== -1);
  return source.slice(start, candidates.length ? Math.min(...candidates) : source.length);
}

const createTab = functionBody(server, "createTab");
const hydrateManagedTabs = functionBody(server, "hydrateManagedTabs");
const updateTabCwd = functionBody(server, "performTabCwdUpdate");
const closeTab = functionBody(server, "closeTab");
const discardTab = functionBody(server, "discardTab");
const shutdown = functionBody(server, "shutdown");

assert.match(server, /import \{ createWorkspaceFilesLiveWatcher \} from "\.\.\/lib\/workspace-files-live-watcher\.mjs";/, "the dedicated workspace watcher should be imported");
assert.match(watcher, /watch\(root, \{ recursive: true, persistent: false \}/, "workspace watches should be recursive and non-persistent");
assert.match(watcher, /record\.tabIds = new Set\(record\.tabs\)/, "filesystem changes should snapshot affected tabs");
assert.match(watcher, /maximumWaitMs[\s\S]*remainingMs[\s\S]*Math\.min\(delayMs, remainingMs\)/, "continuous changes should be bounded by the maximum wait");
assert.match(watcher, /onChange\(\{ root, tabIds, changedAt:/, "watcher notifications should carry tab ids, root, and time");
assert.match(watcher, /record\.watcher\.on\?\.\("error", \(error\) => failRoot\(root, error\)\)/, "runtime watcher errors should be non-fatal");
assert.match(watcher, /catch \(error\) \{[\s\S]*?roots\.delete\(root\);[\s\S]*?reportError\(root, error\);[\s\S]*?return null;/, "watcher startup errors should be non-fatal");
assert.match(watcher, /if \(!record\.tabs\.size\) closeRoot/, "the last workspace subscriber should release its watcher");
assert.match(watcher, /function closeAll\(\)[\s\S]*closeRoot\(root\)/, "closeAll should release every workspace watcher");

assert.match(server, /const workspaceFilesLiveWatcher = createWorkspaceFilesLiveWatcher\(\{[\s\S]*?onChange: \(\{ root, tabIds, changedAt \}\)[\s\S]*?for \(const tabId of tabIds\)[\s\S]*?workspaceFilesLiveWatcher\.subscribedRootForTab\(tab\.id\) !== root[\s\S]*?broadcastTabEvent\(tab, \{ type: "webui_workspace_files_changed", tabId: tab\.id, root, changedAt \}\)/, "workspace changes should emit only to still-subscribed affected tabs with the approved event shape");
assert.match(server, /webui_workspace_files_watch_error[\s\S]*sanitizeError\(error\)/, "workspace watcher diagnostics should sanitize errors");

assert.match(createTab, /tabs\.set\(id, tab\);\s*workspaceFilesLiveWatcher\.subscribe\(tab\.id, tab\.cwd\)/, "new tabs should subscribe their workspace");
assert.match(createTab, /gitLiveWatcher\.unsubscribe\(id\);\s*workspaceFilesLiveWatcher\.unsubscribe\(id\);\s*tabs\.delete\(id\);/, "failed tab creation should release the workspace watcher");
assert.match(hydrateManagedTabs, /tabs\.set\(tab\.id, tab\);\s*workspaceFilesLiveWatcher\.subscribe\(tab\.id, tab\.cwd\);/, "hydrated tabs should subscribe their workspace");
assert.match(hydrateManagedTabs, /tab\.rpc\.dispose\?\.\(\);\s*workspaceFilesLiveWatcher\.unsubscribe\(tab\.id\);\s*tabs\.delete\(tab\.id\);/, "failed hydration should release workspace subscriptions");
assert.match(updateTabCwd, /tab\.cwd = nextCwd;[\s\S]*?workspaceFilesLiveWatcher\.unsubscribe\(tab\.id\);\s*workspaceFilesLiveWatcher\.subscribe\(tab\.id, tab\.cwd\);/, "cwd changes should replace workspace subscriptions");
assert.match(closeTab, /workspaceFilesLiveWatcher\.unsubscribe\(tab\.id\)/, "tab closure should release workspace subscriptions");
assert.match(discardTab, /workspaceFilesLiveWatcher\.unsubscribe\(tab\.id\)/, "discarded tabs should release workspace subscriptions");
assert.match(shutdown, /workspaceFilesLiveWatcher\.closeAll\(\)/, "server shutdown should release all workspace watchers");

// WS2 client-side contract assertions.
const handleEvent = functionBody(app, "handleEvent");
const liveRefresh = functionBody(app, "refreshFileTreeLive");
const liveDirectories = functionBody(app, "refreshLoadedFileTreeDirectories");

assert.match(handleEvent, /case "webui_workspace_files_changed":\s*if \(event\.tabId && event\.tabId !== activeTabId\) break;\s*refreshFileTreeLive\(tabContext\)\.catch/, "workspace file changes should refresh only the matching active tab");

assert.match(liveRefresh, /fileTreeSearchQueryText\(\)[\s\S]*?await runFileTreeSearch\(\)[\s\S]*?await refreshLoadedFileTreeDirectories\(refreshContext\)/, "live refresh should rerun an active search or refresh loaded directories");
assert.match(liveRefresh, /if \(fileTreeLiveRefreshInProgress\) \{\s*fileTreeLiveRefreshPendingContext = tabContext;\s*return;\s*\}/, "events arriving during a refresh should retain the pending tab context");
assert.match(liveRefresh, /refreshContext = fileTreeLiveRefreshPendingContext/, "a queued follow-up pass should replay the latest matching tab context");
assert.match(liveRefresh, /pendingContext && isCurrentTabContext\(pendingContext\)[\s\S]*?retryContext && isCurrentTabContext\(retryContext\)/, "completion should prefer a pending current-tab event over a same-tab loading retry");
assert.match(liveRefresh, /fileTreeLiveRefreshRetryTimer = setTimeout\([\s\S]*?refreshFileTreeLive\(nextContext\)/, "loading collisions should schedule a bounded follow-up refresh");

assert.match(liveDirectories, /if \(fileTreeState\.loading\.has\(FILE_TREE_ROOT_PATH\)\) return true;\s*await loadFileTreeDirectory\(FILE_TREE_ROOT_PATH, \{ force: true \}\);[\s\S]*?collectDirectories\(FILE_TREE_ROOT_PATH\);[\s\S]*?for \(const path of cachedDirectories\)/, "the root directory should reload first, or request a retry when it is already loading");
assert.match(liveDirectories, /\.sort\(\(a, b\) => a\.split\("\/"\)\.length - b\.split\("\/"\)\.length/, "loaded directories should refresh shallow-to-deep");
assert.match(liveDirectories, /if \(!knownDirectories\.has\(path\)\) \{\s*clearFileTreeEntryCache\(path\);\s*continue;\s*\}/, "directories missing after reload should be pruned from caches and expansion");
assert.match(liveDirectories, /if \(fileTreeState\.loading\.has\(path\)\) \{\s*skippedLoadingDirectory = true;\s*collectDirectories\(path\);\s*continue;\s*\}/, "already-loading directories should be preserved for a follow-up retry instead of being silently skipped or pruned");
assert.match(liveDirectories, /await loadFileTreeDirectory\(path, \{ force: true \}\);[\s\S]*?collectDirectories\(path\)/, "only directories still present should be reloaded and kept");
assert.ok(!liveRefresh.includes("expanded.clear()") && !liveDirectories.includes("expanded.clear()"), "live refresh should preserve still-valid expanded directories");

console.log("workspace-files-live-updates-static.test.mjs passed");
