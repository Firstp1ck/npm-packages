import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const fakePi = join(root, "tests", "fixtures", "fake-pi.mjs");
const layoutKey = "pi-webui-footer-scoped-model-layout-v1";
const orderKey = "pi-webui-footer-scoped-model-order-v1";
const footerCacheKey = "pi-webui-git-footer-webui-payload-cache";
const scopedModels = [
  { provider: "zeta", id: "z-one", name: "Zeta One" },
  { provider: "alpha", id: "a-one", name: "Alpha One" },
  { provider: "beta", id: "b-one", name: "Beta One" },
  { provider: "alpha", id: "a-two", name: "Alpha Two" },
  { provider: "zeta", id: "z-two", name: "Zeta Two" },
  { provider: "alpha", id: "a-three", name: "Alpha Three" },
];
const manyProviderModels = Array.from({ length: 10 }, (_, index) => ({
  provider: `provider-${String(index + 1).padStart(2, "0")}`,
  id: `model-${index + 1}`,
  name: `Provider ${index + 1} Model`,
}));
const footerPayload = JSON.stringify({
  type: "firstpick.git-footer-status.footer",
  version: 1,
  generatedAt: Date.now(),
  main: [{ key: "tokens", label: "tokens", value: "0" }],
  meta: [
    { key: "cwd", label: "cwd", value: "fixture" },
    { key: "model", label: "model", value: "fake/fake-model" },
    { key: "thinking", label: "effort", value: "off" },
  ],
  visibility: {},
});

let child;
let baseURL;
let tempRoot;
let output = "";

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startServer() {
  const port = await freePort();
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-footer-model-advanced-"));
  await mkdir(join(tempRoot, "agent"), { recursive: true });
  await writeFile(join(tempRoot, "settings.json"), "{}", "utf8");
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // Wait for the isolated fixture server.
    }
    await delay(100);
  }
  throw new Error(`Pi Web UI did not start:\n${output}`);
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([
    exited,
    delay(5_000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      return exited;
    }),
  ]);
}

async function installFixture(page, models = scopedModels) {
  const modelCalls = [];
  let selectedModel = null;
  await page.addInitScript(({ cacheKey, raw }) => {
    localStorage.setItem(cacheKey, JSON.stringify({ raw, cwd: "", savedAt: Date.now() }));
  }, { cacheKey: footerCacheKey, raw: footerPayload });
  await page.route("**/api/commands*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: { commands: [{ name: "git-footer-refresh", source: "extension", description: "Refresh Git footer" }] },
      }),
    });
  });
  await page.route("**/api/scoped-models*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { models, patterns: ["*"], source: "browser-fixture", rpcRunning: true } }),
    });
  });
  await page.route("**/api/state*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (selectedModel && body?.data) body.data.model = selectedModel;
    await route.fulfill({ response, json: body });
  });
  await page.route(/\/api\/model(?:\?.*)?$/, async (route) => {
    const body = route.request().postDataJSON();
    modelCalls.push(body);
    selectedModel = { provider: body.provider, id: body.modelId };
    await delay(120);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { provider: body.provider, id: body.modelId } }),
    });
  });
  return modelCalls;
}

async function preparePage(page) {
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/scoped-models") && response.ok()),
    page.goto(baseURL, { waitUntil: "domcontentloaded" }),
  ]);
  await page.addStyleTag({ content: "#optionalFeatureMigrationSurface, #updateNotification { display: none !important; }" });
  await expect(page.locator("#statusBar")).toHaveClass(/statusbar-git-footer/);
  await expect(page.locator(".footer-model.footer-meta-action")).toBeVisible();
}

async function openModelMenu(page) {
  const model = page.locator(".footer-model.footer-meta-action");
  await model.click({ button: "right" });
  const menu = page.locator("#gitFooterContextMenu");
  await expect(menu).toBeVisible();
  return { model, menu, toggle: menu.getByRole("menuitemcheckbox") };
}

