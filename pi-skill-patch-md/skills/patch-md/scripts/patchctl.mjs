#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parsePatchFile } from "./patch_md_extract.mjs";

const ACTIONS = new Set(["status", "plan", "apply", "verify", "rollback"]);

function parseArgs(argv) {
  const options = {
    action: "",
    patchPath: "",
    workspaceRoot: "",
    stateDir: process.env.PI_PATCH_STATE_DIR || path.join(process.env.PI_AGENT_DIR || path.join(os.homedir(), ".pi", "agent"), "patch-state"),
    planHash: "",
    confirm: false,
    handlerArgs: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("-") && !options.action) options.action = arg;
    else if (arg === "--patch") options.patchPath = argv[++i] ?? "";
    else if (arg === "--workspace") options.workspaceRoot = argv[++i] ?? "";
    else if (arg === "--state-dir") options.stateDir = argv[++i] ?? "";
    else if (arg === "--plan-hash") options.planHash = argv[++i] ?? "";
    else if (arg === "--confirm") options.confirm = true;
    else if (arg === "--handler-arg") options.handlerArgs.push(argv[++i] ?? "");
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!ACTIONS.has(options.action)) throw new Error(`Action must be one of: ${[...ACTIONS].join(", ")}`);
  if (!options.patchPath) throw new Error("Missing --patch <PATCH.md>");
  if (!options.stateDir) throw new Error("Patch state directory cannot be empty");
  return options;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function hashPlan(plan) {
  const copy = { ...plan };
  delete copy.planHash;
  delete copy.generatedAt;
  return createHash("sha256").update(JSON.stringify(canonicalize(copy))).digest("hex");
}

