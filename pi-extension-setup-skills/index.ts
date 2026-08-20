import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DefaultPackageManager, DynamicBorder, getAgentDir, getSettingsListTheme, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Container, getKeybindings, Key, matchesKey, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import { getAgentSettingsPath, readJsonIfExists, writeJsonFile } from "@firstpick/pi-utils";

type PackageEntry = string | { source?: string; skills?: string[]; extensions?: string[]; prompts?: string[]; [key: string]: unknown };
type SettingsShape = { packages?: PackageEntry[]; skills?: string[]; [key: string]: unknown };

type SkillCandidate = {
  name: string;
  description: string;
  skillPath: string;
  enableKind: "settings-skill" | "package" | "package-skill";
  enablePath: string;
  packageSource?: string;
  packageSkillName?: string;
};

function collectSkillFilesFromDir(root: string, includeRootMarkdown = true): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];

  const visit = (dir: string, isRoot: boolean) => {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry !== "SKILL.md") continue;
      const skillPath = join(dir, entry);
      try {
        if (statSync(skillPath).isFile()) out.push(skillPath);
      } catch {
        // ignore unreadable entries
      }
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const path = join(dir, entry);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (st.isDirectory()) visit(path, false);
      else if (isRoot && includeRootMarkdown && st.isFile() && entry.endsWith(".md")) out.push(path);
    }
  };

  visit(root, true);
  return out;
}

function parseSkill(path: string): { name: string; description: string } | undefined {
  const text = readFileSync(path, "utf8");
  const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatter) return undefined;
  const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
  if (!name) return undefined;
  return { name, description };
}

function packageSource(entry: PackageEntry): string | undefined {
  return typeof entry === "string" ? entry : entry.source;
}

function resolvePackageInstallDir(source: string, packageManager: DefaultPackageManager): string | undefined {
  return packageManager.getInstalledPath(source, "user");
}

async function collectPackageSkillFiles(packageDir: string, packageManager: DefaultPackageManager): Promise<string[]> {
  if (!existsSync(packageDir)) return [];
  const resolved = await packageManager.resolveExtensionSources([packageDir], { temporary: true });
  return resolved.skills.filter((resource) => resource.enabled).map((resource) => resource.path).sort();
}

async function discoverPackageSkills(
  packageDir: string,
  source: string,
  candidates: Map<string, SkillCandidate>,
  packageManager: DefaultPackageManager,
): Promise<void> {
  for (const skillPath of await collectPackageSkillFiles(packageDir, packageManager)) {
    const parsed = parseSkill(skillPath);
    if (!parsed) continue;
    candidates.set(parsed.name, {
      ...parsed,
      skillPath,
      enableKind: "package-skill",
      enablePath: packageDir,
      packageSource: source,
      packageSkillName: parsed.name,
    });
  }
}

function addLocalSkills(root: string, candidates: Map<string, SkillCandidate>): void {
  for (const skillPath of collectSkillFilesFromDir(root)) {
    const parsed = parseSkill(skillPath);
    if (!parsed) continue;
    candidates.set(parsed.name, {
      ...parsed,
      skillPath,
      enableKind: "settings-skill",
      enablePath: skillPath,
    });
  }
}

function discoverProjectSkillRoots(cwd: string): string[] {
  const roots: string[] = [];
  let current = resolve(cwd);
  while (true) {
    roots.push(join(current, ".pi", "skills"), join(current, ".agents", "skills"));
    if (existsSync(join(current, ".git"))) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

async function discoverCandidates(settings: SettingsShape, cwd: string): Promise<SkillCandidate[]> {
  const candidates = new Map<string, SkillCandidate>();
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });

  for (const root of [join(agentDir, "skills"), join(homedir(), ".agents", "skills"), ...discoverProjectSkillRoots(cwd)]) {
    addLocalSkills(root, candidates);
  }

  for (const entry of settings.packages ?? []) {
    const source = packageSource(entry);
    if (!source) continue;
    const packageDir = resolvePackageInstallDir(source, packageManager);
    if (!packageDir) continue;
    await discoverPackageSkills(packageDir, source, candidates, packageManager);
  }

  return [...candidates.values()].sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    return byName || (a.packageSource ?? a.enablePath).localeCompare(b.packageSource ?? b.enablePath);
  });
}

function normalizePath(path: string): string {
  return resolve(path);
}

