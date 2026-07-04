import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { jsonToolResult, pathExists, slugify as slugifyText, titleCaseFromSlug, tokenizeArgs } from "@firstpick/pi-utils";
import { Type } from "typebox";

const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE = "local-wiki-extension";

type WikiSpec = {
  topicName?: string;
  displayName?: string;
  extensionId?: string;
  skillName?: string;
  packageName?: string;
  targetDir?: string;
  docsPath?: string;
  repoUrl?: string;
  fileExtensionsRegex?: string;
  promptDetectionRegex?: string;
  setupCommand?: string;
  template?: string;
  docFormat?: string;
  queryExpansionsCode?: string;
  searchStopWordsCode?: string;
  termWeightsCode?: string;
  diagnosticsExamples?: string;
  mutationWarnings?: string;
};

type WikiCommandSpec = WikiSpec & {
  dryRun?: boolean;
  overwrite?: boolean;
  yes?: boolean;
  agentReview?: boolean;
};

type PlanEntry = {
  source: string;
  target: string;
  action: "create" | "overwrite" | "skip";
};

function slugify(input: string): string {
  const slug = slugifyText(input);
  if (!slug) throw new Error(`Cannot derive slug from '${input}'.`);
  return slug;
}

function humanizeOwner(owner: string): string {
  const normalized = slugify(owner);
  const known: Record<string, string> = {
    raspberrypi: "Raspberry Pi",
    nixos: "NixOS",
    hyprwm: "Hyprland",
    archlinux: "Arch Linux",
  };
  return known[normalized] ?? titleCaseFromSlug(normalized);
}

function resolveTarget(targetDir: string | undefined, cwd: string, extensionId: string): string {
  const raw = targetDir || `pi-extension-${extensionId}-wiki-local`;
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(cwd, raw);
}

function looksLikeUrl(input: string): boolean {
  return /^(?:https?:\/\/|git@|ssh:\/\/)/i.test(input);
}

type RepoParts = { owner?: string; repo: string };

