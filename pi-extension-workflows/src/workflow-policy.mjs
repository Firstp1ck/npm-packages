import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function expandTilde(input, homeDir = os.homedir()) {
  if (input === "~" || input === "$HOME") return homeDir;
  if (input.startsWith("~/")) return path.join(homeDir, input.slice(2));
  if (input.startsWith("$HOME/")) return path.join(homeDir, input.slice(6));
  return input;
}

export const WORKFLOW_POLICY_SCHEMA_VERSION = 1;
export const WORKFLOW_POLICY_FILENAME = "workflow-policy.json";

function freezeWorkflowPolicySuggestions(catalog) {
  for (const group of Object.values(catalog)) {
    for (const suggestion of group) {
      if (Array.isArray(suggestion)) Object.freeze(suggestion);
    }
    Object.freeze(group);
  }
  return Object.freeze(catalog);
}

// Advisory draft helpers only. They never change permissions or policy schema.
export const WORKFLOW_POLICY_SUGGESTIONS = freezeWorkflowPolicySuggestions({
  shellAllowlist: ["git", "node", "npm"],
  networkAllowlist: ["api.github.com", "registry.npmjs.org"],
  verificationCommands: [["npm", "test"], ["npm", "run", "lint"]],
});

const POLICY_FIELDS = ["schemaVersion", "permissions", "shellAllowlist", "networkAllowlist", "verificationCommands"];
const PERMISSION_FIELDS = ["write", "shell", "network"];
let writeQueue = Promise.resolve();

export class WorkflowPolicyValidationError extends Error {
  constructor(issues) {
    super(issues.join("\n"));
    this.name = "WorkflowPolicyValidationError";
    this.code = "WORKFLOW_POLICY_INVALID";
    this.issues = issues;
  }
}

