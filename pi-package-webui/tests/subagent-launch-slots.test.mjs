import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SUBAGENT_LAUNCH_SLOT_ROLE_CATALOG,
  defaultSubagentLaunchSlotRoles,
  formatSubagentLaunchSlotGuidance,
  normalizeSubagentLaunchSlots,
  resolveSubagentLaunchSlotProjectKey,
  subagentLaunchSlotBaseId,
  subagentLaunchSlotRevision,
  subagentLaunchSlotScopeEntry,
  validateSubagentLaunchSlotRoles,
} from "../lib/subagent-launch-slots.mjs";
import { readWebuiSettings, updateWebuiSettings, writeWebuiSettings } from "../lib/git-workflow-preferences.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const defaultRoles = defaultSubagentLaunchSlotRoles();
assert.deepEqual(Object.keys(defaultRoles), SUBAGENT_LAUNCH_SLOT_ROLE_CATALOG.map((role) => role.id));
for (const role of SUBAGENT_LAUNCH_SLOT_ROLE_CATALOG) {
  assert.deepEqual(defaultRoles[role.id], [{ id: subagentLaunchSlotBaseId(role.id), model: null, thinking: null }]);
}

const normalized = normalizeSubagentLaunchSlots({
  user: {
    roles: {
      reviewer: [
        { id: "reviewer-extra", model: "fake/reasoning", thinking: "high" },
        { id: "reviewer:base", model: "fake/legacy:high", thinking: "high" },
        { id: "reviewer-extra", model: "fake/reasoning", thinking: "high" },
        { id: "unsafe id", model: "fake/reasoning", thinking: "high" },
      ],
    },
  },
  projects: {
    relative: { roles: { reviewer: [{ id: "reviewer:base", model: "fake/reasoning", thinking: "high" }] } },
  },
});
assert.equal(normalized.user.roles.reviewer[0].id, "reviewer:base", "normalization must materialize and order the stable base slot first");
assert.equal(normalized.user.roles.reviewer[0].model, null, "thinking-suffixed persisted model IDs must reset to inheritance");
assert.deepEqual(normalized.user.roles.reviewer.slice(1), [{ id: "reviewer-extra", model: "fake/reasoning", thinking: "high" }]);
assert.deepEqual(normalized.projects, {}, "unsafe project keys must be dropped without changing user defaults");
const overloadedRoles = defaultSubagentLaunchSlotRoles();
for (const role of SUBAGENT_LAUNCH_SLOT_ROLE_CATALOG) {
  overloadedRoles[role.id].push(...Array.from({ length: 7 }, (_unused, index) => ({
    id: `${role.id}-extra-${index}`,
    model: null,
    thinking: null,
  })));
}
const boundedRoles = normalizeSubagentLaunchSlots({ user: { roles: overloadedRoles } }).user.roles;
assert.equal(Object.values(boundedRoles).flat().length, 32, "normalization must cap slots globally while retaining all role bases");
for (const role of SUBAGENT_LAUNCH_SLOT_ROLE_CATALOG) {
  assert.equal(boundedRoles[role.id][0].id, subagentLaunchSlotBaseId(role.id), "global bounds must never displace a role base slot");
}

const availableModels = [
  { provider: "fake", id: "reasoning", reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } },
  { provider: "fake", id: "basic", reasoning: false },
];
const validRoles = clone(defaultRoles);
validRoles.reviewer[0] = { id: "reviewer:base", model: "fake/reasoning", thinking: "high" };
validRoles.reviewer.push({ id: "reviewer-extra", model: "fake/basic", thinking: "off" });
assert.deepEqual(validateSubagentLaunchSlotRoles(validRoles, availableModels).reviewer, validRoles.reviewer);
assert.throws(() => validateSubagentLaunchSlotRoles({ ...validRoles, unknown: [] }, availableModels), /Unknown subagent role/);
assert.throws(() => validateSubagentLaunchSlotRoles({ ...validRoles, reviewer: [{ id: "reviewer-extra", model: null, thinking: null }] }, availableModels), /base slot/);
assert.throws(() => validateSubagentLaunchSlotRoles({ ...validRoles, reviewer: [{ id: "reviewer:base", model: null, thinking: "high" }] }, availableModels), /cannot set thinking/);
assert.throws(() => validateSubagentLaunchSlotRoles({ ...validRoles, reviewer: [{ id: "reviewer:base", model: "fake/reasoning:high", thinking: "high" }] }, availableModels), /invalid model/);
assert.throws(() => validateSubagentLaunchSlotRoles({ ...validRoles, reviewer: [{ id: "reviewer:base", model: "fake/basic", thinking: "high" }] }, availableModels), /does not support/);

