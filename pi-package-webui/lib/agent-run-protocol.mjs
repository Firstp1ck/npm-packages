import { createHash } from "node:crypto";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const TERMINAL_STATUSES = new Set(["done", "failed", "cancelled"]);
const CANONICAL_ID_KEEP_BYTES = 120;

export const AGENT_RUN_PROTOCOL_VERSION = 1;
export const AGENT_RUN_PROVIDER_EVENT = "firstpick:webui-agent-runs:v1";
export const AGENT_RUN_LIMITS = Object.freeze({
  id: 160,
  providerId: 80,
  label: 240,
  model: 240,
  thinking: 40,
  tool: 120,
  instancesPerSnapshot: 512,
});
export const AGENT_RUN_LAUNCHERS = Object.freeze([
  "sdk", "pi-rpc", "pi-json", "pi-print", "interactive", "tmux",
  "pi-subagents", "schedule", "gate", "workflow", "custom",
]);
export const AGENT_RUN_PROVIDERS = Object.freeze([
  "pi-subagents", "workflow-run", "webui-registry", "webui-helper",
]);
export const AGENT_RUN_STATUSES = Object.freeze([
  "queued", "running", "stale", "done", "failed", "cancelled", "lost",
]);
export const AGENT_RUN_OUTPUT_KINDS = Object.freeze([
  "helper", "session-jsonl", "rpc-events", "json-events", "plain-log", "registry-artifact", "none",
]);

const LAUNCHERS = new Set(AGENT_RUN_LAUNCHERS);
const STATUSES = new Set(AGENT_RUN_STATUSES);
const OUTPUT_KINDS = new Set(AGENT_RUN_OUTPUT_KINDS);

/** Stable projection shared by helper/server code; safe IDs up to the common keep threshold remain unchanged. */
export function canonicalAgentRunId(value, fallback = "agent") {
  const raw = String(value ?? "").trim();
  const safeFallback = ID_PATTERN.test(String(fallback)) ? String(fallback) : "agent";
  if (!raw) return safeFallback;
  if (Buffer.byteLength(raw, "utf8") <= CANONICAL_ID_KEEP_BYTES && ID_PATTERN.test(raw)) return raw;
  const digest = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  const sanitized = raw.replace(/[^A-Za-z0-9._:-]/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 100);
  return `${sanitized || safeFallback}-${digest}`;
}

function issue(field, message) {
  const error = new TypeError(`${field} ${message}`);
  error.code = "AGENT_RUN_INVALID";
  error.field = field;
  return error;
}

function plainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw issue(field, "must be an object");
  return value;
}

function boundedText(value, field, maximum, { required = false, id = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw issue(field, "is required");
    return undefined;
  }
  if (typeof value !== "string") throw issue(field, "must be a string");
  const text = value.trim();
  if (!text && required) throw issue(field, "is required");
  if (!text) return undefined;
  if (Buffer.byteLength(text, "utf8") > maximum) throw issue(field, `exceeds ${maximum} bytes`);
  if (/[\u0000-\u001f\u007f]/u.test(text)) throw issue(field, "contains control characters");
  if (id && !ID_PATTERN.test(text)) throw issue(field, "must be an opaque safe identifier");
  return text;
}

function timestamp(value, field, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw issue(field, "is required");
    return null;
  }
  if (!Number.isSafeInteger(value) || value < 0) throw issue(field, "must be a non-negative integer timestamp");
  return value;
}

function normalizeCapabilities(value) {
  const input = value === undefined ? {} : plainObject(value, "capabilities");
  const output = {};
  for (const key of ["open", "refresh", "cancel", "steer"]) {
    if (input[key] !== undefined && typeof input[key] !== "boolean") throw issue(`capabilities.${key}`, "must be boolean");
    output[key] = input[key] === true;
  }
  return Object.freeze(output);
}

function normalizeOutputRef(value) {
  if (value === undefined || value === null) return Object.freeze({ kind: "none" });
  const input = plainObject(value, "outputRef");
  if (!OUTPUT_KINDS.has(input.kind)) throw issue("outputRef.kind", "is unsupported");
  if (input.kind === "none") return Object.freeze({ kind: "none" });
  const id = boundedText(input.id, "outputRef.id", AGENT_RUN_LIMITS.id, { required: true, id: true });
  return Object.freeze({ kind: input.kind, id });
}

