import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { expandTilde, formatUserPath as formatPath, getAgentDir, writeJsonFileAtomicSync } from "@firstpick/pi-utils";

type CdHistoryEntry = {
  path: string;
  uses: number;
  firstUsed: number;
  lastUsed: number;
};

type CdStore = {
  version: 1;
  aliases: Record<string, string>;
  history: CdHistoryEntry[];
};

type SuggestionSource = "alias" | "history" | "child" | "special";

type CdSuggestion = {
  value: string;
  label: string;
  targetPath: string;
  description: string;
  source: SuggestionSource;
  score: number;
};

const STORE_VERSION = 1;
const MAX_HISTORY_ENTRIES = 200;
const MAX_SUGGESTIONS = 24;
const MAX_CHILDREN_SCANNED = 300;
const STATUS_KEY = "cd-history";

const RESERVED_ALIAS_NAMES = new Set([
  ".",
  "..",
  "~",
  "--add",
  "--clear-history",
  "--help",
  "--list",
  "--remove",
  "--rm",
  "--status",
]);

function getStorePath(): string {
  const configured = process.env.PI_CD_HISTORY_STORE_PATH?.trim();
  return configured ? path.resolve(expandTilde(configured)) : path.join(getAgentDir(), "state", "cd-history.json");
}

function emptyStore(): CdStore {
  return { version: STORE_VERSION, aliases: {}, history: [] };
}

function canonicalPath(input: string, baseDir?: string): string {
  const expanded = expandTilde(input.trim());
  const resolved = path.resolve(baseDir ?? process.cwd(), expanded);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function isDirectory(input: string): boolean {
  try {
    return fs.statSync(input).isDirectory();
  } catch {
    return false;
  }
}

function normalizeDirectory(input: string, baseDir?: string): string | undefined {
  const resolved = canonicalPath(input, baseDir);
  return isDirectory(resolved) ? resolved : undefined;
}

function formatAge(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function readStore(storePath: string): CdStore {
  if (!fs.existsSync(storePath)) return emptyStore();

  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyStore();

    const store = emptyStore();
    const rawAliases = (parsed as { aliases?: unknown }).aliases;
    if (rawAliases && typeof rawAliases === "object" && !Array.isArray(rawAliases)) {
      for (const [name, target] of Object.entries(rawAliases)) {
        if (!isValidAliasName(name) || typeof target !== "string") continue;
        const normalized = normalizeDirectory(target);
        if (normalized) store.aliases[name] = normalized;
      }
    }

    const rawHistory = (parsed as { history?: unknown }).history;
    if (Array.isArray(rawHistory)) {
      for (const item of rawHistory) {
        if (!item || typeof item !== "object") continue;
        const record = item as { path?: unknown; uses?: unknown; firstUsed?: unknown; lastUsed?: unknown };
        if (typeof record.path !== "string") continue;
        const normalized = normalizeDirectory(record.path);
        if (!normalized) continue;
        const uses = typeof record.uses === "number" && Number.isFinite(record.uses) ? Math.max(1, Math.floor(record.uses)) : 1;
        const firstUsed = typeof record.firstUsed === "number" && Number.isFinite(record.firstUsed) ? record.firstUsed : Date.now();
        const lastUsed = typeof record.lastUsed === "number" && Number.isFinite(record.lastUsed) ? record.lastUsed : firstUsed;
        store.history.push({ path: normalized, uses, firstUsed, lastUsed });
      }
    }

    return compactStore(store);
  } catch {
    return emptyStore();
  }
}

function writeStore(storePath: string, store: CdStore): void {
  try {
    writeJsonFileAtomicSync(storePath, compactStore(store));
  } catch {
    // Directory changes should still work if persistence fails.
  }
}

function compactStore(store: CdStore): CdStore {
  const byPath = new Map<string, CdHistoryEntry>();
  for (const entry of store.history) {
    const normalized = normalizeDirectory(entry.path);
    if (!normalized) continue;
    const existing = byPath.get(normalized);
    if (!existing) {
      byPath.set(normalized, { ...entry, path: normalized });
      continue;
    }
    existing.uses += Math.max(1, entry.uses);
    existing.firstUsed = Math.min(existing.firstUsed, entry.firstUsed);
    existing.lastUsed = Math.max(existing.lastUsed, entry.lastUsed);
  }

  const aliases: Record<string, string> = {};
  for (const [name, target] of Object.entries(store.aliases)) {
    if (!isValidAliasName(name)) continue;
    const normalized = normalizeDirectory(target);
    if (normalized) aliases[name] = normalized;
  }

  const history = Array.from(byPath.values())
    .sort((a, b) => b.lastUsed - a.lastUsed || b.uses - a.uses || a.path.localeCompare(b.path))
    .slice(0, MAX_HISTORY_ENTRIES);

  return { version: STORE_VERSION, aliases, history };
}

function recordVisit(store: CdStore, targetPath: string): CdStore {
  const normalized = normalizeDirectory(targetPath);
  if (!normalized) return store;

  const now = Date.now();
  const next = compactStore(store);
  const existing = next.history.find((entry) => entry.path === normalized);
  if (existing) {
    existing.uses += 1;
    existing.lastUsed = now;
  } else {
    next.history.unshift({ path: normalized, uses: 1, firstUsed: now, lastUsed: now });
  }
  return compactStore(next);
}

function isValidAliasName(name: string): boolean {
  if (RESERVED_ALIAS_NAMES.has(name)) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name);
}