function repoPartsFromUrl(repoUrl: string): RepoParts | undefined {
  const withoutQuery = repoUrl.split("#", 1)[0].replace(/[?#].*$/, "").replace(/\/+$/, "");
  const sshMatch = withoutQuery.match(/^git@[^:]+:([^/]+)\/(.+)$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2].replace(/\.git$/i, "") };
  try {
    const parsed = new URL(withoutQuery);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return { owner: parts[0], repo: parts[1].replace(/\.git$/i, "") };
    if (parts.length === 1) return { repo: parts[0].replace(/\.git$/i, "") };
  } catch {
    const parts = withoutQuery.split(/[/:]/).filter(Boolean);
    if (parts.length >= 2) return { owner: parts.at(-2), repo: parts.at(-1)!.replace(/\.git$/i, "") };
  }
  return undefined;
}

function inferSpecFromRepoUrl(repoUrl: string): Partial<WikiSpec> {
  const parts = repoPartsFromUrl(repoUrl);
  if (!parts) return {};
  const genericRepos = new Set(["documentation", "docs", "doc", "wiki", "website"]);
  const rawRepoSlug = slugify(parts.repo.replace(/[-_](wiki|docs|documentation)$/i, "").replace(/^(wiki|docs|documentation)[-_]/i, ""));
  const ownerSlug = parts.owner ? slugify(parts.owner) : undefined;
  const topicBase = genericRepos.has(rawRepoSlug) && ownerSlug ? ownerSlug : rawRepoSlug;
  const topicName = topicBase === ownerSlug && parts.owner ? humanizeOwner(parts.owner) : titleCaseFromSlug(topicBase);
  const extensionId = topicBase;

  const inferred: Partial<WikiSpec> = { topicName, extensionId };
  if (ownerSlug === "raspberrypi") {
    inferred.topicName = "Raspberry Pi";
    inferred.displayName = "Raspberry Pi Documentation";
    inferred.extensionId = "raspberrypi";
    inferred.fileExtensionsRegex = "\\.(adoc|asciidoc|asc|mdx?)$";
    inferred.docFormat = "asciidoc";
    inferred.promptDetectionRegex = "\\b(raspberry\\s*pi|raspberrypi|raspi|raspi-config|rpi|pico|pico\\s*w|pico-sdk|rp2040|rp2350|picamera2|rpicam|libcamera|dtoverlay|dtparam)\\b|\\bconfig\\.txt\\b";
    inferred.queryExpansionsCode = `camera: ["rpicam", "libcamera", "picamera2", "camera module", "camera_auto_detect"],
    config: ["configuration", "config.txt", "dtparam", "dtoverlay"],
    display: ["screen", "hdmi", "kms", "dtoverlay", "display_auto_detect"],
    gpio: ["pinout", "pinctrl", "raspi-gpio", "dtparam"],
    install: ["setup", "getting started", "requirements", "imager"],
    network: ["wifi", "wireless", "networkmanager", "nmcli"],
    os: ["raspberry pi os", "bookworm", "apt"],
    pico: ["rp2040", "rp2350", "pico sdk", "micropython"],
    ssh: ["remote access", "headless", "raspi-config"],`;
    inferred.diagnosticsExamples = `uname -a
cat /proc/device-tree/model 2>/dev/null || true
cat /etc/os-release
command -v raspi-config && raspi-config nonint get_config_var arm_64bit /boot/firmware/config.txt
rg -n "^(dtoverlay|dtparam|camera_auto_detect|display_auto_detect|arm_64bit)" /boot/config.txt /boot/firmware/config.txt 2>/dev/null`;
    inferred.mutationWarnings = "Avoid mutation without explicit approval, especially package removal, bootloader changes, config rewrites, firmware flashing, partition edits, or recursive deletes.";
  }
  return inferred;
}

function normalizeSpec(input: WikiSpec, cwd: string) {
  const repoUrlFromTopic = input.topicName && looksLikeUrl(input.topicName) ? input.topicName : undefined;
  const repoUrl = input.repoUrl || repoUrlFromTopic || "";
  const inferred = repoUrl ? inferSpecFromRepoUrl(repoUrl) : {};
  const topicName = repoUrlFromTopic ? (inferred.topicName || input.displayName) : (input.topicName || inferred.topicName);
  if (!topicName && !input.extensionId && !inferred.extensionId) throw new Error("Missing topicName. Provide a topic name or repository URL.");
  const extensionId = slugify(input.extensionId || inferred.extensionId || topicName!);
  const displayName = input.displayName || inferred.displayName || `${titleCaseFromSlug(extensionId)} Wiki`;
  const skillName = input.skillName || `${extensionId}-local`;
  const packageName = input.packageName || `@firstpick/pi-extension-${extensionId}-wiki-local`;
  const docsPath = input.docsPath || `~/.${extensionId}wiki`;
  const setupCommand = input.setupCommand || `/${extensionId}-wiki-local-setup`;
  const fileExtensionsRegex = input.fileExtensionsRegex || inferred.fileExtensionsRegex || "\\.mdx?$";
  const docFormat = input.docFormat || inferred.docFormat || "markdown";
  const promptDetectionRegex = input.promptDetectionRegex || inferred.promptDetectionRegex || `\\b(${extensionId}|${topicName!.replace(/\s+/g, "\\s+")})\\b`;
  const queryExpansionsCode = input.queryExpansionsCode || inferred.queryExpansionsCode || `// Add domain language here during creation/review.
    config: ["settings", "configuration", "options"],
    install: ["setup", "getting started", "requirements"],`;
  const searchStopWordsCode = input.searchStopWordsCode || inferred.searchStopWordsCode || `// Add corpus-specific broad words here during creation/review.
    "the", "and", "or", "a", "an", "to", "of", "in", "on", "for", "with", "using", "use", "how",`;
  const termWeightsCode = input.termWeightsCode || inferred.termWeightsCode || `// Add corpus-specific broad-term weights here during creation/review, e.g.:
    // config: 0.6,`;
  const diagnosticsExamples = input.diagnosticsExamples || inferred.diagnosticsExamples || `pwd
find . -maxdepth 3 -type f | sort | head -100
rg -n "configuration|install|setup|troubleshoot" . 2>/dev/null | head -50`;
  const mutationWarnings = input.mutationWarnings || inferred.mutationWarnings || "Avoid mutation without explicit approval, especially destructive deletes, package removal, resets, flashing, partition edits, or configuration rewrites.";
  const template = input.template || DEFAULT_TEMPLATE;
  const targetDir = resolveTarget(input.targetDir, cwd, extensionId);
  const placeholders: Record<string, string> = {
    packageName,
    extensionId,
    displayName,
    topicName: topicName!,
    skillName,
    docsPath,
    repoUrl,
    fileExtensionsRegex,
    docFormat,
    promptDetectionRegex,
    setupCommand,
    queryExpansionsCode,
    searchStopWordsCode,
    termWeightsCode,
    diagnosticsExamples,
    mutationWarnings,
    year: String(new Date().getFullYear()),
    author: "Firstpick",
  };
  return { extensionId, displayName, topicName: topicName!, skillName, packageName, docsPath, setupCommand, fileExtensionsRegex, docFormat, promptDetectionRegex, repoUrl, template, targetDir, placeholders, queryExpansionsCode, searchStopWordsCode, termWeightsCode, diagnosticsExamples, mutationWarnings };
}

function renderTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
    return match;
  });
}

