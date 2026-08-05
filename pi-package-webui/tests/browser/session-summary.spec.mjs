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
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-session-summary-"));
  baseURL = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [serverScript, "--cwd", tempRoot, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PI_WEBUI_RPC_SUPERVISOR: "0",
      PI_CODING_AGENT_DIR: join(tempRoot, "agent"),
      PI_WEBUI_SETTINGS_FILE: join(tempRoot, "settings.json"),
      PI_SESSION_SUMMARY_CONFIG_FILE: join(tempRoot, "session-summary.json"),
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
      // Wait for the isolated real server and fake RPC fixture.
    }
    await delay(100);
  }
  throw new Error(`Pi Web UI did not start:\n${output}`);
});

test.afterAll(async () => {
  if (child?.exitCode === null) child.kill("SIGTERM");
  if (child && child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
  await rm(tempRoot, { recursive: true, force: true });
});

function preferencesData({ configured = false, summary = null } = {}) {
  return {
    version: 1,
    preferences: {
      version: 1,
      configured,
      enabled: false,
      model: { provider: "fake", modelId: "fake-model", thinkingLevel: "off" },
      prompts: { title: "Create a bounded title", summary: "Create a bounded Markdown summary" },
      input: { scope: "text-and-tool-names" },
      context: { injectLatest: false },
      title: { enabled: true, minSettledTurns: 3 },
    },
    models: [{ provider: "fake", id: "fake-model", name: "Fake Model", reasoning: false }],
    modelThinkingLevels: { "fake/fake-model": ["off"] },
    disclosure: {
      scope: "Active-branch user text, final assistant text, and tool names only.",
      cost: "One configured-model request with no fallback.",
      persistence: "Preferences and validated output are stored locally.",
    },
    summary: summary || (configured ? { version: 1, status: "idle", configured: true, enabled: false, durable: false, updatedAt: new Date().toISOString() } : null),
  };
}

function generatedSummaryResponse() {
  return {
    status: 200,
    payload: {
      ok: true,
      data: {
        requested: true,
        summary: {
          version: 1,
          status: "success",
          configured: true,
          enabled: false,
          durable: false,
          title: "Validated fixture title",
          summaryMarkdown: "## Goal\n\nKeep **validated Markdown** visible.\n\n<script>globalThis.summaryPwned = true</script>",
          updatedAt: new Date().toISOString(),
        },
      },
    },
  };
}

async function installSummaryRoutes(page, requests, { configured = false, summary = null, generate = generatedSummaryResponse } = {}) {
  await page.route("**/api/commands?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { commands: [
        { name: "summary", source: "extension", description: "Open the latest session summary" },
        { name: "summary-setup", source: "extension", description: "Configure session summaries" },
      ] } }),
    });
  });
  await page.route("**/api/session-summary/preferences?*", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      requests.get += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: preferencesData({ configured, summary }) }) });
      return;
    }
    requests.put.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: preferencesData({ configured: true }) }) });
  });
  await page.route("**/api/session-summary/generate?*", async (route) => {
    const request = JSON.parse(route.request().postData() || "{}");
    requests.generate.push(request);
    const response = await generate(request, requests.generate.length);
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      body: JSON.stringify(response.payload),
    });
  });
}

test("first click opens confirmed setup, cancel has no side effect, and save opens a non-blocking sanitized overlay", async ({ page }) => {
  const requests = { get: 0, put: [], generate: [] };
  await installSummaryRoutes(page, requests);
  await page.goto(baseURL);

  const summaryButton = page.locator("#summaryHeaderButton");
  await expect(summaryButton).toBeVisible();
  await summaryButton.evaluate((button) => button.click());
  await expect(page.locator("#nativeCommandDialog")).toBeVisible();
  await expect(page.locator("#nativeCommandTitle")).toHaveText("/summary-setup");
  await expect(page.locator("#nativeCommandBody")).toContainText("Privacy scope");
  expect(requests.put).toHaveLength(0);
  expect(requests.generate).toHaveLength(0);

  await page.locator("#nativeCommandActions").getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#nativeCommandDialog")).not.toBeVisible();
  expect(requests.put).toHaveLength(0);
  expect(requests.generate).toHaveLength(0);

  await summaryButton.evaluate((button) => button.click());
  await expect(page.locator("#nativeCommandDialog")).toBeVisible();
  await page.locator("#nativeCommandActions").getByRole("button", { name: "Save and generate" }).click();
  await expect(page.locator("#confirmationDialog")).toBeVisible();
  await expect(page.locator("#confirmationSummary")).toContainText("Active-branch user text");
  expect(requests.put).toHaveLength(0);
  expect(requests.generate).toHaveLength(0);
  await page.locator("#confirmationConfirmButton").click();

  await expect(page.locator("#sessionSummaryOverlay")).toBeVisible();
  await expect(page.locator("#sessionSummaryOverlay")).toHaveAttribute("aria-modal", "false");
  await expect(page.locator("#sessionSummaryOverlayTitle")).toHaveText("Validated fixture title");
  await expect(page.locator("#sessionSummaryOverlayBody h2")).toHaveText("Goal");
  await expect(page.locator("#sessionSummaryOverlayBody strong")).toHaveText("validated Markdown");
  await expect(page.locator("#sessionSummaryOverlayBody script")).toHaveCount(0);
  await expect(page.locator("#sessionSummaryOverlayBody")).toContainText("<script>globalThis.summaryPwned = true</script>");
  expect(await page.evaluate(() => globalThis.summaryPwned)).toBeUndefined();
  expect(requests.put).toHaveLength(1);
  expect(requests.put[0]).toMatchObject({ confirmed: true, preferences: { input: { scope: "text-and-tool-names" } } });
  expect(requests.generate).toEqual([{ refresh: true }]);

  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.locator("#sessionSummaryOverlay").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    right: element.getBoundingClientRect().right,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  expect(dimensions.right).toBeLessThanOrEqual(391);
});

