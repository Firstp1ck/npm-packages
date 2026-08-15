import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { terminateProcessTree } from "../lib/process-tree.mjs";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = path.join(packageRoot, "bin", "pi-webui.mjs");
const fakePi = path.join(packageRoot, "tests", "fixtures", "fake-pi.mjs");
const fixtureRoot = await mkdtemp(path.join(tmpdir(), "pi-webui-intercom-http-"));
const agentDir = path.join(fixtureRoot, "agent");
const sessionDir = path.join(agentDir, "sessions");
const cwd = path.join(fixtureRoot, "project");
const settingsFile = path.join(fixtureRoot, "settings.json");

await mkdir(sessionDir, { recursive: true });
await mkdir(cwd, { recursive: true });
await writeFile(path.join(agentDir, "trust.json"), `${JSON.stringify({ [cwd]: true }, null, 2)}\n`, "utf8");
await writeFile(settingsFile, `${JSON.stringify({ version: 3 })}\n`, "utf8");
await chmod(fakePi, 0o755);

const manager = SessionManager.create(cwd, sessionDir);
const firstMessageId = manager.appendCustomMessageEntry("intercom_message", "rendered inbound message must not be parsed", true, {
  from: { id: "peer-http", name: "HTTP Peer", cwd: "/private/peer/path" },
  message: {
    id: "http-in-1",
    timestamp: 1_700_000_000_000,
    content: { text: "Persisted hello", attachments: [{ name: "secret.txt", content: "HTTP_ATTACHMENT_SECRET" }] },
  },
  bodyText: "HTTP_BODY_TEXT_SECRET",
});
manager.appendCustomMessageEntry("intercom_message", "ABANDONED_BRANCH_SECRET", true, {
  from: { id: "peer-http", name: "HTTP Peer" },
  message: { id: "http-abandoned", timestamp: 1_700_000_000_500, content: { text: "ABANDONED_BRANCH_SECRET" } },
});
manager.branch(firstMessageId);
manager.appendCustomEntry("intercom_sent", {
  to: "HTTP Peer",
  message: { text: "Persisted reply", replyTo: "http-in-1", attachments: [{ name: "out.txt", content: "HTTP_OUTBOUND_ATTACHMENT_SECRET" }] },
  messageId: "http-out-1",
  timestamp: 1_700_000_001_000,
});
// SessionManager intentionally defers creating a new JSONL file until an assistant
// message exists. This ignored fixture message flushes the structured custom entries.
manager.appendMessage({
  role: "assistant",
  content: [{ type: "text", text: "ordinary assistant content must stay outside the Intercom projection" }],
  api: "openai-responses",
  provider: "fake",
  model: "fake-model",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop",
  timestamp: 1_700_000_001_500,
});
const sessionFile = manager.getSessionFile();
assert.ok(sessionFile, "fixture must create a persisted session file");

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function request(port, pathname) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { signal: AbortSignal.timeout(5_000) });
  let body;
  try { body = await response.json(); } catch { body = undefined; }
  return { status: response.status, body, headers: response.headers };
}

async function startServer(activeSessionFile) {
  const port = await freePort();
  const child = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDir,
      PI_WEBUI_SETTINGS_FILE: settingsFile,
      PI_WEBUI_RPC_SUPERVISOR: "0",
      FAKE_PI_CONTINUITY_MODE: "1",
      FAKE_PI_CONTINUITY_SESSION_FILE: activeSessionFile,
    },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  let health;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) break;
    try {
      health = await request(port, "/api/health");
      if (health.status === 200 && health.body?.piRunning === true) break;
    } catch {
      // The focused server is still starting.
    }
    await delay(100);
  }
  assert.equal(health?.status, 200, `server should become healthy\n${output}`);
  assert.equal(health.body?.piRunning, true, `fake Pi should be running\n${output}`);
  return { child, port, output: () => output };
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  await terminateProcessTree(child.pid);
  for (let attempt = 0; attempt < 40 && child.exitCode === null; attempt++) await delay(50);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function startupTabId(server) {
  const tabs = await request(server.port, "/api/tabs");
  assert.equal(tabs.status, 200, tabs.body?.error);
  const tabId = tabs.body?.data?.tabs?.[0]?.id;
  assert.ok(tabId, `startup tab should exist\n${server.output()}`);
  return tabId;
}

