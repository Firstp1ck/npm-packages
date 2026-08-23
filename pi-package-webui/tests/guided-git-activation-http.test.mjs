import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const fakePi = join(root, "tests", "fixtures", "fake-pi.mjs");
const statusKey = "git-guided-workflow:webui-start";

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function readEvents(url, { trigger, until, timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const events = [];
  try {
    const response = await fetch(url, { signal: controller.signal });
    assert.equal(response.status, 200);
    const triggerPromise = trigger ? Promise.resolve().then(trigger) : Promise.resolve();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data) continue;
        const event = JSON.parse(data);
        events.push(event);
        if (until?.(events, event)) {
          await triggerPromise;
          controller.abort();
          return events;
        }
      }
    }
    await triggerPromise;
    return events;
  } catch (error) {
    if (error?.name !== "AbortError") throw error;
    return events;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

test("Guided Git activation is delivered set-then-clear and is absent from reconnect replay", async () => {
  const port = await freePort();
  const cwd = await mkdtemp(join(tmpdir(), "pi-webui-guided-git-http-"));
  assert.equal(spawnSync("git", ["init", "--quiet"], { cwd }).status, 0);
  let output = "";
  const child = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PI_WEBUI_RPC_SUPERVISOR: "0",
      PI_CODING_AGENT_DIR: join(cwd, "agent"),
      FAKE_PI_GUIDED_GIT_ACTIVATION: "1",
      FAKE_PI_GUIDED_GIT_ACTIVATION_DELAY_MS: "150",
    },
  });
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });

  try {
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) break;
      } catch {}
      if (attempt === 99) throw new Error(`WebUI failed to start:\n${output}`);
      await delay(100);
    }
    const tabs = await (await fetch(`${base}/api/tabs`)).json();
    const tabId = tabs.data?.tabs?.[0]?.id;
    assert.ok(tabId);
    const eventsUrl = `${base}/api/events?tab=${encodeURIComponent(tabId)}`;
    const launchId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const missingLaunch = await fetch(`${base}/api/prompt?tab=${encodeURIComponent(tabId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "/git-guided-workflow", requestId: "guided-git-http-missing-launch" }),
    });
    assert.equal(missingLaunch.status, 400, "the exact command requires a validated browser launch UUID");

    const events = await readEvents(eventsUrl, {
      trigger: async () => {
        const response = await fetch(`${base}/api/prompt?tab=${encodeURIComponent(tabId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "/git-guided-workflow", requestId: "guided-git-http-12345678", guidedGitLaunchId: launchId }),
        });
        assert.equal(response.status, 200, await response.text());
        const concurrent = await fetch(`${base}/api/prompt?tab=${encodeURIComponent(tabId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "/git-guided-workflow:2", requestId: "guided-git-http-concurrent", guidedGitLaunchId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
        });
        assert.equal(concurrent.status, 409, "a second pending guided launch must be rejected, never queued");
      },
      until: (all) => all.filter((event) => event.type === "extension_ui_request" && event.method === "setStatus" && event.statusKey === statusKey).length === 2,
    });
    const activationEvents = events.filter((event) => event.type === "extension_ui_request" && event.method === "setStatus" && event.statusKey === statusKey);
    assert.equal(activationEvents.length, 2);
    const canonicalPayload = JSON.parse(activationEvents[0].statusText);
    assert.equal(canonicalPayload.action, "start");
    assert.deepEqual(Object.keys(canonicalPayload).sort(), ["action", "requestId", "type", "version"], "the extension payload stays exact v1");
    assert.equal(activationEvents[0].tabId, tabId);
    assert.equal(activationEvents[0].guidedGitLaunchId, launchId, "the server adds correlation only to the trusted envelope");
    assert.equal(activationEvents[1].statusText, undefined);
    assert.equal(activationEvents[1].guidedGitLaunchId, undefined);

    const replay = await readEvents(eventsUrl, { timeoutMs: 700 });
    assert.equal(replay.some((event) => event.replayed === true && event.statusKey === statusKey), false, "cleared activation must not survive reconnect replay");
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
    await rm(cwd, { recursive: true, force: true });
  }
});

test("Guided Git authoritative admission rejects streaming, compaction, and pending messages before queueing", async () => {
  for (const mode of ["streaming", "compacting", "pending"]) {
    const port = await freePort();
    const cwd = await mkdtemp(join(tmpdir(), `pi-webui-guided-git-${mode}-`));
    assert.equal(spawnSync("git", ["init", "--quiet"], { cwd }).status, 0);
    let output = "";
    const child = spawn(process.execPath, [serverScript, "--cwd", cwd, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PI_WEBUI_RPC_SUPERVISOR: "0",
        PI_CODING_AGENT_DIR: join(cwd, "agent"),
        FAKE_PI_GUIDED_GIT_ACTIVATION: "1",
        FAKE_PI_GUIDED_GIT_STATE: mode,
      },
    });
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    try {
      const base = `http://127.0.0.1:${port}`;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
          if (response.ok) break;
        } catch {}
        if (attempt === 99) throw new Error(`WebUI failed to start for ${mode}:\n${output}`);
        await delay(100);
      }
      const tabs = await (await fetch(`${base}/api/tabs`)).json();
      const tabId = tabs.data?.tabs?.[0]?.id;
      assert.ok(tabId);
      const prompt = await fetch(`${base}/api/prompt?tab=${encodeURIComponent(tabId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "/git-guided-workflow:2",
          requestId: `guided-git-${mode}-request`,
          guidedGitLaunchId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        }),
      });
      assert.equal(prompt.status, 409, `${mode} exact command must be refused rather than returning 202`);
      const legacy = await fetch(`${base}/api/git-workflow/launch-admission?tab=${encodeURIComponent(tabId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(legacy.status, 409, `${mode} legacy fallback admission must fail authoritatively`);
    } finally {
      if (child.exitCode === null) child.kill("SIGTERM");
      if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
      await rm(cwd, { recursive: true, force: true });
    }
  }
});
