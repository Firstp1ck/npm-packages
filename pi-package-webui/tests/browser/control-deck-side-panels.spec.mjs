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
let child;
let baseURL;
let tempRoot;

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startServer() {
  const port = await freePort();
  baseURL = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [serverScript, "--cwd", tempRoot, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PI_WEBUI_RPC_SUPERVISOR: "0", PI_CODING_AGENT_DIR: join(tempRoot, "agent"), PI_WEBUI_SETTINGS_FILE: join(tempRoot, "settings.json") },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`server did not start: ${output}`);
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(5_000).then(() => child.kill("SIGKILL"))]);
}

async function openControls(page) {
  const toggle = page.locator('[data-side-panel-section-toggle="controls"]');
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await expect(page.locator("#controlDeckPlacementSelect")).toBeVisible();
}

async function selectPlacement(page, placement) {
  await openControls(page);
  await page.locator("#controlDeckPlacementSelect").selectOption(placement);
  await expect(page.locator("#controlDeckPlacementSelect")).toHaveValue(placement);
}

async function assertAxeClean(page, label, selector) {
  const accessibility = await new AxeBuilder({ page }).include(selector).disableRules(["aria-required-children"]).analyze();
  const serious = accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact));
  assert.deepEqual(serious, [], `${label} should have no serious/critical Axe violations: ${serious.map(({ id }) => id).join(", ")}`);
}

async function openAcceptanceFile(page) {
  const files = page.locator('[data-side-panel-section-toggle="files"]');
  if (await files.getAttribute("aria-expanded") !== "true") await files.click();
  const fixture = page.locator('[role="treeitem"][data-path="acceptance.txt"]');
  await expect(fixture).toBeVisible();
  await fixture.click();
  await expect(page.locator("#fileViewerPane")).toBeVisible();
}

async function dismissUpdateNotification(page, { waitMs = 2_500 } = {}) {
  const notification = page.locator("#updateNotification");
  const appeared = await notification.waitFor({ state: "visible", timeout: waitMs }).then(() => true).catch(() => false);
  if (!appeared) return;
  await page.locator("#updateNotificationDismissButton").click();
  await expect(notification).toBeHidden();
}

test.beforeAll(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-control-deck-"));
  await writeFile(join(tempRoot, "acceptance.txt"), "Control Deck capacity fixture\n", "utf8");
  await startServer();
});

