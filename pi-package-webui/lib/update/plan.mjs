import { createHash, randomUUID } from "node:crypto";
import { classifyPackageOwner } from "./owners.mjs";

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function clean(value) {
  return String(value ?? "").trim();
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalValue(value[key])]));
}

export function canonicalPlanJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function digestUpdatePlan(plan) {
  const { digest: _digest, ...unsigned } = plan || {};
  return createHash("sha256").update(canonicalPlanJson(unsigned)).digest("hex");
}

function exactVersion(value, label) {
  const normalized = clean(value).replace(/^v/i, "");
  if (!EXACT_VERSION.test(normalized)) throw new TypeError(`${label} must resolve to an exact version`);
  return normalized;
}

function registryUrl(value, label) {
  const normalized = clean(value);
  let parsed;
  try { parsed = new URL(normalized); } catch { throw new TypeError(`${label} must be an absolute HTTP(S) registry URL`); }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw new TypeError(`${label} must be a credential-free HTTP(S) registry URL`);
  }
  return parsed.href;
}

function commandRecord(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) throw new TypeError("target command must be an object");
  const executable = clean(command.command);
  if (!executable || !Array.isArray(command.args)) throw new TypeError("target command requires command and an argument array");
  return Object.freeze({ command: executable, args: Object.freeze(command.args.map(String)) });
}

/** Resolve moving tags exactly once and bind all apply inputs into one digest. */
export async function createUpdatePlan({
  transactionId = randomUUID(),
  createdAt = new Date().toISOString(),
  registry = "",
  identities = [],
  candidates = [],
  resolveExactTarget,
} = {}) {
  if (typeof resolveExactTarget !== "function") throw new TypeError("resolveExactTarget is required");
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(clean(transactionId))) throw new TypeError("transactionId is invalid");
  const createdTimestamp = new Date(createdAt);
  if (!Number.isFinite(createdTimestamp.getTime())) throw new TypeError("createdAt is invalid");
  const identityRecords = identities.map((identity) => Object.freeze(canonicalValue(identity)));
  const identityIds = new Set(identityRecords.map((identity) => clean(identity.canonicalId)).filter(Boolean));
  if (identityIds.size !== identityRecords.length) throw new TypeError("every plan identity requires a unique canonicalId");
  const targets = [];
  const refusals = [];

  for (const candidate of candidates) {
    const id = clean(candidate?.id);
    if (!id) throw new TypeError("every candidate requires an id");
    const owner = classifyPackageOwner(candidate.owner);
    if (!owner.accepted) {
      refusals.push(Object.freeze({ id, packageName: clean(candidate.packageName), ...owner }));
      continue;
    }
    const resolved = await resolveExactTarget(Object.freeze({
      id,
      packageName: clean(candidate.packageName),
      requested: clean(candidate.requested || "latest"),
      registry: clean(candidate.registry || registry),
    }));
    const targetVersion = exactVersion(resolved?.version, `${id} target`);
    const currentVersion = exactVersion(candidate.currentVersion, `${id} current version`);
    const targetRegistry = registryUrl(resolved?.registry || candidate.registry || registry, `${id} registry`);
    const packageName = clean(candidate.packageName);
    const identityId = clean(candidate.identityId);
    if (!packageName) throw new TypeError(`${id} packageName is required`);
    if (!identityIds.has(identityId)) throw new TypeError(`${id} identityId must reference a canonical plan identity`);
    if (targetVersion === currentVersion) continue;
    targets.push(Object.freeze({
      id,
      kind: clean(candidate.kind || "package"),
      packageName,
      identityId,
      currentVersion,
      targetVersion,
      registry: targetRegistry,
      strategy: clean(candidate.strategy || owner.manager),
      owner,
      command: commandRecord(await candidate.commandForVersion(targetVersion, targetRegistry)),
      metadata: Object.freeze(canonicalValue(resolved?.metadata || {})),
    }));
  }

  const unsigned = Object.freeze({
    schemaVersion: 1,
    transactionId: clean(transactionId),
    createdAt: createdTimestamp.toISOString(),
    registry: registry ? registryUrl(registry, "plan registry") : "",
    identities: Object.freeze(identityRecords),
    targets: Object.freeze(targets),
    refusals: Object.freeze(refusals),
  });
  const digest = digestUpdatePlan(unsigned);
  return Object.freeze({ ...unsigned, digest });
}

export function assertActionableUpdatePlan(plan) {
  if (Array.isArray(plan?.targets) && plan.targets.length > 0) return true;
  const refusals = Array.isArray(plan?.refusals) ? plan.refusals.map((item) => clean(item?.id)).filter(Boolean) : [];
  const error = new Error(refusals.length
    ? `Update plan has no accepted targets; automatic update was refused for: ${refusals.join(", ")}.`
    : "Update plan has no accepted targets.");
  error.code = "UPDATE_PLAN_NO_TARGETS";
  error.statusCode = 409;
  throw error;
}

export function assertUpdatePlanDigest(plan, suppliedDigest) {
  const expected = digestUpdatePlan(plan);
  if (!/^[a-f0-9]{64}$/.test(clean(suppliedDigest)) || suppliedDigest !== plan?.digest || suppliedDigest !== expected) {
    const error = new Error("Update plan digest does not match the persisted exact-target plan.");
    error.code = "UPDATE_PLAN_DIGEST_MISMATCH";
    throw error;
  }
  return true;
}

export function assertPlanIdentity(planTarget, activeIdentity) {
  if (!planTarget?.identityId || planTarget.identityId !== activeIdentity?.canonicalId) {
    const error = new Error(`Active identity changed before applying ${planTarget?.id || "update target"}.`);
    error.code = "UPDATE_IDENTITY_CHANGED";
    throw error;
  }
  return true;
}
