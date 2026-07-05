import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = join(root, "bin", "pi-webui.mjs");
const fakePi = join(root, "tests", "fixtures", "fake-pi.mjs");
const fixedPin = "4404";
const port = 30000 + Math.floor(Math.random() * 20000);
const cwd = await mkdtemp(path.join(tmpdir(), "pi-webui-remote-pin-env-"));

async function request(pathname, { method = "GET", body, timeoutMs = 5_000 } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => undefined);
  return { status: response.status, body: payload };
}

await chmod(fakePi, 0o755);

const child = spawn(
  process.execPath,
  [serverScript, "--cwd", cwd, "--host", "127.0.0.1", "--port", String(port), "--pi", fakePi, "--remote-auth"],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PI_WEBUI_REMOTE_PIN: fixedPin,
    },
  },
);
let serverOutput = "";
child.stdout.on("data", (chunk) => {
  serverOutput += String(chunk);
});
child.stderr.on("data", (chunk) => {
  serverOutput += String(chunk);
});

try {
  let health;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) break;
    try {
      health = await request("/api/health", { timeoutMs: 1_000 });
      if (health.status === 200) break;
    } catch {
      // Server not listening yet.
    }
    await delay(200);
  }
  assert.equal(health?.status, 200, `server should become healthy, output:\n${serverOutput}`);

  const auth = await request("/api/remote-auth");
  assert.equal(auth.status, 200);
  assert.equal(auth.body?.data?.auth?.enabled, true, "remote auth should be enabled");
  assert.equal(auth.body?.data?.auth?.pin, fixedPin, "PI_WEBUI_REMOTE_PIN should pin the startup PIN");

  const correct = await request("/api/remote-auth", { method: "POST", body: { pin: fixedPin } });
  assert.equal(correct.status, 200, "POST with the env-pinned PIN should succeed");

  const wrong = await request("/api/remote-auth", { method: "POST", body: { pin: "0000" } });
  assert.equal(wrong.status, 403, "POST with a wrong PIN should be rejected");

  console.log("remote-pin-env-harness.test.mjs passed");
} finally {
  child.kill("SIGTERM");
  await delay(150);
  if (child.exitCode === null) child.kill("SIGKILL");
  await rm(cwd, { recursive: true, force: true });
}
