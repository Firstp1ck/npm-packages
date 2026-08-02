import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
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

async function assertAxeClean(page, label, selector = "#mobileShellV2") {
  const accessibility = await new AxeBuilder({ page }).include(selector).analyze();
  const serious = accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact));
  assert.deepEqual(serious, [], `${label} should not introduce serious/critical axe violations: ${serious.map((item) => item.id).join(", ")}`);
}

test.beforeAll(async () => {
  const port = await freePort();
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-mobile-browser-"));
  await writeFile(join(tempRoot, "tablet-example.txt"), "tablet file viewer fixture\n", "utf8");
  baseURL = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [serverScript, "--cwd", tempRoot, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PI_WEBUI_RPC_SUPERVISOR: "0",
      PI_CODING_AGENT_DIR: join(tempRoot, "agent"),
      PI_WEBUI_SETTINGS_FILE: join(tempRoot, "settings.json"),
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
      // Wait for the real server and fake Pi fixture to start.
    }
    await delay(100);
  }
  throw new Error(`Pi Web UI did not start:\n${output}`);
});

test.afterAll(async () => {
  child?.kill("SIGTERM");
  if (child) await new Promise((resolve) => child.once("exit", resolve));
  await rm(tempRoot, { recursive: true, force: true });
});

test("v2 flag is isolated on desktop and rollback remains explicit", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${baseURL}/?mobileShell=v2`);
  await expect(page.locator("#promptInput")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-mobile-shell", "v2");
  await expect(page.locator(".layout")).toHaveCSS("grid-template-columns", /.+/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseURL}/?mobileShell=legacy`);
  await expect(page.locator("#promptInput")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-mobile-shell");
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate", {
    state: {
      piMobileShellV2: true,
      mobileShellState: { featureMode: "v2", tabletFeatureMode: "v2", viewportMode: "phone", route: "sessions", surface: "none", routeHistory: ["chat"] },
    },
  })));
  await expect(page.locator("html")).not.toHaveAttribute("data-mobile-shell");
  await expect(page.locator("#mobileShellV2")).toBeHidden();
});

