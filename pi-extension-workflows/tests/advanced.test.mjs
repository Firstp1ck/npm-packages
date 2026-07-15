import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowBundle, importWorkflowBundle, validateWorkflowBundle, writeWorkflowBundle } from "../src/bundles.ts";
import { sha256 } from "../src/persistence-schema.ts";
import { WorkflowScheduleStore } from "../src/schedules.ts";
import { parseWorkflowScript } from "../src/script-parser.ts";
import { runJavaScriptWorkflow } from "../src/script-runner.ts";
import { createWorkflowRunStorage } from "../src/run-storage.ts";
import { createWorkflowStateStore } from "../src/state.ts";
import { formatWorkflowScript, importClaudeWorkflowScript } from "../src/tooling.ts";
import { renderWorkflowRun } from "../src/ui.ts";

const temp = await mkdtemp(path.join(os.tmpdir(), "workflow-advanced-test-"));
try {
  const budgetScript = parseWorkflowScript(`
export const meta = { name: "budget-test", description: "Budget", pi: { budgets: { run: { maxTokens: 5, maxCostUsd: 1, maxAgents: 2 }, phase: { maxAgents: 1 } }, retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitter: 0 } } }
return await phase("budget", () => agent("budget", { label: "budget" }))
`);
  assert.equal(budgetScript.meta.pi.budgets.run.maxTokens, 5);
  assert.equal(budgetScript.meta.pi.retry.maxAttempts, 3);
  const budgetRun = await runJavaScriptWorkflow(
    { path: "/tmp/budget-test.js", scope: "inline", sourceType: "javascript", script: budgetScript }, {}, { hasUI: false },
    { cwd: temp, state: createWorkflowStateStore(), taskRunner: { async runTask() { return { ok: true, output: "over budget", usage: { input: 4, output: 4, cost: 0.1 } }; } } },
  );
  assert.equal(budgetRun.status, "failed");
  assert.equal(budgetRun.errorKind, "budget_exhausted");
  assert.match(budgetRun.error, /token budget exceeded/);

  const phaseBudgetScript = parseWorkflowScript(`export const meta = { name: "phase-budget", description: "Phase budget", pi: { budgets: { phase: { maxTokens: 2, maxAgents: 1 } } } }\nreturn await phase("limited", () => agent("limited", { label: "limited" }))`);
  const phaseBudgetRun = await runJavaScriptWorkflow(
    { path: "/tmp/phase-budget.js", scope: "inline", sourceType: "javascript", script: phaseBudgetScript }, {}, { hasUI: false },
    { cwd: temp, state: createWorkflowStateStore(), taskRunner: { async runTask() { return { ok: true, output: "too much", usage: { input: 2, output: 2 } }; } } },
  );
  assert.equal(phaseBudgetRun.errorKind, "budget_exhausted");
  assert.match(phaseBudgetRun.error, /phase 'limited' token budget exceeded/);
  const warningWidgets = [];
  renderWorkflowRun({ hasUI: true, ui: { setStatus() {}, setWidget(_key, lines) { warningWidgets.push(lines); } } }, { ...phaseBudgetRun, warnings: ["Large workflow projected"] });
  assert.match(warningWidgets.at(-1).join("\n"), /Warning: Large workflow projected/);

  const retryScript = parseWorkflowScript(`export const meta = { name: "retry-test", description: "Retry", pi: { retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitter: 0 } } }\nreturn await agent("retry", { label: "retry" })`);
  let attempts = 0;
  const retryRun = await runJavaScriptWorkflow(
    { path: "/tmp/retry-test.js", scope: "inline", sourceType: "javascript", script: retryScript }, {}, { hasUI: false },
    { cwd: temp, state: createWorkflowStateStore(), taskRunner: { async runTask() { attempts++; return attempts < 2 ? { ok: false, output: "", error: "503 temporary overload" } : { ok: true, output: "recovered", usage: { input: 1, output: 1 } }; } } },
  );
  assert.equal(retryRun.status, "completed");
  assert.equal(retryRun.result, "recovered");
  assert.equal(attempts, 2);
  assert.match(retryRun.phases[0].tasks[0].recentEvents.map((event) => event.line).join("\n"), /retry 2\/3/);

  const raw = `export const meta = { name: "format-test", description: "Format" }  \r\nreturn 1  \r\n`;
  const formatted = formatWorkflowScript(raw, "format-test.js");
  assert.equal(formatted, `export const meta = { name: "format-test", description: "Format" }\nreturn 1\n`);
  assert.equal(importClaudeWorkflowScript(`\`\`\`js\n${formatted}\`\`\``).supported, true);
  const unsupported = importClaudeWorkflowScript(`import fs from "node:fs"; export default async function run(){}`);
  assert.equal(unsupported.supported, false);
  assert.ok(unsupported.unsupported.some((item) => /imports/.test(item)));

  const templateDir = path.join(process.cwd(), "workflows", "templates");
  for (const [file, args] of [["audit.js", { topic: "runtime" }], ["research.js", { topic: "runtime" }], ["migration.js", { target: "v2" }], ["verify-loop.js", { subject: "runtime", passes: 2 }]]) {
    const sourceText = await readFile(path.join(templateDir, file), "utf8");
    const script = parseWorkflowScript(sourceText, { sourcePath: path.join(templateDir, file) });
    const run = await runJavaScriptWorkflow(
      { path: path.join(templateDir, file), scope: "bundled", sourceType: "javascript", script }, args, { hasUI: false },
      { cwd: temp, state: createWorkflowStateStore(), taskRunner: { async runTask(task) { return { ok: true, output: `ok:${task.id}` }; } } },
    );
    assert.equal(run.status, "completed", `${file} template should execute`);
  }

  const storage = createWorkflowRunStorage({ agentDir: path.join(temp, "agent"), sessionId: "bundle-session" });
  const bundleSource = `export const meta = { name: "bundle-demo", description: "Bundle demo" }\nreturn args\n`;
  const snapshot = await storage.snapshotScript("run-bundle", bundleSource, sha256(bundleSource));
  await storage.writePolicy("run-bundle", { version: 1, permissions: { write: false, shell: false, network: false } });
  const now = new Date().toISOString();
  const record = { schemaVersion: 1, kind: "run", runId: "run-bundle", sessionId: storage.sessionId, projectId: "project-bundle", workflowName: "Bundle demo", sourceType: "javascript", status: "completed", scriptHash: sha256(bundleSource), snapshotPath: snapshot.scriptPath, input: {}, startedAt: now, updatedAt: now, finishedAt: now };
  await storage.writeRun(record);
  const bundle = await createWorkflowBundle(record, storage, [{ name: "returns args", args: { ok: true }, expected: { ok: true } }]);
  assert.equal(validateWorkflowBundle(bundle).tests.length, 1);
  const bundlePath = await writeWorkflowBundle(bundle, path.join(temp, "bundle.json"));
  const importedPath = await importWorkflowBundle({ bundlePath, scope: "user", cwd: temp, projectTrusted: false, agentDir: path.join(temp, "import-agent") });
  assert.equal(await readFile(importedPath, "utf8"), bundleSource);
  await writeFile(importedPath, "conflicting source\n");
  await assert.rejects(() => importWorkflowBundle({ bundlePath, scope: "user", cwd: temp, projectTrusted: false, agentDir: path.join(temp, "import-agent") }), /conflict was not approved/);
  let reviewedConflict = "";
  await importWorkflowBundle({ bundlePath, scope: "user", cwd: temp, projectTrusted: false, agentDir: path.join(temp, "import-agent"), async confirmConflict(filePath) { reviewedConflict = filePath; return true; } });
  assert.equal(reviewedConflict, importedPath);
  assert.equal(await readFile(importedPath, "utf8"), bundleSource);
  await assert.rejects(() => importWorkflowBundle({ bundlePath, scope: "project", cwd: temp, projectTrusted: false }), /trusted project/);
  const tampered = { ...bundle, source: `${bundle.source}// tampered` };
  assert.throws(() => validateWorkflowBundle(tampered), /source hash/);

  const schedules = new WorkflowScheduleStore(path.join(temp, "schedule-agent"));
  await schedules.load();
  await schedules.upsert({ schemaVersion: 1, scheduleId: "daily-audit", workflowName: "template-audit", args: { topic: "runtime" }, nextRunAt: new Date(Date.now() - 1000).toISOString(), intervalMs: 60_000, enabled: true });
  assert.equal(schedules.due().length, 1);
  await schedules.markLaunched("daily-audit", new Date());
  assert.equal(schedules.due().length, 0);
  const reloadedSchedules = new WorkflowScheduleStore(path.join(temp, "schedule-agent"));
  assert.equal((await reloadedSchedules.load())[0].workflowName, "template-audit");
  assert.equal(await reloadedSchedules.remove("daily-audit"), true);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("advanced workflow tests passed");
