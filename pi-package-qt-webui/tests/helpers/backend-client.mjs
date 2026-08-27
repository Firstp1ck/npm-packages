import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJsonlReader } from "../../lib/backend/jsonl.mjs";
import { signalProcessTree } from "../../lib/backend/process-tree.mjs";
import { PROTOCOL_VERSION } from "../../lib/backend/protocol.mjs";

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const backendEntry = path.join(packageRoot, "lib", "backend", "main.mjs");
export const fakePiEntry = path.join(packageRoot, "tests", "fixtures", "fake-pi-rpc.mjs");

// Spawns the real backend with the fake Pi fixture and exposes request/event helpers.
export async function startBackend({ env = {}, cwd, smoke = true, startupTimeoutMs } = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "qt-webui-backend-"));
  const capturePath = path.join(temporary, "commands.jsonl");
  const statePath = path.join(temporary, "state.txt");
  await writeFile(capturePath, "");
  const childEnv = {
    ...process.env,
    ...env,
    XDG_CONFIG_HOME: env.XDG_CONFIG_HOME ?? path.join(temporary, "config"),
    XDG_STATE_HOME: env.XDG_STATE_HOME ?? path.join(temporary, "state"),
    QT_WEBUI_PI_CLI_ENTRY: fakePiEntry,
    QT_WEBUI_NODE_EXECUTABLE: process.execPath,
    QT_WEBUI_CALLER_CWD: cwd ?? temporary,
    ...(smoke ? { QT_WEBUI_SMOKE_MODE: "1", QT_WEBUI_SMOKE_CAPTURE_PATH: capturePath, QT_WEBUI_SMOKE_STATE_PATH: statePath } : {}),
    ...(startupTimeoutMs ? { QT_WEBUI_PI_STARTUP_TIMEOUT_MS: String(startupTimeoutMs) } : {}),
    // A backend test must never connect helpers to the developer's live session bus.
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(temporary, "isolated-session-bus")}`,
  };
  if (!smoke) {
    delete childEnv.QT_WEBUI_SMOKE_MODE;
    delete childEnv.QT_WEBUI_SMOKE_CAPTURE_PATH;
    delete childEnv.QT_WEBUI_SMOKE_STATE_PATH;
  }
  // Test backends are detached process-group leaders so teardown can sweep every descendant.
  // On Linux, also have the kernel kill the backend if the test worker itself disappears before
  // its after-hook runs; the backend applies the same protection to its portal monitor.
  const backendCommand = process.platform === "linux" ? "setpriv" : process.execPath;
  const backendArgs = process.platform === "linux"
    ? ["--pdeathsig", "SIGKILL", "--", process.execPath, backendEntry]
    : [backendEntry];
  const child = spawn(backendCommand, backendArgs, {
    cwd: cwd ?? temporary,
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  const events = [];
  const responses = new Map();
  const waiters = [];
  let serial = 0;
  let stderr = "";
  let exit = null;
  const exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      exit = { code, signal };
      resolve(exit);
      for (const waiter of waiters.splice(0)) waiter.reject(new Error(`backend exited (${code ?? signal}) before ${waiter.description}`));
      for (const [id, pending] of responses) {
        responses.delete(id);
        pending.reject(new Error(`backend exited (${code ?? signal}) before responding to ${id}`));
      }
    });
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const reader = createJsonlReader({
    maxFrameBytes: 8 * 1024 * 1024,
    onRecord: (record) => {
      if (record.kind === "response") {
        const waiter = responses.get(record.id);
        responses.delete(record.id);
        if (waiter) {
          waiter.resolve(record);
          return;
        }
        // Unmatched responses stay observable so tests can assert on stale or duplicate answers.
      }
      events.push(record);
      for (const waiter of waiters.slice()) {
        if (waiter.predicate(record)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(record);
        }
      }
    },
    onInvalid: (error, line) => events.push({ kind: "invalid", error: error.message, line }),
  });
  let paused = false;
  child.stdout.on("data", (chunk) => reader.write(chunk));

  function send(type, fields = {}, { id } = {}) {
    serial += 1;
    const requestId = id ?? `t-${serial}`;
    return new Promise((resolve, reject) => {
      responses.set(requestId, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ v: PROTOCOL_VERSION, id: requestId, type, ...fields })}\n`);
    });
  }

  function raw(text) {
    child.stdin.write(text);
  }

  function waitFor(predicate, description = "event", timeoutMs = 10_000) {
    const existing = events.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, description, resolve, reject };
      const timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(new Error(`timed out waiting for ${description}\nevents: ${JSON.stringify(events.slice(-20), null, 1)}\nstderr: ${stderr}`));
      }, timeoutMs);
      waiter.resolve = (record) => { clearTimeout(timer); resolve(record); };
      waiter.reject = (error) => { clearTimeout(timer); reject(error); };
      waiters.push(waiter);
    });
  }

  function waitForEvent(type, extra = () => true, timeoutMs) {
    return waitFor((record) => record.type === type && extra(record), `${type} event`, timeoutMs);
  }

  async function readCapture() {
    const { readFile } = await import("node:fs/promises");
    return (await readFile(capturePath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  }

  return {
    child,
    events,
    send,
    raw,
    waitFor,
    waitForEvent,
    readCapture,
    temporary,
    capturePath,
    statePath,
    get stderr() { return stderr; },
    get exit() { return exit; },
    exitPromise,
    pause() { paused = true; child.stdout.pause(); },
    resume() { paused = false; child.stdout.resume(); },
    get paused() { return paused; },
    closeStdin() { child.stdin.end(); },
    kill(signal = "SIGTERM") { return signalProcessTree(child, signal); },
  };
}

export function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export function waitUntil(check, { timeoutMs = 5_000, intervalMs = 25, description = "condition" } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error(`timed out waiting for ${description}`));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}
