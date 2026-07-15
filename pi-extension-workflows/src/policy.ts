import { readFile } from "node:fs/promises";
import path from "node:path";
import { getAgentDir } from "@firstpick/pi-utils/paths";
import { WorkflowValidationError } from "./errors.ts";
import type { WorkflowScriptPermissions, WorkflowScriptPolicy } from "./types.ts";

export type WorkflowPolicyCeilingV1 = {
  schemaVersion: 1;
  permissions: WorkflowScriptPermissions;
  shellAllowlist: string[];
  networkAllowlist: string[];
  verificationCommands: string[][];
};

const DEFAULT_CEILING: WorkflowPolicyCeilingV1 = {
  schemaVersion: 1,
  permissions: { write: false, shell: false, network: false },
  shellAllowlist: [],
  networkAllowlist: [],
  verificationCommands: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateWorkflowPolicyCeiling(value: unknown, source = "workflow policy"): WorkflowPolicyCeilingV1 {
  if (!isRecord(value)) throw new WorkflowValidationError([`${source} must be an object.`]);
  const issues: string[] = [];
  for (const key of Object.keys(value)) if (!["schemaVersion", "permissions", "shellAllowlist", "networkAllowlist", "verificationCommands"].includes(key)) issues.push(`${source} contains unsupported field '${key}'.`);
  if (value.schemaVersion !== 1) issues.push(`${source}.schemaVersion must be 1.`);
  const permissions = isRecord(value.permissions) ? value.permissions : {};
  for (const key of Object.keys(permissions)) if (!["write", "shell", "network"].includes(key)) issues.push(`${source}.permissions contains unsupported field '${key}'.`);
  const normalizedPermissions = { write: false, shell: false, network: false };
  for (const key of Object.keys(normalizedPermissions) as Array<keyof WorkflowScriptPermissions>) {
    if (permissions[key] !== undefined && typeof permissions[key] !== "boolean") issues.push(`${source}.permissions.${key} must be boolean.`);
    normalizedPermissions[key] = permissions[key] === true;
  }
  const strings = (key: "shellAllowlist" | "networkAllowlist") => {
    const raw = value[key] ?? [];
    if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string" || !item.trim())) {
      issues.push(`${source}.${key} must be an array of non-empty strings.`);
      return [];
    }
    return [...new Set(raw.map((item) => item.trim()))].sort();
  };
  const commandsRaw = value.verificationCommands ?? [];
  const verificationCommands = Array.isArray(commandsRaw) && commandsRaw.every((command) => Array.isArray(command) && command.length > 0 && command.every((part) => typeof part === "string" && part.length > 0))
    ? commandsRaw.map((command) => [...command]) as string[][]
    : (issues.push(`${source}.verificationCommands must be an array of non-empty argv arrays.`), []);
  if (issues.length) throw new WorkflowValidationError(issues);
  return { schemaVersion: 1, permissions: normalizedPermissions, shellAllowlist: strings("shellAllowlist"), networkAllowlist: strings("networkAllowlist"), verificationCommands };
}

async function readOptionalPolicy(filePath: string): Promise<WorkflowPolicyCeilingV1 | undefined> {
  try { return validateWorkflowPolicyCeiling(JSON.parse(await readFile(filePath, "utf8")), filePath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
    throw error;
  }
}

function intersection(left: string[], right: string[]): string[] {
  const allowed = new Set(right);
  return left.filter((value) => allowed.has(value));
}

export async function loadWorkflowPolicyCeiling(options: {
  cwd: string;
  projectTrusted: boolean;
  agentDir?: string;
}): Promise<WorkflowPolicyCeilingV1> {
  const user = await readOptionalPolicy(path.join(options.agentDir ?? getAgentDir(), "workflow-policy.json")) ?? DEFAULT_CEILING;
  if (!options.projectTrusted) return {
    ...structuredClone(user),
    shellAllowlist: user.permissions.shell ? [...user.shellAllowlist] : [],
    networkAllowlist: user.permissions.network ? [...user.networkAllowlist] : [],
  };
  const project = await readOptionalPolicy(path.join(options.cwd, ".pi", "workflow-policy.json"));
  if (!project) return structuredClone(user);
  const permissions = {
    write: user.permissions.write && project.permissions.write,
    shell: user.permissions.shell && project.permissions.shell,
    network: user.permissions.network && project.permissions.network,
  };
  return {
    schemaVersion: 1,
    permissions,
    shellAllowlist: permissions.shell ? intersection(user.shellAllowlist, project.shellAllowlist) : [],
    networkAllowlist: permissions.network ? intersection(user.networkAllowlist, project.networkAllowlist) : [],
    verificationCommands: project.verificationCommands.length ? project.verificationCommands : user.verificationCommands,
  };
}

export function policyCeilingForScript(ceiling: WorkflowPolicyCeilingV1): Partial<WorkflowScriptPolicy> {
  return {
    permissions: ceiling.permissions,
    shellAllowlist: ceiling.shellAllowlist,
    networkAllowlist: ceiling.networkAllowlist,
    verificationCommands: ceiling.verificationCommands,
  };
}

export function deniedRequestedPermissions(requested: WorkflowScriptPermissions, ceiling: WorkflowPolicyCeilingV1): Array<keyof WorkflowScriptPermissions> {
  return (Object.keys(requested) as Array<keyof WorkflowScriptPermissions>).filter((key) => requested[key] && !ceiling.permissions[key]);
}
