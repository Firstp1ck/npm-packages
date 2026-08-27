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

test("the 32-conversation strip reaches half the input and keeps overflow chats recognizable", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await page.goto(baseURL);
  const container = page.locator("#intercomConversationTags");
  const tags = container.locator(":scope > .composer-intercom-tag[data-intercom-conversation-id]");
  const overflow = container.locator(":scope > .composer-intercom-tag.overflow");
  const menu = container.locator(":scope > .composer-intercom-overflow-menu");

  await expect(tags).toHaveCount(expectedConversationCount);
  await expect(overflow).toBeVisible();
  const hiddenCount = Number((await overflow.textContent())?.slice(1));
  assert.ok(hiddenCount > 0 && hiddenCount < expectedConversationCount, `the desktop strip should keep some complete tags visible and hide the rest (${hiddenCount})`);

  const layout = await container.evaluate((element) => {
    const containerRect = element.getBoundingClientRect();
    const inputRect = document.querySelector("#promptInput").getBoundingClientRect();
    const visibleRects = [...element.querySelectorAll(":scope > .composer-intercom-tag:not([hidden])")].map((tag) => tag.getBoundingClientRect());
    const visibleConversationRects = [...element.querySelectorAll(":scope > .composer-intercom-tag[data-intercom-conversation-id]:not([hidden])")].map((tag) => tag.getBoundingClientRect());
    const overflowRect = element.querySelector(":scope > .composer-intercom-tag.overflow").getBoundingClientRect();
    const firstConversationRect = visibleConversationRects[0];
    return {
      containerWidth: containerRect.width,
      inputWidth: inputRect.width,
      rootFontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      widths: visibleConversationRects.map((rect) => rect.width),
      rowCenters: visibleRects.map((rect) => rect.top + rect.height / 2),
      firstConversationRightGap: containerRect.right - firstConversationRect.right,
      firstConversationLeft: firstConversationRect.left,
      overflowLeft: overflowRect.left,
      allContained: visibleRects.every((rect) => rect.left >= containerRect.left - 0.5 && rect.right <= containerRect.right + 0.5),
    };
  });
  assert.ok(layout.containerWidth <= layout.inputWidth / 2 + 1, `the desktop tag strip should stop at the input midpoint (${layout.containerWidth} > ${layout.inputWidth / 2})`);
  assert.ok(layout.containerWidth >= layout.inputWidth * 0.45, `the desktop tag strip should use the available half-width instead of the old compact cap (${layout.containerWidth} < ${layout.inputWidth * 0.45})`);
  assert.ok(layout.allContained, "every visible desktop conversation tag should stay within the measured strip");
  assert.ok(Math.max(...layout.rowCenters) - Math.min(...layout.rowCenters) <= 1, "visible conversations and +X should remain vertically aligned on one row");
  assert.ok(layout.firstConversationRightGap <= 1, `the newest conversation should start at the right edge (${layout.firstConversationRightGap}px gap)`);
  assert.ok(layout.firstConversationLeft > layout.overflowLeft, "older conversations and +X should extend left toward the input midpoint");
  assert.ok(Math.min(...layout.widths) >= 44, `visible desktop conversation targets should remain recognizable (minimum ${Math.min(...layout.widths)}px)`);
  assert.ok(Math.max(...layout.widths) <= 13 * layout.rootFontSize + 1, `direct conversation tags should stay within 13rem (maximum ${Math.max(...layout.widths)}px)`);

  await overflow.click();
  await expect(menu).toBeVisible();
  await expect(overflow).toHaveAttribute("aria-expanded", "true");
  const hiddenItems = menu.locator(":scope > .composer-intercom-overflow-menu-item:not([hidden])");
  await expect(hiddenItems).toHaveCount(hiddenCount);
  const longMenuItem = hiddenItems.filter({ hasText: longPeerName });
  await expect(longMenuItem).toHaveCount(1);
  await expect(longMenuItem).toBeVisible();
  const fullVisualLabel = await longMenuItem.locator(".composer-intercom-tag-label").textContent();
  assert.ok(fullVisualLabel?.includes(longPeerName), "the overflow menu should retain the full long conversation label in the DOM");
  await expect(longMenuItem).toHaveAttribute("aria-label", `Open agent conversation ${fullVisualLabel}`);
  await expect(longMenuItem).toHaveAttribute("title", `${fullVisualLabel} · 1 message`);

  await longMenuItem.click();
  await expect(page.locator("#intercomConversationDialog")).toBeVisible();
  await expect(page.locator("#intercomConversationParticipants")).toContainText(`${longPeerName} (${longPeerId})`);
  await expect(page.locator("#intercomConversationTranscript")).toContainText("Long-label conversation selected correctly");
  await page.locator("#intercomConversationCloseButton").click();
  await expect(overflow).toBeFocused();
});