async function listDirs(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch { return []; }
}

async function templateRoots(cwd: string): Promise<string[]> {
  const roots = [
    process.env.WIKI_TEMPLATES_DIR,
    path.resolve(cwd, "templates"),
    path.join(EXTENSION_DIR, "templates"),
    path.resolve(EXTENSION_DIR, "..", "templates"),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(roots)];
}

async function resolveTemplate(template: string, cwd: string): Promise<string> {
  if (path.isAbsolute(template) && await pathExists(template)) return template;
  for (const root of await templateRoots(cwd)) {
    const candidate = path.resolve(root, template);
    if (await pathExists(candidate)) return candidate;
  }
  throw new Error(`Template '${template}' not found. Checked: ${(await templateRoots(cwd)).join(", ")}`);
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files.sort();
}

function renderRelativePath(relativePath: string, values: Record<string, string>): string {
  const withoutTemplateSuffix = relativePath.endsWith(".tmpl") ? relativePath.slice(0, -5) : relativePath;
  return renderTemplate(withoutTemplateSuffix.replace(/__skill-name__/g, "{{skillName}}"), values);
}

async function buildPlan(templateDir: string, targetDir: string, values: Record<string, string>, overwrite: boolean): Promise<PlanEntry[]> {
  const files = await walkFiles(templateDir);
  const plan: PlanEntry[] = [];
  for (const source of files) {
    const rel = path.relative(templateDir, source);
    const target = path.join(targetDir, renderRelativePath(rel, values));
    const targetExists = await pathExists(target);
    plan.push({ source, target, action: targetExists ? (overwrite ? "overwrite" : "skip") : "create" });
  }
  return plan;
}

async function applyPlan(plan: PlanEntry[], values: Record<string, string>) {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const item of plan) {
    if (item.action === "skip") {
      skipped.push(item.target);
      continue;
    }
    await fs.mkdir(path.dirname(item.target), { recursive: true });
    const raw = await fs.readFile(item.source, "utf8");
    await fs.writeFile(item.target, renderTemplate(raw, values));
    written.push(item.target);
  }
  return { written, skipped };
}

async function scaffoldWiki(input: WikiSpec & { dryRun?: boolean; overwrite?: boolean }, cwd: string, operation: "create" | "update") {
  const spec = normalizeSpec(input, cwd);
  const templateDir = await resolveTemplate(spec.template, cwd);
  const targetExists = await pathExists(spec.targetDir);
  if (operation === "create" && targetExists && input.overwrite !== true) {
    throw new Error(`Target already exists: ${spec.targetDir}. Set overwrite=true to write into it.`);
  }
  const overwrite = input.overwrite === true;
  const plan = await buildPlan(templateDir, spec.targetDir, spec.placeholders, overwrite);
  const summary = {
    operation,
    dryRun: input.dryRun === true,
    templateDir,
    targetDir: spec.targetDir,
    packageName: spec.packageName,
    skillName: spec.skillName,
    extensionId: spec.extensionId,
    counts: {
      create: plan.filter((item) => item.action === "create").length,
      overwrite: plan.filter((item) => item.action === "overwrite").length,
      skip: plan.filter((item) => item.action === "skip").length,
    },
    plan,
  };
  if (input.dryRun === true) return summary;
  const result = await applyPlan(plan, spec.placeholders);
  return { ...summary, ...result };
}

