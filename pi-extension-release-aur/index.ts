import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { appendDisplayChunk, appendRunLog, createRunLog as createSharedRunLog, escapeRegExp, formatElapsed, isCtrlC, isCtrlO, listRunLogs, outputLinesFromDisplay, resolveUserPath, saveRunLog as saveSharedRunLog, shellQuote, stripAnsi, truncateLine, type RunLog, type RunLogEntry } from "@firstpick/pi-utils";

const STATUS_KEY = "release-aur";
const OUTPUT_WIDGET_KEY = "release-aur:output";
const FOOTER_WIDGET_KEY = "release-aur:footer";
const LOG_WIDGET_KEY = "release-aur:logs";
const SETUP_WIDGET_KEY = "release-aur:setup";
const COLLAPSED_LINES = 36;
const EXPANDED_LINES = 160;
const LOG_RENDER_LIMIT = 240;
const OUTPUT_RENDER_INTERVAL_MS = 80;
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_RESOURCE_DIR = join(EXTENSION_DIR, "node_modules", "@firstpick", "pi-extension-release-aur");
const LOG_DIR = join(homedir(), ".pi", "agent", "release-aur-logs");
const CONFIG_DIR = join(homedir(), ".pi", "agent", "release-aur");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const AUR_HOST = "aur.archlinux.org";
const AUR_USER = "aur";
const DEFAULT_AUR_KEY = join(homedir(), ".ssh", "aur");
const MANAGED_AUR_CONFIG_BEGIN = "# >>> pi release-aur setup: aur.archlinux.org";
const MANAGED_AUR_CONFIG_END = "# <<< pi release-aur setup: aur.archlinux.org";

type RunResult = { ok: boolean; output: string; aborted: boolean };
type AbortableChild = ChildProcessByStdio<null, Readable, Readable> & { abortReleaseStep?: () => void };
type ReleaseRunLog = RunLog;
type LogEntry = RunLogEntry;
type ReleaseAurConfig = {
  aurReposDir?: string;
  releaseSource?: string;
  packageReleaseSources?: Record<string, string>;
};
type Action = "plan" | "publish" | "create" | "logs" | "abort" | "toggle" | "help";
type ParsedArgs = { action: Action; target?: string; pkgbase?: string; flags: string[]; noAgentReview: boolean; pushAfterCreate: boolean };

type ActiveRun = { abort: () => void; toggleOutput: () => void };
let activeRun: ActiveRun | undefined;
let activeLogViewerCleanup: (() => void) | undefined;
let setupWidgetGeneration = 0;

function createRunLog(cwd: string): ReleaseRunLog {
  return createSharedRunLog(cwd);
}

function appendLog(runLog: ReleaseRunLog, chunk: string): void {
  appendRunLog(runLog, chunk);
}

function saveRunLog(runLog: ReleaseRunLog, status: string, summary?: string): string | undefined {
  return saveSharedRunLog(runLog, { logDir: LOG_DIR, title: "release-aur log", status, summary });
}

function listLogs(): LogEntry[] {
  return listRunLogs(LOG_DIR);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function normalizeConfigString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeReleaseSourceInput(value: unknown): string | undefined {
  const trimmed = normalizeConfigString(value);
  if (!trimmed || /[\r\n\t]/.test(trimmed)) return undefined;
  return trimmed;
}

function normalizePackageKeyInput(value: unknown): string | undefined {
  const trimmed = normalizeConfigString(value);
  if (!trimmed || /\s/.test(trimmed)) return undefined;
  return trimmed;
}

function normalizePackageSourceMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, source]) => [normalizePackageKeyInput(key), normalizeReleaseSourceInput(source)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1]));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function readReleaseAurConfig(): ReleaseAurConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<ReleaseAurConfig>;
    const config: ReleaseAurConfig = {};
    const aurReposDir = normalizeConfigString(parsed.aurReposDir);
    const releaseSource = normalizeReleaseSourceInput(parsed.releaseSource);
    const packageReleaseSources = normalizePackageSourceMap(parsed.packageReleaseSources);
    if (aurReposDir) config.aurReposDir = aurReposDir;
    if (releaseSource) config.releaseSource = releaseSource;
    if (packageReleaseSources) config.packageReleaseSources = packageReleaseSources;
    return config;
  } catch {
    return {};
  }
}

function writeReleaseAurConfig(config: ReleaseAurConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function configuredAurReposDir(): string | undefined {
  return readReleaseAurConfig().aurReposDir;
}

function releaseRoot(cwd: string): { root: string; source: "configured" | "cwd"; warning?: string } {
  const configured = configuredAurReposDir();
  if (!configured) return { root: cwd, source: "cwd" };
  if (isDirectory(configured)) return { root: configured, source: "configured" };
  return {
    root: cwd,
    source: "cwd",
    warning: `Configured AUR repos directory is not usable: ${configured}. Falling back to current directory. Run /release-aur-setup dir to update it.`,
  };
}

function extensionResourcePath(...parts: string[]): string {
  const candidates = [
    join(EXTENSION_DIR, ...parts),
    join(PACKAGE_RESOURCE_DIR, ...parts),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[candidates.length - 1];
}

function packageReleaseSourcesEnv(config: ReleaseAurConfig): string | undefined {
  const entries = Object.entries(config.packageReleaseSources ?? {});
  return entries.length ? entries.map(([pkgbase, source]) => `${pkgbase}\t${source}`).join("\n") : undefined;
}

function scriptCommand(cwd: string, args: string[]): string {
  const localCandidates = [join(cwd, "dev", "scripts", "aur-release-workflow.sh"), join(cwd, "aur-release-workflow.sh")];
  const scriptPath = localCandidates.find((candidate) => existsSync(candidate)) ?? extensionResourcePath("aur-release-workflow.sh");
  const config = readReleaseAurConfig();
  const packageSources = packageReleaseSourcesEnv(config);
  return [
    `PI_AUR_PACKAGES_ROOT=${shellQuote(cwd)}`,
    `PI_AUR_RELEASE_SOURCE=${shellQuote(config.releaseSource ?? "auto")}`,
    ...(packageSources ? [`PI_AUR_PACKAGE_RELEASE_SOURCES=${shellQuote(packageSources)}`] : []),
    "bash",
    shellQuote(scriptPath),
    ...args.map(shellQuote),
  ].join(" ");
}

async function runScriptLive(
  cwd: string,
  command: string,
  onChunk: (chunk: string) => void,
  onChild?: (child: AbortableChild) => void,
): Promise<RunResult> {
  return await new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], { cwd, stdio: ["ignore", "pipe", "pipe"], detached: true }) as AbortableChild;
    let output = "";
    let aborted = false;

    child.abortReleaseStep = () => {
      aborted = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGINT");
      } catch {
        child.kill("SIGINT");
      }
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            if (child.pid) process.kill(-child.pid, "SIGTERM");
          } catch {
            child.kill("SIGTERM");
          }
        }
      }, 1500).unref();
    };

    onChild?.(child);
    child.stdout.on("data", (d) => {
      const chunk = String(d);
      output += chunk;
      onChunk(chunk);
    });
    child.stderr.on("data", (d) => {
      const chunk = String(d);
      output += chunk;
      onChunk(chunk);
    });
    child.on("close", (code) => resolve({ ok: code === 0 && !aborted, output, aborted }));
  });
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    if (match[1] !== undefined) tokens.push(match[1].replace(/\\"/g, '"'));
    else if (match[2] !== undefined) tokens.push(match[2]);
    else tokens.push(match[0]);
  }
  return tokens;
}

function withDefaultReleaseUpdate(flags: string[]): string[] {
  return ["--update-release", ...flags];
}

function parseArgs(raw: string): ParsedArgs {
  const tokens = tokenize(raw.trim());
  const actions = new Set<Action>(["plan", "publish", "create", "logs", "abort", "toggle", "help"]);
  let action: Action = "plan";
  let index = 0;
  if (tokens[0] && actions.has(tokens[0] as Action)) {
    action = tokens[0] as Action;
    index = 1;
  }

  const flags: string[] = [];
  let target: string | undefined;
  let pkgbase: string | undefined;
  let noAgentReview = false;
  let pushAfterCreate = false;

  while (index < tokens.length) {
    const token = tokens[index++];
    if (!token) continue;
    if (token === "--no-agent-review") {
      noAgentReview = true;
      continue;
    }
    if (action === "create" && (token === "--push" || token === "--publish")) {
      pushAfterCreate = true;
      continue;
    }
    if (token === "--pkgbase") {
      pkgbase = tokens[index++];
      continue;
    }
    if (token === "--target") {
      target = tokens[index++];
      continue;
    }
    if (token === "--release-source" || token === "--package-release-source") {
      flags.push(token, tokens[index++] ?? "");
      continue;
    }
    if (token.startsWith("--")) {
      flags.push(token);
      continue;
    }
    if (action === "create" && !pkgbase) {
      pkgbase = token;
      continue;
    }
    if (!target) {
      target = token;
      continue;
    }
    flags.push(token);
  }

  return { action, target, pkgbase, flags, noAgentReview, pushAfterCreate };
}

function discoverTargets(cwd: string): string[] {
  if (existsSync(join(cwd, "PKGBUILD"))) return ["."];
  try {
    return readdirSync(cwd, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(cwd, entry.name, "PKGBUILD")))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function resolveTarget(ctx: ExtensionCommandContext, parsed: ParsedArgs, rootDir: string): Promise<string> {
  if (parsed.target) return parsed.target;
  const targets = discoverTargets(rootDir);
  if (targets.length === 0) return "auto";
  if (targets.length === 1) return targets[0];
  if (!ctx.hasUI) return "all";
  const choice = await ctx.ui.select(`Select AUR package target in ${userPath(rootDir)}`, [...targets, "all", "Cancel"]);
  if (!choice || choice === "Cancel") return "__cancelled__";
  return choice;
}

function extractSummary(output: string): string {
  const lines = stripAnsi(output).split(/\r?\n/);
  const starts = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.trim() === "AUR release summary:");
  if (starts.length === 0) return lines.slice(-60).join("\n");
  const start = starts[starts.length - 1].index;
  return lines.slice(start, Math.min(lines.length, start + 80)).join("\n").trim();
}

