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
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-component-updates-"));
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
  child?.kill("SIGTERM");
  if (child) await new Promise((resolve) => child.once("exit", resolve));
  await rm(tempRoot, { recursive: true, force: true });
});

test("component tags and dialogs expose safe background update lifecycle", async ({ page }) => {
  const requests = [];
  let statusPollsAfterStart = 0;
  const status = {
    updateAvailable: true,
    updateInProgress: false,
    canRunUpdate: true,
    pi: { checked: true, currentVersion: "0.83.0", latestVersion: "0.84.0", updateAvailable: true },
    webui: { checked: true, currentVersion: "0.8.1", latestVersion: "0.8.2", updateAvailable: true },
    componentUpdates: {
      pi: { target: "pi", state: "idle", message: "", error: "", canStart: true, unavailableReason: "", restartRequired: false },
      webui: {
        target: "webui",
        state: "idle",
        message: "",
        error: "",
        canStart: false,
        unavailableReason: "Automatic Web UI update is unavailable from a source or development checkout.",
        restartRequired: true,
      },
    },
  };

  await page.route("**/api/pi-release-notes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { version: "0.84.0", body: "Fixture v0.84.0 release notes", url: "https://example.test/pi/v0.84.0" } }),
    });
  });
  await page.route("**/api/component-update", async (route) => {
    const body = route.request().postDataJSON();
    requests.push({ method: route.request().method(), body });
    const target = body?.target;
    status.updateInProgress = true;
    status.componentUpdates[target] = {
      ...status.componentUpdates[target],
      state: "running",
      canStart: false,
      message: `Updating ${target === "pi" ? "Pi" : "Web UI"}…`,
      error: "",
    };
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: status.componentUpdates[target] }),
    });
  });
  await page.route("**/api/update-status*", async (route) => {
    if (status.componentUpdates.pi.state === "running") {
      statusPollsAfterStart += 1;
      status.componentUpdates.pi = {
        ...status.componentUpdates.pi,
        state: "succeeded",
        canStart: true,
        message: "Pi update completed.",
      };
      status.updateInProgress = false;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: status }) });
  });

  await page.goto(baseURL);
  const piTag = page.locator("#piVersionButton");
  const webuiTag = page.locator("#webuiVersionButton");
  await expect(piTag).toHaveAttribute("data-update-state", "available", { timeout: 8_000 });
  await expect(piTag).toHaveAccessibleName(/Pi .*update available/);
  await expect(webuiTag).toHaveAttribute("data-update-state", "available");
  await expect(webuiTag).toHaveAccessibleName(/Web UI .*update available/);
  await page.locator("#updateNotificationDismissButton").click();
  await expect(page.locator("#updateNotification")).toBeHidden();

  await webuiTag.click();
  const webuiDialog = page.locator("#webuiPackageDialog");
  await expect(webuiDialog).toBeVisible();
  await expect(page.locator("#webuiPackageCurrentVersion")).toHaveText("v0.8.1");
  await expect(page.locator("#webuiPackageLatestVersion")).toHaveText("v0.8.2");
  await expect(page.locator("#webuiPackageNpmButton")).toHaveText("View on npm");
  await expect(page.locator("#webuiComponentUpdateStatus")).toContainText("source or development checkout");
  await expect(page.locator("#webuiComponentUpdateButton")).toBeDisabled();
  await page.locator("#webuiPackageCloseButton").click();

  await piTag.click();
  const piDialog = page.locator("#piReleaseNotesDialog");
  await expect(piDialog).toBeVisible();
  await expect(page.locator("#piReleaseNotesTitle")).toHaveText("Pi v0.84.0 release notes");
  await expect(page.locator("#piReleaseNotesBody")).toContainText("Fixture v0.84.0 release notes");
  await expect(page.locator("#piReleaseNotesGithubLink")).toHaveAttribute("href", "https://example.test/pi/v0.84.0");
  await expect(page.locator("#piComponentUpdateStatus")).toContainText("Pi v0.83.0 → v0.84.0 is available");
  await page.locator("#piComponentUpdateButton").click();
  await expect(page.locator("#confirmationDialog")).toBeVisible();
  await expect(page.locator("#confirmationSummary")).toContainText("Web UI server and running Pi tabs are not restarted");
  await page.locator("#confirmationConfirmButton").click();

  await expect(piTag).toHaveAttribute("data-update-state", "running");
  await expect(piTag).toHaveAccessibleName(/update running/);
  await expect(page.locator("#piComponentUpdateButton")).toBeDisabled();
  assert.deepEqual(requests, [{ method: "POST", body: { target: "pi" } }], "the dialog must submit exactly one Pi-only POST");

  await expect(piTag).toHaveAttribute("data-update-state", "succeeded", { timeout: 5_000 });
  await expect(page.locator("#piComponentUpdateStatus")).toContainText("New or reloaded Pi sessions use the update");
  await expect(page.locator("#piComponentUpdateStatus")).toContainText("already-running tabs keep their current runtime");
  assert.ok(statusPollsAfterStart >= 1, "the browser should poll while the accepted job is running");
  const pollsAtSuccess = statusPollsAfterStart;
  await page.waitForTimeout(1_300);
  assert.equal(statusPollsAfterStart, pollsAtSuccess, "short polling should stop after terminal success");
  await page.locator("#piReleaseNotesCloseButton").click();
  await expect(piDialog).toBeHidden();

  status.componentUpdates.webui = {
    ...status.componentUpdates.webui,
    state: "failed",
    canStart: true,
    message: "Web UI update failed.",
    error: "bounded fixture failure",
  };
  await webuiTag.click();
  await expect(page.locator("#webuiComponentUpdateStatus")).toContainText("bounded fixture failure");
  await expect(page.locator("#webuiComponentUpdateStatus")).toContainText("retry the update");
  await expect(page.locator("#webuiComponentUpdateButton")).toBeEnabled();
  await expect(page.locator("#webuiComponentUpdateButton")).toHaveText("Retry Web UI update");
});
