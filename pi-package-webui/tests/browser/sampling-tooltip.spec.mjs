import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const fakePi = join(root, "tests", "fixtures", "fake-pi.mjs");
const parameterLabels = {
  temperature: "Temperature",
  top_p: "Top P",
  frequency_penalty: "Frequency Penalty",
  presence_penalty: "Presence Penalty",
  seed: "Seed",
  top_k: "Top K",
  min_p: "Min P",
};

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

test.beforeAll(async () => {
  const port = await freePort();
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-sampling-tooltip-"));
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
      // Wait for the package server and fake Pi fixture to start.
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

function samplingState() {
  const parameters = Object.fromEntries(Object.entries(parameterLabels).map(([key, label]) => [key, {
    supported: key === "temperature",
    reason: key === "temperature"
      ? "Supported by openai-codex-responses."
      : `openai-codex-responses does not declare ${label} support.`,
    source: key === "temperature" ? "api" : "unsupported",
  }]));
  return {
    session: { temperature: 0.7, top_p: 0.9 },
    defaults: { temperature: 1 },
    effective: { temperature: 0.7 },
    support: {
      supported: true,
      api: "openai-codex-responses",
      model: { provider: "openai-codex", id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
      parameters,
      compatibleApis: ["openai-completions", "openai-responses", "openai-codex-responses"],
      message: "Session sampling parameters apply to subsequent provider requests.",
    },
  };
}

async function tooltipVisualState(tooltip) {
  return tooltip.evaluate((node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      visuallyShown: !node.hidden && style.display !== "none" && style.clipPath === "none" && rect.width > 1 && rect.height > 1,
      pointerEvents: style.pointerEvents,
      rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height },
    };
  });
}

async function computedUnsupportedLabelContrast(row) {
  return row.evaluate((node) => {
    const parseColor = (value) => {
      const parts = String(value).match(/[\d.]+/g)?.map(Number) || [];
      return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: parts[3] ?? 1 };
    };
    const composite = (foreground, background) => ({
      r: foreground.r * foreground.a + background.r * (1 - foreground.a),
      g: foreground.g * foreground.a + background.g * (1 - foreground.a),
      b: foreground.b * foreground.a + background.b * (1 - foreground.a),
      a: 1,
    });
    const luminance = ({ r, g, b }) => {
      const linear = [r, g, b].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };

    const body = document.body;
    let background = parseColor(getComputedStyle(body).backgroundColor);
    background = composite(background, { r: 17, g: 17, b: 27, a: 1 });
    const ancestors = [];
    for (let current = node; current && current !== body; current = current.parentElement) ancestors.unshift(current);
    for (const ancestor of ancestors) background = composite(parseColor(getComputedStyle(ancestor).backgroundColor), background);

    const label = node.querySelector("label");
    const header = node.querySelector(".sampling-parameter-control-header");
    const labelColor = parseColor(getComputedStyle(label).color);
    labelColor.a *= Number.parseFloat(getComputedStyle(header).opacity) || 1;
    const renderedText = composite(labelColor, background);
    const light = Math.max(luminance(renderedText), luminance(background));
    const dark = Math.min(luminance(renderedText), luminance(background));
    return (light + 0.05) / (dark + 0.05);
  });
}

