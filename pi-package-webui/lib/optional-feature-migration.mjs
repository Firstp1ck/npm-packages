import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const OPTIONAL_FEATURE_MIGRATION_SCHEMA_VERSION = 1;
export const OPTIONAL_FEATURE_AUDIT_DEADLINE_MS = 10_000;
export const OPTIONAL_FEATURE_AUDIT_PHASES = Object.freeze([
  "checking", "ready", "action-required", "migrating", "partial", "complete", "degraded",
]);
export const OPTIONAL_FEATURE_AUDIT_STATES = Object.freeze([
  "registered", "local-resource", "legacy-migratable", "missing", "update-available", "conflict", "disabled", "unknown",
]);

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedFeatureInventory(value) {
  const features = {};
  for (const [featureId, raw] of Object.entries(plainObject(value))) {
    if (!featureId || featureId.length > 160) continue;
    const feature = plainObject(raw);
    features[featureId] = {
      available: feature.available === true,
      enabled: feature.enabled === true,
      sourceKind: String(feature.sourceKind || "unknown").slice(0, 80),
      installedVersion: String(feature.installedVersion || "").slice(0, 120),
    };
  }
  return features;
}

function normalizedRecord(value) {
  const record = plainObject(value);
  const last = plainObject(record.lastSuccessfulAudit);
  const pending = plainObject(record.pendingUpgrade);
  const dismissed = plainObject(record.dismissedMigration);
  return {
    schemaVersion: OPTIONAL_FEATURE_MIGRATION_SCHEMA_VERSION,
    ...(last.completedAt ? {
      lastSuccessfulAudit: {
        webuiVersion: String(last.webuiVersion || "").slice(0, 120),
        completedAt: String(last.completedAt || "").slice(0, 80),
        features: normalizedFeatureInventory(last.features),
      },
    } : {}),
    ...(pending.startedAt ? {
      pendingUpgrade: {
        fromVersion: String(pending.fromVersion || "").slice(0, 120),
        startedAt: String(pending.startedAt || "").slice(0, 80),
        featureIds: [...new Set((Array.isArray(pending.featureIds) ? pending.featureIds : []).filter((id) => typeof id === "string").slice(0, 256))],
      },
    } : {}),
    ...(dismissed.dismissedAt ? {
      dismissedMigration: {
        revision: String(dismissed.revision || "").slice(0, 160),
        dismissedAt: String(dismissed.dismissedAt || "").slice(0, 80),
        featureIds: [...new Set((Array.isArray(dismissed.featureIds) ? dismissed.featureIds : []).filter((id) => typeof id === "string").slice(0, 256))],
      },
    } : {}),
  };
}

export class OptionalFeatureMigrationStore {
  constructor({ filePath }) {
    if (!filePath) throw new Error("OptionalFeatureMigrationStore requires filePath");
    this.filePath = path.resolve(filePath);
    this.writeQueue = Promise.resolve();
  }

  async read() {
    try {
      return normalizedRecord(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") return { schemaVersion: OPTIONAL_FEATURE_MIGRATION_SCHEMA_VERSION };
      throw new Error(`Optional feature migration state is unreadable: ${error?.code || error?.name || "invalid-json"}`);
    }
  }

  #enqueueWrite(operation) {
    const task = this.writeQueue.then(operation, operation);
    this.writeQueue = task.catch(() => {});
    return task;
  }

  async #write(record) {
    const normalized = normalizedRecord(record);
    const parent = path.dirname(this.filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporary, this.filePath);
      await chmod(this.filePath, 0o600).catch(() => {});
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
    return normalized;
  }

  write(record) {
    return this.#enqueueWrite(() => this.#write(record));
  }

  update(mutator) {
    return this.#enqueueWrite(async () => this.#write(await mutator(await this.read())));
  }

  dismiss({ revision, featureIds, now = new Date() }) {
    return this.update((record) => ({
      ...record,
      dismissedMigration: {
        revision,
        dismissedAt: now.toISOString(),
        featureIds,
      },
    }));
  }

  markPendingUpgrade({ fromVersion, featureIds, now = new Date() }) {
    return this.update((record) => ({
      ...record,
      pendingUpgrade: {
        fromVersion,
        startedAt: now.toISOString(),
        featureIds,
      },
    }));
  }

  completeMigration() {
    return this.update((record) => {
      delete record.pendingUpgrade;
      delete record.dismissedMigration;
      return record;
    });
  }
}

function featureSourceKind(state) {
  if (state === "registered" || state === "update-available") return "pi-package";
  if (state === "local-resource") return "top-level-resource";
  if (state === "legacy-migratable") return "legacy-webui-bundled";
  return "none";
}