async function validatePackage(targetDir: string, cwd: string) {
  const resolved = path.isAbsolute(targetDir) ? path.resolve(targetDir) : path.resolve(cwd, targetDir);
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const packageJsonPath = path.join(resolved, "package.json");
  const indexPath = path.join(resolved, "index.ts");
  checks.push({ name: "target directory", ok: await pathExists(resolved), detail: resolved });
  checks.push({ name: "package.json", ok: await pathExists(packageJsonPath), detail: packageJsonPath });
  checks.push({ name: "index.ts", ok: await pathExists(indexPath), detail: indexPath });
  if (await pathExists(indexPath)) {
    const indexText = await fs.readFile(indexPath, "utf8");
    const registersSetupCommand = /registerCommand\(\s*["'`][^"'`]*-local-setup["'`]/.test(indexText) || indexText.includes("-wiki-local-setup");
    checks.push({ name: "setup command", ok: registersSetupCommand && indexText.includes("executeSetup"), detail: "index.ts registers an idempotent local docs setup command" });
  }

  let packageJson: any;
  if (await pathExists(packageJsonPath)) {
    try {
      packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
      checks.push({ name: "package.json parses", ok: true, detail: packageJson.name ?? "missing name" });
      checks.push({ name: "pi extension entry", ok: Array.isArray(packageJson.pi?.extensions) && packageJson.pi.extensions.includes("./index.ts"), detail: "pi.extensions includes ./index.ts" });
      checks.push({ name: "pi skills entry", ok: Array.isArray(packageJson.pi?.skills) && packageJson.pi.skills.includes("./skills"), detail: "pi.skills includes ./skills" });
    } catch (error) {
      checks.push({ name: "package.json parses", ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }

  const files = await pathExists(resolved) ? await walkFiles(resolved) : [];
  const skillFiles = files.filter((file) => path.basename(file) === "SKILL.md" && file.includes(`${path.sep}skills${path.sep}`));
  checks.push({ name: "skill file", ok: skillFiles.length > 0, detail: skillFiles.join(", ") || "none" });

  const placeholderHits: string[] = [];
  for (const file of files.filter((candidate) => /\.(md|json|ts|tmpl|txt|license)$/i.test(candidate) || ["LICENSE", "README.md"].includes(path.basename(candidate)))) {
    const text = await fs.readFile(file, "utf8");
    const relative = path.relative(resolved, file);
    if (/\{\{[a-zA-Z0-9_]+\}\}/.test(text) || file.endsWith(".tmpl") || relative.includes("__skill-name__")) placeholderHits.push(relative);
  }
  checks.push({ name: "no template placeholders", ok: placeholderHits.length === 0, detail: placeholderHits.join(", ") || "none" });

  const ok = checks.every((check) => check.ok);
  return { targetDir: resolved, ok, checks };
}

const wikiSpecSchema = {
  topicName: Type.Optional(Type.String({ description: "Topic name, e.g. 'Example' or 'NixOS'. Optional when repoUrl is provided." })),
  displayName: Type.Optional(Type.String({ description: "Human display name, e.g. 'Example Wiki'" })),
  extensionId: Type.Optional(Type.String({ description: "Short lowercase tool prefix base; tools become <extensionId>_wiki_*" })),
  skillName: Type.Optional(Type.String({ description: "Generated skill name, e.g. 'example-local'" })),
  packageName: Type.Optional(Type.String({ description: "npm package name" })),
  targetDir: Type.Optional(Type.String({ description: "Output package directory; relative paths resolve from cwd" })),
  docsPath: Type.Optional(Type.String({ description: "Canonical local docs path, e.g. '~/.examplewiki'" })),
  repoUrl: Type.Optional(Type.String({ description: "Git repo URL for setup command; empty means manual docs path" })),
  fileExtensionsRegex: Type.Optional(Type.String({ description: "Regex body for doc files, e.g. '\\.mdx?$' or '\\.html?$'" })),
  promptDetectionRegex: Type.Optional(Type.String({ description: "Regex body used for automatic prompt routing" })),
  setupCommand: Type.Optional(Type.String({ description: "Slash command shown when docs are missing" })),
  template: Type.Optional(Type.String({ description: "Template directory name or absolute path" })),
  docFormat: Type.Optional(Type.String({ description: "Parser format for generated docs: markdown, asciidoc, or html" })),
  queryExpansionsCode: Type.Optional(Type.String({ description: "TypeScript object entries inserted into CONFIG.queryExpansions" })),
  searchStopWordsCode: Type.Optional(Type.String({ description: "TypeScript string array entries inserted into CONFIG.searchStopwords" })),
  termWeightsCode: Type.Optional(Type.String({ description: "TypeScript object entries inserted into CONFIG.termWeights for broad-term downweighting" })),
  diagnosticsExamples: Type.Optional(Type.String({ description: "Topic-specific read-only diagnostic commands inserted into the generated skill" })),
  mutationWarnings: Type.Optional(Type.String({ description: "Topic-specific mutation warning text inserted into the generated skill" })),
};

const FLAG_MAP: Record<string, keyof WikiSpec> = {
  "display-name": "displayName",
  "extension-id": "extensionId",
  "skill-name": "skillName",
  "package-name": "packageName",
  "target-dir": "targetDir",
  "docs-path": "docsPath",
  "repo-url": "repoUrl",
  "file-extensions-regex": "fileExtensionsRegex",
  "prompt-detection-regex": "promptDetectionRegex",
  "setup-command": "setupCommand",
  "doc-format": "docFormat",
  "query-expansions-code": "queryExpansionsCode",
  "search-stop-words-code": "searchStopWordsCode",
  "term-weights-code": "termWeightsCode",
  "diagnostics-examples": "diagnosticsExamples",
  "mutation-warnings": "mutationWarnings",
  template: "template",
};

function parseWikiCommandArgs(args: string, defaults: Partial<WikiCommandSpec> = {}) {
  const trimmed = args.trim();
  if (!trimmed) return { ...defaults } as WikiCommandSpec;
  if (trimmed.startsWith("{")) return { ...defaults, ...JSON.parse(trimmed) } as WikiCommandSpec;

  const tokens = tokenizeArgs(trimmed);
  const spec: Partial<WikiCommandSpec> = { ...defaults };
  const topicParts: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith("--")) {
      topicParts.push(token);
      continue;
    }
    const [rawName, inlineValue] = token.slice(2).split("=", 2);
    if (rawName === "dry-run") { spec.dryRun = true; continue; }
    if (rawName === "apply") { spec.dryRun = false; continue; }
    if (rawName === "yes" || rawName === "non-interactive") { spec.yes = true; continue; }
    if (rawName === "agent-review") { spec.agentReview = true; continue; }
    if (rawName === "no-agent-review") { spec.agentReview = false; continue; }
    if (rawName === "overwrite") { spec.overwrite = true; continue; }
    const key = FLAG_MAP[rawName];
    if (!key) throw new Error(`Unknown option --${rawName}`);
    const value = inlineValue ?? tokens[++i];
    if (value === undefined) throw new Error(`Missing value for --${rawName}`);
    spec[key] = value;
  }
  if (!spec.topicName && topicParts.length > 0) spec.topicName = topicParts.join(" ");
  if (spec.topicName && looksLikeUrl(spec.topicName) && !spec.repoUrl) spec.repoUrl = spec.topicName;
  if (!spec.topicName && !spec.repoUrl) throw new Error("Missing topicName or repoUrl. Provide a topic, repository URL, or JSON with repoUrl.");
  return spec as WikiCommandSpec;
}

function formatCommandResult(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

async function completeInteractiveSpec(spec: WikiCommandSpec, ctx: any): Promise<WikiCommandSpec | undefined> {
  if (!ctx.hasUI) return spec;
  const next: WikiCommandSpec = { ...spec };
  if (!next.topicName && !next.repoUrl) {
    const value = await ctx.ui.input("Wiki source", "Repository URL or topic name");
    if (!value?.trim()) return undefined;
    if (looksLikeUrl(value.trim())) next.repoUrl = value.trim();
    next.topicName = value.trim();
  }
  const normalized = normalizeSpec(next, ctx.cwd);
  const summary = [
    `Package: ${normalized.packageName}`,
    `Target: ${normalized.targetDir}`,
    `Skill: ${normalized.skillName}`,
    `Tools: ${normalized.extensionId}_wiki_*`,
    `Docs: ${normalized.docsPath}`,
    `Repo: ${normalized.repoUrl || "manual/preinstalled corpus"}`,
    `Files: ${normalized.fileExtensionsRegex}`,
    `Format: ${normalized.docFormat}`,
    `Prompt regex: ${normalized.promptDetectionRegex}`,
  ].join("\n");

  const choice = await ctx.ui.select(`Create local wiki package?\n\n${summary}`, [
    "Create + queue agent review",
    "Dry-run only",
    "Create without agent review",
    "Cancel",
  ]);
  if (!choice || choice === "Cancel") return undefined;
  if (choice === "Dry-run only") next.dryRun = true;
  if (choice === "Create + queue agent review") next.agentReview = true;
  if (choice === "Create without agent review") next.agentReview = false;
  return next;
}

function makeAgentReviewPrompt(result: any, validation: any): string {
  return `Audit and finish the local wiki package created by /wiki-create.\n\nTarget: ${result.targetDir}\nPackage: ${result.packageName}\nSkill: ${result.skillName}\nExtension id: ${result.extensionId}\n\nCreation result:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n\nInitial validation:\n\`\`\`json\n${JSON.stringify(validation, null, 2)}\n\`\`\`\n\nActively inspect and finish the package, not just report success. Do the following:\n- Verify structure, package metadata, registered commands/tools, and template placeholders.\n- Tailor README.md, references/evaluation.md, skills/*/SKILL.md, CONFIG.promptDetection, CONFIG.queryExpansions, CONFIG.searchStopwords, CONFIG.termWeights, file extensions, doc format, diagnostics, and safety language to the specific documentation corpus. Derive stopwords/downweights from this wiki's own corpus and realistic searches; do not cargo-cult values from another wiki.\n- Check the upstream repo shape when repoUrl is configured; use official/current source evidence before changing corpus assumptions.\n- Evaluate accuracy, effectiveness, and token output using representative status/search/sections/extract/read/related/smoke-test calls; keep outputs bounded with compact search, maxChars, and maxSections defaults.\n- Run validation and practical package checks such as validate_wiki, the generated smoke-test command/tool, npm install --package-lock-only --ignore-scripts, npm pack --dry-run, and a lightweight registration/build check when practical.\n- Do not clone very large repos or perform destructive changes without asking.\n- Save concise findings and any remaining caveats.\n\nThis follow-up exists because /wiki-create intentionally scaffolds first, then asks the agent to critically tune and verify the result.`;
}

export default function wikiToolsExtension(pi: ExtensionAPI) {
  pi.registerCommand("wiki-templates", {
    description: "List available local wiki package templates",
    handler: async (_args, ctx) => {
      const roots = await templateRoots(ctx.cwd);
      const templates = [] as Array<{ root: string; templates: string[] }>;
      for (const root of roots) templates.push({ root, templates: await listDirs(root) });
      ctx.ui.notify(formatCommandResult({ roots, templates }), "info");
    },
  });

  pi.registerCommand("wiki-create", {
    description: "Interactively create a local wiki extension package, then queue an agent review/tuning pass. Usage: /wiki-create <repo-url-or-topic> [--repo-url URL] [--target-dir DIR] [--doc-format markdown|asciidoc|html] [--dry-run] [--overwrite] [--yes] [--no-agent-review]",
    handler: async (args, ctx) => {
      try {
        const parsed = parseWikiCommandArgs(args);
        const spec = parsed.yes ? parsed : await completeInteractiveSpec(parsed, ctx);
        if (!spec) {
          ctx.ui.notify("wiki-create cancelled", "info");
          return;
        }
        const result = await scaffoldWiki(spec, ctx.cwd, "create");
        const validation = result.dryRun ? undefined : await validatePackage(result.targetDir, ctx.cwd);
        ctx.ui.notify(formatCommandResult({ ...result, validation }), validation?.ok === false ? "warning" : "info");

        const shouldReview = !result.dryRun && spec.agentReview !== false && (spec.agentReview === true || !spec.yes);
        if (shouldReview) {
          const prompt = makeAgentReviewPrompt(result, validation);
          if ((ctx as any).isIdle?.() === false) pi.sendUserMessage(prompt, { deliverAs: "followUp" });
          else pi.sendUserMessage(prompt);
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("wiki-update", {
    description: "Preview/apply a template refresh for a wiki package. Defaults to dry-run; pass --apply to write. Usage: /wiki-update <topic> --target-dir DIR [--overwrite] [--apply]",
    handler: async (args, ctx) => {
      try {
        const result = await scaffoldWiki(parseWikiCommandArgs(args, { dryRun: true }), ctx.cwd, "update");
        ctx.ui.notify(formatCommandResult(result), "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("wiki-validate", {
    description: "Validate a generated wiki package. Usage: /wiki-validate <target-dir>",
    handler: async (args, ctx) => {
      const targetDir = args.trim();
      if (!targetDir) {
        ctx.ui.notify("Usage: /wiki-validate <target-dir>", "warning");
        return;
      }
      const result = await validatePackage(targetDir, ctx.cwd);
      ctx.ui.notify(formatCommandResult(result), result.ok ? "info" : "warning");
    },
  });

  pi.registerTool({
    name: "list_wiki_templates",
    label: "List Wiki Templates",
    description: "List available wiki scaffolding templates from WIKI_TEMPLATES_DIR, ./templates, and bundled templates.",
    promptSnippet: "List templates for wiki package scaffolding",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const roots = await templateRoots(ctx.cwd);
      const templates = [] as Array<{ root: string; templates: string[] }>;
      for (const root of roots) templates.push({ root, templates: await listDirs(root) });
      return jsonToolResult({ roots, templates });
    },
  });

  pi.registerTool({
    name: "create_wiki",
    label: "Create Wiki Package",
    description: "Create a new Pi local wiki extension package from templates/local-wiki-extension. Pass repoUrl alone to infer names and setup command.",
    promptSnippet: "Create local wiki extension packages from templates",
    promptGuidelines: ["Use create_wiki when the user asks to create a local wiki package from templates."],
    parameters: Type.Object({ ...wikiSpecSchema, dryRun: Type.Optional(Type.Boolean()), overwrite: Type.Optional(Type.Boolean()) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      return jsonToolResult(await scaffoldWiki(params, ctx.cwd, "create"));
    },
  });

  pi.registerTool({
    name: "update_wiki",
    label: "Update Wiki Package",
    description: "Refresh or preview scaffolded wiki package files from a wiki template. Defaults to dry-run unless dryRun=false is supplied.",
    promptSnippet: "Update scaffolded wiki packages from templates",
    promptGuidelines: ["Use update_wiki with dryRun=true before overwriting customized wiki package files."],
    parameters: Type.Object({ ...wikiSpecSchema, dryRun: Type.Optional(Type.Boolean({ default: true })), overwrite: Type.Optional(Type.Boolean()) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      return jsonToolResult(await scaffoldWiki({ ...params, dryRun: params.dryRun ?? true }, ctx.cwd, "update"));
    },
  });

  pi.registerTool({
    name: "validate_wiki",
    label: "Validate Wiki Package",
    description: "Validate a generated Pi local wiki extension package for required files, pi metadata, skill files, and unreplaced placeholders.",
    promptSnippet: "Validate generated local wiki packages",
    parameters: Type.Object({ targetDir: Type.String({ description: "Generated wiki package directory; relative paths resolve from cwd" }) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      return jsonToolResult(await validatePackage(params.targetDir, ctx.cwd));
    },
  });
}
