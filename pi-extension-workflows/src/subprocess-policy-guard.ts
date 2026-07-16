import { realpath } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WRITE_TOOLS = new Set(["write", "edit", "apply_patch"]);
const NETWORK_TOOLS = new Set(["fetch_content", "web_search", "brave_search"]);
const PATH_FIELDS = ["path", "filePath", "file_path", "directory", "cwd"];

type GuardPolicy = {
  root: string;
  permissions: { write: boolean; shell: boolean; network: boolean };
  allowedTools: string[];
  shellAllowlist: string[];
  networkAllowlist: string[];
};

function loadPolicy(): GuardPolicy {
  const raw = process.env.PI_WORKFLOW_AGENT_POLICY;
  if (!raw) throw new Error("PI_WORKFLOW_AGENT_POLICY is required for guarded workflow agents.");
  const policy = JSON.parse(raw) as GuardPolicy;
  if (!policy || typeof policy.root !== "string" || !Array.isArray(policy.allowedTools)) throw new Error("Workflow agent policy is invalid.");
  return policy;
}

function resolvedPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function inside(root: string, reference: string): Promise<boolean> {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, reference);
  if (!resolvedPathInside(resolvedRoot, target)) return false;

  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(resolvedRoot);
  } catch {
    return false;
  }

  let probe = target;
  while (true) {
    try {
      return resolvedPathInside(canonicalRoot, await realpath(probe));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
      const parent = path.dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
  }
}

function urlsIn(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") {
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>]+/gi)) found.push(match[0]);
  } else if (Array.isArray(value)) for (const item of value) urlsIn(item, found);
  else if (value && typeof value === "object") for (const item of Object.values(value as Record<string, unknown>)) urlsIn(item, found);
  return found;
}

function hostAllowed(hostname: string, allowlist: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return allowlist.some((entry) => {
    const allowed = entry.toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

function deniedNetworkUrl(policy: GuardPolicy, value: unknown): string | undefined {
  for (const url of urlsIn(value)) {
    let hostname = "";
    try { hostname = new URL(url).hostname; } catch { return `invalid URL '${url}'`; }
    if (!hostAllowed(hostname, policy.networkAllowlist)) return `host '${hostname}'`;
  }
  return undefined;
}

export default function workflowSubprocessPolicyGuard(pi: ExtensionAPI) {
  const policy = loadPolicy();
  const allowedTools = new Set(policy.allowedTools);
  pi.on("tool_call", async (event) => {
    const tool = String(event.toolName || "");
    // The parent boundary never grants bash. Retain this guard for direct
    // subprocess launches: without an OS sandbox and argv policy, shell
    // commands cannot be contained to the workflow root or network policy.
    if (tool === "bash") return { block: true, reason: "Workflow shell access is unavailable because secure shell sandboxing and argv policy are not implemented." };
    if (!allowedTools.has(tool)) return { block: true, reason: `Workflow policy denied tool '${tool}'.` };
    const input = event.input as Record<string, unknown>;

    for (const field of PATH_FIELDS) {
      const value = input?.[field];
      if (typeof value === "string" && !(await inside(policy.root, value))) {
        return { block: true, reason: `Workflow policy denied path outside isolated root: ${value}` };
      }
    }

    if (WRITE_TOOLS.has(tool) && !policy.permissions.write) return { block: true, reason: "Workflow policy denied write access." };
    if (NETWORK_TOOLS.has(tool)) {
      if (!policy.permissions.network) return { block: true, reason: "Workflow policy denied network access." };
      if (urlsIn(input).length === 0) return { block: true, reason: "Workflow network policy requires an explicit allowlisted URL." };
      const denied = deniedNetworkUrl(policy, input);
      if (denied) return { block: true, reason: `Workflow network allowlist denied ${denied}.` };
    }
  });
}
