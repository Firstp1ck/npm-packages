#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent";
const PI_AI_PACKAGE = "@earendil-works/pi-ai";
const WEBUI_PACKAGE = "@firstpick/pi-package-webui";
const PATCH_MARKER = "firstpick-patch: anthropic-agent-sdk-dist-compat-v2";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(value, needle) {
  return value.split(needle).length - 1;
}

function postconditionErrors(content, profile) {
  const errors = [];
  const requiredOnce = [
    PATCH_MARKER,
    "const claudeAgentSdkIdentityPrompt",
    "function claudeCodeBillingHeader()",
    "x-anthropic-billing-header: cc_version=",
    '"x-claude-code-session-id"',
    "options?.cacheRetention ?? (isOAuthToken ? \"long\" : undefined)",
  ];
  for (const needle of requiredOnce) {
    if (count(content, needle) !== 1) errors.push(`expected exactly one ${needle}`);
  }
  if (content.includes("You are Claude Code, Anthropic's official CLI for Claude.")) errors.push("legacy Claude Code identity prompt remains");
  if (!content.includes(profile.identityPrompt)) errors.push("Agent SDK identity prompt is missing");
  for (const beta of profile.betaFeatures) if (!content.includes(JSON.stringify(beta))) errors.push(`missing beta feature ${beta}`);
  return errors;
}

export function classifyContent(content, profile) {
  if (content.includes(PATCH_MARKER)) {
    const errors = postconditionErrors(content, profile);
    return errors.length === 0 ? { status: "already-applied", errors: [] } : { status: "drifted", errors };
  }
  const appearsUpstreamed = content.includes("x-anthropic-billing-header: cc_version=")
    && content.includes("You are a Claude agent, built on Anthropic's Claude Agent SDK.")
    && content.includes('"x-claude-code-session-id"');
  if (appearsUpstreamed) return { status: "upstreamed", errors: [] };
  const requiredLegacy = [
    "const claudeCodeVersion =",
    '"anthropic-beta": ["claude-code-20250219", "oauth-2025-04-20", ...betaFeatures].join(",")',
    '"user-agent": `claude-cli/${claudeCodeVersion}`',
    "You are Claude Code, Anthropic's official CLI for Claude.",
    "function createClient(",
    "sessionId",
  ];
  const missing = requiredLegacy.filter((needle) => !content.includes(needle));
  return missing.length === 0 ? { status: "applicable", errors: [] } : { status: "unsupported-layout", errors: missing.map((needle) => `missing semantic anchor: ${needle}`) };
}

function replaceExactlyOnce(content, regex, replacement, label) {
  const matches = [...content.matchAll(new RegExp(regex.source, `${regex.flags.includes("g") ? regex.flags : `${regex.flags}g`}`))];
  if (matches.length !== 1) throw new Error(`${label}: expected exactly one match, found ${matches.length}`);
  return content.replace(regex, replacement);
}