const projectRoot = await mkdtemp(path.join(tmpdir(), "pi-webui-launch-slots-project-"));
const nested = path.join(projectRoot, "nested", "child");
const settingsRoot = await mkdtemp(path.join(tmpdir(), "pi-webui-launch-slots-settings-"));
const settingsFile = path.join(settingsRoot, "settings.json");
try {
  await mkdir(path.join(projectRoot, ".git"));
  await mkdir(nested, { recursive: true });
  const projectKey = await resolveSubagentLaunchSlotProjectKey(nested);
  assert.equal(projectKey, projectRoot, "nested tab cwd must resolve to the nearest canonical repository root");
  const markerlessProjectKey = await resolveSubagentLaunchSlotProjectKey(settingsRoot);
  assert.equal(markerlessProjectKey, settingsRoot, "a markerless tab cwd must not collapse to the filesystem root");

  const config = normalizeSubagentLaunchSlots({ user: { roles: validRoles } });
  const inherited = subagentLaunchSlotScopeEntry(config, "project", projectKey);
  assert.equal(inherited.inherited, true);
  assert.deepEqual(inherited.entry.roles.reviewer, validRoles.reviewer);
  const inheritedRevision = subagentLaunchSlotRevision(config, "project", projectKey);
  config.projects[projectKey] = { roles: clone(defaultRoles) };
  const explicit = subagentLaunchSlotScopeEntry(config, "project", projectKey);
  assert.equal(explicit.inherited, false);
  assert.notEqual(subagentLaunchSlotRevision(config, "project", projectKey), inheritedRevision, "project revisions must distinguish inheritance from an explicit project entry");

  const guidance = formatSubagentLaunchSlotGuidance(inherited.entry.roles);
  assert.match(guidance, /^## WebUI subagent launch slots/m);
  assert.match(guidance, /reviewer slot 1: agent=reviewer model=fake\/reasoning:high/);
  assert.match(guidance, /reviewer slot 2: agent=reviewer model=fake\/basic:off/);
  const mixedGuidanceRoles = clone(defaultRoles);
  mixedGuidanceRoles.reviewer.push({ id: "reviewer-explicit", model: "fake/reasoning", thinking: "high" });
  const mixedGuidance = formatSubagentLaunchSlotGuidance(mixedGuidanceRoles);
  assert.match(mixedGuidance, /reviewer slot 1: agent=reviewer model=<inherit; omit the model field>/, "mixed same-role guidance must retain inherited slots");
  assert.match(mixedGuidance, /reviewer slot 2: agent=reviewer model=fake\/reasoning:high/);
  assert.equal(formatSubagentLaunchSlotGuidance(defaultRoles), "", "guidance should be omitted when every slot inherits");

  await writeFile(settingsFile, `${JSON.stringify({ version: 4, unrelated: { preserve: true }, remoteAuthEnabled: true }, null, 2)}\n`, "utf8");
  await writeWebuiSettings({ subagentLaunchSlots: config }, settingsFile);
  const persisted = JSON.parse(await readFile(settingsFile, "utf8"));
  assert.equal(persisted.version, 6, "persisted launch-slot settings must retain the current version-6 envelope");
  assert.deepEqual(persisted.unrelated, { preserve: true }, "launch-slot saves must preserve unrelated WebUI settings");
  assert.deepEqual((await readWebuiSettings(settingsFile)).subagentLaunchSlots.projects[projectKey].roles, defaultRoles);

  let releaseFirstUpdate;
  let markFirstUpdateStarted;
  const firstUpdateStarted = new Promise((resolve) => { markFirstUpdateStarted = resolve; });
  const holdFirstUpdate = new Promise((resolve) => { releaseFirstUpdate = resolve; });
  const firstUpdate = updateWebuiSettings(async () => {
    markFirstUpdateStarted();
    await holdFirstUpdate;
    return { remoteAuthEnabled: false };
  }, settingsFile);
  await firstUpdateStarted;
  let secondUpdateEntered = false;
  const secondUpdate = updateWebuiSettings((current) => {
    secondUpdateEntered = true;
    assert.equal(current.remoteAuthEnabled, false, "serialized settings updates must observe the preceding completed write");
    return { outputModeDefault: "compact-v1" };
  }, settingsFile);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondUpdateEntered, false, "same-file settings updates must not interleave between revision read and atomic write");
  releaseFirstUpdate();
  await Promise.all([firstUpdate, secondUpdate]);
  const serialized = await readWebuiSettings(settingsFile);
  assert.equal(serialized.remoteAuthEnabled, false);
  assert.equal(serialized.outputModeDefault, "compact-v1");

  console.log("subagent-launch-slots.test.mjs passed");
} finally {
  await rm(projectRoot, { recursive: true, force: true });
  await rm(settingsRoot, { recursive: true, force: true });
}
