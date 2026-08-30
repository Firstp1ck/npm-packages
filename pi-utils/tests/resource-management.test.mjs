import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  readResourceDefaults,
  resolveResourceSelection,
  setExactModelProfile,
  updateResourceDefaults,
} from "../src/resource-management.mjs";

const root = await mkdtemp(path.join(tmpdir(), "pi-resource-management-"));
const settingsFile = path.join(root, "settings.json");

try {
  await writeFile(settingsFile, `${JSON.stringify({ version: 8, retained: { ok: true }, resourceDefaults: { tools: { enabledTools: ["read"] } } })}\n`);
  await updateResourceDefaults((current) => ({
    ...current,
    skills: { ...current.skills, enabledSkills: ["repo-explorer"] },
    modelProfiles: setExactModelProfile(current, "provider", "model", "tools", []),
  }), settingsFile);

  const defaults = await readResourceDefaults(settingsFile);
  assert.deepEqual(defaults.tools.enabledTools, ["read"]);
  assert.deepEqual(defaults.skills.enabledSkills, ["repo-explorer"]);
  assert.deepEqual(resolveResourceSelection(defaults, "tools", "provider", "model", ["runtime"]), { names: [], source: "model" });

  const raw = JSON.parse(await readFile(settingsFile, "utf8"));
  assert.deepEqual(raw.retained, { ok: true }, "resource writes must preserve unrelated WebUI settings");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("resource-management.test.mjs passed");
