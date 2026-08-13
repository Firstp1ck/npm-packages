import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-git-ignored-files-"));
  await mkdir(join(tempRoot, "ignored-output"), { recursive: true });
  await Promise.all([
    writeFile(join(tempRoot, ".gitignore"), "ignored-note.txt\nignored-output/\n", "utf8"),
    writeFile(join(tempRoot, "ordinary.txt"), "ordinary\n", "utf8"),
    writeFile(join(tempRoot, "ignored-note.txt"), "ignored but visible\n", "utf8"),
    writeFile(join(tempRoot, "ignored-output", "nested.log"), "nested ignored file\n", "utf8"),
  ]);
  const init = spawnSync("git", ["init", "--quiet"], { cwd: tempRoot, encoding: "utf8" });
  assert.equal(init.status, 0, `Git fixture initialization failed: ${init.stderr || init.stdout}`);

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
      // Poll only until the package server and fake Pi fixture are ready.
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

test("keeps Git-ignored browse and search rows visible, muted, and interactive", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseURL);
  await page.locator("#sidePanelSectionToggleFiles").click();

  const ignoredFile = page.locator('.file-tree-node.git-ignored > .file-tree-item[data-path="ignored-note.txt"]');
  const ignoredDirectory = page.locator('.file-tree-node.git-ignored > .file-tree-item[data-path="ignored-output"]');
  const ordinaryFile = page.locator('.file-tree-node:not(.git-ignored) > .file-tree-item[data-path="ordinary.txt"]');
  await expect(ignoredFile).toBeVisible();
  await expect(ignoredDirectory).toBeVisible();
  await expect(ordinaryFile).toBeVisible();
  await expect(ignoredFile).toHaveAttribute("title", /Ignored by Git/);
  await expect(ignoredFile).not.toBeDisabled();
  await expect(ignoredFile).not.toHaveAttribute("aria-disabled", "true");

  const colors = await page.evaluate(() => {
    const ignored = document.querySelector('.file-tree-item[data-path="ignored-note.txt"]');
    const ordinary = document.querySelector('.file-tree-item[data-path="ordinary.txt"]');
    return {
      ignored: getComputedStyle(ignored).color,
      ordinary: getComputedStyle(ordinary).color,
      opacity: getComputedStyle(ignored).opacity,
    };
  });
  assert.notEqual(colors.ignored, colors.ordinary, "ignored rows should use a visibly different muted color");
  assert.equal(colors.opacity, "1", "ignored rows should stay clearly legible instead of fading the whole row");

  await page.locator("#fileTreeSearchInput").fill("ignored");
  await expect(page.locator('.file-tree-search-node.git-ignored > .file-tree-search-item[data-path="ignored-note.txt"]')).toBeVisible();
  await expect(page.locator('.file-tree-search-node.git-ignored > .file-tree-search-item[data-path="ignored-output"]')).toBeVisible();
  await page.locator("#fileTreeSearchClearButton").click();

  await ignoredDirectory.click();
  const nestedFile = page.locator('.file-tree-node.git-ignored > .file-tree-item[data-path="ignored-output/nested.log"]');
  await expect(nestedFile).toBeVisible();
  await nestedFile.click();
  await expect(page.locator("#fileViewerPane")).toBeVisible();
  await expect(page.locator("#fileViewerTitle")).toHaveText("nested.log");
  await expect(page.locator("#fileViewerEditor")).toHaveValue("nested ignored file\n");
});
