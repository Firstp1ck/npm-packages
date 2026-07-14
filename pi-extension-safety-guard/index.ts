import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { matchingCommandExcerpt } from "./src/excerpt.ts";

const STATUS_KEY = "safety-guard";
const PROMPT_WIDGET_KEY = "safety-guard-prompt";

type RiskLevel = "prompt" | "strong-confirm" | "block-noninteractive";
type RuleCategory = "git" | "filesystem" | "docker" | "package" | "system" | "database" | "secrets";

type CommandRule = {
  pattern: RegExp;
  label: string;
  category: RuleCategory;
  level: RiskLevel;
};

type AllowScope = "session" | "permanent";
type AllowDecision = { block: true; reason: string } | { allow: true; scope?: AllowScope } | undefined;
type AllowEntry = {
  key: string;
  kind: "bash" | "write" | "edit";
  value: string;
  cwd: string;
  label: string;
  category?: RuleCategory;
  createdAt: string;
};
type AllowStore = { version: 1; entries: AllowEntry[] };

const ALLOW_STORE_PATH = path.join(homedir(), ".pi", "agent", "safety-guard-allow.json");

const GIT_RULES: CommandRule[] = [
  { pattern: /\bgit\s+reset\s+--hard\b/i, label: "git reset --hard", category: "git", level: "block-noninteractive" },
  { pattern: /\bgit\s+reset\s+(?:--soft|--mixed|--merge|--keep)\b/i, label: "git reset history rewrite", category: "git", level: "strong-confirm" },
  { pattern: /\bgit\s+reset\s+(?:HEAD[~^]|[a-f0-9]{7,40}\b)/i, label: "git reset to revision", category: "git", level: "strong-confirm" },
  { pattern: /\bgit\s+clean\b[^\n;&|]*\s-[^\s;&|]*f/i, label: "git clean -f", category: "git", level: "block-noninteractive" },
  { pattern: /\bgit\s+checkout\s+--\s+/i, label: "git checkout -- <path>", category: "git", level: "prompt" },
  { pattern: /\bgit\s+switch\b/i, label: "git switch", category: "git", level: "prompt" },
  { pattern: /\bgit\s+restore\b/i, label: "git restore", category: "git", level: "prompt" },
  { pattern: /\bgit\s+branch\s+-(?:d|D)\b/i, label: "git branch delete", category: "git", level: "prompt" },
  { pattern: /\bgit\s+tag\s+-d\b/i, label: "git tag delete", category: "git", level: "prompt" },
  { pattern: /\bgit\s+push\b[^\n;&|]*--force(?:-with-lease)?\b/i, label: "git push --force", category: "git", level: "strong-confirm" },
  { pattern: /\bgit\s+push\b[^\n;&|]*(?:--delete|:refs\/heads\/)/i, label: "git push delete branch", category: "git", level: "strong-confirm" },
  { pattern: /\bgit\s+rebase\b/i, label: "git rebase", category: "git", level: "strong-confirm" },
  { pattern: /\bgit\s+filter-(?:branch|repo)\b/i, label: "git history filtering", category: "git", level: "strong-confirm" },
  { pattern: /\bgit\s+commit\b[^\n;&|]*--amend\b/i, label: "git commit --amend", category: "git", level: "prompt" },
  { pattern: /\bgit\s+commit\b[^\n;&|]*--(?:fixup|squash)\b/i, label: "git commit fixup/squash", category: "git", level: "prompt" },
  { pattern: /\bgit\s+replace\b/i, label: "git replace", category: "git", level: "strong-confirm" },
  { pattern: /\bgit\s+notes\s+(?:remove|prune)\b/i, label: "git notes remove/prune", category: "git", level: "prompt" },
  { pattern: /\bgit\s+update-ref\b/i, label: "git update-ref", category: "git", level: "strong-confirm" },
  { pattern: /\bgit\s+reflog\s+expire\b/i, label: "git reflog expire", category: "git", level: "strong-confirm" },
  { pattern: /\bgit\s+gc\b[^\n;&|]*--prune(?:=|\s+)?(?:now|all)?\b/i, label: "git gc --prune", category: "git", level: "strong-confirm" },
  { pattern: /\bgit\s+prune\b/i, label: "git prune", category: "git", level: "strong-confirm" },
];