/** Validate and copy one canonical agent instance. Unknown fields are not retained. */
export function normalizeAgentInstance(value) {
  const input = plainObject(value, "instance");
  if (input.version !== AGENT_RUN_PROTOCOL_VERSION) throw issue("version", `must equal ${AGENT_RUN_PROTOCOL_VERSION}`);
  const launcher = boundedText(input.launcher, "launcher", 32, { required: true });
  if (!LAUNCHERS.has(launcher)) throw issue("launcher", "is unsupported");
  const status = boundedText(input.status, "status", 32, { required: true });
  if (!STATUSES.has(status)) throw issue("status", "is unsupported");
  const startedAt = timestamp(input.startedAt, "startedAt", { required: true });
  const updatedAt = timestamp(input.updatedAt, "updatedAt", { required: true });
  const endedAt = timestamp(input.endedAt, "endedAt");
  if (updatedAt < startedAt) throw issue("updatedAt", "must not precede startedAt");
  if (endedAt !== null && endedAt < startedAt) throw issue("endedAt", "must not precede startedAt");
  if (TERMINAL_STATUSES.has(status) && endedAt === null) throw issue("endedAt", "is required for a terminal status");
  if (!TERMINAL_STATUSES.has(status) && endedAt !== null) throw issue("endedAt", "is only valid for a terminal status");

  return Object.freeze({
    version: AGENT_RUN_PROTOCOL_VERSION,
    instanceId: boundedText(input.instanceId, "instanceId", AGENT_RUN_LIMITS.id, { required: true, id: true }),
    runId: boundedText(input.runId, "runId", AGENT_RUN_LIMITS.id, { required: true, id: true }),
    parentInstanceId: boundedText(input.parentInstanceId, "parentInstanceId", AGENT_RUN_LIMITS.id, { id: true }) ?? null,
    parentSessionId: boundedText(input.parentSessionId, "parentSessionId", AGENT_RUN_LIMITS.id, { id: true }) ?? null,
    launcher,
    provider: boundedText(input.provider, "provider", AGENT_RUN_LIMITS.providerId, { required: true, id: true }),
    origin: boundedText(input.origin, "origin", AGENT_RUN_LIMITS.label),
    name: boundedText(input.name, "name", AGENT_RUN_LIMITS.label),
    status,
    startedAt,
    updatedAt,
    endedAt,
    model: boundedText(input.model, "model", AGENT_RUN_LIMITS.model),
    thinking: boundedText(input.thinking, "thinking", AGENT_RUN_LIMITS.thinking),
    activityState: boundedText(input.activityState, "activityState", 40, { id: true }),
    currentTool: boundedText(input.currentTool, "currentTool", AGENT_RUN_LIMITS.tool),
    capabilities: normalizeCapabilities(input.capabilities),
    outputRef: normalizeOutputRef(input.outputRef),
  });
}

export function normalizeProviderSnapshot(value) {
  const input = plainObject(value, "snapshot");
  if (input.version !== AGENT_RUN_PROTOCOL_VERSION) throw issue("snapshot.version", `must equal ${AGENT_RUN_PROTOCOL_VERSION}`);
  const producerId = boundedText(input.producerId, "producerId", AGENT_RUN_LIMITS.providerId, { required: true, id: true });
  if (typeof input.complete !== "boolean") throw issue("snapshot.complete", "must be boolean");
  if (!Array.isArray(input.instances)) throw issue("snapshot.instances", "must be an array");
  if (input.instances.length > AGENT_RUN_LIMITS.instancesPerSnapshot) throw issue("snapshot.instances", `exceeds ${AGENT_RUN_LIMITS.instancesPerSnapshot} entries`);
  const seen = new Set();
  const instances = input.instances.map((item) => {
    const instance = normalizeAgentInstance(item);
    const key = agentInstanceKey(instance);
    if (seen.has(key)) throw issue("snapshot.instances", `contains duplicate ${instance.instanceId}`);
    seen.add(key);
    return instance;
  });
  const removals = input.removals === undefined ? [] : input.removals;
  if (!Array.isArray(removals) || removals.length > AGENT_RUN_LIMITS.instancesPerSnapshot) throw issue("snapshot.removals", "must be a bounded array");
  return Object.freeze({
    version: AGENT_RUN_PROTOCOL_VERSION,
    producerId,
    complete: input.complete,
    instances: Object.freeze(instances),
    removals: Object.freeze(removals.map((id) => boundedText(id, "snapshot.removals[]", AGENT_RUN_LIMITS.id, { required: true, id: true }))),
  });
}

export function agentInstanceKey(instance) {
  return `${instance.parentSessionId || "external"}\0${instance.instanceId}`;
}

const OUTPUT_PRIORITY = Object.freeze({ none: 0, "plain-log": 1, "registry-artifact": 2, "rpc-events": 3, "json-events": 3, helper: 4, "session-jsonl": 5 });

