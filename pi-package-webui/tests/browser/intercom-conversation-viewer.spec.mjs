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
const longPeerId = "peer-browser-long-layout";
const longPeerName = "An Exceptionally Long Browser Peer Name That Must Be Visually Truncated";
const expectedConversationCount = 32;

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
  for (const peer of [
    {
      id: longPeerId,
      name: longPeerName,
      messageId: "browser-layout-long",
      timestamp: 1_699_999_999_000,
      text: "Long-label conversation selected correctly",
    },
    {
      id: "peer-browser-layout-alpha",
      name: "Layout Peer Alpha",
      messageId: "browser-layout-alpha",
      timestamp: 1_699_999_998_000,
      text: "Alpha layout fixture",
    },
    {
      id: "peer-browser-layout-beta",
      name: "Layout Peer Beta",
      messageId: "browser-layout-beta",
      timestamp: 1_699_999_997_000,
      text: "Beta layout fixture",
    },
    ...Array.from({ length: 28 }, (_, index) => ({
      id: `peer-browser-dense-${String(index + 1).padStart(2, "0")}`,
      name: `Dense Layout Peer ${String(index + 1).padStart(2, "0")}`,
      messageId: `browser-layout-dense-${String(index + 1).padStart(2, "0")}`,
      timestamp: 1_699_999_996_000 - index * 1_000,
      text: `Dense layout fixture ${index + 1}`,
    })),
  ]) {
    manager.appendCustomMessageEntry("intercom_message", `rendered prose for ${peer.id} must stay hidden`, true, {
      from: { id: peer.id, name: peer.name },
      message: { id: peer.messageId, timestamp: peer.timestamp, content: { text: peer.text } },
    });
  }
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
      FAKE_PI_INTERCOM_LIVE: "1",
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

test("the 32-conversation dense grid stays contained and opens the correct truncated conversation", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await page.goto(baseURL);
  const container = page.locator("#intercomConversationTags");
  const tags = container.locator(":scope > .composer-intercom-tag");
  const longTag = tags.filter({ hasText: longPeerName });
  const longLabel = longTag.locator(".composer-intercom-tag-label");

  await expect(tags).toHaveCount(expectedConversationCount);
  await expect(container).toHaveClass(/\bdense\b/);
  for (let index = 0; index < expectedConversationCount; index += 1) await expect(tags.nth(index)).toBeVisible();

  const layout = await container.evaluate((element) => {
    const containerRect = element.getBoundingClientRect();
    const tagRects = [...element.querySelectorAll(":scope > .composer-intercom-tag")].map((tag) => tag.getBoundingClientRect());
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      rootFontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      widths: tagRects.map((rect) => rect.width),
      rowTops: [...new Set(tagRects.map((rect) => Math.round(rect.top)))],
      allContained: tagRects.every((rect) => rect.left >= containerRect.left - 0.5 && rect.right <= containerRect.right + 0.5),
    };
  });
  assert.ok(layout.allContained, "every desktop conversation tag should remain within the tag container");
  assert.ok(layout.clientWidth <= (17 * layout.rootFontSize) + 0.5, `the desktop conversation tag group should stay within 17rem (${layout.clientWidth}px)`);
  assert.ok(layout.scrollWidth <= layout.clientWidth, `the desktop tag grid should not overflow horizontally (${layout.scrollWidth} > ${layout.clientWidth})`);
  assert.ok(Math.min(...layout.widths) >= 44, `every dense desktop target should be at least 44px wide (minimum ${Math.min(...layout.widths)})`);
  assert.ok(layout.rowTops.length > 1, "the 32-conversation desktop fixture should wrap into multiple rows");

  await expect(longTag).toHaveCount(1);
  const fullVisualLabel = await longLabel.textContent();
  assert.ok(fullVisualLabel?.includes(longPeerName), "the long label fixture should retain its full DOM text");
  await expect(longTag).toHaveAttribute("aria-label", `Open agent conversation ${fullVisualLabel}`);
  await expect(longTag).toHaveAttribute("title", `${fullVisualLabel} · 1 message`);
  const truncation = await longLabel.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  assert.ok(truncation.scrollWidth > truncation.clientWidth, `the long label should be visually truncated (${truncation.scrollWidth} <= ${truncation.clientWidth})`);

  await longTag.click();
  await expect(page.locator("#intercomConversationDialog")).toBeVisible();
  await expect(page.locator("#intercomConversationParticipants")).toContainText(`${longPeerName} (${longPeerId})`);
  await expect(page.locator("#intercomConversationTranscript")).toContainText("Long-label conversation selected correctly");
  await page.locator("#intercomConversationCloseButton").click();
  await expect(longTag).toBeFocused();
});

test("conversation tag opens a safe chat dialog, refreshes, and restores focus", async ({ page }) => {
  await page.goto(baseURL);
  const tags = page.locator("#intercomConversationTags .composer-intercom-tag");
  const tag = tags.filter({
    has: page.locator(".composer-intercom-tag-label").filter({ hasText: /↔ Browser Peer \(peer-browser\)$/ }),
  });
  const dialog = page.locator("#intercomConversationDialog");
  const transcript = page.locator("#intercomConversationTranscript");
  const close = page.locator("#intercomConversationCloseButton");

  await expect(tags).toHaveCount(expectedConversationCount);
  await expect(tag).toHaveCount(1);
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
  const stableTagLabel = tag.locator(".composer-intercom-tag-label");
  await stableTagLabel.evaluate((node) => { node.dataset.stableVisualMarker = "retained"; });
  await tag.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(tag).toBeFocused();
  await expect(stableTagLabel).toHaveAttribute("data-stable-visual-marker", "retained");
});

