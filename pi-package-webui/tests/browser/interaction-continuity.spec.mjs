import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
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
let output = "";

async function api(page, pathname, { method = "GET", data } = {}) {
  const response = await page.request.fetch(`${baseURL}${pathname}`, {
    method,
    data,
    headers: data === undefined ? undefined : { "content-type": "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  assert.equal(response.ok(), true, `${method} ${pathname} should succeed: ${payload.error || output}`);
  return payload;
}

async function tabIds(page) {
  const payload = await api(page, "/api/tabs");
  return payload.data?.tabs?.map((tab) => tab.id) || [];
}

async function activeTabId(page) {
  return page.locator("#tabBar [role=\"tab\"][aria-selected=\"true\"]").evaluate((node) => node.closest("[data-tab-id]")?.dataset.tabId || "");
}

async function startContinuityRunner(page) {
  const tabId = await activeTabId(page) || (await tabIds(page))[0];
  const configured = await api(page, "/api/app-runner-config", {
    method: "POST",
    data: {
      tab: tabId,
      runner: { label: "Continuity runner", command: process.execPath, path: "continuity-runner.mjs" },
    },
  });
  assert.ok(configured.data?.runners?.some((runner) => runner.label === "Continuity runner"), "continuity runner should be available through the public app-runner API");

  await page.locator("#appRunnerMenuButton").click();
  const runner = page.getByRole("menuitem", { name: /Continuity runner/ });
  await expect(runner).toBeVisible();
  await runner.click();
  await expect(page.locator(".app-runner-stdin-input")).toBeVisible();
}

async function triggerDelayedStream(page, tabId = "") {
  const targetTabId = tabId || await activeTabId(page);
  assert.ok(targetTabId, "a visible active terminal tab is required for the delayed stream fixture");
  const beforeLength = (await page.locator("#chat").textContent() || "").length;
  await api(page, `/api/prompt?tab=${encodeURIComponent(targetTabId)}`, {
    method: "POST",
    data: { message: "fixture continuity delayed stream", requestId: `continuity-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  await expect.poll(async () => ((await page.locator("#chat").textContent() || "").length > beforeLength)).toBe(true);
}

async function selectRenderedText(locator, expected) {
  return locator.evaluate((root, text) => {
    const fullText = root.textContent || "";
    const start = fullText.indexOf(text);
    if (start < 0) return "";
    const point = (targetOffset) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let consumed = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (targetOffset <= consumed + node.data.length) return { node, offset: targetOffset - consumed };
        consumed += node.data.length;
      }
      return { node: root, offset: root.childNodes.length };
    };
    const from = point(start);
    const to = point(start + text.length);
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  }, expected);
}

test.beforeAll(async () => {
  const port = await freePort();
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-interaction-continuity-"));
  await writeFile(join(tempRoot, "continuity-runner.mjs"), [
    "let line = 0;",
    "for (let index = 0; index < 30; index += 1) console.log(`continuity output ${++line} ${'x'.repeat(120)}`);",
    "setInterval(() => console.log(`continuity output ${++line} ${'x'.repeat(120)}`), 500);",
    "process.stdin.on('data', () => {});",
    "",
  ].join("\n"));
  baseURL = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [serverScript, "--cwd", tempRoot, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PI_WEBUI_RPC_SUPERVISOR: "0",
      PI_CODING_AGENT_DIR: join(tempRoot, "agent"),
      PI_WEBUI_SETTINGS_FILE: join(tempRoot, "settings.json"),
      FAKE_PI_CONTINUITY_MODE: "1",
    },
  });
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // Poll only until the real server and fake Pi fixture are available.
    }
    await delay(100);
  }
  throw new Error(`Pi Web UI did not start:\n${output}`);
});

test.afterAll(async () => {
  if (child?.exitCode === null) {
    await fetch(`${baseURL}/api/shutdown`, { method: "POST", signal: AbortSignal.timeout(1_000) }).catch(() => undefined);
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await rm(tempRoot, { recursive: true, force: true });
});

test("same-context app-runner refresh preserves directional selection, control scroll, and reader scroll mode", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(baseURL);
  await startContinuityRunner(page);

  const input = page.locator(".app-runner-stdin-input");
  const draft = Array.from({ length: 24 }, (_, index) => `draft line ${index} ${"q".repeat(90)}`).join("\n");
  await input.fill(draft);
  await input.focus();
  await page.keyboard.press("Control+End");
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("Shift+ArrowLeft");
  const before = await input.evaluate((node) => {
    node.scrollTop = 32;
    node.dispatchEvent(new Event("scroll"));
    return {
      value: node.value,
      selectionStart: node.selectionStart,
      selectionEnd: node.selectionEnd,
      selectionDirection: node.selectionDirection,
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    };
  });
  assert.ok(before.scrollTop > 0, `the text-control fixture needs a real nonzero scroll position before the live rerender: ${JSON.stringify(before)}`);

  const terminal = page.locator(".app-runner-widget .release-npm-terminal");
  const initialOutputLines = await terminal.locator(".release-npm-line").count();
  await expect.poll(async () => terminal.locator(".release-npm-line").count()).toBeGreaterThan(initialOutputLines);
  await expect(input).toBeFocused();
  await expect.poll(() => input.evaluate((node) => ({
    value: node.value,
    selectionStart: node.selectionStart,
    selectionEnd: node.selectionEnd,
    selectionDirection: node.selectionDirection,
    scrollTop: node.scrollTop,
  }))).toEqual({
    value: before.value,
    selectionStart: before.selectionStart,
    selectionEnd: before.selectionEnd,
    selectionDirection: before.selectionDirection,
    scrollTop: before.scrollTop,
  });

  let readerState = null;
  await expect.poll(async () => {
    const candidate = await terminal.evaluate((node) => {
      const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
      if (maxScrollTop <= 120) return { scrollTop: 0, key: node.dataset.continuityScrollKey || "" };
      node.dispatchEvent(new WheelEvent("wheel", { deltaY: -80 }));
      node.scrollTop = Math.max(1, maxScrollTop - 80);
      node.dispatchEvent(new Event("scroll"));
      return { scrollTop: node.scrollTop, key: node.dataset.continuityScrollKey || "" };
    });
    if (candidate.scrollTop > 0) readerState = candidate;
    return candidate.scrollTop;
  }).toBeGreaterThan(0);
  const readerScrollTop = readerState.scrollTop;
  await input.fill("position update");
  await page.getByRole("button", { name: "Send input", exact: true }).click();
  await expect.poll(async () => (await terminal.textContent() || "").includes("# stdin sent (15 chars)")).toBe(true);
  await expect.poll(() => terminal.evaluate((node, expected) => Math.abs(node.scrollTop - expected) <= 1, readerScrollTop)).toBe(true);

  await terminal.evaluate((node) => {
    node.dispatchEvent(new WheelEvent("wheel", { deltaY: 80 }));
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event("scroll"));
  });
  await input.fill("follow update");
  await page.getByRole("button", { name: "Send input", exact: true }).click();
  await expect.poll(async () => (await terminal.textContent() || "").includes("# stdin sent (13 chars)")).toBe(true);
  await expect.poll(() => terminal.evaluate((node) => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop) <= 1)).toBe(true);
});

test("main output text selection survives streaming-tail and settlement rerenders", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(baseURL);
  const tabId = await activeTabId(page) || (await tabIds(page))[0];
  await api(page, `/api/prompt?tab=${encodeURIComponent(tabId)}`, {
    method: "POST",
    data: { message: "fixture continuity delayed stream", requestId: `selection-${Date.now()}` },
  });

  const streamingOutput = page.locator(".message.assistant.streaming .streaming-markdown").last();
  await expect(streamingOutput).toContainText("continuity stream");
  const selectedText = "continuity stream";
  assert.equal(await selectRenderedText(streamingOutput, selectedText), selectedText, "the fixture must create a real browser Range inside the streaming main output");
  const originalSurface = await streamingOutput.elementHandle();
  assert.ok(originalSurface, "the streaming selection needs an inspectable source surface");

  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() || "")).toBe(selectedText);
  await expect.poll(() => originalSurface.evaluate((node) => node.isConnected), { timeout: 8_000 }).toBe(false);
  await expect(page.locator(".message.assistant:not(.streaming)").last()).toContainText("continuity stream complete");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() || ""), { timeout: 8_000 }).toBe(selectedText);
});

test("semantic tooltip, held pointer, open dropdown, and stale tab contexts survive only when valid", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(baseURL);
  const initialIds = await tabIds(page);
  assert.equal(initialIds.length, 1, "continuity fixture starts with one terminal tab");

  await page.locator("#newTabButton").click();
  await page.locator("#newTabCurrentDirectoryButton").click();
  await expect.poll(async () => (await tabIds(page)).length).toBe(2);
  await expect(page.locator("#tabBar [role=\"tab\"]")).toHaveCount(2);

  const inactiveTabButton = page.locator("#tabBar [role=\"tab\"][aria-selected=\"false\"]");
  await expect(inactiveTabButton).toBeVisible();
  const inactiveTabId = await inactiveTabButton.evaluate((node) => node.closest("[data-tab-id]")?.dataset.tabId || "");
  assert.ok(inactiveTabId, "the inactive grouped terminal button needs a semantic tab identity");

  await inactiveTabButton.hover();
  const tooltip = page.locator("#footerFloatingTooltip");
  await expect(tooltip).toBeVisible();
  const tooltipKey = await inactiveTabButton.getAttribute("data-tooltip-target-key");
  assert.equal(tooltipKey, `terminal-tab:${inactiveTabId}:switch`, "tooltip continuity must use the tab identity rather than its display text");
  const tooltipText = await inactiveTabButton.getAttribute("data-tooltip");

  await triggerDelayedStream(page);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText(tooltipText || "");

  const inactiveTab = page.locator(`[data-tab-id="${inactiveTabId}"]`);
  await inactiveTab.locator(".terminal-tab-close").click();
  await page.getByRole("button", { name: "Close tab", exact: true }).click();
  await expect.poll(async () => (await tabIds(page)).length).toBe(1);
  await expect(page.locator(`[data-tooltip-target-key="terminal-tab:${inactiveTabId}:switch"]`)).toHaveCount(0);
  await page.mouse.move(0, 0);
  await expect(tooltip).toBeHidden();

  await page.locator("#newTabButton").click();
  await expect(page.locator("#newTabButton")).toHaveAttribute("aria-expanded", "true");
  await triggerDelayedStream(page);
  await expect(page.locator("#newTabButton")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#newTabMenu")).toHaveClass(/open/);
  await page.locator("#promptInput").click();
  await expect(page.locator("#newTabButton")).toHaveAttribute("aria-expanded", "false");

  await page.locator("#newTabButton").click();
  await page.locator("#newTabCurrentDirectoryButton").click();
  await expect.poll(async () => (await tabIds(page)).length).toBe(2);
  const heldButton = page.locator("#tabBar [role=\"tab\"][aria-selected=\"true\"]");
  await expect(heldButton).toBeVisible();
  await heldButton.hover();
  await page.mouse.down();
  const heldHandle = await heldButton.elementHandle();
  assert.ok(heldHandle, "pointer deferral test needs the active terminal button element");
  await triggerDelayedStream(page);
  await expect.poll(() => heldHandle.evaluate((node) => node.isConnected)).toBe(true);
  await page.mouse.up();
  await expect.poll(() => heldHandle.evaluate((node) => node.isConnected)).toBe(false);

  const secondTabId = await activeTabId(page);
  assert.ok(secondTabId, "an active tab must remain after the pointer-deferred render flush");
  await startContinuityRunner(page);
  const runnerInput = page.locator(".app-runner-stdin-input");
  await runnerInput.fill("stale runner draft");
  await runnerInput.focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+ArrowLeft");
  const otherTabButton = page.locator("#tabBar [role=\"tab\"][aria-selected=\"false\"]");
  await expect(otherTabButton).toBeVisible();
  await otherTabButton.click();
  await expect(page.locator("#promptInput")).toBeFocused();
  await expect(page.locator(".app-runner-stdin-input")).toHaveCount(0);
});
