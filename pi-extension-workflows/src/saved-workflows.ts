import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAgentDir } from "@firstpick/pi-utils/paths";
import { WorkflowValidationError } from "./errors.ts";
import { parseWorkflowScript } from "./script-parser.ts";
import type { WorkflowRunRecordV1 } from "./persistence-schema.ts";

export type SavedWorkflowScope = "project" | "user";

export type SaveWorkflowResult = {
  path: string;
  name: string;
  scope: SavedWorkflowScope;
  changed: boolean;
};

export type SaveWorkflowOptions = {
  record: WorkflowRunRecordV1;
  scope: SavedWorkflowScope;
  cwd: string;
  projectTrusted: boolean;
  agentDir?: string;
  confirmOverwrite?: (path: string) => Promise<boolean>;
};

let temporarySequence = 0;

async function atomicWrite(filePath: string, source: string): Promise<void> {
  const temporary = `${filePath}.tmp-${process.pid}-${++temporarySequence}`;
  await writeFile(temporary, source, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await rename(temporary, filePath);
  } catch (error) {
    try { await rm(temporary, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}

export async function saveWorkflowSnapshot(options: SaveWorkflowOptions): Promise<SaveWorkflowResult> {
  if (options.record.sourceType !== "javascript" || !options.record.snapshotPath || !options.record.scriptHash) {
    throw new WorkflowValidationError(["only JavaScript runs with immutable script snapshots can be saved."]);
  }
  if (options.scope === "project" && !options.projectTrusted) {
    throw new WorkflowValidationError(["saving a project workflow requires a trusted project."]);
  }

  const source = await readFile(options.record.snapshotPath, "utf8");
  const parsed = parseWorkflowScript(source, { sourcePath: options.record.snapshotPath });
  if (parsed.sourceHash !== options.record.scriptHash) throw new WorkflowValidationError(["run snapshot hash changed and cannot be saved."]);

  const directory = options.scope === "project"
    ? path.resolve(options.cwd, ".pi", "workflows")
    : path.resolve(options.agentDir ?? getAgentDir(), "workflows");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const targetPath = path.join(directory, `${parsed.meta.name}.js`);
  parseWorkflowScript(source, { sourcePath: targetPath, enforceFilename: true });

  try {
    const stat = await lstat(targetPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new WorkflowValidationError([`saved workflow target is not a regular file: ${targetPath}`]);
    const existing = await readFile(targetPath, "utf8");
    if (existing === source) return { path: targetPath, name: parsed.meta.name, scope: options.scope, changed: false };
    if (!options.confirmOverwrite || !(await options.confirmOverwrite(targetPath))) {
      throw new WorkflowValidationError([`refusing to overwrite existing workflow without confirmation: ${targetPath}`]);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }

  await atomicWrite(targetPath, source);
  return { path: targetPath, name: parsed.meta.name, scope: options.scope, changed: true };
}