test("conversation tags remain reachable through the narrow composer disclosure", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto(baseURL);
  const more = page.locator("#composerActionsButton");
  await expect(more).toBeVisible();
  await more.focus();
  await more.press("Enter");
  const tags = page.locator("#intercomConversationTags");
  const tagButtons = tags.locator(":scope > .composer-intercom-tag");
  const tag = tagButtons.filter({
    has: page.locator(".composer-intercom-tag-label").filter({ hasText: /↔ Browser Peer \(peer-browser\)$/ }),
  });
  await expect(tags).toBeVisible();
  await expect(tagButtons).toHaveCount(expectedConversationCount);
  for (let index = 0; index < expectedConversationCount; index += 1) {
    await expect(tagButtons.nth(index)).toBeVisible();
    await expect(tagButtons.nth(index)).toHaveCSS("min-height", "44px");
  }
  const layout = await tags.evaluate((element) => {
    const containerRect = element.getBoundingClientRect();
    const tagRects = [...element.querySelectorAll(":scope > .composer-intercom-tag")].map((button) => button.getBoundingClientRect());
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      widths: tagRects.map((rect) => rect.width),
      heights: tagRects.map((rect) => rect.height),
      rowTops: [...new Set(tagRects.map((rect) => Math.round(rect.top)))],
      allContained: tagRects.every((rect) => rect.left >= containerRect.left - 0.5 && rect.right <= containerRect.right + 0.5),
    };
  });
  assert.ok(layout.allContained, "every narrow conversation tag should remain within the tag container");
  assert.ok(layout.scrollWidth <= layout.clientWidth, `the narrow tag grid should not overflow horizontally (${layout.scrollWidth} > ${layout.clientWidth})`);
  assert.ok(Math.min(...layout.widths) >= 44, `every narrow touch target should be at least 44px wide (minimum ${Math.min(...layout.widths)})`);
  assert.ok(Math.min(...layout.heights) >= 44, `every narrow touch target should be at least 44px high (minimum ${Math.min(...layout.heights)})`);
  assert.ok(layout.rowTops.length > 1, "the 32-conversation narrow fixture should wrap into multiple rows");
  const clippedLabels = await tagButtons.locator(".composer-intercom-tag-label").evaluateAll((labels) => labels.filter((label) => label.scrollWidth > label.clientWidth).length);
  assert.ok(clippedLabels > 0, "dense narrow labels should be allowed to truncate visually");
  await tag.focus();
  await tag.press("Enter");
  await expect(page.locator("#intercomConversationDialog")).toBeVisible();
  await expect(page.locator("#intercomConversationParticipants")).toContainText("Browser Peer (peer-browser)");
  await expect(page.locator("#intercomConversationCloseButton")).toBeVisible();
});

test("live generic Intercom transport never reaches the main transcript or event log", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await page.goto(baseURL);
  await page.evaluate(() => {
    const chat = document.querySelector("#chat");
    const eventLog = document.querySelector("#eventLog");
    window.__intercomLiveLeaks = [];
    const inspect = () => {
      const chatText = chat?.textContent || "";
      const eventText = eventLog?.textContent || "";
      if (/LIVEINTERCOM(?:ARGUMENT|RESULT)SECRET/.test(chatText)) window.__intercomLiveLeaks.push("secret text reached main transcript");
      if (/LIVEINTERCOM(?:ARGUMENT|RESULT)SECRET/.test(eventText)) window.__intercomLiveLeaks.push("secret text reached event log");
      if (chat?.querySelector('[data-tool-call-id="live-intercom-call"]')) window.__intercomLiveLeaks.push("Intercom tool card reached main transcript");
      if (eventLog?.querySelector('[data-chat-tool-call-id="live-intercom-call"]') || /tool intercom (?:started|finished)/i.test(eventText)) {
        window.__intercomLiveLeaks.push("Intercom execution line reached event log");
      }
    };
    const observer = new MutationObserver(inspect);
    if (chat) observer.observe(chat, { childList: true, subtree: true, characterData: true });
    if (eventLog) observer.observe(eventLog, { childList: true, subtree: true, characterData: true });
    window.__intercomLiveObserver = observer;
    inspect();
  });

  const tabsResponse = await page.request.get(`${baseURL}/api/tabs`);
  assert.equal(tabsResponse.ok(), true, await tabsResponse.text());
  const tabId = (await tabsResponse.json()).data?.tabs?.[0]?.id;
  assert.ok(tabId, "the live Intercom fixture requires an active tab");
  const promptResponse = await page.request.post(`${baseURL}/api/prompt?tab=${encodeURIComponent(tabId)}`, {
    data: { message: "fixture modal transport live", requestId: `intercom-live-${Date.now()}` },
  });
  assert.equal(promptResponse.ok(), true, await promptResponse.text());

  await expect(page.locator("#chat")).toContainText("LIVE NORMAL OUTPUT VISIBLE", { timeout: 8_000 });
  await expect.poll(async () => {
    const response = await page.request.get(`${baseURL}/api/state?tab=${encodeURIComponent(tabId)}`);
    return (await response.json()).data?.isStreaming;
  }, { timeout: 8_000 }).toBe(false);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  await expect(page.locator("#chat")).not.toContainText("LIVEINTERCOMARGUMENTSECRET");
  await expect(page.locator("#chat")).not.toContainText("LIVEINTERCOMRESULTSECRET");
  await expect(page.locator('#chat [data-tool-call-id="live-intercom-call"]')).toHaveCount(0);
  await expect(page.locator("#eventLog")).not.toContainText(/tool intercom (?:started|finished)/i);
  const leaks = await page.evaluate(() => {
    window.__intercomLiveObserver?.disconnect();
    return [...(window.__intercomLiveLeaks || [])];
  });
  assert.deepEqual(leaks, [], `live Intercom transport leaked before reconciliation: ${leaks.join(", ")}`);
});