function resolveContained(baseDir, relativePath, label) {
  const resolved = path.resolve(baseDir, relativePath);
  const relative = path.relative(baseDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} escapes patch directory: ${relativePath}`);
  return resolved;
}

function assertNoLikelySecrets(value, location = "handler output", trail = []) {
  const sensitiveKey = /^(?:api[_-]?key|authorization|password|secret|access[_-]?token|refresh[_-]?token|credential)$/iu;
  const secretValue = /(?:-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----|\bBearer\s+\S{12,}|\bsk-[A-Za-z0-9_-]{20,}|\bghp_[A-Za-z0-9]{30,})/u;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoLikelySecrets(item, location, [...trail, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && secretValue.test(value)) throw new Error(`${location} contains likely secret material at ${trail.join(".") || "<root>"}`);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveKey.test(key) && item !== null && item !== undefined && item !== "") throw new Error(`${location} contains forbidden sensitive field at ${[...trail, key].join(".")}`);
    assertNoLikelySecrets(item, location, [...trail, key]);
  }
}

function atomicWriteJson(targetPath, data, mode = 0o600) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const temporary = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode, flag: "wx" });
  fs.renameSync(temporary, targetPath);
}

function withLock(lockPath, operation) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") throw new Error(`Patch lifecycle is already locked: ${lockPath}`);
    throw error;
  }
  try {
    fs.writeFileSync(handle, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8");
    return operation();
  } finally {
    fs.closeSync(handle);
    fs.rmSync(lockPath, { force: true });
  }
}

function runHandler(handlerPath, action, context, options = {}) {
  const args = [
    handlerPath,
    action,
    "--manifest", context.manifestPath,
    "--patch", context.patchPath,
    "--state-dir", context.stateDir,
  ];
  if (options.planFile) args.push("--plan-file", options.planFile);
  if (options.receiptFile) args.push("--receipt-file", options.receiptFile);
  for (const value of context.handlerArgs) args.push("--handler-arg", value);
  const child = spawnSync(process.execPath, args, {
    cwd: path.dirname(context.manifestPath),
    encoding: "utf8",
    input: options.input,
    timeout: 120_000,
    env: { ...process.env, PI_PATCHCTL_ACTION: action },
    maxBuffer: 8 * 1024 * 1024,
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    const detail = [child.stderr, child.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`Lifecycle handler ${action} failed with exit ${child.status}${detail ? `: ${detail}` : ""}`);
  }
  try {
    const payload = JSON.parse(child.stdout);
    if (!payload || typeof payload !== "object") throw new Error("handler output is not an object");
    if (typeof payload.ok !== "boolean") throw new Error("handler output must include boolean ok");
    assertNoLikelySecrets(payload);
    return payload;
  } catch (error) {
    throw new Error(`Lifecycle handler ${action} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function buildContext(parsed, options) {
  const patchPath = path.resolve(options.patchPath);
  const manifestPath = parsed.patch.lifecycle.resolvedManifestPath;
  const manifest = parsed.patch.lifecycle.manifest;
  const handlerPath = resolveContained(path.dirname(manifestPath), manifest.lifecycle.handler, "Lifecycle handler");
  const stateDir = path.resolve(options.stateDir);
  const safeId = manifest.id.replace(/[^a-zA-Z0-9._-]/gu, "-");
  return {
    patchPath,
    manifestPath,
    manifest,
    handlerPath,
    stateDir,
    receiptPath: path.join(stateDir, `${safeId}.json`),
    lockPath: path.join(stateDir, `${safeId}.lock`),
    handlerArgs: options.handlerArgs,
  };
}

function createPlan(context) {
  const raw = runHandler(context.handlerPath, "plan", context);
  const plan = {
    schemaVersion: "2.0",
    patchId: context.manifest.id,
    patchVersion: context.manifest.version,
    generatedAt: new Date().toISOString(),
    ...raw,
  };
  plan.planHash = hashPlan(plan);
  return plan;
}

function execute(options) {
  const parsed = parsePatchFile(options.patchPath, { strict: true, workspaceRoot: options.workspaceRoot });
  if (!parsed.ok) return { ok: false, action: options.action, errors: parsed.errors, warnings: parsed.warnings };
  const context = buildContext(parsed, options);

  if (options.action === "status") {
    return { action: "status", patchId: context.manifest.id, patchVersion: context.manifest.version, ...runHandler(context.handlerPath, "status", context) };
  }

  if (options.action === "plan") return { action: "plan", ...createPlan(context) };

  if (options.action === "verify") {
    return {
      action: "verify",
      patchId: context.manifest.id,
      patchVersion: context.manifest.version,
      ...runHandler(context.handlerPath, "verify", context, { receiptFile: fs.existsSync(context.receiptPath) ? context.receiptPath : "" }),
    };
  }

  if (options.action === "apply") {
    if (!options.planHash) throw new Error("apply requires --plan-hash from a fresh patchctl plan");
    const plan = createPlan(context);
    if (plan.planHash !== options.planHash) throw new Error(`Plan hash changed; expected ${options.planHash}, current ${plan.planHash}. Review a fresh plan.`);
    if (plan.ok === false || plan.blocked === true) throw new Error("Plan is blocked; no files were changed");
    if (plan.noop === true || plan.writes === 0) {
      return {
        action: "apply",
        ok: true,
        noop: true,
        patchId: context.manifest.id,
        planHash: plan.planHash,
        receiptPath: fs.existsSync(context.receiptPath) ? context.receiptPath : null,
      };
    }
    return withLock(context.lockPath, () => {
      const planFile = path.join(context.stateDir, `.${context.manifest.id}.${process.pid}.plan.json`);
      atomicWriteJson(planFile, plan);
      try {
        const applied = runHandler(context.handlerPath, "apply", context, { planFile });
        if (applied.ok !== true) throw new Error("Lifecycle handler did not report ok=true after apply");
        const receipt = {
          schemaVersion: "2.0",
          patchId: context.manifest.id,
          patchVersion: context.manifest.version,
          planHash: plan.planHash,
          appliedAt: new Date().toISOString(),
          ...applied.receipt,
        };
        atomicWriteJson(context.receiptPath, receipt);
        return { action: "apply", ok: true, patchId: context.manifest.id, planHash: plan.planHash, receiptPath: context.receiptPath, result: applied.result ?? null };
      } finally {
        fs.rmSync(planFile, { force: true });
      }
    });
  }

  if (options.action === "rollback") {
    if (!options.confirm) throw new Error("rollback requires --confirm");
    if (!fs.existsSync(context.receiptPath)) throw new Error(`No apply receipt found: ${context.receiptPath}`);
    return withLock(context.lockPath, () => {
      const rolledBack = runHandler(context.handlerPath, "rollback", context, { receiptFile: context.receiptPath });
      if (rolledBack.ok !== true) throw new Error("Lifecycle handler did not report ok=true after rollback");
      const historyPath = `${context.receiptPath}.rolled-back-${Date.now()}`;
      fs.renameSync(context.receiptPath, historyPath);
      return { action: "rollback", ok: true, patchId: context.manifest.id, archivedReceiptPath: historyPath, result: rolledBack.result ?? null };
    });
  }

  throw new Error(`Unsupported action: ${options.action}`);
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = execute(options);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok === false ? 1 : 0);
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exit(1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

export { canonicalize, execute, hashPlan };
