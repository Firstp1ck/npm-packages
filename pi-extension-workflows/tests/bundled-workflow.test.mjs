import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findWorkflowSource, loadWorkflowRegistry } from "../src/loader.ts";
import { runJavaScriptWorkflow } from "../src/script-runner.ts";
import { createWorkflowStateStore } from "../src/state.ts";

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const sources = await loadWorkflowRegistry({ cwd: process.cwd(), extensionDir });
const source = findWorkflowSource(sources, "deep-research-minimal");
assert.equal(source?.sourceType, "javascript", "the first bundled workflow must use the JavaScript runtime");
assert.equal(source?.scope, "bundled");

let active = 0;
let maxActive = 0;
const calls = [];
const run = await runJavaScriptWorkflow(source, { topic: "workflow migration" }, { hasUI: false }, {
  cwd: process.cwd(),
  state: createWorkflowStateStore(),
  taskRunner: {
    async runTask(task) {
      calls.push(task);
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, task.id === "official-docs" ? 15 : 5));
      active--;
      if (task.id === "summarize") return { ok: true, output: "implementation-ready report" };
      return { ok: true, output: `finding:${task.id}` };
    },
  },
});
assert.equal(run.status, "completed");
assert.equal(run.result, "implementation-ready report");
assert.equal(maxActive, 3);
assert.deepEqual(calls.map((task) => task.id), ["official-docs", "implementation-evidence", "risk-scan", "summarize"]);
assert.ok(calls.slice(0, 3).every((task) => task.tools.join(",") === "read,grep,find,ls"));
assert.match(calls.at(-1).prompt, /finding:official-docs/);
assert.match(calls.at(-1).prompt, /finding:implementation-evidence/);
assert.match(calls.at(-1).prompt, /finding:risk-scan/);

console.log("bundled workflow tests passed");
