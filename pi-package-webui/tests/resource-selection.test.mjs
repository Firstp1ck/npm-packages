import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  branchResourceDirective,
  normalizeResourceDefaults,
  preserveUnavailableResourceNames,
  resolveResourceSelection,
  setExactModelProfile,
} from "../lib/resource-selection.mjs";
import { normalizeWebuiSettings, readWebuiSettings, writeWebuiSettings } from "../lib/git-workflow-preferences.mjs";

const normalized = normalizeWebuiSettings({
  version: 8,
  retained: { ok: true },
  resourceDefaults: {
    tools: { enabledTools: ["read", "read", ""] },
    skills: { enabledSkills: null },
    modelProfiles: [
      { provider: "p", modelId: "m/one", tools: { enabledTools: ["bash"] }, skills: { enabledSkills: null } },
      { provider: "p", modelId: "m/one", tools: { enabledTools: [] }, skills: { enabledSkills: ["skill-a"] } },
      { provider: "", modelId: "bad", tools: { enabledTools: ["write"] } },
      { provider: "p", modelId: "empty", tools: { enabledTools: null }, skills: { enabledSkills: null } },
    ],
  },
});
assert.equal(normalized.version, 8);
assert.deepEqual(normalized.retained, { ok: true });
assert.deepEqual(normalized.resourceDefaults.tools.enabledTools, ["read"]);
assert.equal(normalized.resourceDefaults.modelProfiles.length, 1);
assert.deepEqual(resolveResourceSelection(normalized.resourceDefaults, "tools", "p", "m/one", ["runtime"]), { names: [], source: "model" });
assert.deepEqual(resolveResourceSelection(normalized.resourceDefaults, "skills", "p", "m/one", null), { names: ["skill-a"], source: "model" });
assert.deepEqual(resolveResourceSelection(normalized.resourceDefaults, "skills", "p", "other", null), { names: null, source: "runtime" });

const legacyWithProfiles = normalizeWebuiSettings({
  version: 7,
  resourceDefaults: {
    tools: { enabledTools: ["global"] },
    modelProfiles: [{ provider: "p", modelId: "legacy", tools: { enabledTools: ["bash"] } }],
  },
});
assert.deepEqual(legacyWithProfiles.resourceDefaults.modelProfiles, [], "version-7 settings must ignore model profiles");
assert.deepEqual(resolveResourceSelection(legacyWithProfiles.resourceDefaults, "tools", "p", "legacy", ["runtime"]), { names: ["global"], source: "global" });

const future = normalizeWebuiSettings({
  version: 9,
  resourceDefaults: {
    futurePolicy: { keep: true },
    tools: { enabledTools: ["read"], futureToolField: "keep" },
    skills: { enabledSkills: null, futureSkillField: 3 },
    modelProfiles: [{
      provider: "p",
      modelId: "future",
      futureProfileField: ["keep"],
      tools: { enabledTools: ["bash"], futureSelectionField: true },
      skills: { enabledSkills: null },
    }],
  },
});
assert.deepEqual(future.resourceDefaults.futurePolicy, { keep: true });
assert.equal(future.resourceDefaults.tools.futureToolField, "keep");
assert.equal(future.resourceDefaults.skills.futureSkillField, 3);
assert.deepEqual(future.resourceDefaults.modelProfiles[0].futureProfileField, ["keep"]);
assert.equal(future.resourceDefaults.modelProfiles[0].tools.futureSelectionField, true);

const defaults = normalizeResourceDefaults({
  tools: { enabledTools: ["global"] },
  skills: { enabledSkills: ["global-skill"] },
  modelProfiles: [],
});
let profiles = setExactModelProfile(defaults, "provider", "model/id", "tools", ["read"]);
profiles = setExactModelProfile({ ...defaults, modelProfiles: profiles }, "provider", "model/id", "skills", []);
assert.deepEqual(profiles[0], {
  provider: "provider",
  modelId: "model/id",
  tools: { enabledTools: ["read"] },
  skills: { enabledSkills: [] },
});
profiles = setExactModelProfile({ ...defaults, modelProfiles: profiles }, "provider", "model/id", "tools", null);
assert.equal(profiles.length, 1, "independent skill selection should retain the profile");
profiles = setExactModelProfile({ ...defaults, modelProfiles: profiles }, "provider", "model/id", "skills", null);
assert.deepEqual(profiles, [], "both inherited resources should remove the profile");

assert.deepEqual(branchResourceDirective({ enabledTools: ["read"] }, "tools"), { pinned: true, names: ["read"], legacyDisabledNames: null });
assert.deepEqual(branchResourceDirective({ disabledSkills: ["a"] }, "skills"), { pinned: true, names: null, legacyDisabledNames: ["a"] });
assert.deepEqual(branchResourceDirective({ version: 2, mode: "inherit" }, "tools"), { pinned: false, names: null, legacyDisabledNames: null });
assert.deepEqual(preserveUnavailableResourceNames(["read", "missing"], ["read", "bash"], ["bash"]), ["bash", "missing"]);

const root = await mkdtemp(path.join(tmpdir(), "pi-resource-settings-"));
try {
  const file = path.join(root, "settings.json");
  await writeFile(file, `${JSON.stringify({ version: 7, retained: { ok: true }, resourceDefaults: { tools: { enabledTools: ["read"] } } })}\n`);
  const read = await readWebuiSettings(file);
  assert.equal(read.version, 8, "legacy settings should normalize to v8 in memory");
  assert.equal(JSON.parse(await readFile(file, "utf8")).version, 7, "reading should not eagerly rewrite legacy settings");
  await writeWebuiSettings({ resourceDefaults: { skills: { enabledSkills: [] } } }, file);
  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.equal(persisted.version, 8, "the next normal write should persist v8");
  assert.deepEqual(persisted.retained, { ok: true }, "migration writes should preserve unrelated fields");
  assert.deepEqual(persisted.resourceDefaults.tools.enabledTools, ["read"]);

  await writeFile(file, `${JSON.stringify({ version: 9, resourceDefaults: future.resourceDefaults })}\n`);
  await writeWebuiSettings({ remoteAuthEnabled: true }, file);
  const futurePersisted = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(futurePersisted.resourceDefaults.futurePolicy, { keep: true }, "future resource-default fields must survive writes");
  assert.equal(futurePersisted.resourceDefaults.tools.futureToolField, "keep");
  assert.equal(futurePersisted.resourceDefaults.modelProfiles[0].futureProfileField[0], "keep");
  assert.equal(futurePersisted.resourceDefaults.modelProfiles[0].tools.futureSelectionField, true);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("resource-selection.test.mjs passed");
