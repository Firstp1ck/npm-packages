import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { getAgentDir, isPathInside } from "@firstpick/pi-utils/paths";
import { WorkflowLoadError, WorkflowValidationError, errorMessage } from "./errors.ts";
import { parseWorkflowScript } from "./script-parser.ts";
import { validateWorkflowDefinition } from "./schema.ts";
import type {
  WorkflowJavaScriptSource,
  WorkflowJsonSource,
  WorkflowSource,
  WorkflowSourceScope,
} from "./types.ts";

export type WorkflowLoaderOptions = {
  cwd: string;
  extensionDir: string;
  includeUser?: boolean;
  agentDir?: string;
  includeProject?: boolean;
  projectTrusted?: boolean;
};

export type WorkflowFileCandidate = {
  path: string;
  scope: WorkflowSourceScope;
  sourceType: "json" | "javascript";
};

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function workflowFilesInDirectory(path: string): Promise<Array<{ path: string; sourceType: "json" | "javascript" }>> {
  if (!(await isDirectory(path))) return [];
  const entries = await readdir(path, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".js")))
    .map((entry) => ({
      path: join(path, entry.name),
      sourceType: entry.name.endsWith(".js") ? "javascript" as const : "json" as const,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function candidatesInDirectory(path: string, scope: WorkflowSourceScope): Promise<WorkflowFileCandidate[]> {
  return (await workflowFilesInDirectory(path)).map((candidate) => ({ ...candidate, scope }));
}

export async function discoverWorkflowFiles(options: WorkflowLoaderOptions): Promise<WorkflowFileCandidate[]> {
  const bundled = await candidatesInDirectory(join(options.extensionDir, "workflows"), "bundled");
  const user = options.includeUser
    ? await candidatesInDirectory(join(options.agentDir ?? getAgentDir(), "workflows"), "user")
    : [];
  const project = options.includeProject && options.projectTrusted
    ? await candidatesInDirectory(resolve(options.cwd, ".pi", "workflows"), "project")
    : [];

  return [...bundled, ...user, ...project];
}

async function readWorkflowSource(candidate: WorkflowFileCandidate): Promise<string> {
  try {
    return await readFile(candidate.path, "utf8");
  } catch (error) {
    throw new WorkflowLoadError([`${candidate.path}: ${errorMessage(error)}`]);
  }
}

function validationLoadError(path: string, error: WorkflowValidationError): WorkflowLoadError {
  return new WorkflowLoadError(error.issues.map((issue) => `${path}: ${issue}`));
}

async function loadJsonWorkflowFile(candidate: WorkflowFileCandidate, raw: string): Promise<WorkflowJsonSource> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new WorkflowLoadError([`${candidate.path}: invalid JSON: ${errorMessage(error)}`]);
  }

  try {
    return {
      path: candidate.path,
      scope: candidate.scope,
      sourceType: "json",
      definition: validateWorkflowDefinition(parsed, { sourcePath: candidate.path }),
    };
  } catch (error) {
    if (error instanceof WorkflowValidationError) throw validationLoadError(candidate.path, error);
    throw error;
  }
}

async function loadJavaScriptWorkflowFile(candidate: WorkflowFileCandidate, raw: string): Promise<WorkflowJavaScriptSource> {
  try {
    return {
      path: candidate.path,
      scope: candidate.scope,
      sourceType: "javascript",
      script: parseWorkflowScript(raw, { sourcePath: candidate.path, enforceFilename: true }),
    };
  } catch (error) {
    if (error instanceof WorkflowValidationError) throw validationLoadError(candidate.path, error);
    throw error;
  }
}

export async function loadWorkflowFile(candidate: WorkflowFileCandidate): Promise<WorkflowSource> {
  const raw = await readWorkflowSource(candidate);
  const sourceType = candidate.sourceType ?? (extname(candidate.path) === ".js" ? "javascript" : "json");
  return sourceType === "javascript"
    ? await loadJavaScriptWorkflowFile(candidate, raw)
    : await loadJsonWorkflowFile(candidate, raw);
}

export async function loadWorkflowScriptPath(reference: string, options: WorkflowLoaderOptions): Promise<WorkflowJavaScriptSource> {
  if (!reference.trim()) throw new WorkflowLoadError(["scriptPath must be a non-empty path."]);
  const requested = resolve(options.cwd, reference);
  if (extname(requested) !== ".js") throw new WorkflowLoadError(["scriptPath must reference a .js workflow."]);

  let candidatePath: string;
  try {
    candidatePath = await realpath(requested);
  } catch (error) {
    throw new WorkflowLoadError([`${requested}: ${errorMessage(error)}`]);
  }

  const roots: Array<{ path: string; scope: WorkflowSourceScope }> = [
    { path: join(options.extensionDir, "workflows"), scope: "bundled" },
    { path: join(options.agentDir ?? getAgentDir(), "workflows"), scope: "user" },
  ];
  if (options.projectTrusted) roots.push({ path: resolve(options.cwd, ".pi", "workflows"), scope: "project" });

  for (const root of roots) {
    let canonicalRoot: string;
    try { canonicalRoot = await realpath(root.path); } catch { continue; }
    if (!isPathInside(canonicalRoot, candidatePath)) continue;
    const loaded = await loadWorkflowFile({ path: candidatePath, scope: root.scope, sourceType: "javascript" });
    if (loaded.sourceType !== "javascript") throw new WorkflowLoadError([`${candidatePath}: expected a JavaScript workflow.`]);
    return loaded;
  }
  throw new WorkflowLoadError(["scriptPath is outside bundled, user, or trusted-project workflow directories."]);
}

export function workflowSourceKey(source: WorkflowSource): string {
  return source.sourceType === "javascript" ? source.script.meta.name : source.definition.key;
}

export function workflowSourceName(source: WorkflowSource): string {
  return source.sourceType === "javascript" ? source.script.meta.description : source.definition.name;
}

export async function loadWorkflowRegistry(options: WorkflowLoaderOptions): Promise<WorkflowSource[]> {
  const candidates = await discoverWorkflowFiles(options);
  const sources: WorkflowSource[] = [];
  const issues: string[] = [];

  for (const candidate of candidates) {
    try {
      sources.push(await loadWorkflowFile(candidate));
    } catch (error) {
      if (error instanceof WorkflowLoadError) issues.push(...error.issues);
      else issues.push(`${candidate.path}: ${errorMessage(error)}`);
    }
  }

  const seen = new Map<string, WorkflowSource>();
  for (const source of sources) {
    const key = workflowSourceKey(source);
    const existing = seen.get(key);
    if (existing) issues.push(`duplicate workflow key '${key}' in ${existing.path} and ${source.path}.`);
    else seen.set(key, source);
  }

  if (issues.length > 0) throw new WorkflowLoadError(issues);
  return sources;
}

export function findWorkflowSource(sources: WorkflowSource[], key: string): WorkflowSource | undefined {
  return sources.find((source) => workflowSourceKey(source) === key);
}

export function formatWorkflowList(sources: WorkflowSource[]): string {
  if (sources.length === 0) return "No workflows found.";
  return sources
    .map((source) => {
      const kind = source.sourceType === "javascript" ? "js" : "json legacy";
      const migration = source.sourceType === "json" ? " — migrate to a saved .js workflow; JSON removal criteria are documented in README.md" : "";
      return `- ${workflowSourceKey(source)} (${source.scope}, ${kind}): ${workflowSourceName(source)}${migration}`;
    })
    .join("\n");
}