/** Skill file location relative to its package root, e.g. `skills/librarian/SKILL.md`. */
function packageRelativeSkillPath(candidate: SkillCandidate): string {
  return relative(candidate.enablePath, candidate.skillPath).split(sep).join("/");
}

function stripPrefix(entry: string): string {
  return entry.startsWith("+") || entry.startsWith("-") || entry.startsWith("!") ? entry.slice(1) : entry;
}

function isEnabled(candidate: SkillCandidate, settings: SettingsShape): boolean {
  if (candidate.enableKind === "package-skill") {
    const source = candidate.packageSource;
    const skillName = candidate.packageSkillName;
    if (!source || !skillName) return false;
    const entry = (settings.packages ?? []).find((pkg) => packageSource(pkg) === source);
    if (!entry) return false;
    if (typeof entry === "string" || entry.skills === undefined) return true;

    const filters = entry.skills;
    if (filters.length === 0) return false;

    const relPath = packageRelativeSkillPath(candidate);
    const matches = (filter: string): boolean => {
      const raw = stripPrefix(filter);
      return raw === skillName || raw === relPath;
    };

    if (filters.filter((f) => f.startsWith("!") || f.startsWith("-")).some(matches)) return false;

    const positive = filters.filter((f) => !f.startsWith("!") && !f.startsWith("-"));
    // Exclusion-only lists leave every other skill enabled, including ones added
    // by a later package update.
    return positive.length === 0 || positive.some(matches);
  }

  if (candidate.enableKind === "package") {
    const target = normalizePath(candidate.enablePath);
    return (settings.packages ?? []).some((entry) => {
      const source = packageSource(entry);
      return source ? normalizePath(source) === target : false;
    });
  }

  const skillSettings = settings.skills ?? [];
  if (skillSettings.length === 0) return true;

  const direct = normalizePath(candidate.enablePath);
  const parent = normalizePath(dirname(direct));
  const hits = (entry: string): boolean => {
    const raw = stripPrefix(entry);
    if (raw === "**") return true;
    if (raw === candidate.name) return true;
    const normalized = normalizePath(raw);
    return normalized === direct || normalized === parent;
  };

  // Mirror Pi's own precedence from isEnabledByOverrides: skills are enabled by
  // default, `!` excludes, `+` force-includes over an exclusion, `-` wins last.
  let enabled = true;
  if (skillSettings.filter((entry) => entry.startsWith("!")).some(hits)) enabled = false;
  if (skillSettings.filter((entry) => entry.startsWith("+")).some(hits)) enabled = true;
  if (skillSettings.filter((entry) => entry.startsWith("-")).some(hits)) enabled = false;
  return enabled;
}

function applySelection(settings: SettingsShape, candidates: SkillCandidate[], selected: boolean[]): SettingsShape {
  const next: SettingsShape = { ...settings };
  const packageTargets = new Set(candidates.filter((c) => c.enableKind === "package").map((c) => normalizePath(c.enablePath)));
  const skillTargets = new Set(candidates.filter((c) => c.enableKind === "settings-skill").map((c) => normalizePath(c.enablePath)));
  const managedPackageSources = new Set(
    candidates.filter((c) => c.enableKind === "package-skill" && c.packageSource).map((c) => c.packageSource!),
  );

  // Record only what the user switched off. Anything absent stays enabled, so a
  // package update that ships a new skill loads it without a second visit here.
  const excludedPackageSkills = new Map<string, string[]>();
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (candidate.enableKind !== "package-skill" || !candidate.packageSource || !candidate.packageSkillName) continue;
    if (selected[i]) continue;
    const list = excludedPackageSkills.get(candidate.packageSource) ?? [];
    list.push(packageRelativeSkillPath(candidate));
    excludedPackageSkills.set(candidate.packageSource, list);
  }

  next.packages = (next.packages ?? [])
    .filter((entry) => {
      const source = packageSource(entry);
      return !source || !packageTargets.has(normalizePath(source));
    })
    .map((entry) => {
      const source = packageSource(entry);
      if (!source || !managedPackageSources.has(source)) return entry;
      const base: { source: string; skills?: string[]; [key: string]: unknown } =
        typeof entry === "string" ? { source: entry } : { ...entry, source };
      const excluded = excludedPackageSkills.get(source) ?? [];
      if (excluded.length === 0) {
        const { skills: _unused, ...withoutFilter } = base;
        return withoutFilter;
      }
      return { ...base, skills: excluded.sort().map((relPath) => `-${relPath}`) };
    });

  // Drop the legacy deny-all and any entry describing a skill shown in this list,
  // then re-state only the switched-off ones. Unrelated entries, such as an extra
  // skills directory, are preserved untouched.
  const preservedSkillFilters = (next.skills ?? []).filter((entry) => {
    if (entry === "!**") return false;
    const raw = stripPrefix(entry);
    if (skillTargets.has(normalizePath(raw))) return false;
    return !candidates.some((candidate) => candidate.enableKind === "settings-skill" && candidate.name === raw);
  });
  const disabledSkillFilters: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (candidate.enableKind === "package") {
      if (selected[i]) next.packages.push(candidate.enablePath);
    } else if (candidate.enableKind === "settings-skill" && !selected[i]) {
      disabledSkillFilters.push(`-${candidate.enablePath}`);
    }
  }

  const skills = [...preservedSkillFilters, ...disabledSkillFilters];
  if (skills.length > 0) next.skills = skills;
  else delete next.skills;

  return next;
}