export function transformContent(content, profile) {
  const classification = classifyContent(content, profile);
  if (classification.status === "already-applied" || classification.status === "upstreamed") return content;
  if (classification.status !== "applicable") throw new Error(`Unsupported Anthropic implementation: ${classification.errors.join("; ")}`);

  const constants = `// ${PATCH_MARKER}\nconst firstpickAgentSdkProfile = Object.freeze({\n    version: process.env.PI_ANTHROPIC_AGENT_SDK_VERSION || ${JSON.stringify(profile.version)},\n    build: process.env.PI_ANTHROPIC_AGENT_SDK_BUILD || ${JSON.stringify(profile.build)},\n    entrypoint: process.env.PI_ANTHROPIC_AGENT_SDK_ENTRYPOINT || ${JSON.stringify(profile.entrypoint)},\n});\nconst claudeCodeVersion = firstpickAgentSdkProfile.version;\nconst claudeCodeBuild = firstpickAgentSdkProfile.build;\nconst claudeCodeEntrypoint = firstpickAgentSdkProfile.entrypoint;\nconst claudeAgentSdkIdentityPrompt = ${JSON.stringify(profile.identityPrompt)};\nfunction claudeCodeBillingHeader() {\n    return \`x-anthropic-billing-header: cc_version=\${claudeCodeVersion}.\${claudeCodeBuild}; cc_entrypoint=\${claudeCodeEntrypoint};\`;\n}`;
  let output = replaceExactlyOnce(content, /const claudeCodeVersion = "[^"]+";/u, constants, "Claude Code version constant");

  const oauthFeature = profile.betaFeatures.includes("oauth-2025-04-20") ? "oauth-2025-04-20" : profile.betaFeatures[0];
  const additionalBetaFeatures = profile.betaFeatures.filter((value) => value !== oauthFeature);
  const additionalBetaText = additionalBetaFeatures.length > 0
    ? `, ${additionalBetaFeatures.map((value) => JSON.stringify(value)).join(", ")}`
    : "";
  output = replaceExactlyOnce(
    output,
    /"anthropic-beta": \["claude-code-20250219", "oauth-2025-04-20", \.\.\.betaFeatures\]\.join\(","\),\r?\n(\s*)"user-agent": `claude-cli\/\$\{claudeCodeVersion\}`,\r?\n\1"x-app": "cli",/u,
    `"anthropic-beta": [...new Set([${JSON.stringify(oauthFeature)}, ...betaFeatures${additionalBetaText}])].join(","),\n$1"user-agent": \`claude-cli/\${claudeCodeVersion} (external, \${claudeCodeEntrypoint})\`,\n$1"x-app": "cli",\n$1...(sessionId ? { "x-claude-code-session-id": sessionId } : {}),`,
    "OAuth identity headers",
  );

  output = replaceExactlyOnce(
    output,
    /getCacheControl\(model, options\?\.cacheRetention(,\s*options\?\.env)?\)/u,
    (_match, envSuffix = "") => `getCacheControl(model, options?.cacheRetention ?? (isOAuthToken ? "long" : undefined)${envSuffix})`,
    "OAuth cache retention",
  );

  output = replaceExactlyOnce(
    output,
    /\{\r?\n(\s*)type: "text",\r?\n\1text: "You are Claude Code, Anthropic's official CLI for Claude\.",\r?\n\1\.\.\.\(cacheControl \? \{ cache_control: cacheControl \} : \{\}\),\r?\n(\s*)\},/u,
    (_match, innerIndent, outerIndent) => `{\n${innerIndent}type: "text",\n${innerIndent}text: claudeCodeBillingHeader(),\n${outerIndent}},\n${outerIndent}{\n${innerIndent}type: "text",\n${innerIndent}text: claudeAgentSdkIdentityPrompt,\n${innerIndent}...(cacheControl ? { cache_control: cacheControl } : {}),\n${outerIndent}},`,
    "OAuth system identity block",
  );

  const errors = postconditionErrors(output, profile);
  if (errors.length > 0) throw new Error(`Postcondition failure: ${errors.join("; ")}`);
  return output;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function packageRootFromPath(candidate, expectedName) {
  if (!candidate) return "";
  let current;
  try {
    const resolved = fs.realpathSync(candidate);
    current = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    return "";
  }
  while (true) {
    const packagePath = path.join(current, "package.json");
    if (fs.existsSync(packagePath)) {
      try {
        if (readJson(packagePath).name === expectedName) return current;
      } catch {}
    }
    const parent = path.dirname(current);
    if (parent === current) return "";
    current = parent;
  }
}

function commandPath(command, env = process.env) {
  if (!command) return "";
  if (command.includes(path.sep) || (path.sep === "\\" && command.includes("/"))) return fs.existsSync(command) ? command : "";
  const extensions = process.platform === "win32" ? String(env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const directory of String(env.PATH || "").split(path.delimiter)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {}
    }
  }
  return "";
}