test("unsupported sampling tooltip is bounded, hoverable, accessible, and Escape-dismissible", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  await page.route("**/api/tabs/*/sampling-parameters", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: samplingState() }),
    });
  });
  await page.goto(baseURL);

  const toggle = page.locator('[data-side-panel-section-toggle="sampling"]');
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();

  const supportedRow = page.locator('[data-sampling-parameter="temperature"]');
  const supportedTooltip = supportedRow.locator('[role="tooltip"]');
  await expect(supportedRow).not.toHaveClass(/unsupported/);
  await expect(supportedRow).not.toHaveAttribute("aria-describedby", /.+/);
  await expect(supportedTooltip).toHaveAttribute("hidden", "");
  await expect(supportedTooltip).toHaveText("");

  const row = page.locator('[data-sampling-parameter="top_p"]');
  const tooltip = row.locator('[role="tooltip"]');
  await expect(row).toHaveClass(/unsupported/);
  await expect(row).toHaveAttribute("aria-describedby", "samplingParameterTopPUnsupportedReason");
  await expect(row.locator('input[type="checkbox"]')).toHaveAttribute("aria-describedby", "samplingParameterTopPUnsupportedReason");
  await expect(tooltip).not.toHaveAttribute("hidden", "");
  await expect(tooltip).toContainText("does not declare Top P support");

  await row.evaluate((node) => {
    const scrollports = [node.closest(".side-panel-section-content"), node.closest(".side-panel-body")].filter(Boolean);
    for (const scrollport of scrollports) {
      const delta = node.getBoundingClientRect().top - scrollport.getBoundingClientRect().top - 2;
      scrollport.scrollTop += delta;
    }
  });
  await row.hover();
  await expect.poll(() => tooltipVisualState(tooltip)).toMatchObject({ visuallyShown: true, pointerEvents: "auto" });
  await expect(tooltip).toHaveClass(/sampling-tooltip-below/);

  const [tooltipBox, sectionBox, panelBox] = await Promise.all([
    tooltip.boundingBox(),
    page.locator("#sidePanelSectionSampling").boundingBox(),
    page.locator("#sidePanel .side-panel-body").boundingBox(),
  ]);
  expect(tooltipBox).toBeTruthy();
  expect(sectionBox).toBeTruthy();
  expect(panelBox).toBeTruthy();
  const clippingTop = Math.max(0, sectionBox.y, panelBox.y);
  const clippingBottom = Math.min(620, sectionBox.y + sectionBox.height, panelBox.y + panelBox.height);
  expect(tooltipBox.y).toBeGreaterThanOrEqual(clippingTop - 1);
  expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(clippingBottom + 1);
  expect(tooltipBox.x).toBeGreaterThanOrEqual(panelBox.x - 1);
  expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);

  await page.mouse.move(tooltipBox.x + tooltipBox.width / 2, tooltipBox.y + tooltipBox.height / 2);
  await expect.poll(() => tooltipVisualState(tooltip)).toMatchObject({ visuallyShown: true, pointerEvents: "auto" });
  await page.keyboard.press("Escape");
  await expect(row).toHaveClass(/sampling-tooltip-dismissed/);
  await expect.poll(() => tooltipVisualState(tooltip)).toMatchObject({ visuallyShown: false, pointerEvents: "none" });

  await page.mouse.move(20, 20);
  await expect(row).toHaveClass(/sampling-tooltip-dismissed/);
  await row.hover();
  await expect(row).not.toHaveClass(/sampling-tooltip-dismissed/);
  await expect.poll(() => tooltipVisualState(tooltip)).toMatchObject({ visuallyShown: true });

  await page.mouse.move(20, 20);
  await row.focus();
  await expect(row).toBeFocused();
  await expect.poll(() => tooltipVisualState(tooltip)).toMatchObject({ visuallyShown: true });
  await page.keyboard.press("Escape");
  await expect(row).toHaveClass(/sampling-tooltip-dismissed/);
  await expect.poll(() => tooltipVisualState(tooltip)).toMatchObject({ visuallyShown: false });
  await toggle.focus();
  await expect(row).not.toHaveClass(/sampling-tooltip-dismissed/);
  await row.focus();
  await expect.poll(() => tooltipVisualState(tooltip)).toMatchObject({ visuallyShown: true });

  const contrast = await computedUnsupportedLabelContrast(row);
  console.log(`unsupported sampling label computed contrast: ${contrast.toFixed(2)}:1`);
  expect(contrast, `unsupported label computed contrast was ${contrast.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
});
