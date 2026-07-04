import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fetchJsonWithTimeout, combinedSignal } from "../src/http.ts";
import { writeJsonFileAtomic, writeJsonFileAtomicSync } from "../src/json.ts";
import { pathExists, xdgConfigHome, xdgDataHome } from "../src/paths.ts";
import { isProcessRunning, killGracefully, readLines } from "../src/process.ts";
import {
  decodeXmlEntities,
  escapeRegExp,
  extractXmlTag,
  formatBytes,
  formatDuration,
  pluralize,
  stripHtml,
  stripQuotes,
  titleCaseFromSlug,
  truncate,
} from "../src/text.ts";

assert.equal(escapeRegExp("a+b[1]?"), "a\\+b\\[1\\]\\?");
assert.equal(new RegExp(escapeRegExp("a+b[1]?")).test("a+b[1]?"), true);

assert.equal(decodeXmlEntities("<![CDATA[x<y]]>&amp;&quot;&#39;&apos;&lt;&gt;&nbsp;"), "x<y&\"''<> ");
assert.equal(extractXmlTag("<item><title>Hello &amp; bye</title></item>", "title"), "Hello & bye");
assert.equal(extractXmlTag("<dc:creator>Ada</dc:creator>", "dc:creator"), "Ada");
assert.equal(stripHtml("<p>Hello&nbsp;<b>world</b></p>"), "Hello world");

assert.equal(truncate(" one\n two   three ", 9), "one two…");
assert.equal(truncate("abcdef", 3, { ellipsis: "" }), "abc");
assert.equal(pluralize(1, "item"), "item");
assert.equal(pluralize(2, "item"), "items");
assert.equal(titleCaseFromSlug("hello-world_test"), "Hello World Test");
assert.equal(stripQuotes("'quoted'"), "quoted");
assert.equal(stripQuotes("\"quoted\""), "quoted");
assert.equal(stripQuotes("'mixed\""), "'mixed\"");

assert.equal(formatBytes(1536, { binary: true }), "1.5 KiB");
assert.equal(formatBytes(1500), "1.5 KB");
assert.equal(formatDuration(999), "999ms");
assert.equal(formatDuration(125000), "2m 5s");

assert.equal(xdgDataHome({ XDG_DATA_HOME: "/tmp/data" }, "/home/test"), "/tmp/data");
assert.equal(xdgDataHome({}, "/home/test"), "/home/test/.local/share");
assert.equal(xdgConfigHome({}, "/home/test"), "/home/test/.config");
assert.equal(await pathExists(process.cwd()), true);
assert.equal(await pathExists(path.join(os.tmpdir(), `pi-utils-missing-${Date.now()}`)), false);

const tmpDir = await mkdtemp(path.join(os.tmpdir(), "pi-utils-"));
try {
  const syncFile = path.join(tmpDir, "sync.json");
  writeJsonFileAtomicSync(syncFile, { ok: true }, { mode: 0o600 });
  assert.equal(await readFile(syncFile, "utf8"), "{\n  \"ok\": true\n}\n");

  const asyncFile = path.join(tmpDir, "nested", "async.json");
  await writeJsonFileAtomic(asyncFile, [1, 2]);
  assert.equal(await readFile(asyncFile, "utf8"), "[\n  1,\n  2\n]\n");
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

assert.equal(isProcessRunning(process.pid), true);
const signaled = [];
assert.equal(killGracefully({ pid: process.pid, kill: (signal) => { signaled.push(signal); return true; }, exitCode: 0, signalCode: null }, { killAfterMs: 0 }), true);
assert.deepEqual(signaled, ["SIGTERM"]);

const lines = [];
await readLines(Readable.from(["one\nt", "wo\nthree"]), (line) => lines.push(line));
assert.deepEqual(lines, ["one", "two", "three"]);

const signal = combinedSignal(5_000);
assert.equal(signal.aborted, false);
const ok = await fetchJsonWithTimeout("https://example.test", {}, {
  fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
});
assert.deepEqual(ok, { ok: true, status: 200, body: { ok: true } });

const failed = await fetchJsonWithTimeout("https://example.test", {}, {
  fetchImpl: async () => { throw new Error("offline"); },
});
assert.equal(failed.ok, false);
assert.equal(failed.status, 0);
assert.equal(failed.error instanceof Error, true);