test.afterAll(async () => {
  await stopServer();
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("Mobile v2 repeatedly returns canonical project content to its Control Deck owner", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${baseURL}/?mobileShell=v2`);
  await expect(page.locator("html")).toHaveAttribute("data-mobile-shell", "v2");
  const project = page.getByRole("navigation", { name: "Phone destinations" }).getByRole("button", { name: "Project", exact: true });
  const chat = page.getByRole("navigation", { name: "Phone destinations" }).getByRole("button", { name: "Chat", exact: true });
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await project.click();
    await page.getByRole("tab", { name: "Files" }).click();
    await expect.poll(() => page.locator("#sidePanelSectionFiles").evaluate((node) => node.parentElement?.id)).toBe("mobileProjectContent");
    await expect(page.locator("#sidePanelBodyRight #sidePanelSectionFiles")).toHaveCount(0);
    await chat.click();
    await expect.poll(() => page.locator("#sidePanelSectionFiles").evaluate((node) => node.closest("[data-control-deck-body]")?.id || "")).toBe("sidePanelBodyRight");
    await expect(page.locator("#mobileProjectContent #sidePanelSectionFiles")).toHaveCount(0);
  }
  await context.close();
});

test("Right, Left, Both, Sidebar rail, independent state, overlay, singleton ARIA, and reload", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 2200, height: 1000 });
  await page.goto(baseURL);
  await page.waitForTimeout(600);
  await dismissUpdateNotification(page);

  await expect(page.locator("#sidePanel")).toBeVisible();
  await expect(page.locator("#sidePanelLeft")).toBeHidden();
  await selectPlacement(page, "left");
  await expect(page.locator("#sidePanelLeft")).toBeVisible();
  await expect(page.locator("#openIssueButton")).toBeVisible();
  await expect(page.locator("#piVersionButton")).toHaveCount(1);

  await selectPlacement(page, "both");
  await expect(page.locator("#sidePanelLeft")).toBeVisible();
  await expect(page.locator("#sidePanel")).toBeVisible();
  await assertAxeClean(page, "visible left Control Deck", "#sidePanelLeft");
  await assertAxeClean(page, "visible right Control Deck", "#sidePanel");
  const controls = page.locator('[data-side-panel-section-toggle="controls"]');
  const files = page.locator('[data-side-panel-section-toggle="files"]');
  await expect(controls).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight");
  const initialOrder = await page.locator("#sidePanelBodyRight > [data-side-panel-section]").evaluateAll((nodes) => nodes.map((node) => node.dataset.sidePanelSection));
  await controls.focus();
  await controls.press("Alt+ArrowRight");
  await expect.poll(() => page.locator("#sidePanelBodyRight > [data-side-panel-section]").evaluateAll((nodes) => nodes.map((node) => node.dataset.sidePanelSection))).toEqual(initialOrder);
  await controls.press("Alt+ArrowLeft");
  await expect(page.locator('#sidePanelBodyLeft > [data-side-panel-section="controls"]')).toHaveCount(1);
  await expect(controls).toBeFocused();
  await expect(page.locator("#controlDeckMovementAnnouncer")).toContainText(/Controls moved to the left Control Deck, position 1 of 1/);
  await files.focus();
  await files.press("Alt+ArrowLeft");
  await expect(page.locator('#sidePanelBodyLeft > [data-side-panel-section="files"]')).toHaveCount(1);
  await expect(files).toBeFocused();
  await expect(page.locator("#controlDeckMovementAnnouncer")).toContainText(/Files moved to the left Control Deck, position 2 of 2/);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pi-webui-control-deck-layout-v2") || "null")?.sectionLayout?.leftSectionIds || [])).toEqual(expect.arrayContaining(["controls", "files"]));
  const git = page.locator('[data-side-panel-section-toggle="git"]');
  await dismissUpdateNotification(page);
  await git.scrollIntoViewIfNeeded();
  await expect(git).toBeVisible();
  await git.hover();
  const gitBox = await git.boundingBox();
  assert.ok(gitBox, "pointer cross-panel drag requires a visible source toggle");
  await page.mouse.down();
  await page.mouse.move(gitBox.x + gitBox.width / 2 + 32, gitBox.y + gitBox.height / 2 + 8, { steps: 8 });
  await expect(page.locator("body")).toHaveClass(/control-deck-section-dragging/);
  const leftDropBox = await page.locator('[data-control-deck-drop-target="left"]').boundingBox();
  assert.ok(leftDropBox, "pointer drag should reveal the populated destination drop target");
  await page.mouse.move(leftDropBox.x + leftDropBox.width / 2, leftDropBox.y + leftDropBox.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('#sidePanelBodyLeft > [data-side-panel-section="git"]')).toHaveCount(1);
  await git.press("Alt+ArrowRight");
  await expect(page.locator('#sidePanelBodyRight > [data-side-panel-section="git"]')).toHaveCount(1);

  await page.waitForTimeout(300);
  if (await files.getAttribute("aria-expanded") !== "true") await files.click();
  if (await controls.getAttribute("aria-expanded") !== "true") await controls.click();
  await expect(files).toHaveAttribute("aria-expanded", "false");
  await controls.press("Alt+ArrowRight");
  await expect(controls).toHaveAttribute("aria-expanded", "true");
  if (await files.getAttribute("aria-expanded") !== "true") await files.click();
  await expect(files).toHaveAttribute("aria-expanded", "true");
  await files.press("Alt+ArrowRight");
  await expect(files).toHaveAttribute("aria-expanded", "true");
  await expect(controls).toHaveAttribute("aria-expanded", "false");

  await files.press("Alt+ArrowLeft");
  const latentLeftBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("pi-webui-control-deck-layout-v2") || "null")?.sectionLayout?.leftSectionIds || []);
  await selectPlacement(page, "right");
  await controls.focus();
  await controls.press("Alt+ArrowDown");
  const rightOrder = await page.locator("#sidePanelBodyRight > [data-side-panel-section]").evaluateAll((nodes) => nodes.map((node) => node.dataset.sidePanelSection));
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pi-webui-control-deck-layout-v2") || "null")?.sectionLayout?.leftSectionIds || [])).toEqual(latentLeftBefore);
  await page.reload();
  await expect.poll(() => page.locator("#sidePanelBodyRight > [data-side-panel-section]").evaluateAll((nodes) => nodes.map((node) => node.dataset.sidePanelSection))).toEqual(rightOrder);
  await selectPlacement(page, "both");
  await expect(page.locator('#sidePanelBodyLeft > [data-side-panel-section="files"]')).toHaveCount(1);

  await page.locator("#toggleSidePanelLeftButton").click();
  await expect(page.locator("body")).toHaveClass(/side-panel-left-collapsed/);
  await expect(page.locator("#sidePanel")).toBeVisible();
  await page.locator("#sidePanelLeftExpandButton").click();
  await expect(page.locator("body")).not.toHaveClass(/side-panel-left-collapsed/);
  await page.locator("#sidePanelLeftResizeHandle").focus();
  const leftBefore = Number(await page.locator("#sidePanelLeftResizeHandle").getAttribute("aria-valuenow"));
  await page.locator("#sidePanelLeftResizeHandle").press("Shift+ArrowRight");
  await expect.poll(async () => Number(await page.locator("#sidePanelLeftResizeHandle").getAttribute("aria-valuenow"))).toBeGreaterThan(leftBefore);

  await openControls(page);
  await page.locator("#terminalTabsLayoutSelect").selectOption("left");
  await expect(page.locator("body")).toHaveClass(/terminal-tabs-left/);
  const chatBox = await page.locator(".chat").boundingBox();
  const railBox = await page.locator(".terminal-tabs-shell").boundingBox();
  assert.ok(chatBox && railBox && railBox.x > chatBox.x, "Sidebar terminal rail should render to the right of chat");
  await expect(page.locator("#controlDeckPlacementSelect")).toBeDisabled();
  const newTabButton = page.locator("#newTabButton");
  await newTabButton.hover();
  await expect(page.locator("#newTabMenuPanel")).toBeVisible();
  const pointerMenuBox = await page.locator("#newTabMenuPanel").boundingBox();
  assert.ok(pointerMenuBox && pointerMenuBox.x < railBox.x && pointerMenuBox.x >= 0 && pointerMenuBox.x + pointerMenuBox.width <= 2200, `pointer-opened right-rail menu should open inward without viewport clipping: ${JSON.stringify({ pointerMenuBox, railBox })}`);
  await page.mouse.move(chatBox.x + 20, chatBox.y + 20);
  await expect(page.locator("#newTabMenuPanel")).toBeHidden();
  await newTabButton.focus();
  await expect(page.locator("#newTabMenuPanel")).toBeVisible();
  const keyboardMenuBox = await page.locator("#newTabMenuPanel").boundingBox();
  assert.ok(keyboardMenuBox && keyboardMenuBox.x < railBox.x && keyboardMenuBox.x >= 0 && keyboardMenuBox.x + keyboardMenuBox.width <= 2200, `keyboard-opened right-rail menu should open inward without viewport clipping: ${JSON.stringify({ keyboardMenuBox, railBox })}`);
  await page.keyboard.press("Escape");
  const workspaceButton = page.locator("#workspaceDashboardToggleButton");
  await workspaceButton.hover();
  await expect.poll(() => workspaceButton.evaluate((button) => getComputedStyle(button, "::after").opacity)).toBe("1");
  await workspaceButton.focus();
  await expect.poll(() => workspaceButton.evaluate((button) => getComputedStyle(button, "::after").opacity)).toBe("1");
  await page.locator("#terminalTabsLayoutSelect").selectOption("top");
  await expect(page.locator("#controlDeckPlacementSelect")).toHaveValue("both");

  await page.setViewportSize({ width: 1500, height: 900 });
  await expect(page.locator("body")).not.toHaveClass(/control-deck-overlay/);
  const firstTabId = await page.locator("[data-tab-id]").first().getAttribute("data-tab-id");
  assert.ok(firstTabId, "the fixture should expose a splittable terminal tab");
  await page.locator(`[data-tab-id="${firstTabId}"] .terminal-tab-split-button`).click();
  await expect(page.locator("body")).toHaveClass(/terminal-split-open/);
  await openAcceptanceFile(page);
  await expect(page.locator("body")).toHaveClass(/control-deck-overlay/);
  await expect(page.locator("body")).toHaveClass(/side-panel-collapsed/);
  await expect(page.locator("#fileViewerPane")).toBeVisible();
  await expect(page.locator("#terminalSplitShell")).toBeVisible();
  await dismissUpdateNotification(page);
  await page.locator("#fileViewerCloseButton").click();
  await expect(page.locator("body")).not.toHaveClass(/control-deck-overlay/);
  await expect(page.locator("body")).toHaveClass(/terminal-split-open/);
  await expect(page.locator("#terminalSplitShell")).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/control-deck-both/);
  await expect(page.locator('#sidePanelBodyLeft > [data-side-panel-section="files"]')).toHaveCount(1);

  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.locator("body")).toHaveClass(/control-deck-overlay/);
  await expect(page.locator("#sidePanelLeft")).toBeHidden();
  await page.locator("#sidePanelExpandButton").click();
  await expect(page.locator("#sidePanel")).toHaveAttribute("role", "dialog");
  await expect(page.locator("#sidePanelBackdrop")).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(page.locator(".workspace-column")).toHaveCSS("visibility", "hidden");
  await assertAxeClean(page, "open Control Deck overlay", "#sidePanel");
  await page.keyboard.press("Escape");
  await expect(page.locator("#sidePanelBackdrop")).toBeHidden();

  const duplicateIds = await page.locator("[id]").evaluateAll((nodes) => {
    const ids = nodes.map((node) => node.id);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  });
  expect(duplicateIds).toEqual([]);
  const brokenAria = await page.locator("[aria-controls]").evaluateAll((nodes) => nodes.flatMap((node) => (node.getAttribute("aria-controls") || "").split(/\s+/)).filter((id) => id && !document.getElementById(id)));
  expect(brokenAria).toEqual([]);

  await page.setViewportSize({ width: 2200, height: 1000 });
  await expect(page.locator("body")).toHaveClass(/control-deck-both/);
  await page.reload();
  await expect(page.locator("body")).toHaveClass(/control-deck-both/);
  await expect(page.locator('#sidePanelBodyLeft > [data-side-panel-section="files"]')).toHaveCount(1);
});