export function classifyOptionalFeature(status, previousFeature) {
  const previous = plainObject(previousFeature);
  const previouslyAvailable = previous.available === true;
  const previouslyEnabled = previous.enabled === true;
  let state;
  if (status?.resourceConflict) state = "conflict";
  else if (status?.disabled === true || (previouslyAvailable && previous.enabled === false && !status?.configured && !status?.locallyConfigured)) state = "disabled";
  else if (status?.updateAvailable && (status?.configured || status?.locallyConfigured)) state = "update-available";
  else if (status?.configured && status?.installed) state = "registered";
  else if (status?.locallyConfigured) state = "local-resource";
  else if (status?.legacyEvidence === true || previouslyAvailable) state = "legacy-migratable";
  else if (status?.auditUnknown === true || (status?.installed && !status?.configured && !status?.locallyConfigured)) state = "unknown";
  else state = "missing";
  return {
    ...status,
    state,
    sourceKind: featureSourceKind(state),
    previouslyAvailable,
    previouslyEnabled,
    selectedByDefault: state === "legacy-migratable" && previouslyEnabled,
  };
}

function installKindFor(record, statuses, webuiVersion) {
  if (record.pendingUpgrade?.startedAt) return "upgrade";
  if (record.lastSuccessfulAudit?.completedAt && record.lastSuccessfulAudit.webuiVersion !== webuiVersion) return "upgrade";
  if (statuses.some((status) => status.legacyEvidence === true)) return "upgrade";
  if (statuses.some((status) => status.auditUnknown === true)) return "unknown";
  return "fresh";
}

function snapshotSummary(features) {
  return {
    ready: features.filter(({ state }) => ["registered", "local-resource", "update-available"].includes(state)).length,
    migratable: features.filter(({ state }) => state === "legacy-migratable").length,
    missing: features.filter(({ state }) => state === "missing").length,
    conflicts: features.filter(({ state }) => state === "conflict").length,
    disabled: features.filter(({ state }) => state === "disabled").length,
    unknown: features.filter(({ state }) => state === "unknown").length,
  };
}

function stableRevision(payload) {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

function sanitizedDiagnostic(error) {
  const code = String(error?.code || error?.name || "audit-failed").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80);
  return { kind: code || "audit-failed", message: "Optional feature audit could not establish a safe resource configuration. Recheck from localhost." };
}

