import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256 } from "../src/persistence-schema.ts";
import { saveWorkflowSnapshot } from "../src/saved-workflows.ts";

const temp = await mkdtemp(path.join(os.tmpdir(), "workflow-save-test-"));
try {
  const source = `export const meta = { name: "saved-demo", description: "Saved demo" }\nreturn { ok: args.ok }\n`;
  const snapshotPath = path.join(temp, "snapshot.js");
  await writeFile(snapshotPath, source);
  const record = {
    schemaVersion: 1,
    kind: "run",
    runId: "run-save",
    sessionId: "session-save",
    projectId: "project-save",
    workflowName: "Saved demo",
    sourceType: "javascript",
    status: "completed",
    scriptHash: sha256(source),
    snapshotPath,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };

  const agentDir = path.join(temp, "agent");
  const userSaved = await saveWorkflowSnapshot({ record, scope: "user", cwd: temp, projectTrusted: false, agentDir });
  assert.equal(userSaved.name, "saved-demo");
  assert.equal(userSaved.changed, true);
  assert.equal(await readFile(userSaved.path, "utf8"), source);
  const unchanged = await saveWorkflowSnapshot({ record, scope: "user", cwd: temp, projectTrusted: false, agentDir });
  assert.equal(unchanged.changed, false);

  await writeFile(userSaved.path, "different");
  await assert.rejects(
    () => saveWorkflowSnapshot({ record, scope: "user", cwd: temp, projectTrusted: false, agentDir }),
    /refusing to overwrite existing workflow without confirmation/,
  );
  let confirmedPath;
  const overwritten = await saveWorkflowSnapshot({
    record,
    scope: "user",
    cwd: temp,
    projectTrusted: false,
    agentDir,
    async confirmOverwrite(filePath) { confirmedPath = filePath; return true; },
  });
  assert.equal(confirmedPath, overwritten.path);
  assert.equal(await readFile(overwritten.path, "utf8"), source);

  await assert.rejects(
    () => saveWorkflowSnapshot({ record, scope: "project", cwd: temp, projectTrusted: false, agentDir }),
    /requires a trusted project/,
  );
  const projectSaved = await saveWorkflowSnapshot({ record, scope: "project", cwd: temp, projectTrusted: true, agentDir });
  assert.match(projectSaved.path, /\.pi[/\\]workflows[/\\]saved-demo\.js$/);

  await writeFile(snapshotPath, `${source}// tampered\n`);
  await assert.rejects(
    () => saveWorkflowSnapshot({ record, scope: "user", cwd: temp, projectTrusted: false, agentDir }),
    /snapshot hash changed/,
  );

  await writeFile(snapshotPath, source);
  const symlinkDir = path.join(temp, "symlink-agent", "workflows");
  await mkdir(symlinkDir, { recursive: true });
  const outside = path.join(temp, "outside-target.js");
  await writeFile(outside, "outside");
  await symlink(outside, path.join(symlinkDir, "saved-demo.js"));
  await assert.rejects(
    () => saveWorkflowSnapshot({ record, scope: "user", cwd: temp, projectTrusted: false, agentDir: path.join(temp, "symlink-agent") }),
    /not a regular file/,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("saved workflow tests passed");