export class WorkflowPolicyStaleRevisionError extends Error {
  constructor(expectedRevision, actualRevision) {
    super("Workflow policy changed after it was reviewed. Reload it before saving.");
    this.name = "WorkflowPolicyStaleRevisionError";
    this.code = "WORKFLOW_POLICY_STALE_REVISION";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownFields(value, expected, source, issues) {
  for (const key of Object.keys(value)) {
    if (!expected.includes(key)) issues.push(`${source} contains unsupported field '${key}'.`);
  }
}

function normalizedStringList(value, key, source, issues) {
  const entries = value ?? [];
  if (!Array.isArray(entries) || entries.some((item) => typeof item !== "string" || !item.trim())) {
    issues.push(`${source}.${key} must be an array of non-empty strings.`);
    return [];
  }
  return [...new Set(entries.map((item) => item.trim()))].sort();
}

export function createDeniedWorkflowPolicy() {
  return {
    schemaVersion: WORKFLOW_POLICY_SCHEMA_VERSION,
    permissions: { write: false, shell: false, network: false },
    shellAllowlist: [],
    networkAllowlist: [],
    verificationCommands: [],
  };
}

export function validateWorkflowPolicy(value, source = "workflow policy") {
  const issues = [];
  if (!isRecord(value)) throw new WorkflowPolicyValidationError([`${source} must be an object.`]);

  rejectUnknownFields(value, POLICY_FIELDS, source, issues);
  if (value.schemaVersion !== WORKFLOW_POLICY_SCHEMA_VERSION) {
    issues.push(`${source}.schemaVersion must be ${WORKFLOW_POLICY_SCHEMA_VERSION}.`);
  }

  const permissions = value.permissions === undefined ? {} : isRecord(value.permissions) ? value.permissions : undefined;
  if (!permissions) {
    issues.push(`${source}.permissions must be an object.`);
  } else {
    rejectUnknownFields(permissions, PERMISSION_FIELDS, `${source}.permissions`, issues);
  }
  const normalizedPermissions = {};
  for (const key of PERMISSION_FIELDS) {
    if (permissions?.[key] !== undefined && typeof permissions[key] !== "boolean") issues.push(`${source}.permissions.${key} must be boolean.`);
    normalizedPermissions[key] = permissions?.[key] === true;
  }

  const shellAllowlist = normalizedStringList(value.shellAllowlist, "shellAllowlist", source, issues);
  const networkAllowlist = normalizedStringList(value.networkAllowlist, "networkAllowlist", source, issues);
  const commands = value.verificationCommands ?? [];
  const verificationCommands = Array.isArray(commands) && commands.every((command) => (
    Array.isArray(command)
    && command.length > 0
    && command.every((part) => typeof part === "string" && part.length > 0)
  ))
    ? commands.map((command) => [...command])
    : (issues.push(`${source}.verificationCommands must be an array of non-empty argv arrays.`), []);

  if (issues.length > 0) throw new WorkflowPolicyValidationError(issues);
  return {
    schemaVersion: WORKFLOW_POLICY_SCHEMA_VERSION,
    permissions: normalizedPermissions,
    shellAllowlist,
    networkAllowlist,
    verificationCommands,
  };
}

export const validateWorkflowPolicyCeiling = validateWorkflowPolicy;

export function getWorkflowPolicyPath(agentDir) {
  const configuredDir = agentDir ?? process.env.PI_CODING_AGENT_DIR?.trim();
  const resolvedDir = configuredDir
    ? path.resolve(expandTilde(configuredDir))
    : path.join(os.homedir(), ".pi", "agent");
  return path.join(resolvedDir, WORKFLOW_POLICY_FILENAME);
}

export function workflowPolicyRevision(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

async function lstatRegularFile(filePath) {
  try {
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      const error = new Error(`Refusing workflow policy target that is not a regular file: ${filePath}`);
      error.code = "WORKFLOW_POLICY_UNSAFE_TARGET";
      throw error;
    }
    return metadata;
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readExistingPolicy(filePath, { requireRegularTarget = false } = {}) {
  if (requireRegularTarget) {
    const metadata = await lstatRegularFile(filePath);
    if (!metadata) return undefined;
  }
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new WorkflowPolicyValidationError([`${filePath} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`]);
  }
  return {
    content,
    policy: validateWorkflowPolicy(parsed, filePath),
    revision: workflowPolicyRevision(content),
  };
}

export async function readWorkflowPolicyState(options = {}) {
  const filePath = getWorkflowPolicyPath(options.agentDir);
  const existing = await readExistingPolicy(filePath);
  if (existing) return { filePath, exists: true, revision: existing.revision, policy: existing.policy };
  return { filePath, exists: false, revision: null, policy: createDeniedWorkflowPolicy() };
}

export async function readWorkflowPolicyFile(filePath) {
  return await readExistingPolicy(filePath);
}

function enqueueWrite(operation) {
  const queued = writeQueue.then(operation, operation);
  writeQueue = queued.catch(() => {});
  return queued;
}

function hasExpectedRevision(options) {
  return Object.prototype.hasOwnProperty.call(options, "expectedRevision");
}

export async function writeWorkflowPolicyState(options) {
  if (!isRecord(options) || !hasExpectedRevision(options)) {
    throw new TypeError("writeWorkflowPolicyState requires expectedRevision from readWorkflowPolicyState.");
  }
  if (options.expectedRevision !== null && typeof options.expectedRevision !== "string") {
    throw new TypeError("expectedRevision must be a read revision string or null for a missing policy.");
  }
  const policy = validateWorkflowPolicy(options.policy, "workflow policy to save");
  const filePath = getWorkflowPolicyPath(options.agentDir);
  const directory = path.dirname(filePath);

  return await enqueueWrite(async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const existing = await readExistingPolicy(filePath, { requireRegularTarget: true });
    const actualRevision = existing?.revision ?? null;
    if (options.expectedRevision !== actualRevision) {
      throw new WorkflowPolicyStaleRevisionError(options.expectedRevision, actualRevision);
    }

    const temporaryPath = path.join(directory, `.${WORKFLOW_POLICY_FILENAME}.${process.pid}.${randomUUID()}.tmp`);
    const serialized = `${JSON.stringify(policy, null, 2)}\n`;
    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, filePath);
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }

    return {
      filePath,
      exists: true,
      revision: workflowPolicyRevision(serialized),
      policy,
    };
  });
}

export const readWorkflowPolicy = readWorkflowPolicyState;
export const writeWorkflowPolicy = writeWorkflowPolicyState;