function resolvePackageRoot(fromRoot, packageName) {
  const requireFromRoot = createRequire(path.join(fromRoot, "package.json"));
  for (const request of [`${packageName}/package.json`, packageName]) {
    try {
      const resolved = requireFromRoot.resolve(request);
      const root = packageRootFromPath(resolved, packageName);
      if (root) return root;
    } catch {}
  }
  const packageParts = packageName.split("/").filter(Boolean);
  for (const nodeModulesRoot of requireFromRoot.resolve.paths(packageName) || []) {
    const candidate = path.join(nodeModulesRoot, ...packageParts);
    const root = packageRootFromPath(candidate, packageName);
    if (root) return root;
  }
  return "";
}

function splitPaths(value) {
  return String(value || "").split(path.delimiter).map((item) => item.trim()).filter(Boolean);
}

function discoverCodingAgentRoots(manifest, env = process.env) {
  const roots = new Map();
  const add = (candidate, role) => {
    const root = packageRootFromPath(candidate, CODING_AGENT_PACKAGE);
    if (!root) return;
    const real = fs.realpathSync(root);
    if (!roots.has(real)) roots.set(real, new Set());
    roots.get(real).add(role);
  };

  const explicitNative = env.PI_PATCH_NATIVE_ENTRY || commandPath("pi", env);
  add(explicitNative, "native-tui");
  for (const entry of splitPaths(env.PI_PATCH_RUNTIME_ENTRIES)) add(entry, "explicit-runtime");
  for (const entry of splitPaths(env.PI_PATCH_WEBUI_ENTRIES)) add(entry, "webui-rpc");
  if (env.PI_WEBUI_PI_BIN) add(env.PI_WEBUI_PI_BIN, "webui-rpc");

  const patchRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const repoWebui = path.resolve(patchRoot, "../../pi-package-webui");
  const webuiCandidates = [
    ...splitPaths(env.PI_PATCH_WEBUI_ROOTS),
  ];
  if (env.PI_PATCH_DISABLE_AUTO_WEBUI_DISCOVERY !== "1") {
    webuiCandidates.push(repoWebui, path.join(os.homedir(), ".pi", "agent", "npm", "node_modules", ...WEBUI_PACKAGE.split("/")));
    const npmRoot = spawnSync("npm", ["root", "-g"], { encoding: "utf8", timeout: 3000 });
    if (npmRoot.status === 0) webuiCandidates.push(path.join(npmRoot.stdout.trim(), ...WEBUI_PACKAGE.split("/")));
  }
  for (const candidate of webuiCandidates) {
    const webuiRoot = packageRootFromPath(candidate, WEBUI_PACKAGE);
    if (!webuiRoot) continue;
    const codingRoot = resolvePackageRoot(webuiRoot, CODING_AGENT_PACKAGE);
    if (codingRoot) add(codingRoot, "webui-rpc");
  }
  return roots;
}

function findMutationFile(piAiRoot, candidates) {
  for (const relative of candidates) {
    const file = path.join(piAiRoot, relative);
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf8");
    if (content.includes("function createClient(") && (content.includes("You are Claude Code") || content.includes(PATCH_MARKER) || content.includes("x-anthropic-billing-header"))) return { file, relative, content };
  }
  return null;
}

