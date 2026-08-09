import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-search-highlights-"));
  await writeFile(join(tempRoot, "search-sample.txt"), "Alpha beta alpha\nplain text\nALPHA final\n");
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

test("highlights every transcript and source-file match while retaining current-match navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseURL);
  await expect(page.locator("#chat .message")).toHaveCount(3);

  await page.keyboard.press("Control+F");
  await page.locator("#chatSearchInput").fill("fake");
  await expect(page.locator("#chatSearchCount")).toHaveText("3/3");
  const transcriptHighlightSizes = await page.evaluate(() => ({
    all: CSS.highlights.get("chat-search-match")?.size || 0,
    current: CSS.highlights.get("chat-search-current")?.size || 0,
  }));
  assert.deepEqual(transcriptHighlightSizes, { all: 3, current: 1 });

  await page.keyboard.press("Escape");
  await page.locator("#sidePanelSectionToggleFiles").click();
  await page.locator("#fileTreeSearchInput").fill("search-sample.txt");
  const fileResult = page.locator(".file-tree-search-item", { hasText: "search-sample.txt" });
  await expect(fileResult).toBeVisible();
  await fileResult.click();
  await expect(page.locator("#fileViewerPane")).toBeVisible();

  const editor = page.locator("#fileViewerEditor");
  await editor.focus();
  await page.keyboard.press("Control+F");
  await page.locator("#fileViewerSearchInput").fill("alpha");
  await expect(page.locator("#fileViewerSearchCount")).toHaveText("1/3");
  await expect(page.locator("#fileViewerSearchOverlay .file-viewer-search-match")).toHaveCount(3);
  await expect(page.locator("#fileViewerSearchOverlay .file-viewer-search-match.current")).toHaveCount(1);

  const synchronizedScroll = await editor.evaluate((node) => {
    node.scrollTop = 12;
    node.dispatchEvent(new Event("scroll"));
    return {
      editor: node.scrollTop,
      overlay: document.querySelector("#fileViewerSearchOverlay")?.scrollTop || 0,
    };
  });
  assert.equal(synchronizedScroll.overlay, synchronizedScroll.editor);
});
