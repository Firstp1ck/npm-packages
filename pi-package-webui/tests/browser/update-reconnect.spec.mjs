import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverEntry = path.join(root, "bin", "pi-webui.mjs");
const fakePi = path.join(root, "tests", "fixtures", "fake-pi.mjs");

async function freePort() {
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}
function startServer(port, temp) {
  const child = spawn(process.execPath, [serverEntry, "--cwd", temp, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PI_WEBUI_RPC_SUPERVISOR: "0", PI_CODING_AGENT_DIR: path.join(temp, "agent"), PI_WEBUI_SETTINGS_FILE: path.join(temp, "settings.json") },
  });
  child.output = "";
  child.stdout.on("data", (chunk) => { child.output += chunk; });
  child.stderr.on("data", (chunk) => { child.output += chunk; });
  return child;
}
async function waitForHealth(baseURL, child) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(child.output);
    try {
      const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return response.json();
    } catch {}
    await delay(100);
  }
  throw new Error(`server did not become healthy:\n${child.output}`);
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(8_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

test("reconnect ignores the old boot and accepts only a changed boot identity", async ({ page }) => {
  test.setTimeout(120_000);
  const port = await freePort();
  const temp = await mkdtemp(path.join(tmpdir(), "pi-webui-update-reconnect-"));
  const baseURL = `http://127.0.0.1:${port}`;
  let first, second;
  try {
    first = startServer(port, temp);
    const oldHealth = await waitForHealth(baseURL, first);
    assert.match(oldHealth.bootIdentity, /^[a-f0-9-]{36}$/i);
    await page.goto(baseURL);
    await expect(page.locator("body")).toBeVisible();

    const reconnect = page.evaluate(async ({ oldBootIdentity }) => {
      const deadline = Date.now() + 90_000;
      let sawOld = false;
      while (Date.now() < deadline) {
        try {
          const response = await fetch("/api/health", { cache: "no-store" });
          const health = await response.json();
          if (health.bootIdentity === oldBootIdentity) sawOld = true;
          if (health.ok && health.bootIdentity && health.bootIdentity !== oldBootIdentity) return { sawOld, bootIdentity: health.bootIdentity };
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("changed boot identity did not appear within the 90-second reconnect budget");
    }, { oldBootIdentity: oldHealth.bootIdentity });

    second = startServer(port, temp);
    await delay(700);
    await stop(first);
    await waitForHealth(baseURL, second);
    const result = await reconnect;
    assert.equal(result.sawOld, true, "the reconnect loop should observe and reject the still-running old server");
    assert.notEqual(result.bootIdentity, oldHealth.bootIdentity);
    await waitForHealth(baseURL, second);
  } finally {
    await stop(first);
    await stop(second);
    await rm(temp, { recursive: true, force: true });
  }
});
