import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJsonFileStore } from "../lib/backend/store.mjs";
import { createStateStore } from "../lib/backend/state.mjs";
import { createSequenceStore } from "../lib/backend/sequences.mjs";
import { createSettingsStore } from "../lib/backend/settings.mjs";
import { createResourceStore } from "../lib/backend/resources.mjs";
import { LIMITS } from "../lib/backend/protocol.mjs";

const url = name => new URL(`../lib/backend/${name}.mjs`, import.meta.url).href;
async function directory(t) { const root = await mkdtemp(path.join(os.tmpdir(), "qt-store-race-")); t.after(() => rm(root, { recursive: true, force: true })); return root; }
function child(t, program) {
  const process = spawn(globalThis.process.execPath, ["--input-type=module", "-e", program], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let error = "";
  process.stderr.on("data", data => { error += data; });
  const done = new Promise((resolve, reject) => { process.once("error", reject); process.once("exit", (code, signal) => resolve({ code, signal, error })); });
  t.after(async () => { if (process.exitCode === null && process.signalCode === null) process.kill("SIGKILL"); await done; });
  return { process, done };
}

test("two processes preserve independent shared Qt document updates", { timeout: 20_000 }, async t => {
  const root = await directory(t);
  const env = { XDG_CONFIG_HOME: root, XDG_STATE_HOME: root, PI_WEBUI_SETTINGS_FILE: path.join(root, "webui.json") };
  const workers = [0, 1].map(worker => child(t, `
    import { createStateStore } from ${JSON.stringify(url("state"))};
    import { createSequenceStore } from ${JSON.stringify(url("sequences"))};
    import { createSettingsStore } from ${JSON.stringify(url("settings"))};
    import { createResourceStore } from ${JSON.stringify(url("resources"))};
    const env = ${JSON.stringify(env)};
    const state = createStateStore({env}); const sequences = createSequenceStore({env});
    const settings = createSettingsStore({env}); const resources = createResourceStore({env});
    for (let i = 0; i < 8; i++) {
      state.setDraft('worker-${worker}-' + i, 'draft');
      state.update(value => { value.tabs.push({cwd: '/worker-${worker}/' + i, sessionFile: '', name: ''}); return value; });
      sequences.save({name: 'worker-${worker}-' + i, entries: ['prompt']});
      settings.write(${worker ? '{showThinking:false}' : '{compactTranscript:true}'});
      await resources.update('model', {provider:'worker',modelId:'${worker}'}, 'sampling', {temperature: i / 10});
    }
  `));
  for (const worker of workers) assert.deepEqual(await worker.done, { code: 0, signal: null, error: "" });
  const state = createStateStore({ env }).read().value;
  assert.equal(Object.keys(state.drafts).length, 16);
  assert.equal(state.tabs.length, 16);
  assert.equal(createSequenceStore({ env }).list().sequences.length, 16);
  const settings = createSettingsStore({ env }).read().settings;
  assert.equal(settings.compactTranscript, true); assert.equal(settings.showThinking, false);
  const resources = await createResourceStore({ env }).read();
  assert.equal(Object.keys(resources.value.models).length, 2);
  for (const profile of Object.values(resources.value.models)) assert.equal(profile.sampling.temperature, 0.7);
});

test("live locks refuse boundedly; dead owners release automatically without deleting lock inodes", { timeout: 10_000 }, async t => {
  const root = await directory(t);
  const options = { directory: root, fileName: "state.json", maxBytes: 1024, validate: raw => ({ value: { count: raw?.count ?? 0 }, problems: [] }) };
  const store = createJsonFileStore(options);
  store.write({ count: 1 });
  const worker = child(t, `
    import { createJsonFileStore } from ${JSON.stringify(url("store"))};
    const store = createJsonFileStore({directory:${JSON.stringify(root)},fileName:'state.json',maxBytes:1024,validate:raw=>({value:{count:raw?.count??0},problems:[]})});
    store.update(value => { process.send('locked'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5000); return {count:99}; });
  `);
  await new Promise(resolve => worker.process.once("message", resolve));
  const inode = (await stat(`${store.path}.lock`)).ino;
  const before = Date.now();
  assert.throws(() => store.update(value => ({ count: value.count + 1 })), { code: "busy" });
  assert(Date.now() - before < LIMITS.storeLockCommandMs + 500);
  assert.equal(store.read().value.count, 1);
  worker.process.kill("SIGKILL"); await worker.done;
  store.update(value => ({ count: value.count + 1 }));
  assert.equal(store.read().value.count, 2);
  assert.equal((await stat(`${store.path}.lock`)).ino, inode);
  assert.equal(await readFile(`${store.path}.lock`, "utf8"), "");
  assert.equal((await stat(store.path)).mode & 0o777, 0o600);
  assert(!(await readdir(root)).some(name => name.endsWith(".tmp")));
});
