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
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-stats-dashboard-"));
  baseURL = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [serverScript, "--cwd", tempRoot, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PI_WEBUI_RPC_SUPERVISOR: "0",
      PI_CODING_AGENT_DIR: join(tempRoot, "agent"),
      PI_WEBUI_SETTINGS_FILE: join(tempRoot, "settings.json"),
      FAKE_PI_STATS_PROMPT_CONTEXT: "1",
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

async function openStatsOverlay(page) {
  await page.goto(baseURL);
  // Poll the activation so it also waits for the app boot to attach listeners.
  await expect
    .poll(async () => page.evaluate(() => {
      const dialog = document.querySelector("#statsOverlayDialog");
      if (dialog?.open) return true;
      document.querySelector("#optionsStatsButton")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return !!dialog?.open;
    }))
    .toBe(true);
  await expect(page.locator("#statsOverlayTabs [role='tab']").first()).toBeVisible();
}

async function emitStatsPromptFixture(page, message) {
  const tabsResponse = await page.request.get(`${baseURL}/api/tabs`);
  expect(tabsResponse.ok()).toBe(true);
  const tabsPayload = await tabsResponse.json();
  const tabId = tabsPayload.data?.activeTabId || tabsPayload.data?.tabs?.[0]?.id;
  expect(tabId).toBeTruthy();
  const response = await page.request.post(`${baseURL}/api/prompt?tab=${encodeURIComponent(tabId)}`, {
    data: { message, requestId: `stats-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  expect(response.ok()).toBe(true);
}

async function openPromptContextTab(page) {
  await openStatsOverlay(page);
  await emitStatsPromptFixture(page, "/stats-webui 14");
  await page.locator("#statsOverlayTab-prompt").click();
  await expect(page.locator("#statsOverlayBody .stats-prompt-initial")).toBeVisible();
}

async function emitMalformedSnapshot(page) {
  await emitStatsPromptFixture(page, "fixture stats prompt malformed");
}

async function expectNoPromptHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const selectors = ["html", "body", "#statsOverlayDialog", "#statsOverlayDialog form", "#statsOverlayBody", ".stats-prompt-pane"];
    return selectors.map((selector) => {
      const element = document.querySelector(selector);
      return { selector, clientWidth: element?.clientWidth ?? -1, scrollWidth: element?.scrollWidth ?? -1 };
    });
  });
  for (const measurement of overflow) {
    expect(measurement.clientWidth, `${measurement.selector} should exist`).toBeGreaterThanOrEqual(0);
    expect(measurement.scrollWidth, `${measurement.selector} should not overflow horizontally`).toBeLessThanOrEqual(measurement.clientWidth + 1);
  }
}

test("stats overlay exposes stable tab/tabpanel semantics", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStatsOverlay(page);

  const tabs = page.locator("#statsOverlayTabs [role='tab']");
  await expect(tabs).toHaveCount(7);

  const first = tabs.first();
  await expect(first).toHaveAttribute("id", "statsOverlayTab-overview");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(first).toHaveAttribute("aria-controls", "statsOverlayBody");
  await expect(first).toHaveAttribute("tabindex", "0");

  const second = tabs.nth(1);
  await expect(second).toHaveAttribute("aria-selected", "false");
  await expect(second).toHaveAttribute("tabindex", "-1");

  const panel = page.locator("#statsOverlayBody");
  await expect(panel).toHaveAttribute("role", "tabpanel");
  await expect(panel).toHaveAttribute("aria-labelledby", "statsOverlayTab-overview");

  await tabs.nth(3).click();
  await expect(tabs.nth(3)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(3)).toHaveAttribute("tabindex", "0");
  await expect(first).toHaveAttribute("aria-selected", "false");
  await expect(first).toHaveAttribute("tabindex", "-1");
  await expect(panel).toHaveAttribute("aria-labelledby", "statsOverlayTab-sessions");
});

test("stats overlay tablist supports arrow, Home, and End keyboard navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStatsOverlay(page);

  const tabs = page.locator("#statsOverlayTabs [role='tab']");
  const panel = page.locator("#statsOverlayBody");

  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(panel).toHaveAttribute("aria-labelledby", "statsOverlayTab-daily");

  await page.keyboard.press("Enter");
  await expect(tabs.nth(1)).toBeFocused();

  await page.keyboard.press("ArrowLeft");
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(tabs.first()).toBeFocused();

  await page.keyboard.press("End");
  await expect(tabs.nth(6)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(6)).toBeFocused();
  await expect(panel).toHaveAttribute("aria-labelledby", "statsOverlayTab-raw");

  await page.keyboard.press("ArrowRight");
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true", "ArrowRight should wrap to the first tab");

  await page.keyboard.press("ArrowLeft");
  await expect(tabs.nth(6)).toHaveAttribute("aria-selected", "true", "ArrowLeft should wrap to the last tab");

  await page.keyboard.press("Home");
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(tabs.first()).toBeFocused();
});

test("Prompt/context renders structured native sections and preserves raw command output", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPromptContextTab(page);

  const pane = page.locator("#statsOverlayBody .stats-prompt-pane");
  await expect(pane.locator(".stats-prompt-initial")).toHaveCount(1);
  await expect(pane.locator(".stats-prompt-snapshot")).toHaveCount(1);
  await expect(pane.locator(".stats-prompt-current")).toHaveCount(1);
  await expect(pane.locator(".stats-prompt-legacy-fallback")).toHaveCount(0);
  await expect(pane.locator(".stats-overlay-lines")).toHaveCount(0);
  await expect(pane.locator(".stats-prompt-inventory-details")).toHaveCount(5);
  await expectNoPromptHorizontalOverflow(page);

  await expect(pane).toContainText("System <img src=x onerror=\"globalThis.fixturePwned=true\"> & \"quoted\"");
  await expect(pane.locator("img, script")).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.fixturePwned)).toBeUndefined();
  await expect(pane.getByText("Zero-token framing", { exact: true })).toBeVisible();
  await expect(pane.locator(".stats-prompt-snapshot .stats-prompt-badge")).toHaveText("0 chars");

  const progress = pane.locator("progress.stats-prompt-progress");
  await expect(progress).toHaveAttribute("aria-label", "Actual current context utilization");
  await expect(progress).toHaveAttribute("aria-valuetext", "0 tok used / n/a window · 0.0%");
  await expect(progress).toHaveAttribute("value", "0");
  await expect(pane).toContainText("Source composition below is a character-derived heuristic");
  await expect(pane).toContainText("Actual − estimate");
  await expect(pane).toContainText("-200 tok");

  const details = pane.locator("details.stats-prompt-inventory-details");
  const metadataSummary = details.first().locator("summary");
  await metadataSummary.focus();
  await page.keyboard.press("Enter");
  await expect(details.first()).toHaveAttribute("open", "");
  await expect(details.first()).toContainText("Current date");
  await expect(details.first()).toContainText("n/a");

  await details.nth(1).locator("summary").click();
  await expect(details.nth(1)).toContainText("1 omitted");
  await expect(details.nth(1)).toContainText("<script>fixture-tool</script>");
  await expect(details.nth(1).locator("script")).toHaveCount(0);

  await page.locator("#statsOverlayTab-raw").click();
  const raw = page.locator("#statsOverlayBody .stats-overlay-lines");
  await expect(raw.filter({ hasText: "RAW_PROMPT_INJECTION <keep>& exact" })).toHaveCount(1);
  await expect(raw.filter({ hasText: "RAW_PROMPT_DETAILED </pre> exact" })).toHaveCount(1);
  await expect(raw.filter({ hasText: "RAW_CONTEXT_BREAKDOWN <raw> exact" })).toHaveCount(1);
  await expect(page.locator("#statsOverlayBody")).toContainText("RAW_PROMPT_INJECTION <keep>& exact\n\nRAW_PROMPT_DETAILED </pre> exact");
});

test("Prompt/context isolates a malformed subsection behind its matching legacy fallback", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPromptContextTab(page);
  await emitMalformedSnapshot(page);

  const pane = page.locator("#statsOverlayBody .stats-prompt-pane");
  await expect(pane.locator(".stats-prompt-legacy-fallback")).toHaveCount(1);
  await expect(pane.locator(".stats-prompt-initial")).toHaveCount(1);
  await expect(pane.locator(".stats-prompt-snapshot")).toHaveCount(0);
  await expect(pane.locator(".stats-prompt-current")).toHaveCount(1);
  await expect(pane.locator(".stats-overlay-lines")).toHaveCount(1);
  await expect(pane.locator(".stats-prompt-legacy-fallback")).toContainText("Structured data unavailable");
  await expect(pane.locator(".stats-overlay-lines")).toHaveText("RAW_PROMPT_DETAILED </pre> exact");
  await expect(pane).not.toContainText("RAW_PROMPT_INJECTION <keep>& exact");
  await expect(pane).not.toContainText("RAW_CONTEXT_BREAKDOWN <raw> exact");
});

test("Prompt/context causes no horizontal overflow at 390 and 320 pixels", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPromptContextTab(page);
  for (const summary of await page.locator(".stats-prompt-inventory-details summary").all()) await summary.click();
  await expectNoPromptHorizontalOverflow(page);

  await page.setViewportSize({ width: 320, height: 568 });
  await expectNoPromptHorizontalOverflow(page);

  const nestedVerticalScrollers = await page.evaluate(() => [...document.querySelectorAll(".stats-prompt-pane *")]
    .filter((element) => {
      const overflowY = getComputedStyle(element).overflowY;
      return ["auto", "scroll"].includes(overflowY) && element.scrollHeight > element.clientHeight + 1;
    })
    .map((element) => element.className || element.tagName));
  expect(nestedVerticalScrollers).toEqual([]);

  const tabs = page.locator("#statsOverlayTabs [role='tab']");
  await tabs.nth(5).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(6)).toHaveAttribute("aria-selected", "true", "keyboard navigation should keep working on narrow screens");
  await expect(tabs.nth(6)).toBeFocused();
});
