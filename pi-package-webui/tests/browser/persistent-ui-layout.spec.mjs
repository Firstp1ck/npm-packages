import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const fakePi = join(root, "tests", "fixtures", "fake-pi.mjs");
const layoutKeys = {
  sideOrder: "pi-webui-side-panel-section-order-v1",
  sideCollapsed: "pi-webui-side-panel-collapsed",
  composerOrder: "pi-webui-composer-action-order-v1",
  composerGrid: "pi-webui-composer-action-layout-v2",
  footerOrder: "pi-webui-footer-scoped-model-order-v1",
  terminalLayout: "pi-webui-terminal-tabs-layout",
  terminalGroups: "pi-webui-terminal-custom-groups-v1",
  fileViewerWidth: "pi-webui-file-viewer-width",
  sidePanelWidth: "pi-webui-side-panel-width",
};
const scopedModels = [
  { provider: "fake", id: "fake-model", name: "Fake Model" },
  { provider: "fake", id: "fake-beta", name: "Fake Beta" },
  { provider: "fake", id: "fake-gamma", name: "Fake Gamma" },
];

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

let child;
let baseURL;
let port;
let tempRoot;
let settingsFile;
let output = "";

async function startServer() {
  child = spawn(process.execPath, [serverScript, "--cwd", tempRoot, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PI_WEBUI_RPC_SUPERVISOR: "0",
      PI_CODING_AGENT_DIR: join(tempRoot, "agent"),
      PI_WEBUI_SETTINGS_FILE: settingsFile,
    },
  });
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
}

async function stopServer() {
  const stoppingChild = child;
  if (!stoppingChild || stoppingChild.exitCode !== null) return;
  const exited = new Promise((resolve) => stoppingChild.once("exit", resolve));
  stoppingChild.kill("SIGTERM");
  await Promise.race([
    exited,
    delay(5_000).then(() => {
      if (stoppingChild.exitCode === null) stoppingChild.kill("SIGKILL");
      return exited;
    }),
  ]);
}

async function ensureServerRunning() {
  try {
    const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(1_000) });
    if (response.ok) return;
  } catch {
    // Restart the isolated fixture server below.
  }
  await stopServer();
  await startServer();
}

async function serverApi(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${baseURL}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  const payload = await response.json().catch(() => ({}));
  assert.equal(response.ok, true, `${method} ${pathname} should succeed: ${payload.error || output}`);
  return payload;
}

async function seedStaleServerLayout() {
  const current = await serverApi("/api/interface-preferences");
  await serverApi("/api/interface-preferences", {
    method: "PUT",
    body: {
      sidePanelWidth: 352,
      expectedLayoutRevision: current.data.layoutRevision,
      layout: {
        version: 1,
        sidePanel: {
          sectionOrder: ["git", "files", "controls"],
          collapsedSectionIds: [],
          hiddenSectionIds: [],
          collapsed: false,
        },
        composerActions: { order: ["send", "new"], grid: null },
        footerScopedModelOrder: ["fake/fake-gamma", "fake/fake-beta", "fake/fake-model"],
        terminalTabs: { layout: "top", customGroups: { version: 1, groups: [] } },
        fileViewerWidth: 384,
      },
    },
  });
}

async function sectionOrder(page) {
  return page.locator("#sidePanel .side-panel-body > [data-side-panel-section]").evaluateAll((sections) => (
    sections.map((section) => section.dataset.sidePanelSection)
  ));
}

async function localLayout(page) {
  return page.evaluate((keys) => {
    const json = (key) => JSON.parse(localStorage.getItem(key) || "null");
    return {
      sideOrder: json(keys.sideOrder),
      composerOrder: json(keys.composerOrder),
      composerGrid: json(keys.composerGrid),
      footerOrder: json(keys.footerOrder),
      terminalLayout: localStorage.getItem(keys.terminalLayout),
      terminalGroups: json(keys.terminalGroups),
      fileViewerWidth: Number(localStorage.getItem(keys.fileViewerWidth)),
      sidePanelWidth: Number(localStorage.getItem(keys.sidePanelWidth)),
    };
  }, layoutKeys);
}

