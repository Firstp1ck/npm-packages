import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "tests", "fixtures", "fake-pi-rpc.mjs");
const launcherUrl = pathToFileURL(path.join(root, "lib", "launcher.mjs")).href;
const smokeMarkers = [
  "QT_WEBUI_SMOKE_READY",
  "QT_WEBUI_SMOKE_THEME_DARK",
  "QT_WEBUI_SMOKE_RUNTIME_INFO",
  "QT_WEBUI_SMOKE_PARSE_RECOVERED",
  "QT_WEBUI_SMOKE_STREAM_RECONCILED",
  "QT_WEBUI_SMOKE_IMMEDIATE_PROMPT_RECONCILED",
  "QT_WEBUI_SMOKE_PROVIDER_ERROR_PRESERVED",
  "QT_WEBUI_SMOKE_FAILED_RESPONSE_RECOVERED",
  "QT_WEBUI_SMOKE_AGENT_SETTLED",
  "QT_WEBUI_SMOKE_DELAYED_AGENT_ABORTED",
  "QT_WEBUI_SMOKE_DELAYED_ABORT_RECEIPT",
  "QT_WEBUI_SMOKE_DIALOG_CANCEL_RECEIPT",
  "QT_WEBUI_SMOKE_TRANSCRIPT_BOUNDED",
  "QT_WEBUI_SMOKE_FAILED_STATE_RECOVERABLE",
  "QT_WEBUI_SMOKE_FAILED_STATE_RESTART",
  "QT_WEBUI_SMOKE_MISSING_STATE_RECOVERABLE",
  "QT_WEBUI_SMOKE_MISSING_STATE_RESTART",
  "QT_WEBUI_SMOKE_RESTART_RECEIPT",
  "QT_WEBUI_SMOKE_COMPLETE",
];

function waylandUnavailableReason() {
  if (!process.env.WAYLAND_DISPLAY) return "no Wayland display: WAYLAND_DISPLAY is unset";
  if (!process.env.XDG_RUNTIME_DIR) return "no Wayland display: XDG_RUNTIME_DIR is unset";
  return null;
}

function quickshellUnavailableReason() {
  const probe = spawnSync("quickshell", ["--version"], { encoding: "utf8", timeout: 2_000 });
  if (probe.error?.code === "ENOENT") return "Quickshell is unavailable on PATH";
  if (probe.error) return `Quickshell probe failed: ${probe.error.message}`;
  if (probe.status !== 0) return `Quickshell probe exited ${probe.status}`;
  return null;
}

function runLiveSmoke({ callerCwd, capturePath, statePath }) {
  const program = `
    import { launchQtWebUi } from ${JSON.stringify(launcherUrl)};
    const code = await launchQtWebUi({
      argv: [],
      cwd: ${JSON.stringify(callerCwd)},
      env: process.env,
      nodeExecutable: process.execPath,
      resolvePiEntry: () => ${JSON.stringify(fixture)},
      detectColorScheme: () => "dark",
      testOnlyEnvironment: {
        QT_WEBUI_SMOKE_MODE: "1",
        QT_WEBUI_SMOKE_CAPTURE_PATH: ${JSON.stringify(capturePath)},
        QT_WEBUI_SMOKE_STATE_PATH: ${JSON.stringify(statePath)},
      },
    });
    process.exitCode = code;
  `;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", program], {
      cwd: root,
      detached: true,
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const terminate = () => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    };
    const timeout = setTimeout(() => {
      terminate();
      finish(() => reject(new Error(`QML smoke timed out after 15000ms\nstdout:\n${stdout}\nstderr:\n${stderr}`)));
    }, 15_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code, signal) => {
      finish(() => resolve({ code, signal, stdout, stderr }));
    });
  });
}

test("real Quickshell completes the deterministic Pi RPC behavior scenarios", { timeout: 20_000 }, async (t) => {
  const skipReason = waylandUnavailableReason() ?? quickshellUnavailableReason();
  if (skipReason) return t.skip(skipReason);

  const runtimeDir = path.join(process.env.XDG_RUNTIME_DIR, process.env.WAYLAND_DISPLAY);
  try {
    await access(runtimeDir);
  } catch {
    return t.skip(`no Wayland display socket at ${runtimeDir}`);
  }

  const temporary = await mkdtemp(path.join(os.tmpdir(), "qt-webui-qml-smoke-"));
  const capturePath = path.join(temporary, "commands.jsonl");
  const statePath = path.join(temporary, "state.txt");
  const callerCwd = path.join(temporary, "<b>project</b>");
  await mkdir(callerCwd, { recursive: true });
  await writeFile(capturePath, "");
  t.after(() => rm(temporary, { recursive: true, force: true }));

  const result = await runLiveSmoke({ callerCwd, capturePath, statePath });
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.signal, null, combined);
  assert.equal(result.code, 0, combined);
  for (const marker of smokeMarkers) assert.match(combined, new RegExp(marker), `missing ${marker}\n${combined}`);
  t.diagnostic(`observed smoke markers: ${smokeMarkers.join(", ")}`);
  assert.doesNotMatch(combined, /QQmlApplicationEngine failed|TypeError:|ReferenceError:|is not a type|Cannot assign|Stack trace/i);
  assert.doesNotMatch(combined, /Failed to register with host portal|Cannot create delegate|Required property (?:messageRole|messageText) was not initialized/i);

  const commands = (await readFile(capturePath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const prompts = commands.filter((command) => command.type === "prompt");
  assert.deepEqual(prompts.map((command) => command.message), [
    "__QT_WEBUI_STREAM__",
    "__QT_WEBUI_IMMEDIATE__",
    "__QT_WEBUI_PROVIDER_ERROR__",
    "__QT_WEBUI_FAIL__",
    "__QT_WEBUI_DELAYED_ABORT__",
    "__QT_WEBUI_LIMITS__",
    "__QT_WEBUI_EXIT__",
  ]);
  assert.equal(commands.filter((command) => command.type === "get_state").length, 6,
    "only startup, prompt reconciliation, response recovery, and restart scenarios should request state");
  assert.equal(commands.filter((command) => command.type === "abort").length, 2,
    "one abort should be sent before delayed agent_start and exactly one after it");

  const dialogResponses = commands.filter((command) => command.type === "extension_ui_response");
  assert.deepEqual(dialogResponses.map((command) => command.id).sort(), [
    "dialog-confirm", "dialog-editor", "dialog-input", "dialog-select",
  ]);
  assert(dialogResponses.every((command) => command.cancelled === true));
  assert(dialogResponses.every((command) => command.confirmed !== true));
});
