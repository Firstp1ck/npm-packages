import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");
const [html, app, css] = await Promise.all([
  read("public/index.html"),
  read("public/app.js"),
  read("public/styles.css"),
]);

const actionStart = html.indexOf('<div class="terminal-sidebar-actions"');
const actionEnd = html.indexOf("</div>", actionStart);
const saveButton = html.indexOf('id="workspaceSaveButton"', actionStart);
assert.ok(actionStart >= 0 && saveButton > actionStart && saveButton < actionEnd, "Save workspace must be a header action");
assert.match(html, /workspaceSaveButton[\s\S]*?aria-label="Save workspace"/, "Save workspace must be labelled");
assert.match(app, /applyStyledTooltip\(elements\.workspaceSaveButton,[\s\S]*?floating: false/, "Save workspace must keep only its dedicated styled tooltip instead of also binding the shared floating tooltip");

assert.match(app, /function saveWebuiWorkspace[\s\S]*?api\("\/api\/workspaces", \{ method: "POST", body, scoped: false \}\)/, "Save must use an unscoped workspace API call");
assert.match(app, /function refreshSavedWorkspaces[\s\S]*?api\("\/api\/workspaces", \{ scoped: false \}\)/, "Workspace list must use an unscoped API call");
assert.match(app, /function deleteWebuiWorkspace[\s\S]*?method: "DELETE", scoped: false/, "Delete must use an unscoped API call");
assert.match(app, /function saveWebuiWorkspace[\s\S]*?appConfirm\(\{[\s\S]*?confirmLabel: "Overwrite"/, "Duplicate saves must use the existing confirmation modal");

const loadStart = app.indexOf("async function loadWebuiWorkspace");
const loadEnd = app.indexOf("async function deleteWebuiWorkspace", loadStart);
const loadFlow = app.slice(loadStart, loadEnd);
assert.ok(loadStart >= 0 && loadEnd > loadStart, "Load flow must be defined before delete flow");
assert.match(loadFlow, /\/api\/workspaces\/\$\{encodeURIComponent\(workspaceId\)\}\/load/, "Load must call the workspace load endpoint");
assert.match(loadFlow, /scoped: false/, "Load must be unscoped");
assert.ok(loadFlow.indexOf("await refreshTabs();") < loadFlow.indexOf("installLoadedWorkspaceGroups"), "Tabs must refresh before restored groups are installed");
assert.match(loadFlow, /await hydrateLoadedWorkspaceActiveTab\(data\.activeTabId\)/, "Load must hydrate the restored active tab even when refreshTabs selected it already");
assert.match(loadFlow, /settleUndoToast\(/, "Load must show a bounded restore summary");
assert.match(loadFlow, /addEvent\(/, "Load must record restore warnings/events");

assert.match(app, /function hydrateLoadedWorkspaceActiveTab[\s\S]*?connectEvents\(tabContext\);[\s\S]*?await refreshAll\(tabContext\)/, "A restored tab already selected by refreshTabs must still connect events and hydrate session state");
assert.match(app, /function installLoadedWorkspaceGroups[\s\S]*?terminalCustomGroups = new Map\(\);[\s\S]*?nextTerminalCustomGroupId\(\)[\s\S]*?persistTerminalCustomGroups\(\)/, "Restored groups must replace stale groups, use local ids, and persist");
assert.match(app, /const TERMINAL_CUSTOM_GROUPS_STORAGE_KEY = "pi-webui-terminal-custom-groups-v1"/, "The existing custom-group storage key must remain unchanged");
assert.match(app, /const savedWorkspacePanel = !tabs\.length \? renderSavedWorkspacePicker\(\) : null/, "The saved-workspace picker must be dashboard-only at zero tabs");
assert.match(app, /label: "Workspace: Save"/, "The command palette must offer workspace save when tabs exist");
assert.match(app, /label: "Workspace: Load…"/, "The command palette must offer workspace load when no tabs exist");
assert.match(app, /function closeAllTerminalTabs[\s\S]*?allowEmpty: true/, "Close all must permit the planned zero-tab workspace-load state");
assert.match(app, /function closeTerminalTabs[\s\S]*?if \(!tabs\.length\) setWorkspaceDashboardCollapsed\(false, \{ persist: false \}\)/, "Closing all tabs must reveal the workspace picker dashboard");
assert.match(app, /function initializeTabs[\s\S]*?if \(!saved\.length\) await createFirstTerminalTabFromChosenDirectory\(\)/, "Fresh installs without saved workspaces must retain the first-terminal cwd prompt");

assert.match(css, /body\.terminal-tabs-left \.terminal-sidebar-actions \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/, "The left tab layout must provide four action slots");
assert.match(css, /\.workspace-saved-workspaces/, "Saved-workspace picker styles must be scoped");
assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.workspace-saved-workspace-actions button \{ flex: 1 1 7rem; min-height: 44px; \}/, "Saved-workspace actions must stay touch-friendly on narrow layouts");

console.log("workspace-save-load-static.test.mjs passed");