/** Merge duplicate evidence without allowing weak, newer observations to erase stronger fields. */
export function mergeAgentInstances(previousValue, nextValue, { lifecycleOwner = false, capabilityOwner = false } = {}) {
  const previous = normalizeAgentInstance(previousValue);
  const next = normalizeAgentInstance(nextValue);
  if (agentInstanceKey(previous) !== agentInstanceKey(next)) throw issue("instanceId", "does not identify the same parent-scoped instance");
  const nextIsNewer = next.updatedAt >= previous.updatedAt;
  const previousTerminal = TERMINAL_STATUSES.has(previous.status);
  const nextTerminal = TERMINAL_STATUSES.has(next.status);
  let status = previous.status;
  let endedAt = previous.endedAt;
  if ((!previousTerminal && nextTerminal) || (lifecycleOwner && nextIsNewer) || (!previousTerminal && nextIsNewer)) {
    status = next.status;
    endedAt = next.endedAt;
  }
  const outputRef = (OUTPUT_PRIORITY[next.outputRef.kind] > OUTPUT_PRIORITY[previous.outputRef.kind]
    || (OUTPUT_PRIORITY[next.outputRef.kind] === OUTPUT_PRIORITY[previous.outputRef.kind] && nextIsNewer)) ? next.outputRef : previous.outputRef;
  const choose = (field) => nextIsNewer && next[field] !== undefined ? next[field] : previous[field] ?? next[field];
  return normalizeAgentInstance({
    ...previous,
    launcher: previous.launcher === "custom" && next.launcher !== "custom" ? next.launcher : previous.launcher,
    provider: previous.provider,
    origin: choose("origin"), name: choose("name"), model: choose("model"), thinking: choose("thinking"),
    activityState: choose("activityState"), currentTool: choose("currentTool"),
    status, endedAt, startedAt: Math.min(previous.startedAt, next.startedAt), updatedAt: Math.max(previous.updatedAt, next.updatedAt),
    capabilities: capabilityOwner ? next.capabilities : previous.capabilities,
    outputRef,
  });
}

/**
 * Producer-aware in-memory index. Identity upgrades are explicit: a stronger ID
 * may replace a provisional ID, but names, models, PIDs, and timestamps never merge rows.
 */
export class AgentRunIndex {
  #rows = new Map();
  #producerKeys = new Map();
  #aliases = new Map();

  upsert(value, { producerId, previousInstanceId, lifecycleOwner = false, capabilityOwner = false } = {}) {
    const producer = boundedText(producerId || value?.provider, "producerId", AGENT_RUN_LIMITS.providerId, { required: true, id: true });
    const instance = normalizeAgentInstance(value);
    let key = agentInstanceKey(instance);
    if (previousInstanceId) {
      const previousId = boundedText(previousInstanceId, "previousInstanceId", AGENT_RUN_LIMITS.id, { required: true, id: true });
      const oldKey = `${instance.parentSessionId || "external"}\0${previousId}`;
      const resolvedOldKey = this.#aliases.get(oldKey) || oldKey;
      if (resolvedOldKey !== key && this.#rows.has(resolvedOldKey)) {
        const old = this.#rows.get(resolvedOldKey);
        this.#rows.delete(resolvedOldKey);
        this.#aliases.set(oldKey, key);
        for (const keys of this.#producerKeys.values()) if (keys.delete(resolvedOldKey)) keys.add(key);
        this.#rows.set(key, normalizeAgentInstance({ ...old, ...instance, instanceId: instance.instanceId }));
      }
    }
    const existing = this.#rows.get(key);
    this.#rows.set(key, existing ? mergeAgentInstances(existing, instance, { lifecycleOwner, capabilityOwner }) : instance);
    if (!this.#producerKeys.has(producer)) this.#producerKeys.set(producer, new Set());
    this.#producerKeys.get(producer).add(key);
    return this.#rows.get(key);
  }

  ingestSnapshot(value, options = {}) {
    const snapshot = normalizeProviderSnapshot(value);
    const previous = new Set(this.#producerKeys.get(snapshot.producerId) || []);
    const current = new Set();
    for (const instance of snapshot.instances) {
      const merged = this.upsert(instance, { producerId: snapshot.producerId, ...options });
      current.add(agentInstanceKey(merged));
    }
    for (const id of snapshot.removals) {
      const prefix = `\0${id}`;
      for (const key of previous) if (key.endsWith(prefix)) this.#removeProducerKey(snapshot.producerId, key);
    }
    if (snapshot.complete) for (const key of previous) if (!current.has(key)) this.#removeProducerKey(snapshot.producerId, key);
    return this.values();
  }

  #removeProducerKey(producerId, key) {
    this.#producerKeys.get(producerId)?.delete(key);
    const stillOwned = [...this.#producerKeys.values()].some((keys) => keys.has(key));
    if (!stillOwned) this.#rows.delete(key);
  }

  values() { return [...this.#rows.values()].sort((a, b) => a.startedAt - b.startedAt || a.instanceId.localeCompare(b.instanceId)); }
  get size() { return this.#rows.size; }
}

export function isTerminalAgentStatus(status) {
  return TERMINAL_STATUSES.has(status);
}
