import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  OptionalFeatureAuditCoordinator,
  OptionalFeatureMigrationStore,
  classifyOptionalFeature,
} from "../lib/optional-feature-migration.mjs";

const root = await mkdtemp(path.join(tmpdir(), "pi-webui-optional-feature-migration-"));
const stateFile = path.join(root, "private", "optional-feature-migration.json");
const catalog = [
  { featureId: "registered", packageName: "@test/registered", expectedSpec: "^1.0.0" },
  { featureId: "local", packageName: "@test/local", expectedSpec: "^1.0.0" },
  { featureId: "legacy", packageName: "@test/legacy", expectedSpec: "^1.0.0" },
  { featureId: "conflict", packageName: "@test/conflict", expectedSpec: "^1.0.0" },
  { featureId: "missing", packageName: "@test/missing", expectedSpec: "^1.0.0" },
];

try {
  assert.equal(classifyOptionalFeature({ configured: true, installed: true }, {}).state, "registered");
  assert.equal(classifyOptionalFeature({ locallyConfigured: true }, {}).state, "local-resource");
  assert.equal(classifyOptionalFeature({ legacyEvidence: true }, {}).state, "legacy-migratable");
  assert.equal(classifyOptionalFeature({ installed: true }, {}).state, "unknown");
  assert.equal(classifyOptionalFeature({}, {}).state, "missing");
  assert.equal(classifyOptionalFeature({ resourceConflict: true }, {}).state, "conflict");
  assert.equal(classifyOptionalFeature({ configured: true, installed: true, updateAvailable: true }, {}).state, "update-available");
  assert.equal(classifyOptionalFeature({}, { available: true, enabled: false }).state, "disabled");

  const store = new OptionalFeatureMigrationStore({ filePath: stateFile });
  await store.write({
    schemaVersion: 1,
    lastSuccessfulAudit: {
      webuiVersion: "0.8.2",
      completedAt: "2026-01-01T00:00:00.000Z",
      features: { legacy: { available: true, enabled: true, sourceKind: "legacy-webui-bundled", installedVersion: "1.0.0" } },
    },
    pendingUpgrade: { fromVersion: "0.8.2", startedAt: "2026-01-02T00:00:00.000Z", featureIds: ["legacy"] },
    secret: "must-not-survive",
  });
  const persisted = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(persisted.schemaVersion, 1);
  assert.equal(Object.hasOwn(persisted, "secret"), false);
  if (process.platform !== "win32") assert.equal((await stat(stateFile)).mode & 0o777, 0o600);

  const events = [];
  const coordinator = new OptionalFeatureAuditCoordinator({
    catalog,
    store,
    webuiVersion: "0.8.3",
    deadlineMs: 250,
    onEvent: (event) => events.push(event),
    collectStatuses: async () => [
      { ...catalog[0], configured: true, installed: true, installedVersion: "1.0.0", installedRoot: "/private/registered", topLevelResources: [] },
      { ...catalog[1], locallyConfigured: true, installed: true, installedVersion: "1.0.0", topLevelResources: ["/private/local/index.ts"] },
      { ...catalog[2], legacyEvidence: true, installed: true, installedVersion: "1.0.0", legacyPath: "/private/legacy" },
      { ...catalog[3], configured: true, locallyConfigured: true, resourceConflict: true, installed: true },
      { ...catalog[4], installed: false },
    ],
  });
  await assert.rejects(
    coordinator.runMutation("pending", async () => {}),
    (error) => error.statusCode === 409 && /not actionable/.test(error.message),
    "checking snapshots must never authorize mutations",
  );

  const snapshot = await coordinator.recheck({ reason: "test" });
  assert.equal(snapshot.phase, "action-required");
  assert.equal(snapshot.installKind, "upgrade");
  assert.match(snapshot.revision, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(snapshot.summary, { ready: 2, migratable: 1, missing: 1, conflicts: 1, disabled: 0, unknown: 0 });
  assert.deepEqual(snapshot.features.map(({ state }) => state), ["registered", "local-resource", "legacy-migratable", "conflict", "missing"]);
  assert.equal(snapshot.features[2].selectedByDefault, true);
  assert.equal(JSON.stringify(snapshot).includes("/private/"), false, "browser snapshot must not expose host paths");
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.features), true);
  assert.throws(() => coordinator.assertRevision("sha256:stale"), (error) => error.statusCode === 409);
  assert.ok(events.some(({ event }) => event === "audit-complete"));

  await coordinator.dismiss(snapshot.revision);
  assert.equal(coordinator.current().phase, "action-required", "conflicts remain actionable after migration dismissal");
  assert.equal(coordinator.current().features.find(({ featureId }) => featureId === "legacy").selectedByDefault, false);
  const dismissed = await store.read();
  assert.deepEqual(dismissed.dismissedMigration.featureIds, ["legacy"]);
  const afterDismissRecheck = await coordinator.recheck({ reason: "dismiss-persistence" });
  assert.equal(afterDismissRecheck.phase, "action-required", "conflict remains actionable across rechecks");
  assert.equal(afterDismissRecheck.features.find(({ featureId }) => featureId === "legacy").selectedByDefault, false, "dismissed migration stays unselected across rechecks");

  let releaseMutation;
  const blockedMutation = coordinator.runMutation(coordinator.current().revision, () => new Promise((resolve) => { releaseMutation = resolve; }));
  await assert.rejects(
    coordinator.runMutation(coordinator.current().revision, async () => {}),
    (error) => error.statusCode === 409,
  );
  assert.throws(() => coordinator.assertIdle(), (error) => error.statusCode === 409, "recheck routes must reject while mutation is active");
  await assert.rejects(
    coordinator.dismiss(coordinator.current().revision),
    (error) => error.statusCode === 409,
    "dismiss must reject while mutation is active",
  );
  releaseMutation("done");
  assert.equal(await blockedMutation, "done");

  const timeoutStore = new OptionalFeatureMigrationStore({ filePath: path.join(root, "timeout", "state.json") });
  const timeoutCoordinator = new OptionalFeatureAuditCoordinator({
    catalog: [catalog[0]],
    store: timeoutStore,
    webuiVersion: "0.8.3",
    deadlineMs: 20,
    collectStatuses: async () => {
      await delay(100);
      return [{ ...catalog[0], configured: true, installed: true }];
    },
  });
  const timeoutSnapshot = await timeoutCoordinator.recheck();
  assert.equal(timeoutSnapshot.phase, "degraded");
  assert.equal(timeoutSnapshot.features[0].state, "unknown");
  assert.equal(timeoutSnapshot.diagnostic.kind, "audit-timeout");
  assert.deepEqual([...timeoutCoordinator.excludedPackageNames()], ["@test/registered"]);
  await assert.rejects(
    timeoutCoordinator.runMutation(timeoutSnapshot.revision, async () => {}),
    (error) => error.statusCode === 409 && /not actionable/.test(error.message),
    "degraded snapshots must never authorize mutations",
  );

  const malformedFile = path.join(root, "malformed", "state.json");
  await mkdir(path.dirname(malformedFile), { recursive: true });
  await import("node:fs/promises").then(({ writeFile }) => writeFile(malformedFile, "{not-json", "utf8"));
  const malformedCoordinator = new OptionalFeatureAuditCoordinator({
    catalog: [catalog[0]],
    store: new OptionalFeatureMigrationStore({ filePath: malformedFile }),
    webuiVersion: "0.8.3",
    collectStatuses: async () => [{ ...catalog[0], configured: true, installed: true }],
  });
  assert.equal((await malformedCoordinator.recheck()).phase, "degraded");

  console.log("optional feature migration tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
