import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { syncDirectory, syncFile } from "../src/filesystem.ts";
import { crc32, sha256Bytes, sha256File, sha256Text, shortHash } from "../src/hash.ts";
import { fetchJsonWithTimeout, combinedSignal } from "../src/http.ts";
import { writeJsonFileAtomic, writeJsonFileAtomicSync } from "../src/json.ts";
import { pathExists, samePath, xdgConfigHome, xdgDataHome } from "../src/paths.ts";
import { detachChildProcess, isProcessRunning, killGracefully, readLines, terminateProcessTree } from "../src/process.ts";
import { normalizeTimestampMs } from "../src/time.ts";
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
assert.equal(xdgDataHome({}, "/home/test"), path.join("/home/test", ".local", "share"));
assert.equal(xdgConfigHome({}, "/home/test"), path.join("/home/test", ".config"));
assert.equal(samePath(process.cwd(), "."), true);
assert.equal(await pathExists(process.cwd()), true);

const abcSha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
assert.equal(sha256Text("abc"), abcSha256);
assert.equal(sha256Bytes(new TextEncoder().encode("abc")), abcSha256);
assert.equal(shortHash("abc"), abcSha256.slice(0, 16));
assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
assert.equal(normalizeTimestampMs(1_715_000_000), 1_715_000_000_000);
assert.equal(normalizeTimestampMs(1_715_000_000_000), 1_715_000_000_000);
assert.equal(normalizeTimestampMs(1_715_000_000_000_000), 1_715_000_000_000);
assert.equal(await pathExists(path.join(os.tmpdir(), `pi-utils-missing-${Date.now()}`)), false);

const tmpDir = await mkdtemp(path.join(os.tmpdir(), "pi-utils-"));
try {
  const syncJsonFile = path.join(tmpDir, "sync.json");
  writeJsonFileAtomicSync(syncJsonFile, { ok: true }, { mode: 0o600 });
  assert.equal(await readFile(syncJsonFile, "utf8"), "{\n  \"ok\": true\n}\n");

  const asyncFile = path.join(tmpDir, "nested", "async.json");
  await writeJsonFileAtomic(asyncFile, [1, 2]);
  assert.equal(await readFile(asyncFile, "utf8"), "[\n  1,\n  2\n]\n");
  assert.equal(await sha256File(asyncFile), sha256Text("[\n  1,\n  2\n]\n"));
  await syncFile(asyncFile);
  await syncDirectory(path.dirname(asyncFile));
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

assert.equal(isProcessRunning(process.pid), true);
const signaled = [];
assert.equal(killGracefully({ pid: process.pid, kill: (signal) => { signaled.push(signal); return true; }, exitCode: 0, signalCode: null }, { killAfterMs: 0 }), true);
assert.deepEqual(signaled, ["SIGTERM"]);

const treeSignals = [];
assert.equal(terminateProcessTree({ kill: (signal) => { treeSignals.push(signal); return true; }, exitCode: null, signalCode: null }, "SIGINT"), true);
assert.deepEqual(treeSignals, ["SIGINT"]);

const stdout = new Readable({ read() {} });
const stderr = new Readable({ read() {} });
const detached = [];
stdout.unref = () => detached.push("stdout");
stderr.unref = () => detached.push("stderr");
stdout.on("data", () => undefined);
stderr.on("data", () => undefined);
detachChildProcess({ stdout, stderr, unref: () => detached.push("child") });
assert.equal(stdout.listenerCount("data"), 0);
assert.equal(stderr.listenerCount("data"), 0);
assert.deepEqual(detached, ["stdout", "stderr", "child"]);

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
