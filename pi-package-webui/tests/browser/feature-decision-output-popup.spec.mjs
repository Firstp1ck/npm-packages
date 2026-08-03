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

async function activeTabId(page) {
  const payload = await api(page, "/api/tabs");
  return payload.data?.activeTabId || payload.data?.tabs?.[0]?.id || "";
}

async function emitDecision(page, mode) {
  const tabId = await activeTabId(page);
  assert.ok(tabId, "the fixture requires an active WebUI tab");
  await api(page, `/api/prompt?tab=${encodeURIComponent(tabId)}`, {
    method: "POST",
    data: { message: `fixture feature decision ${mode}`, requestId: `feature-decision-${mode}-${Date.now()}` },
  });
}

test.beforeAll(async () => {
  const port = await freePort();
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-feature-decision-popup-"));
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
      // Wait for the isolated WebUI fixture.
    }
    await delay(100);
  }
  throw new Error(`Pi WebUI did not start:\n${output}`);
});

test.afterAll(async () => {
  if (child?.exitCode === null) child.kill("SIGTERM");
  if (child && child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
  await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
});

const COMPLEX_DIALOG_TEXT = "Decision: Complex feature (feature_complex)\nReason: Crosses the classifier extension and the WebUI status consumer.";
const LEGACY_DIALOG_TEXT = "Decision: Complex feature (feature_complex)\nReason: The classifier reported feature_complex without a reason.";

test("feature tag opens the readable classifier decision and replays it after reconnect", async ({ page }) => {
  await page.goto(baseURL);
  await emitDecision(page, "complex");

  const tag = page.locator("#featureCategoryTag");
  const dialog = page.locator("#featureDecisionDialog");
  const outputText = page.locator("#featureDecisionDialogOutput");
  const close = page.locator("#featureDecisionDialogCloseButton");

  await expect(tag).toBeVisible();
  await expect(tag).toBeEnabled();
  await expect(tag).toHaveText("complex-feature");

  await tag.click();
  await expect(dialog).toBeVisible();
  await expect(outputText).toHaveText(COMPLEX_DIALOG_TEXT);
  await expect(close).toBeFocused();

  await close.click();
  await expect(dialog).toBeHidden();
  await expect(tag).toBeFocused();

  await tag.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(tag).toBeFocused();

  await page.reload();
  await expect(tag).toBeVisible();
  await expect(tag).toBeEnabled();
  await tag.click();
  await expect(outputText).toHaveText(COMPLEX_DIALOG_TEXT);
  await page.keyboard.press("Escape");

  await emitDecision(page, "clear");
  await expect(dialog).toBeHidden();
  await expect(tag).toBeHidden();
});

test("legacy labels stay readable while mismatched and malformed payloads fail closed", async ({ page }) => {
  await page.goto(baseURL);

  const tag = page.locator("#featureCategoryTag");
  const dialog = page.locator("#featureDecisionDialog");
  const outputText = page.locator("#featureDecisionDialogOutput");

  await emitDecision(page, "legacy");
  await expect(tag).toBeEnabled();
  await tag.click();
  await expect(outputText).toHaveText(LEGACY_DIALOG_TEXT);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await emitDecision(page, "mismatch");
  await expect(tag).toBeVisible();
  await expect(tag).toHaveText("complex-feature");
  await expect(tag).toBeDisabled();

  await emitDecision(page, "malformed");
  await expect(tag).toBeVisible();
  await expect(tag).toBeDisabled();
  await expect(dialog).toBeHidden();

  await emitDecision(page, "clear");
  await expect(tag).toBeHidden();
});
