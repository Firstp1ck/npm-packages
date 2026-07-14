import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeWorkbookFixture } from "../fixture-builder.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const extensionPath = path.join(root, "index.ts");
const providerPath = path.join(root, "tests/pi/mock-provider.ts");
const reportPath = path.join(root, "tests/corpus/LAST-PI-MODES.json");
const piCommand = process.execPath;
const piCliPath = process.env.PI_CLI_PATH ?? path.join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");

function baseArgs() {
  return [
    "--offline",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--approve",
    "--extension", extensionPath,
    "--extension", providerPath,
    "--provider", "workbook-test",
    "--model", "workbook-test/mock",
    "--no-builtin-tools",
    "--tools", "workbook_inspect",
  ];
}

function environment(workbookPath) {
  return { ...process.env, PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_WORKBOOK_TEST_PATH: workbookPath, NO_COLOR: "1" };
}

async function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, env: options.env, shell: options.shell ?? false, windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  child.stdin.end();
  const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 30000);
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 128 : -1)));
  }).finally(() => clearTimeout(timer));
  return { exitCode, stdout, stderr };
}

async function runTui(workbookPath) {
  const env = { ...environment(workbookPath), PI_CLI_PATH: piCliPath, PI_WORKBOOK_ROOT: root };
  const result = await run("bash", [path.join(root, "tests/pi/tui-harness.sh")], { env, timeoutMs: 40000 });
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /tui_status=PASS/);
  assert.doesNotMatch(result.stderr, /extension_error|isError[^\n]*true|Unhandled|FATAL/i);
  return { status: "PASS", exitCode: result.exitCode, toolObserved: true, sentinelObserved: true };
}

async function runPrint(workbookPath) {
  const result = await run(piCommand, [piCliPath, ...baseArgs(), "--print", "Inspect the workbook with workbook_inspect."], { env: environment(workbookPath), timeoutMs: 30000 });
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /WORKBOOK_MODE_PASS/);
  assert.doesNotMatch(result.stderr, /error/i);
  return { status: "PASS", exitCode: result.exitCode, sentinelObserved: true };
}

async function runJson(workbookPath) {
  const result = await run(piCommand, [piCliPath, ...baseArgs(), "--mode", "json", "--print", "Inspect the workbook with workbook_inspect."], { env: environment(workbookPath), timeoutMs: 30000 });
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const records = result.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(records.some((record) => record.type === "tool_execution_end" && record.toolName === "workbook_inspect" && record.isError === false));
  assert.ok(records.some((record) => JSON.stringify(record).includes("WORKBOOK_MODE_PASS")));
  return { status: "PASS", exitCode: result.exitCode, records: records.length, toolObserved: true, sentinelObserved: true };
}

async function runRpc(workbookPath) {
  const child = spawn(piCommand, [piCliPath, ...baseArgs(), "--mode", "rpc"], { cwd: root, env: environment(workbookPath), windowsHide: true });
  const records = [];
  let buffer = "";
  let stderr = "";
  const waiters = new Set();
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (true) {
      const index = buffer.indexOf("\n");
      if (index < 0) break;
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      records.push(JSON.parse(line));
      for (const waiter of [...waiters]) waiter();
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const send = (payload) => child.stdin.write(`${JSON.stringify(payload)}\n`);
  const waitFor = (predicate, timeoutMs = 15000) => new Promise((resolve, reject) => {
    const inspect = () => {
      const match = records.find(predicate);
      if (match) { clearTimeout(timer); waiters.delete(inspect); resolve(match); }
    };
    const timer = setTimeout(() => { waiters.delete(inspect); reject(new Error(`RPC timeout. stderr=${stderr} records=${JSON.stringify(records.slice(-5))}`)); }, timeoutMs);
    waiters.add(inspect);
    inspect();
  });
  try {
    send({ type: "get_commands" });
    const commands = await waitFor((record) => record.type === "response" && record.command === "get_commands");
    assert.equal(commands.success, true);
    assert.ok(commands.data.commands.some((command) => command.name === "workbook-doctor" && command.source === "extension"));

    send({ type: "prompt", message: "/workbook-doctor" });
    await waitFor((record) => record.type === "extension_ui_request" && record.method === "notify");
    assert.ok(records.some((record) => record.type === "extension_ui_request" && /workbook-doctor: PASS/.test(record.message ?? "")));

    send({ type: "prompt", message: "Inspect the workbook with workbook_inspect." });
    await waitFor((record) => record.type === "agent_settled", 30000);
    assert.ok(records.some((record) => record.type === "tool_execution_end" && record.toolName === "workbook_inspect" && record.isError === false));
    assert.ok(records.some((record) => JSON.stringify(record).includes("WORKBOOK_MODE_PASS")));
    assert.equal(records.some((record) => record.type === "extension_error"), false);
    return { status: "PASS", commands: commands.data.commands.length, records: records.length, doctorObserved: true, toolObserved: true, sentinelObserved: true };
  } finally {
    child.stdin.end();
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 2000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pi-workbook-modes-"));
try {
  const workbookPath = await writeWorkbookFixture(path.join(temporary, "mode-fixture.xlsx"));
  const startedAt = new Date().toISOString();
  const [print, json] = await Promise.all([runPrint(workbookPath), runJson(workbookPath)]);
  const rpc = await runRpc(workbookPath);
  const tui = await runTui(workbookPath);
  const report = {
    status: "PASS",
    startedAt,
    completedAt: new Date().toISOString(),
    policy: { externalModelNetworkUsed: false, mockProvider: true, tuiOnlyDialogsRequired: false },
    modes: { tui, print, json, rpc },
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, modes: Object.fromEntries(Object.entries(report.modes).map(([name, value]) => [name, value.status])), reportPath }, null, 2));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
