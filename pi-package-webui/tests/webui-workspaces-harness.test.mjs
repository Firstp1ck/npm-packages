import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const fakePi = join(root, "tests", "fixtures", "fake-pi.mjs");
const fixtureRoot = await mkdtemp(path.join(tmpdir(), "pi-webui-workspaces-harness-"));
const cwd = path.join(fixtureRoot, "cwd");
const missingCwd = path.join(fixtureRoot, "missing-cwd");
const missingSession = path.join(fixtureRoot, "missing-session.jsonl");
const workspacesFile = path.join(fixtureRoot, "workspaces.json");

async function portForHarness() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function request(port, pathname, { method = "GET", body } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

async function startServer(port, { initialCwd } = {}) {
  const args = [serverScript, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi];
  if (initialCwd) args.push("--cwd", initialCwd);
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PI_WEBUI_WORKSPACES_FILE: workspacesFile, PI_WEBUI_RPC_SUPERVISOR: "0" },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const health = await request(port, "/api/health");
      if (health.status === 200) return { child, output: () => output };
    } catch {
      // Server is still booting.
    }
    await delay(50);
  }
  throw new Error(`workspace harness server did not start:\n${output}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGINT");
  await Promise.race([exited, delay(5_000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

let firstServer;
let secondServer;
try {
  await chmod(fakePi, 0o755);
  await mkdir(cwd, { recursive: true });
  const port = await portForHarness();

  firstServer = await startServer(port, { initialCwd: cwd });
  const initialTabs = await request(port, "/api/tabs");
  assert.equal(initialTabs.status, 200);
  const firstTab = initialTabs.body.data.tabs[0];
  assert.ok(firstTab?.id, "the explicit cwd must create one live tab");
  const created = await request(port, "/api/tabs", { method: "POST", body: { cwd, title: "Second saved tab" } });
  assert.equal(created.status, 201);
  const secondTab = created.body.data.tab;

  const saved = await request(port, "/api/workspaces", {
    method: "POST",
    body: {
      name: "Harness workspace",
      activeTabId: secondTab.id,
      groups: [{ title: "Saved group", tabIds: [firstTab.id, secondTab.id, "not-open"] }],
    },
  });
  assert.equal(saved.status, 201, `save should work: ${saved.body?.error || ""}`);
  assert.equal(saved.body.ok, true);
  assert.equal(saved.body.data.workspace.name, "Harness workspace");
  assert.equal(saved.body.data.workspace.tabCount, 2);
  assert.deepEqual(saved.body.data.evicted, []);
  const workspaceId = saved.body.data.workspace.id;

  const listed = await request(port, "/api/workspaces");
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.data.workspaces.map((workspace) => workspace.id), [workspaceId], "GET must return picker metadata only");
  assert.equal(Object.hasOwn(listed.body.data.workspaces[0], "tabs"), false, "GET must not expose saved tab descriptors");

  const duplicate = await request(port, "/api/workspaces", { method: "POST", body: { name: "Harness workspace" } });
  assert.equal(duplicate.status, 409, "duplicate save must require overwrite");
  const originalTabIds = [firstTab.id, secondTab.id].sort();

  const loadWithoutDecision = await request(port, `/api/workspaces/${encodeURIComponent(workspaceId)}/load`, { method: "POST" });
  assert.equal(loadWithoutDecision.status, 400, "open tabs must reject a load without explicit replacement intent");
  assert.deepEqual((await request(port, "/api/tabs")).body.data.tabs.map((tab) => tab.id).sort(), originalTabIds, "rejected loads must leave every open tab intact");
  const ambiguousLoad = await request(port, `/api/workspaces/${encodeURIComponent(workspaceId)}/load`, {
    method: "POST",
    body: { replaceOpenTabs: true, discardCurrent: true, saveCurrent: { name: "Ambiguous workspace" } },
  });
  assert.equal(ambiguousLoad.status, 400, "open tabs must reject ambiguous save-and-discard replacement decisions");
  assert.deepEqual((await request(port, "/api/tabs")).body.data.tabs.map((tab) => tab.id).sort(), originalTabIds, "ambiguous loads must leave every open tab intact");

  const conflictingSaveAndLoad = await request(port, `/api/workspaces/${encodeURIComponent(workspaceId)}/load`, {
    method: "POST",
    body: {
      replaceOpenTabs: true,
      saveCurrent: {
        name: "Harness workspace",
        groups: [{ title: "Current group", tabIds: [firstTab.id, secondTab.id] }],
        activeTabId: secondTab.id,
      },
    },
  });
  assert.equal(conflictingSaveAndLoad.status, 409, "duplicate save-and-load names must conflict before tabs close");
  assert.deepEqual((await request(port, "/api/tabs")).body.data.tabs.map((tab) => tab.id).sort(), originalTabIds, "duplicate save conflicts must leave every open tab intact");

  const saveAndLoad = await request(port, `/api/workspaces/${encodeURIComponent(workspaceId)}/load`, {
    method: "POST",
    body: {
      replaceOpenTabs: true,
      saveCurrent: {
        name: "Current workspace",
        groups: [{ title: "Current group", tabIds: [firstTab.id, secondTab.id] }],
        activeTabId: secondTab.id,
      },
    },
  });
  assert.equal(saveAndLoad.status, 200, `save-and-load should succeed: ${saveAndLoad.body?.error || ""}`);
  assert.deepEqual(saveAndLoad.body.data.closedIds.slice().sort(), originalTabIds, "save-and-load must report every tab it replaced");
  assert.equal(saveAndLoad.body.data.savedCurrent.workspace.name, "Current workspace", "save-and-load must return saved-current metadata");
  assert.equal(saveAndLoad.body.data.tabs.length, 2, "save-and-load must restore the target workspace after replacement");
  const currentDocument = JSON.parse(await readFile(workspacesFile, "utf8"));
  const savedCurrent = currentDocument.workspaces.find((workspace) => workspace.id === saveAndLoad.body.data.savedCurrent.workspace.id);
  assert.deepEqual(savedCurrent?.groups, [{ title: "Current group", tabIds: [firstTab.id, secondTab.id] }], "save-and-load must persist current groups before replacement");
  assert.equal(savedCurrent?.activeTabId, secondTab.id, "save-and-load must persist the current active tab before replacement");

  const discardOnlyTab = await request(port, "/api/tabs", { method: "POST", body: { cwd, title: "Discard this tab" } });
  assert.equal(discardOnlyTab.status, 201);
  const tabsBeforeDiscard = (await request(port, "/api/tabs")).body.data.tabs.map((tab) => tab.id).sort();
  const discardAndLoad = await request(port, `/api/workspaces/${encodeURIComponent(workspaceId)}/load`, {
    method: "POST",
    body: { replaceOpenTabs: true, discardCurrent: true },
  });
  assert.equal(discardAndLoad.status, 200, `discard-and-load should succeed: ${discardAndLoad.body?.error || ""}`);
  assert.deepEqual(discardAndLoad.body.data.closedIds.slice().sort(), tabsBeforeDiscard, "discard-and-load must report every tab it replaced");
  assert.equal(Object.hasOwn(discardAndLoad.body.data, "savedCurrent"), false, "discard-and-load must not report a saved current workspace");
  assert.equal(discardAndLoad.body.data.tabs.length, 2, "discard-and-load must replace current tabs with the target workspace");
  assert.equal(discardAndLoad.body.data.tabs.some((tab) => tab.id === discardOnlyTab.body.data.tab.id), false, "discard-and-load must remove tabs outside the target workspace");

  const closedForLoad = await request(port, "/api/tabs/close", {
    method: "POST",
    body: { ids: (await request(port, "/api/tabs")).body.data.tabs.map((tab) => tab.id), allowEmpty: true },
  });
  assert.equal(closedForLoad.status, 200);
  assert.deepEqual(closedForLoad.body.data.tabs, [], "explicit close-all must expose the planned zero-tab load state");
  assert.equal(closedForLoad.body.data.activeTabId, null);
  const loadedAfterCloseAll = await request(port, `/api/workspaces/${encodeURIComponent(workspaceId)}/load`, { method: "POST" });
  assert.equal(loadedAfterCloseAll.status, 200, "the existing zero-tab load journey must remain reachable");
  assert.deepEqual(loadedAfterCloseAll.body.data.closedIds, [], "zero-tab loads must report no replacements");
  assert.equal(loadedAfterCloseAll.body.data.tabs.length, 2);

  await stopServer(firstServer.child);
  firstServer = null;

  const document = JSON.parse(await readFile(workspacesFile, "utf8"));
  const storedWorkspace = document.workspaces.find((workspace) => workspace.id === workspaceId);
  storedWorkspace.tabs[0].cwd = missingCwd;
  storedWorkspace.tabs[0].sessionFile = missingSession;
  await writeFile(workspacesFile, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  secondServer = await startServer(port);
  const noTabs = await request(port, "/api/tabs");
  assert.deepEqual(noTabs.body.data.tabs, [], "the no-cwd server must expose the planned zero-tab load state");
  const saveWithoutTabs = await request(port, "/api/workspaces", { method: "POST", body: { name: "empty" } });
  assert.equal(saveWithoutTabs.status, 400, "save requires live server-owned descriptors");

  const loaded = await request(port, `/api/workspaces/${encodeURIComponent(workspaceId)}/load`, { method: "POST" });
  assert.equal(loaded.status, 200, `fail-soft load should succeed: ${loaded.body?.error || ""}`);
  assert.equal(loaded.body.ok, true);
  assert.equal(loaded.body.data.tabs.length, 2, "sequential load must recreate every saved tab");
  assert.equal(loaded.body.data.idMap[firstTab.id], firstTab.id, "load must return saved-to-live tab id mappings");
  assert.equal(loaded.body.data.idMap[secondTab.id], secondTab.id);
  assert.deepEqual(loaded.body.data.groups, [{ title: "Saved group", tabIds: [firstTab.id, secondTab.id] }], "groups must remap only restored tab ids");
  assert.equal(loaded.body.data.activeTabId, secondTab.id, "active tab must remap through the returned id map");
  assert.ok(loaded.body.data.warnings.some((warning) => warning.savedTabId === firstTab.id && warning.code === "missing_session_file"));
  assert.ok(loaded.body.data.warnings.some((warning) => warning.savedTabId === firstTab.id && warning.code === "missing_cwd"));
  assert.equal(loaded.body.data.tabs.find((tab) => tab.id === firstTab.id).cwd, root, "missing cwd must fall back to the server default cwd");

  const deleted = await request(port, `/api/workspaces/${encodeURIComponent(workspaceId)}`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.data.deletedId, workspaceId, "delete must return the removed target id");
  assert.deepEqual(deleted.body.data.workspaces.map((workspace) => workspace.id), [saveAndLoad.body.data.savedCurrent.workspace.id], "delete must retain the workspace saved by save-and-load");
  const deletedCurrent = await request(port, `/api/workspaces/${encodeURIComponent(saveAndLoad.body.data.savedCurrent.workspace.id)}`, { method: "DELETE" });
  assert.equal(deletedCurrent.status, 200);
  assert.deepEqual(deletedCurrent.body.data, { deletedId: saveAndLoad.body.data.savedCurrent.workspace.id, workspaces: [] }, "delete must use the frozen response envelope");
  assert.deepEqual((await request(port, "/api/workspaces")).body.data.workspaces, []);

  console.log("webui-workspaces-harness.test.mjs passed");
} finally {
  await stopServer(firstServer?.child);
  await stopServer(secondServer?.child);
  await rm(fixtureRoot, { recursive: true, force: true });
}
