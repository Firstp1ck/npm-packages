import path from "node:path";
import {
  createDeniedWorkflowPolicy,
  readWorkflowPolicyFile,
  validateWorkflowPolicy,
} from "./workflow-policy.mjs";
import { getAgentDir } from "@firstpick/pi-utils/paths";
import type { WorkflowScriptPermissions, WorkflowScriptPolicy } from "./types.ts";

export type WorkflowPolicyCeilingV1 = {
  schemaVersion: 1;
  permissions: WorkflowScriptPermissions;
  shellAllowlist: string[];
  networkAllowlist: string[];
  verificationCommands: string[][];
};

export const validateWorkflowPolicyCeiling = validateWorkflowPolicy as (
  value: unknown,
  source?: string,
) => WorkflowPolicyCeilingV1;

async function readOptionalPolicy(filePath: string): Promise<WorkflowPolicyCeilingV1 | undefined> {
  return (await readWorkflowPolicyFile(filePath))?.policy as WorkflowPolicyCeilingV1 | undefined;
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
  const user = await readOptionalPolicy(path.join(options.agentDir ?? getAgentDir(), "workflow-policy.json"))
    ?? createDeniedWorkflowPolicy() as WorkflowPolicyCeilingV1;
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