async function selectSkills(
  ctx: ExtensionCommandContext,
  candidates: SkillCandidate[],
  initialSelected: boolean[],
): Promise<boolean[] | undefined> {
  if (!ctx.hasUI) return initialSelected;

  return await ctx.ui.custom<boolean[] | undefined>((tui, theme, _kb, done) => {
    const selected = [...initialSelected];
    const items: SettingItem[] = candidates.map((candidate, index) => ({
      id: String(index),
      label: candidate.name,
      description: `${candidate.packageSource ?? (candidate.enableKind === "package" ? "package" : "local")}: ${candidate.description}`,
      currentValue: selected[index] ? "enabled" : "disabled",
      values: ["enabled", "disabled"],
    }));

    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(
      new (class {
        render() {
          const activeCount = selected.filter(Boolean).length;
          return [theme.fg("accent", theme.bold(`Skills (${activeCount}/${candidates.length} active)`))];
        }
        invalidate() {}
      })(),
    );

    const settingsList = new SettingsList(
      items,
      12,
      getSettingsListTheme(),
      (id, newValue) => {
        selected[Number(id)] = newValue === "enabled";
      },
      () => done(undefined),
      { enableSearch: true },
    );

    container.addChild(settingsList);
    container.addChild(new Text(theme.fg("dim", "  Ctrl+S save • q cancel"), 0, 0));
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

    return {
      render(width: number) {
        return container.render(width);
      },
      invalidate() {
        container.invalidate();
      },
      handleInput(data: string) {
        if (data === "q") {
          done(undefined);
          return;
        }
        const kb = getKeybindings();
        if (kb.matches(data, "app.models.save") || matchesKey(data, Key.ctrl("s")) || data === "\x13") {
          done(selected);
          return;
        }
        settingsList.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

export default function setupSkillsExtension(pi: ExtensionAPI): void {
  pi.registerCommand("skills", {
    description: "Enable/disable local Pi skills with a multi-selection list",
    handler: async (_args, ctx) => {
      const settingsPath = getAgentSettingsPath();
      let settings: SettingsShape;
      try {
        settings = readJsonIfExists<SettingsShape>(settingsPath, {});
      } catch (error) {
        ctx.ui.notify(`Could not read ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`, "error");
        return;
      }

      const candidates = await discoverCandidates(settings, ctx.cwd);
      if (candidates.length === 0) {
        ctx.ui.notify("No skills found.", "warning");
        return;
      }

      const initial = candidates.map((candidate) => isEnabled(candidate, settings));
      const selected = await selectSkills(ctx, candidates, initial);
      if (!selected) {
        ctx.ui.notify("Skill setup cancelled.", "info");
        return;
      }

      try {
        writeJsonFile(settingsPath, applySelection(settings, candidates, selected));
      } catch (error) {
        ctx.ui.notify(`Could not write ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`, "error");
        return;
      }

      const changed = candidates.filter((_, i) => initial[i] !== selected[i]).length;
      ctx.ui.notify(`Skill setup saved (${changed} changed).`, "info");
      if (changed > 0 && ctx.hasUI) {
        const reload = await ctx.ui.select("Reload Pi now to apply skill changes?", ["Yes", "No"]);
        if (reload === "Yes") await ctx.reload();
      }
    },
  });
}
