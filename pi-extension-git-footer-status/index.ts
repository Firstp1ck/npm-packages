import { isAbsolute, resolve } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  collectInitialPromptCalibration,
  createInitialPromptEstimateService,
  envFlag,
  estimateStableInitialPromptFromPiContext,
  estimateTokensFromCharCount,
  formatTokens,
  formatUserPath,
  pathExists,
  type InitialPromptEstimateSnapshot,
  type InitialPromptInputEstimate,
} from "@firstpick/pi-utils";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type GitChangeKind = "staged" | "modified" | "untracked" | "conflicted";

type GitChangedFile = {
  kind: GitChangeKind;
  path: string;
  oldPath?: string;
  status: string;
};

type GitSnapshot = {
  branch: string;
  isDetached: boolean;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  changedFiles: GitChangedFile[];
  operation?: string;
  stashCount: number;
  submoduleDirty: number;
  lastCommitAge?: string;
  worktreeCount: number;
  headTag?: string;
  signingMismatch: boolean;
};

type SigningDiagnostics = {
  commitSignRequired: boolean;
  signState: string;
  gpgFormat: string;
  signingKey: string;
};

const LIVE_TOKEN_SPEED_ROLLING_WINDOW_MS = 2000;
const DEFAULT_GIT_AUTO_REFRESH_INTERVAL_MS = 10_000;
const GIT_INITIAL_FETCH_TIMEOUT_MS = 30_000;
const GIT_FETCH_MESSAGE_MAX_LENGTH = 240;
const GIT_CHANGED_FILES_LIMIT = 80;
const PROMPT_ESTIMATE_REFRESH_DELAY_MS = 1000;
const FOOTER_USAGE_RECOMPUTE_DELAY_MS = 1000;
const WEBUI_FOOTER_STATUS_KEY = "git-footer-webui";
const GIT_FOOTER_STATUS_KEY = "git-footer";
const WEBUI_FOOTER_PAYLOAD_TYPE = "firstpick.git-footer-status.footer";
const WEBUI_FOOTER_PAYLOAD_VERSION = 1;

// Toggle footer items on/off here.
const FOOTER_FLAGS = {
  branch: false,
  detachedIndicator: true,
  operationState: true,

  ahead: true,
  behind: true,

  staged: true,
  unstaged: true,
  untracked: true,
  conflicted: true,
  clean: true,

  stash: true,
  submodules: true,
  worktrees: true,
  tag: true,
  lastCommitAge: true,
  signingMismatch: true,
} as const;

type GitStatusTone = "accent" | "warning" | "muted" | "success" | "error" | "dim";

type GitStatusItem = {
  text: string;
  tone: GitStatusTone;
};

type GitStatusSection = {
  key: "branch" | "sync" | "changes" | "extra";
  items: GitStatusItem[];
};

type GitFetchState = {
  status: "idle" | "fetching" | "ok" | "error" | "skipped";
  startedAt?: number;
  completedAt?: number;
  message?: string;
};

type FooterTelemetry = {
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
  liveOutputTokens: number;
  latestTokenSpeed: number | null;
  promptInjectionTokens: number | null;
  promptInjectionCalibrationSamples: number;
  promptInjectionCanCalibrateCurrent: boolean;
  contextWindow: number;
  contextPercent: number | null;
  contextDisplay: string;
  modelName: string;
  modelProvider: string | null;
  showModelProvider: boolean;
  thinkingLevel: string;
  usingSubscription: boolean;
};

type WebuiFooterChangedFile = GitChangedFile;

type WebuiFooterChip = {
  key: string;
  label: string;
  value: string;
  icon?: string;
  tone?: "pink" | "blue" | "mauve" | "yellow" | "green" | "teal";
  title?: string;
  action?: "calibrate-current" | "calibrate-probe";
  files?: WebuiFooterChangedFile[];
  contextUsage?: {
    percent: number | null;
    contextWindow: number;
  };
};

type WebuiFooterPayload = {
  type: typeof WEBUI_FOOTER_PAYLOAD_TYPE;
  version: typeof WEBUI_FOOTER_PAYLOAD_VERSION;
  generatedAt: number;
  main: WebuiFooterChip[];
  meta: WebuiFooterChip[];
};

type GitRefreshOptions = {
  publishIfUnchanged?: boolean;
};

