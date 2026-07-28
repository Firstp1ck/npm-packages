#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent";
const WEBUI_PACKAGE = "@firstpick/pi-package-webui";
const SUPPORTED_VERSION = "0.82.1";
const AGENT_SESSION_FILE = "dist/core/agent-session.js";
const MODEL_SELECTOR_FILE = "dist/modes/interactive/components/model-selector.js";

const AGENT_REMOVALS = [
  "        this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);\n",
  "        this.settingsManager.setDefaultModelAndProvider(next.model.provider, next.model.id);\n",
  "        this.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);\n",
  "                this.settingsManager.setDefaultThinkingLevel(effectiveLevel);\n",
];
const SELECTOR_REMOVAL = "        // Save as new default\n        this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);\n";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(value, needle) {
  return value.split(needle).length - 1;
}

function lineCount(value, needle) {
  return count(value, needle);
}

function errorsForExpectedCounts(content, expected) {
  const errors = [];
  for (const [label, needle, expectedCount] of expected) {
    const actual = lineCount(content, needle);
    if (actual !== expectedCount) errors.push(`${label}: expected ${expectedCount}, found ${actual}`);
  }
  return errors;
}

const AGENT_NORMALIZED_INVARIANT_ANCHORS = [
  ["setModel method", "    async setModel(model) {", 1],
  ["scoped model cycle", "    async _cycleScopedModel(direction) {", 1],
  ["available model cycle", "    async _cycleAvailableModel(direction) {", 1],
  ["thinking method", "    setThinkingLevel(level) {", 1],
  ["direct session model append", "        this.sessionManager.appendModelChange(model.provider, model.id);", 1],
  ["scoped session model append", "        this.sessionManager.appendModelChange(next.model.provider, next.model.id);", 1],
  ["available session model append", "        this.sessionManager.appendModelChange(nextModel.provider, nextModel.id);", 1],
  ["session thinking append", "            this.sessionManager.appendThinkingLevelChange(effectiveLevel);", 1],
  ["thinking capability clamp", "        const effectiveLevel = availableLevels.includes(level) ? level : this._clampThinkingLevel(level, availableLevels);", 1],
  ["thinking event", "            this._emit({ type: \"thinking_level_changed\", level: effectiveLevel });", 1],
  ["thinking extension event", "                type: \"thinking_level_select\",", 1],
  ["model switch reclamps", "        this.setThinkingLevel(thinkingLevel);", 3],
  ["direct model event", "        await this._emitModelSelect(model, previousModel, \"set\");", 1],
  ["scoped model event", "        await this._emitModelSelect(next.model, currentModel, \"cycle\");", 1],
  ["available model event", "        await this._emitModelSelect(nextModel, currentModel, \"cycle\");", 1],
];

const SELECTOR_INVARIANT_ANCHORS = [
  ["selector method", "    handleSelect(model) {", 1],
  ["selector close", "    handleSelect(model) {\n        this.close();", 1],
  ["selector callback", "        this.onSelectCallback(model);", 1],
];

function agentSessionPostconditionErrors(content) {
  const errors = errorsForExpectedCounts(content, AGENT_NORMALIZED_INVARIANT_ANCHORS);
  const modelDefaultWrites = count(content, "this.settingsManager.setDefaultModelAndProvider(");
  const thinkingDefaultWrites = count(content, "this.settingsManager.setDefaultThinkingLevel(");
  if (modelDefaultWrites !== 0) errors.push(`remaining model default writes: expected 0, found ${modelDefaultWrites}`);
  if (thinkingDefaultWrites !== 0) errors.push(`remaining thinking default writes: expected 0, found ${thinkingDefaultWrites}`);
  return errors;
}

function modelSelectorPostconditionErrors(content) {
  const errors = errorsForExpectedCounts(content, SELECTOR_INVARIANT_ANCHORS);
  const defaultWrites = count(content, "this.settingsManager.setDefaultModelAndProvider(");
  if (defaultWrites !== 0) errors.push(`remaining selector model default writes: expected 0, found ${defaultWrites}`);
  return errors;
}