function withDeadline(promise, deadlineAt) {
  const remainingMs = Math.max(0, deadlineAt - Date.now());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error("Optional feature audit exceeded its startup deadline");
      error.code = "audit-timeout";
      reject(error);
    }, remainingMs);
    timer.unref?.();
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function browserFeature(feature) {
  const {
    installedRoot: _installedRoot,
    topLevelResources: _topLevelResources,
    configuredPackages: _configuredPackages,
    legacyPath: _legacyPath,
    ...safe
  } = feature;
  return safe;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function migrationDismissalApplies(features, record) {
  const actionableIds = features.filter(({ state }) => state === "legacy-migratable").map(({ featureId }) => featureId).sort();
  const dismissedIds = [...new Set(record.dismissedMigration?.featureIds || [])].sort();
  return actionableIds.length > 0
    && actionableIds.length === dismissedIds.length
    && actionableIds.every((featureId, index) => featureId === dismissedIds[index]);
}

function phaseFor(features, record) {
  const actionable = features.filter(({ state }) => state === "legacy-migratable");
  const dismissalApplies = migrationDismissalApplies(features, record);
  if (features.some(({ state }) => state === "conflict") || (actionable.length && !dismissalApplies)) return "action-required";
  return "ready";
}

function auditInventory(features, webuiVersion, completedAt) {
  const inventory = {};
  for (const feature of features) {
    inventory[feature.featureId] = {
      available: ["registered", "local-resource", "legacy-migratable", "update-available", "disabled"].includes(feature.state),
      enabled: !["missing", "disabled", "unknown"].includes(feature.state),
      sourceKind: feature.sourceKind,
      installedVersion: feature.installedVersion || "",
    };
  }
  return { webuiVersion, completedAt, features: inventory };
}

export class OptionalFeatureAuditCoordinator {
  constructor({ catalog, collectStatuses, store, webuiVersion, deadlineMs = OPTIONAL_FEATURE_AUDIT_DEADLINE_MS, onEvent = () => {}, now = () => new Date() }) {
    this.catalog = catalog;
    this.collectStatuses = collectStatuses;
    this.store = store;
    this.webuiVersion = webuiVersion;
    this.deadlineMs = deadlineMs;
    this.onEvent = onEvent;
    this.now = now;
    this.inFlight = null;
    this.mutation = null;
    this.snapshot = deepFreeze({
      phase: "checking",
      revision: "pending",
      installKind: "unknown",
      summary: { ready: 0, migratable: 0, missing: 0, conflicts: 0, disabled: 0, unknown: 0 },
      features: [],
      progress: null,
      completedAt: null,
      diagnostic: null,
    });
  }

  current() {
    return this.snapshot;
  }

  publish(next, event = "snapshot") {
    this.snapshot = deepFreeze(next);
    this.onEvent({ type: "webui_optional_feature_migration", event, snapshot: this.snapshot });
    return this.snapshot;
  }

  recheck({ reason = "manual" } = {}) {
    if (this.inFlight) return this.inFlight;
    this.publish({ ...this.snapshot, phase: "checking", progress: null, diagnostic: null }, "checking");
    const task = this.#runAudit(reason).finally(() => {
      if (this.inFlight === task) this.inFlight = null;
    });
    this.inFlight = task;
    return task;
  }

  async #runAudit(reason) {
    const deadlineAt = Date.now() + this.deadlineMs;
    try {
      const statuses = await withDeadline(Promise.resolve().then(() => this.collectStatuses()), deadlineAt);
      const record = await withDeadline(this.store.read(), deadlineAt);
      const previous = record.lastSuccessfulAudit?.features || {};
      const features = statuses.map((status) => classifyOptionalFeature(status, previous[status.featureId]));
      const installKind = installKindFor(record, statuses, this.webuiVersion);
      const revisionPayload = {
        schemaVersion: OPTIONAL_FEATURE_MIGRATION_SCHEMA_VERSION,
        installKind,
        features: features.map(({ featureId, state, installedVersion, previouslyAvailable, previouslyEnabled, selectedByDefault }) => ({
          featureId, state, installedVersion: installedVersion || "", previouslyAvailable, previouslyEnabled, selectedByDefault,
        })),
      };
      const revision = stableRevision(revisionPayload);
      const completedAt = this.now().toISOString();
      const dismissed = migrationDismissalApplies(features, record);
      const selectedFeatures = features.map((feature) => ({ ...feature, selectedByDefault: dismissed ? false : feature.selectedByDefault }));
      const nextRecord = await withDeadline(
        this.store.update((latest) => ({ ...latest, lastSuccessfulAudit: auditInventory(selectedFeatures, this.webuiVersion, completedAt) })),
        deadlineAt,
      );
      return this.publish({
        phase: phaseFor(selectedFeatures, nextRecord),
        revision,
        installKind,
        summary: snapshotSummary(selectedFeatures),
        features: selectedFeatures.map(browserFeature),
        progress: null,
        completedAt,
        diagnostic: null,
        reason,
      }, "audit-complete");
    } catch (error) {
      const revision = stableRevision({ degraded: true, kind: error?.code || error?.name || "audit-failed", nonce: randomUUID() });
      return this.publish({
        phase: "degraded",
        revision,
        installKind: "unknown",
        summary: { ready: 0, migratable: 0, missing: 0, conflicts: 0, disabled: 0, unknown: this.catalog.length },
        features: this.catalog.map(({ featureId, packageName, expectedSpec }) => ({
          featureId, packageName, expectedSpec, state: "unknown", sourceKind: "none", previouslyAvailable: false, previouslyEnabled: false, selectedByDefault: false,
        })),
        progress: null,
        completedAt: this.now().toISOString(),
        diagnostic: sanitizedDiagnostic(error),
        reason,
      }, "degraded");
    }
  }

  assertRevision(revision) {
    if (["checking", "degraded"].includes(this.snapshot.phase) || typeof revision !== "string" || revision !== this.snapshot.revision) {
      const error = new Error("Optional feature audit revision is stale or not actionable; refetch /api/optional-features and retry");
      error.statusCode = 409;
      throw error;
    }
  }

  assertIdle() {
    if (this.mutation) {
      const error = new Error("An optional feature mutation is already in progress");
      error.statusCode = 409;
      throw error;
    }
  }

  async dismiss(revision) {
    this.assertIdle();
    this.assertRevision(revision);
    const featureIds = this.snapshot.features.filter(({ state }) => state === "legacy-migratable").map(({ featureId }) => featureId);
    await this.store.dismiss({ revision, featureIds, now: this.now() });
    return this.publish({
      ...this.snapshot,
      phase: this.snapshot.summary.conflicts > 0 ? "action-required" : "ready",
      features: this.snapshot.features.map((feature) => ({ ...feature, selectedByDefault: false })),
    }, "dismissed");
  }

  async runMutation(revision, operation) {
    this.assertRevision(revision);
    this.assertIdle();
    const task = Promise.resolve().then(operation).finally(() => {
      if (this.mutation === task) this.mutation = null;
    });
    this.mutation = task;
    return task;
  }

  setProgress(progress) {
    const phase = progress?.phase || "migrating";
    return this.publish({ ...this.snapshot, phase, progress: progress ? { ...progress } : null }, "progress");
  }

  excludedPackageNames() {
    if (this.snapshot.phase === "checking" || this.snapshot.phase === "degraded") {
      return new Set(this.catalog.map(({ packageName }) => packageName));
    }
    return new Set(this.snapshot.features.filter(({ state }) => state === "conflict").map(({ packageName }) => packageName));
  }
}