const FILESYSTEM_RULES: CommandRule[] = [
  { pattern: /(^|[^\w-])rm\s+[^\n;&|]*-[^\s;&|]*r[^\s;&|]*f?\b/i, label: "recursive rm", category: "filesystem", level: "prompt" },
  { pattern: /(^|[^\w-])rm\s+[^\n;&|]*-[^\s;&|]*f[^\s;&|]*r\b/i, label: "recursive force rm", category: "filesystem", level: "prompt" },
  { pattern: /(^|[^\w-])rm\s+[^\n;&|]*(?:-[^\s;&|]*(?:r|f)[^\s;&|]*(?:r|f)[^\s;&|]*\s+)?(?:\/|~|\$HOME|\.)(?:\s|$|[;&|])/i, label: "rm targeting root/home/current directory", category: "filesystem", level: "block-noninteractive" },
  { pattern: /(^|[^\w-])rm\s+[^\n;&|]*\*/i, label: "rm with glob", category: "filesystem", level: "prompt" },
  { pattern: /\bfind\b[^\n;&|]*\s-delete\b/i, label: "find -delete", category: "filesystem", level: "prompt" },
  { pattern: /\bfind\b[^\n;&|]*\s-exec\s+rm\b/i, label: "find -exec rm", category: "filesystem", level: "prompt" },
  { pattern: /\bxargs\b[^\n;&|]*\brm\b/i, label: "xargs rm", category: "filesystem", level: "prompt" },
  { pattern: /\btruncate\s+-s\s+0\b/i, label: "truncate file to zero", category: "filesystem", level: "prompt" },
  { pattern: /\bshred\b/i, label: "shred", category: "filesystem", level: "strong-confirm" },
  { pattern: /\bdd\b[^\n;&|]*\bof=\/dev\//i, label: "dd to block device", category: "filesystem", level: "block-noninteractive" },
  { pattern: /\bdd\b/i, label: "dd", category: "filesystem", level: "prompt" },
  { pattern: /\bmkfs(?:\.|\b)/i, label: "mkfs", category: "filesystem", level: "block-noninteractive" },
  { pattern: /\b(?:wipefs|parted|fdisk|sfdisk|sgdisk)\b/i, label: "disk partition/filesystem tool", category: "filesystem", level: "block-noninteractive" },
];

const DOCKER_RULES: CommandRule[] = [
  { pattern: /\bdocker\s+(?:rm|rmi)\b/i, label: "docker remove", category: "docker", level: "prompt" },
  { pattern: /\bdocker\s+volume\s+(?:rm|prune)\b/i, label: "docker volume removal/prune", category: "docker", level: "block-noninteractive" },
  { pattern: /\bdocker\s+system\s+prune\b/i, label: "docker system prune", category: "docker", level: "strong-confirm" },
  { pattern: /\bdocker\s+compose\s+down\b[^\n;&|]*(?:-v|--volumes)\b/i, label: "docker compose down --volumes", category: "docker", level: "block-noninteractive" },
  { pattern: /\bdocker-compose\s+down\b[^\n;&|]*(?:-v|--volumes)\b/i, label: "docker-compose down --volumes", category: "docker", level: "block-noninteractive" },
  { pattern: /\bpodman\s+(?:rm|rmi)\b/i, label: "podman remove", category: "docker", level: "prompt" },
  { pattern: /\bpodman\s+system\s+prune\b/i, label: "podman system prune", category: "docker", level: "strong-confirm" },
];

const PACKAGE_MANAGER_RULES: CommandRule[] = [
  { pattern: /\b(?:npm|pnpm|yarn|bun)\s+(?:uninstall|remove|rm|prune|autoclean)\b/i, label: "JS package removal", category: "package", level: "prompt" },
  { pattern: /\b(?:pip|uv|cargo)\s+(?:uninstall|remove)\b/i, label: "package removal", category: "package", level: "prompt" },
  { pattern: /\b(?:pacman|paru|yay)\s+-R/i, label: "Arch package removal", category: "package", level: "strong-confirm" },
  { pattern: /\bapt(?:-get)?\s+(?:remove|purge|autoremove)\b/i, label: "APT package removal", category: "package", level: "strong-confirm" },
  { pattern: /\bdnf\s+remove\b/i, label: "DNF package removal", category: "package", level: "strong-confirm" },
];

const SYSTEM_RULES: CommandRule[] = [
  { pattern: /\bsudo\b/i, label: "sudo", category: "system", level: "prompt" },
  { pattern: /\b(?:shutdown|reboot|poweroff)\b/i, label: "shutdown/reboot", category: "system", level: "block-noninteractive" },
  { pattern: /\bsystemctl\s+(?:stop|disable|mask|restart)\b/i, label: "systemctl service change", category: "system", level: "prompt" },
  { pattern: /\b(?:killall|pkill)\b/i, label: "process kill", category: "system", level: "prompt" },
  { pattern: /\bkill\s+-9\b/i, label: "kill -9", category: "system", level: "prompt" },
  { pattern: /\b(?:umount|mount|swapon|swapoff)\b/i, label: "mount/swap change", category: "system", level: "prompt" },
  { pattern: /\b(?:chmod|chown)\b[^\n;&|]*\s-R\b/i, label: "recursive chmod/chown", category: "system", level: "prompt" },
  { pattern: /\bchmod\b[^\n;&|]*\s777\b/i, label: "chmod 777", category: "system", level: "prompt" },
  { pattern: /\bsetfacl\b/i, label: "ACL change", category: "system", level: "prompt" },
  { pattern: /:\(\)\s*\{/i, label: "fork bomb", category: "system", level: "block-noninteractive" },
];

const DATABASE_RULES: CommandRule[] = [
  { pattern: /\bDROP\s+(?:DATABASE|SCHEMA)\b/i, label: "SQL drop database/schema", category: "database", level: "block-noninteractive" },
  { pattern: /\bDROP\s+TABLE\b/i, label: "SQL drop table", category: "database", level: "strong-confirm" },
  { pattern: /\bDROP\s+INDEX\b/i, label: "SQL drop index", category: "database", level: "strong-confirm" },
  { pattern: /\bTRUNCATE\s+(?:TABLE\s+)?[\w.`\"\[\]-]+/i, label: "SQL truncate table", category: "database", level: "strong-confirm" },
  { pattern: /\bDELETE\s+FROM\b(?:(?!\bWHERE\b|;)[\s\S])*(?:;|$)/i, label: "SQL delete without WHERE", category: "database", level: "strong-confirm" },
  { pattern: /\bUPDATE\s+[\w.`\"\[\]-]+\s+SET\b(?:(?!\bWHERE\b|;)[\s\S])*(?:;|$)/i, label: "SQL update without WHERE", category: "database", level: "strong-confirm" },
  { pattern: /\bALTER\s+TABLE\b[\s\S]*\bDROP\s+(?:COLUMN|CONSTRAINT)\b/i, label: "SQL alter table drop", category: "database", level: "strong-confirm" },
];

const SECRET_EXPOSURE_RULES: CommandRule[] = [
  { pattern: /\b(?:cat|grep|rg|awk|sed|cp)\b[^\n;&|]*(?:\.env(?:\.[^\s;&|]+)?|id_rsa|id_ed25519|\.git-credentials|auth\.json|\.npmrc|\.pypirc|\.netrc|credentials|hosts\.yml|\.pem|\.key|\.p12|\.kdbx)/i, label: "possible secret file access", category: "secrets", level: "prompt" },
];

const DANGEROUS_BASH_RULES: CommandRule[] = [
  ...GIT_RULES,
  ...FILESYSTEM_RULES,
  ...DOCKER_RULES,
  ...PACKAGE_MANAGER_RULES,
  ...SYSTEM_RULES,
  ...SECRET_EXPOSURE_RULES,
];

function normalizeCwd(cwd: string): string {
  return path.resolve(cwd || process.cwd());
}

function allowKey(kind: AllowEntry["kind"], value: string, cwd: string): string {
  return `${kind}:${normalizeCwd(cwd)}:${value}`;
}

function readAllowStore(): AllowStore {
  try {
    const raw = fs.readFileSync(ALLOW_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AllowStore>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return { version: 1, entries: [] };
    return {
      version: 1,
      entries: parsed.entries.filter((entry): entry is AllowEntry => (
        !!entry
        && typeof entry.key === "string"
        && (entry.kind === "bash" || entry.kind === "write" || entry.kind === "edit")
        && typeof entry.value === "string"
        && typeof entry.cwd === "string"
        && typeof entry.label === "string"
        && typeof entry.createdAt === "string"
      )),
    };
  } catch {
    return { version: 1, entries: [] };
  }
}

function writeAllowStore(store: AllowStore): void {
  fs.mkdirSync(path.dirname(ALLOW_STORE_PATH), { recursive: true });
  fs.writeFileSync(ALLOW_STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function addPermanentAllow(entry: Omit<AllowEntry, "createdAt">): void {
  const store = readAllowStore();
  const next: AllowEntry = { ...entry, createdAt: new Date().toISOString() };
  store.entries = [...store.entries.filter((existing) => existing.key !== entry.key), next];
  writeAllowStore(store);
}

function formatAllowEntry(entry: AllowEntry): string {
  return `${entry.kind} ${entry.label} @ ${entry.cwd}`;
}

function allowedScope(decision: AllowDecision): AllowScope | undefined {
  return decision && "allow" in decision ? decision.scope : undefined;
}

function isProtectedPath(targetPath: string, cwd: string): boolean {
  const resolved = path.resolve(cwd, targetPath);
  const lower = resolved.toLowerCase();

  if (/(^|\/)\.ssh(\/|$)/.test(lower)) return true;
  if (/(^|\/)\.git-credentials$/.test(lower)) return true;
  if (/(^|\/)auth\.json$/.test(lower)) return true;
  if (/(^|\/)id_(rsa|ed25519)(\.pub)?$/.test(lower)) return true;
  if (/(^|\/)\.env(\..+)?$/.test(lower)) return true;
  if (/(^|\/)\.envrc$/.test(lower)) return true;
  if (/(^|\/)\.npmrc$/.test(lower)) return true;
  if (/(^|\/)\.pypirc$/.test(lower)) return true;
  if (/(^|\/)\.netrc$/.test(lower)) return true;
  if (/(^|\/)\.kube\/config$/.test(lower)) return true;
  if (/(^|\/)\.aws\/(credentials|config)$/.test(lower)) return true;
  if (/(^|\/)\.config\/gh\/hosts\.yml$/.test(lower)) return true;
  if (/(^|\/)\.config\/gcloud(\/|$)/.test(lower)) return true;
  if (/\.(pem|key|p12|kdbx)$/.test(lower)) return true;

  return false;
}

async function confirmOrBlock(
  ctx: ExtensionContext,
  title: string,
  message: string,
  nonInteractiveReason: string,
): Promise<AllowDecision> {
  if (!ctx.hasUI) {
    return { block: true, reason: nonInteractiveReason };
  }

  return await new Promise<AllowDecision>((resolveDecision) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;

    const finish = (decision: AllowDecision) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      ctx.ui.setWidget(PROMPT_WIDGET_KEY, undefined);
      resolveDecision(decision);
    };

    const promptTitle = [
      ctx.ui.theme.fg("warning", `⚠ ${title}`),
      "",
      message,
    ].join("\n");

    void ctx.ui.select(promptTitle, [
      "Block",
      "Allow once",
      "Allow for this session",
      "Always allow in this cwd",
    ]).then((choice) => {
      switch (choice) {
        case "Allow once":
          finish({ allow: true });
          break;
        case "Allow for this session":
          finish({ allow: true, scope: "session" });
          break;
        case "Always allow in this cwd":
          finish({ allow: true, scope: "permanent" });
          break;
        default:
          finish({ block: true, reason: "Blocked by safety-guard extension" });
          break;
      }
    }).catch(() => finish({ block: true, reason: "Blocked by safety-guard extension" }));
  });
}

function stripHeredocBodies(command: string): string {
  const lines = command.split(/\r?\n/);
  const kept: string[] = [];
  let terminator: string | undefined;

  for (const line of lines) {
    if (terminator) {
      if (line.trim() === terminator) terminator = undefined;
      continue;
    }

    kept.push(line);
    const match = line.match(/<<-?\s*(?:['"]?)([A-Za-z_][A-Za-z0-9_]*)(?:['"]?)/);
    if (match) terminator = match[1];
  }

  return kept.join("\n");
}

function formatRuleMessage(
  rule: CommandRule,
  commandForMatching: string,
  highlight: (value: string) => string = (value) => value,
): { title: string; message: string; nonInteractiveReason: string } {
  const title = rule.level === "strong-confirm" ? "High-risk bash command" : "Dangerous bash command";
  const impact = rule.level === "strong-confirm"
    ? "This can be difficult to undo. Verify the target, branch, and scope before allowing."
    : "Verify the target and scope before allowing.";
  const excerpt = matchingCommandExcerpt(rule, commandForMatching, highlight);

  return {
    title,
    message: [
      `Reason: ${highlight(rule.label)} (${rule.category})`,
      impact,
      "",
      "DANGEROUS LINE(S) AND CONTEXT",
      `Lines marked with ${highlight("!!!")} triggered the safety rule; the matched pattern is wrapped as ${highlight(">>> pattern <<<")}.`,
      "────────────────────────────────────────",
      excerpt,
      "────────────────────────────────────────",
      "",
      "Execute anyway?",
    ].join("\n"),
    nonInteractiveReason: `Blocked ${rule.category} command (${rule.label}) in non-interactive mode`,
  };
}

function updateStatus(ctx: ExtensionContext, enabled: boolean): void {
  if (!ctx.hasUI) return;
  if (enabled) {
    ctx.ui.setStatus(STATUS_KEY, "");
    return;
  }
  ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("success", "🔓!"));
}

export default function safetyGuard(pi: ExtensionAPI) {
  let enabled = true;
  const sessionAllow = new Map<string, AllowEntry>();
  let permanentAllow = readAllowStore();

  const isAllowed = (key: string): boolean => sessionAllow.has(key) || permanentAllow.entries.some((entry) => entry.key === key);

  const rememberAllow = (entry: Omit<AllowEntry, "createdAt">, scope: AllowScope, ctx: ExtensionContext): void => {
    const next: AllowEntry = { ...entry, createdAt: new Date().toISOString() };
    if (scope === "session") {
      sessionAllow.set(entry.key, next);
      if (ctx.hasUI) ctx.ui.notify(`Allowed for this session: ${formatAllowEntry(next)}`, "info");
      return;
    }

    addPermanentAllow(entry);
    permanentAllow = readAllowStore();
    if (ctx.hasUI) ctx.ui.notify(`Permanently allowed: ${formatAllowEntry(next)}`, "info");
  };

  pi.registerCommand("safety-guard", {
    description: "Safety guard control: on | off | status | allow-list | allow-clear-session | allow-clear-permanent",
    handler: async (args, ctx) => {
      const cmd = args?.trim().toLowerCase();
      if (!cmd || cmd === "status") {
        permanentAllow = readAllowStore();
        if (ctx.hasUI) ctx.ui.notify(`Safety guard: ${enabled ? "ON" : "OFF"}. Allows: ${sessionAllow.size} session, ${permanentAllow.entries.length} permanent.`, "info");
        updateStatus(ctx, enabled);
        return;
      }
      if (cmd === "on") {
        enabled = true;
        updateStatus(ctx, enabled);
        if (ctx.hasUI) ctx.ui.notify("Safety guard enabled", "info");
        return;
      }
      if (cmd === "off") {
        enabled = false;
        updateStatus(ctx, enabled);
        if (ctx.hasUI) ctx.ui.notify("Safety guard disabled", "warning");
        return;
      }
      if (cmd === "allow-list") {
        permanentAllow = readAllowStore();
        const lines = [
          "Session allows:",
          ...(sessionAllow.size ? [...sessionAllow.values()].map(formatAllowEntry) : ["(none)"]),
          "",
          `Permanent allows (${ALLOW_STORE_PATH}):`,
          ...(permanentAllow.entries.length ? permanentAllow.entries.map(formatAllowEntry) : ["(none)"]),
        ];
        if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
        return;
      }
      if (cmd === "allow-clear-session") {
        sessionAllow.clear();
        if (ctx.hasUI) ctx.ui.notify("Cleared safety guard session allow-list", "info");
        return;
      }
      if (cmd === "allow-clear-permanent") {
        writeAllowStore({ version: 1, entries: [] });
        permanentAllow = readAllowStore();
        if (ctx.hasUI) ctx.ui.notify("Cleared safety guard permanent allow-list", "info");
        return;
      }
      if (ctx.hasUI) ctx.ui.notify("Usage: /safety-guard on|off|status|allow-list|allow-clear-session|allow-clear-permanent", "warning");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    updateStatus(ctx, enabled);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!enabled) return;
    if (isToolCallEventType("bash", event)) {
      const command = event.input.command ?? "";
      const commandForMatching = stripHeredocBodies(command);
      const shellMatch = DANGEROUS_BASH_RULES.find((entry) => entry.pattern.test(commandForMatching));
      const databaseMatch = DATABASE_RULES.find((entry) => entry.pattern.test(command));
      const match = shellMatch ?? databaseMatch;
      const matchedCommandText = databaseMatch && !shellMatch ? command : commandForMatching;
      if (!match) return;

      const entry = {
        key: allowKey("bash", command, ctx.cwd),
        kind: "bash" as const,
        value: command,
        cwd: normalizeCwd(ctx.cwd),
        label: match.label,
        category: match.category,
      };
      if (isAllowed(entry.key)) return;

      const prompt = formatRuleMessage(match, matchedCommandText, (value) => ctx.ui.theme.fg("warning", value));
      const decision = await confirmOrBlock(ctx, prompt.title, prompt.message, prompt.nonInteractiveReason);
      const scope = allowedScope(decision);
      if (scope) rememberAllow(entry, scope, ctx);
      if (decision && "block" in decision) return decision;
      return;
    }

    if (isToolCallEventType("write", event)) {
      if (!isProtectedPath(event.input.path, ctx.cwd)) return;

      const resolvedPath = path.resolve(ctx.cwd, event.input.path);
      const entry = {
        key: allowKey("write", resolvedPath, ctx.cwd),
        kind: "write" as const,
        value: resolvedPath,
        cwd: normalizeCwd(ctx.cwd),
        label: resolvedPath,
      };
      if (isAllowed(entry.key)) return;

      const decision = await confirmOrBlock(
        ctx,
        "Protected file write",
        `Write to protected path '${event.input.path}'?`,
        `Blocked write to protected path '${event.input.path}' in non-interactive mode`,
      );
      const scope = allowedScope(decision);
      if (scope) rememberAllow(entry, scope, ctx);
      if (decision && "block" in decision) return decision;
      return;
    }

    if (isToolCallEventType("edit", event)) {
      if (!isProtectedPath(event.input.path, ctx.cwd)) return;

      const resolvedPath = path.resolve(ctx.cwd, event.input.path);
      const entry = {
        key: allowKey("edit", resolvedPath, ctx.cwd),
        kind: "edit" as const,
        value: resolvedPath,
        cwd: normalizeCwd(ctx.cwd),
        label: resolvedPath,
      };
      if (isAllowed(entry.key)) return;

      const decision = await confirmOrBlock(
        ctx,
        "Protected file edit",
        `Edit protected path '${event.input.path}'?`,
        `Blocked edit to protected path '${event.input.path}' in non-interactive mode`,
      );
      const scope = allowedScope(decision);
      if (scope) rememberAllow(entry, scope, ctx);
      if (decision && "block" in decision) return decision;
      return;
    }
  });
}