async function openPicker(page, expectedClass = null, expectedModelCount = scopedModels.length) {
  const model = page.locator(".footer-model.footer-meta-action");
  await model.click();
  const picker = page.locator(".footer-model-picker");
  await expect(picker).toBeVisible();
  await expect(picker.locator(".footer-model-option")).toHaveCount(expectedModelCount);
  if (expectedClass) await expect(picker).toHaveClass(expectedClass);
  return picker;
}

async function dragModelOption(page, source, target, { after = false } = {}) {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  assert.ok(sourceBox && targetBox, "drag source and target should have measurable bounds");
  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = targetBox.x + targetBox.width / 2;
  const targetY = targetBox.y + (after ? targetBox.height - 3 : 3);
  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(sourceX, sourceY + 12, { steps: 2 });
  await page.mouse.move(targetX, targetY, { steps: 6 });
  await page.mouse.up();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(startServer);

test.afterAll(async () => {
  await stopServer();
  await rm(tempRoot, { recursive: true, force: true });
});

test("many provider columns grow over side panels, stop at the viewport, and scroll internally", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installFixture(page, manyProviderModels);
  await preparePage(page);

  const sidePanel = page.locator(".side-panel-right");
  await expect(sidePanel).toBeVisible();
  const menu = await openModelMenu(page);
  await menu.toggle.click();
  const picker = await openPicker(page, /footer-model-picker-advanced/, manyProviderModels.length);
  const geometry = await picker.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const columns = node.querySelector(".footer-model-provider-columns");
    const sidePanel = document.querySelector(".side-panel-right");
    const sideRect = sidePanel.getBoundingClientRect();
    const overlapLeft = Math.max(rect.left, sideRect.left);
    const overlapRight = Math.min(rect.right, sideRect.right);
    const overlapTop = Math.max(rect.top, sideRect.top);
    const overlapBottom = Math.min(rect.bottom, sideRect.bottom);
    const probeX = Math.min(overlapRight - 2, overlapLeft + 16);
    const probeY = Math.min(overlapBottom - 2, overlapTop + 16);
    const topNode = overlapRight > overlapLeft && overlapBottom > overlapTop
      ? document.elementFromPoint(probeX, probeY)
      : null;
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overlapsSidePanel: overlapRight > overlapLeft && overlapBottom > overlapTop,
      paintsAboveSidePanel: topNode?.closest?.(".footer-model-picker") === node,
      columnsClientWidth: columns.clientWidth,
      columnsScrollWidth: columns.scrollWidth,
      columnsOverflowX: getComputedStyle(columns).overflowX,
    };
  });
  assert.ok(geometry.left >= 7 && geometry.right <= geometry.viewportWidth - 7, `picker should remain within viewport gutters: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.viewportHeight, `picker should remain vertically bounded: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.width >= geometry.viewportWidth - 20, `many providers should grow the picker to its viewport cap: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.documentWidth, geometry.clientWidth, "provider columns should not widen the document");
  assert.equal(geometry.overlapsSidePanel, true, "the capped picker should use space above the visible side panel");
  assert.equal(geometry.paintsAboveSidePanel, true, "the picker should paint above side-panel content in the overlap");
  assert.ok(geometry.columnsScrollWidth > geometry.columnsClientWidth, `capped provider columns should overflow internally: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.columnsOverflowX, "auto");
  const horizontalScroll = await picker.locator(".footer-model-provider-columns").evaluate((columns) => {
    columns.scrollLeft = columns.scrollWidth;
    return { scrollLeft: columns.scrollLeft, maxScroll: columns.scrollWidth - columns.clientWidth };
  });
  assert.ok(horizontalScroll.scrollLeft > 0 && horizontalScroll.maxScroll - horizontalScroll.scrollLeft <= 16, `provider overflow should scroll to its end accounting for scrollbar gutters: ${JSON.stringify(horizontalScroll)}`);
});