function classifyAgentSessionContent(content) {
  const invariantErrors = errorsForExpectedCounts(content, AGENT_NORMALIZED_INVARIANT_ANCHORS);
  if (invariantErrors.length > 0) return { status: "unsupported-layout", errors: invariantErrors };

  const modelDefaultWrites = count(content, "this.settingsManager.setDefaultModelAndProvider(");
  const thinkingDefaultWrites = count(content, "this.settingsManager.setDefaultThinkingLevel(");
  const exactRemovals = AGENT_REMOVALS.map((needle) => count(content, needle));
  const applicable = modelDefaultWrites === 3 && thinkingDefaultWrites === 1 && exactRemovals.every((matches) => matches === 1);
  if (applicable) return { status: "applicable", errors: [] };

  const postconditionErrors = agentSessionPostconditionErrors(content);
  if (postconditionErrors.length === 0) return { status: "already-applied", errors: [] };

  return {
    status: "unsupported-layout",
    errors: [
      ...postconditionErrors,
      `expected the four exact default-write anchors once each; found ${exactRemovals.join(", ")}`,
    ],
  };
}

function classifyModelSelectorContent(content) {
  const invariantErrors = errorsForExpectedCounts(content, SELECTOR_INVARIANT_ANCHORS);
  if (invariantErrors.length > 0) return { status: "unsupported-layout", errors: invariantErrors };

  const defaultWrites = count(content, "this.settingsManager.setDefaultModelAndProvider(");
  const exactRemovalCount = count(content, SELECTOR_REMOVAL);
  if (defaultWrites === 1 && exactRemovalCount === 1) return { status: "applicable", errors: [] };

  const postconditionErrors = modelSelectorPostconditionErrors(content);
  if (postconditionErrors.length === 0) return { status: "already-applied", errors: [] };

  return {
    status: "unsupported-layout",
    errors: [...postconditionErrors, `expected the exact selector default-write anchor once; found ${exactRemovalCount}`],
  };
}

/** Classify exactly one supported compiled runtime file without mutating it. */
export function classifyContent(content, relativeFile) {
  if (relativeFile === AGENT_SESSION_FILE) return classifyAgentSessionContent(content);
  if (relativeFile === MODEL_SELECTOR_FILE) return classifyModelSelectorContent(content);
  return { status: "unsupported-layout", errors: [`unsupported runtime file: ${relativeFile}`] };
}

function removeExactlyOnce(content, needle, label) {
  const matches = count(content, needle);
  if (matches !== 1) throw new Error(`${label}: expected exactly one anchor, found ${matches}`);
  return content.replace(needle, "");
}

/** Apply the narrow content-only transform. Already-compatible content is a no-op. */
export function transformContent(content, relativeFile) {
  const classification = classifyContent(content, relativeFile);
  if (classification.status === "already-applied") return content;
  if (classification.status !== "applicable") throw new Error(`Unsupported ${relativeFile}: ${classification.errors.join("; ")}`);

  let output = content;
  if (relativeFile === AGENT_SESSION_FILE) {
    for (const [index, needle] of AGENT_REMOVALS.entries()) output = removeExactlyOnce(output, needle, `AgentSession default write ${index + 1}`);
  } else if (relativeFile === MODEL_SELECTOR_FILE) {
    output = removeExactlyOnce(output, SELECTOR_REMOVAL, "native model selector default write");
  }

  const postcondition = classifyContent(output, relativeFile);
  if (postcondition.status !== "already-applied") throw new Error(`Postcondition failure for ${relativeFile}: ${postcondition.errors.join("; ")}`);
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
    try {
      if (fs.existsSync(packagePath) && readJson(packagePath).name === expectedName) return current;
    } catch {
      return "";
    }
    const parent = path.dirname(current);
    if (parent === current) return "";
    current = parent;
  }
}

function resolvePackageRoot(fromRoot, packageName) {
  let requireFromRoot;
  try {
    requireFromRoot = createRequire(path.join(fromRoot, "package.json"));
  } catch {
    return "";
  }
  for (const request of [`${packageName}/package.json`, packageName]) {
    try {
      const root = packageRootFromPath(requireFromRoot.resolve(request), packageName);
      if (root) return root;
    } catch {}
  }
  const parts = packageName.split("/").filter(Boolean);
  for (const nodeModulesRoot of requireFromRoot.resolve.paths(packageName) || []) {
    const root = packageRootFromPath(path.join(nodeModulesRoot, ...parts), packageName);
    if (root) return root;
  }
  return "";
}

