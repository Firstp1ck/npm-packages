import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path, { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkflowLoadError } from "../src/errors.ts";
import { findWorkflowSource, loadWorkflowRegistry, loadWorkflowScriptPath } from "../src/loader.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "pi-workflows-loader-test-"));

try {
  const bundledOnly = await loadWorkflowRegistry({ cwd: temp, extensionDir: root, includeProject: true, projectTrusted: false });
  assert.ok(findWorkflowSource(bundledOnly, "deep-research-minimal"));
  assert.equal(findWorkflowSource(bundledOnly, "project-only"), undefined);

  const agentDir = path.join(temp, "agent");
  await mkdir(path.join(agentDir, "workflows"), { recursive: true });
  await writeFile(path.join(agentDir, "workflows", "user-only.js"), `
export const meta = { name: "user-only", description: "User Only" }
return { source: "user" }
`);

  const withUser = await loadWorkflowRegistry({
    cwd: temp,
    extensionDir: root,
    includeUser: true,
    agentDir,
    includeProject: true,
    projectTrusted: false,
  });
  assert.equal(findWorkflowSource(withUser, "user-only")?.sourceType, "javascript");
  assert.equal(findWorkflowSource(withUser, "user-only")?.scope, "user");

  await mkdir(path.join(temp, ".pi", "workflows"), { recursive: true });
  await writeFile(path.join(temp, ".pi", "workflows", "project-js.js"), `
export const meta = { name: "project-js", description: "Project JS" }
return { source: "project" }
`);
  await writeFile(path.join(temp, ".pi", "workflows", "project-only.json"), JSON.stringify({
    schemaVersion: 1,
    key: "project-only",
    name: "Project Only",
    phases: [
      {
        id: "phase",
        name: "Phase",
        mode: "sequential",
        tasks: [{ id: "task", name: "Task", prompt: "Do it", tools: ["read"] }],
      },
    ],
  }));

  const trusted = await loadWorkflowRegistry({ cwd: temp, extensionDir: root, includeProject: true, projectTrusted: true });
  assert.ok(findWorkflowSource(trusted, "project-only"));
  assert.equal(findWorkflowSource(trusted, "project-js")?.sourceType, "javascript");

  const projectByPath = await loadWorkflowScriptPath(".pi/workflows/project-js.js", {
    cwd: temp,
    extensionDir: root,
    includeUser: true,
    agentDir,
    includeProject: true,
    projectTrusted: true,
  });
  assert.equal(projectByPath.script.meta.name, "project-js");
  assert.equal(projectByPath.scope, "project");
  const userByPath = await loadWorkflowScriptPath(path.join(agentDir, "workflows", "user-only.js"), {
    cwd: temp,
    extensionDir: root,
    includeUser: true,
    agentDir,
    projectTrusted: false,
  });
  assert.equal(userByPath.scope, "user");
  await assert.rejects(
    () => loadWorkflowScriptPath(".pi/workflows/project-js.js", { cwd: temp, extensionDir: root, agentDir, projectTrusted: false }),
    /outside bundled, user, or trusted-project/,
  );
  await writeFile(path.join(temp, "outside.js"), `export const meta = { name: "outside", description: "Outside" }\nreturn 1`);
  await assert.rejects(
    () => loadWorkflowScriptPath("outside.js", { cwd: temp, extensionDir: root, agentDir, projectTrusted: true }),
    /outside bundled, user, or trusted-project/,
  );

  await writeFile(path.join(temp, ".pi", "workflows", "duplicate.json"), JSON.stringify({
    schemaVersion: 1,
    key: "deep-research-minimal",
    name: "Duplicate",
    phases: [
      {
        id: "phase",
        name: "Phase",
        mode: "sequential",
        tasks: [{ id: "task", name: "Task", prompt: "Do it", tools: ["read"] }],
      },
    ],
  }));

  await assert.rejects(
    () => loadWorkflowRegistry({ cwd: temp, extensionDir: root, includeProject: true, projectTrusted: true }),
    (error) => error instanceof WorkflowLoadError && error.issues.some((issue) => issue.includes("duplicate workflow key")),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("loader tests passed");