test("phone v2 destinations, canonical actions, history, and presentation remain functional", async ({ browser }) => {
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await phoneContext.newPage();
  await page.goto(`${baseURL}/?mobileShell=v2`);
  await expect(page.locator("html")).toHaveAttribute("data-mobile-shell", "v2");
  await expect(page.locator("#mobileShellV2")).toBeVisible();
  for (const selector of ["#mobileSessionButton", "#mobileSearchButton", "#mobileMoreButton", "#attachButton", "#composerActionsButton", "#sendButton"]) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box, `${selector} should have a box`);
    assert.ok(box.width >= 44 && box.height >= 44, `${selector} should meet the 44px target floor, got ${box.width}×${box.height}`);
  }
  const phoneNav = page.getByRole("navigation", { name: "Phone destinations" });
  await expect(phoneNav.getByRole("button")).toHaveCount(4);
  await expect(page.locator("#chat")).not.toHaveAttribute("aria-live");
  await assertAxeClean(page, "phone Chat route");

  await phoneNav.getByRole("button", { name: "Sessions", exact: true }).click();
  await expect(page.locator("#mobileSessionsRoute")).toBeVisible();
  await expect(page.locator("#mobileSessionsTitle")).toBeFocused();
  await expect(page.locator(".layout")).toHaveAttribute("inert", "");
  await expect(page.locator(".layout")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#mobileShellDestination")).toHaveAttribute("role", "main");
  await expect(page.locator("#mobileSessionsSearchInput")).toBeVisible();
  await page.locator("#promptInput").evaluate((node) => { node.value = "draft survives switch"; node.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.locator("#mobileNewCurrentDirectoryButton").click();
  await expect(page.locator(".mobile-session-select")).toHaveCount(2);
  await page.locator(".mobile-session-select").first().click();
  await expect(page.locator("#promptInput")).toHaveValue("draft survives switch");
  await assertAxeClean(page, "phone Sessions route");

  await phoneNav.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.locator("#mobileActivityRoute")).toBeVisible();
  await expect(page.locator("#mobileActivityTitle")).toBeFocused();
  await expect(page.locator("#mobileActivityStatus")).toBeVisible();
  await assertAxeClean(page, "phone Activity route");
  await phoneNav.getByRole("button", { name: "Project", exact: true }).click();
  await expect(page.locator("#mobileProjectRoute")).toBeVisible();
  await expect(page.locator("#mobileProjectTitle")).toBeFocused();
  await page.getByRole("tab", { name: "Files" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Git" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Files" }).click();
  await expect(page.locator("#fileTreeRoot")).toBeVisible();
  await page.getByRole("tab", { name: "Queue" }).click();
  await expect(page.locator("#queueBox")).toBeVisible();
  await assertAxeClean(page, "phone Project route");

  await phoneNav.getByRole("button", { name: "Chat", exact: true }).click();
  await page.locator("#composerActionsButton").focus();
  await page.locator("#composerActionsButton").click();
  await expect(page.locator("#mobileShellSurface")).toBeVisible();
  await expect(page.locator("#mobileShellSurface")).toHaveAttribute("role", "dialog");
  await expect(page.locator("#mobileShellSurface")).toHaveAttribute("aria-modal", "true");
  await page.getByRole("button", { name: "Session actions" }).click();
  await page.getByRole("button", { name: "Command palette", exact: true }).click();
  await expect(page.locator("#commandPaletteDialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#commandPaletteDialog")).toBeHidden();
  await expect(page.locator("#mobileShellSurface")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Session actions" })).toBeVisible();
  await page.locator("#mobileSurfaceBackButton").click();
  await page.getByRole("button", { name: "Voice" }).click();
  await expect(page.getByRole("heading", { name: "Voice" })).toBeVisible();
  await assertAxeClean(page, "phone action sheet");
  await page.locator("#mobileSurfaceBackButton").click();
  await page.locator("#mobileSurfaceCloseButton").click();
  await expect(page.locator("#mobileShellSurface")).toBeHidden();
  await expect(page.locator("#composerActionsButton")).toBeFocused();

  await page.locator("#mobileMoreButton").click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator("#modelSelect")).toBeVisible();
  await page.locator("#thinkingSelect").focus();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(500);
  await expect(page.locator("#thinkingSelect")).toBeFocused();
  await page.locator("#mobileSurfaceBackButton").click();
  await page.getByRole("button", { name: "Detailed" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mobile-presentation", "detailed");
  await assertAxeClean(page, "phone More/Settings surface");
  await page.locator("#mobileSurfaceCloseButton").click();

  await phoneNav.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.goBack();
  await expect(phoneNav.getByRole("button", { name: "Chat", exact: true })).toHaveAttribute("aria-current", "page");
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator("#mobileShellV2")).toBeVisible();

  await assertAxeClean(page, "phone shell after history and rotation");
  await phoneContext.close();
});

test("mobile continuity preserves drafts, restores metadata honestly, and retries only on command", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${baseURL}/?mobileShell=v2`);
  await page.locator("#promptInput").fill("offline continuity draft");
  await page.locator("#attachmentInput").setInputFiles({ name: "context.txt", mimeType: "text/plain", buffer: Buffer.from("context") });
  await expect(page.locator("#attachmentTray")).toContainText("context.txt");
  await page.reload();
  await expect(page.locator("#promptInput")).toHaveValue("offline continuity draft");
  await expect(page.locator("#attachmentTray")).toContainText("Reselect required");

  await page.locator("#attachButton").click();
  await expect(page.getByRole("heading", { name: "Add Context" })).toBeVisible();
  for (const name of ["Camera", "Photos", "Files"]) await expect(page.locator("#mobileSurfaceRoot").getByRole("button", { name, exact: true })).toBeVisible();
  await expect(page.locator("#mobileSurfaceRoot").getByText("Paste text", { exact: true })).toBeVisible();
  const pasteInput = page.locator(".mobile-paste-context-text");
  const pasteDraft = Array.from({ length: 18 }, (_, index) => `pasted context line ${index}`).join("\n");
  await pasteInput.fill(pasteDraft);
  const pasteBefore = await pasteInput.evaluate((node) => {
    node.focus();
    node.setSelectionRange(14, 41, "backward");
    node.scrollTop = 48;
    return { value: node.value, selectionStart: node.selectionStart, selectionEnd: node.selectionEnd, selectionDirection: node.selectionDirection, scrollTop: node.scrollTop };
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(pasteInput).toBeFocused();
  await expect.poll(() => pasteInput.evaluate((node) => ({
    value: node.value,
    selectionStart: node.selectionStart,
    selectionEnd: node.selectionEnd,
    selectionDirection: node.selectionDirection,
    scrollTop: node.scrollTop,
  }))).toEqual(pasteBefore);
  await page.locator("#mobileSurfaceCloseButton").click();
  await page.locator(".attachment-remove-button").click();

  await context.setOffline(true);
  await page.locator("#sendButton").click();
  await expect(page.locator("#mobileFailedSendRecovery")).toBeVisible();
  await expect(page.locator("#mobileFailedSendRecovery")).toContainText("never retry automatically");
  await assertAxeClean(page, "failed-send recovery", "#mobileFailedSendRecovery");
  await context.setOffline(false);
  await page.locator("#mobileFailedSendRetryButton").click();
  await expect(page.locator("#mobileFailedSendRecovery")).toBeHidden();

  const tabsResponse = await page.request.get(`${baseURL}/api/tabs`);
  const tabsPayload = await tabsResponse.json();
  const tabId = tabsPayload.data.tabs[0].id;
  await page.goto(`${baseURL}/?mobileShell=v2&mobileRoute=activity&tab=${encodeURIComponent(tabId)}`);
  await expect(page.locator("#mobileActivityRoute")).toBeVisible();
  await expect(page.locator("#mobileContinuityNotice")).toContainText("checking current server state");

  await page.goto(`${baseURL}/?mobileShell=v2&mobileRoute=activity&tab=stale_tab_12345678`);
  await expect(page.locator("#mobileContinuityNotice")).toContainText("no longer available");
  await expect(page.locator("#mobileSessionsRoute")).toBeVisible();
  await context.close();
});

test("a blocker notification switches to its background tab before exact-target validation", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${baseURL}/?mobileShell=v2`);
  const initialTabs = await (await page.request.get(`${baseURL}/api/tabs`)).json();
  const targetTabId = initialTabs.data.tabs[0].id;
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.locator("#mobileNewCurrentDirectoryButton").click();
  await expect(page.locator(".mobile-session-select")).toHaveCount(2);
  const currentTabs = await (await page.request.get(`${baseURL}/api/tabs`)).json();
  const activeTabId = currentTabs.data.activeTabId || currentTabs.data.tabs.find((tab) => tab.id !== targetTabId)?.id;
  assert.notEqual(activeTabId, targetTabId, "fixture requires a different active tab");
  const requestId = `fixture_request_${Date.now()}`;
  const response = await page.request.post(`${baseURL}/api/prompt?tab=${encodeURIComponent(targetTabId)}`, { data: { message: "fixture mobile blocker", requestId } });
  assert.equal(response.ok(), true);
  await expect.poll(async () => {
    const payload = await (await page.request.get(`${baseURL}/api/tabs`)).json();
    return payload.data.tabs.find((tab) => tab.id === targetTabId)?.pendingExtensionUiRequestCount || 0;
  }).toBe(1);
  await page.evaluate(({ tabId }) => {
    navigator.serviceWorker.dispatchEvent(new MessageEvent("message", {
      data: { type: "pi-webui:navigate:v1", target: { v: 1, route: "activity", tabId, blockerId: "fixture_blocker_12345678" } },
    }));
  }, { tabId: targetTabId });
  await expect(page.locator("#dialogTitle")).toHaveText("Fixture blocker");
  await expect(page.locator("#mobileActivityRoute")).toBeVisible();
  await expect(page.locator("#mobileContinuityNotice")).toContainText("Opened after reconnecting");
  const cancel = await page.request.post(`${baseURL}/api/extension-ui-response?tab=${encodeURIComponent(targetTabId)}`, {
    data: { id: "fixture_blocker_12345678", cancelled: true },
  });
  assert.equal(cancel.ok(), true);
  await context.close();
});