function envMs(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

const GIT_AUTO_REFRESH_INTERVAL_MS = envMs("PI_GIT_FOOTER_AUTO_REFRESH_MS", DEFAULT_GIT_AUTO_REFRESH_INTERVAL_MS);
const GIT_INITIAL_FETCH_ENABLED = envFlag("PI_GIT_FOOTER_FETCH", true);
const PROMPT_ESTIMATE_ENABLED = !envFlag("PI_GIT_FOOTER_DISABLE_PROMPT_ESTIMATE", false);

function formatCwd(cwd: string): string {
  return formatUserPath(cwd);
}

function normalizeTimestampMs(timestamp: number): number {
  // Handle mixed timestamp units from different session formats.
  // seconds   -> ms  (e.g. 1715000000)
  // ms        -> ms  (e.g. 1715000000000)
  // microsec  -> ms  (e.g. 1715000000000000)
  if (timestamp < 1e11) return timestamp * 1000;
  if (timestamp > 1e14) return Math.floor(timestamp / 1000);
  return timestamp;
}

function getEntryTimestampMs(entry: { type: string; timestamp: string; message?: { timestamp?: number } }): number | null {
  if (entry.type === "message" && typeof entry.message?.timestamp === "number") {
    return normalizeTimestampMs(entry.message.timestamp);
  }
  const parsed = Date.parse(entry.timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function isReasonableTokenSpeed(tokensPerSecond: number): boolean {
  return Number.isFinite(tokensPerSecond) && tokensPerSecond > 0 && tokensPerSecond <= 1000;
}

type LiveTokenSample = {
  timestampMs: number;
  tokens: number;
};

type FooterUsageSnapshot = {
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
  historicalTokenSpeed: number | null;
};

function emptyFooterUsageSnapshot(): FooterUsageSnapshot {
  return {
    totalInput: 0,
    totalOutput: 0,
    totalCacheRead: 0,
    totalCacheWrite: 0,
    totalCost: 0,
    historicalTokenSpeed: null,
  };
}

function formatTokenSpeed(tokensPerSecond: number): string {
  if (tokensPerSecond < 100) {
    if (tokensPerSecond >= 10) return tokensPerSecond.toFixed(1);
    return tokensPerSecond.toFixed(2);
  }
  if (tokensPerSecond < 1000) return Math.round(tokensPerSecond).toString();
  if (tokensPerSecond < 10000) return `${(tokensPerSecond / 1000).toFixed(1)}k`;
  if (tokensPerSecond < 1000000) return `${Math.round(tokensPerSecond / 1000)}k`;
  if (tokensPerSecond < 10000000) return `${(tokensPerSecond / 1000000).toFixed(1)}M`;
  return `${Math.round(tokensPerSecond / 1000000)}M`;
}

async function runGit(pi: ExtensionAPI, cwd: string, args: string[], timeout = 2000): Promise<string | undefined> {
  const result = await pi.exec("git", args, { cwd, timeout }).catch(() => undefined);
  if (!result || result.code !== 0) return undefined;
  return result.stdout.trim();
}

function compactFetchMessage(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > GIT_FETCH_MESSAGE_MAX_LENGTH ? `${text.slice(0, GIT_FETCH_MESSAGE_MAX_LENGTH - 1)}…` : text;
}

function gitFetchResultMessage(result: { stdout?: string; stderr?: string; code?: number; killed?: boolean }): string {
  const output = compactFetchMessage([result.stderr, result.stdout].filter(Boolean).join("\n"));
  if (output) return output;
  if (result.killed) return "git fetch timed out";
  return result.code === 0 ? "git fetch completed" : `git fetch failed with exit code ${result.code ?? "unknown"}`;
}

function toAgeLabel(epochSeconds: number): string | undefined {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return undefined;

  const deltaSeconds = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
  if (deltaSeconds < 60) return "now";

  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

async function detectGitOperation(pi: ExtensionAPI, cwd: string): Promise<string | undefined> {
  const gitDirRaw = await runGit(pi, cwd, ["rev-parse", "--git-dir"]);
  if (!gitDirRaw) return undefined;

  const gitDir = isAbsolute(gitDirRaw) ? gitDirRaw : resolve(cwd, gitDirRaw);

  if ((await pathExists(resolve(gitDir, "rebase-merge"))) || (await pathExists(resolve(gitDir, "rebase-apply")))) {
    return "REBASING";
  }
  if (await pathExists(resolve(gitDir, "MERGE_HEAD"))) return "MERGING";
  if (await pathExists(resolve(gitDir, "CHERRY_PICK_HEAD"))) return "CHERRY-PICK";
  if (await pathExists(resolve(gitDir, "REVERT_HEAD"))) return "REVERTING";
  if (await pathExists(resolve(gitDir, "BISECT_LOG"))) return "BISECT";

  return undefined;
}

function splitPorcelainFields(line: string, fieldCount: number): string[] {
  const fields: string[] = [];
  let start = 0;
  for (let index = 0; index < fieldCount - 1; index++) {
    const next = line.indexOf(" ", start);
    if (next === -1) break;
    fields.push(line.slice(start, next));
    start = next + 1;
  }
  fields.push(line.slice(start));
  return fields;
}

function parsePorcelainPathField(value: string): { path: string; oldPath?: string } {
  const [path = "", oldPath] = value.split("\t");
  return oldPath ? { path, oldPath } : { path };
}

function addChangedFile(files: GitChangedFile[], kind: GitChangeKind, path: string, status: string, oldPath?: string) {
  const entry: GitChangedFile = { kind, path, status };
  if (oldPath) entry.oldPath = oldPath;
  files.push(entry);
}

function addTrackedChangedFiles(files: GitChangedFile[], xy: string, path: string, oldPath?: string) {
  const x = xy[0] ?? ".";
  const y = xy[1] ?? ".";
  if (x !== ".") addChangedFile(files, "staged", path, xy, oldPath);
  if (y !== ".") addChangedFile(files, "modified", path, xy, oldPath);
}

async function readGitSnapshot(pi: ExtensionAPI, cwd: string): Promise<GitSnapshot | null> {
  const result = await pi
    .exec("git", ["status", "--porcelain=2", "--branch"], { cwd, timeout: 3000 })
    .catch(() => undefined);

  if (!result || result.code !== 0) {
    return null;
  }

  let branch = "";
  let detachedOid: string | undefined;
  let ahead = 0;
  let behind = 0;
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let conflicted = 0;
  const changedFiles: GitChangedFile[] = [];

  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line) continue;

    if (line.startsWith("# branch.head ")) {
      branch = line.slice("# branch.head ".length).trim();
      continue;
    }

    if (line.startsWith("# branch.oid ")) {
      const oid = line.slice("# branch.oid ".length).trim();
      if (oid && oid !== "(initial)") detachedOid = oid;
      continue;
    }

    if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        ahead = Number.parseInt(match[1] ?? "0", 10) || 0;
        behind = Number.parseInt(match[2] ?? "0", 10) || 0;
      }
      continue;
    }

    if (line.startsWith("1 ")) {
      const fields = splitPorcelainFields(line, 9);
      const xy = fields[1] ?? "..";
      const x = xy[0] ?? ".";
      const y = xy[1] ?? ".";
      if (x !== ".") staged++;
      if (y !== ".") unstaged++;
      const filePath = fields[8] ?? "";
      if (filePath) addTrackedChangedFiles(changedFiles, xy, filePath);
      continue;
    }

    if (line.startsWith("2 ")) {
      const fields = splitPorcelainFields(line, 10);
      const xy = fields[1] ?? "..";
      const x = xy[0] ?? ".";
      const y = xy[1] ?? ".";
      if (x !== ".") staged++;
      if (y !== ".") unstaged++;
      const parsedPath = parsePorcelainPathField(fields[9] ?? "");
      if (parsedPath.path) addTrackedChangedFiles(changedFiles, xy, parsedPath.path, parsedPath.oldPath);
      continue;
    }

    if (line.startsWith("u ")) {
      conflicted++;
      const fields = splitPorcelainFields(line, 11);
      const filePath = fields[10] ?? "";
      if (filePath) changedFiles.push({ kind: "conflicted", path: filePath, status: fields[1] ?? "UU" });
      continue;
    }

    if (line.startsWith("? ")) {
      untracked++;
      const filePath = line.slice(2);
      if (filePath) changedFiles.push({ kind: "untracked", path: filePath, status: "??" });
      continue;
    }
  }

  const isDetached = !branch || branch === "(detached)";
  const resolvedBranch =
    !isDetached
      ? branch
      : detachedOid
        ? `detached@${detachedOid.slice(0, 7)}`
        : "detached";

  const [operation, stashList, submoduleStatus, lastCommitTs, worktreeList, headTags, commitSignRequiredRaw, headSignState] =
    await Promise.all([
      detectGitOperation(pi, cwd),
      runGit(pi, cwd, ["stash", "list", "--format=%gd"]),
      runGit(pi, cwd, ["submodule", "status", "--recursive"]),
      runGit(pi, cwd, ["log", "-1", "--format=%ct"]),
      runGit(pi, cwd, ["worktree", "list", "--porcelain"]),
      runGit(pi, cwd, ["tag", "--points-at", "HEAD", "--sort=-creatordate"]),
      runGit(pi, cwd, ["config", "--bool", "--get", "commit.gpgsign"]),
      runGit(pi, cwd, ["log", "-1", "--format=%G?"]),
    ]);

  const stashCount = stashList ? stashList.split(/\r?\n/).filter(Boolean).length : 0;

  const submoduleDirty = submoduleStatus
    ? submoduleStatus
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith(" "))
        .length
    : 0;

  const worktreeCount = worktreeList
    ? Math.max(
        1,
        worktreeList
          .split(/\r?\n/)
          .filter((line) => line.startsWith("worktree ")).length,
      )
    : 1;

  const headTag = headTags?.split(/\r?\n/).find(Boolean);

  const lastCommitAge = lastCommitTs ? toAgeLabel(Number.parseInt(lastCommitTs, 10)) : undefined;

  const commitSignRequired = commitSignRequiredRaw?.toLowerCase() === "true";
  const signState = headSignState?.trim().toUpperCase();
  const signingMismatch =
    commitSignRequired &&
    (!signState || signState === "N" || signState === "E");

  return {
    branch: resolvedBranch,
    isDetached,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    conflicted,
    changedFiles: changedFiles.slice(0, GIT_CHANGED_FILES_LIMIT),
    operation,
    stashCount,
    submoduleDirty,
    lastCommitAge,
    worktreeCount,
    headTag,
    signingMismatch,
  };
}

async function getSigningDiagnostics(pi: ExtensionAPI, cwd: string): Promise<SigningDiagnostics> {
  const [commitSignRequiredRaw, headSignState, gpgFormatRaw, signingKeyRaw] = await Promise.all([
    runGit(pi, cwd, ["config", "--bool", "--get", "commit.gpgsign"]),
    runGit(pi, cwd, ["log", "-1", "--format=%G?"]),
    runGit(pi, cwd, ["config", "--get", "gpg.format"]),
    runGit(pi, cwd, ["config", "--get", "user.signingkey"]),
  ]);

  return {
    commitSignRequired: commitSignRequiredRaw?.toLowerCase() === "true",
    signState: headSignState?.trim().toUpperCase() || "N",
    gpgFormat: gpgFormatRaw?.trim() || "(default:gpg)",
    signingKey: signingKeyRaw?.trim() || "(not set)",
  };
}

function isWorkingTreeClean(snapshot: GitSnapshot): boolean {
  return (
    snapshot.ahead === 0 &&
    snapshot.behind === 0 &&
    snapshot.staged === 0 &&
    snapshot.unstaged === 0 &&
    snapshot.untracked === 0 &&
    snapshot.conflicted === 0
  );
}

function gitSnapshotFingerprint(snapshot: GitSnapshot | null): string {
  if (!snapshot) return "none";
  return [
    snapshot.branch,
    snapshot.isDetached ? "1" : "0",
    snapshot.ahead,
    snapshot.behind,
    snapshot.staged,
    snapshot.unstaged,
    snapshot.untracked,
    snapshot.conflicted,
    snapshot.changedFiles.map((file) => `${file.kind}:${file.status}:${file.oldPath ? `${file.oldPath}->` : ""}${file.path}`).join("\u001e"),
    snapshot.operation ?? "",
    snapshot.stashCount,
    snapshot.submoduleDirty,
    snapshot.lastCommitAge ?? "",
    snapshot.worktreeCount,
    snapshot.headTag ?? "",
    snapshot.signingMismatch ? "1" : "0",
  ].join("\u001f");
}

