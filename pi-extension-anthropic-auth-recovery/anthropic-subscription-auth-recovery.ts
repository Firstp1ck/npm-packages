import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants, existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const MODULE_FILE = realpathSync(fileURLToPath(import.meta.url));
const MODULE_DIRECTORY = dirname(MODULE_FILE);
const MODULE_REQUIRE = createRequire(MODULE_FILE);
const RECOVERY_TITLE = "Pi Anthropic compatibility recovery";
const STATUS_KEY = "anthropic-dist-compat";
const CLEANUP_DELAY_MS = 10 * 60 * 1000;
const ERROR_CLASSIFIERS = [
  {
    id: "third-party-extra-usage-v1",
    pattern: /third-party apps? now draw from your extra usage, not your plan limits/iu,
  },
  {
    id: "third-party-extra-usage-generic",
    pattern: /third-party apps?.{0,120}extra usage/isu,
  },
] as const;

type ModelRef = { provider: string; id: string; name?: string };
type ErrorMatch = { classifier: string; normalized: string; fingerprint: string };
type RecoveryFiles = { patchPath: string; patchctlPath: string };
type RecoveryResourceDiscovery = {
  files?: RecoveryFiles;
  missing: Array<"compatibility PATCH.md package" | "patchctl runner">;
  checked: { patch: string[]; patchctl: string[] };
};
type RecoveryDiscoveryOptions = {
  moduleDirectory?: string;
  packagedPatchctlPath?: string | null;
};
type SecureRecoveryResult = { ok: true; requestId?: string } | { ok: false; reason: string };

type ModelRegistryLike = {
  getAvailable(): ModelRef[];
  find(provider: string, modelId: string): ModelRef | undefined;
  hasConfiguredAuth(model: ModelRef): boolean;
};

type AnthropicSubscriptionRegistryLike = {
  getAvailable(): ModelRef[];
  hasConfiguredAuth(model: ModelRef): boolean;
  isUsingOAuth(model: ModelRef): boolean;
  getProvider(provider: string): { auth?: { oauth?: { isSubscription?: boolean } } } | undefined;
};

function normalizeError(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function classifyAnthropicError(message: unknown, provider = "anthropic"): ErrorMatch | undefined {
  if (provider !== "anthropic" || typeof message !== "string") return undefined;
  const normalized = normalizeError(message);
  const classifier = ERROR_CLASSIFIERS.find((candidate) => candidate.pattern.test(normalized));
  if (!classifier) return undefined;
  return {
    classifier: classifier.id,
    normalized,
    fingerprint: createHash("sha256").update(`${classifier.id}\0${normalized}`).digest("hex"),
  };
}

function getAssistantErrorMessage(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const candidate = message as { role?: unknown; stopReason?: unknown; errorMessage?: unknown };
  if (candidate.role !== "assistant" || candidate.stopReason !== "error") return undefined;
  return typeof candidate.errorMessage === "string" ? candidate.errorMessage : undefined;
}

function parseModelRef(value: string | undefined): { provider: string; id: string } | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) return undefined;
  return { provider: trimmed.slice(0, slash), id: trimmed.slice(slash + 1) };
}

export function selectRecoveryModel(registry: ModelRegistryLike, configured = process.env.PI_ANTHROPIC_RECOVERY_MODEL): ModelRef | undefined {
  const explicit = parseModelRef(configured);
  if (explicit) {
    const model = registry.find(explicit.provider, explicit.id);
    if (model && model.provider !== "anthropic" && registry.hasConfiguredAuth(model)) return model;
  }
  const providerPriority = new Map([
    ["openai-codex", 500],
    ["openai", 400],
    ["google", 300],
    ["github-copilot", 200],
  ]);
  return registry.getAvailable()
    .filter((model) => model.provider !== "anthropic" && registry.hasConfiguredAuth(model))
    .sort((left, right) => {
      const providerScore = (providerPriority.get(right.provider) ?? 0) - (providerPriority.get(left.provider) ?? 0);
      if (providerScore !== 0) return providerScore;
      const modelScore = (/(?:5\.6|codex|opus|pro)/iu.test(right.id) ? 1 : 0) - (/(?:5\.6|codex|opus|pro)/iu.test(left.id) ? 1 : 0);
      return modelScore || right.id.localeCompare(left.id);
    })[0];
}