async function installScopedModelFixture(page) {
  await page.route("**/api/scoped-models*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { models: scopedModels, patterns: ["fake/*"], source: "browser-fixture", rpcRunning: true } }),
    });
  });
}

async function openFooterModelPicker(page) {
  const trigger = page.locator(".footer-tui-model, .footer-model.footer-meta-action").first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.locator(".footer-model-picker .footer-model-option")).toHaveCount(scopedModels.length);
}

async function openAcceptanceFile(page) {
  const filesToggle = page.locator('[data-side-panel-section-toggle="files"]');
  if (await filesToggle.getAttribute("aria-expanded") !== "true") await filesToggle.click();
  const file = page.locator('[role="treeitem"][data-path="acceptance.txt"]');
  await expect(file).toBeVisible();
  await file.click();
}

async function composerColumnCount(page) {
  return page.locator(".composer-row").evaluate((row) => {
    const style = getComputedStyle(row);
    const rawMinWidth = style.getPropertyValue("--composer-action-cell-min-width").trim();
    const numericMinWidth = Number.parseFloat(rawMinWidth);
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const rowFontSize = Number.parseFloat(style.fontSize) || rootFontSize;
    const minWidth = rawMinWidth.endsWith("rem")
      ? numericMinWidth * rootFontSize
      : rawMinWidth.endsWith("em")
        ? numericMinWidth * rowFontSize
        : numericMinWidth;
    const gap = Number.parseFloat(style.columnGap || style.gap) || 0;
    return Math.max(1, Math.floor((row.clientWidth + gap) / (minWidth + gap)));
  });
}

async function useMatchingComposerViewport(page, columns) {
  const current = page.viewportSize();
  const candidates = [current.width, ...Array.from({ length: 51 }, (_, index) => 1100 + (index * 24))];
  for (const width of [...new Set(candidates)]) {
    await page.setViewportSize({ width, height: current.height });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (await composerColumnCount(page) === columns) return width;
  }
  throw new Error(`Could not reproduce the stored ${columns}-column composer geometry`);
}

async function assertRestoredLayout(page, expected, { expectCustomGroup = null } = {}) {
  await expect.poll(() => sectionOrder(page)).toEqual(expected.sideOrder);
  await expect.poll(() => localLayout(page)).toMatchObject({
    sideOrder: expected.sideOrder,
    composerOrder: expected.composerOrder,
    composerGrid: expected.composerGrid,
    footerOrder: expected.footerOrder,
    terminalLayout: "left",
    fileViewerWidth: expected.fileViewerWidth,
    sidePanelWidth: expected.sidePanelWidth,
  });
  await expect(page.locator("body")).toHaveClass(/terminal-tabs-left/);
  await expect(page.locator("#terminalTabsLayoutSelect")).toHaveValue("left");
  await expect.poll(async () => Number(await page.locator("#sidePanelResizeHandle").getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(320);
  await expect.poll(async () => Number(await page.locator("#sidePanelResizeHandle").getAttribute("aria-valuenow"))).toBeLessThanOrEqual(expected.sidePanelWidth);
  await expect(page.locator("[data-side-panel-section-resize]")).toHaveCount(0);
  const matchingViewportWidth = await useMatchingComposerViewport(page, expected.composerGrid.columns);
  await expect.poll(() => page.locator('[data-composer-action-id="options"]').evaluate((node) => node.style.getPropertyValue("--composer-action-grid-column"))).toBe(expected.optionsColumn);
  if (expectCustomGroup === true) await expect(page.locator(".terminal-tab-custom-group")).toHaveCount(1);
  if (expectCustomGroup === false) await expect(page.locator(".terminal-tab-custom-group")).toHaveCount(0);

  await openFooterModelPicker(page);
  await expect.poll(() => page.locator(".footer-model-option").evaluateAll((buttons) => buttons.map((button) => button.dataset.footerModelKey))).toEqual(expected.footerOrder);
  await expect(page.locator('.footer-model-option[aria-selected="true"]')).toHaveAttribute("data-footer-model-key", "fake/fake-model");
  await page.keyboard.press("Escape");

  await openAcceptanceFile(page);
  await expect(page.locator("#fileViewerPane")).toBeVisible();
  await expect.poll(() => page.locator("#fileViewerResizeHandle").getAttribute("aria-valuenow")).toBe(String(expected.fileViewerWidth));
  await page.locator("#fileViewerCloseButton").click();
  return matchingViewportWidth;
}

test.beforeAll(async () => {
  port = await freePort();
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-persistent-layout-browser-"));
  settingsFile = join(tempRoot, "settings.json");
  baseURL = `http://127.0.0.1:${port}`;
  await mkdir(join(tempRoot, "other-cwd"));
  await writeFile(join(tempRoot, "acceptance.txt"), "durable layout browser fixture\n", "utf8");
  await startServer();
});

test.beforeEach(async () => {
  await ensureServerRunning();
});

test.afterAll(async () => {
  await stopServer();
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("server-owned layout survives stale reads, failed writes, localStorage clear, and process restart", async ({ browser }) => {
  test.setTimeout(90_000);

  const initialTabs = await serverApi("/api/tabs");
  const firstTabId = initialTabs.data.tabs[0].id;
  const created = await serverApi("/api/tabs", {
    method: "POST",
    body: { title: "Other cwd", cwd: join(tempRoot, "other-cwd") },
  });
  const secondTabId = created.data.tab.id;
  await seedStaleServerLayout();

  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const page = await context.newPage();
  await installScopedModelFixture(page);

  let releaseStaleGet;
  let staleGetCaptured;
  const staleGetReady = new Promise((resolve) => { staleGetCaptured = resolve; });
  const releaseStaleGetPromise = new Promise((resolve) => { releaseStaleGet = resolve; });
  let allowLayoutWrites = false;
  let failedLayoutWrites = 0;
  await page.route("**/api/interface-preferences", async (route) => {
    const request = route.request();
    if (request.method() === "GET" && !staleGetCaptured.used) {
      staleGetCaptured.used = true;
      const response = await route.fetch();
      staleGetCaptured();
      await releaseStaleGetPromise;
      await route.fulfill({ response });
      return;
    }
    if (request.method() === "PUT") {
      const payload = request.postDataJSON();
      if (payload?.layout && !allowLayoutWrites) {
        failedLayoutWrites += 1;
        await route.abort("failed");
        return;
      }
    }
    await route.continue();
  });

  await page.goto(baseURL);
  await staleGetReady;
  await expect(page.locator("#sidePanel")).toBeVisible();
  await expect(page.locator('[data-composer-action-id="options"]')).toBeVisible();

  await expect(page.locator("#sidePanelEditButton")).toBeHidden();
  const controls = page.locator('[data-side-panel-section-toggle="controls"]');
  await controls.focus();
  await controls.press("Alt+ArrowDown");
  const expectedSideOrder = await sectionOrder(page);
  expect(expectedSideOrder.slice(0, 3)).toEqual(["files", "controls", "git"]);

  const sidePanelResize = page.locator("#sidePanelResizeHandle");
  await sidePanelResize.focus();
  await sidePanelResize.press("Shift+ArrowLeft");
  const expectedSidePanelWidth = Number(await sidePanelResize.getAttribute("aria-valuenow"));
  expect(expectedSidePanelWidth).toBeGreaterThan(352);

  await openFooterModelPicker(page);
  const selectedModel = page.locator('[data-footer-model-key="fake/fake-model"]');
  const initialFooterOrder = await page.locator(".footer-model-option").evaluateAll((buttons) => buttons.map((button) => button.dataset.footerModelKey));
  const selectedModelIndex = initialFooterOrder.indexOf("fake/fake-model");
  const moveOffset = selectedModelIndex > 0 ? -1 : 1;
  const expectedFooterOrder = [...initialFooterOrder];
  [expectedFooterOrder[selectedModelIndex], expectedFooterOrder[selectedModelIndex + moveOffset]] = [expectedFooterOrder[selectedModelIndex + moveOffset], expectedFooterOrder[selectedModelIndex]];
  await selectedModel.evaluate((button, key) => button.dispatchEvent(new KeyboardEvent("keydown", { key, altKey: true, bubbles: true })), moveOffset < 0 ? "ArrowUp" : "ArrowDown");
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]"), layoutKeys.footerOrder)).toEqual(expectedFooterOrder);
  await expect.poll(() => page.locator(".footer-model-option").evaluateAll((buttons) => buttons.map((button) => button.dataset.footerModelKey))).toEqual(expectedFooterOrder);
  await expect(page.locator('.footer-model-option[aria-selected="true"]')).toHaveAttribute("data-footer-model-key", "fake/fake-model");
  await page.keyboard.press("Escape");

  const firstTab = page.locator(`[data-tab-id="${firstTabId}"]`).first();
  const secondTab = page.locator(`[data-tab-id="${secondTabId}"]`).first();
  await expect(firstTab).toBeVisible();
  await expect(secondTab).toBeVisible();
  await secondTab.dragTo(firstTab);
  await expect(page.locator(".terminal-tab-custom-group")).toHaveCount(1);
  const controlsToggle = page.locator('[data-side-panel-section-toggle="controls"]');
  if (await controlsToggle.getAttribute("aria-expanded") !== "true") await controlsToggle.click();
  await expect(page.locator("#terminalTabsLayoutSelect")).toBeVisible();
  await page.locator("#terminalTabsLayoutSelect").selectOption("left");
  await expect(page.locator("body")).toHaveClass(/terminal-tabs-left/);
  const options = page.locator('[data-composer-action-id="options"]');
  const optionsBox = await options.boundingBox();
  expect(optionsBox).toBeTruthy();
  await page.mouse.move(optionsBox.x + optionsBox.width / 2, optionsBox.y + optionsBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(optionsBox.x + optionsBox.width / 2 + 12, optionsBox.y + optionsBox.height / 2, { steps: 2 });
  const gridGuide = page.locator("#composerActionGridGuide");
  await expect(gridGuide).toBeVisible();
  const lastCell = await gridGuide.locator(".composer-action-grid-cell").last().boundingBox();
  expect(lastCell).toBeTruthy();
  await page.mouse.move(lastCell.x + lastCell.width / 2, lastCell.y + lastCell.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(gridGuide).toBeHidden();

  await openAcceptanceFile(page);
  await expect(page.locator("#fileViewerPane")).toBeVisible();
  const fileViewerResize = page.locator("#fileViewerResizeHandle");
  await fileViewerResize.focus();
  await fileViewerResize.press("Shift+ArrowLeft");
  const expectedFileViewerWidth = Number(await fileViewerResize.getAttribute("aria-valuenow"));
  expect(expectedFileViewerWidth).toBeGreaterThan(384);
  await page.locator("#fileViewerCloseButton").click();

  const expectedLocal = await localLayout(page);
  expect(expectedLocal.composerGrid?.positions?.options).toBeGreaterThan(0);
  expect(expectedLocal.terminalGroups?.groups?.[0]?.tabIds).toEqual([firstTabId, secondTabId]);
  const optionsColumn = String((expectedLocal.composerGrid.positions.options % expectedLocal.composerGrid.columns) + 1);
  const expected = {
    ...expectedLocal,
    sideOrder: expectedSideOrder,
    footerOrder: expectedFooterOrder,
    fileViewerWidth: expectedFileViewerWidth,
    sidePanelWidth: expectedSidePanelWidth,
    optionsColumn,
  };

  releaseStaleGet();
  await expect.poll(() => sectionOrder(page)).toEqual(expectedSideOrder);
  await expect.poll(() => localLayout(page)).toMatchObject(expectedLocal);
  await expect.poll(() => failedLayoutWrites).toBeGreaterThan(0);
  allowLayoutWrites = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect.poll(async () => (await serverApi("/api/interface-preferences")).data.layout).toMatchObject({
    sidePanel: { sectionOrder: expected.sideOrder },
    composerActions: { order: expected.composerOrder, grid: expected.composerGrid },
    footerScopedModelOrder: expected.footerOrder,
    terminalTabs: { layout: "left", customGroups: expected.terminalGroups },
    fileViewerWidth: expected.fileViewerWidth,
  });
  await expect.poll(async () => (await serverApi("/api/interface-preferences")).data.preferences.sidePanelWidth).toBe(expected.sidePanelWidth);

  await page.evaluate(() => localStorage.clear());
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.reload();
  const matchingViewportWidth = await assertRestoredLayout(page, expected, { expectCustomGroup: true });

  await page.setViewportSize({ width: 700, height: 900 });
  await expect(page.locator("body")).not.toHaveClass(/composer-action-grid-enabled/);
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), layoutKeys.composerGrid)).toEqual(expected.composerGrid);
  await page.setViewportSize({ width: matchingViewportWidth, height: 1000 });
  await expect.poll(() => options.evaluate((node) => node.style.getPropertyValue("--composer-action-grid-column"))).toBe(expected.optionsColumn);

  await context.close();
  await stopServer();
  const settingsOnDisk = JSON.parse(await readFile(settingsFile, "utf8"));
  assert.deepEqual(settingsOnDisk.uiLayout.sidePanel.sectionOrder, expected.sideOrder, "the private settings file should contain the browser-committed Control Deck order");
  assert.equal("sectionHeights" in settingsOnDisk.uiLayout.sidePanel, false, "removed Control Deck section heights must not be persisted");
  assert.deepEqual(settingsOnDisk.uiLayout.composerActions.grid, expected.composerGrid, "the private settings file should contain the exact sparse composer grid");
  assert.equal(settingsOnDisk.uiLayout.fileViewerWidth, expected.fileViewerWidth, "the private settings file should contain the browser-committed file-viewer width");

  await startServer();
  const freshContext = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  assert.deepEqual((await freshContext.storageState()).origins, [], "the restart assertion must begin with a fresh browser context and no origin storage");
  const freshPage = await freshContext.newPage();
  await installScopedModelFixture(freshPage);
  await freshPage.goto(baseURL);
  await assertRestoredLayout(freshPage, expected, { expectCustomGroup: false });
  await expect.poll(() => freshPage.evaluate((key) => localStorage.getItem(key), layoutKeys.terminalGroups)).not.toBeNull();
  await freshContext.close();
});

