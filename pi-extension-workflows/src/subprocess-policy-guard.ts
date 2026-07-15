import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WRITE_TOOLS = new Set(["write", "edit", "apply_patch"]);
const NETWORK_TOOLS = new Set(["fetch_content", "web_search", "brave_search"]);
const PATH_FIELDS = ["path", "filePath", "file_path", "directory", "cwd"];
const STRICT_SHELL = /^[A-Za-z0-9_./:@%+=,\s-]+$/;

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

function inside(root: string, reference: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, reference);
  const relative = path.relative(resolvedRoot, resolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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

export default function workflowSubprocessPolicyGuard(pi: ExtensionAPI) {
  const policy = loadPolicy();
  const allowedTools = new Set(policy.allowedTools);
  pi.on("tool_call", async (event) => {
    const tool = String(event.toolName || "");
    if (!allowedTools.has(tool)) return { block: true, reason: `Workflow policy denied tool '${tool}'.` };
    const input = event.input as Record<string, unknown>;

    for (const field of PATH_FIELDS) {
      const value = input?.[field];
      if (typeof value === "string" && !inside(policy.root, value)) {
        return { block: true, reason: `Workflow policy denied path outside isolated root: ${value}` };
      }
    }

    if (WRITE_TOOLS.has(tool) && !policy.permissions.write) return { block: true, reason: "Workflow policy denied write access." };
    if (tool === "bash") {
      if (!policy.permissions.shell) return { block: true, reason: "Workflow policy denied shell access." };
      const command = typeof input?.command === "string" ? input.command.trim() : "";
      if (!command || !STRICT_SHELL.test(command)) return { block: true, reason: "Workflow shell policy allows only simple commands without shell operators." };
      const executable = command.split(/\s+/)[0];
      if (!policy.shellAllowlist.includes(executable)) return { block: true, reason: `Workflow shell allowlist denied '${executable}'.` };
    }
    if (NETWORK_TOOLS.has(tool)) {
      if (!policy.permissions.network) return { block: true, reason: "Workflow policy denied network access." };
      const urls = urlsIn(input);
      if (urls.length === 0) return { block: true, reason: "Workflow network policy requires an explicit allowlisted URL." };
      for (const url of urls) {
        let hostname = "";
        try { hostname = new URL(url).hostname; } catch { return { block: true, reason: `Workflow network policy rejected invalid URL '${url}'.` }; }
        if (!hostAllowed(hostname, policy.networkAllowlist)) return { block: true, reason: `Workflow network allowlist denied '${hostname}'.` };
      }
    }
  });
}