function splitArgs(input: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaped) current += "\\";
  if (current) words.push(current);
  return words;
}

function fuzzyScore(text: string, query: string): number {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (!lowerQuery) return 0;

  let textIndex = 0;
  let gapPenalty = 0;
  for (const queryChar of lowerQuery) {
    const found = lowerText.indexOf(queryChar, textIndex);
    if (found === -1) return Number.NEGATIVE_INFINITY;
    gapPenalty += found - textIndex;
    textIndex = found + 1;
  }

  return 350 - gapPenalty;
}

function matchScore(suggestion: CdSuggestion, query: string): number {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return suggestion.score;

  const basename = path.basename(suggestion.targetPath).toLowerCase();
  const fields = [suggestion.value, suggestion.label, basename, formatPath(suggestion.targetPath), suggestion.targetPath].map((value) => value.toLowerCase());

  if (fields.some((field) => field === trimmed)) return suggestion.score + 3000;
  if (suggestion.value.toLowerCase().startsWith(trimmed)) return suggestion.score + 2200;
  if (basename.startsWith(trimmed)) return suggestion.score + 1800;
  if (fields.some((field) => field.includes(trimmed))) return suggestion.score + 1200;

  const bestFuzzy = Math.max(...fields.map((field) => fuzzyScore(field, trimmed)));
  return Number.isFinite(bestFuzzy) ? suggestion.score + bestFuzzy : Number.NEGATIVE_INFINITY;
}

function addSuggestion(map: Map<string, CdSuggestion>, suggestion: CdSuggestion): void {
  const key = `${suggestion.source}:${suggestion.value}:${suggestion.targetPath}`;
  const existing = map.get(key);
  if (!existing || suggestion.score > existing.score) map.set(key, suggestion);
}

function readChildDirectories(cwd: string): CdSuggestion[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(cwd, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_CHILDREN_SCANNED)
    .map((entry) => {
      const targetPath = canonicalPath(path.join(cwd, entry.name));
      return {
        value: entry.name,
        label: entry.name,
        targetPath,
        description: formatPath(targetPath),
        source: "child" as const,
        score: entry.name.startsWith(".") ? 180 : 260,
      };
    });
}