test("returning browsers adopt authoritative Control Deck state without echo writes", async ({ browser }) => {
  const current = await serverApi("/api/interface-preferences");
  const serverSideOrder = ["git", "files", "controls"];
  await serverApi("/api/interface-preferences", {
    method: "PUT",
    body: {
      expectedLayoutRevision: current.data.layoutRevision,
      layout: {
        version: 1,
        sidePanel: {
          sectionOrder: serverSideOrder,
          collapsedSectionIds: [],
          hiddenSectionIds: [],
          collapsed: false,
        },
      },
    },
  });

  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  await context.addInitScript(({ sideOrder, sideCollapsed }) => {
    localStorage.setItem(sideOrder, JSON.stringify(["files", "controls", "git"]));
    localStorage.setItem(sideCollapsed, "1");
    localStorage.setItem("pi-webui-side-panel-section-heights-v1", JSON.stringify({ controls: 240 }));
  }, layoutKeys);
  const page = await context.newPage();
  let layoutPuts = 0;
  await page.route("**/api/interface-preferences", async (route) => {
    if (route.request().method() === "PUT" && route.request().postDataJSON()?.layout) layoutPuts += 1;
    await route.continue();
  });

  await page.goto(baseURL);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("pi-webui-side-panel-section-heights-v1"))).toBeNull();
  await expect.poll(async () => (await sectionOrder(page)).slice(0, serverSideOrder.length)).toEqual(serverSideOrder);
  await expect(page.locator("body")).not.toHaveClass(/side-panel-collapsed/);
  await page.waitForTimeout(700);
  expect(layoutPuts).toBe(0);
  const persisted = await serverApi("/api/interface-preferences");
  assert.deepEqual(persisted.data.layout.sidePanel.sectionOrder, serverSideOrder);
  assert.equal("sectionHeights" in persisted.data.layout.sidePanel, false);
  assert.equal(persisted.data.layout.sidePanel.collapsed, false);

  const controlsToggle = page.locator('[data-side-panel-section-toggle="controls"]');
  if (await controlsToggle.getAttribute("aria-expanded") !== "true") await controlsToggle.click();
  const controlsSection = page.locator('[data-side-panel-section="controls"]');
  await expect(page.locator("[data-side-panel-section-resize]")).toHaveCount(0);
  await controlsToggle.click({ button: "right" });
  const controlsVisibilityItem = page.locator('[data-side-panel-section-visibility="controls"]');
  await expect(controlsVisibilityItem).toBeVisible();
  await controlsVisibilityItem.click();
  await expect(controlsSection).toBeHidden();
  await controlsVisibilityItem.click();
  await expect(controlsSection).toBeVisible();
  await context.close();
});

