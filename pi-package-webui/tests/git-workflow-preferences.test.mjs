import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  GIT_WORKFLOW_SETUP_VERSION,
  gitWorkflowPreferencesSummary,
  isGitWorkflowSetupComplete,
  normalizeInterfacePreferences,
  readGitWorkflowPreferences,
  readWebuiSettings,
  supportedGitWorkflowThinkingLevels,
  writeGitWorkflowPreferences,
  writeWebuiSettings,
} from "../lib/git-workflow-preferences.mjs";

assert.deepEqual(supportedGitWorkflowThinkingLevels({ reasoning: false }), ["off"]);
assert.deepEqual(
  supportedGitWorkflowThinkingLevels({ reasoning: true }),
  ["off", "minimal", "low", "medium", "high"],
  "models without an explicit map should expose standard levels but not opt-in extended levels",
);
assert.deepEqual(
  supportedGitWorkflowThinkingLevels({ reasoning: true, thinkingLevelMap: { minimal: null, xhigh: null, max: "max" } }),
  ["off", "low", "medium", "high", "max"],
  "null map entries should be hidden while explicit extended levels remain available",
);
assert.deepEqual(normalizeInterfacePreferences({}), { sidePanelWidth: null });
assert.deepEqual(normalizeInterfacePreferences({ sidePanelWidth: 617.6 }), { sidePanelWidth: 618 });
assert.deepEqual(normalizeInterfacePreferences({ sidePanelWidth: 10 }), { sidePanelWidth: 320 });
assert.deepEqual(normalizeInterfacePreferences({ sidePanelWidth: 9000 }), { sidePanelWidth: 4096 });

const root = await mkdtemp(path.join(tmpdir(), "pi-webui-git-preferences-"));
const settingsFile = path.join(root, "settings.json");

try {
  await writeFile(settingsFile, `${JSON.stringify({ version: 1, remoteAuthEnabled: true }, null, 2)}\n`, "utf8");
  const migrated = await readWebuiSettings(settingsFile);
  assert.equal(migrated.version, 6);
  assert.equal(migrated.remoteAuthEnabled, true, "legacy Remote PIN state should survive schema migration");
  assert.equal(migrated.outputModeDefault, "normal", "legacy settings should default browser output to normal");
  assert.equal(isGitWorkflowSetupComplete(migrated.gitWorkflow), false);
  assert.equal(migrated.resourceDefaults.tools.enabledTools, null, "legacy settings should inherit Pi's normal tool defaults");
  assert.equal(migrated.resourceDefaults.skills.enabledSkills, null, "legacy settings should inherit Pi's normal skill defaults");
  assert.equal(migrated.gitWorkflow.stagingPolicy, "review");
  assert.equal(migrated.gitWorkflow.generation.thinkingLevel, "low");
  assert.equal(migrated.uiLayout.version, 1);
  assert.equal(migrated.uiLayout.sidePanel.sectionOrder, null);

  await writeFile(settingsFile, `${JSON.stringify({ version: 4, remoteAuthEnabled: true, outputModeDefault: "unsupported" }, null, 2)}\n`, "utf8");
  assert.equal((await readWebuiSettings(settingsFile)).outputModeDefault, "normal", "invalid persisted output modes must fail closed to normal");

  const saved = await writeGitWorkflowPreferences({
    generation: { provider: "fake", modelId: "fake-model", thinkingLevel: "off", unavailablePolicy: "ask" },
    commit: { language: "de", defaultVariant: "long", scope: "required" },
    stagingPolicy: "preserve",
    deliveryMode: "pr-worktree",
    verificationPolicy: "none",
  }, settingsFile);
  assert.equal(saved.setupVersion, GIT_WORKFLOW_SETUP_VERSION);
  assert.equal(isGitWorkflowSetupComplete(saved), true);
  assert.equal(saved.commit.language, "de");
  assert.equal(saved.commit.defaultVariant, "long");
  assert.equal(saved.stagingPolicy, "preserve");

  await writeWebuiSettings({
    outputModeDefault: "compact-v1",
    resourceDefaults: {
      tools: { enabledTools: ["read", " write ", "read", ""] },
      skills: { enabledSkills: ["repo-explorer", "code-security"] },
    },
    interfacePreferences: { sidePanelWidth: 612 },
  }, settingsFile);

  const partiallyUpdated = await writeGitWorkflowPreferences({ deliveryMode: "current" }, settingsFile);
  assert.equal(partiallyUpdated.generation.modelId, "fake-model", "partial updates should preserve the selected model");
  assert.equal(partiallyUpdated.commit.language, "de", "partial updates should preserve nested commit preferences");
  assert.equal(partiallyUpdated.deliveryMode, "current");

  const persisted = JSON.parse(await readFile(settingsFile, "utf8"));
  assert.equal(persisted.version, 6);
  assert.equal(persisted.remoteAuthEnabled, true);
  assert.equal(persisted.outputModeDefault, "compact-v1", "output-mode default should persist beside existing Web UI settings");
  assert.equal(persisted.gitWorkflow.generation.provider, "fake");
  assert.deepEqual(persisted.resourceDefaults.tools.enabledTools, ["read", "write"], "global tool defaults should be normalized and deduplicated");
  assert.deepEqual(persisted.resourceDefaults.skills.enabledSkills, ["repo-explorer", "code-security"], "global skill defaults should persist beside other Web UI settings");
  assert.equal(persisted.interfacePreferences.sidePanelWidth, 612, "the user-scoped Control Deck width should persist beside other Web UI settings");
  assert.equal((await readWebuiSettings(settingsFile)).interfacePreferences.sidePanelWidth, 612);
  assert.match(gitWorkflowPreferencesSummary(await readGitWorkflowPreferences(settingsFile)), /fake\/fake-model/);
  if (process.platform !== "win32") assert.equal((await stat(settingsFile)).mode & 0o777, 0o600);

  console.log("git-workflow-preferences.test.mjs passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