function truncateForPrompt(output: string, maxChars = 22000): string {
  if (output.length <= maxChars) return output;
  return `${output.slice(0, 4000)}\n\n[... middle omitted: ${output.length - maxChars} chars ...]\n\n${output.slice(-(maxChars - 4000))}`;
}

function queueAgentReview(pi: ExtensionAPI, cwd: string, target: string, output: string): void {
  const prompt = [
    "Review this AUR package release plan before any commit or push.",
    "",
    "Expected review:",
    "- Inspect the package files and git diff if needed.",
    "- Verify PKGBUILD/.SRCINFO consistency, source/checksum handling, direct dependencies, pkgver/pkgrel policy, VCS package policy, namcap errors, and whether build artifacts or secrets could be staged.",
    "- Return GO or NO-GO. If GO, include the exact publish command to run. If NO-GO, list blocking fixes.",
    "- Do not push; publishing must only happen through /release-aur publish after explicit user confirmation.",
    "",
    `cwd: ${cwd}`,
    `target: ${target}`,
    "",
    "Preflight output:",
    "```text",
    truncateForPrompt(output),
    "```",
  ].join("\n");
  pi.sendUserMessage(prompt, { deliverAs: "followUp" });
}

function queueFailureReview(pi: ExtensionAPI, step: string, output: string): void {
  pi.sendUserMessage([
    `AUR release step failed: ${step}.`,
    "Analyze the failure and provide root cause, exact safe fix steps, and safe rerun command order.",
    "",
    "Failure output:",
    "```text",
    truncateForPrompt(output, 16000),
    "```",
  ].join("\n"), { deliverAs: "followUp" });
}

function pkgbuildQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseGitHubRepo(input: string): { owner: string; repo: string; url: string } | undefined {
  const raw = input.trim().replace(/\.git$/, "").replace(/\/$/, "");
  try {
    const url = new URL(raw);
    if (url.hostname !== "github.com") return undefined;
    const [owner, repo] = url.pathname.replace(/^\//, "").split("/");
    if (!owner || !repo) return undefined;
    return { owner, repo, url: `https://github.com/${owner}/${repo}` };
  } catch {
    const match = raw.match(/^github\.com\/([^/]+)\/([^/]+)$/);
    if (!match) return undefined;
    return { owner: match[1], repo: match[2], url: `https://github.com/${match[1]}/${match[2]}` };
  }
}

function pkgbaseFromPkgbuild(pkgDir: string): string | undefined {
  const pkgbuild = join(pkgDir, "PKGBUILD");
  if (!existsSync(pkgbuild)) return undefined;
  const content = readFileSync(pkgbuild, "utf8");
  const match = content.match(/^\s*pkgbase\s*=\s*['"]?([^'"\s]+)['"]?/m)
    ?? content.match(/^\s*pkgname\s*=\s*['"]?([^'"\s(]+)['"]?/m);
  return match?.[1];
}

function defaultBinaryName(pkgbase: string): string {
  return pkgbase.replace(/^(python|rust|go)-/, "");
}

function templatePkgbuild(kind: "python" | "rust" | "go", input: {
  pkgbase: string;
  repoUrl: string;
  repoName: string;
  pkgver: string;
  pkgdesc: string;
  license: string;
  binaryName: string;
}): string {
  const templatePath = extensionResourcePath("templates", "pkgbuild", `${kind}.PKGBUILD.tmpl`);
  const template = readFileSync(templatePath, "utf8");
  const replacements: Record<string, string> = {
    __PKGBASE__: input.pkgbase,
    __PKGVER__: input.pkgver,
    __PKGDESC_QUOTED__: pkgbuildQuote(input.pkgdesc),
    __URL_QUOTED__: pkgbuildQuote(input.repoUrl),
    __LICENSE_QUOTED__: pkgbuildQuote(input.license),
    __REPO_NAME_QUOTED__: pkgbuildQuote(input.repoName),
    __BINARY_NAME_QUOTED__: pkgbuildQuote(input.binaryName),
  };

  let rendered = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(placeholder, value);
  }

  return rendered.endsWith("\n") ? rendered : `${rendered}\n`;
}

async function refreshChecksums(pkgDir: string, runLog: ReleaseRunLog): Promise<void> {
  if (!existsSync(join(pkgDir, "PKGBUILD"))) return;
  appendLog(runLog, "\n$ updpkgsums # template checksum refresh\n");
  const command = "if command -v updpkgsums >/dev/null 2>&1; then updpkgsums; else echo 'WARN: updpkgsums not installed; install pacman-contrib and replace SKIP checksums before publishing'; exit 0; fi";
  const result = await runScriptLive(pkgDir, command, (chunk) => appendLog(runLog, chunk));
  if (!result.ok) appendLog(runLog, "WARN: updpkgsums failed; release plan should block until checksums are fixed.\n");
}

async function promptMissingPkgbuild(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  rootDir: string,
  pkgbase: string,
  runLog: ReleaseRunLog,
): Promise<"continue" | "stop"> {
  const pkgDir = resolve(rootDir, pkgbase);
  if (!ctx.hasUI) {
    ctx.ui.notify(`AUR repo for ${pkgbase} has no PKGBUILD. Add one, then rerun /release-aur create ${pkgbase}.`, "warning");
    return "stop";
  }

  const choice = await ctx.ui.select(`PKGBUILD missing for ${pkgbase}. What should happen next?`, [
    "Yes, let Agent create it.",
    "Yes, add it from: /Path/to/file",
    "No, but create a template PKGBUILD.",
    "No, I will add it later.",
  ]);

  if (choice === "Yes, let Agent create it.") {
    appendLog(runLog, "\n--- missing PKGBUILD decision: let agent create it ---\n");
    pi.sendUserMessage([
      `The AUR package repo for ${pkgbase} exists at ${pkgDir}, but PKGBUILD is missing.`,
      "Please create a correct PKGBUILD for this package.",
      "Use Arch packaging best practices: direct dependencies, correct pkgver/pkgrel, real checksums for release tarballs, license install, and no build artifacts.",
      `After writing PKGBUILD, run /release-aur create ${pkgbase} to regenerate .SRCINFO and continue checks.`,
    ].join("\n"), { deliverAs: "followUp" });
    ctx.ui.notify("Queued an agent request to create PKGBUILD.", "info");
    return "stop";
  }

  if (choice === "Yes, add it from: /Path/to/file") {
    const input = await ctx.ui.input("Path to PKGBUILD", "~/path/to/PKGBUILD");
    if (!input?.trim()) {
      ctx.ui.notify("No PKGBUILD path entered; stopping create flow.", "warning");
      return "stop";
    }
    const sourcePath = resolveUserPath(input, ctx.cwd);
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      ctx.ui.notify(`PKGBUILD source does not exist or is not a file: ${sourcePath}`, "error");
      appendLog(runLog, `\nERROR: PKGBUILD source invalid: ${sourcePath}\n`);
      return "stop";
    }
    mkdirSync(pkgDir, { recursive: true });
    copyFileSync(sourcePath, join(pkgDir, "PKGBUILD"));
    appendLog(runLog, `\n--- copied PKGBUILD from ${sourcePath} ---\n`);
    ctx.ui.notify(`Copied PKGBUILD from ${sourcePath}.`, "info");
    return "continue";
  }

  if (choice === "No, but create a template PKGBUILD.") {
    const templateChoices = {
      "Python — PEP 517 wheel from GitHub release tag": "python",
      "Rust — cargo release build from GitHub release tag": "rust",
      "Go — go build from GitHub release tag": "go",
    } as const;
    const kindChoice = await ctx.ui.select("Choose PKGBUILD template", [...Object.keys(templateChoices), "Cancel"]);
    if (!kindChoice || kindChoice === "Cancel") return "stop";
    const kind = templateChoices[kindChoice as keyof typeof templateChoices];

    const repoInput = await ctx.ui.input("GitHub repository URL", "https://github.com/owner/repo");
    const repo = repoInput ? parseGitHubRepo(repoInput) : undefined;
    if (!repo) {
      ctx.ui.notify("Template creation requires a GitHub repository URL like https://github.com/owner/repo.", "error");
      return "stop";
    }

    const pkgver = (await ctx.ui.input("pkgver", "0.1.0"))?.trim() || "0.1.0";
    const defaultDesc = `${kind} package from ${repo.owner}/${repo.repo}`;
    const pkgdesc = (await ctx.ui.input("pkgdesc", defaultDesc))?.trim() || defaultDesc;
    const license = (await ctx.ui.input("license", "MIT"))?.trim() || "MIT";
    const binaryName = kind === "python"
      ? defaultBinaryName(pkgbase)
      : ((await ctx.ui.input("binary name", defaultBinaryName(pkgbase)))?.trim() || defaultBinaryName(pkgbase));

    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "PKGBUILD"), templatePkgbuild(kind, {
      pkgbase,
      repoUrl: repo.url,
      repoName: repo.repo,
      pkgver,
      pkgdesc,
      license,
      binaryName,
    }), "utf8");
    appendLog(runLog, `\n--- wrote ${kind} GitHub template PKGBUILD for ${repo.url} ---\n`);
    ctx.ui.notify(`Wrote ${kind} template PKGBUILD for ${repo.url}. Running updpkgsums if available...`, "info");
    await refreshChecksums(pkgDir, runLog);
    return "continue";
  }

  appendLog(runLog, "\n--- missing PKGBUILD decision: user will add later ---\n");
  ctx.ui.notify(`AUR repo created. Add ${join(pkgDir, "PKGBUILD")}, then rerun /release-aur create ${pkgbase}.`, "info");
  return "stop";
}

function userPath(value: string): string {
  const home = homedir();
  return value === home ? "~" : value.startsWith(`${home}/`) ? `~/${value.slice(home.length + 1)}` : value;
}

function sshConfigIdentityPath(keyPath: string): string {
  return userPath(keyPath);
}

function managedAurSshConfigBlock(keyPath: string): string {
  return [
    MANAGED_AUR_CONFIG_BEGIN,
    `Host ${AUR_HOST}`,
    `    User ${AUR_USER}`,
    `    IdentityFile ${sshConfigIdentityPath(keyPath)}`,
    "    IdentitiesOnly yes",
    MANAGED_AUR_CONFIG_END,
    "",
  ].join("\n");
}