test("failed layout writes remain pending across reload and later synchronize", async ({ browser }) => {
  const current = await serverApi("/api/interface-preferences");
  await serverApi("/api/interface-preferences", {
    method: "PUT",
    body: {
      expectedLayoutRevision: current.data.layoutRevision,
      layout: { version: 1, composerActions: { order: ["send", "new"], grid: null } },
    },
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let allowWrites = false;
  let failedWrites = 0;
  await page.route("**/api/interface-preferences", async (route) => {
    if (route.request().method() === "PUT" && route.request().postDataJSON()?.layout && !allowWrites) {
      failedWrites += 1;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.goto(baseURL);
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]").slice(0, 2), layoutKeys.composerOrder)).toEqual(["send", "new"]);
  const newSession = page.locator('[data-composer-action-id="new"]');
  await newSession.focus();
  await newSession.press("Alt+ArrowLeft");
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]").slice(0, 2), layoutKeys.composerOrder)).toEqual(["new", "send"]);
  await expect.poll(() => failedWrites).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).find((key) => key.startsWith("pi-webui-ui-layout-pending-v3:")) || null)).not.toBeNull();

  await page.reload();
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]").slice(0, 2), layoutKeys.composerOrder)).toEqual(["new", "send"]);
  allowWrites = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await serverApi("/api/interface-preferences")).data.layout.composerActions.order.slice(0, 2)).toEqual(["new", "send"]);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).find((key) => key.startsWith("pi-webui-ui-layout-pending-v3:")) || null)).toBeNull();
  await context.close();
});