async function readable(file: string): Promise<boolean> {
  try { await access(file, fsConstants.R_OK); return true; } catch { return false; }
}

async function readablePatchPackage(patchPath: string): Promise<boolean> {
  if (!(await readable(patchPath))) return false;
  try {
    const patchDirectory = dirname(patchPath);
    const manifestPath = join(patchDirectory, "patch.manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { lifecycle?: { handler?: unknown } };
    const handler = manifest.lifecycle?.handler;
    if (typeof handler !== "string" || !handler.trim()) return false;
    const handlerPath = resolve(patchDirectory, handler);
    const handlerRelative = relative(patchDirectory, handlerPath);
    if (handlerRelative.startsWith("..") || isAbsolute(handlerRelative)) return false;
    return readable(handlerPath);
  } catch {
    return false;
  }
}

function ancestorResourceCandidates(cwd: string, pathSegments: string[]): string[] {
  const candidates: string[] = [];
  let current = resolve(cwd);
  for (let depth = 0; depth < 8; depth++) {
    candidates.push(join(current, ...pathSegments));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return candidates;
}

function canonicalCandidate(value: string): string {
  const resolved = resolve(value);
  try { return realpathSync(resolved); } catch { return resolved; }
}

function uniqueCandidates(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)).map(canonicalCandidate))];
}

function resolvePackagedPatchctl(): string | undefined {
  try {
    return MODULE_REQUIRE.resolve("@firstpick/pi-skill-patch-md/skills/patch-md/scripts/patchctl.mjs");
  } catch {
    return undefined;
  }
}

export async function inspectRecoveryFiles(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  options: RecoveryDiscoveryOptions = {},
): Promise<RecoveryResourceDiscovery> {
  const resolvedCwd = resolve(cwd);
  const moduleDirectory = resolve(options.moduleDirectory ?? MODULE_DIRECTORY);
  const configuredAgentDir = env.PI_AGENT_DIR || env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const agentDir = resolve(resolvedCwd, configuredAgentDir);
  const patchSegments = ["patches", "pi-anthropic-provider-dist-compat", "PATCH.md"];
  const bundledPatchSegments = ["resources", "pi-anthropic-provider-dist-compat", "PATCH.md"];
  const patchctlSegments = ["pi-skill-patch-md", "skills", "patch-md", "scripts", "patchctl.mjs"];
  const explicitPatch = env.PI_ANTHROPIC_PATCH_PATH ? resolve(resolvedCwd, env.PI_ANTHROPIC_PATCH_PATH) : undefined;
  const explicitPatchctl = env.PI_PATCHCTL_PATH ? resolve(resolvedCwd, env.PI_PATCHCTL_PATH) : undefined;
  const packagedPatchctl = options.packagedPatchctlPath === undefined ? resolvePackagedPatchctl() : options.packagedPatchctlPath ?? undefined;
  const patchCandidates = uniqueCandidates([
    explicitPatch,
    join(moduleDirectory, ...bundledPatchSegments),
    join(agentDir, ...patchSegments),
    ...ancestorResourceCandidates(resolvedCwd, patchSegments),
    ...ancestorResourceCandidates(moduleDirectory, patchSegments),
  ]);
  const patchctlCandidates = uniqueCandidates([
    explicitPatchctl,
    packagedPatchctl,
    join(agentDir, "skills", "patch-md", "scripts", "patchctl.mjs"),
    ...ancestorResourceCandidates(resolvedCwd, patchctlSegments),
    ...ancestorResourceCandidates(moduleDirectory, patchctlSegments),
  ]);
  const patchPath = (await Promise.all(patchCandidates.map(async (candidate) => ((await readablePatchPackage(candidate)) ? candidate : "")))).find(Boolean);
  const patchctlPath = (await Promise.all(patchctlCandidates.map(async (candidate) => ((await readable(candidate)) ? candidate : "")))).find(Boolean);
  const missing: RecoveryResourceDiscovery["missing"] = [];
  if (!patchPath) missing.push("compatibility PATCH.md package");
  if (!patchctlPath) missing.push("patchctl runner");
  return {
    ...(patchPath && patchctlPath ? { files: { patchPath, patchctlPath } } : {}),
    missing,
    checked: { patch: patchCandidates, patchctl: patchctlCandidates },
  };
}

