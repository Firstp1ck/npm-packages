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
let child;
let baseURL;
let tempRoot;

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function api(page, pathname, { method = "GET", data } = {}) {
  const response = await page.request.fetch(`${baseURL}${pathname}`, { method, data });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function startServer() {
  const port = await freePort();
  baseURL = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [serverScript, "--cwd", tempRoot, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PI_WEBUI_RPC_SUPERVISOR: "0", PI_CODING_AGENT_DIR: join(tempRoot, "agent"), PI_WEBUI_SETTINGS_FILE: join(tempRoot, "settings.json") },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch {}
    await delay(100);
  }
  throw new Error(`server did not start: ${output}`);
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(5_000).then(() => child.kill("SIGKILL"))]);
}

test.beforeAll(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "pi-webui-subagent-browser-"));
  await startServer();
});

test.afterAll(async () => {
  await stopServer();
  await rm(tempRoot, { recursive: true, force: true });
});

test("renders canonical v2 agents and opens output through the unified selection", async ({ page }) => {
  await page.goto(baseURL);
  await expect(page.locator("#tabBar [data-tab-id]").first()).toBeVisible();
  const tabs = await api(page, "/api/tabs");
  const tabId = tabs.data.tabs[0].id;
  await api(page, `/api/prompt?tab=${encodeURIComponent(tabId)}`, { method: "POST", data: { message: "fixture subagents running", requestId: `subagents-${Date.now()}` } });

  const sectionToggle = page.locator('[data-side-panel-section-toggle="subagents"]');
  if (await sectionToggle.getAttribute("aria-expanded") !== "true") await sectionToggle.click();
  await expect(page.locator(".subagent-agent-row")).toHaveCount(2);
  await expect(page.locator("#subagentCountBadge")).toHaveText("2");
  await expect(page.locator("#subagentsStatus")).toContainText("2 total");
  await expect(page.locator("#subagentsStatus")).toContainText("2 running");
  await expect(page.locator(".subagent-source-badge").first()).toHaveText("pi-subagents");
  await expect(page.locator(".subagent-state-dot.running")).toHaveCount(2);
  await expect(page.locator(".subagent-gate-card")).toHaveCount(1);

  await page.locator(".subagent-agent-row").first().click();
  await expect(page.locator(".subagent-overlay-widget")).toBeVisible();
  await expect(page.locator(".subagent-overlay-widget")).toContainText("reviewer");
  await expect(page.locator(".subagent-overlay-refresh-action")).toBeVisible();
  await expect(page.locator(".subagent-overlay-cancel-action")).toBeVisible();
});

test("renders the workflow controller as a collapsible header with nested agents", async ({ page }) => {
  await page.goto(baseURL);
  await expect(page.locator("#tabBar [data-tab-id]").first()).toBeVisible();
  const tabs = await api(page, "/api/tabs");
  const tabId = tabs.data.tabs[0].id;
  await api(page, `/api/prompt?tab=${encodeURIComponent(tabId)}`, { method: "POST", data: { message: "fixture subagents workflow", requestId: `workflow-${Date.now()}` } });

  const sectionToggle = page.locator('[data-side-panel-section-toggle="subagents"]');
  if (await sectionToggle.getAttribute("aria-expanded") !== "true") await sectionToggle.click();
  const workflow = page.locator(".subagent-workflow");
  await expect(workflow).toHaveCount(1);
  await expect(workflow).toHaveAttribute("open", "");
  await expect(workflow.locator(".subagent-workflow-header")).toContainText("Workflow");
  await expect(workflow.locator(".subagent-workflow-header")).toContainText("running");
  await expect(workflow.locator(".subagent-workflow-header")).toContainText("1 agent");
  await expect(workflow.locator(".subagent-agent-row")).toHaveCount(1);
  await expect(workflow.locator(".subagent-agent-name")).toHaveText("worker");
  await expect(page.locator(".subagent-agent-list > .subagent-run")).toHaveCount(1);
  await expect(page.locator("#subagentCountBadge")).toHaveText("1");
  await expect(page.locator("#subagentsStatus")).toContainText("1 total");
  await expect(page.locator("#subagentsStatus")).toContainText("1 running");

  await workflow.locator(".subagent-workflow-header").click();
  await expect(workflow).not.toHaveAttribute("open", "");
  await expect(workflow.locator(".subagent-agent-row")).toBeHidden();
  await page.waitForTimeout(650);
  await expect(workflow).not.toHaveAttribute("open", "");
});