test("conflict retry updates only the changed Control Deck subfield", async ({ browser }) => {
  const current = await serverApi("/api/interface-preferences");
  const initialOrder = ["files", "controls", "git"];
  await serverApi("/api/interface-preferences", {
    method: "PUT",
    body: {
      expectedLayoutRevision: current.data.layoutRevision,
      layout: {
        version: 1,
        sidePanel: {
          sectionOrder: initialOrder,
          collapsedSectionIds: [],
          hiddenSectionIds: [],
          collapsed: false,
        },
      },
    },
  });

  const contextA = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const contextB = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await Promise.all([pageA.goto(baseURL), pageB.goto(baseURL)]);
  await expect.poll(async () => (await sectionOrder(pageA)).slice(0, initialOrder.length)).toEqual(initialOrder);
  await expect.poll(async () => (await sectionOrder(pageB)).slice(0, initialOrder.length)).toEqual(initialOrder);

  await expect(pageA.locator("#sidePanelEditButton")).toBeHidden();
  const controlsA = pageA.locator('[data-side-panel-section-toggle="controls"]');
  await controlsA.focus();
  await controlsA.press("Alt+ArrowDown");
  const newerOrder = ["files", "git", "controls"];
  await expect.poll(async () => (await serverApi("/api/interface-preferences")).data.layout.sidePanel.sectionOrder.slice(0, newerOrder.length)).toEqual(newerOrder);

  await pageB.locator("#toggleSidePanelButton").click();
  await expect(pageB.locator("body")).toHaveClass(/side-panel-collapsed/);
  await expect.poll(async () => (await serverApi("/api/interface-preferences")).data.layout.sidePanel.collapsed).toBe(true);
  const final = await serverApi("/api/interface-preferences");
  assert.deepEqual(final.data.layout.sidePanel.sectionOrder.slice(0, newerOrder.length), newerOrder, "a stale collapse retry must not revert another browser's newer section order");

  await Promise.all([contextA.close(), contextB.close()]);
});