export async function discoverRecoveryFiles(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  options: RecoveryDiscoveryOptions = {},
): Promise<RecoveryFiles | undefined> {
  return (await inspectRecoveryFiles(env, cwd, options)).files;
}

export function formatRecoveryDiscoveryFailure(discovery: RecoveryResourceDiscovery): string {
  const missing = discovery.missing.join(" and ") || "unknown recovery resources";
  return [
    `Recovery resources unavailable: missing or unreadable ${missing}.`,
    "Reinstall @firstpick/pi-extension-anthropic-auth-recovery with dependencies,",
    "or configure PI_ANTHROPIC_PATCH_PATH and PI_PATCHCTL_PATH explicitly, then restart Pi/WebUI.",
  ].join(" ");
}

export function buildPlanOnlyPrompt(files: RecoveryFiles, previousModel: ModelRef | undefined): string {
  const previous = previousModel ? `${previousModel.provider}/${previousModel.id}` : "unknown";
  return [
    "Use the patch-md skill to inspect the Anthropic provider dist compatibility patch.",
    `Patch: ${files.patchPath}`,
    `Lifecycle runner: ${files.patchctlPath}`,
    `Previous failing model: ${previous}`,
    "Run patchctl status and patchctl plan only.",
    "Do not run patchctl apply, rollback, package installs, or live Anthropic verification in this recovery turn.",
    "Report target runtimes, package versions, classifications, risks, the deterministic plan hash, and the exact apply command for a separate explicit approval.",
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}

export function buildRecoveryPiArgs(model: ModelRef, promptFile: string): string[] {
  return ["--no-approve", "--provider", model.provider, "--model", model.id, `@${promptFile}`];
}

export function buildManualRecoveryCommand(model: ModelRef, promptFile: string): string {
  return ["pi", ...buildRecoveryPiArgs(model, promptFile)].map(shellQuote).join(" ");
}

export async function writeRecoveryPromptFile(prompt: string, base = tmpdir()): Promise<string> {
  const directory = join(base, "pi-anthropic-auth-recovery");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `plan-recovery-${Date.now()}-${randomUUID()}.md`);
  await writeFile(file, prompt, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return file;
}

function commandPath(command: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const extensions = process.platform === "win32" ? String(env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const directory of String(env.PATH || "").split(process.platform === "win32" ? ";" : ":")) {
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

async function spawnDetached(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolveSpawn, reject) => {
    const child = spawn(command, args, { cwd, detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolveSpawn(); });
  });
}

export async function openRecoveryTerminal(model: ModelRef, promptFile: string, cwd: string): Promise<void> {
  const piArgs = buildRecoveryPiArgs(model, promptFile);
  if (process.platform === "win32") {
    await spawnDetached("cmd.exe", ["/c", "start", RECOVERY_TITLE, "cmd.exe", "/k", "pi", ...piArgs], cwd);
    return;
  }
  if (process.platform === "darwin") {
    const command = `cd ${shellQuote(cwd)} && ${buildManualRecoveryCommand(model, promptFile)}; rm -f ${shellQuote(promptFile)}`;
    await spawnDetached("osascript", ["-e", `tell application "Terminal" to do script ${JSON.stringify(command)}`], cwd);
    return;
  }
  const commandLine = `cd ${shellQuote(cwd)} && ${buildManualRecoveryCommand(model, promptFile)}; status=$?; rm -f ${shellQuote(promptFile)}; echo; echo ${shellQuote("Recovery planning finished. Press Enter to close.")}; read _; exit $status`;
  const candidates: Array<[string, string[]]> = [
    ["x-terminal-emulator", ["-e", "bash", "-lc", commandLine]],
    ["gnome-terminal", ["--", "bash", "-lc", commandLine]],
    ["konsole", ["-e", "bash", "-lc", commandLine]],
    ["kitty", ["bash", "-lc", commandLine]],
    ["alacritty", ["-e", "bash", "-lc", commandLine]],
    ["foot", ["bash", "-lc", commandLine]],
    ["wezterm", ["start", "--", "bash", "-lc", commandLine]],
    ["xterm", ["-e", "bash", "-lc", commandLine]],
  ];
  for (const [command, args] of candidates) {
    const executable = commandPath(command);
    if (!executable) continue;
    await spawnDetached(executable, args, cwd);
    return;
  }
  throw new Error("No supported terminal launcher found");
}

function validatedRecoveryUrl(value: string): string {
  const url = new URL(value);
  const loopback = url.hostname === "localhost" || url.hostname === "::1" || /^127\./u.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("recovery URL must use HTTPS or loopback HTTP");
  }
  return url.href;
}