function findAurHostBlock(lines: string[]): { start: number; end: number } | undefined {
  for (let i = 0; i < lines.length; i++) {
    const withoutComment = lines[i].replace(/#.*/, "").trim();
    if (!/^Host\s+/i.test(withoutComment)) continue;
    const patterns = withoutComment.split(/\s+/).slice(1);
    if (!patterns.includes(AUR_HOST)) continue;

    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*(Host|Match)\s+/i.test(lines[j])) {
        end = j;
        break;
      }
    }
    return { start: i, end };
  }
  return undefined;
}

function patchAurHostBlock(content: string, keyPath: string): string | undefined {
  const lines = content.split(/\r?\n/);
  const block = findAurHostBlock(lines);
  if (!block) return undefined;

  const desired = [
    "    # Managed by /release-aur-setup for AUR publishing",
    `    User ${AUR_USER}`,
    `    IdentityFile ${sshConfigIdentityPath(keyPath)}`,
    "    IdentitiesOnly yes",
  ];
  const rest = lines.slice(block.start + 1, block.end).filter((line) => {
    const token = line.replace(/#.*/, "").trim().split(/\s+/)[0]?.toLowerCase();
    return token !== "user" && token !== "identityfile" && token !== "identitiesonly";
  });
  const next = [
    ...lines.slice(0, block.start + 1),
    ...desired,
    ...rest,
    ...lines.slice(block.end),
  ].join("\n");
  return next.endsWith("\n") ? next : `${next}\n`;
}

function upsertManagedAurSshConfig(content: string, keyPath: string): string {
  const block = managedAurSshConfigBlock(keyPath);
  const re = new RegExp(`${escapeRegExp(MANAGED_AUR_CONFIG_BEGIN)}[\\s\\S]*?${escapeRegExp(MANAGED_AUR_CONFIG_END)}\\n?`, "m");
  if (re.test(content)) return content.replace(re, block);
  const trimmed = content.trimEnd();
  return `${trimmed}${trimmed ? "\n\n" : ""}${block}`;
}

function hasAurHostBlock(content: string): boolean {
  return findAurHostBlock(content.split(/\r?\n/)) !== undefined;
}

function ensureSshDirectory(): string {
  const sshDir = join(homedir(), ".ssh");
  mkdirSync(sshDir, { recursive: true });
  chmodSync(sshDir, 0o700);
  return sshDir;
}

function chmodIfExists(path: string, mode: number): void {
  if (!existsSync(path)) return;
  try {
    chmodSync(path, mode);
  } catch {
    // Best-effort; OpenSSH will report permission problems during the test step.
  }
}

function readTextIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function aurReposDirectoryStatusLines(cwd: string): string[] {
  const configured = configuredAurReposDir();
  if (!configured) {
    return [
      `AUR repos directory: not configured (set with /release-aur-setup dir)`,
      `release root fallback: ${userPath(cwd)}`,
    ];
  }

  const ok = isDirectory(configured);
  const targets = ok ? discoverTargets(configured) : [];
  const lines = [
    `AUR repos directory: ${ok ? "present" : "missing/invalid"} (${userPath(configured)})`,
    `AUR package repos found: ${targets.length}`,
  ];
  if (targets.length > 0) {
    lines.push(...targets.slice(0, 20).map((target) => `  - ${target}`));
    if (targets.length > 20) lines.push(`  - ... ${targets.length - 20} more`);
  }
  return lines;
}

function releaseSourceHelpLines(): string[] {
  return [
    "Release source controls the latest-upstream-version check before plan/publish.",
    "Use 'auto' to keep the original behavior: detect a github.com repo from PKGBUILD.",
    "Use 'github:owner/repo' or 'https://github.com/owner/repo' for GitHub releases.",
    "Use 'git:<clone-url>' or any git clone URL for custom upstreams; latest tag wins.",
  ];
}

function releaseSourceStatusLines(): string[] {
  const config = readReleaseAurConfig();
  const packageSources = Object.entries(config.packageReleaseSources ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const lines = [
    `Global release source: ${config.releaseSource ?? "auto (detect github.com from PKGBUILD)"}`,
    `Per-package release sources: ${packageSources.length}`,
  ];
  if (packageSources.length > 0) {
    lines.push(...packageSources.slice(0, 20).map(([pkgbase, source]) => `  - ${pkgbase}: ${source}`));
    if (packageSources.length > 20) lines.push(`  - ... ${packageSources.length - 20} more`);
  }
  return lines;
}

function validateReleaseSourceForUi(input: string): string | undefined {
  const source = normalizeReleaseSourceInput(input);
  if (!source) return undefined;
  return source;
}

async function runAurReposDirSetup(ctx: ExtensionCommandContext, rawPath?: string): Promise<void> {
  let input = rawPath?.trim();
  if (!input) {
    if (!ctx.hasUI) {
      ctx.ui.notify("Usage: /release-aur-setup dir <path-to-aur-repos>", "warning");
      return;
    }
    const current = configuredAurReposDir();
    input = await ctx.ui.input("AUR repos directory", current ? userPath(current) : "~/aur-packages");
  }

  if (!input?.trim()) {
    ctx.ui.notify("AUR repos directory setup cancelled.", "info");
    return;
  }

  const dir = resolveUserPath(input, ctx.cwd);
  if (existsSync(dir) && !isDirectory(dir)) {
    ctx.ui.notify(`AUR repos path exists but is not a directory: ${dir}`, "error");
    return;
  }

  if (!existsSync(dir)) {
    if (!ctx.hasUI) {
      ctx.ui.notify(`AUR repos directory does not exist: ${dir}`, "error");
      return;
    }
    const create = await ctx.ui.confirm("Create AUR repos directory?", dir);
    if (!create) {
      ctx.ui.notify("AUR repos directory setup cancelled.", "info");
      return;
    }
    mkdirSync(dir, { recursive: true });
  }

  writeReleaseAurConfig({ ...readReleaseAurConfig(), aurReposDir: dir });
  const targets = discoverTargets(dir);
  const widgetGeneration = showSetupWidget(ctx, "AUR repos directory", [
    `Configured: ${userPath(dir)}`,
    `Config file: ${userPath(CONFIG_PATH)}`,
    `Package repos found: ${targets.length}`,
    ...targets.slice(0, 20).map((target) => `  - ${target}`),
    ...(targets.length > 20 ? [`  - ... ${targets.length - 20} more`] : []),
    "",
    "Bare /release-aur now uses this directory to list package repos and prompt for a target.",
  ]);
  ctx.ui.notify(`AUR repos directory saved: ${userPath(dir)} (${targets.length} package repo${targets.length === 1 ? "" : "s"} found).`, "info");
  clearSetupWidget(ctx, widgetGeneration, 8000);
}

async function runGlobalReleaseSourceSetup(ctx: ExtensionCommandContext, rawSource?: string): Promise<void> {
  let input = rawSource?.trim();
  const current = readReleaseAurConfig().releaseSource ?? "auto";
  if (!input) {
    if (!ctx.hasUI) {
      ctx.ui.notify("Usage: /release-aur-setup source global <auto|github:owner/repo|git:clone-url>", "warning");
      return;
    }
    input = await ctx.ui.input("Global upstream release source", current);
  }

  if (!input?.trim()) {
    ctx.ui.notify("Release source setup cancelled.", "info");
    return;
  }

  const source = validateReleaseSourceForUi(input);
  if (!source) {
    ctx.ui.notify("Release source must be a single-line value without tabs. Examples: auto, github:owner/repo, git:https://example/repo.git", "error");
    return;
  }

  writeReleaseAurConfig({ ...readReleaseAurConfig(), releaseSource: source });
  const widgetGeneration = showSetupWidget(ctx, "Global release source", [
    `Configured: ${source}`,
    `Config file: ${userPath(CONFIG_PATH)}`,
    "",
    ...releaseSourceHelpLines(),
  ]);
  ctx.ui.notify(`Global release source saved: ${source}`, "info");
  clearSetupWidget(ctx, widgetGeneration, 8000);
}

async function choosePackageForReleaseSource(ctx: ExtensionCommandContext): Promise<string | undefined> {
  const root = releaseRoot(ctx.cwd).root;
  const targets = discoverTargets(root);
  const packageChoices = targets.map((target) => {
    if (target === ".") return pkgbaseFromPkgbuild(root) ?? resolve(root).split(/[\\/]/).pop() ?? ".";
    return pkgbaseFromPkgbuild(join(root, target)) ?? target;
  });

  if (!ctx.hasUI) return undefined;
  const choice = await ctx.ui.select("Select AUR package for release source override", [
    ...Array.from(new Set(packageChoices)),
    "Enter package name manually",
    "Cancel",
  ]);
  if (!choice || choice === "Cancel") return undefined;
  if (choice !== "Enter package name manually") return choice;
  const input = await ctx.ui.input("AUR package/pkgbase", "pkgbase");
  return normalizePackageKeyInput(input);
}

async function runPackageReleaseSourceSetup(ctx: ExtensionCommandContext, rawPkgbase?: string, rawSource?: string): Promise<void> {
  let pkgbase = normalizePackageKeyInput(rawPkgbase);
  if (!pkgbase) {
    pkgbase = await choosePackageForReleaseSource(ctx);
  }
  if (!pkgbase) {
    ctx.ui.notify("Per-package release source setup cancelled.", "info");
    return;
  }

  let input = rawSource?.trim();
  const config = readReleaseAurConfig();
  const current = config.packageReleaseSources?.[pkgbase] ?? config.releaseSource ?? "auto";
  if (!input) {
    if (!ctx.hasUI) {
      ctx.ui.notify("Usage: /release-aur-setup source package <pkgbase> <auto|github:owner/repo|git:clone-url>", "warning");
      return;
    }
    input = await ctx.ui.input(`Release source for ${pkgbase}`, current);
  }

  if (!input?.trim()) {
    ctx.ui.notify("Per-package release source setup cancelled.", "info");
    return;
  }

  const source = validateReleaseSourceForUi(input);
  if (!source) {
    ctx.ui.notify("Release source must be a single-line value without tabs. Examples: auto, github:owner/repo, git:https://example/repo.git", "error");
    return;
  }

  const nextSources = { ...(config.packageReleaseSources ?? {}), [pkgbase]: source };
  writeReleaseAurConfig({ ...config, packageReleaseSources: nextSources });
  const widgetGeneration = showSetupWidget(ctx, `Release source for ${pkgbase}`, [
    `Configured: ${source}`,
    `Global default: ${config.releaseSource ?? "auto"}`,
    `Config file: ${userPath(CONFIG_PATH)}`,
  ]);
  ctx.ui.notify(`Release source for ${pkgbase} saved: ${source}`, "info");
  clearSetupWidget(ctx, widgetGeneration, 8000);
}

async function clearPackageReleaseSource(ctx: ExtensionCommandContext, rawPkgbase?: string): Promise<void> {
  let pkgbase = normalizePackageKeyInput(rawPkgbase);
  if (!pkgbase) pkgbase = await choosePackageForReleaseSource(ctx);
  if (!pkgbase) {
    ctx.ui.notify("Per-package release source clear cancelled.", "info");
    return;
  }

  const config = readReleaseAurConfig();
  const nextSources = { ...(config.packageReleaseSources ?? {}) };
  delete nextSources[pkgbase];
  const nextConfig: ReleaseAurConfig = { ...config };
  if (Object.keys(nextSources).length) nextConfig.packageReleaseSources = nextSources;
  else delete nextConfig.packageReleaseSources;
  writeReleaseAurConfig(nextConfig);
  const widgetGeneration = showSetupWidget(ctx, `Release source override cleared for ${pkgbase}`, [
    `Now using global default: ${config.releaseSource ?? "auto"}`,
    `Config file: ${userPath(CONFIG_PATH)}`,
  ]);
  ctx.ui.notify(`Release source override cleared for ${pkgbase}.`, "info");
  clearSetupWidget(ctx, widgetGeneration, 8000);
}

async function runReleaseSourceSetup(ctx: ExtensionCommandContext, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand) {
    if (!ctx.hasUI) {
      ctx.ui.notify(setupHelpText(), "info");
      return;
    }
    const choice = await ctx.ui.select("release-aur upstream source setup", [
      "Global default source",
      "Per-package source override",
      "Clear per-package source override",
      "Show source status",
      "Cancel",
    ]);
    if (choice === "Global default source") await runGlobalReleaseSourceSetup(ctx);
    else if (choice === "Per-package source override") await runPackageReleaseSourceSetup(ctx);
    else if (choice === "Clear per-package source override") await clearPackageReleaseSource(ctx);
    else if (choice === "Show source status") showSetupWidget(ctx, "release-aur source status", releaseSourceStatusLines());
    return;
  }

  if (subcommand === "global" || subcommand === "default") {
    await runGlobalReleaseSourceSetup(ctx, rest.join(" "));
    return;
  }
  if (subcommand === "package" || subcommand === "pkg" || subcommand === "pkgbase") {
    const [pkgbase, ...sourceParts] = rest;
    await runPackageReleaseSourceSetup(ctx, pkgbase, sourceParts.join(" "));
    return;
  }
  if (subcommand === "clear" || subcommand === "unset" || subcommand === "remove") {
    await clearPackageReleaseSource(ctx, rest.join(" "));
    return;
  }
  if (subcommand === "status") {
    showSetupWidget(ctx, "release-aur source status", releaseSourceStatusLines());
    ctx.ui.notify(releaseSourceStatusLines().join("\n"), "info");
    return;
  }

  await runGlobalReleaseSourceSetup(ctx, [subcommand, ...rest].join(" "));
}

function aurSshStatusLines(): string[] {
  const sshDir = join(homedir(), ".ssh");
  const configPath = join(sshDir, "config");
  const keyPath = DEFAULT_AUR_KEY;
  const publicKeyPath = `${keyPath}.pub`;
  const config = readTextIfExists(configPath);
  return [
    `ssh dir: ${existsSync(sshDir) ? "present" : "missing"} (${userPath(sshDir)})`,
    `AUR private key: ${existsSync(keyPath) ? "present" : "missing"} (${userPath(keyPath)})`,
    `AUR public key: ${existsSync(publicKeyPath) ? "present" : "missing"} (${userPath(publicKeyPath)})`,
    `ssh config: ${existsSync(configPath) ? "present" : "missing"} (${userPath(configPath)})`,
    `Host ${AUR_HOST} config: ${hasAurHostBlock(config) || config.includes(MANAGED_AUR_CONFIG_BEGIN) ? "present" : "missing"}`,
  ];
}

function showSetupWidget(ctx: ExtensionCommandContext, title: string, lines: string[]): number {
  setupWidgetGeneration += 1;
  if (ctx.hasUI) {
    ctx.ui.setWidget(SETUP_WIDGET_KEY, [title, "", ...lines], { placement: "aboveEditor" });
  }
  return setupWidgetGeneration;
}

function clearSetupWidget(ctx: ExtensionCommandContext, generation?: number, delayMs = 0): void {
  if (!ctx.hasUI) return;
  const clear = () => {
    if (generation !== undefined && generation !== setupWidgetGeneration) return;
    ctx.ui.setWidget(SETUP_WIDGET_KEY, undefined);
  };
  if (delayMs > 0) {
    setTimeout(clear, delayMs);
  } else {
    clear();
  }
}

async function runSetupCommand(
  ctx: ExtensionCommandContext,
  runLog: ReleaseRunLog,
  label: string,
  command: string,
): Promise<RunResult> {
  let currentChild: AbortableChild | undefined;
  appendLog(runLog, `\n$ ${command}\n`);
  if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", `AUR setup: ${label}`));
  activeRun = {
    abort: () => currentChild?.abortReleaseStep?.(),
    toggleOutput: () => ctx.ui.notify("release-aur-setup writes detailed command output to its saved log.", "info"),
  };
  const result = await runScriptLive(ctx.cwd, command, (chunk) => appendLog(runLog, chunk), (child) => { currentChild = child; });
  currentChild = undefined;
  activeRun = undefined;
  return result;
}

function setupHelpText(): string {
  return [
    "Usage:",
    "  /release-aur-setup",
    "  /release-aur-setup dir [path-to-aur-repos]",
    "  /release-aur-setup source [global <source>|package <pkgbase> <source>|clear <pkgbase>|status]",
    "  /release-aur-setup ssh",
    "  /release-aur-setup status",
    "  /release-aur-setup abort",
    "  /release-aur-setup help",
    "",
    "The setup command can save your AUR repos directory. Bare /release-aur then uses that directory to list repos and prompt for the release target.",
    "Release source setup controls latest-upstream-version checks globally and per package. Source examples: auto, github:owner/repo, https://github.com/owner/repo, git:https://example/repo.git.",
    "AUR SSH setup creates ~/.ssh if needed, can create a dedicated ~/.ssh/aur key, configures Host aur.archlinux.org, shows the public key to add to your AUR profile, and tests SSH auth.",
  ].join("\n");
}

function aurSshTestCommand(): string {
  return `ssh -T -o BatchMode=yes -o StrictHostKeyChecking=accept-new ${AUR_HOST}`;
}

function isAurSshSuccess(result: RunResult): boolean {
  const output = stripAnsi(result.output);
  return result.ok || /successfully authenticated|welcome to aur|interactive shell is disabled|shell access is disabled|aur does not provide shell/i.test(output);
}

function aurSshFailureHint(output: string): string {
  if (/Permission denied/i.test(output)) {
    return "AUR rejected the key. Confirm the public key is saved in your AUR profile and the selected key matches ~/.ssh/config.";
  }
  if (/Host key verification failed/i.test(output)) {
    return "Host key verification failed. Review ~/.ssh/known_hosts for aur.archlinux.org.";
  }
  if (/Could not resolve hostname|Name or service not known|Temporary failure in name resolution/i.test(output)) {
    return "DNS/network lookup failed. Check connectivity and DNS before changing AUR keys.";
  }
  return "Review the SSH output log and rerun /release-aur-setup ssh after fixing it.";
}

async function maybeCopyPublicKeyToClipboard(ctx: ExtensionCommandContext, runLog: ReleaseRunLog, publicKeyPath: string): Promise<void> {
  const command = [
    "if command -v wl-copy >/dev/null 2>&1; then wl-copy <", shellQuote(publicKeyPath),
    "; elif command -v xclip >/dev/null 2>&1; then xclip -selection clipboard <", shellQuote(publicKeyPath),
    "; elif command -v xsel >/dev/null 2>&1; then xsel --clipboard --input <", shellQuote(publicKeyPath),
    "; elif command -v pbcopy >/dev/null 2>&1; then pbcopy <", shellQuote(publicKeyPath),
    "; else echo 'No supported clipboard tool found (wl-copy, xclip, xsel, pbcopy).'; exit 127; fi",
  ].join(" ");
  const result = await runSetupCommand(ctx, runLog, "copy-public-key", command);
  ctx.ui.notify(result.ok ? "AUR public key copied to clipboard." : "Could not copy public key; read/copy it from the displayed path instead.", result.ok ? "info" : "warning");
}

async function runAurSshSetup(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify(setupHelpText(), "info");
    return;
  }
  if (activeRun) {
    ctx.ui.notify("A release-aur workflow is already running. Use /release-aur abort first if needed.", "warning");
    return;
  }

  const runLog = createRunLog(ctx.cwd);
  try {
    const confirmed = await ctx.ui.confirm(
      "Set up AUR SSH publishing access?",
      [
        "This follows ArchWiki AUR guidance:",
        `- use SSH for write access to ${AUR_HOST}`,
        "- use a dedicated key pair so it can be revoked independently",
        `- configure Host ${AUR_HOST} with User ${AUR_USER} and IdentityFile ~/.ssh/aur`,
        "",
        "It will edit files under ~/.ssh only after confirmation, including ~/.ssh/config and possibly ~/.ssh/known_hosts during the SSH test. It cannot add the public key to your AUR web profile automatically; it will show/copy the key for you.",
      ].join("\n"),
    );
    if (!confirmed) {
      ctx.ui.notify("AUR SSH setup cancelled.", "info");
      return;
    }

    const tools = await runSetupCommand(ctx, runLog, "check-tools", "missing=0; for c in ssh ssh-keygen git; do if ! command -v \"$c\" >/dev/null 2>&1; then echo \"MISSING:$c\"; missing=1; else echo \"OK:$c=$(command -v \"$c\")\"; fi; done; exit $missing");
    if (!tools.ok) {
      const logPath = saveRunLog(runLog, "setup-missing-tools", stripAnsi(tools.output));
      ctx.ui.notify(`Missing required tools for AUR SSH setup. Install openssh and git, then rerun /release-aur-setup.${logPath ? ` Log: ${logPath}` : ""}`, "error");
      return;
    }

    const existingSshDir = join(homedir(), ".ssh");
    const existingConfigPath = join(existingSshDir, "config");
    const existingConfig = readTextIfExists(existingConfigPath);
    if (hasAurHostBlock(existingConfig)) {
      appendLog(runLog, `\nDetected existing Host ${AUR_HOST} in ${existingConfigPath}; testing before making setup changes.\n`);
      showSetupWidget(ctx, "Existing AUR SSH config detected", [
        `Config: ${userPath(existingConfigPath)}`,
        `Host: ${AUR_HOST}`,
        "Testing existing SSH auth before creating keys or editing config.",
      ]);
      ctx.ui.notify("Existing AUR SSH config detected; testing connection first...", "info");

      while (true) {
        const existingTest = await runSetupCommand(ctx, runLog, "test-existing-ssh", aurSshTestCommand());
        if (isAurSshSuccess(existingTest)) {
          const logPath = saveRunLog(runLog, "setup-existing-ssh-ok", extractSummary(existingTest.output));
          ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("success", "AUR setup:OK"));
          ctx.ui.notify(`Existing AUR SSH setup works. No key/config changes needed.${logPath ? ` Log: ${logPath}` : ""}`, "info");
          return;
        }

        const hint = aurSshFailureHint(stripAnsi(existingTest.output));
        const next = await ctx.ui.select([
          "Existing AUR SSH config was found, but the connection test failed.",
          "",
          hint,
          "",
          "Continue guided setup only if you want Pi to repair/create AUR SSH config.",
        ].join("\n"), ["Retry SSH test", "Continue guided setup", "Stop and inspect log"]);
        if (next === "Retry SSH test") continue;
        if (next !== "Continue guided setup") {
          const logPath = saveRunLog(runLog, "setup-existing-ssh-failed", extractSummary(existingTest.output));
          ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "AUR setup:Failed"));
          ctx.ui.notify(`Existing AUR SSH test failed. ${hint}${logPath ? ` Log: ${logPath}` : ""}`, "error");
          return;
        }
        appendLog(runLog, "\nUser chose to continue guided setup after existing AUR SSH test failed.\n");
        break;
      }
    }

    const sshDir = ensureSshDirectory();
    const configPath = join(sshDir, "config");
    let keyPath = DEFAULT_AUR_KEY;
    let privateKeyExists = existsSync(keyPath);
    let publicKeyExists = existsSync(`${keyPath}.pub`);

    if (!privateKeyExists) {
      const keyChoice = await ctx.ui.select("No dedicated AUR SSH key found at ~/.ssh/aur", [
        "Generate ~/.ssh/aur automatically (ed25519, empty passphrase)",
        "Use an existing key path",
        "Show manual passphrase command and stop",
        "Cancel",
      ]);
      if (!keyChoice || keyChoice === "Cancel") {
        ctx.ui.notify("AUR SSH setup cancelled before key creation.", "info");
        return;
      }
      if (keyChoice === "Show manual passphrase command and stop") {
        const manual = [
          "Run this in a normal shell so ssh-keygen can ask for a passphrase:",
          "",
          "ssh-keygen -t ed25519 -f ~/.ssh/aur -C \"$(whoami)@$(uname -n)-aur-$(date -I)\"",
          "",
          "Then rerun /release-aur-setup ssh.",
        ];
        showSetupWidget(ctx, "Manual AUR SSH key creation", manual);
        const logPath = saveRunLog(runLog, "setup-manual-key-needed", manual.join(" | "));
        ctx.ui.notify(`Manual key command shown.${logPath ? ` Log: ${logPath}` : ""}`, "info");
        return;
      }
      if (keyChoice === "Use an existing key path") {
        const input = await ctx.ui.input("Existing private key path", "~/.ssh/id_ed25519");
        if (!input?.trim()) {
          ctx.ui.notify("No key path entered; setup stopped.", "warning");
          return;
        }
        keyPath = resolveUserPath(input, ctx.cwd);
        privateKeyExists = existsSync(keyPath);
        publicKeyExists = existsSync(`${keyPath}.pub`);
        if (!privateKeyExists) {
          ctx.ui.notify(`Private key does not exist: ${keyPath}`, "error");
          return;
        }
      } else {
        const unsafeOk = await ctx.ui.confirm(
          "Generate automated AUR key without passphrase?",
          [
            "This creates a dedicated Ed25519 key at ~/.ssh/aur with an empty passphrase so the setup can be fully automated.",
            "ArchWiki warns that private keys without passphrases are stored unencrypted; choose the manual option if you want a passphrase.",
          ].join("\n"),
        );
        if (!unsafeOk) {
          ctx.ui.notify("AUR key generation cancelled.", "info");
          return;
        }
        const comment = `${process.env.USER ?? "user"}@${hostname()}-aur-${new Date().toISOString().slice(0, 10)}`;
        const generated = await runSetupCommand(ctx, runLog, "generate-key", `ssh-keygen -t ed25519 -f ${shellQuote(keyPath)} -C ${shellQuote(comment)} -N ''`);
        if (!generated.ok) {
          const logPath = saveRunLog(runLog, "setup-keygen-failed", stripAnsi(generated.output));
          ctx.ui.notify(`ssh-keygen failed.${logPath ? ` Log: ${logPath}` : ""}`, "error");
          return;
        }
        privateKeyExists = true;
        publicKeyExists = existsSync(`${keyPath}.pub`);
      }
    }

    chmodIfExists(keyPath, 0o600);
    if (!publicKeyExists && privateKeyExists) {
      const regen = await ctx.ui.confirm("Public key file missing", `Generate ${userPath(`${keyPath}.pub`)} from ${userPath(keyPath)}?`);
      if (!regen) {
        ctx.ui.notify("AUR SSH setup stopped because the public key file is missing.", "warning");
        return;
      }
      const pub = await runSetupCommand(ctx, runLog, "derive-public-key", `ssh-keygen -y -f ${shellQuote(keyPath)} > ${shellQuote(`${keyPath}.pub`)}`);
      if (!pub.ok) {
        const logPath = saveRunLog(runLog, "setup-public-key-failed", stripAnsi(pub.output));
        ctx.ui.notify(`Could not derive public key. If the key has a passphrase, run ssh-keygen manually in a terminal.${logPath ? ` Log: ${logPath}` : ""}`, "error");
        return;
      }
    }
    chmodIfExists(`${keyPath}.pub`, 0o644);

    const configBefore = readTextIfExists(configPath);
    let configAfter = configBefore;
    if (configBefore.includes(MANAGED_AUR_CONFIG_BEGIN)) {
      configAfter = upsertManagedAurSshConfig(configBefore, keyPath);
    } else if (hasAurHostBlock(configBefore)) {
      const editExisting = await ctx.ui.confirm(
        `Existing Host ${AUR_HOST} SSH config found`,
        [
          `Update that existing block to use User ${AUR_USER}, IdentityFile ${sshConfigIdentityPath(keyPath)}, and IdentitiesOnly yes?`,
          "Choose No if you manage this host manually; setup will continue with your existing SSH config.",
        ].join("\n"),
      );
      if (editExisting) configAfter = patchAurHostBlock(configBefore, keyPath) ?? configBefore;
    } else {
      configAfter = upsertManagedAurSshConfig(configBefore, keyPath);
    }
    if (configAfter !== configBefore) {
      writeFileSync(configPath, configAfter, "utf8");
      appendLog(runLog, `\nUpdated SSH config: ${configPath}\n`);
    } else {
      appendLog(runLog, "\nSSH config unchanged.\n");
    }
    chmodIfExists(configPath, 0o600);

    const publicKeyPath = `${keyPath}.pub`;
    const publicKey = readFileSync(publicKeyPath, "utf8").trim();
    showSetupWidget(ctx, "AUR public key — add this to your AUR account", [
      `File: ${userPath(publicKeyPath)}`,
      "AUR: My Account → SSH Public Key",
      "",
      publicKey,
    ]);

    while (true) {
      const next = await ctx.ui.select("Add the public key to your AUR account, then test SSH", [
        "I added it to AUR; test SSH now",
        "Copy public key to clipboard",
        "Stop; I will add it later",
      ]);
      if (next === "Copy public key to clipboard") {
        await maybeCopyPublicKeyToClipboard(ctx, runLog, publicKeyPath);
        continue;
      }
      if (next !== "I added it to AUR; test SSH now") {
        const logPath = saveRunLog(runLog, "setup-needs-aur-profile-key", `Public key: ${publicKeyPath}`);
        ctx.ui.notify(`Local AUR SSH setup is ready. Add ${userPath(publicKeyPath)} to your AUR profile, then rerun /release-aur-setup ssh to test.${logPath ? ` Log: ${logPath}` : ""}`, "info");
        return;
      }
      break;
    }

    const test = await runSetupCommand(ctx, runLog, "test-ssh", aurSshTestCommand());
    const logPath = saveRunLog(runLog, isAurSshSuccess(test) ? "setup-ssh-ok" : "setup-ssh-failed", extractSummary(test.output));
    if (isAurSshSuccess(test)) {
      ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("success", "AUR setup:OK"));
      ctx.ui.notify(`AUR SSH setup completed. You can now use /release-aur create or /release-aur publish.${logPath ? ` Log: ${logPath}` : ""}`, "info");
    } else {
      const hint = aurSshFailureHint(stripAnsi(test.output));
      ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "AUR setup:Failed"));
      ctx.ui.notify(`AUR SSH test failed. ${hint}${logPath ? ` Log: ${logPath}` : ""}`, "error");
    }
  } catch (error) {
    activeRun = undefined;
    const message = error instanceof Error ? error.message : String(error);
    const logPath = saveRunLog(runLog, "setup-crashed", message);
    ctx.ui.notify(`release-aur setup crashed: ${message}${logPath ? ` Log: ${logPath}` : ""}`, "error");
  } finally {
    activeRun = undefined;
    if (ctx.hasUI) ctx.ui.setWorkingMessage();
  }
}