test("one tab cannot erase another tab's failed pending journal", async ({ browser }) => {
  const current = await serverApi("/api/interface-preferences");
  await serverApi("/api/interface-preferences", {
    method: "PUT",
    body: {
      expectedLayoutRevision: current.data.layoutRevision,
      layout: {
        version: 1,
        sidePanel: {
          sectionOrder: ["files", "controls", "git"],
          collapsedSectionIds: [],
          hiddenSectionIds: [],
          collapsed: false,
        },
        composerActions: { order: ["send", "new"], grid: null },
      },
    },
  });

  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  let allowComposerWrites = false;
  let failedComposerWrites = 0;
  await pageA.route("**/api/interface-preferences", async (route) => {
    const payload = route.request().method() === "PUT" ? route.request().postDataJSON() : null;
    if (payload?.layout?.composerActions && !allowComposerWrites) {
      failedComposerWrites += 1;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await Promise.all([pageA.goto(baseURL), pageB.goto(baseURL)]);
  await expect.poll(() => pageA.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]").slice(0, 2), layoutKeys.composerOrder)).toEqual(["send", "new"]);

  const newSession = pageA.locator('[data-composer-action-id="new"]');
  await newSession.evaluate((button) => button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true })));
  await expect.poll(() => pageA.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]").slice(0, 2), layoutKeys.composerOrder)).toEqual(["new", "send"]);
  await expect.poll(() => failedComposerWrites).toBeGreaterThan(0);
  await expect.poll(() => pageA.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("pi-webui-ui-layout-pending-v3:")).length)).toBeGreaterThan(0);

  await pageB.locator("#toggleSidePanelButton").click();
  await expect.poll(async () => (await serverApi("/api/interface-preferences")).data.layout.sidePanel.collapsed).toBe(true);
  await expect.poll(() => pageB.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith("pi-webui-ui-layout-pending-v3:"))
    .map((key) => JSON.parse(localStorage.getItem(key) || "null"))
    .some((record) => record?.field === "composerActions"))).toBe(true);

  await pageA.reload();
  await expect.poll(() => pageA.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]").slice(0, 2), layoutKeys.composerOrder)).toEqual(["new", "send"]);
  allowComposerWrites = true;
  await pageA.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await serverApi("/api/interface-preferences")).data.layout.composerActions.order.slice(0, 2)).toEqual(["new", "send"]);
  await context.close();
});