function assertContained(root, file) {
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(file);
  const relative = path.relative(realRoot, realFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Target escapes package root: ${file}`);
  return realFile;
}

export function discoverTargets(manifest, env = process.env) {
  const profile = manifest.profile;
  const candidates = manifest.targets.flatMap((target) => target.fileCandidates);
  const targets = [];
  const roots = discoverCodingAgentRoots(manifest, env);
  for (const [codingRoot, rolesSet] of roots) {
    const piAiRoot = resolvePackageRoot(codingRoot, PI_AI_PACKAGE);
    if (!piAiRoot) {
      targets.push({ id: `missing-${sha256(codingRoot).slice(0, 12)}`, roles: [...rolesSet].sort(), codingAgentRoot: codingRoot, status: "missing-package", errors: [`${PI_AI_PACKAGE} could not be resolved`] });
      continue;
    }
    const packageJsonPath = path.join(piAiRoot, "package.json");
    const packageVersion = readJson(packageJsonPath).version;
    const mutation = findMutationFile(piAiRoot, candidates);
    if (!mutation) {
      targets.push({ id: `unknown-${sha256(piAiRoot).slice(0, 12)}`, roles: [...rolesSet].sort(), codingAgentRoot: codingRoot, packageRoot: piAiRoot, packageVersion, status: "unsupported-layout", errors: ["No supported Anthropic mutation implementation found"] });
      continue;
    }
    const targetFile = assertContained(piAiRoot, mutation.file);
    const classification = classifyContent(mutation.content, profile);
    const status = classification.status;
    const errors = [...classification.errors];
    const transformed = status === "applicable" ? transformContent(mutation.content, profile) : mutation.content;
    targets.push({
      id: `pi-ai-${sha256(targetFile).slice(0, 12)}`,
      roles: [...rolesSet].sort(),
      codingAgentRoot: codingRoot,
      packageRoot: piAiRoot,
      packageVersion,
      file: targetFile,
      relativeFile: mutation.relative,
      status,
      errors,
      beforeHash: sha256(mutation.content),
      afterHash: sha256(transformed),
    });
  }
  const merged = new Map();
  for (const target of targets) {
    const key = target.file ? `file:${target.file}` : `root:${target.codingAgentRoot}:${target.status}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...target, codingAgentRoots: [target.codingAgentRoot] });
      continue;
    }
    existing.roles = [...new Set([...(existing.roles || []), ...(target.roles || [])])].sort();
    existing.codingAgentRoots = [...new Set([...existing.codingAgentRoots, target.codingAgentRoot])].sort();
  }
  return [...merged.values()].sort((a, b) => String(a.file || a.codingAgentRoot).localeCompare(String(b.file || b.codingAgentRoot)));
}

function buildPlan(manifest, env = process.env) {
  const targets = discoverTargets(manifest, env);
  const hasNative = targets.some((target) => target.roles?.includes("native-tui"));
  const blockingStatuses = new Set(["drifted", "unsupported-layout", "missing-package"]);
  const blockedTargets = targets.filter((target) => blockingStatuses.has(target.status));
  const blocked = !hasNative || blockedTargets.length > 0;
  return {
    ok: !blocked,
    blocked,
    writes: targets.filter((target) => target.status === "applicable").length,
    noop: targets.length > 0 && targets.every((target) => ["already-applied", "upstreamed"].includes(target.status)),
    missingRequiredRoles: hasNative ? [] : ["native-tui"],
    targets,
    risks: manifest.risk.notes,
  };
}

function syntaxCheck(file) {
  const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8", timeout: 30_000 });
  return { passed: check.status === 0, output: [check.stdout, check.stderr].filter(Boolean).join("\n").trim() };
}