async function runAurSetupStatus(ctx: ExtensionCommandContext): Promise<void> {
  if (activeRun) {
    ctx.ui.notify("A release-aur setup/release process is already running. Use /release-aur-setup abort first if needed.", "warning");
    return;
  }

  const runLog = createRunLog(ctx.cwd);
  const lines = [...aurReposDirectoryStatusLines(ctx.cwd), "", ...releaseSourceStatusLines(), "", ...aurSshStatusLines()];
  appendLog(runLog, "release-aur setup status\n\n--- local status ---\n");
  appendLog(runLog, `${lines.join("\n")}\n`);
  showSetupWidget(ctx, "release-aur setup status", [...lines, "", "AUR SSH connection: checking..."]);

  const test = await runSetupCommand(ctx, runLog, "status-test-ssh", aurSshTestCommand());
  const ok = isAurSshSuccess(test);
  const summary = extractSummary(test.output);
  const finalLines = [
    ...lines,
    "",
    `AUR SSH connection: ${ok ? "ok" : "failed"}`,
    ok ? "Existing SSH authentication can reach AUR." : aurSshFailureHint(stripAnsi(test.output)),
  ];
  showSetupWidget(ctx, "release-aur setup status", finalLines);
  const logPath = saveRunLog(runLog, ok ? "status-ssh-ok" : "status-ssh-failed", summary);

  if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(ok ? "success" : "error", ok ? "AUR setup:OK" : "AUR setup:Failed"));
  ctx.ui.notify(`${finalLines.join("\n")}${logPath ? `\nLog: ${logPath}` : ""}`, ok ? "info" : "error");
}