function buildSuggestions(cwd: string, store: CdStore, query = ""): CdSuggestion[] {
  const suggestions = new Map<string, CdSuggestion>();
  const normalizedCwd = canonicalPath(cwd);
  const parent = path.dirname(normalizedCwd);
  const home = canonicalPath(os.homedir());
  const now = Date.now();

  addSuggestion(suggestions, {
    value: "..",
    label: "..",
    targetPath: parent,
    description: formatPath(parent),
    source: "special",
    score: 360,
  });
  addSuggestion(suggestions, {
    value: "~",
    label: "~",
    targetPath: home,
    description: formatPath(home),
    source: "special",
    score: 320,
  });

  for (const [alias, targetPath] of Object.entries(store.aliases)) {
    if (!isDirectory(targetPath)) continue;
    addSuggestion(suggestions, {
      value: alias,
      label: alias,
      targetPath,
      description: `alias → ${formatPath(targetPath)}`,
      source: "alias",
      score: 1200,
    });
  }

  for (const entry of store.history) {
    if (!isDirectory(entry.path)) continue;
    const ageDays = Math.max(0, (now - entry.lastUsed) / 86_400_000);
    const recency = Math.max(0, 120 - ageDays * 4);
    addSuggestion(suggestions, {
      value: formatPath(entry.path),
      label: path.basename(entry.path) || entry.path,
      targetPath: entry.path,
      description: `${formatPath(entry.path)} · ${entry.uses} use${entry.uses === 1 ? "" : "s"} · ${formatAge(entry.lastUsed)}`,
      source: "history",
      score: 520 + entry.uses * 24 + recency,
    });
  }

  for (const child of readChildDirectories(normalizedCwd)) {
    addSuggestion(suggestions, child);
  }

  return Array.from(suggestions.values())
    .map((suggestion) => ({ suggestion, score: matchScore(suggestion, query) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score || a.suggestion.label.localeCompare(b.suggestion.label))
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => entry.suggestion);
}

function quoteArg(value: string): string {
  if (/^[^\s"'\\]+$/.test(value)) return value;
  return `"${value.replace(/["\\]/g, (match) => `\\${match}`)}"`;
}

function suggestionsToAutocompleteItems(suggestions: CdSuggestion[]): AutocompleteItem[] {
  return suggestions.map((suggestion) => ({
    value: suggestion.value,
    label: suggestion.label,
    description: suggestion.description,
  }));
}

function resolveTarget(rawArgs: string, cwd: string, store: CdStore): { targetPath?: string; suggestions: CdSuggestion[] } {
  const target = rawArgs.trim();
  if (!target || target === ".") return { targetPath: canonicalPath(cwd), suggestions: [] };

  const aliasTarget = store.aliases[target];
  if (aliasTarget && isDirectory(aliasTarget)) {
    return { targetPath: aliasTarget, suggestions: [] };
  }

  const direct = normalizeDirectory(target, cwd);
  if (direct) return { targetPath: direct, suggestions: [] };

  const suggestions = buildSuggestions(cwd, store, target);
  const exact = suggestions.find((suggestion) =>
    suggestion.value === target ||
    suggestion.label === target ||
    formatPath(suggestion.targetPath) === target ||
    suggestion.targetPath === target
  );
  if (exact) return { targetPath: exact.targetPath, suggestions };

  return { suggestions };
}

function ensureEmptySessionFile(targetPath: string): string {
  const sessionManager = SessionManager.create(targetPath);
  const sessionPath = sessionManager.getSessionFile();
  if (!sessionPath) throw new Error("Unable to create a persistent Pi session for target directory");

  const internal = sessionManager as unknown as { fileEntries?: unknown[]; _rewriteFile?: () => void };
  if (typeof internal._rewriteFile === "function") {
    internal._rewriteFile();
    return sessionPath;
  }

  const entries = internal.fileEntries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("Unable to initialize target Pi session header");
  }
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, { flag: "wx" });
  return sessionPath;
}

function createTargetSession(currentSessionPath: string | undefined, targetPath: string): string {
  if (currentSessionPath && fs.existsSync(currentSessionPath)) {
    try {
      const forked = SessionManager.forkFrom(currentSessionPath, targetPath);
      const forkedPath = forked.getSessionFile();
      if (forkedPath) return forkedPath;
    } catch {
      // Fall back to a clean target session if the current session file is absent/corrupt.
    }
  }

  return ensureEmptySessionFile(targetPath);
}

async function selectTarget(ctx: ExtensionCommandContext, suggestions: CdSuggestion[], title: string): Promise<CdSuggestion | undefined> {
  if (!ctx.hasUI || suggestions.length === 0) return undefined;

  const items = suggestions.map((suggestion, index) => {
    const prefix = suggestion.source === "alias" ? "★" : suggestion.source === "history" ? "↺" : suggestion.source === "special" ? "•" : "dir";
    return `${prefix} ${suggestion.label} — ${suggestion.description} [${index + 1}]`;
  });
  const selected = await ctx.ui.select(title, items);
  if (!selected) return undefined;
  const index = items.indexOf(selected);
  return index >= 0 ? suggestions[index] : undefined;
}

function helpText(): string {
  return [
    "/cd [dir|alias]       change Pi session cwd, preserving conversation by forking into the target cwd",
    "/cd                  pick from ranked aliases, history, parent/home, and child directories",
    "/cd --add <name> [dir]  add alias so /cd <name> jumps to dir (default: current cwd)",
    "/cd --remove <name>   remove an alias",
    "/cd --list            pick from aliases/history",
    "/cd --status          show store path and counts",
    "/cd --clear-history   clear learned directory history (aliases stay)",
  ].join("\n");
}

async function changeDirectory(
  ctx: ExtensionCommandContext,
  targetPath: string,
  getStore: () => CdStore,
  setStore: (store: CdStore) => void,
): Promise<void> {
  await ctx.waitForIdle();

  const normalizedTarget = normalizeDirectory(targetPath);
  if (!normalizedTarget) {
    ctx.ui.notify(`cd: not a directory: ${targetPath}`, "error");
    return;
  }

  const current = canonicalPath(ctx.cwd);
  if (normalizedTarget === current) {
    const store = recordVisit(getStore(), normalizedTarget);
    setStore(store);
    ctx.ui.notify(`Already in ${formatPath(normalizedTarget)}`, "info");
    return;
  }

  const currentSessionPath = ctx.sessionManager.getSessionFile();
  let targetSessionPath: string;
  try {
    targetSessionPath = createTargetSession(currentSessionPath, normalizedTarget);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`cd: failed to create target session: ${message}`, "error");
    return;
  }

  setStore(recordVisit(getStore(), normalizedTarget));

  const result = await ctx.switchSession(targetSessionPath, {
    withSession: async (nextCtx) => {
      nextCtx.ui.notify(`cd → ${formatPath(normalizedTarget)}`, "info");
      nextCtx.ui.setStatus(STATUS_KEY, `cwd ${formatPath(normalizedTarget)}`);
    },
  });

  if (result.cancelled) {
    ctx.ui.notify(`cd cancelled: ${formatPath(normalizedTarget)}`, "warning");
  }
}