function atomicReplace(file, content, mode) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.js`);
  fs.writeFileSync(temporary, content, { encoding: "utf8", mode, flag: "wx" });
  const check = syntaxCheck(temporary);
  if (!check.passed) {
    fs.rmSync(temporary, { force: true });
    throw new Error(`Prepared file failed syntax check: ${file}: ${check.output}`);
  }
  fs.renameSync(temporary, file);
}

function applyPlan(manifest, plan, stateDir) {
  const current = new Map(discoverTargets(manifest).map((target) => [target.file, target]));
  const applicable = plan.targets.filter((target) => target.status === "applicable");
  const prepared = [];
  for (const target of applicable) {
    const now = current.get(target.file);
    if (!now || now.status !== "applicable" || now.beforeHash !== target.beforeHash) throw new Error(`Target drifted after plan: ${target.file}`);
    const beforeContent = fs.readFileSync(target.file, "utf8");
    const afterContent = transformContent(beforeContent, manifest.profile);
    if (sha256(afterContent) !== target.afterHash) throw new Error(`Transformed hash changed after plan: ${target.file}`);
    const mode = fs.statSync(target.file).mode & 0o777;
    prepared.push({ target, beforeContent, afterContent, mode });
  }

  const backupRoot = path.join(stateDir, "backups", manifest.id, plan.planHash);
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  for (const item of prepared) {
    item.backupPath = path.join(backupRoot, `${item.target.id}.bak`);
    if (!fs.existsSync(item.backupPath)) {
      fs.writeFileSync(item.backupPath, item.beforeContent, { encoding: "utf8", mode: 0o600, flag: "wx" });
      continue;
    }
    const metadata = fs.lstatSync(item.backupPath);
    if (!metadata.isFile() || metadata.nlink !== 1) throw new Error(`Existing backup is not a regular single-link file: ${item.backupPath}`);
    const existingHash = sha256(fs.readFileSync(item.backupPath));
    if (existingHash !== item.target.beforeHash) throw new Error(`Existing backup hash mismatch: ${item.backupPath}`);
  }

  const committed = [];
  try {
    for (const item of prepared) {
      atomicReplace(item.target.file, item.afterContent, item.mode);
      committed.push(item);
    }
  } catch (error) {
    for (const item of committed.reverse()) {
      try { atomicReplace(item.target.file, item.beforeContent, item.mode); } catch {}
    }
    throw error;
  }

  for (const item of prepared) {
    const currentHash = sha256(fs.readFileSync(item.target.file));
    if (currentHash !== item.target.afterHash) throw new Error(`Committed file failed hash verification: ${item.target.file}`);
  }
  return {
    targets: prepared.map((item) => ({
      id: item.target.id,
      roles: item.target.roles,
      packageVersion: item.target.packageVersion,
      packageRoot: item.target.packageRoot,
      path: item.target.file,
      beforeHash: item.target.beforeHash,
      afterHash: item.target.afterHash,
      backupPath: item.backupPath,
      mode: item.mode,
    })),
  };
}

async function captureRuntime(target, profile) {
  const captures = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      captures.push({ headers: request.headers, system: body.system?.slice(0, 3) });
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "offline capture complete" } }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const module = await import(`${pathToFileURL(target.file).href}?verify=${Date.now()}-${randomUUID()}`);
    const stream = module.stream ?? module.streamAnthropic;
    if (typeof stream !== "function") throw new Error("No stream or streamAnthropic export");
    const address = server.address();
    const model = {
      id: "claude-haiku-4-5", name: "Offline fixture", api: "anthropic-messages", provider: "anthropic",
      baseUrl: `http://127.0.0.1:${address.port}`, reasoning: false, input: ["text"], output: ["text"],
      contextWindow: 200000, maxTokens: 32, compat: { supportsLongCacheRetention: true },
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    for await (const _event of stream(model, { messages: [{ role: "user", content: "offline capture", timestamp: Date.now() }], systemPrompt: "offline system" }, {
      apiKey: "sk-ant-oat-fake-offline-capture-token",
      maxTokens: 16,
      sessionId: "11111111-2222-4333-8444-555555555555",
    })) {}
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  if (captures.length !== 1) throw new Error(`Expected one local capture, got ${captures.length}`);
  const capture = captures[0];
  const beta = String(capture.headers["anthropic-beta"] || "");
  const checks = [
    [capture.headers["x-claude-code-session-id"] === "11111111-2222-4333-8444-555555555555", "session header"],
    [String(capture.headers["user-agent"] || "").includes("(external, sdk-cli)"), "user agent"],
    [profile.betaFeatures.every((feature) => beta.includes(feature)), "beta features"],
    [String(capture.system?.[0]?.text || "").startsWith("x-anthropic-billing-header:"), "billing system block"],
    [capture.system?.[1]?.text === profile.identityPrompt, "identity system block"],
    [capture.system?.[1]?.cache_control?.ttl === "1h", "long cache control"],
  ];
  const failures = checks.filter(([passed]) => !passed).map(([, label]) => label);
  if (failures.length > 0) throw new Error(`Offline request capture failed: ${failures.join(", ")}`);
  return { passed: true, checks: checks.map(([, label]) => label) };
}