function helpText(): string {
  return [
    "Usage:",
    "  /release-aur [plan] [target|all] [--chroot] [--repro] [--no-update-release] [--no-agent-review]",
    "  /release-aur publish [target|all] [--chroot] [--repro] [--no-update-release]",
    "  /release-aur create <pkgbase> [--push] [--chroot] [--repro] [--no-update-release] [--no-agent-review]",
    "  /release-aur logs",
    "  /release-aur abort",
    "  /release-aur toggle",
    "  /release-aur-setup [dir|source|ssh|status|abort|help]",
    "",
    "Default action is plan. If /release-aur-setup dir configured an AUR repos directory, plan/publish/create use that root for target discovery; otherwise they use the current directory. Before checks, release commands check configured upstream release sources; auto detects GitHub from PKGBUILD, while setup can define a global source and per-package overrides. When newer, they bump pkgver, reset pkgrel=1, run updpkgsums, and regenerate .SRCINFO. Use --no-update-release to skip that step. Plan then runs checks in a temporary copy and queues an agent GO/NO-GO review. Use /release-aur-setup for AUR repos directory, release source, and SSH publishing prerequisites. Create converges empty/non-git/already-git package dirs into an AUR repo, then plans by default. Create --push continues through publish after explicit confirmation. Publish re-runs checks, regenerates .SRCINFO, commits, and pushes only after explicit confirmation.",
  ].join("\n");
}