function addAlias(store: CdStore, name: string, targetPath: string): CdStore {
  if (!isValidAliasName(name)) {
    throw new Error(`Invalid alias '${name}'. Use letters, numbers, dot, underscore, or dash; start with a letter/number.`);
  }
  const normalized = normalizeDirectory(targetPath);
  if (!normalized) throw new Error(`Not a directory: ${targetPath}`);
  return compactStore({ ...store, aliases: { ...store.aliases, [name]: normalized } });
}

function removeAlias(store: CdStore, name: string): CdStore {
  const aliases = { ...store.aliases };
  delete aliases[name];
  return compactStore({ ...store, aliases });
}

export default function cdHistoryExtension(pi: ExtensionAPI) {
  const storePath = getStorePath();
  let store = readStore(storePath);
  let currentCwd = canonicalPath(process.cwd());

  const setStore = (nextStore: CdStore) => {
    store = compactStore(nextStore);
    writeStore(storePath, store);
  };

  const refreshStore = () => {
    store = readStore(storePath);
  };

  pi.on("session_start", (_event, ctx) => {
    currentCwd = canonicalPath(ctx.cwd);
    refreshStore();
    ctx.ui.setStatus(STATUS_KEY, `cwd ${formatPath(currentCwd)}`);
  });

  pi.registerCommand("cd", {
    description: "Change Pi working directory with ranked history and aliases",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      refreshStore();
      const trimmed = prefix.trimStart();
      const words = splitArgs(trimmed);
      const commandOptions = ["--add", "--remove", "--list", "--status", "--clear-history", "--help"];

      if (trimmed.startsWith("--") && words.length <= 1 && !trimmed.endsWith(" ")) {
        const filtered = commandOptions.filter((option) => option.startsWith(trimmed));
        return filtered.length > 0 ? filtered.map((option) => ({ value: option, label: option })) : null;
      }

      if (words[0] === "--remove" || words[0] === "--rm") {
        const option = words[0];
        const partial = words[1] ?? "";
        const items = Object.entries(store.aliases)
          .filter(([name]) => name.startsWith(partial))
          .map(([name, target]) => ({ value: `${option} ${name}`, label: name, description: formatPath(target) }));
        return items.length > 0 ? items : null;
      }

      if (words[0] === "--add" && words[1] && (trimmed.endsWith(" ") || words.length >= 3)) {
        const aliasName = words[1];
        const pathPrefix = words.length >= 3 ? words.slice(2).join(" ") : "";
        const items = buildSuggestions(currentCwd, store, pathPrefix).map((suggestion) => ({
          value: `--add ${aliasName} ${quoteArg(formatPath(suggestion.targetPath))}`,
          label: suggestion.label,
          description: suggestion.description,
        }));
        return items.length > 0 ? items : null;
      }

      const items = suggestionsToAutocompleteItems(buildSuggestions(currentCwd, store, prefix));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      refreshStore();
      currentCwd = canonicalPath(ctx.cwd);
      const trimmed = args.trim();

      if (trimmed === "--help" || trimmed === "-h") {
        ctx.ui.notify(helpText(), "info");
        return;
      }

      if (trimmed === "--status") {
        ctx.ui.notify(
          `cd-history: ${Object.keys(store.aliases).length} aliases · ${store.history.length} history entries · store ${storePath}`,
          "info",
        );
        return;
      }

      if (trimmed === "--clear-history") {
        const ok = !ctx.hasUI || await ctx.ui.confirm("Clear /cd history?", "Aliases will be kept.");
        if (!ok) return;
        setStore({ ...store, history: [] });
        ctx.ui.notify("/cd history cleared", "info");
        return;
      }

      if (trimmed === "--list") {
        const suggestions = buildSuggestions(currentCwd, store);
        const selected = await selectTarget(ctx, suggestions, "/cd aliases and history");
        if (selected) await changeDirectory(ctx, selected.targetPath, () => store, setStore);
        return;
      }

      const words = splitArgs(trimmed);
      if (words[0] === "--add") {
        const name = words[1];
        if (!name) {
          ctx.ui.notify("Usage: /cd --add <name> [dir]", "error");
          return;
        }
        const rawTarget = words.length >= 3 ? words.slice(2).join(" ") : currentCwd;
        try {
          setStore(addAlias(store, name, rawTarget));
          ctx.ui.notify(`Added /cd ${name} → ${formatPath(store.aliases[name] ?? normalizeDirectory(rawTarget, currentCwd) ?? rawTarget)}`, "info");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`cd alias failed: ${message}`, "error");
        }
        return;
      }

      if (words[0] === "--remove" || words[0] === "--rm") {
        const name = words[1];
        if (!name) {
          ctx.ui.notify("Usage: /cd --remove <name>", "error");
          return;
        }
        if (!store.aliases[name]) {
          ctx.ui.notify(`No /cd alias named '${name}'`, "warning");
          return;
        }
        setStore(removeAlias(store, name));
        ctx.ui.notify(`Removed /cd ${name}`, "info");
        return;
      }

      if (!trimmed) {
        const selected = await selectTarget(ctx, buildSuggestions(currentCwd, store), "Change directory");
        if (selected) await changeDirectory(ctx, selected.targetPath, () => store, setStore);
        return;
      }

      const resolved = resolveTarget(trimmed, currentCwd, store);
      if (resolved.targetPath) {
        await changeDirectory(ctx, resolved.targetPath, () => store, setStore);
        return;
      }

      const selected = await selectTarget(ctx, resolved.suggestions, `No exact directory for '${trimmed}'. Pick one:`);
      if (selected) {
        await changeDirectory(ctx, selected.targetPath, () => store, setStore);
        return;
      }

      ctx.ui.notify(`cd: no directory or alias matched '${trimmed}'`, "error");
    },
  });

  pi.registerCommand("cd-refresh", {
    description: "Reload /cd history and alias store",
    handler: async (_args, ctx) => {
      refreshStore();
      ctx.ui.notify(`Reloaded /cd store (${Object.keys(store.aliases).length} aliases, ${store.history.length} history entries)`, "info");
    },
  });
}
