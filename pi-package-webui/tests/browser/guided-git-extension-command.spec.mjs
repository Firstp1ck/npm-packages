import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

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

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Pi Web UI did not start:\n${output}`);
}

test.beforeAll(async () => {
  const port = await freePort();
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-guided-git-extension-"));
  assert.equal(spawnSync("git", ["init", "--quiet"], { cwd: tempRoot }).status, 0);
  await writeFile(join(tempRoot, "fixture.txt"), "guided git extension fixture\n", "utf8");
  const settingsFile = join(tempRoot, "settings.json");
  await writeFile(settingsFile, `${JSON.stringify({
    version: 8,
    gitWorkflow: {
      reviewProcessEnabled: false,
      stagingPolicy: "all",
      generation: {
        provider: "fake",
        modelId: "fake-model",
        thinkingLevel: "off",
        unavailablePolicy: "ask",
        fallback: { provider: "", modelId: "", thinkingLevel: "off" },
      },
    },
  }, null, 2)}\n`, "utf8");
  baseURL = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [serverScript, "--cwd", tempRoot, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PI_WEBUI_RPC_SUPERVISOR: "0",
      PI_CODING_AGENT_DIR: join(tempRoot, "agent"),
      PI_WEBUI_SETTINGS_FILE: settingsFile,
      FAKE_PI_GUIDED_GIT_ACTIVATION: "1",
      FAKE_PI_GUIDED_GIT_ACTIVATION_DELAY_MS: "150",
    },
  });
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  await waitForServer();
});

test.afterAll(async () => {
  if (child?.exitCode === null) child.kill("SIGTERM");
  if (child?.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
  await rm(tempRoot, { recursive: true, force: true });
});

test("typing /git-guided-workflow opens the originating tab workflow exactly once", async ({ page }) => {
  let preferenceLoads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/git-workflow/preferences") preferenceLoads += 1;
  });
  await page.goto(baseURL);
  const button = page.locator("#gitWorkflowButton");
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();

  const prompt = page.locator("#promptInput");
  await prompt.fill("/git-guided-workflow");
  await prompt.press("Enter");

  await expect(page.locator("#gitWorkflowPanel")).toBeVisible();
  await expect(page.locator("#gitWorkflowKicker")).toHaveText("Git workflow");
  await expect(prompt).toHaveValue("");
  await delay(200);
  assert.equal(preferenceLoads, 1, "one typed extension command must start one browser workflow");
});

test("one browser command starts Guided Git only in its originating client", async ({ browser }) => {
  const context = await browser.newContext();
  const origin = await context.newPage();
  const observer = await context.newPage();
  let originPreferenceLoads = 0;
  let observerPreferenceLoads = 0;
  origin.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/git-workflow/preferences") originPreferenceLoads += 1;
  });
  observer.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/git-workflow/preferences") observerPreferenceLoads += 1;
  });
  await origin.goto(baseURL);
  await observer.goto(baseURL);
  await expect(origin.locator("#gitWorkflowButton")).toBeEnabled();
  await expect(observer.locator("#gitWorkflowButton")).toBeEnabled();

  await origin.locator("#promptInput").fill("/git-guided-workflow");
  await origin.locator("#promptInput").press("Enter");

  await expect(origin.locator("#gitWorkflowPanel")).toBeVisible();
  await delay(250);
  await expect(observer.locator("#gitWorkflowPanel")).toBeHidden();
  assert.equal(originPreferenceLoads, 1, "the initiating browser owns the activation");
  assert.equal(observerPreferenceLoads, 0, "another browser attached to the same Pi tab must ignore the broadcast");
  await context.close();
});

test("two initiating clients cannot cross-claim one pending Guided Git activation", async ({ browser }) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  let preferenceLoads = 0;
  for (const page of [first, second]) {
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/git-workflow/preferences") preferenceLoads += 1;
    });
    await page.goto(baseURL);
    await expect(page.locator("#gitWorkflowButton")).toBeEnabled();
    await page.locator("#promptInput").fill("/git-guided-workflow");
  }

  await Promise.all([
    first.locator("#promptInput").press("Enter"),
    second.locator("#promptInput").press("Enter"),
  ]);
  await expect.poll(async () => Number(await first.locator("#gitWorkflowPanel").isVisible()) + Number(await second.locator("#gitWorkflowPanel").isVisible())).toBe(1);
  await delay(250);
  assert.equal(preferenceLoads, 1, "server arbitration and envelope correlation must produce one aggregate start");
  await context.close();
});

test("Guided Git button dispatch preserves the existing composer draft and attachment", async ({ page }) => {
  const promptMessages = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname !== "/api/prompt" || request.method() !== "POST") return;
    const data = request.postDataJSON();
    promptMessages.push(data?.message);
  });
  await page.goto(baseURL);
  const prompt = page.locator("#promptInput");
  await prompt.fill("keep this draft");
  await page.locator("#attachmentInput").setInputFiles({
    name: "keep.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("keep this attachment\n"),
  });
  await expect(page.locator(".attachment-pill-name")).toHaveText("keep.txt");

  await page.locator("#gitWorkflowButton").click();
  await expect(page.locator("#gitWorkflowPanel")).toBeVisible();
  await expect(prompt).toHaveValue("keep this draft");
  await expect(page.locator(".attachment-pill-name")).toHaveText("keep.txt");
  assert.equal(promptMessages.filter((message) => /^\/git-guided-workflow(?::\d+)?$/u.test(String(message || ""))).length, 1);
});
