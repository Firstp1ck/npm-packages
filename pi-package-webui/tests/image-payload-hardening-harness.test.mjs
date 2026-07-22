import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const fakePi = join(root, "tests", "fixtures", "fake-pi.mjs");
const port = 32000 + Math.floor(Math.random() * 20000);
const cwd = await mkdtemp(path.join(tmpdir(), "pi-webui-image-payload-"));
const commandLog = path.join(cwd, "fake-pi-commands.jsonl");
let child;

async function request(pathname, { method = "GET", body, timeoutMs = 5_000 } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

async function stopChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGKILL");
  await exited;
}

async function cleanup() {
  await stopChild();
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await rm(cwd, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error?.code) || attempt === 7) throw error;
      await delay(100 * (attempt + 1));
    }
  }
}

try {
  await chmod(fakePi, 0o755);
  let output = "";
  child = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: path.join(cwd, "agent"),
      FAKE_PI_LOG_FILE: commandLog,
    },
  });
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });

  let health;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) break;
    try {
      health = await request("/api/health", { timeoutMs: 1_000 });
      if (health.status === 200) break;
    } catch {
      // Server is still starting.
    }
    await delay(50);
  }
  assert.equal(health?.status, 200, `server should become healthy:\n${output}`);
  const tabs = await request("/api/tabs");
  const tabId = tabs.body?.data?.tabs?.[0]?.id;
  assert.ok(tabId, "server should create a tab");

  const malformedInline = await request("/api/prompt", {
    method: "POST",
    body: { tab: tabId, message: "malformed inline image fixture", images: [{ type: "image", mimeType: "image/png", data: "137,80,78,71,13,10,26,10" }] },
  });
  assert.equal(malformedInline.status, 400);
  assert.match(String(malformedInline.body?.error || ""), /image 1 data must be canonical base64/i);

  const unpaddedInline = await request("/api/prompt", {
    method: "POST",
    body: { tab: tabId, message: "unpadded inline image fixture", images: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo" }] },
  });
  assert.equal(unpaddedInline.status, 400);
  assert.match(String(unpaddedInline.body?.error || ""), /image 1 data must be canonical base64/i);

  const malformedAttachment = await request("/api/attachments", {
    method: "POST",
    body: { tab: tabId, files: [{ id: "bad-image", name: "bad.png", mimeType: "image/png", data: "137,80,78,71" }] },
  });
  assert.equal(malformedAttachment.status, 400);
  assert.match(String(malformedAttachment.body?.error || ""), /attachment data must be canonical base64/i);

  const canonicalPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
  const validInline = await request("/api/prompt", {
    method: "POST",
    body: { tab: tabId, message: "canonical inline image fixture", images: [{ type: "image", mimeType: "image/png", data: canonicalPng }] },
  });
  assert.equal(validInline.status, 200, validInline.body?.error || "canonical image should be accepted");

  const commands = (await readFile(commandLog, "utf8")).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(commands.some((entry) => entry.direction === "command" && entry.message === "malformed inline image fixture"), false);
  assert.equal(commands.some((entry) => entry.direction === "command" && entry.message === "unpadded inline image fixture"), false);
  const validCommand = commands.find((entry) => entry.direction === "command" && entry.message === "canonical inline image fixture");
  assert.deepEqual(validCommand?.images, [{ type: "image", data: canonicalPng, mimeType: "image/png" }]);
} finally {
  await cleanup();
}

console.log("image payload hardening harness passed");
