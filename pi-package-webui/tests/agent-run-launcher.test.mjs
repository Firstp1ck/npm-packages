import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { managedRuntimePaths, writeRuntimePointer } from "../lib/update/supervisor.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const launcher = path.join(root, "bin", "pi-webui-launcher.mjs");
const temp = await mkdtemp(path.join(tmpdir(), "pi-webui-agent-launcher-"));
try {
  const agentHelp = await execFileAsync(process.execPath, [launcher, "agent", "help"], {
    env: { ...process.env, PI_CODING_AGENT_DIR: path.join(temp, "agent-help") },
  });
  assert.match(agentHelp.stdout, /pi-webui agent run/);
  assert.doesNotMatch(agentHelp.stdout, /Pi Web UI:/, "agent routing must not start the HTTP server");

  const agentDir = path.join(temp, "agent-plain");
  const runtimePaths = managedRuntimePaths(agentDir);
  const runtimeRoot = path.join(runtimePaths.runtimesDir, "test-runtime");
  const serverEntry = path.join(runtimeRoot, "bin", "pi-webui.mjs");
  const evidenceFile = path.join(temp, "plain-args.json");
  await mkdir(path.dirname(serverEntry), { recursive: true });
  await writeFile(serverEntry, [
    "import { writeFileSync } from 'node:fs';",
    `writeFileSync(${JSON.stringify(evidenceFile)}, JSON.stringify(process.argv.slice(2)));`,
    "",
  ].join("\n"));
  await writeRuntimePointer(agentDir, "current", { runtimeRoot, serverEntry, version: "test" });
  await execFileAsync(process.execPath, [launcher, "--host", "127.0.0.1", "--port", "39999"], {
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
  });
  assert.deepEqual(JSON.parse(await readFile(evidenceFile, "utf8")), ["--host", "127.0.0.1", "--port", "39999"], "plain pi-webui must still use the update pointer and forward argv unchanged");

  console.log("agent-run-launcher.test.mjs passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
