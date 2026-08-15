import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { expect, test } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const fakePi = join(root, "tests", "fixtures", "fake-pi.mjs");

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

let child;
let baseURL;
let tempRoot;
let manager;
let output = "";

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // Wait for the isolated WebUI fixture.
    }
    await delay(100);
  }
  throw new Error(`Pi WebUI did not start:\n${output}`);
}

test.beforeAll(async () => {
  const port = await freePort();
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-intercom-viewer-"));
  const agentDir = join(tempRoot, "agent");
  const sessionDir = join(agentDir, "sessions");
  const cwd = join(tempRoot, "project");
  const settingsFile = join(tempRoot, "settings.json");
  await mkdir(sessionDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(join(agentDir, "trust.json"), `${JSON.stringify({ [cwd]: true }, null, 2)}\n`, "utf8");
  await writeFile(settingsFile, `${JSON.stringify({ version: 3 })}\n`, "utf8");
  await chmod(fakePi, 0o755);

  manager = SessionManager.create(cwd, sessionDir);
  manager.appendCustomMessageEntry("intercom_message", "rendered prose must stay hidden", true, {
    from: { id: "peer-browser", name: "Browser Peer", cwd: "/private/peer/path" },
    message: {
      id: "browser-in-1",
      timestamp: 1_700_000_000_000,
      content: { text: "Hello from the peer", attachments: [{ name: "secret.txt", content: "BROWSER_ATTACHMENT_SECRET" }] },
    },
  });
  manager.appendCustomEntry("intercom_sent", {
    to: "Browser Peer",
    message: { text: "Hello from the local agent", replyTo: "browser-in-1" },
    messageId: "browser-out-1",
    timestamp: 1_700_000_001_000,
  });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "ordinary assistant output must stay outside the conversation" }],
    api: "openai-responses",
    provider: "fake",
    model: "fake-model",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    stopReason: "stop",
    timestamp: 1_700_000_001_500,
  });
  const sessionFile = manager.getSessionFile();
  assert.ok(sessionFile, "the browser fixture needs a persisted session");

  baseURL = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PI_WEBUI_RPC_SUPERVISOR: "0",
      PI_CODING_AGENT_DIR: agentDir,
      PI_WEBUI_SETTINGS_FILE: settingsFile,
      FAKE_PI_CONTINUITY_MODE: "1",
      FAKE_PI_CONTINUITY_SESSION_FILE: sessionFile,
    },
  });
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  await waitForServer();
});

test.afterAll(async () => {
  if (child?.exitCode === null) child.kill("SIGTERM");
  if (child && child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
  await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
});

test("conversation tag opens a safe chat dialog, refreshes, and restores focus", async ({ page }) => {
  await page.goto(baseURL);
  const tags = page.locator("#intercomConversationTags .composer-intercom-tag");
  const tag = tags.first();
  const dialog = page.locator("#intercomConversationDialog");
  const transcript = page.locator("#intercomConversationTranscript");
  const close = page.locator("#intercomConversationCloseButton");

  await expect(tags).toHaveCount(1);
  await expect(tag).toContainText("Browser Peer");
  await tag.click();
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();
  await expect(page.locator("#intercomConversationParticipants")).toContainText("Browser Peer (peer-browser)");
  await expect(transcript.locator(".intercom-conversation-message.peer")).toContainText("Hello from the peer");
  await expect(transcript.locator(".intercom-conversation-message.local")).toContainText("Hello from the local agent");
  await expect(transcript).not.toContainText("BROWSER_ATTACHMENT_SECRET");
  await expect(transcript).not.toContainText("ordinary assistant output");
  await expect(transcript).not.toContainText("/private/peer/path");

  const firstMessage = transcript.locator(".intercom-conversation-message").first();
  await firstMessage.evaluate((node) => { node.dataset.stableNodeMarker = "retained"; });
  await expect(tag.locator(".composer-intercom-tag-count")).toHaveText("2");

  const longMessage = [
    "Arrived while the dialog was open",
    ...Array.from({ length: 90 }, (_, index) => `Live message line ${index + 1}`),
  ].join("\n");
  manager.appendCustomMessageEntry("intercom_message", "new rendered prose must stay hidden", true, {
    from: { id: "peer-browser", name: "Browser Peer" },
    message: { id: "browser-in-2", timestamp: 1_700_000_002_000, content: { text: longMessage } },
  });
  await expect(transcript).toContainText("Arrived while the dialog was open", { timeout: 8_000 });
  await expect(firstMessage).toHaveAttribute("data-stable-node-marker", "retained");
  await expect(tag.locator(".composer-intercom-tag-count")).toHaveText("2", { timeout: 1_000 });

  const scrollBefore = await transcript.evaluate((element) => {
    const max = element.scrollHeight - element.clientHeight;
    element.scrollTop = Math.floor(max / 2);
    return { top: element.scrollTop, max };
  });
  assert.ok(scrollBefore.max > 100 && scrollBefore.top > 0, "the long fixture should create a meaningful scrolled-up transcript position");

  manager.appendCustomMessageEntry("intercom_message", "another rendered prose message must stay hidden", true, {
    from: { id: "peer-browser", name: "Browser Peer" },
    message: { id: "browser-in-3", timestamp: 1_700_000_003_000, content: { text: "Arrived after the reader scrolled up" } },
  });
  await expect(transcript).toContainText("Arrived after the reader scrolled up", { timeout: 8_000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const scrollAfter = await transcript.evaluate((element) => element.scrollTop);
  assert.ok(Math.abs(scrollAfter - scrollBefore.top) <= 4, `live refresh should preserve the scrolled-up position (${scrollBefore.top} -> ${scrollAfter})`);
  await expect(firstMessage).toHaveAttribute("data-stable-node-marker", "retained");
  await expect(tag.locator(".composer-intercom-tag-count")).toHaveText("2", { timeout: 1_000 });

  await close.click();
  await expect(dialog).toBeHidden();
  await expect(tag).toBeFocused();
  await expect(tag.locator(".composer-intercom-tag-count")).toHaveText("4");
  await tag.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(tag).toBeFocused();
});

test("conversation tags remain reachable through the narrow composer disclosure", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto(baseURL);
  const more = page.locator("#composerActionsButton");
  await expect(more).toBeVisible();
  await more.focus();
  await more.press("Enter");
  const tags = page.locator("#intercomConversationTags");
  const tag = tags.locator(".composer-intercom-tag").first();
  await expect(tags).toBeVisible();
  await expect(tag).toBeVisible();
  await expect(tag).toHaveCSS("min-height", "44px");
  await tag.click();
  await expect(page.locator("#intercomConversationDialog")).toBeVisible();
  await expect(page.locator("#intercomConversationCloseButton")).toBeVisible();
});