test("in-flight sibling acknowledgement clears only the acknowledged subfield", async ({ browser }) => {
  const current = await serverApi("/api/interface-preferences");
  const initialOrder = ["files", "controls", "git"];
  await serverApi("/api/interface-preferences", {
    method: "PUT",
    body: {
      expectedLayoutRevision: current.data.layoutRevision,
      layout: {
        version: 1,
        sidePanel: {
          sectionOrder: initialOrder,
          collapsedSectionIds: [],
          hiddenSectionIds: [],
          collapsed: false,
        },
      },
    },
  });

  const contextA = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const contextB = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  let interceptWrites = false;
  let firstOrderFetched;
  let releaseFirstOrder;
  let secondWriteSeen;
  let releaseSecondWrite;
  let secondPayload = null;
  const firstOrderFetchedPromise = new Promise((resolve) => { firstOrderFetched = resolve; });
  const releaseFirstOrderPromise = new Promise((resolve) => { releaseFirstOrder = resolve; });
  const secondWriteSeenPromise = new Promise((resolve) => { secondWriteSeen = resolve; });
  const releaseSecondWritePromise = new Promise((resolve) => { releaseSecondWrite = resolve; });
  let firstOrderIntercepted = false;
  let secondWriteIntercepted = false;
  await pageA.route("**/api/interface-preferences", async (route) => {
    const request = route.request();
    const payload = request.method() === "PUT" ? request.postDataJSON() : null;
    if (interceptWrites && payload?.layout && !firstOrderIntercepted && payload.layout.sidePanel?.sectionOrder) {
      firstOrderIntercepted = true;
      const response = await route.fetch();
      firstOrderFetched();
      await releaseFirstOrderPromise;
      await route.fulfill({ response });
      return;
    }
    if (interceptWrites && payload?.layout && firstOrderIntercepted && !secondWriteIntercepted) {
      secondWriteIntercepted = true;
      secondPayload = payload;
      secondWriteSeen();
      await releaseSecondWritePromise;
      await route.continue();
      return;
    }
    await route.continue();
  });
  await Promise.all([pageA.goto(baseURL), pageB.goto(baseURL)]);
  await expect.poll(async () => (await sectionOrder(pageA)).slice(0, initialOrder.length)).toEqual(initialOrder);
  await expect.poll(async () => (await sectionOrder(pageB)).slice(0, initialOrder.length)).toEqual(initialOrder);
  interceptWrites = true;

  const controlsA = pageA.locator('[data-side-panel-section-toggle="controls"]');
  await controlsA.evaluate((button) => button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true })));
  await firstOrderFetchedPromise;
  await pageA.locator("#toggleSidePanelButton").click();
  releaseFirstOrder();
  await secondWriteSeenPromise;
  assert.equal(Object.hasOwn(secondPayload.layout.sidePanel || {}, "sectionOrder"), false, "the acknowledged order must not remain in the pending collapse patch");
  assert.equal(secondPayload.layout.sidePanel?.collapsed, true);

  const controlsB = pageB.locator('[data-side-panel-section-toggle="controls"]');
  await controlsB.evaluate((button) => button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true })));
  const browserBOrder = ["controls", "files", "git"];
  await expect.poll(async () => (await serverApi("/api/interface-preferences")).data.layout.sidePanel.sectionOrder.slice(0, browserBOrder.length)).toEqual(browserBOrder);
  releaseSecondWrite();
  await expect.poll(async () => (await serverApi("/api/interface-preferences")).data.layout.sidePanel.collapsed).toBe(true);
  const final = await serverApi("/api/interface-preferences");
  assert.deepEqual(final.data.layout.sidePanel.sectionOrder.slice(0, browserBOrder.length), browserBOrder);
  await Promise.all([contextA.close(), contextB.close()]);
});