function commandPath(command, env = process.env) {
  if (!command) return "";
  if (command.includes(path.sep) || (path.sep === "\\" && command.includes("/"))) return fs.existsSync(command) ? command : "";
  const extensions = process.platform === "win32" ? String(env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const directory of String(env.PATH || "").split(path.delimiter)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  return "";
}

function splitPaths(value) {
  return String(value || "").split(path.delimiter).map((item) => item.trim()).filter(Boolean);
}

function addRoot(roots, candidate, role) {
  const root = packageRootFromPath(candidate, CODING_AGENT_PACKAGE);
  if (!root) return false;
  const real = fs.realpathSync(root);
  if (!roots.has(real)) roots.set(real, new Set());
  roots.get(real).add(role);
  return true;
}

/** Discover actual native and WebUI coding-agent dependency roots, deduplicated by real path. */
export function discoverRuntimeRoots(env = process.env) {
  const roots = new Map();
  const errors = [];

  const nativeOverride = env.PI_PATCH_NATIVE_ENTRY;
  const nativeEntry = nativeOverride || commandPath("pi", env);
  if (!nativeEntry) {
    errors.push({ role: "native-tui", error: nativeOverride ? "PI_PATCH_NATIVE_ENTRY does not exist" : "pi executable was not found" });
  } else if (!addRoot(roots, nativeEntry, "native-tui")) {
    errors.push({ role: "native-tui", error: `native entry did not resolve ${CODING_AGENT_PACKAGE}: ${nativeEntry}` });
  }

  for (const entry of splitPaths(env.PI_PATCH_RUNTIME_ENTRIES)) {
    if (!addRoot(roots, entry, "explicit-runtime")) errors.push({ role: "explicit-runtime", error: `runtime entry did not resolve ${CODING_AGENT_PACKAGE}: ${entry}` });
  }
  for (const entry of splitPaths(env.PI_PATCH_WEBUI_ENTRIES)) {
    if (!addRoot(roots, entry, "webui-rpc")) errors.push({ role: "webui-rpc", error: `WebUI runtime entry did not resolve ${CODING_AGENT_PACKAGE}: ${entry}` });
  }
  if (env.PI_WEBUI_PI_BIN && !addRoot(roots, env.PI_WEBUI_PI_BIN, "webui-rpc")) {
    errors.push({ role: "webui-rpc", error: `PI_WEBUI_PI_BIN did not resolve ${CODING_AGENT_PACKAGE}: ${env.PI_WEBUI_PI_BIN}` });
  }

  const explicitWebuiRoots = splitPaths(env.PI_PATCH_WEBUI_ROOTS);
  const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const candidates = explicitWebuiRoots.length > 0
    ? explicitWebuiRoots
    : [
      commandPath("pi-webui", env),
      path.resolve(packageRoot, "../../pi-package-webui"),
      path.join(os.homedir(), ".pi", "agent", "npm", "node_modules", ...WEBUI_PACKAGE.split("/")),
    ];
  if (explicitWebuiRoots.length === 0) {
    const npmRoot = spawnSync("npm", ["root", "-g"], { encoding: "utf8", timeout: 3000 });
    if (npmRoot.status === 0 && npmRoot.stdout.trim()) candidates.push(path.join(npmRoot.stdout.trim(), ...WEBUI_PACKAGE.split("/")));
  }
  for (const candidate of candidates.filter(Boolean)) {
    const webuiRoot = packageRootFromPath(candidate, WEBUI_PACKAGE);
    if (!webuiRoot) {
      if (explicitWebuiRoots.includes(candidate)) errors.push({ role: "webui-rpc", error: `WebUI root did not resolve ${WEBUI_PACKAGE}: ${candidate}` });
      continue;
    }
    const codingRoot = resolvePackageRoot(webuiRoot, CODING_AGENT_PACKAGE);
    if (!codingRoot) {
      errors.push({ role: "webui-rpc", error: `${CODING_AGENT_PACKAGE} could not be resolved from WebUI root: ${webuiRoot}` });
      continue;
    }
    addRoot(roots, codingRoot, "webui-rpc");
  }

  return { roots, errors };
}

function assertContained(root, file) {
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(file);
  const relative = path.relative(realRoot, realFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Target escapes package root: ${file}`);
  return realFile;
}

function unsupportedTarget(codingRoot, roles, relativeFile, error) {
  return {
    id: `${path.basename(relativeFile, ".js")}-${sha256(`${codingRoot}:${relativeFile}`).slice(0, 12)}`,
    roles,
    codingAgentRoot: codingRoot,
    relativeFile,
    status: "unsupported-layout",
    errors: [error],
  };
}

/** Discover and semantically classify every required file reachable from native/WebUI runtime graphs. */
export function discoverTargets(manifest, env = process.env) {
  const { roots, errors: discoveryErrors } = discoverRuntimeRoots(env);
  const targets = [];
  for (const [codingAgentRoot, roleSet] of roots) {
    const roles = [...roleSet].sort();
    let packageInfo;
    try {
      packageInfo = readJson(path.join(codingAgentRoot, "package.json"));
    } catch (error) {
      for (const relativeFile of [AGENT_SESSION_FILE, MODEL_SELECTOR_FILE]) targets.push(unsupportedTarget(codingAgentRoot, roles, relativeFile, `could not read package.json: ${String(error)}`));
      continue;
    }
    const packageVersion = packageInfo.version;
    for (const relativeFile of [AGENT_SESSION_FILE, MODEL_SELECTOR_FILE]) {
      const candidate = path.join(codingAgentRoot, relativeFile);
      if (packageVersion !== SUPPORTED_VERSION) {
        targets.push({ ...unsupportedTarget(codingAgentRoot, roles, relativeFile, `unsupported ${CODING_AGENT_PACKAGE} version: ${packageVersion || "missing"}; expected ${SUPPORTED_VERSION}`), packageVersion });
        continue;
      }
      if (!fs.existsSync(candidate)) {
        targets.push({ ...unsupportedTarget(codingAgentRoot, roles, relativeFile, `required runtime file is missing: ${relativeFile}`), packageVersion });
        continue;
      }
      try {
        const file = assertContained(codingAgentRoot, candidate);
        const content = fs.readFileSync(file, "utf8");
        const classification = classifyContent(content, relativeFile);
        const transformed = classification.status === "applicable" ? transformContent(content, relativeFile) : content;
        targets.push({
          id: `${path.basename(relativeFile, ".js")}-${sha256(file).slice(0, 12)}`,
          roles,
          codingAgentRoot,
          packageVersion,
          file,
          relativeFile,
          status: classification.status,
          errors: classification.errors,
          beforeHash: sha256(content),
          afterHash: sha256(transformed),
        });
      } catch (error) {
        targets.push({ ...unsupportedTarget(codingAgentRoot, roles, relativeFile, error instanceof Error ? error.message : String(error)), packageVersion });
      }
    }
  }
  return {
    targets: targets.sort((a, b) => `${a.codingAgentRoot}:${a.relativeFile}`.localeCompare(`${b.codingAgentRoot}:${b.relativeFile}`)),
    discoveryErrors,
  };
}

function buildPlan(manifest, env = process.env) {
  const { targets, discoveryErrors } = discoverTargets(manifest, env);
  const nativeFound = targets.some((target) => target.roles?.includes("native-tui"));
  const blockedTargets = targets.filter((target) => target.status === "unsupported-layout");
  const groups = new Map();
  for (const target of targets) {
    if (!groups.has(target.codingAgentRoot)) groups.set(target.codingAgentRoot, []);
    groups.get(target.codingAgentRoot).push(target);
  }
  const partialRoots = [];
  for (const [root, group] of groups) {
    const statuses = new Set(group.map((target) => target.status));
    if (statuses.has("applicable") && statuses.size > 1) partialRoots.push({ root, statuses: [...statuses].sort() });
  }
  const blocked = !nativeFound || discoveryErrors.length > 0 || blockedTargets.length > 0 || partialRoots.length > 0;
  const applicable = blocked ? [] : targets.filter((target) => target.status === "applicable");
  return {
    ok: !blocked,
    blocked,
    writes: applicable.length,
    noop: !blocked && targets.length > 0 && applicable.length === 0,
    missingRequiredRoles: nativeFound ? [] : ["native-tui"],
    discoveryErrors,
    partialRoots,
    targets,
    risks: manifest.risk?.notes || [],
  };
}

function syntaxCheck(file) {
  const check = spawnSync(process.execPath, ["--check", file], { encoding: "utf8", timeout: 30_000 });
  return { passed: check.status === 0, output: [check.stdout, check.stderr].filter(Boolean).join("\n").trim() };
}

function atomicReplace(file, content, mode) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp.js`);
  fs.writeFileSync(temporary, content, { encoding: "utf8", mode, flag: "wx" });
  const syntax = syntaxCheck(temporary);
  if (!syntax.passed) {
    fs.rmSync(temporary, { force: true });
    throw new Error(`Prepared file failed syntax check: ${file}: ${syntax.output}`);
  }
  fs.renameSync(temporary, file);
}

function backupRootFor(manifest, stateDir, planHash) {
  return path.join(stateDir, "backups", manifest.id.replace(/[^a-zA-Z0-9._-]/gu, "-"), planHash);
}

function assertBackup(file, expectedHash) {
  const metadata = fs.lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) throw new Error(`Backup is not a regular single-link file: ${file}`);
  const content = fs.readFileSync(file, "utf8");
  if (sha256(content) !== expectedHash) throw new Error(`Backup hash mismatch: ${file}`);
  return content;
}

