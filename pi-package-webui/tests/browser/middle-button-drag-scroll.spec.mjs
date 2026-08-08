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
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-middle-drag-scroll-"));
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
      // Wait for the local browser fixture.
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

test("middle-button displacement automatically scrolls in both directions and releases outside", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(baseURL);
  await page.evaluate(() => {
    const surface = document.createElement("div");
    surface.dataset.middleDragFixture = "true";
    Object.assign(surface.style, {
      position: "fixed",
      inset: "100px auto auto 100px",
      zIndex: "10000",
      width: "400px",
      height: "300px",
      overflowY: "auto",
      scrollBehavior: "auto",
      background: "white",
    });
    const content = document.createElement("div");
    content.style.height = "2400px";
    content.textContent = "middle drag scroll fixture";
    surface.append(content);
    document.body.append(surface);
    surface.scrollTop = 900;
    surface.style.scrollBehavior = "smooth";
  });
  const surface = page.locator("[data-middle-drag-fixture]");
  const before = await surface.evaluate((node) => node.scrollTop);
  assert.ok(before > 0, "the browser fixture should begin at a real reader position");

  const box = await surface.boundingBox();
  assert.ok(box, "the scroll surface should have pointer geometry");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "middle" });
  await expect(page.locator("body")).toHaveClass(/middle-button-auto-scrolling/);
  await page.mouse.move(x, y + 120, { steps: 6 });
  await expect.poll(() => surface.evaluate((node) => node.scrollTop)).toBeGreaterThan(before + 80);
  const afterDown = await surface.evaluate((node) => node.scrollTop);
  await page.mouse.move(x, y - 120, { steps: 6 });
  await expect.poll(() => surface.evaluate((node) => node.scrollTop)).toBeLessThan(afterDown - 80);
  await page.mouse.move(Math.max(0, box.x - 10), y - 120);
  await page.mouse.up({ button: "middle" });

  await expect(page.locator("body")).not.toHaveClass(/middle-button-auto-scrolling/);
  await expect.poll(() => surface.evaluate((node) => node.style.scrollBehavior)).toBe("smooth");
});

test("middle-clicking an interactive control keeps native behavior and does not pan", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(baseURL);
  await page.evaluate(() => {
    const surface = document.createElement("div");
    surface.dataset.middleDragInteractiveSurface = "true";
    Object.assign(surface.style, {
      position: "fixed",
      inset: "100px auto auto 100px",
      zIndex: "10000",
      width: "400px",
      height: "300px",
      overflowY: "auto",
      background: "white",
    });
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "interactive middle-click fixture";
    button.dataset.middleDragInteractiveFixture = "true";
    const spacer = document.createElement("div");
    spacer.style.height = "2200px";
    surface.append(button, spacer);
    document.body.append(surface);
  });
  const surface = page.locator("[data-middle-drag-interactive-surface]");
  const button = page.locator("[data-middle-drag-interactive-fixture]");
  const box = await button.boundingBox();
  assert.ok(box, "the interactive fixture should have pointer geometry");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 100);
  await page.mouse.up({ button: "middle" });
  await expect(page.locator("body")).not.toHaveClass(/middle-button-auto-scrolling/);
  assert.equal(await surface.evaluate((node) => node.scrollTop), 0);
});