test("tablet mode is independent, uses a rail and right inspector, and survives rotation and keyboard navigation", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${baseURL}/?mobileShell=v2`);
  await expect(page.locator("#mobileShellV2")).toBeHidden();

  await page.goto(`${baseURL}/?tabletShell=v2`);
  await expect(page.locator("html")).toHaveAttribute("data-tablet-shell", "v2");
  await expect(page.locator("#mobileShellV2")).toBeVisible();
  const rail = page.getByRole("navigation", { name: "Tablet destinations" });
  await expect(rail).toBeVisible();
  const railBox = await rail.boundingBox();
  assert.ok(railBox && railBox.x === 0 && railBox.width >= 100 && railBox.width <= 120, `tablet rail geometry should remain stable, got ${JSON.stringify(railBox)}`);

  await page.locator("#promptInput").fill("tablet rotation draft");
  await rail.getByRole("button", { name: "Sessions", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(rail.getByRole("button", { name: "Activity", exact: true })).toBeFocused();
  await rail.getByRole("button", { name: "Project", exact: true }).click();
  await page.getByRole("tab", { name: "Files" }).click();
  await expect(page.locator("#fileTreeRoot")).toBeVisible();
  await page.locator('[role="treeitem"][data-path="tablet-example.txt"]').click();
  await expect(page.locator("#fileViewerPane")).toBeVisible();
  const fileBox = await page.locator("#fileViewerPane").boundingBox();
  assert.ok(fileBox && fileBox.x === 0 && fileBox.y === 0 && fileBox.width === 820, `tablet file viewer must default to full-screen replacement, got ${JSON.stringify(fileBox)}`);
  await page.locator("#fileViewerCloseButton").click();

  await page.locator("#mobileMoreButton").click();
  const inspectorBox = await page.locator("#mobileShellSurface").boundingBox();
  assert.ok(inspectorBox && inspectorBox.width <= 480 && Math.abs(inspectorBox.x + inspectorBox.width - 820) <= 1, `tablet inspector must be a bounded right sheet, got ${JSON.stringify(inspectorBox)}`);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator("#mobileShellSurface")).toBeVisible();
  await page.locator("#mobileSurfaceCloseButton").click();
  await rail.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.locator("#promptInput")).toHaveValue("tablet rotation draft");

  for (const size of [{ width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(size);
    await expect(page.locator("#mobileShellV2")).toBeVisible();
  }
  await assertAxeClean(page, "tablet shell");

  await page.goto(`${baseURL}/?tabletShell=legacy`);
  await expect(page.locator("#mobileShellV2")).toBeHidden();
  await context.close();
});

test("desktop remains equivalent at required viewport fixtures", async ({ page }) => {
  for (const size of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(size);
    await page.goto(`${baseURL}/?mobileShell=v2&tabletShell=v2`);
    await expect(page.locator("#mobileShellV2")).toBeHidden();
    await expect(page.locator("#promptInput")).toBeVisible();
    await expect(page.locator(".terminal-tabs-shell")).toBeVisible();
    await expect(page.locator(".side-panel")).toBeVisible();
  }
});

test("desktop left-sidebar actions are compact accessible icon buttons", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseURL);
  await page.locator("body").evaluate((body) => body.classList.add("terminal-tabs-left"));

  const actions = page.locator(".terminal-sidebar-actions > button");
  await expect(actions).toHaveCount(4);
  const snapshots = await actions.evaluateAll((buttons) => buttons.map((button) => ({
    text: button.textContent.trim(),
    ariaLabel: button.getAttribute("aria-label"),
    width: button.getBoundingClientRect().width,
    height: button.getBoundingClientRect().height,
  })));
  for (const action of snapshots) {
    assert.equal(action.text, "", "left-sidebar action buttons should not render visible text");
    assert.ok(action.ariaLabel, "each icon-only action must retain an accessible name");
    assert.ok(action.width >= 44 && action.height >= 44, `icon action must retain a 44px target, got ${action.width}×${action.height}`);
  }
  assert.ok(Math.max(...snapshots.map((action) => action.width)) - Math.min(...snapshots.map((action) => action.width)) <= 1, "icon actions should remain equal width");
});
