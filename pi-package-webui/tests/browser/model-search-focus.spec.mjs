import assert from "node:assert/strict";
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
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-model-search-focus-"));
  baseURL = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [serverScript, "--cwd", tempRoot, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PI_WEBUI_RPC_SUPERVISOR: "0",
      FAKE_PI_CONTINUITY_MODE: "1",
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
      // Wait for the local server and fake Pi fixture.
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

test("desktop model search retains focus while agent output streams", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseURL);
  await page.locator("#updateNotification").evaluate((node) => { node.hidden = true; node.classList.remove("show"); });

  const sidePanel = page.locator("#sidePanel");
  if (!(await sidePanel.isVisible())) await page.locator("#sidePanelExpandButton").click();
  const controlsToggle = page.locator('[data-side-panel-section-toggle="controls"]');
  if (await controlsToggle.getAttribute("aria-expanded") !== "true") await controlsToggle.click();
  await expect(page.locator("#sidePanelSectionControls")).toBeVisible();

  await page.locator(".control-row-label:has(#modelControlLabel)").click();
  const modelSearch = page.locator("#modelSearchInput");
  await expect(modelSearch).toBeVisible();
  await modelSearch.fill("claude");
  await expect(modelSearch).toBeFocused();

  const tabsPayload = await (await page.request.get(`${baseURL}/api/tabs`)).json();
  const tabId = tabsPayload.data.activeTabId || tabsPayload.data.tabs[0].id;
  const response = await page.request.post(`${baseURL}/api/prompt?tab=${encodeURIComponent(tabId)}`, {
    data: { message: "fixture continuity delayed stream", requestId: `desktop-focus-${Date.now()}` },
  });
  assert.equal(response.ok(), true);

  await expect(page.locator(".message.assistant.streaming .streaming-markdown").last()).toContainText("continuity stream");
  await expect(modelSearch).toBeFocused();
  await expect(modelSearch).toHaveValue("claude");
  await expect.poll(async () => {
    const state = await (await page.request.get(`${baseURL}/api/state?tab=${encodeURIComponent(tabId)}`)).json();
    return state.data?.isStreaming === false;
  }, { timeout: 15_000 }).toBe(true);
  await expect(modelSearch).toBeFocused();
  await expect(modelSearch).toHaveValue("claude");
});
