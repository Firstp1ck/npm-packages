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
const storageKey = "pi-webui-composer-action-order-v1";

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
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-composer-action-order-"));
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

async function storedOrder(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "[]"), storageKey);
}

test("composer actions persist pointer and keyboard grid reordering", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseURL);
  await expect(page.locator("body")).toHaveClass(/composer-action-grid-enabled/);

  const send = page.locator('[data-composer-action-id="send"]');
  const newSession = page.locator('[data-composer-action-id="new"]');
  await expect(send).toBeVisible();
  await expect(newSession).toBeVisible();

  const sendBox = await send.boundingBox();
  const newBox = await newSession.boundingBox();
  expect(sendBox).toBeTruthy();
  expect(newBox).toBeTruthy();
  await page.mouse.move(sendBox.x + sendBox.width / 2, sendBox.y + sendBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sendBox.x + sendBox.width / 2 - 12, sendBox.y + sendBox.height / 2, { steps: 2 });
  await page.mouse.move(newBox.x + 3, newBox.y + newBox.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => (await storedOrder(page)).slice(0, 2)).toEqual(["send", "new"]);
  await expect.poll(async () => {
    const [sendRect, newRect] = await Promise.all([send.boundingBox(), newSession.boundingBox()]);
    return sendRect.x < newRect.x;
  }).toBe(true);

  await page.reload();
  await expect.poll(async () => (await storedOrder(page)).slice(0, 2)).toEqual(["send", "new"]);
  await expect.poll(async () => {
    const [sendRect, newRect] = await Promise.all([send.boundingBox(), newSession.boundingBox()]);
    return sendRect.x < newRect.x;
  }).toBe(true);

  await newSession.focus();
  await newSession.press("Alt+ArrowLeft");
  await expect.poll(async () => (await storedOrder(page)).slice(0, 2)).toEqual(["new", "send"]);
  await expect(newSession).toBeFocused();
  await expect(page.locator("#composerActionOrderStatus")).toContainText("New moved to position 1");
});