test("typed summary commands stay native, preserve failures, reset sessions, restore focus, and close on tab switch", async ({ page }) => {
  const requests = { get: 0, put: [], generate: [], prompt: [] };
  const initialSummary = {
    version: 1,
    status: "success",
    configured: true,
    enabled: false,
    durable: true,
    sessionId: "session-a",
    title: "Session A",
    summaryMarkdown: "## Previous success\n\nKeep this Markdown on refresh failure.",
    updatedAt: new Date().toISOString(),
  };
  let generationMode = "failure";
  await installSummaryRoutes(page, requests, {
    configured: true,
    summary: initialSummary,
    generate: async () => generationMode === "failure"
      ? { status: 503, payload: { ok: false, error: "Fixture provider unavailable" } }
      : {
          status: 200,
          payload: {
            ok: true,
            data: {
              requested: true,
              summary: {
                version: 1,
                status: "idle",
                configured: true,
                enabled: false,
                durable: true,
                sessionId: "session-b",
                updatedAt: new Date().toISOString(),
              },
            },
          },
        },
  });
  await page.route("**/api/prompt?*", async (route) => {
    requests.prompt.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: {} }) });
  });
  await page.goto(baseURL);
  await expect(page.locator("#summaryHeaderButton")).toBeVisible();

  const prompt = page.locator("#promptInput");
  await prompt.fill("/summary");
  await prompt.press("Enter");
  await expect(page.locator("#sessionSummaryOverlay")).toBeVisible();
  await expect(page.locator("#sessionSummaryOverlayTitle")).toHaveText("Session A");
  await expect(page.locator("#sessionSummaryOverlayBody")).toContainText("Previous success");
  await expect(prompt).toHaveValue("");
  await expect(prompt).toBeFocused();
  expect(requests.generate).toHaveLength(0);
  expect(requests.prompt).toHaveLength(0);
  expect(await page.locator(".message.user").allTextContents()).not.toContainEqual(expect.stringContaining("/summary"));

  await page.keyboard.press("Escape");
  await expect(page.locator("#sessionSummaryOverlay")).toBeHidden();
  await expect(prompt).toBeFocused();

  await prompt.fill("/summary refresh");
  await prompt.press("Enter");
  await expect.poll(() => requests.generate.length).toBe(1);
  expect(requests.generate[0]).toEqual({ refresh: true });
  await expect(page.locator("#sessionSummaryOverlayStatus")).toContainText("Fixture provider unavailable");
  await expect(page.locator("#sessionSummaryOverlayBody")).toContainText("Keep this Markdown on refresh failure");
  expect(requests.prompt).toHaveLength(0);

  generationMode = "session-reset";
  await prompt.fill("/summary refresh");
  await prompt.press("Enter");
  await expect.poll(() => requests.generate.length).toBe(2);
  await expect(page.locator("#sessionSummaryOverlayBody")).not.toContainText("Previous success");
  await expect(page.locator("#sessionSummaryOverlayBody")).toContainText("Generate a summary to populate this view.");

  await page.locator("#newTabButton").evaluate((button) => button.click());
  await page.locator("#newTabCurrentDirectoryButton").evaluate((button) => button.click());
  await expect(page.locator("#tabBar [role=\"tab\"]")).toHaveCount(2);
  await expect(page.locator("#sessionSummaryOverlay")).toBeHidden();
});