function targetMap(targets) {
  return new Map(targets.filter((target) => target.file).map((target) => [target.id, target]));
}

function applyPlan(manifest, plan, stateDir) {
  if (plan.blocked || plan.ok === false || !plan.planHash) throw new Error("Apply requires an unblocked patchctl plan with a planHash");
  const currentDiscovery = discoverTargets(manifest);
  if (currentDiscovery.discoveryErrors.length > 0) throw new Error(`Runtime discovery drifted after plan: ${currentDiscovery.discoveryErrors.map((item) => item.error).join("; ")}`);
  const current = targetMap(currentDiscovery.targets);
  const planned = targetMap(plan.targets || []);
  if (current.size !== planned.size || [...planned.keys()].some((id) => !current.has(id))) throw new Error("Runtime target set drifted after plan");

  const applicable = (plan.targets || []).filter((target) => target.status === "applicable");
  if (applicable.length === 0) return { targets: [] };
  const prepared = [];
  for (const target of applicable) {
    const now = current.get(target.id);
    if (!now || now.status !== "applicable" || now.beforeHash !== target.beforeHash || now.afterHash !== target.afterHash || now.file !== target.file) {
      throw new Error(`Target drifted after plan: ${target.file || target.id}`);
    }
    const beforeContent = fs.readFileSync(now.file, "utf8");
    const afterContent = transformContent(beforeContent, now.relativeFile);
    if (sha256(afterContent) !== target.afterHash) throw new Error(`Transformed hash changed after plan: ${target.file}`);
    prepared.push({ target: now, beforeContent, afterContent, mode: fs.statSync(now.file).mode & 0o777 });
  }

  const backupRoot = backupRootFor(manifest, stateDir, plan.planHash);
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  for (const item of prepared) {
    item.backupPath = path.join(backupRoot, `${item.target.id}.bak`);
    if (!fs.existsSync(item.backupPath)) fs.writeFileSync(item.backupPath, item.beforeContent, { encoding: "utf8", mode: 0o600, flag: "wx" });
    else assertBackup(item.backupPath, item.target.beforeHash);
  }

  const committed = [];
  try {
    for (const item of prepared) {
      atomicReplace(item.target.file, item.afterContent, item.mode);
      committed.push(item);
    }
    for (const item of prepared) {
      const content = fs.readFileSync(item.target.file, "utf8");
      if (sha256(content) !== item.target.afterHash) throw new Error(`Committed file hash mismatch: ${item.target.file}`);
      const semantic = classifyContent(content, item.target.relativeFile);
      if (semantic.status !== "already-applied") throw new Error(`Committed postcondition failed: ${item.target.file}: ${semantic.errors.join("; ")}`);
    }
  } catch (error) {
    const restoreErrors = [];
    for (const item of committed.reverse()) {
      try {
        atomicReplace(item.target.file, item.beforeContent, item.mode);
      } catch (restoreError) {
        restoreErrors.push(`${item.target.file}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
      }
    }
    if (restoreErrors.length > 0) {
      const primary = error instanceof Error ? error.message : String(error);
      throw new Error(`${primary}; automatic restore failures: ${restoreErrors.join("; ")}`, { cause: error });
    }
    throw error;
  }

  return {
    targets: prepared.map((item) => ({
      id: item.target.id,
      roles: item.target.roles,
      packageVersion: item.target.packageVersion,
      packageRoot: item.target.codingAgentRoot,
      path: item.target.file,
      relativeFile: item.target.relativeFile,
      beforeHash: item.target.beforeHash,
      afterHash: item.target.afterHash,
      backupPath: item.backupPath,
      mode: item.mode,
    })),
  };
}

async function verify(manifest, receiptFile = "") {
  const { targets, discoveryErrors } = discoverTargets(manifest);
  const checks = discoveryErrors.map((item, index) => ({ id: `discovery-${index + 1}`, passed: false, error: item.error }));
  const currentByFile = new Map();
  for (const target of targets) {
    const syntax = target.file ? syntaxCheck(target.file) : { passed: false, output: "no runtime file" };
    const semantic = target.status === "already-applied";
    checks.push({ id: target.id, path: target.file, status: target.status, passed: syntax.passed && semantic, syntax, errors: target.errors });
    if (target.file) currentByFile.set(target.file, target);
  }
  if (receiptFile && fs.existsSync(receiptFile)) {
    const receipt = readJson(receiptFile);
    const receiptTargets = receipt.targets || [];
    const receiptPaths = new Set();
    for (const target of receiptTargets) {
      let passed = true;
      const errors = [];
      if (receiptPaths.has(target.path)) { passed = false; errors.push("duplicate receipt target path"); }
      receiptPaths.add(target.path);
      const current = currentByFile.get(target.path);
      if (!current || current.id !== target.id || current.status !== "already-applied") { passed = false; errors.push("receipt target is not currently discovered as postcondition-compatible"); }
      try {
        if (sha256(fs.readFileSync(target.path, "utf8")) !== target.afterHash) { passed = false; errors.push("after hash mismatch"); }
        assertBackup(target.backupPath, target.beforeHash);
      } catch (error) {
        passed = false;
        errors.push(error instanceof Error ? error.message : String(error));
      }
      checks.push({ id: `receipt-${target.id}`, path: target.path, backupPath: target.backupPath, passed, errors });
    }
  }
  return { ok: checks.length > 0 && checks.every((check) => check.passed), checks, networkUsed: false, billingUsed: false };
}

function rollback(receipt) {
  const targets = receipt.targets || [];
  const prepared = [];
  const paths = new Set();
  for (const target of targets) {
    if (!target.path || paths.has(target.path)) throw new Error(`Invalid or duplicate receipt target: ${target.path || "missing path"}`);
    paths.add(target.path);
    const current = fs.readFileSync(target.path, "utf8");
    if (sha256(current) !== target.afterHash) throw new Error(`Rollback refused because target drifted: ${target.path}`);
    const backup = assertBackup(target.backupPath, target.beforeHash);
    const classification = classifyContent(backup, target.relativeFile);
    if (classification.status !== "applicable") throw new Error(`Rollback backup is not the original supported layout: ${target.path}`);
    prepared.push({ target, current, backup });
  }
  const committed = [];
  try {
    for (const item of prepared) {
      atomicReplace(item.target.path, item.backup, item.target.mode ?? 0o644);
      committed.push(item);
    }
    for (const item of prepared) {
      if (sha256(fs.readFileSync(item.target.path, "utf8")) !== item.target.beforeHash) throw new Error(`Rollback hash verification failed: ${item.target.path}`);
    }
  } catch (error) {
    const restoreErrors = [];
    for (const item of committed.reverse()) {
      try {
        atomicReplace(item.target.path, item.current, item.target.mode ?? 0o644);
      } catch (restoreError) {
        restoreErrors.push(`${item.target.path}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
      }
    }
    if (restoreErrors.length > 0) {
      const primary = error instanceof Error ? error.message : String(error);
      throw new Error(`${primary}; rollback compensation failures: ${restoreErrors.join("; ")}`, { cause: error });
    }
    throw error;
  }
  return { writes: prepared.length };
}

function parseArgs(argv) {
  const options = { action: argv[0] || "", manifest: "", stateDir: "", planFile: "", receiptFile: "" };
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--manifest") options.manifest = argv[++index] ?? "";
    else if (arg === "--patch") index++;
    else if (arg === "--state-dir") options.stateDir = argv[++index] ?? "";
    else if (arg === "--plan-file") options.planFile = argv[++index] ?? "";
    else if (arg === "--receipt-file") options.receiptFile = argv[++index] ?? "";
    else if (arg === "--handler-arg") index++;
  }
  if (!options.action || !options.manifest) throw new Error("Missing lifecycle action or manifest");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readJson(options.manifest);
  let result;
  if (options.action === "status") {
    const discovered = discoverTargets(manifest);
    const blocked = discovered.discoveryErrors.length > 0 || discovered.targets.some((target) => target.status === "unsupported-layout");
    result = { ok: true, blocked, targets: discovered.targets, discoveryErrors: discovered.discoveryErrors };
  } else if (options.action === "plan") result = buildPlan(manifest);
  else if (options.action === "apply") {
    const receipt = applyPlan(manifest, readJson(options.planFile), options.stateDir);
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

export { AGENT_SESSION_FILE, MODEL_SELECTOR_FILE, buildPlan, verify, rollback };
