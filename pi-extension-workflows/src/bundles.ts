import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAgentDir } from "@firstpick/pi-utils/paths";
import { WorkflowValidationError } from "./errors.ts";
import { canonicalJson, sha256, type WorkflowRunRecordV1 } from "./persistence-schema.ts";
import type { WorkflowRunStorage } from "./run-storage.ts";
import { parseWorkflowScript } from "./script-parser.ts";

export type WorkflowBundleV1 = {
  schemaVersion: 1;
  kind: "pi-workflow-bundle";
  name: string;
  description: string;
  source: string;
  sourceHash: string;
  policy: unknown;
  tests: Array<{ name: string; args: unknown; expected?: unknown }>;
};

export function validateWorkflowBundle(value: unknown): WorkflowBundleV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkflowValidationError(["workflow bundle must be an object."]);
  const bundle = value as Partial<WorkflowBundleV1>;
  const issues: string[] = [];
  if (bundle.schemaVersion !== 1 || bundle.kind !== "pi-workflow-bundle") issues.push("workflow bundle schema/kind is unsupported.");
  if (typeof bundle.source !== "string") issues.push("workflow bundle source must be a string.");
  if (typeof bundle.sourceHash !== "string" || (typeof bundle.source === "string" && sha256(bundle.source) !== bundle.sourceHash)) issues.push("workflow bundle source hash does not match exact bytes.");
  if (!Array.isArray(bundle.tests)) issues.push("workflow bundle tests must be an array.");
  if (issues.length) throw new WorkflowValidationError(issues);
  const parsed = parseWorkflowScript(bundle.source as string, { sourcePath: `${bundle.name}.js`, enforceFilename: true });
  if (parsed.meta.name !== bundle.name || parsed.meta.description !== bundle.description) throw new WorkflowValidationError(["workflow bundle metadata does not match source metadata."]);
  return value as WorkflowBundleV1;
}

export async function createWorkflowBundle(record: WorkflowRunRecordV1, storage: WorkflowRunStorage, tests: WorkflowBundleV1["tests"] = []): Promise<WorkflowBundleV1> {
  if (record.sourceType !== "javascript" || !record.snapshotPath) throw new WorkflowValidationError(["only JavaScript runs with snapshots can be exported."]);
  const source = await readFile(record.snapshotPath, "utf8");
  const script = parseWorkflowScript(source, { sourcePath: record.snapshotPath });
  return validateWorkflowBundle({ schemaVersion: 1, kind: "pi-workflow-bundle", name: script.meta.name, description: script.meta.description, source, sourceHash: sha256(source), policy: await storage.readPolicy(record.runId), tests });
}

export async function writeWorkflowBundle(bundle: WorkflowBundleV1, filePath: string, confirmOverwrite?: (path: string) => Promise<boolean>): Promise<string> {
  validateWorkflowBundle(bundle);
  const target = path.resolve(filePath);
  await mkdir(path.dirname(target), { recursive: true });
  try {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new WorkflowValidationError(["bundle target is not a regular file."]);
    if (!confirmOverwrite || !(await confirmOverwrite(target))) throw new WorkflowValidationError(["refusing to overwrite workflow bundle without confirmation."]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${canonicalJson(bundle)}\n`, { mode: 0o600, flag: "wx" });
  try { await rename(temporary, target); } catch (error) { await rm(temporary, { force: true }); throw error; }
  return target;
}

export async function importWorkflowBundle(options: {
  bundlePath: string;
  scope: "user" | "project";
  cwd: string;
  projectTrusted: boolean;
  agentDir?: string;
  confirmConflict?: (path: string) => Promise<boolean>;
}): Promise<string> {
  if (options.scope === "project" && !options.projectTrusted) throw new WorkflowValidationError(["project bundle import requires a trusted project."]);
  const bundle = validateWorkflowBundle(JSON.parse(await readFile(path.resolve(options.bundlePath), "utf8")));
  const directory = options.scope === "project" ? path.join(options.cwd, ".pi", "workflows") : path.join(options.agentDir ?? getAgentDir(), "workflows");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, `${bundle.name}.js`);
  try {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new WorkflowValidationError(["workflow import target is not a regular file."]);
    const existing = await readFile(target, "utf8");
    if (existing === bundle.source) return target;
    if (!options.confirmConflict || !(await options.confirmConflict(target))) throw new WorkflowValidationError(["workflow import conflict was not approved."]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
  await writeFile(target, bundle.source, { mode: 0o600 });
  return target;
}