function buildGitStatusSections(snapshot: GitSnapshot): GitStatusSection[] {
  const f = FOOTER_FLAGS;
  const branchSection: GitStatusItem[] = [];
  if (f.branch) {
    branchSection.push({ text: "", tone: "accent" }, { text: snapshot.branch, tone: "accent" });
  }
  if (f.detachedIndicator && snapshot.isDetached) branchSection.push({ text: "⎇", tone: "warning" });
  if (f.operationState && snapshot.operation) branchSection.push({ text: snapshot.operation, tone: "warning" });

  const syncSection: GitStatusItem[] = [];
  if (f.ahead && snapshot.ahead > 0) syncSection.push({ text: `⇡${snapshot.ahead}`, tone: "muted" });
  if (f.behind && snapshot.behind > 0) syncSection.push({ text: `⇣${snapshot.behind}`, tone: "muted" });

  const changesSection: GitStatusItem[] = [];
  if (f.staged && snapshot.staged > 0) changesSection.push({ text: `+${snapshot.staged}`, tone: "success" });
  if (f.unstaged && snapshot.unstaged > 0) changesSection.push({ text: `✎${snapshot.unstaged}`, tone: "warning" });
  if (f.untracked && snapshot.untracked > 0) changesSection.push({ text: `◌${snapshot.untracked}`, tone: "muted" });
  if (f.conflicted && snapshot.conflicted > 0) changesSection.push({ text: `!${snapshot.conflicted}`, tone: "error" });
  if (f.clean && isWorkingTreeClean(snapshot)) changesSection.push({ text: "✅", tone: "dim" });

  const extraSection: GitStatusItem[] = [];
  if (f.stash && snapshot.stashCount > 0) extraSection.push({ text: `⚑${snapshot.stashCount}`, tone: "muted" });
  if (f.submodules && snapshot.submoduleDirty > 0) extraSection.push({ text: `✖${snapshot.submoduleDirty}`, tone: "warning" });
  if (f.worktrees && snapshot.worktreeCount > 1) extraSection.push({ text: `📦${snapshot.worktreeCount}`, tone: "muted" });
  if (f.tag && snapshot.headTag) extraSection.push({ text: `🏷${snapshot.headTag}`, tone: "accent" });
  if (f.lastCommitAge && snapshot.lastCommitAge) extraSection.push({ text: `⏱${snapshot.lastCommitAge}`, tone: "dim" });
  if (f.signingMismatch && snapshot.signingMismatch) extraSection.push({ text: "⚠️!", tone: "warning" });

  const sections: GitStatusSection[] = [
    { key: "branch", items: branchSection },
    { key: "sync", items: syncSection },
    { key: "changes", items: changesSection },
    { key: "extra", items: extraSection },
  ];
  return sections.filter((section) => section.items.length > 0);
}

function buildStatusText(ctx: ExtensionContext, snapshot: GitSnapshot): string {
  const t = ctx.ui.theme;
  const sectionSep = t.fg("dim", "│");
  const itemSep = t.fg("dim", "·");
  const sections = buildGitStatusSections(snapshot);

  return sections.length > 0
    ? sections
        .map((section) => section.items.map((item) => t.fg(item.tone, item.text)).join(` ${itemSep} `))
        .join(` ${sectionSep} `)
    : t.fg("dim", "git");
}

function sectionValue(section: GitStatusSection | undefined): string | undefined {
  if (!section || section.items.length === 0) return undefined;
  return section.items.map((item) => item.text).join(" · ");
}

function webuiRemoteChangeValue(snapshot: GitSnapshot, fetchState: GitFetchState): string | undefined {
  if (fetchState.status === "fetching") return "🔄 fetch";
  if (snapshot.behind > 0) return `⬇️ ${snapshot.behind}`;
  if (fetchState.status === "error") return "⚠️ fetch";
  if (fetchState.status === "ok") return "✓ fetch";
  return undefined;
}

