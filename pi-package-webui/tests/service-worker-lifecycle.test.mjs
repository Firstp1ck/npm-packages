import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(join(root, "public", "service-worker.js"), "utf8");
const handlers = new Map();
let releaseCacheWrite;
const cacheWrite = new Promise((resolve) => { releaseCacheWrite = resolve; });
let cachePutCount = 0;
const cache = {
  async addAll() {},
  put: async () => {
    cachePutCount += 1;
    await cacheWrite;
  },
};
const focusedMessages = [];
const client = {
  url: "https://webui.test/",
  async focus() { return this; },
  postMessage(message) { focusedMessages.push(message); },
};
const context = {
  self: {
    location: { origin: "https://webui.test" },
    addEventListener(name, handler) { handlers.set(name, handler); },
    skipWaiting: async () => {},
    clients: {
      async claim() {},
      async matchAll() { return [client]; },
      async openWindow(url) { return { url }; },
    },
  },
  caches: {
    async open() { return cache; },
    async keys() { return []; },
    async delete() { return true; },
    async match() { return undefined; },
  },
  fetch: async () => ({ ok: true, clone() { return this; } }),
  URL,
  Promise,
  RegExp,
  Object,
  String,
  console,
};
vm.runInNewContext(source, context, { filename: "service-worker.js" });

let fetchResponse;
const fetchEvent = {
  request: { method: "GET", url: "https://webui.test/app.js", mode: "cors" },
  respondWith(promise) { fetchResponse = promise; },
};
handlers.get("fetch")(fetchEvent);
assert.ok(fetchResponse, "app-shell fetch should be intercepted");
let settled = false;
fetchResponse.then(() => { settled = true; });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(cachePutCount, 1, "network responses should begin a cache write");
assert.equal(settled, false, "fetch completion must await the cache write lifetime");
releaseCacheWrite();
assert.equal((await fetchResponse).ok, true, "a completed cache write must preserve the network response");

let notificationWork;
const notificationEvent = {
  notification: {
    data: { target: { v: 1, route: "activity", tabId: "tab_12345678", runId: "run_12345678" } },
    close() {},
  },
  waitUntil(promise) { notificationWork = promise; },
};
handlers.get("notificationclick")(notificationEvent);
await notificationWork;
assert.deepEqual(JSON.parse(JSON.stringify(focusedMessages)), [{
  type: "pi-webui:navigate:v1",
  target: { v: 1, route: "activity", tabId: "tab_12345678", runId: "run_12345678" },
}], "an existing active client should receive only the validated opaque navigation target");

console.log("service-worker-lifecycle.test.mjs passed");
