import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rawSource = await readFile(join(root, "public", "service-worker.js"), "utf8");
assert.match(rawSource, /const APP_SHELL_NETWORK_TIMEOUT_MS = 8_000;/, "app-shell requests need a bounded network timeout");
const source = rawSource.replace(
  "const APP_SHELL_NETWORK_TIMEOUT_MS = 8_000;",
  "const APP_SHELL_NETWORK_TIMEOUT_MS = 20;",
);
const handlers = new Map();
let releaseCacheWrite;
const cacheWrite = new Promise((resolve) => { releaseCacheWrite = resolve; });
let cachePutCount = 0;
let cacheMatchResult;
const cache = {
  async addAll() {},
  put: async () => {
    cachePutCount += 1;
    await cacheWrite;
  },
};
const networkResponse = { ok: true, source: "network", clone() { return this; } };
let fetchImpl = async () => networkResponse;
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
    async match() { return cacheMatchResult; },
  },
  fetch: (...args) => fetchImpl(...args),
  AbortController,
  setTimeout,
  clearTimeout,
  URL,
  Promise,
  RegExp,
  Object,
  String,
  console,
};
vm.runInNewContext(source, context, { filename: "service-worker.js" });

let fetchResponse;
let fetchLifetime;
const fetchEvent = {
  request: { method: "GET", url: "https://webui.test/app.js", mode: "cors" },
  respondWith(promise) { fetchResponse = promise; },
  waitUntil(promise) { fetchLifetime = promise; },
};
handlers.get("fetch")(fetchEvent);
assert.ok(fetchResponse, "app-shell fetch should be intercepted");
assert.ok(fetchLifetime, "runtime cache writes should extend the fetch-event lifetime");
assert.equal(await fetchResponse, networkResponse, "a usable network response must not wait for CacheStorage");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(cachePutCount, 1, "network responses should begin a cache write");
let lifetimeSettled = false;
fetchLifetime.then(() => { lifetimeSettled = true; });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(lifetimeSettled, false, "the event lifetime should still track an unfinished cache write");
releaseCacheWrite();
await fetchLifetime;
assert.equal(lifetimeSettled, true, "the event lifetime should settle after the cache write");

const cachedResponse = { ok: true, source: "cache" };
cacheMatchResult = cachedResponse;
fetchImpl = (_request, { signal }) => new Promise((_resolve, reject) => {
  signal.addEventListener("abort", () => {
    const error = new Error("network request timed out");
    error.name = "AbortError";
    reject(error);
  }, { once: true });
});
let timeoutResponse;
let timeoutLifetime;
const timeoutEvent = {
  request: { method: "GET", url: "https://webui.test/styles.css", mode: "cors" },
  respondWith(promise) { timeoutResponse = promise; },
  waitUntil(promise) { timeoutLifetime = promise; },
};
handlers.get("fetch")(timeoutEvent);
assert.equal(await timeoutResponse, cachedResponse, "a timed-out app-shell request should use the offline cache");
await timeoutLifetime;

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
