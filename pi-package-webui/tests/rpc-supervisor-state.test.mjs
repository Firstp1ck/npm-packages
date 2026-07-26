import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  acquireStartupLock,
  appendSupervisorJournal,
  readSupervisorState,
  removeSupervisorState,
  supervisorPaths,
  writeSupervisorState,
} from "../lib/rpc-supervisor-state.mjs";

const root = await mkdtemp(path.join(tmpdir(), "pi-webui-rpc-supervisor-state-"));
try {
  const paths = await supervisorPaths({ agentDir: path.join(root, "agent"), port: 41234 });
  assert.match(paths.scopeId, /^[a-f0-9]{64}$/);
  if (process.platform === "win32") assert.match(paths.socketPath, /^\\\\\.\\pipe\\/);
  else assert.match(paths.socketPath, /\.sock$/);

  await writeSupervisorState(paths, {
    token: "private-token",
    instanceId: "instance-1",
    pid: process.pid,
    tabs: [{ id: "tab-1", metadata: { title: "safe", apiToken: "must-not-persist" } }],
  });
  const state = await readSupervisorState(paths);
  assert.equal(state.token, "private-token");
  assert.equal(state.tabs[0].metadata.apiToken, undefined);
  const stateText = await readFile(paths.stateFile, "utf8");
  assert.doesNotMatch(stateText, /must-not-persist/);

  await appendSupervisorJournal(paths, { metadata: { title: "safe", authorization: "must-not-persist" } });
  const journal = await readFile(paths.journalFile, "utf8");
  assert.doesNotMatch(journal, /must-not-persist/);

  const release = await acquireStartupLock(paths);
  assert.equal(typeof release, "function");
  assert.equal(await acquireStartupLock(paths), null, "exclusive startup lock must prevent duplicate launchers");
  await release();
  const secondRelease = await acquireStartupLock(paths);
  assert.equal(typeof secondRelease, "function");
  await secondRelease();

  await writeSupervisorState(paths, {
    token: "replacement-token",
    instanceId: "instance-2",
    pid: process.pid,
    tabs: [],
  });
  assert.equal(
    await removeSupervisorState(paths, { removeSocket: true, instanceId: "instance-1" }),
    false,
    "an old supervisor must not remove a replacement incarnation's runtime files",
  );
  assert.equal((await readSupervisorState(paths)).instanceId, "instance-2");
  assert.equal(await removeSupervisorState(paths, { instanceId: "instance-2" }), true);
  assert.equal(await readSupervisorState(paths), null);
  console.log("rpc-supervisor-state.test.mjs passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