function gitFetchTitle(fetchState: GitFetchState, snapshot: GitSnapshot): string | undefined {
  if (fetchState.status === "idle" || fetchState.status === "skipped") return undefined;
  const parts: string[] = [];
  if (fetchState.status === "fetching") parts.push("git fetch is running for this tab");
  else if (fetchState.status === "ok") parts.push("git fetch completed for this tab");
  else if (fetchState.status === "error") parts.push("git fetch failed for this tab");
  if (snapshot.behind > 0) parts.push(`${snapshot.behind} remote commit${snapshot.behind === 1 ? "" : "s"} to pull`);
  if (fetchState.message && !["git fetch", "git fetch completed"].includes(fetchState.message)) parts.push(fetchState.message);
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function webuiChangesValue(snapshot: GitSnapshot, fetchState: GitFetchState): string | undefined {
  const parts: string[] = [];
  if (snapshot.staged > 0) parts.push(`🟢 ${snapshot.staged}`);
  if (snapshot.unstaged > 0) parts.push(`✏️ ${snapshot.unstaged}`);
  if (snapshot.untracked > 0) parts.push(`➕ ${snapshot.untracked}`);
  if (snapshot.conflicted > 0) parts.push(`⚠️ ${snapshot.conflicted}`);
  const remoteChange = webuiRemoteChangeValue(snapshot, fetchState);
  if (remoteChange) parts.push(remoteChange);
  if (parts.length === 0 && isWorkingTreeClean(snapshot)) parts.push("✅");
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function webuiExtraValue(snapshot: GitSnapshot): string | undefined {
  const parts: string[] = [];
  if (snapshot.stashCount > 0) parts.push(`📦 ${snapshot.stashCount}`);
  if (snapshot.submoduleDirty > 0) parts.push(`🧩 ${snapshot.submoduleDirty}`);
  if (snapshot.worktreeCount > 1) parts.push(`🌳 ${snapshot.worktreeCount}`);
  if (snapshot.headTag) parts.push(`🏷️ ${snapshot.headTag}`);
  if (snapshot.lastCommitAge) parts.push(`🕒 ${snapshot.lastCommitAge}`);
  if (snapshot.signingMismatch) parts.push("🔓");
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function footerTone(tone: GitStatusTone): WebuiFooterChip["tone"] {
  switch (tone) {
    case "success":
      return "green";
    case "warning":
      return "yellow";
    case "accent":
      return "mauve";
    case "error":
      return "pink";
    case "muted":
    case "dim":
      return "blue";
  }
}

function buildWebuiGitMeta(snapshot: GitSnapshot | null, fetchState: GitFetchState): WebuiFooterChip[] {
  if (!snapshot) return [{ key: "git", label: "git", value: "no repo", title: "git: no repo" }];

  const sections = buildGitStatusSections(snapshot);
  const state = sectionValue(sections.find((section) => section.key === "branch"));
  const sync = sectionValue(sections.find((section) => section.key === "sync"));
  const changes = webuiChangesValue(snapshot, fetchState);
  const changesFetchTitle = gitFetchTitle(fetchState, snapshot);
  const extraSection = sections.find((section) => section.key === "extra");
  const extra = webuiExtraValue(snapshot);

  const chips: WebuiFooterChip[] = [
    {
      key: "git",
      label: "git",
      value: snapshot.branch || "detached",
      title: `git branch: ${snapshot.branch || "detached"}`,
    },
  ];
  if (state) chips.push({ key: "git-state", label: "state", value: state, title: `git state: ${state}`, tone: "yellow" });
  if (sync) chips.push({ key: "sync", label: "sync", value: sync, title: `git sync: ${sync}`, tone: "blue" });
  if (changes) {
    chips.push({
      key: "changes",
      label: "changes",
      value: changes,
      title: [`git changes: ${changes}`, changesFetchTitle].filter(Boolean).join("\n"),
      files: snapshot.changedFiles.slice(0, GIT_CHANGED_FILES_LIMIT),
    });
  }
  if (extra) {
    chips.push({
      key: "git-extra",
      label: "git+",
      value: extra,
      title: `git extras: ${extra}`,
      tone: footerTone(extraSection?.items.find((item) => item.tone !== "dim")?.tone ?? "muted"),
    });
  }
  return chips;
}

function footerMetricValue(tokens: number): string {
  return formatTokens(tokens);
}

function footerPromptInjectionValue(tokens: number | null): string {
  return tokens === null ? "…" : `${footerMetricValue(tokens)} tok`;
}

function debugHashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function formatDebugToolNames(snapshot: InitialPromptEstimateSnapshot, limit = 16): string {
  const names = snapshot.tools.map((tool) => tool.name).filter(Boolean);
  if (names.length === 0) return "none";
  const shown = names.slice(0, limit).join(", ");
  const remaining = names.length - limit;
  return remaining > 0 ? `${shown}, … +${remaining} more` : shown;
}

function formatPromptEstimateDebugSnapshot(label: string, snapshot: InitialPromptEstimateSnapshot | null): string[] {
  if (!snapshot) return [`${label}: none`];

  const estimate = snapshot.estimate;
  const state = snapshot.settled ? "settled" : "pending";
  const range = estimate.low !== estimate.high ? ` · range ${formatTokens(estimate.low)}–${formatTokens(estimate.high)}` : "";
  const warning = snapshot.warning ? [`  warning: ${snapshot.warning}`] : [];

  return [
    `${label}: ~${formatTokens(estimate.total)} tok (${snapshot.source}, ${state}, attempts=${snapshot.attempts}${range})`,
    `  key: ${snapshot.key}`,
    `  components: prompt=${formatTokens(estimate.promptText)} · tools=${formatTokens(estimate.toolSchemas)} (${estimate.toolCount}) · framing=${formatTokens(estimate.framing)} · uncal=${formatTokens(estimate.uncalibratedTotal)}`,
    `  calibration: ×${estimate.calibrationMultiplier.toFixed(4)} · samples=${estimate.calibrationSamples} · confidence=${estimate.confidence}`,
    `  systemPrompt: ${snapshot.systemPrompt.length} chars · hash=${debugHashText(snapshot.systemPrompt)}`,
    `  tools: ${formatDebugToolNames(snapshot)}`,
    ...warning,
  ];
}

function canCalibrateCurrentPromptEstimate(ctx: ExtensionContext): boolean {
  try {
    let sawFirstUser = false;
    for (const entry of ctx.sessionManager.getEntries()) {
      const record = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      if (record.type !== "message") continue;
      const message = (record.message && typeof record.message === "object" ? record.message : {}) as Record<string, unknown>;
      if (message.role === "user" && !sawFirstUser) sawFirstUser = true;
      if (message.role === "assistant" && message.usage) return sawFirstUser;
    }
  } catch {
    return false;
  }
  return false;
}

function buildWebuiFooterPayload(ctx: ExtensionContext, snapshot: GitSnapshot | null, telemetry: FooterTelemetry, fetchState: GitFetchState): WebuiFooterPayload {
  const speed = telemetry.latestTokenSpeed;
  const speedPrefix = telemetry.liveOutputTokens > 0 ? `${footerMetricValue(telemetry.liveOutputTokens)} tok @ ` : "";
  const providerPrefix = telemetry.showModelProvider && telemetry.modelProvider ? `(${telemetry.modelProvider}) ` : "";
  const thinkingSuffix = telemetry.thinkingLevel
    ? telemetry.thinkingLevel === "off"
      ? " • thinking off"
      : ` • ${telemetry.thinkingLevel}`
    : "";
  const piIsUncalibrated = telemetry.promptInjectionTokens !== null && telemetry.promptInjectionCalibrationSamples <= 0;
  const piCanCalibrateCurrent = piIsUncalibrated && telemetry.promptInjectionCanCalibrateCurrent;
  const piAction: WebuiFooterChip["action"] | undefined = piIsUncalibrated
    ? piCanCalibrateCurrent
      ? "calibrate-current"
      : "calibrate-probe"
    : undefined;
  const piTitle = telemetry.promptInjectionTokens === null
    ? "PI initial prompt estimate pending"
    : piAction === "calibrate-current"
      ? "PI initial prompt estimate is uncalibrated. Click to calibrate from this new session and refresh the value."
      : piAction === "calibrate-probe"
        ? "PI initial prompt estimate is uncalibrated. Click to start an isolated calibration probe and refresh the value."
        : `PI initial prompt estimate calibrated from ${telemetry.promptInjectionCalibrationSamples} sample${telemetry.promptInjectionCalibrationSamples === 1 ? "" : "s"}.`;

  const main: WebuiFooterChip[] = [];
  if (telemetry.totalInput || telemetry.totalOutput) {
    main.push({
      key: "tokens",
      icon: "🪙",
      label: "tokens",
      value: `↑${footerMetricValue(telemetry.totalInput)} · ↓${footerMetricValue(telemetry.totalOutput)}`,
      tone: "pink",
    });
  }
  if (telemetry.totalCacheRead || telemetry.totalCacheWrite) {
    main.push({
      key: "cache",
      icon: "💾",
      label: "cache",
      value: `R${footerMetricValue(telemetry.totalCacheRead)} · W${footerMetricValue(telemetry.totalCacheWrite)}`,
      tone: "blue",
    });
  }
  main.push({
    key: "pi",
    icon: "π",
    label: "pi",
    value: footerPromptInjectionValue(telemetry.promptInjectionTokens),
    title: piTitle,
    action: piAction,
    tone: "mauve",
  });
  if (speed !== null) {
    main.push({
      key: "speed",
      icon: "⚡",
      label: "speed",
      value: `${speedPrefix}${formatTokenSpeed(speed)} tok/s`,
      tone: "yellow",
    });
  }
  main.push({
    key: "cost",
    icon: "💸",
    label: telemetry.usingSubscription ? "sub" : "api",
    value: `$${telemetry.totalCost.toFixed(3)}`,
    tone: "green",
  });
  main.push({
    key: "context",
    icon: "🧠",
    label: "context",
    value: telemetry.contextDisplay,
    tone: "teal",
    contextUsage: {
      percent: telemetry.contextPercent,
      contextWindow: telemetry.contextWindow,
    },
  });

  const meta: WebuiFooterChip[] = [
    {
      key: "cwd",
      label: "cwd",
      value: formatCwd(ctx.cwd),
      title: `cwd: ${ctx.cwd}`,
    },
    {
      key: "context",
      label: "context",
      value: telemetry.contextDisplay,
      title: `context: ${telemetry.contextDisplay}`,
      contextUsage: {
        percent: telemetry.contextPercent,
        contextWindow: telemetry.contextWindow,
      },
    },
    ...buildWebuiGitMeta(snapshot, fetchState),
    {
      key: "model",
      label: "model",
      value: `${providerPrefix}${telemetry.modelName}${thinkingSuffix}`,
      title: `model: ${providerPrefix}${telemetry.modelName}${thinkingSuffix}`,
    },
  ];

  return {
    type: WEBUI_FOOTER_PAYLOAD_TYPE,
    version: WEBUI_FOOTER_PAYLOAD_VERSION,
    generatedAt: Date.now(),
    main,
    meta,
  };
}

export default function gitFooterStatus(pi: ExtensionAPI) {
  let refreshPromise: Promise<void> | null = null;
  let pendingRefreshOptions: GitRefreshOptions | null = null;
  let currentAssistantStartMs: number | null = null;
  let currentAssistantOutputChars = 0;
  let currentAssistantEstimatedOutputTokens = 0;
  let currentAssistantUsageOutputTokens = 0;
  let currentAssistantLiveTokenSpeed: number | null = null;
  let currentAssistantTokenSamples: LiveTokenSample[] = [];
  let latestMeasuredTokenSpeed: number | null = null;
  let footerUsageSnapshot: FooterUsageSnapshot = emptyFooterUsageSnapshot();
  let latestGitSnapshot: GitSnapshot | null = null;
  let latestGitSnapshotFingerprint: string | null = null;
  let latestGitFetchState: GitFetchState = { status: "idle" };
  let gitInitialFetchPromise: Promise<void> | null = null;
  let activeSessionSerial = 0;
  let latestPromptEstimateContext: ExtensionContext | null = null;
  // Timers and delayed PI-estimate callbacks can outlive the context that created them.
  // Keep the freshest context so idle git auto-refresh does not republish a stale cwd snapshot.
  let latestFooterContext: ExtensionContext | null = null;
  let latestFooterCwd = "";
  let requestFooterRender: (() => void) | null = null;
  let webuiFooterPublishTimer: ReturnType<typeof setTimeout> | null = null;
  let promptEstimateRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let footerUsageRecomputeTimer: ReturnType<typeof setTimeout> | null = null;
  let gitAutoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  // Non-UI modes (json/print) have no footer consumer; skip all background work.
  let backgroundWorkEnabled = false;
  let lastWebuiFooterPublishMs = 0;
  let promptEstimateCanCalibrateCurrent = false;
  let accountedAssistantUsageKeys = new Set<string>();
  let promptCalibrationCache: { sessionDir: string; value: ReturnType<typeof collectInitialPromptCalibration>; checkedAt: number } | null = null;

  const getPromptCalibration = (ctx: ExtensionContext) => {
    const sessionDir = ctx.sessionManager.getSessionDir();
    const now = Date.now();
    if (promptCalibrationCache?.sessionDir === sessionDir && now - promptCalibrationCache.checkedAt < 60_000) {
      return promptCalibrationCache.value;
    }
    const value = collectInitialPromptCalibration(sessionDir);
    promptCalibrationCache = { sessionDir, value, checkedAt: now };
    return value;
  };
  const promptEstimateService = createInitialPromptEstimateService({
    pi,
    getCalibration: getPromptCalibration,
    publishFallback: false,
    onUpdate: (_snapshot, ctx) => {
      const footerCtx = rememberFooterContext(ctx);
      requestFooterRender?.();
      publishWebuiFooter(footerCtx);
    },
  });
  let promptEstimateRefreshPromise: Promise<unknown> | null = null;

  const rememberPromptEstimateContext = (ctx: ExtensionContext) => {
    latestPromptEstimateContext = ctx;
  };

  const rememberFooterContext = (ctx: ExtensionContext): ExtensionContext => {
    const cwd = ctx.cwd || "";
    if (latestFooterCwd && cwd && latestFooterCwd !== cwd) {
      latestGitSnapshot = null;
      latestGitSnapshotFingerprint = null;
    }
    latestFooterCwd = cwd;
    latestFooterContext = ctx;
    rememberPromptEstimateContext(ctx);
    return ctx;
  };

  const getFooterContext = (fallback: ExtensionContext): ExtensionContext => latestFooterContext ?? fallback;

  // A captured pi/command ctx becomes stale after ctx.newSession(), ctx.fork(),
  // ctx.switchSession(), or ctx.reload() — which fresh-context subagents (e.g.
  // scout) trigger. Accessing a stale ctx (pi.exec, ctx.ui, ctx.cwd, ...)
  // throws synchronously, which bypasses runGit's `.catch(() => undefined)`
  // (the throw happens before a promise exists) and surfaces as an unhandled
  // rejection from the background timers below, killing the subagent process.
  // Detect it so timer/async refresh paths can stop the dead auto-refresh and
  // swallow instead of crashing.
  const isStaleExtensionContextError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("extension ctx is stale");
  };

  /** Returns true when the error was a stale-ctx error and has been handled. */
  const handleStaleExtensionContext = (error: unknown): boolean => {
    if (!isStaleExtensionContextError(error)) return false;
    stopGitAutoRefresh();
    return true;
  };

  /** Terminal handler for background/timer work: never throws, never rejects. */
  const swallowBackgroundError = (error: unknown): void => {
    if (handleStaleExtensionContext(error)) return;
    if (envFlag("PI_GIT_FOOTER_DEBUG", false)) {
      console.error("[git-footer-status] background task failed:", error);
    }
  };

  const mergeRefreshOptions = (current: GitRefreshOptions | null, next: GitRefreshOptions = {}): GitRefreshOptions => {
    const merged: GitRefreshOptions = {};
    if ((current === null || current.publishIfUnchanged === false) && next.publishIfUnchanged === false) merged.publishIfUnchanged = false;
    return merged;
  };

  const getEstimateContext = (fallback: ExtensionContext): ExtensionContext => latestPromptEstimateContext ?? fallback;

  const queuePromptInjectionEstimateRefresh = (ctx: ExtensionContext): Promise<unknown> => {
    if (!PROMPT_ESTIMATE_ENABLED) return Promise.resolve(null);
    const estimateCtx = getEstimateContext(ctx);
    promptEstimateRefreshPromise ??= promptEstimateService.refresh(estimateCtx).finally(() => {
      promptEstimateRefreshPromise = null;
    });
    return promptEstimateRefreshPromise;
  };

  const refreshPromptInjectionEstimate = async (ctx: ExtensionContext) => {
    if (!PROMPT_ESTIMATE_ENABLED) return;
    rememberFooterContext(ctx);
    await queuePromptInjectionEstimateRefresh(ctx);
  };

  const schedulePromptInjectionEstimateRefresh = (ctx: ExtensionContext, delayMs = PROMPT_ESTIMATE_REFRESH_DELAY_MS) => {
    if (!PROMPT_ESTIMATE_ENABLED || promptEstimateRefreshTimer || promptEstimateRefreshPromise) return;
    rememberFooterContext(ctx);
    const scheduledSerial = activeSessionSerial;
    promptEstimateRefreshTimer = setTimeout(() => {
      promptEstimateRefreshTimer = null;
      if (scheduledSerial !== activeSessionSerial) return;
      void refreshPromptInjectionEstimate(getEstimateContext(ctx)).catch(swallowBackgroundError);
    }, Math.max(0, delayMs));
    promptEstimateRefreshTimer.unref?.();
  };

  const getFooterPromptInjectionEstimate = (ctx: ExtensionContext): InitialPromptInputEstimate | null => {
    const snapshot = promptEstimateService.getSnapshot();
    if (!snapshot) schedulePromptInjectionEstimateRefresh(ctx);
    // Do not recompute/validate the estimate key from the render path. The key
    // computation walks system prompt/tool schemas and was the dominant startup
    // cost when the footer rendered before the background estimate settled.
    return snapshot?.estimate ?? null;
  };

  const buildFooterTelemetry = (ctx: ExtensionContext): FooterTelemetry => {
    const {
      totalInput,
      totalOutput,
      totalCacheRead,
      totalCacheWrite,
      totalCost,
      historicalTokenSpeed,
    } = footerUsageSnapshot;
    const liveOutputTokens = currentAssistantStartMs !== null ? currentAssistantEstimatedOutputTokens : 0;
    let latestTokenSpeed: number | null = currentAssistantStartMs !== null ? currentAssistantLiveTokenSpeed : latestMeasuredTokenSpeed;

    if (latestTokenSpeed === null && historicalTokenSpeed !== null) {
      latestTokenSpeed = historicalTokenSpeed;
    }

    const promptInjectionEstimate = getFooterPromptInjectionEstimate(ctx);
    const contextUsage = ctx.getContextUsage();
    const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
    const rawContextPercent = typeof contextUsage?.percent === "number" ? contextUsage.percent : null;
    const contextDisplay = rawContextPercent === null
      ? `?/${formatTokens(contextWindow)}`
      : `${rawContextPercent.toFixed(1)}%/${formatTokens(contextWindow)}`;

    return {
      totalInput,
      totalOutput,
      totalCacheRead,
      totalCacheWrite,
      totalCost,
      liveOutputTokens,
      latestTokenSpeed,
      promptInjectionTokens: promptInjectionEstimate?.total ?? null,
      promptInjectionCalibrationSamples: promptInjectionEstimate?.calibrationSamples ?? 0,
      promptInjectionCanCalibrateCurrent: promptEstimateCanCalibrateCurrent,
      contextWindow,
      contextPercent: rawContextPercent,
      contextDisplay,
      modelName: ctx.model?.id || "no-model",
      modelProvider: ctx.model?.provider || null,
      showModelProvider: ctx.model ? true : false,
      thinkingLevel: pi.getThinkingLevel(),
      usingSubscription: ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false,
    };
  };

  const publishWebuiFooter = (ctx: ExtensionContext, snapshot: GitSnapshot | null = latestGitSnapshot) => {
    try {
      const footerCtx = getFooterContext(ctx);
      lastWebuiFooterPublishMs = Date.now();
      const payload = buildWebuiFooterPayload(footerCtx, snapshot, buildFooterTelemetry(footerCtx), latestGitFetchState);
      footerCtx.ui.setStatus(WEBUI_FOOTER_STATUS_KEY, JSON.stringify(payload));
    } catch (error) {
      swallowBackgroundError(error);
    }
  };

  const scheduleWebuiFooterPublish = (ctx: ExtensionContext, delayMs = 250) => {
    if (webuiFooterPublishTimer) return;
    const elapsedMs = Date.now() - lastWebuiFooterPublishMs;
    const waitMs = Math.max(0, Math.min(delayMs, delayMs - elapsedMs));
    const scheduledSerial = activeSessionSerial;
    webuiFooterPublishTimer = setTimeout(() => {
      webuiFooterPublishTimer = null;
      if (scheduledSerial !== activeSessionSerial) return;
      // Do not capture latestGitSnapshot when scheduling. During streaming,
      // git auto-refresh can publish a newer snapshot before this throttle fires;
      // replaying the old snapshot makes Web UI CHANGES flip back and forth.
      publishWebuiFooter(ctx);
    }, waitMs);
    webuiFooterPublishTimer.unref?.();
  };

  const recomputeFooterUsageSnapshot = (ctx: ExtensionContext): FooterUsageSnapshot => {
    const snapshot = emptyFooterUsageSnapshot();
    const entries = ctx.sessionManager.getEntries();

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.type !== "message" || entry.message.role !== "assistant") continue;

      const message = entry.message as AssistantMessage;
      snapshot.totalInput += message.usage?.input ?? 0;
      snapshot.totalOutput += message.usage?.output ?? 0;
      snapshot.totalCacheRead += message.usage?.cacheRead ?? 0;
      snapshot.totalCacheWrite += message.usage?.cacheWrite ?? 0;
      snapshot.totalCost += message.usage?.cost?.total ?? 0;

      const outputTokens = message.usage?.output ?? 0;
      if (outputTokens <= 0) continue;

      const endMs = getEntryTimestampMs(entry);
      if (endMs === null) continue;

      let fallbackSpeed: number | null = null;
      for (let j = i - 1; j >= 0; j--) {
        const previous = entries[j];
        if (previous.type !== "message") continue;

        // Skip assistant-to-assistant deltas (too noisy for speed).
        if (previous.message.role === "assistant") continue;

        const startMs = getEntryTimestampMs(previous);
        if (startMs === null || endMs <= startMs) continue;

        const elapsedSeconds = (endMs - startMs) / 1000;
        if (elapsedSeconds <= 0) continue;

        const speed = outputTokens / elapsedSeconds;
        if (!isReasonableTokenSpeed(speed)) continue;

        // Prefer user-anchored speed (best approximation of full turn latency).
        if (previous.message.role === "user") {
          snapshot.historicalTokenSpeed = speed;
          break;
        }

        // Keep first non-assistant speed as fallback if no user message is found.
        if (fallbackSpeed === null) fallbackSpeed = speed;
      }

      if (fallbackSpeed !== null && snapshot.historicalTokenSpeed === null) {
        snapshot.historicalTokenSpeed = fallbackSpeed;
      }
    }

    return snapshot;
  };

  const assistantUsageKey = (message: AssistantMessage): string => {
    return message.responseId || `${message.timestamp}:${message.provider}:${message.model}:${message.usage?.input ?? 0}:${message.usage?.output ?? 0}`;
  };

  const addAssistantUsageToSnapshot = (message: AssistantMessage): boolean => {
    const usage = message.usage;
    if (!usage) return false;
    const hasUsage = Boolean(
      usage.input ||
        usage.output ||
        usage.cacheRead ||
        usage.cacheWrite ||
        usage.cost?.total,
    );
    if (!hasUsage) return false;

    const key = assistantUsageKey(message);
    if (accountedAssistantUsageKeys.has(key)) return false;
    accountedAssistantUsageKeys.add(key);

    footerUsageSnapshot.totalInput += usage.input ?? 0;
    footerUsageSnapshot.totalOutput += usage.output ?? 0;
    footerUsageSnapshot.totalCacheRead += usage.cacheRead ?? 0;
    footerUsageSnapshot.totalCacheWrite += usage.cacheWrite ?? 0;
    footerUsageSnapshot.totalCost += usage.cost?.total ?? 0;
    return true;
  };

  const refreshPromptCalibrationCapability = (ctx: ExtensionContext) => {
    promptEstimateCanCalibrateCurrent = canCalibrateCurrentPromptEstimate(ctx);
  };

  const scheduleFooterUsageRecompute = (ctx: ExtensionContext, delayMs = FOOTER_USAGE_RECOMPUTE_DELAY_MS) => {
    if (footerUsageRecomputeTimer) return;
    rememberFooterContext(ctx);
    const scheduledSerial = activeSessionSerial;
    footerUsageRecomputeTimer = setTimeout(() => {
      footerUsageRecomputeTimer = null;
      if (scheduledSerial !== activeSessionSerial) return;
      try {
        const footerCtx = getFooterContext(ctx);
        footerUsageSnapshot = recomputeFooterUsageSnapshot(footerCtx);
        refreshPromptCalibrationCapability(footerCtx);
        requestFooterRender?.();
        publishWebuiFooter(footerCtx);
      } catch (error) {
        swallowBackgroundError(error);
      }
    }, Math.max(0, delayMs));
    footerUsageRecomputeTimer.unref?.();
  };

  const recordAssistantSpeed = (message: AssistantMessage, endMs = Date.now()): boolean => {
    const outputTokens = message.usage?.output ?? 0;
    if (!outputTokens || currentAssistantStartMs === null || endMs <= currentAssistantStartMs) return false;

    const elapsedSeconds = (endMs - currentAssistantStartMs) / 1000;
    // Filter out impossible values caused by duplicate/misordered lifecycle events.
    if (elapsedSeconds < 0.05 || elapsedSeconds > 60 * 60) return false;

    const speed = outputTokens / elapsedSeconds;
    if (!isReasonableTokenSpeed(speed)) return false;

    latestMeasuredTokenSpeed = speed;
    return true;
  };

  const getRollingLiveTokenSpeed = (nowMs = Date.now()): number | null => {
    const cutoffMs = nowMs - LIVE_TOKEN_SPEED_ROLLING_WINDOW_MS;
    currentAssistantTokenSamples = currentAssistantTokenSamples.filter((sample) => sample.timestampMs >= cutoffMs);

    if (currentAssistantTokenSamples.length === 0) return null;

    const firstSampleMs = currentAssistantTokenSamples[0]?.timestampMs ?? nowMs;
    const windowStartMs = Math.max(currentAssistantStartMs ?? firstSampleMs, cutoffMs);
    const elapsedSeconds = (nowMs - windowStartMs) / 1000;
    if (elapsedSeconds <= 0) return null;

    const tokens = currentAssistantTokenSamples.reduce((sum, sample) => sum + sample.tokens, 0);
    const speed = tokens / elapsedSeconds;
    return isReasonableTokenSpeed(speed) ? speed : null;
  };

  const resetLiveAssistantState = () => {
    currentAssistantStartMs = null;
    currentAssistantOutputChars = 0;
    currentAssistantEstimatedOutputTokens = 0;
    currentAssistantUsageOutputTokens = 0;
    currentAssistantLiveTokenSpeed = null;
    currentAssistantTokenSamples = [];
  };

  const refreshOnce = async (ctx: ExtensionContext, options: GitRefreshOptions = {}) => {
    const footerCtx = rememberFooterContext(ctx);
    const refreshCwd = footerCtx.cwd || "";
    const snapshot = await readGitSnapshot(pi, refreshCwd);
    if (latestFooterCwd && refreshCwd && latestFooterCwd !== refreshCwd) return;

    const fingerprint = gitSnapshotFingerprint(snapshot);
    const changed = fingerprint !== latestGitSnapshotFingerprint;
    latestGitSnapshot = snapshot;
    latestGitSnapshotFingerprint = fingerprint;
    if (!changed && options.publishIfUnchanged === false) return;

    if (!snapshot) {
      footerCtx.ui.setStatus(GIT_FOOTER_STATUS_KEY, undefined);
      publishWebuiFooter(footerCtx, null);
      return;
    }

    footerCtx.ui.setStatus(GIT_FOOTER_STATUS_KEY, buildStatusText(footerCtx, snapshot));
    publishWebuiFooter(footerCtx, snapshot);
  };

  const refresh = async (ctx: ExtensionContext, options: GitRefreshOptions = {}) => {
    // A stale ctx throws synchronously from ctx.cwd here; because refresh is
    // async, that throw would reject the returned promise before the guarded
    // IIFE below is reachable, and fire-and-forget callers discard the promise.
    try {
      rememberFooterContext(ctx);
    } catch (error) {
      swallowBackgroundError(error);
      return;
    }
    pendingRefreshOptions = mergeRefreshOptions(pendingRefreshOptions, options);
    refreshPromise ??= (async () => {
      try {
        while (pendingRefreshOptions) {
          const nextOptions = pendingRefreshOptions;
          pendingRefreshOptions = null;
          await refreshOnce(getFooterContext(ctx), nextOptions);
        }
      } catch (error) {
        // readGitSnapshot -> pi.exec throws "extension ctx is stale"
        // synchronously when the session that scheduled this auto-refresh was
        // replaced/reloaded. Stop the timer so we stop poking the dead ctx;
        // the next session_start restarts it with a fresh ctx.
        swallowBackgroundError(error);
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  };

  const stopGitAutoRefresh = () => {
    if (!gitAutoRefreshTimer) return;
    clearInterval(gitAutoRefreshTimer);
    gitAutoRefreshTimer = null;
  };

  const startGitAutoRefresh = (ctx: ExtensionContext) => {
    rememberFooterContext(ctx);
    stopGitAutoRefresh();
    if (GIT_AUTO_REFRESH_INTERVAL_MS <= 0) return;
    const scheduledSerial = activeSessionSerial;
    gitAutoRefreshTimer = setInterval(() => {
      if (scheduledSerial !== activeSessionSerial) return;
      void refresh(getFooterContext(ctx), { publishIfUnchanged: false }).catch(swallowBackgroundError);
    }, GIT_AUTO_REFRESH_INTERVAL_MS);
    gitAutoRefreshTimer.unref?.();
  };

  const runInitialGitFetch = async (ctx: ExtensionContext, sessionSerial: number) => {
    if (!GIT_INITIAL_FETCH_ENABLED) {
      latestGitFetchState = { status: "skipped", message: "startup fetch disabled by PI_GIT_FOOTER_FETCH=0" };
      return;
    }
    if (gitInitialFetchPromise || !latestGitSnapshot) return;

    const remotes = await runGit(pi, ctx.cwd, ["remote"], 2000);
    if (sessionSerial !== activeSessionSerial || !remotes) return;

    latestGitFetchState = { status: "fetching", startedAt: Date.now(), message: "git fetch" };
    publishWebuiFooter(ctx);
    requestFooterRender?.();

    gitInitialFetchPromise = pi
      .exec("git", ["-c", "credential.interactive=false", "fetch"], { cwd: ctx.cwd, timeout: GIT_INITIAL_FETCH_TIMEOUT_MS })
      .then((result) => {
        if (sessionSerial !== activeSessionSerial) return;
        latestGitFetchState = {
          status: result.code === 0 ? "ok" : "error",
          startedAt: latestGitFetchState.startedAt,
          completedAt: Date.now(),
          message: gitFetchResultMessage(result),
        };
      })
      .catch((error) => {
        if (sessionSerial !== activeSessionSerial) return;
        latestGitFetchState = {
          status: "error",
          startedAt: latestGitFetchState.startedAt,
          completedAt: Date.now(),
          message: compactFetchMessage(error instanceof Error ? error.message : String(error)),
        };
      })
      .finally(() => {
        if (sessionSerial !== activeSessionSerial) return;
        gitInitialFetchPromise = null;
        void refresh(ctx).catch(swallowBackgroundError);
        requestFooterRender?.();
      });

    await gitInitialFetchPromise;
  };

  pi.on("session_start", async (_event, ctx) => {
    backgroundWorkEnabled = ctx.hasUI;
    if (!backgroundWorkEnabled) return;
    const sessionSerial = ++activeSessionSerial;
    gitInitialFetchPromise = null;
    latestGitFetchState = { status: "idle" };
    promptEstimateService.clear();
    latestPromptEstimateContext = null;
    latestFooterContext = ctx;
    latestFooterCwd = ctx.cwd || "";
    latestGitSnapshot = null;
    latestGitSnapshotFingerprint = null;
    footerUsageSnapshot = emptyFooterUsageSnapshot();
    accountedAssistantUsageKeys = new Set<string>();
    promptEstimateCanCalibrateCurrent = false;
    promptCalibrationCache = null;
    stopGitAutoRefresh();
    scheduleFooterUsageRecompute(ctx);
    schedulePromptInjectionEstimateRefresh(ctx);

    ctx.ui.setFooter((tui, theme, footerData) => {
      const render = () => tui.requestRender();
      requestFooterRender = render;
      const unsub = footerData.onBranchChange(render);

      return {
        dispose() {
          unsub();
          if (requestFooterRender === render) requestFooterRender = null;
        },
        invalidate() {},
        render(width: number): string[] {
          const footerCtx = getFooterContext(ctx);
          const telemetry = buildFooterTelemetry(footerCtx);
          const contextPercentValue = telemetry.contextPercent ?? 0;

          let contextPercentStr: string;
          if (telemetry.contextPercent === null) {
            contextPercentStr = theme.fg("dim", telemetry.contextDisplay);
          } else if (contextPercentValue < 50) {
            contextPercentStr = theme.fg("success", telemetry.contextDisplay);
          } else if (contextPercentValue < 65) {
            contextPercentStr = theme.fg("accent", telemetry.contextDisplay);
          } else if (contextPercentValue < 75) {
            contextPercentStr = theme.fg("muted", telemetry.contextDisplay);
          } else if (contextPercentValue < 85) {
            contextPercentStr = theme.fg("warning", telemetry.contextDisplay);
          } else {
            contextPercentStr = theme.fg("error", telemetry.contextDisplay);
          }

          const sectionSep = theme.fg("dim", "│");
          const itemSep = theme.fg("dim", "·");

          const ioItems: string[] = [];
          if (telemetry.totalInput) ioItems.push(`↑${formatTokens(telemetry.totalInput)}`);
          if (telemetry.totalOutput) ioItems.push(`↓${formatTokens(telemetry.totalOutput)}`);

          const cacheItems: string[] = [];
          if (telemetry.totalCacheRead || telemetry.totalCacheWrite) {
            cacheItems.push(`R${formatTokens(telemetry.totalCacheRead)}`, `W${formatTokens(telemetry.totalCacheWrite)}`);
          }

          const segments: string[] = [];
          if (ioItems.length > 0) segments.push(`${theme.fg("muted", "🪙")} ${ioItems.join(` ${itemSep} `)}`);
          if (cacheItems.length > 0) segments.push(`${theme.fg("muted", "💾")} ${cacheItems.join(` ${itemSep} `)}`);
          segments.push(telemetry.promptInjectionTokens === null ? "PI: …" : `PI: ${formatTokens(telemetry.promptInjectionTokens)} tok`);
          if (telemetry.latestTokenSpeed !== null) {
            const livePrefix = telemetry.liveOutputTokens > 0 ? `${formatTokens(telemetry.liveOutputTokens)} tok @ ` : "";
            segments.push(`⚡ ${livePrefix}${formatTokenSpeed(telemetry.latestTokenSpeed)} tok/s`);
          }

          if (telemetry.totalCost || telemetry.usingSubscription) {
            segments.push(`${theme.fg("muted", "💸")} $${telemetry.totalCost.toFixed(3)}${telemetry.usingSubscription ? " (sub)" : ""}`);
          }

          segments.push(`${theme.fg("muted", "🧠")} ${contextPercentStr}`);

          let statsLeft = segments.join(` ${sectionSep} `);
          let statsLeftWidth = visibleWidth(statsLeft);
          if (statsLeftWidth > width) {
            statsLeft = truncateToWidth(statsLeft, width, "...");
            statsLeftWidth = visibleWidth(statsLeft);
          }

          const rightSideWithoutProvider =
            footerCtx.model?.reasoning
              ? telemetry.thinkingLevel === "off"
                ? `${telemetry.modelName} • thinking off`
                : `${telemetry.modelName} • ${telemetry.thinkingLevel}`
              : telemetry.modelName;

          let rightSide = rightSideWithoutProvider;
          if (footerData.getAvailableProviderCount() > 1 && telemetry.modelProvider) {
            const withProvider = `(${telemetry.modelProvider}) ${rightSideWithoutProvider}`;
            if (statsLeftWidth + 2 + visibleWidth(withProvider) <= width) {
              rightSide = withProvider;
            }
          }

          const rightSideWidth = visibleWidth(rightSide);
          const totalNeeded = statsLeftWidth + 2 + rightSideWidth;
          let tokenLine: string;

          if (totalNeeded <= width) {
            const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
            tokenLine = statsLeft + padding + rightSide;
          } else {
            const availableForRight = width - statsLeftWidth - 2;
            if (availableForRight > 0) {
              const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
              const truncatedRightWidth = visibleWidth(truncatedRight);
              const padding = " ".repeat(Math.max(0, width - statsLeftWidth - truncatedRightWidth));
              tokenLine = statsLeft + padding + truncatedRight;
            } else {
              tokenLine = statsLeft;
            }
          }

          const branch = footerData.getGitBranch();
          const cwdWithBranch = `${formatCwd(footerCtx.cwd)}${branch ? ` (${branch})` : ""}`;
          const cwdText = theme.fg("muted", cwdWithBranch);

          const statuses = footerData.getExtensionStatuses();
          const gitStatus = statuses.get(GIT_FOOTER_STATUS_KEY);
          const otherStatuses = Array.from(statuses.entries())
            .filter(([key, value]) => key !== GIT_FOOTER_STATUS_KEY && key !== WEBUI_FOOTER_STATUS_KEY && Boolean(value))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, value]) => value as string);

          const combinedStatusParts = [gitStatus, ...otherStatuses].filter(Boolean) as string[];
          const combinedStatus = combinedStatusParts.join(` ${theme.fg("dim", "·")} `);
          const pathGitLine = combinedStatus ? `${cwdText}${theme.fg("dim", " │ ")}${combinedStatus}` : cwdText;

          // Keep default subtle-grey look even when parts contain their own ANSI colors.
          // Wrapping the whole line once is not enough because inner color resets cancel outer dim.
          const dimStatsLeft = theme.fg("dim", statsLeft);
          const remainder = tokenLine.slice(statsLeft.length);
          const dimRemainder = theme.fg("dim", remainder);

          return [truncateToWidth(dimStatsLeft + dimRemainder, width), truncateToWidth(pathGitLine, width)];
        },
      };
    });

    void refresh(ctx)
      .then(() => runInitialGitFetch(ctx, sessionSerial))
      .catch(swallowBackgroundError);
    startGitAutoRefresh(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    if (!backgroundWorkEnabled) return;
    schedulePromptInjectionEstimateRefresh(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!backgroundWorkEnabled) return;
    rememberFooterContext(ctx);
    resetLiveAssistantState();
    refreshPromptCalibrationCapability(ctx);
    requestFooterRender?.();
    schedulePromptInjectionEstimateRefresh(ctx);
    void refresh(ctx).catch(swallowBackgroundError);
  });

  pi.on("message_start", (event, ctx) => {
    if (!backgroundWorkEnabled) return;
    rememberFooterContext(ctx);
    if (event.message.role === "assistant") {
      currentAssistantStartMs = Date.now();
      currentAssistantOutputChars = 0;
      currentAssistantEstimatedOutputTokens = 0;
      currentAssistantUsageOutputTokens = 0;
      currentAssistantLiveTokenSpeed = null;
      currentAssistantTokenSamples = [];
      publishWebuiFooter(ctx);
    }
  });

  pi.on("message_update", (event, ctx) => {
    if (!backgroundWorkEnabled) return;
    rememberFooterContext(ctx);
    if (event.message.role !== "assistant" || currentAssistantStartMs === null) return;

    const streamEvent = event.assistantMessageEvent;
    if (
      streamEvent.type !== "text_delta" &&
      streamEvent.type !== "thinking_delta" &&
      streamEvent.type !== "toolcall_delta"
    ) {
      return;
    }

    const nowMs = Date.now();
    currentAssistantOutputChars += streamEvent.delta.length;

    const usageOutputTokens = streamEvent.partial.usage?.output;
    let newTokens = 0;
    if (typeof usageOutputTokens === "number" && usageOutputTokens > currentAssistantUsageOutputTokens) {
      newTokens = usageOutputTokens - currentAssistantUsageOutputTokens;
      currentAssistantUsageOutputTokens = usageOutputTokens;
      currentAssistantEstimatedOutputTokens = usageOutputTokens;
    } else if (currentAssistantUsageOutputTokens <= 0) {
      const estimatedOutputTokens = estimateTokensFromCharCount(currentAssistantOutputChars);
      newTokens = Math.max(0, estimatedOutputTokens - currentAssistantEstimatedOutputTokens);
      currentAssistantEstimatedOutputTokens = estimatedOutputTokens;
    }

    if (newTokens > 0) {
      currentAssistantTokenSamples.push({ timestampMs: nowMs, tokens: newTokens });
    }

    currentAssistantLiveTokenSpeed = getRollingLiveTokenSpeed(nowMs);
    scheduleWebuiFooterPublish(ctx);
  });

  pi.on("message_end", (event, ctx) => {
    if (!backgroundWorkEnabled) return;
    rememberFooterContext(ctx);
    if (event.message.role === "assistant") {
      const assistantMessage = event.message as AssistantMessage;
      addAssistantUsageToSnapshot(assistantMessage);
      if (recordAssistantSpeed(assistantMessage)) {
        resetLiveAssistantState();
      }
      publishWebuiFooter(ctx);
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    if (!backgroundWorkEnabled) return;
    rememberFooterContext(ctx);
    // Safety net for runtimes where message_end fires before usage is populated.
    if (event.message.role === "assistant") {
      const assistantMessage = event.message as AssistantMessage;
      addAssistantUsageToSnapshot(assistantMessage);
      recordAssistantSpeed(assistantMessage);
      resetLiveAssistantState();
    }
    refreshPromptCalibrationCapability(ctx);
    requestFooterRender?.();
    schedulePromptInjectionEstimateRefresh(ctx);
    void refresh(ctx).catch(swallowBackgroundError);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    backgroundWorkEnabled = false;
    activeSessionSerial += 1;
    gitInitialFetchPromise = null;
    latestGitFetchState = { status: "idle" };
    stopGitAutoRefresh();
    if (webuiFooterPublishTimer) {
      clearTimeout(webuiFooterPublishTimer);
      webuiFooterPublishTimer = null;
    }
    if (promptEstimateRefreshTimer) {
      clearTimeout(promptEstimateRefreshTimer);
      promptEstimateRefreshTimer = null;
    }
    if (footerUsageRecomputeTimer) {
      clearTimeout(footerUsageRecomputeTimer);
      footerUsageRecomputeTimer = null;
    }
    latestGitSnapshotFingerprint = null;
    latestFooterContext = null;
    latestFooterCwd = "";
    try {
      ctx.ui.setStatus(GIT_FOOTER_STATUS_KEY, undefined);
      ctx.ui.setStatus(WEBUI_FOOTER_STATUS_KEY, undefined);
      ctx.ui.setFooter(undefined);
    } catch (error) {
      // Shutdown can race context invalidation.
      swallowBackgroundError(error);
    }
  });

  pi.registerCommand("git-footer-refresh", {
    description: "Refresh git footer information",
    handler: async (args, ctx) => {
      const silent = /(?:^|\s)--webui-silent(?:\s|$)/.test(args || "");
      rememberFooterContext(ctx);
      await refreshPromptInjectionEstimate(ctx);
      await refresh(ctx);
      if (!silent) ctx.ui.notify("Git footer refreshed", "info");
    },
  });

  pi.registerCommand("git-footer-pi-debug", {
    description: "Show git footer PI initial prompt estimate diagnostics.",
    handler: async (_args, ctx) => {
      rememberFooterContext(ctx);
      const cachedBefore = promptEstimateService.getSnapshot();
      const fallbackNow = promptEstimateService.getFallbackSnapshot(ctx);
      const freshSharedEstimate = await estimateStableInitialPromptFromPiContext(pi, ctx, getPromptCalibration);
      const refreshResult = await promptEstimateService.refresh(ctx);
      const cachedAfter = promptEstimateService.getSnapshot();
      const modelLabel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none";
      const sessionId = ctx.sessionManager.getSessionId?.() ?? "unknown";

      ctx.ui.notify(
        [
          "Git footer PI estimate debug",
          `model: ${modelLabel}`,
          `session: ${sessionId}`,
          `service refresh: ${refreshResult.status}`,
          "",
          ...formatPromptEstimateDebugSnapshot("footer cached before", cachedBefore),
          "",
          ...formatPromptEstimateDebugSnapshot("live fallback now", fallbackNow),
          "",
          ...formatPromptEstimateDebugSnapshot("fresh shared estimate", freshSharedEstimate),
          "",
          ...formatPromptEstimateDebugSnapshot("footer cached after", cachedAfter),
        ].join("\n"),
        "info",
      );
    },
  });

  pi.registerShortcut("ctrl+shift+g", {
    description: "Show git signing mismatch diagnostics",
    handler: async (ctx) => {
      rememberFooterContext(ctx);
      const diagnostics = await getSigningDiagnostics(pi, ctx.cwd);
      if (!diagnostics.commitSignRequired) {
        ctx.ui.notify("Signing mismatch: commit.gpgsign is OFF", "info");
        return;
      }

      if (!["N", "E"].includes(diagnostics.signState)) {
        ctx.ui.notify("Signing mismatch: not currently triggered", "info");
        return;
      }

      ctx.ui.notify(
        `Signing mismatch details: commit.gpgsign=ON, last-sign-state=${diagnostics.signState}, gpg.format=${diagnostics.gpgFormat}, user.signingkey=${diagnostics.signingKey}`,
        "warning",
      );
    },
  });
}