test("advanced footer model layout persists, groups providers, navigates, applies, closes, and preserves flat mode", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const page1ModelCalls = await installFixture(page);
  const page2 = await page.context().newPage();
  const page2ModelCalls = await installFixture(page2);
  try {
    await preparePage(page);
    await preparePage(page2);

    // The checkbox is restricted to the Git footer Model box.
    const cwd = page.locator(".footer-workspace.footer-meta-action");
    await cwd.click({ button: "right" });
    await expect(page.locator('#gitFooterContextMenu [data-git-footer-menu-action="toggle-advanced"]')).toBeHidden();
    await page.keyboard.press("Escape");

    const keyboardModel = page.locator(".footer-model.footer-meta-action");
    await keyboardModel.focus();
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menuitemcheckbox", { name: "Toggle advanced" })).toBeVisible();
    await page.keyboard.press("Escape");

    const page2Menu = await openModelMenu(page2);
    await expect(page2Menu.toggle).toHaveAttribute("aria-checked", "false");
    await expect(page2Menu.toggle).toHaveText("Toggle advanced");

    // Toggle in one tab and prove live menu state, local persistence, and
    // same-origin adoption while the receiving menu remains open.
    const page1Menu = await openModelMenu(page);
    await expect(page1Menu.toggle).toHaveAttribute("aria-checked", "false");
    await page1Menu.toggle.click();
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), layoutKey)).toBe("advanced");
    await expect.poll(() => page2.evaluate((key) => localStorage.getItem(key), layoutKey)).toBe("advanced");
    await expect(page2Menu.toggle).toHaveAttribute("aria-checked", "true");
    await expect(page2Menu.toggle).toHaveText("Toggle Simple");
    await expect(page1Menu.model).toBeFocused();
    await page2.keyboard.press("Escape");

    // An already-open receiving picker must rebuild in place on both remote
    // transitions instead of retaining stale handlers from the old layout.
    const adoptedPicker = await openPicker(page2, /footer-model-picker-advanced/);
    const page1FlatMenu = await openModelMenu(page);
    await expect(page1FlatMenu.toggle).toHaveText("Toggle Simple");
    await page1FlatMenu.toggle.click();
    await expect(adoptedPicker).not.toHaveClass(/footer-model-picker-advanced/);
    await expect(adoptedPicker.locator(".footer-model-provider-column")).toHaveCount(0);
    const page1AdvancedMenu = await openModelMenu(page);
    await page1AdvancedMenu.toggle.click();
    await expect(adoptedPicker).toHaveClass(/footer-model-picker-advanced/);
    await expect(adoptedPicker.locator(".footer-model-provider-column")).toHaveCount(3);
    await page2.keyboard.press("Escape");

    // Reload keeps the browser-local choice.
    await Promise.all([
      page2.waitForResponse((response) => response.url().includes("/api/scoped-models") && response.ok()),
      page2.reload({ waitUntil: "domcontentloaded" }),
    ]);
    await page2.bringToFront();
    await page2.addStyleTag({ content: "#optionalFeatureMigrationSurface, #updateNotification { display: none !important; }" });
    await expect.poll(() => page2.evaluate((key) => localStorage.getItem(key), layoutKey)).toBe("advanced");

    await page2.addStyleTag({ content: ".footer-model-picker-advanced { width: 20rem !important; } .footer-model-provider-columns { max-width: 18rem; max-height: 7rem; }" });
    const picker = await openPicker(page2, /footer-model-picker-advanced/);
    await expect(picker).toHaveAttribute("aria-describedby", "footerModelPickerHelp");
    await expect(picker.locator("#footerModelPickerHelp")).toContainText("Drag within provider");
    await expect(picker.locator("#footerModelPickerHelp")).toContainText("Alt+Up/Down reorders");
    await expect(picker.locator("#footerModelPickerHelp")).toContainText("Home/End");
    await expect(picker.locator("#footerModelPickerHelp")).toContainText("Enter/Space");
    const helpGeometry = await picker.evaluate((node) => {
      const style = getComputedStyle(node);
      const helpRect = node.querySelector("#footerModelPickerHelp").getBoundingClientRect();
      return {
        helpWidth: helpRect.width,
        contentWidth: node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      };
    });
    assert.ok(Math.abs(helpGeometry.helpWidth - helpGeometry.contentWidth) <= 1, `advanced keybinding help should span the picker content width: ${JSON.stringify(helpGeometry)}`);
    const columns = picker.locator(".footer-model-provider-column");
    await expect(columns).toHaveCount(3);
    assert.deepEqual(
      await columns.locator(".footer-model-provider-title").allTextContents(),
      ["alpha", "beta", "zeta"],
      "provider columns should be alphabetically ordered",
    );
    assert.deepEqual(
      await columns.evaluateAll((items) => items.map((column) => [...column.querySelectorAll(".footer-model-option")].map((option) => option.dataset.footerModelKey))),
      [["alpha/a-one", "alpha/a-two", "alpha/a-three"], ["beta/b-one"], ["zeta/z-one", "zeta/z-two"]],
      "each provider should preserve scoped/cycling order",
    );

    // Pointer dragging changes order only inside the source provider. The
    // stored flat order keeps every other provider in its original slots.
    const dragLayoutStyle = await page2.addStyleTag({ content: ".footer-model-picker-advanced { width: 47rem !important; } .footer-model-provider-columns { max-width: 45rem !important; max-height: 14rem !important; }" });
    const alphaTwoForDrag = picker.locator('[data-footer-model-key="alpha/a-two"]');
    const alphaOneForDrag = picker.locator('[data-footer-model-key="alpha/a-one"]');
    const betaOneForDrag = picker.locator('[data-footer-model-key="beta/b-one"]');
    await dragModelOption(page2, alphaTwoForDrag, alphaOneForDrag);
    await expect(alphaTwoForDrag).toBeFocused();
    assert.deepEqual(
      await columns.nth(0).locator(".footer-model-option").evaluateAll((items) => items.map((option) => option.dataset.footerModelKey)),
      ["alpha/a-two", "alpha/a-one", "alpha/a-three"],
      "same-provider pointer drag should reorder the advanced column",
    );
    const providerLocalGlobalOrder = ["zeta/z-one", "alpha/a-two", "beta/b-one", "alpha/a-one", "zeta/z-two", "alpha/a-three"];
    await expect.poll(() => page2.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]"), orderKey)).toEqual(providerLocalGlobalOrder);

    await dragModelOption(page2, alphaTwoForDrag, betaOneForDrag);
    assert.deepEqual(
      await columns.evaluateAll((items) => items.map((column) => [...column.querySelectorAll(".footer-model-option")].map((option) => option.dataset.footerModelKey))),
      [["alpha/a-two", "alpha/a-one", "alpha/a-three"], ["beta/b-one"], ["zeta/z-one", "zeta/z-two"]],
      "dragging toward another provider should not move either model",
    );
    await expect.poll(() => page2.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]"), orderKey)).toEqual(providerLocalGlobalOrder);

    await alphaTwoForDrag.focus();
    await expect(alphaTwoForDrag).toBeFocused();
    await page2.keyboard.press("Alt+ArrowDown");
    await expect.poll(() => page2.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]"), orderKey)).toEqual(scopedModels.map((model) => `${model.provider}/${model.id}`));
    await expect.poll(
      () => columns.nth(0).locator(".footer-model-option").evaluateAll((items) => items.map((option) => option.dataset.footerModelKey)),
      { message: "Alt+Down should reorder only within the focused provider and restore the original order" },
    ).toEqual(["alpha/a-one", "alpha/a-two", "alpha/a-three"]);
    assert.deepEqual(page2ModelCalls, [], "reordering should not apply a model");
    await dragLayoutStyle.evaluate((node) => node.remove());

    // Reordering retains focus on the moved model. Resume the existing
    // provider-navigation checks from zeta's first model.
    await expect(alphaTwoForDrag).toBeFocused();
    await page2.keyboard.press("ArrowRight");
    await page2.keyboard.press("ArrowRight");
    const zetaOne = picker.locator('[data-footer-model-key="zeta/z-one"]');
    await expect(zetaOne).toBeFocused();
    const zetaGeometry = await zetaOne.evaluate((option) => {
      const optionRect = option.getBoundingClientRect();
      const scrollRect = option.closest(".footer-model-provider-columns").getBoundingClientRect();
      return { optionLeft: optionRect.left, optionRight: optionRect.right, scrollLeft: scrollRect.left, scrollRight: scrollRect.right };
    });
    assert.ok(zetaGeometry.optionLeft >= zetaGeometry.scrollLeft && zetaGeometry.optionRight <= zetaGeometry.scrollRight, `initial focus should reveal its provider: ${JSON.stringify(zetaGeometry)}`);
    await page2.keyboard.press("ArrowRight");
    await expect(zetaOne).toBeFocused();
    await page2.keyboard.press("ArrowLeft");
    await expect(picker.locator('[data-footer-model-key="beta/b-one"]')).toBeFocused();
    await page2.keyboard.press("ArrowLeft");
    const alphaOne = picker.locator('[data-footer-model-key="alpha/a-one"]');
    await expect(alphaOne).toBeFocused();
    await page2.keyboard.press("ArrowLeft");
    await expect(alphaOne).toBeFocused();
    await page2.keyboard.press("End");
    const alphaThree = picker.locator('[data-footer-model-key="alpha/a-three"]');
    await expect(alphaThree).toBeFocused();
    const alphaGeometry = await alphaThree.evaluate((option) => {
      const optionRect = option.getBoundingClientRect();
      const scrollRect = option.closest(".footer-model-provider-columns").getBoundingClientRect();
      return { optionTop: optionRect.top, optionBottom: optionRect.bottom, scrollTop: scrollRect.top, scrollBottom: scrollRect.bottom };
    });
    assert.ok(alphaGeometry.optionTop >= alphaGeometry.scrollTop && alphaGeometry.optionBottom <= alphaGeometry.scrollBottom, `model navigation should reveal its row: ${JSON.stringify(alphaGeometry)}`);

    // A model-order storage event forces a footer rebuild. Focus and the single
    // roving tabindex must stay on the same non-initial option.
    await page.evaluate(({ key, order }) => localStorage.setItem(key, JSON.stringify(order)), {
      key: orderKey,
      order: scopedModels.map((model) => `${model.provider}/${model.id}`),
    });
    await expect(alphaThree).toBeFocused();
    await expect(alphaThree).toHaveAttribute("tabindex", "0");
    await expect(picker.locator('.footer-model-option[tabindex="0"]')).toHaveCount(1);
    await page2.keyboard.press("Home");
    await expect(alphaOne).toBeFocused();
    await page2.keyboard.press("End");
    await expect(alphaThree).toBeFocused();
    await page2.keyboard.press("ArrowRight");
    await expect(picker.locator('[data-footer-model-key="beta/b-one"]')).toBeFocused();
    await page2.keyboard.press("ArrowRight");
    await expect(zetaOne).toBeFocused();
    assert.deepEqual(page2ModelCalls, [], "arrow navigation should not apply a model");

    await page2.keyboard.press("ArrowDown");
    const zetaTwo = picker.locator('[data-footer-model-key="zeta/z-two"]');
    await expect(zetaTwo).toBeFocused();
    await page2.keyboard.press("Enter");
    await expect(picker).toBeHidden();
    await page2.keyboard.press("Enter");
    await expect.poll(() => page2ModelCalls).toEqual([{ provider: "zeta", modelId: "z-two" }]);
    await expect(page2.locator(".footer-model .footer-meta-value")).toContainText("z-two");

    // Reopening focuses the now-active scoped model. Space applies once through
    // the same guarded path.
    const activePicker = await openPicker(page2, /footer-model-picker-advanced/);
    await expect(activePicker.locator('[data-footer-model-key="zeta/z-two"]')).toBeFocused();
    await page2.keyboard.press("Home");
    await expect(activePicker.locator('[data-footer-model-key="zeta/z-one"]')).toBeFocused();
    await page2.keyboard.press(" ");
    await expect(activePicker).toBeHidden();
    await expect.poll(() => page2ModelCalls).toEqual([
      { provider: "zeta", modelId: "z-two" },
      { provider: "zeta", modelId: "z-one" },
    ]);

    // Escape closes without applying and restores focus to the Model box.
    await openPicker(page2, /footer-model-picker-advanced/);
    await page2.keyboard.press("Escape");
    await expect(page2.locator(".footer-model-picker")).toBeHidden();
    await expect(page2.locator(".footer-model.footer-meta-action")).toBeFocused();
    assert.deepEqual(page2ModelCalls, [
      { provider: "zeta", modelId: "z-two" },
      { provider: "zeta", modelId: "z-one" },
    ]);

    // Return to flat mode and retain its provider-qualified labels, pointer
    // apply, and Alt+Arrow reorder contract.
    const flatMenu = await openModelMenu(page2);
    await expect(flatMenu.toggle).toHaveAttribute("aria-checked", "true");
    await expect(flatMenu.toggle).toHaveText("Toggle Simple");
    await flatMenu.toggle.click();
    await expect.poll(() => page2.evaluate((key) => localStorage.getItem(key), layoutKey)).toBe("flat");
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), layoutKey)).toBe("flat");
    const flatPicker = await openPicker(page2);
    await expect(flatPicker).not.toHaveClass(/footer-model-picker-advanced/);
    await expect(flatPicker.locator(".footer-model-provider-column")).toHaveCount(0);
    await expect(flatPicker.locator('[data-footer-model-key="alpha/a-two"] .footer-model-option-main')).toHaveText("alpha/a-two");
    const firstFlat = flatPicker.locator('[data-footer-model-key="zeta/z-one"]');
    await firstFlat.focus();
    await page2.keyboard.press("Alt+ArrowDown");
    await expect.poll(() => page2.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]"), orderKey)).toEqual([
      "alpha/a-one", "zeta/z-one", "beta/b-one", "alpha/a-two", "zeta/z-two", "alpha/a-three",
    ]);
    await flatPicker.locator('[data-footer-model-key="alpha/a-two"]').click();
    await expect.poll(() => page2ModelCalls).toEqual([
      { provider: "zeta", modelId: "z-two" },
      { provider: "zeta", modelId: "z-one" },
      { provider: "alpha", modelId: "a-two" },
    ]);

    // Narrow presentation stacks columns and remains inside the viewport.
    const advancedMenu = await openModelMenu(page2);
    await expect(advancedMenu.toggle).toHaveText("Toggle advanced");
    await advancedMenu.toggle.click();
    const narrowPicker = await openPicker(page2, /footer-model-picker-advanced/);
    await page2.setViewportSize({ width: 390, height: 844 });
    const geometry = await narrowPicker.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const columnsNode = node.querySelector(".footer-model-provider-columns");
      return {
        left: rect.left,
        right: rect.right,
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        gridAutoFlow: getComputedStyle(columnsNode).gridAutoFlow,
        overflowX: getComputedStyle(columnsNode).overflowX,
      };
    });
    assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewportWidth, `picker should remain inside the narrow viewport: ${JSON.stringify(geometry)}`);
    assert.equal(geometry.documentWidth, geometry.clientWidth, "advanced columns should not cause page-level horizontal overflow");
    assert.equal(geometry.gridAutoFlow, "row");
    assert.equal(geometry.overflowX, "hidden");
    await expect(narrowPicker.locator(".footer-model-provider-title")).toHaveCount(3);
    assert.deepEqual(page1ModelCalls, [], "the synchronization tab should not receive model changes");
  } finally {
    await page2.close();
  }
});
