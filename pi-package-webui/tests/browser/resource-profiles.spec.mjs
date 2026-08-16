import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
let settingsFile;
let output = "";

async function installResourceCommands(page) {
  await page.route("**/api/commands?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          commands: [
            { name: "tools", source: "extension", description: "Configure tools" },
            { name: "skills", source: "extension", description: "Configure skills" },
          ],
        },
      }),
    });
  });
}

async function openFeatureSetup(page) {
  await page.locator("#optionsMenuButton").click();
  await expect(page.locator("#optionsMenu")).toBeVisible();
  await page.locator('[data-options-submenu="feature-setup"]').hover();
  await expect(page.locator("#optionsFeatureSetupSubmenu")).toBeVisible();
}

test.beforeAll(async () => {
  const port = await freePort();
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-resource-profiles-browser-"));
  settingsFile = join(tempRoot, "settings.json");
  baseURL = `http://127.0.0.1:${port}`;
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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // Wait for the isolated real server and fake Pi fixture.
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

test("Feature Setup opens exact-model tools and persists then clears the profile", async ({ page }) => {
  await installResourceCommands(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(baseURL);

  await openFeatureSetup(page);
  await expect(page.locator("#optionsToolsSetupButton")).toBeVisible();
  await expect(page.locator("#optionsSkillsSetupButton")).toBeVisible();
  await page.locator("#optionsToolsSetupButton").click();

  await expect(page.locator("#nativeCommandDialog")).toBeVisible();
  await expect(page.locator("#nativeCommandTitle")).toHaveText("Tools Setup");
  const scope = page.locator(".native-resource-scope select");
  await expect(scope).toHaveValue("session");
  await expect(scope.locator("option")).toHaveText(["Session only", "Global default", "Model default"]);
  await scope.selectOption("model");

  const model = page.locator(".native-resource-model select");
  await expect(model).toBeVisible();
  await expect(model.locator("option").first()).toContainText("fake/fake-model");
  await expect(page.locator(".native-resource-model")).toContainText("active session model is not changed");

  const bashItem = page.locator(".native-selector-item").filter({ hasText: "bash" });
  await expect(bashItem).toContainText("enabled");
  await bashItem.click();
  await expect(page.locator(".native-selector-item").filter({ hasText: "bash" })).toContainText("disabled");

  await expect.poll(async () => {
    try {
      const settings = JSON.parse(await readFile(settingsFile, "utf8"));
      return settings.resourceDefaults?.modelProfiles?.[0]?.tools?.enabledTools || null;
    } catch {
      return null;
    }
  }).toEqual(["read"]);

  await page.locator("#nativeCommandActions").getByRole("button", { name: "Use inherited defaults" }).click();
  await expect.poll(async () => {
    const settings = JSON.parse(await readFile(settingsFile, "utf8"));
    return settings.resourceDefaults?.modelProfiles || [];
  }).toEqual([]);
  await page.locator("#nativeCommandActions").getByRole("button", { name: "Cancel" }).click();
});

test("mobile keyboard navigation drills into Feature Setup and opens Skills Setup", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await installResourceCommands(page);
  await page.goto(`${baseURL}/?mobileShell=legacy`);
  await page.addStyleTag({ content: "#optionalFeatureMigrationSurface, #updateNotification { display: none !important; }" });

  await page.locator("#composerActionsButton").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#composerActionsPanel")).toBeVisible();
  await page.locator("#optionsMenuButton").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#optionsMenu")).toBeVisible();
  await page.locator("#optionsFeatureSetupSubmenuButton").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#optionsFeatureSetupSubmenu")).toBeVisible();
  await expect(page.locator("#optionsToolsSetupButton")).toBeVisible();
  await expect(page.locator("#optionsSkillsSetupButton")).toBeVisible();

  await page.locator("#optionsSkillsSetupButton").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#nativeCommandDialog")).toBeVisible();
  await expect(page.locator("#nativeCommandTitle")).toHaveText("Skills Setup");
  const skillScope = page.locator(".native-resource-scope select");
  await expect(skillScope).toHaveValue("session");
  const box = await page.locator("#nativeCommandDialog").boundingBox();
  assert.ok(box && box.width <= 390 && box.height <= 844, `Skills Setup must fit the mobile viewport, got ${JSON.stringify(box)}`);

  await skillScope.selectOption("model");
  await expect(page.locator(".native-resource-model select")).toBeVisible();
  const codeSecurity = page.locator(".native-selector-item").filter({ hasText: "code-security" });
  await expect(codeSecurity).toHaveAttribute("aria-pressed", "true");
  await codeSecurity.click();
  await expect(page.locator(".native-selector-item").filter({ hasText: "code-security" })).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => {
    const settings = JSON.parse(await readFile(settingsFile, "utf8"));
    return settings.resourceDefaults?.modelProfiles?.[0]?.skills?.enabledSkills || null;
  }).toEqual(["repo-explorer"]);

  await page.locator("#nativeCommandActions").getByRole("button", { name: "Use inherited defaults" }).click();
  await expect.poll(async () => {
    const settings = JSON.parse(await readFile(settingsFile, "utf8"));
    return settings.resourceDefaults?.modelProfiles || [];
  }).toEqual([]);

  await context.close();
});