let server;
try {
  server = await startServer(sessionFile);
  const tabId = await startupTabId(server);
  const basePath = `/api/intercom/conversations?tab=${encodeURIComponent(tabId)}`;

  const missingTab = await request(server.port, "/api/intercom/conversations");
  assert.equal(missingTab.status, 400, "the endpoint must require explicit tab scope");
  const staleTab = await request(server.port, "/api/intercom/conversations?tab=missing-tab");
  assert.equal(staleTab.status, 404, "unknown tabs must not fall back to another session");

  const summary = await request(server.port, basePath);
  assert.equal(summary.status, 200, summary.body?.error);
  assert.equal(summary.headers.get("cache-control"), "private, no-store");
  assert.equal(summary.body?.data?.conversations?.length, 1);
  assert.equal(summary.body?.data?.conversations?.[0]?.messageCount, 2, "only the active session branch should be projected");
  assert.equal(summary.body?.data?.conversation, null, "summary responses must not include transcript text");
  const conversationId = summary.body?.data?.conversations?.[0]?.id;
  assert.match(conversationId || "", /^conv_[A-Za-z0-9_-]{24}$/);

  const ignoredBrowserPath = await request(server.port, `${basePath}&sessionPath=${encodeURIComponent(path.join(fixtureRoot, "outside.jsonl"))}`);
  assert.equal(ignoredBrowserPath.status, 200, "browser-supplied session paths must not influence session resolution");
  assert.equal(ignoredBrowserPath.body?.data?.conversations?.[0]?.id, conversationId);

  const invalidConversation = await request(server.port, `${basePath}&conversation=${encodeURIComponent("../../private/session.jsonl")}`);
  assert.equal(invalidConversation.status, 400, "detail selection accepts opaque IDs only");
  const missingConversation = await request(server.port, `${basePath}&conversation=conv_${"a".repeat(24)}`);
  assert.equal(missingConversation.status, 404, "unknown opaque conversation IDs must not disclose another transcript");

  const detailResponse = await request(server.port, `${basePath}&conversation=${encodeURIComponent(conversationId)}`);
  assert.equal(detailResponse.status, 200, detailResponse.body?.error);
  assert.deepEqual(detailResponse.body?.data?.conversation?.messages?.map(({ direction, text }) => [direction, text]), [
    ["peer", "Persisted hello"],
    ["local", "Persisted reply"],
  ]);
  const serialized = JSON.stringify(detailResponse.body);
  for (const forbidden of [
    sessionFile,
    "/private/peer/path",
    "ABANDONED_BRANCH_SECRET",
    "HTTP_ATTACHMENT_SECRET",
    "HTTP_OUTBOUND_ATTACHMENT_SECRET",
    "HTTP_BODY_TEXT_SECRET",
    "rendered inbound message must not be parsed",
  ]) assert.equal(serialized.includes(forbidden), false, `HTTP payload must not expose ${forbidden}`);

  await stopServer(server.child);
  server = undefined;
  manager.appendCustomEntry("intercom_received", {
    from: "HTTP Peer",
    message: { text: "Persisted after restart" },
    messageId: "http-in-2",
    timestamp: 1_700_000_002_000,
  });

  server = await startServer(sessionFile);
  const restartedTabId = await startupTabId(server);
  const restartedSummary = await request(server.port, `/api/intercom/conversations?tab=${encodeURIComponent(restartedTabId)}`);
  assert.equal(restartedSummary.status, 200, restartedSummary.body?.error);
  const restartedConversations = restartedSummary.body?.data?.conversations || [];
  const restartedStableConversation = restartedConversations.find((conversation) => conversation.id === conversationId);
  assert.ok(restartedStableConversation, "the evidence-backed conversation identity should remain stable after server restart");
  assert.equal(restartedStableConversation.messageCount, 2, "restart should preserve the original explicitly linked conversation");
  const restartedLabelConversation = restartedConversations.find((conversation) => conversation.participants?.peer?.id === null);
  assert.equal(restartedLabelConversation?.messageCount, 1, "a received message without replyTo or peer ID must remain a conservative label-only conversation");
  await stopServer(server.child);
  server = undefined;

  const outsideManager = SessionManager.create(cwd, path.join(fixtureRoot, "outside-sessions"));
  outsideManager.appendCustomEntry("intercom_sent", { to: "Outside", message: { text: "must stay unavailable" }, messageId: "outside-message", timestamp: Date.now() });
  const outsideSessionFile = outsideManager.getSessionFile();
  server = await startServer(outsideSessionFile);
  const outsideTabId = await startupTabId(server);
  const outsideResponse = await request(server.port, `/api/intercom/conversations?tab=${encodeURIComponent(outsideTabId)}`);
  assert.equal(outsideResponse.status, 403, "server-derived session files outside allowed Pi roots must be rejected");
  assert.equal(JSON.stringify(outsideResponse.body).includes(outsideSessionFile), false, "confinement errors must not expose the rejected path");

  console.log("intercom-conversations-http: ok");
} finally {
  await stopServer(server?.child);
  await rm(fixtureRoot, { recursive: true, force: true });
}