export async function postSecureWebuiRecovery(
  request: { prompt: string; cwd: string; model: ModelRef },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<SecureRecoveryResult> {
  const configuredUrl = env.PI_WEBUI_RECOVERY_URL?.trim();
  const token = env.PI_WEBUI_RECOVERY_TOKEN?.trim();
  if (!configuredUrl || !token) return { ok: false, reason: "secure WebUI recovery endpoint is not configured" };
  try {
    const url = validatedRecoveryUrl(configuredUrl);
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...request, mode: "plan-only" }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { ok: false, reason: `secure WebUI recovery returned ${response.status}` };
    const payload = await response.json() as { requestId?: unknown };
    return { ok: true, ...(typeof payload.requestId === "string" ? { requestId: payload.requestId } : {}) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function formatPatchStatusSummary(
  targets: Array<{ roles?: string[]; status?: string; packageVersion?: string }>,
): string {
  if (targets.length === 0) return "no runtime targets discovered";
  return targets
    .filter((target) => target.status !== "already-applied")
    .map((target) => `${(target.roles || []).join("+") || "runtime"}: ${target.status}${target.packageVersion ? ` (${target.packageVersion})` : ""}`)
    .join("; ");
}

export function shouldNotifyAnthropicCompatibility(summary: string, registry: AnthropicSubscriptionRegistryLike): boolean {
  if (!/applicable|drifted|unsupported/iu.test(summary)) return false;
  const model = registry.getAvailable().find((candidate) => candidate.provider === "anthropic");
  return Boolean(
    model
    && registry.hasConfiguredAuth(model)
    && registry.isUsingOAuth(model)
    && registry.getProvider("anthropic")?.auth?.oauth?.isSubscription === true,
  );
}

async function runPatchStatus(files: RecoveryFiles): Promise<{ ok: boolean; summary: string; payload?: unknown }> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [files.patchctlPath, "status", "--patch", files.patchPath], {
      cwd: dirname(files.patchPath),
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    const payload = JSON.parse(stdout) as { targets?: Array<{ roles?: string[]; status?: string; packageVersion?: string }> };
    return { ok: true, summary: formatPatchStatusSummary(payload.targets || []), payload };
  } catch (error) {
    return { ok: false, summary: error instanceof Error ? error.message : String(error) };
  }
}

async function queuePlanRecovery(ctx: ExtensionContext, files: RecoveryFiles, model: ModelRef): Promise<void> {
  const previousModel = ctx.model ? { provider: ctx.model.provider, id: ctx.model.id, name: ctx.model.name } : undefined;
  const prompt = buildPlanOnlyPrompt(files, previousModel);
  if (ctx.mode === "rpc") {
    const webui = await postSecureWebuiRecovery({ prompt, cwd: dirname(files.patchPath), model });
    if (webui.ok) {
      ctx.ui.notify(`Opened ${RECOVERY_TITLE}${webui.requestId ? ` (${webui.requestId})` : ""}`, "info");
      return;
    }
    const promptFile = await writeRecoveryPromptFile(prompt);
    ctx.ui.notify(`Recovery plan was not auto-opened: ${webui.reason}. Run locally: ${buildManualRecoveryCommand(model, promptFile)}`, "warning");
    const timer = setTimeout(() => void rm(promptFile, { force: true }), CLEANUP_DELAY_MS);
    timer.unref();
    return;
  }
  if (ctx.mode !== "tui") throw new Error(`Recovery UI is unavailable in ${ctx.mode} mode`);
  const promptFile = await writeRecoveryPromptFile(prompt);
  try {
    await openRecoveryTerminal(model, promptFile, dirname(files.patchPath));
    ctx.ui.notify(`Opened ${RECOVERY_TITLE} in a new terminal (plan only)`, "info");
  } catch (error) {
    ctx.ui.notify(`Could not open a terminal. Run: ${buildManualRecoveryCommand(model, promptFile)}`, "warning");
    throw error;
  } finally {
    const timer = setTimeout(() => void rm(promptFile, { force: true }), CLEANUP_DELAY_MS);
    timer.unref();
  }
}

export default function anthropicSubscriptionAuthRecovery(pi: ExtensionAPI) {
  let promptOpen = false;
  let startupChecked = false;
  const handledFingerprints = new Set<string>();

  pi.on("session_start", async (_event, ctx) => {
    if (startupChecked || !ctx.hasUI) return;
    startupChecked = true;
    const discovery = await inspectRecoveryFiles(process.env, ctx.cwd);
    if (!discovery.files) {
      ctx.ui.setStatus(STATUS_KEY, `Anthropic recovery unavailable: ${discovery.missing.join(" + ")}`);
      return;
    }
    const status = await runPatchStatus(discovery.files);
    if (!status.ok) {
      ctx.ui.setStatus(STATUS_KEY, "Anthropic patch status unavailable");
      return;
    }
    if (status.summary) {
      ctx.ui.setStatus(STATUS_KEY, status.summary);
      if (shouldNotifyAnthropicCompatibility(status.summary, ctx.modelRegistry as unknown as AnthropicSubscriptionRegistryLike)) {
        ctx.ui.notify(`Anthropic compatibility status: ${status.summary}`, "warning");
      }
    }
  });

  pi.registerCommand("anthropic-auth-status", {
    description: "Show read-only Anthropic dist compatibility status",
    handler: async (_args, ctx) => {
      const discovery = await inspectRecoveryFiles(process.env, ctx.cwd);
      if (!discovery.files) {
        ctx.ui.notify(formatRecoveryDiscoveryFailure(discovery), "warning");
        return;
      }
      const status = await runPatchStatus(discovery.files);
      ctx.ui.notify(status.summary || "No Anthropic compatibility action required", status.ok ? "info" : "error");
    },
  });

  pi.on("agent_end", async (event, ctx) => {
    if (!ctx.hasUI || ctx.model?.provider !== "anthropic" || promptOpen) return;
    const match = event.messages
      .map((message) => getAssistantErrorMessage(message))
      .map((message) => classifyAnthropicError(message, ctx.model?.provider))
      .find((candidate): candidate is ErrorMatch => Boolean(candidate));
    if (!match || handledFingerprints.has(match.fingerprint)) return;
    handledFingerprints.add(match.fingerprint);
    if (handledFingerprints.size > 64) handledFingerprints.delete(handledFingerprints.values().next().value as string);

    promptOpen = true;
    try {
      const discovery = await inspectRecoveryFiles(process.env, ctx.cwd);
      if (!discovery.files) throw new Error(formatRecoveryDiscoveryFailure(discovery));
      const files = discovery.files;
      const model = selectRecoveryModel(ctx.modelRegistry as unknown as ModelRegistryLike);
      if (!model) throw new Error("No configured non-Anthropic recovery model is available");
      const confirmed = await ctx.ui.confirm(
        "Inspect Anthropic compatibility patch?",
        [
          `Matched error classifier: ${match.classifier}`,
          "Open a separate recovery session that runs status and plan only?",
          "No files will be changed until you separately approve the returned plan hash.",
          `Recovery model: ${model.provider}/${model.id}`,
          `Patch: ${files.patchPath}`,
        ].join("\n"),
      );
      if (!confirmed) {
        ctx.ui.notify("Anthropic compatibility planning was not opened", "info");
        return;
      }
      await queuePlanRecovery(ctx, files, model);
    } catch (error) {
      ctx.ui.notify(`Anthropic compatibility recovery failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      promptOpen = false;
    }
  });
}