test("conversation tag opens a safe chat dialog, refreshes, and restores focus", async ({ page }) => {
  await page.goto(baseURL);
  const tags = page.locator("#intercomConversationTags > .composer-intercom-tag[data-intercom-conversation-id]");
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

test("conversation overflow remains reachable through the narrow composer disclosure", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto(baseURL);
  const more = page.locator("#composerActionsButton");
  await expect(more).toBeVisible();
  await more.focus();
  await more.press("Enter");
  const tags = page.locator("#intercomConversationTags");
  const tagButtons = tags.locator(":scope > .composer-intercom-tag[data-intercom-conversation-id]");
  const overflow = tags.locator(":scope > .composer-intercom-tag.overflow");
  await expect(tags).toBeVisible();
  await expect(tagButtons).toHaveCount(expectedConversationCount);
  await expect(overflow).toBeVisible();
  await expect(overflow).toHaveCSS("min-height", "44px");

  const layout = await tags.evaluate((element) => {
    const containerRect = element.getBoundingClientRect();
    const contextStyle = getComputedStyle(element.parentElement);
    const contextContentWidth = element.parentElement.clientWidth
      - Number.parseFloat(contextStyle.paddingLeft)
      - Number.parseFloat(contextStyle.paddingRight);
    const visibleRects = [...element.querySelectorAll(":scope > .composer-intercom-tag:not([hidden])")].map((button) => button.getBoundingClientRect());
    return {
      containerWidth: containerRect.width,
      contextContentWidth,
      widths: visibleRects.map((rect) => rect.width),
      heights: visibleRects.map((rect) => rect.height),
      rowCenters: visibleRects.map((rect) => rect.top + rect.height / 2),
      allContained: visibleRects.every((rect) => rect.left >= containerRect.left - 0.5 && rect.right <= containerRect.right + 0.5),
    };
  });
  assert.ok(layout.containerWidth >= layout.contextContentWidth - 1, `the narrow conversation strip should use the full disclosed row (${layout.containerWidth} < ${layout.contextContentWidth})`);
  assert.ok(layout.allContained, "every visible narrow conversation tag should stay within the tag container");
  assert.ok(Math.min(...layout.widths) >= 44, `every visible narrow touch target should be at least 44px wide (minimum ${Math.min(...layout.widths)})`);
  assert.ok(Math.min(...layout.heights) >= 44, `every visible narrow touch target should be at least 44px high (minimum ${Math.min(...layout.heights)})`);
  assert.ok(Math.max(...layout.rowCenters) - Math.min(...layout.rowCenters) <= 1, "narrow conversation tags should stay vertically aligned on one row before disclosure");

  const hiddenCount = Number((await overflow.textContent())?.slice(1));
  await overflow.click();
  const hiddenItems = tags.locator(":scope > .composer-intercom-overflow-menu > .composer-intercom-overflow-menu-item:not([hidden])");
  await expect(hiddenItems).toHaveCount(hiddenCount);
  for (let index = 0; index < hiddenCount; index += 1) await expect(hiddenItems.nth(index)).toHaveCSS("min-height", "44px");
  const longMenuItem = hiddenItems.filter({ hasText: longPeerName });
  await expect(longMenuItem).toBeVisible();
  await longMenuItem.focus();
  await longMenuItem.press("Enter");
  await expect(page.locator("#intercomConversationDialog")).toBeVisible();
  await expect(page.locator("#intercomConversationParticipants")).toContainText(`${longPeerName} (${longPeerId})`);
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
