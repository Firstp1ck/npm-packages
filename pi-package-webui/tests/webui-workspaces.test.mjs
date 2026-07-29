import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import {
  WEBUI_WORKSPACE_LIMIT,
  WEBUI_WORKSPACE_TAB_LIMIT,
  deleteWebuiWorkspace,
  getWebuiWorkspace,
  listWebuiWorkspaces,
  normalizeWebuiWorkspaces,
  readWebuiWorkspaces,
  saveWebuiWorkspace,
  webuiWorkspacesFile,
} from "../lib/webui-workspaces.mjs";

function tab(id, cwd, index = 1) {
  return {
    id,
    index,
    title: `Tab ${index}`,
    titleSource: "explicit",
    conversationStarted: index % 2 === 0,
    cwd,
    sessionFile: path.join(cwd, `${id}.jsonl`),
  };
}

const root = await mkdtemp(path.join(tmpdir(), "pi-webui-workspaces-"));
const storageFile = path.join(root, "nested", "workspaces.json");
const concurrentFile = path.join(root, "concurrent.json");

try {
  assert.equal(webuiWorkspacesFile({ PI_WEBUI_WORKSPACES_FILE: "~/workspace-file.json" }), path.resolve(homedir(), "workspace-file.json"));
  assert.equal(webuiWorkspacesFile({ XDG_CONFIG_HOME: path.join(root, "xdg") }), path.join(root, "xdg", "pi-webui", "workspaces.json"));

  const oversizedTabs = Array.from({ length: WEBUI_WORKSPACE_TAB_LIMIT + 3 }, (_, index) => tab(`tab-${index}`, root, index + 1));
  const normalized = normalizeWebuiWorkspaces({
    version: 1,
    workspaces: [{
      id: "ws-normalized",
      name: ` ${"n".repeat(200)} `,
      savedAt: new Date().toISOString(),
      activeTabId: "tab-0",
      tabs: oversizedTabs,
      groups: [{ title: " Group ", tabIds: ["tab-0", "tab-0", "unknown"] }],
    }],
  });
  assert.equal(normalized.version, 1);
  assert.equal(normalized.workspaces[0].name.length, 160, "workspace names must be bounded");
  assert.equal(normalized.workspaces[0].tabs.length, WEBUI_WORKSPACE_TAB_LIMIT, "workspace tabs must be bounded");
  assert.deepEqual(normalized.workspaces[0].groups, [{ title: "Group", tabIds: ["tab-0"] }], "groups must only retain unique saved tab ids");

  await mkdir(path.dirname(storageFile), { recursive: true });
  await writeFile(storageFile, "{ malformed", "utf8");
  const warnings = [];
  assert.deepEqual(await readWebuiWorkspaces(storageFile, { onWarning: (message) => warnings.push(message) }), { version: 1, workspaces: [] });
  assert.equal(warnings.length, 1, "malformed persisted files must fail soft with one warning");
  assert.match(warnings[0], /treating it as empty/i);

  for (let index = 0; index <= WEBUI_WORKSPACE_LIMIT; index += 1) {
    await saveWebuiWorkspace({ name: `workspace-${index}`, tabs: [tab(`saved-${index}`, root)] }, storageFile);
  }
  const afterEviction = await listWebuiWorkspaces(storageFile);
  assert.equal(afterEviction.length, WEBUI_WORKSPACE_LIMIT, "oldest workspace must be evicted at the configured bound");
  assert.equal(afterEviction.some((workspace) => workspace.name === "workspace-0"), false);
  assert.ok(afterEviction.some((workspace) => workspace.name === `workspace-${WEBUI_WORKSPACE_LIMIT}`));

  const overwriteTarget = afterEviction.find((workspace) => workspace.name === "workspace-1");
  await assert.rejects(
    saveWebuiWorkspace({ name: "workspace-1", tabs: [tab("replacement", root)] }, storageFile),
    (error) => error?.code === "WORKSPACE_NAME_CONFLICT",
    "duplicate names must require explicit overwrite",
  );
  const overwritten = await saveWebuiWorkspace({
    name: "workspace-1",
    overwrite: true,
    activeTabId: "replacement",
    groups: [{ title: "Replacement", tabIds: ["replacement"] }],
    tabs: [tab("replacement", root)],
  }, storageFile);
  assert.equal(overwritten.workspace.id, overwriteTarget.id, "overwrite must preserve the saved workspace identity");
  const stored = await getWebuiWorkspace(overwritten.workspace.id, storageFile);
  assert.equal(stored.activeTabId, "replacement");
  assert.deepEqual(stored.groups, [{ title: "Replacement", tabIds: ["replacement"] }]);

  const deleted = await deleteWebuiWorkspace(overwritten.workspace.id, storageFile);
  assert.equal(deleted.deletedId, overwritten.workspace.id);
  assert.equal(await getWebuiWorkspace(overwritten.workspace.id, storageFile), null);
  if (process.platform !== "win32") assert.equal((await stat(storageFile)).mode & 0o777, 0o600, "atomic writes must be owner-only");
  assert.equal((await readWebuiWorkspaces(storageFile)).version, 1, "atomic writes must leave valid JSON behind");

  await Promise.all(Array.from({ length: 8 }, (_, index) => saveWebuiWorkspace({
    name: `concurrent-${index}`,
    tabs: [tab(`concurrent-tab-${index}`, root)],
  }, concurrentFile)));
  const concurrent = await listWebuiWorkspaces(concurrentFile);
  assert.equal(concurrent.length, 8, "serialized writes must retain every concurrent save");
  assert.deepEqual(new Set(concurrent.map((workspace) => workspace.name)), new Set(Array.from({ length: 8 }, (_, index) => `concurrent-${index}`)));
  const concurrentDocument = JSON.parse(await readFile(concurrentFile, "utf8"));
  assert.equal(concurrentDocument.version, 1, "serialized atomic writes must not leave partial JSON");

  console.log("webui-workspaces.test.mjs passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