async function verify(manifest, receiptFile = "") {
  const targets = discoverTargets(manifest);
  const checks = [];
  for (const target of targets) {
    if (!target.file) {
      checks.push({ id: target.id, passed: false, status: target.status, errors: target.errors });
      continue;
    }
    const syntax = syntaxCheck(target.file);
    const semantic = ["already-applied", "upstreamed"].includes(target.status);
    let capture = { passed: true, skipped: target.status === "upstreamed" };
    if (semantic && target.status !== "upstreamed") {
      try { capture = await captureRuntime(target, manifest.profile); }
      catch (error) { capture = { passed: false, error: error instanceof Error ? error.message : String(error) }; }
    }
    checks.push({ id: target.id, path: target.file, status: target.status, passed: syntax.passed && semantic && capture.passed, syntax, capture });
  }
  if (receiptFile && fs.existsSync(receiptFile)) {
    const receipt = readJson(receiptFile);
    for (const target of receipt.targets || []) checks.push({ id: `receipt-${target.id}`, passed: fs.existsSync(target.backupPath) && sha256(fs.readFileSync(target.backupPath)) === target.beforeHash, backupPath: target.backupPath });
  }
  return { ok: checks.length > 0 && checks.every((check) => check.passed), checks, networkUsed: false, billingUsed: false };
}

function rollback(receipt) {
  const targets = receipt.targets || [];
  const prepared = [];
  for (const target of targets) {
    const current = fs.readFileSync(target.path);
    if (sha256(current) !== target.afterHash) throw new Error(`Rollback refused because target drifted: ${target.path}`);
    const backup = fs.readFileSync(target.backupPath);
    if (sha256(backup) !== target.beforeHash) throw new Error(`Rollback backup hash mismatch: ${target.backupPath}`);
    prepared.push({ target, current, backup });
  }
  const committed = [];
  try {
    for (const item of prepared) {
      atomicReplace(item.target.path, item.backup, item.target.mode ?? 0o644);
      committed.push(item);
    }
  } catch (error) {
    for (const item of committed.reverse()) {
      try { atomicReplace(item.target.path, item.current, item.target.mode ?? 0o644); } catch {}
    }
    throw error;
  }
  return { writes: prepared.length };
}

function parseArgs(argv) {
  const options = { action: argv[0] || "", manifest: "", patch: "", stateDir: "", planFile: "", receiptFile: "", handlerArgs: [] };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--manifest") options.manifest = argv[++i] ?? "";
    else if (arg === "--patch") options.patch = argv[++i] ?? "";
    else if (arg === "--state-dir") options.stateDir = argv[++i] ?? "";
    else if (arg === "--plan-file") options.planFile = argv[++i] ?? "";
    else if (arg === "--receipt-file") options.receiptFile = argv[++i] ?? "";
    else if (arg === "--handler-arg") options.handlerArgs.push(argv[++i] ?? "");
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readJson(options.manifest);
  let result;
  if (options.action === "status") result = { ok: true, targets: discoverTargets(manifest) };
  else if (options.action === "plan") result = buildPlan(manifest);
  else if (options.action === "apply") {
    const plan = readJson(options.planFile);
    const receipt = applyPlan(manifest, plan, options.stateDir);
    result = { ok: true, receipt, result: { writes: receipt.targets.length } };
  } else if (options.action === "verify") result = await verify(manifest, options.receiptFile);
  else if (options.action === "rollback") result = { ok: true, result: rollback(readJson(options.receiptFile)) };
  else throw new Error(`Unsupported action: ${options.action}`);
  process.stdout.write(JSON.stringify(result));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