test("a delayed GET cannot regress the revision acknowledged by a newer PUT", async ({ browser }) => {
  const current = await serverApi("/api/interface-preferences");
  await serverApi("/api/interface-preferences", {
    method: "PUT",
    body: {
      expectedLayoutRevision: current.data.layoutRevision,
      layout: {
        version: 1,
        sidePanel: {
          sectionOrder: ["files", "controls", "git"],
          collapsedSectionIds: [],
          hiddenSectionIds: [],
          collapsed: false,
        },
      },
    },
  });

  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const page = await context.newPage();
  let holdReconcileGet = false;
  let delayedGetCaptured;
  let releaseDelayedGet;
  let captureNextPut = false;
  let capturedExpectedRevision = null;
  const delayedGetCapturedPromise = new Promise((resolve) => { delayedGetCaptured = resolve; });
  const releaseDelayedGetPromise = new Promise((resolve) => { releaseDelayedGet = resolve; });
  await page.route("**/api/interface-preferences", async (route) => {
    const request = route.request();
    if (holdReconcileGet && request.method() === "GET") {
      holdReconcileGet = false;
      const response = await route.fetch();
      delayedGetCaptured();
      await releaseDelayedGetPromise;
      await route.fulfill({ response });
      return;
    }
    if (captureNextPut && request.method() === "PUT") {
      const payload = request.postDataJSON();
      if (Object.hasOwn(payload?.layout?.sidePanel || {}, "collapsed")) {
        captureNextPut = false;
        capturedExpectedRevision = payload.expectedLayoutRevision;
      }
    }
    await route.continue();
  });
  await page.goto(baseURL);
  holdReconcileGet = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await delayedGetCapturedPromise;

  const controls = page.locator('[data-side-panel-section-toggle="controls"]');
  const orderBeforeMove = (await sectionOrder(page)).slice(0, 3);
  const controlsIndex = orderBeforeMove.indexOf("controls");
  const moveOffset = controlsIndex < orderBeforeMove.length - 1 ? 1 : -1;
  const newerOrder = [...orderBeforeMove];
  [newerOrder[controlsIndex], newerOrder[controlsIndex + moveOffset]] = [newerOrder[controlsIndex + moveOffset], newerOrder[controlsIndex]];
  const newerPutResponse = page.waitForResponse((response) => {
    if (!response.url().includes("/api/interface-preferences") || response.request().method() !== "PUT") return false;
    return Array.isArray(response.request().postDataJSON()?.layout?.sidePanel?.sectionOrder);
  });
  await controls.evaluate((button, key) => button.dispatchEvent(new KeyboardEvent("keydown", { key, altKey: true, bubbles: true })), moveOffset > 0 ? "ArrowDown" : "ArrowUp");
  await newerPutResponse;
  await expect.poll(async () => (await serverApi("/api/interface-preferences")).data.layout.sidePanel.sectionOrder.slice(0, newerOrder.length)).toEqual(newerOrder);
  await expect.poll(() => page.evaluate((prefix) => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      try {
        const record = JSON.parse(localStorage.getItem(key) || "null");
        if (record?.field === "sidePanel" && record?.subfield === "sectionOrder") return true;
      } catch {
        // Ignore malformed unrelated records; production also fails soft here.
      }
    }
    return false;
  }, "pi-webui-ui-layout-pending-v3:")).toBe(false);
  releaseDelayedGet();
  await page.waitForTimeout(300);
  const revisionBeforeCollapse = (await serverApi("/api/interface-preferences")).data.layoutRevision;

  captureNextPut = true;
  await page.locator("#toggleSidePanelButton").evaluate((button) => button.click());
  await expect.poll(() => capturedExpectedRevision).toBe(revisionBeforeCollapse);
  await expect.poll(async () => (await serverApi("/api/interface-preferences")).data.layout.sidePanel.collapsed).toBe(true);
  await context.close();
});