async function showLogs(ctx: ExtensionCommandContext): Promise<void> {
  const logs = listLogs();
  if (logs.length === 0) {
    ctx.ui.notify(`No release-aur logs found in ${LOG_DIR}.`, "info");
    return;
  }
  const choices = logs.slice(0, 80).map((log, index) => `${index + 1}. ${log.title}`);
  const choice = await ctx.ui.select("Select release-aur log to display", [...choices, "Cancel"]);
  if (!choice || choice === "Cancel") return;
  const selected = logs[choices.indexOf(choice)];
  if (!selected) return;

  let content = "";
  try {
    content = readFileSync(selected.file, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Could not read release-aur log: ${message}`, "error");
    return;
  }

  activeLogViewerCleanup?.();
  const lines = content.split(/\r?\n/);
  const unsubscribe = ctx.hasUI
    ? ctx.ui.onTerminalInput((data) => {
      if (data === "\u001b" || data === "q" || data === "Q") {
        activeLogViewerCleanup?.();
        activeLogViewerCleanup = undefined;
        return { consume: true };
      }
      return undefined;
    })
    : undefined;
  activeLogViewerCleanup = () => {
    unsubscribe?.();
    if (ctx.hasUI) ctx.ui.setWidget(LOG_WIDGET_KEY, undefined);
  };

  if (ctx.hasUI) {
    ctx.ui.setWidget(LOG_WIDGET_KEY, [
      `release-aur log: ${selected.title}`,
      `Path: ${selected.file} · showing last ${Math.min(LOG_RENDER_LIMIT, lines.length)}/${lines.length} lines · Esc/q closes; /release-aur logs close also closes`,
      "",
      ...lines.slice(-LOG_RENDER_LIMIT),
    ], { placement: "aboveEditor" });
  }
  ctx.ui.notify(`Showing release-aur log ${selected.title}.`, "info");
}

export default function releaseAurExtension(pi: ExtensionAPI) {
  pi.registerCommand("release-aur-setup", {
    description: "Set up AUR publishing prerequisites and upstream release sources",
    getArgumentCompletions: (prefix) => {
      const items = ["dir", "directory", "root", "source", "global", "package", "clear", "ssh", "status", "abort", "help"];
      const filtered = items.filter((item) => item.startsWith(prefix));
      return filtered.length ? filtered.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const [action, ...rest] = tokenize(args?.trim() ?? "");
      if (action === "help") {
        ctx.ui.notify(setupHelpText(), "info");
        return;
      }
      if (action === "dir" || action === "directory" || action === "root") {
        await runAurReposDirSetup(ctx, rest.join(" "));
        return;
      }
      if (action === "source" || action === "upstream" || action === "release-source") {
        await runReleaseSourceSetup(ctx, rest);
        return;
      }
      if (action === "global" || action === "default" || action === "package" || action === "pkg" || action === "pkgbase" || action === "clear" || action === "unset" || action === "remove") {
        await runReleaseSourceSetup(ctx, [action, ...rest]);
        return;
      }
      if (action === "status") {
        await runAurSetupStatus(ctx);
        return;
      }
      if (action === "abort") {
        if (!activeRun) {
          ctx.ui.notify("No active release-aur setup/release process to abort.", "warning");
          return;
        }
        activeRun.abort();
        ctx.ui.notify("Aborting release-aur setup/release process...", "warning");
        return;
      }
      if (action === "ssh") {
        await runAurSshSetup(ctx);
        return;
      }
      if (action) {
        ctx.ui.notify(`Unknown /release-aur-setup action: ${action}\n${setupHelpText()}`, "warning");
        return;
      }
      if (!ctx.hasUI) {
        ctx.ui.notify(setupHelpText(), "info");
        return;
      }
      const choice = await ctx.ui.select("release-aur setup", [
        "AUR repos directory",
        "Upstream release source",
        "AUR SSH connection",
        "AUR setup status",
        "Help",
        "Cancel",
      ]);
      if (choice === "AUR repos directory") {
        await runAurReposDirSetup(ctx);
      } else if (choice === "Upstream release source") {
        await runReleaseSourceSetup(ctx, []);
      } else if (choice === "AUR SSH connection") {
        await runAurSshSetup(ctx);
      } else if (choice === "AUR setup status") {
        await runAurSetupStatus(ctx);
      } else if (choice === "Help") {
        ctx.ui.notify(setupHelpText(), "info");
      }
    },
  });

  pi.registerCommand("release-aur", {
    description: "Plan, review, create, and publish AUR packages safely",
    getArgumentCompletions: (prefix) => {
      const commands = ["plan", "publish", "create", "logs", "abort", "toggle", "help"];
      const root = releaseRoot(process.cwd()).root;
      const targets = discoverTargets(root);
      const items = [...commands, ...targets, "all", "--chroot", "--repro", "--update-release", "--no-update-release", "--release-source", "--package-release-source", "--no-agent-review", "--push"];
      const filtered = items.filter((item) => item.startsWith(prefix));
      return filtered.length ? filtered.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const parsed = parseArgs(args ?? "");

      if (parsed.action === "help") {
        ctx.ui.notify(helpText(), "info");
        return;
      }
      if (parsed.action === "logs") {
        if (parsed.target?.toLowerCase() === "close") {
          activeLogViewerCleanup?.();
          activeLogViewerCleanup = undefined;
          ctx.ui.notify("release-aur log viewer closed.", "info");
          return;
        }
        await showLogs(ctx);
        return;
      }
      if (parsed.action === "abort") {
        if (!activeRun) {
          ctx.ui.notify("No active /release-aur process to abort.", "warning");
          return;
        }
        activeRun.abort();
        ctx.ui.notify("Aborting release-aur workflow...", "warning");
        return;
      }
      if (parsed.action === "toggle") {
        if (!activeRun) {
          ctx.ui.notify("No active /release-aur output to toggle.", "warning");
          return;
        }
        activeRun.toggleOutput();
        return;
      }
      if (activeRun) {
        ctx.ui.notify("A release-aur workflow is already running. Use /release-aur toggle or /release-aur abort.", "warning");
        return;
      }

      const rootInfo = releaseRoot(ctx.cwd);
      if (rootInfo.warning) ctx.ui.notify(rootInfo.warning, "warning");

      if (parsed.action === "create") {
        if (!parsed.pkgbase) {
          ctx.ui.notify("Usage: /release-aur create <pkgbase> [--push] [--chroot] [--repro]", "warning");
          return;
        }
        if (parsed.pushAfterCreate && !ctx.hasUI) {
          ctx.ui.notify("/release-aur create --push is blocked without interactive UI confirmation.", "error");
          return;
        }
        if (ctx.hasUI) {
          const confirmed = await ctx.ui.confirm(
            "Create/converge AUR package repository?",
            [
              `Target: ${parsed.pkgbase}`,
              `Root: ${rootInfo.root}${rootInfo.source === "configured" ? " (from /release-aur-setup dir)" : ""}`,
              "",
              "This converges the target directory into an AUR git repo:",
              "- empty/missing directory: clone AUR repo",
              "- PKGBUILD-only non-git directory: move aside, clone AUR repo, copy safe package files back",
              "- existing git repo: ensure an AUR remote exists",
              "",
              parsed.pushAfterCreate
                ? "After setup it will run checks, ask again, then commit and push if confirmed."
                : "After setup it will run checks and queue an agent GO/NO-GO review.",
            ].join("\n"),
          );
          if (!confirmed) {
            ctx.ui.notify("AUR create cancelled.", "info");
            return;
          }
        }
        await runCreateFlow(pi, ctx, rootInfo.root, parsed.pkgbase, parsed.flags, parsed.pushAfterCreate, !parsed.noAgentReview);
        return;
      }

      const target = await resolveTarget(ctx, parsed, rootInfo.root);
      if (target === "__cancelled__") {
        ctx.ui.notify("release-aur cancelled.", "info");
        return;
      }

      const commonArgs = ["--target", target, ...withDefaultReleaseUpdate(parsed.flags)];
      if (parsed.action === "plan") {
        await runWorkflow(pi, ctx, rootInfo.root, ["--plan", ...commonArgs], "plan", target, !parsed.noAgentReview);
        return;
      }

      if (parsed.action === "publish") {
        if (!ctx.hasUI) {
          ctx.ui.notify("/release-aur publish is blocked without interactive UI confirmation.", "error");
          return;
        }
        await runWorkflow(pi, ctx, rootInfo.root, ["--plan", ...commonArgs], "publish-preflight", target, false, async (plan) => {
          if (!plan.ok) return false;
          const summary = extractSummary(plan.output);
          const choice = await ctx.ui.select([
            "Publish to AUR?",
            "",
            summary,
            "",
            "Continue only if an agent/user review returned GO. This will regenerate .SRCINFO, create a git commit, and push HEAD to AUR master.",
          ].join("\n"), ["No", "Yes, commit and push to AUR"]);
          if (choice !== "Yes, commit and push to AUR") {
            ctx.ui.notify("AUR publish cancelled after preflight.", "info");
            return false;
          }
          return true;
        }, ["--publish", ...commonArgs]);
      }
    },
  });
}

async function runCreateFlow(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  rootDir: string,
  pkgbase: string,
  flags: string[],
  pushAfterCreate: boolean,
  queueReview: boolean,
): Promise<void> {
  const runLog = createRunLog(rootDir);
  let cleanupUi: (() => void) | undefined;
  void (async () => {
    let liveBuffer = "";
    let liveLines: string[] = [];
    let expanded = false;
    const startedAtMs = Date.now();
    let currentChild: AbortableChild | undefined;
    let unsubscribeKeys: (() => void) | undefined;
    let elapsedTimer: ReturnType<typeof setInterval> | undefined;
    let renderQueued = false;
    let uiClosed = false;
    let phase = "create";

    const outputLines = () => outputLinesFromDisplay(liveLines);
    const modeText = () => {
      const total = outputLines().length;
      const shown = expanded ? Math.min(EXPANDED_LINES, total) : Math.min(COLLAPSED_LINES, total);
      return expanded ? `expanded ${shown}/${total}` : `compact ${shown}/${total}`;
    };
    const renderNow = () => {
      if (!ctx.hasUI || uiClosed) return;
      const lines = outputLines();
      const limit = expanded ? EXPANDED_LINES : COLLAPSED_LINES;
      const visible = lines.slice(-limit);
      ctx.ui.setWidget(OUTPUT_WIDGET_KEY, visible.length ? visible : ["Waiting for release-aur output..."], { placement: "aboveEditor" });
      ctx.ui.setWidget(FOOTER_WIDGET_KEY, [
        `release-aur: ${phase} · ${modeText()} · ${formatElapsed(startedAtMs)}`,
        "Controls: Ctrl+O or /release-aur toggle expands/collapses · Ctrl+C or /release-aur abort stops subprocess",
      ], { placement: "belowEditor" });
    };
    const render = (immediate = false) => {
      if (immediate) {
        renderNow();
        return;
      }
      if (!ctx.hasUI || uiClosed || renderQueued) return;
      renderQueued = true;
      setTimeout(() => {
        renderQueued = false;
        renderNow();
      }, OUTPUT_RENDER_INTERVAL_MS);
    };
    const append = (chunk: string) => {
      liveBuffer += chunk;
      appendDisplayChunk(liveLines, chunk);
      appendLog(runLog, chunk);
      render();
    };
    const closeUi = () => {
      uiClosed = true;
      unsubscribeKeys?.();
      unsubscribeKeys = undefined;
      if (elapsedTimer) clearInterval(elapsedTimer);
      elapsedTimer = undefined;
      activeRun = undefined;
      if (ctx.hasUI) {
        ctx.ui.setWidget(OUTPUT_WIDGET_KEY, undefined);
        ctx.ui.setWidget(FOOTER_WIDGET_KEY, undefined);
      }
    };
    cleanupUi = closeUi;
    const abort = () => currentChild?.abortReleaseStep?.();
    const toggle = () => {
      expanded = !expanded;
      render(true);
    };
    const resetOutput = () => {
      liveBuffer = "";
      liveLines = [];
      uiClosed = false;
      render(true);
    };
    const startElapsedTimer = () => {
      if (!ctx.hasUI || elapsedTimer) return;
      elapsedTimer = setInterval(() => render(true), 1000);
    };
    const startUi = (status: string) => {
      activeRun = { abort, toggleOutput: toggle };
      if (!ctx.hasUI) return;
      ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", status));
      render(true);
      startElapsedTimer();
      if (!unsubscribeKeys) {
        unsubscribeKeys = ctx.ui.onTerminalInput((data) => {
          if (isCtrlO(data)) {
            toggle();
            return { consume: true };
          }
          if (isCtrlC(data)) {
            ctx.ui.notify("Aborting release-aur workflow...", "warning");
            abort();
            return { consume: true };
          }
          return undefined;
        });
      }
    };
    const runPhase = async (nextPhase: string, args: string[]): Promise<RunResult> => {
      phase = nextPhase;
      startUi(nextPhase === "publish" ? "AUR:Publishing" : "AUR:Running");
      const command = scriptCommand(rootDir, args);
      append(`\n$ ${command}\n`);
      const result = await runScriptLive(rootDir, command, append, (child) => { currentChild = child; });
      currentChild = undefined;
      return result;
    };

    if (ctx.hasUI) ctx.ui.notify(`Running release-aur create for ${pkgbase}...`, "info");

    const create = await runPhase("create", ["--create", "--pkgbase", pkgbase]);
    if (create.aborted) {
      const logPath = saveRunLog(runLog, "aborted-create");
      closeUi();
      if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", "AUR:Aborted"));
      ctx.ui.notify(`release-aur create aborted.${logPath ? ` Log: ${logPath}` : ""}`, "warning");
      return;
    }
    if (!create.ok) {
      const logPath = saveRunLog(runLog, "failed-create", extractSummary(create.output));
      closeUi();
      if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "AUR:Failed"));
      ctx.ui.notify(`release-aur create failed.${logPath ? ` Log: ${logPath}` : ""}`, "error");
      queueFailureReview(pi, "create", create.output);
      return;
    }

    if (/no PKGBUILD yet/.test(create.output)) {
      closeUi();
      if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", "AUR:Needs-PKGBUILD"));
      const missingDecision = await promptMissingPkgbuild(pi, ctx, rootDir, pkgbase, runLog);
      if (missingDecision !== "continue") {
        const logPath = saveRunLog(runLog, "completed-create-needs-pkgbuild", "AUR repo created/converged; PKGBUILD still needs to be added.");
        ctx.ui.notify(`AUR repo setup stopped until PKGBUILD exists.${logPath ? `\nLog: ${logPath}` : ""}`, "info");
        return;
      }

      resetOutput();
      const recreate = await runPhase("create", ["--create", "--pkgbase", pkgbase]);
      if (recreate.aborted) {
        const logPath = saveRunLog(runLog, "aborted-create-after-pkgbuild");
        closeUi();
        if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", "AUR:Aborted"));
        ctx.ui.notify(`release-aur create aborted.${logPath ? ` Log: ${logPath}` : ""}`, "warning");
        return;
      }
      if (!recreate.ok || /no PKGBUILD yet/.test(recreate.output)) {
        const logPath = saveRunLog(runLog, "failed-create-after-pkgbuild", extractSummary(recreate.output));
        closeUi();
        if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "AUR:Failed"));
        ctx.ui.notify(`release-aur could not continue after PKGBUILD handling.${logPath ? ` Log: ${logPath}` : ""}`, "error");
        queueFailureReview(pi, "create after PKGBUILD handling", recreate.output);
        return;
      }
    }

    const plan = await runPhase("plan", ["--plan", "--target", pkgbase, ...withDefaultReleaseUpdate(flags)]);
    if (plan.aborted) {
      const logPath = saveRunLog(runLog, "aborted-create-plan");
      closeUi();
      if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", "AUR:Aborted"));
      ctx.ui.notify(`release-aur plan aborted.${logPath ? ` Log: ${logPath}` : ""}`, "warning");
      return;
    }
    if (!plan.ok) {
      const logPath = saveRunLog(runLog, "failed-create-plan", extractSummary(plan.output));
      closeUi();
      if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "AUR:Failed"));
      ctx.ui.notify(`release-aur create completed but plan failed.${logPath ? ` Log: ${logPath}` : ""}`, "error");
      queueFailureReview(pi, "create plan", plan.output);
      return;
    }

    if (!pushAfterCreate) {
      const summary = extractSummary(plan.output);
      const logPath = saveRunLog(runLog, "completed-create-plan", summary);
      closeUi();
      if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("success", "AUR:OK"));
      ctx.ui.notify(`${summary}\nrelease-aur create+plan completed.${logPath ? `\nLog: ${logPath}` : ""}`, "info");
      if (queueReview) queueAgentReview(pi, rootDir, pkgbase, plan.output);
      return;
    }

    closeUi();
    const summary = extractSummary(plan.output);
    const choice = await ctx.ui.select([
      "Publish newly created/converged AUR package?",
      "",
      summary,
      "",
      "This will re-run checks, regenerate .SRCINFO, commit, and push HEAD to AUR master.",
    ].join("\n"), ["No", "Yes, commit and push to AUR"]);
    if (choice !== "Yes, commit and push to AUR") {
      const logPath = saveRunLog(runLog, "cancelled-create-push", summary);
      if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", "AUR:Cancelled"));
      ctx.ui.notify(`release-aur create --push cancelled after plan.${logPath ? ` Log: ${logPath}` : ""}`, "info");
      return;
    }

    resetOutput();
    const publish = await runPhase("publish", ["--publish", "--target", pkgbase, ...withDefaultReleaseUpdate(flags)]);
    if (publish.aborted) {
      const logPath = saveRunLog(runLog, "aborted-create-publish");
      closeUi();
      if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", "AUR:Aborted"));
      ctx.ui.notify(`release-aur publish aborted.${logPath ? ` Log: ${logPath}` : ""}`, "warning");
      return;
    }
    if (!publish.ok) {
      const logPath = saveRunLog(runLog, "failed-create-publish", extractSummary(publish.output));
      closeUi();
      if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "AUR:Failed"));
      ctx.ui.notify(`release-aur publish failed.${logPath ? ` Log: ${logPath}` : ""}`, "error");
      queueFailureReview(pi, "create publish", publish.output);
      return;
    }

    const finalSummary = extractSummary(publish.output);
    const logPath = saveRunLog(runLog, "completed-create-publish", finalSummary);
    closeUi();
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("success", "AUR:OK"));
    ctx.ui.notify(`${finalSummary}\nrelease-aur create --push completed.${logPath ? `\nLog: ${logPath}` : ""}`, "info");
  })().catch((error: unknown) => {
    cleanupUi?.();
    activeRun = undefined;
    if (ctx.hasUI) {
      ctx.ui.setWidget(OUTPUT_WIDGET_KEY, undefined);
      ctx.ui.setWidget(FOOTER_WIDGET_KEY, undefined);
      ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "AUR:Failed"));
    }
    const message = error instanceof Error ? error.message : String(error);
    const logPath = saveRunLog(runLog, "crashed-create", message);
    ctx.ui.notify(`release-aur create crashed: ${message}${logPath ? ` Log: ${logPath}` : ""}`, "error");
  });
}

async function runWorkflow(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  rootDir: string,
  initialArgs: string[],
  phaseLabel: string,
  targetLabel: string,
  queueReview: boolean,
  beforeSecondPhase?: (result: RunResult) => Promise<boolean>,
  secondArgs?: string[],
): Promise<void> {
  const runLog = createRunLog(rootDir);
  let cleanupUi: (() => void) | undefined;
  void (async () => {
    let liveBuffer = "";
    let liveLines: string[] = [];
    let expanded = false;
    const startedAtMs = Date.now();
    let currentChild: AbortableChild | undefined;
    let unsubscribeKeys: (() => void) | undefined;
    let elapsedTimer: ReturnType<typeof setInterval> | undefined;
    let renderQueued = false;
    let uiClosed = false;
    let phase = phaseLabel;

    const outputLines = () => outputLinesFromDisplay(liveLines);
    const modeText = () => {
      const total = outputLines().length;
      const shown = expanded ? Math.min(EXPANDED_LINES, total) : Math.min(COLLAPSED_LINES, total);
      return expanded ? `expanded ${shown}/${total}` : `compact ${shown}/${total}`;
    };
    const renderNow = () => {
      if (!ctx.hasUI || uiClosed) return;
      const lines = outputLines();
      const limit = expanded ? EXPANDED_LINES : COLLAPSED_LINES;
      const visible = lines.slice(-limit);
      ctx.ui.setWidget(OUTPUT_WIDGET_KEY, visible.length ? visible : ["Waiting for release-aur output..."], { placement: "aboveEditor" });
      ctx.ui.setWidget(FOOTER_WIDGET_KEY, [
        `release-aur: ${phase} · ${modeText()} · ${formatElapsed(startedAtMs)}`,
        "Controls: Ctrl+O or /release-aur toggle expands/collapses · Ctrl+C or /release-aur abort stops subprocess",
      ], { placement: "belowEditor" });
    };
    const render = (immediate = false) => {
      if (immediate) {
        renderNow();
        return;
      }
      if (!ctx.hasUI || uiClosed || renderQueued) return;
      renderQueued = true;
      setTimeout(() => {
        renderQueued = false;
        renderNow();
      }, OUTPUT_RENDER_INTERVAL_MS);
    };
    const append = (chunk: string) => {
      liveBuffer += chunk;
      appendDisplayChunk(liveLines, chunk);
      appendLog(runLog, chunk);
      render();
    };
    const closeUi = () => {
      uiClosed = true;
      unsubscribeKeys?.();
      unsubscribeKeys = undefined;
      if (elapsedTimer) clearInterval(elapsedTimer);
      elapsedTimer = undefined;
      activeRun = undefined;
      if (ctx.hasUI) {
        ctx.ui.setWidget(OUTPUT_WIDGET_KEY, undefined);
        ctx.ui.setWidget(FOOTER_WIDGET_KEY, undefined);
      }
    };
    cleanupUi = closeUi;
    const abort = () => currentChild?.abortReleaseStep?.();
    const toggle = () => {
      expanded = !expanded;
      render(true);
    };
    const resetOutput = () => {
      liveBuffer = "";
      liveLines = [];
      uiClosed = false;
      render(true);
    };
    const startElapsedTimer = () => {
      if (!ctx.hasUI || elapsedTimer) return;
      elapsedTimer = setInterval(() => render(true), 1000);
    };

    activeRun = { abort, toggleOutput: toggle };
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", "AUR:Running"));
      ctx.ui.notify(`Running release-aur ${phaseLabel}...`, "info");
      render(true);
      startElapsedTimer();
      unsubscribeKeys = ctx.ui.onTerminalInput((data) => {
        if (isCtrlO(data)) {
          toggle();
          return { consume: true };
        }
        if (isCtrlC(data)) {
          ctx.ui.notify("Aborting release-aur workflow...", "warning");
          abort();
          return { consume: true };
        }
        return undefined;
      });
    }

    const firstCommand = scriptCommand(rootDir, initialArgs);
    append(`$ ${firstCommand}\n`);
    const first = await runScriptLive(rootDir, firstCommand, append, (child) => { currentChild = child; });
    currentChild = undefined;

    if (first.aborted) {
      const logPath = saveRunLog(runLog, `aborted-${phaseLabel}`);
      closeUi();
      if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", "AUR:Aborted"));
      ctx.ui.notify(`release-aur aborted.${logPath ? ` Log: ${logPath}` : ""}`, "warning");
      return;
    }

    if (!first.ok) {
      const logPath = saveRunLog(runLog, `failed-${phaseLabel}`, extractSummary(first.output));
      closeUi();
      if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "AUR:Failed"));
      ctx.ui.notify(`release-aur ${phaseLabel} failed.${logPath ? ` Log: ${logPath}` : ""}`, "error");
      queueFailureReview(pi, phaseLabel, first.output);
      return;
    }

    if (beforeSecondPhase && secondArgs) {
      closeUi();
      const proceed = await beforeSecondPhase(first);
      if (!proceed) {
        const logPath = saveRunLog(runLog, `cancelled-${phaseLabel}`, extractSummary(first.output));
        if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", "AUR:Cancelled"));
        ctx.ui.notify(`release-aur publish cancelled.${logPath ? ` Log: ${logPath}` : ""}`, "info");
        return;
      }

      phase = "publish";
      activeRun = { abort, toggleOutput: toggle };
      resetOutput();
      if (ctx.hasUI) {
        ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", "AUR:Publishing"));
        render(true);
        startElapsedTimer();
      }
      const secondCommand = scriptCommand(rootDir, secondArgs);
      append(`$ ${secondCommand}\n`);
      const second = await runScriptLive(rootDir, secondCommand, append, (child) => { currentChild = child; });
      currentChild = undefined;

      if (second.aborted) {
        const logPath = saveRunLog(runLog, "aborted-publish");
        closeUi();
        if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", "AUR:Aborted"));
        ctx.ui.notify(`release-aur publish aborted.${logPath ? ` Log: ${logPath}` : ""}`, "warning");
        return;
      }
      if (!second.ok) {
        const logPath = saveRunLog(runLog, "failed-publish", extractSummary(second.output));
        closeUi();
        if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "AUR:Failed"));
        ctx.ui.notify(`release-aur publish failed.${logPath ? ` Log: ${logPath}` : ""}`, "error");
        queueFailureReview(pi, "publish", second.output);
        return;
      }

      const finalSummary = extractSummary(second.output);
      const logPath = saveRunLog(runLog, "completed-publish", finalSummary);
      closeUi();
      if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("success", "AUR:OK"));
      ctx.ui.notify(`${finalSummary}\nrelease-aur publish completed.${logPath ? `\nLog: ${logPath}` : ""}`, "info");
      return;
    }

    const summary = extractSummary(first.output);
    const logPath = saveRunLog(runLog, `completed-${phaseLabel}`, summary);
    closeUi();
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("success", "AUR:OK"));
    ctx.ui.notify(`${summary}\nrelease-aur ${phaseLabel} completed.${logPath ? `\nLog: ${logPath}` : ""}`, "info");
    if (queueReview) queueAgentReview(pi, rootDir, targetLabel, first.output);
  })().catch((error: unknown) => {
    cleanupUi?.();
    activeRun = undefined;
    if (ctx.hasUI) {
      ctx.ui.setWidget(OUTPUT_WIDGET_KEY, undefined);
      ctx.ui.setWidget(FOOTER_WIDGET_KEY, undefined);
      ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", "AUR:Failed"));
    }
    const message = error instanceof Error ? error.message : String(error);
    const logPath = saveRunLog(runLog, "crashed", message);
    ctx.ui.notify(`release-aur crashed: ${message}${logPath ? ` Log: ${logPath}` : ""}`, "error");
  });
}
