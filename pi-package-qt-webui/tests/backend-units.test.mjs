import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJsonlReader } from "../lib/backend/jsonl.mjs";
import { blockPlainText, escapeStyledText, renderInline, renderMarkdown } from "../lib/backend/markdown.mjs";
import { terminateProcessTree } from "../lib/backend/process-tree.mjs";
import {
  LIMITS,
  PROTOCOL_VERSION,
  ProtocolError,
  REQUEST_TYPES,
  THINKING_LEVELS,
  boundedString,
  makeErrorResponse,
  makeEvent,
  makeResponse,
  safeExternalLink,
  stripAnsi,
  validateRequest,
} from "../lib/backend/protocol.mjs";
import { normalizeModel, normalizeModels, normalizeModelScope, normalizeThinkingLevels } from "../lib/backend/pi-session.mjs";
import { createResourceStore, resolveEffective, resourceModelKey, updateProfile, validateResources } from "../lib/backend/resources.mjs";
import { applySamplingToPayload, samplingCapabilities, validateSamplingParams } from "../lib/backend/sampling.mjs";
import { createSettingsStore, defaultSettings } from "../lib/backend/settings.mjs";
import { createStateStore, sessionSettlementKey, validateState } from "../lib/backend/state.mjs";
import qtWebUiHelper, { RESPONSE_PREFIX } from "../lib/pi-extension/qt-webui-helper.mjs";

const STYLED_TAG = /<\/?([a-z]+)(?:\s+href="[^"]*")?>/g;
const ALLOWED_TAGS = new Set(["b", "i", "s", "tt", "a", "br"]);

function assertWhitelistedMarkup(styled) {
  for (const match of styled.matchAll(STYLED_TAG)) assert(ALLOWED_TAGS.has(match[1]), `unexpected tag <${match[1]}> in ${styled}`);
  const stripped = styled.replace(STYLED_TAG, "");
  assert.doesNotMatch(stripped, /<|>/, `unescaped angle bracket in ${styled}`);
}

// ---- protocol ------------------------------------------------------------------------------

test("protocol frames carry the version and one kind", () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.deepEqual(makeResponse("r1", { a: 1 }), { v: 1, kind: "response", id: "r1", ok: true, data: { a: 1 } });
  assert.deepEqual(makeErrorResponse("r1", "bad", "x".repeat(600)).error.message.length, LIMITS.maxErrorCharacters);
  assert.deepEqual(makeEvent("pi.status", { statusKind: "ready" }), { v: 1, kind: "event", type: "pi.status", statusKind: "ready" });
  for (const type of REQUEST_TYPES) assert.equal(typeof LIMITS.requestTimeoutMs[type], "number", `${type} needs a timeout`);
  for (const reserved of ["kind", "type", "v", "id"]) {
    assert.throws(() => makeEvent("x", { [reserved]: 1 }), /reserved frame key/, `${reserved} must be rejected`);
  }
});

test("validateRequest rejects wrong versions, ids, and unknown types", () => {
  const valid = { v: 1, id: "a", type: "hello" };
  assert.deepEqual(validateRequest(valid), { id: "a", type: "hello" });
  assert.throws(() => validateRequest({ ...valid, v: 2 }), (error) => error instanceof ProtocolError && error.code === "unsupported_version");
  assert.throws(() => validateRequest({ ...valid, id: "" }), /request id/);
  assert.throws(() => validateRequest({ ...valid, id: "x".repeat(LIMITS.maxRequestIdCharacters + 1) }), /too long/);
  assert.doesNotThrow(() => validateRequest({ ...valid, id: "x".repeat(LIMITS.maxRequestIdCharacters) }));
  assert.throws(() => validateRequest({ ...valid, type: "rm_rf" }), (error) => error.code === "unknown_request");
  assert.throws(() => validateRequest([]), /JSON object/);
  assert.throws(() => validateRequest(null), /JSON object/);
});

test("validateRequest bounds prompt, dialog answers, settings, links, and notifications", () => {
  const prompt = (fields) => validateRequest({ v: 1, id: "p", type: "prompt", ...fields });
  assert.equal(prompt({ message: "x".repeat(LIMITS.maxMessageCharacters) }).mode, "send");
  assert.throws(() => prompt({ message: "x".repeat(LIMITS.maxMessageCharacters + 1) }), (error) => error.code === "limit_exceeded");
  assert.throws(() => prompt({ message: "   " }), /empty/);
  assert.throws(() => prompt({ message: "hi", mode: "yolo" }), /mode/);
  assert.equal(prompt({ message: "hi", mode: "steer" }).mode, "steer");

  const answer = (fields) => validateRequest({ v: 1, id: "e", type: "extension_response", requestId: "d1", ...fields });
  assert.deepEqual(answer({ value: "Allow" }), { id: "e", type: "extension_response", requestId: "d1", value: "Allow" });
  assert.deepEqual(answer({ confirmed: false }).confirmed, false);
  assert.equal(answer({ cancelled: true }).cancelled, true);
  assert.throws(() => answer({}), /exactly one/);
  assert.throws(() => answer({ value: "a", confirmed: true }), /exactly one/);
  assert.throws(() => answer({ cancelled: false }), /cancelled must be true/);
  assert.throws(() => answer({ confirmed: "yes" }), /boolean/);
  assert.throws(() => answer({ value: "x".repeat(LIMITS.maxDialogValueCharacters + 1) }), /exceeds/);

  const settings = (values) => validateRequest({ v: 1, id: "s", type: "settings_set", values });
  assert.deepEqual(settings({ compactTranscript: true, appearanceMode: "dark", selectedThemeName: "bundle-theme", reducedMotion: true }).values, { compactTranscript: true, appearanceMode: "dark", selectedThemeName: "bundle-theme", reducedMotion: true });
  assert.throws(() => settings({ unknown: true }), /unknown setting/);
  assert.throws(() => settings({ compactTranscript: "yes" }), /must be boolean/);
  assert.throws(() => settings({ appearanceMode: "sepia" }), /must be one of automatic, light, dark/);
  assert.equal(settings({ selectedThemeName: "" }).values.selectedThemeName, "");
  assert.throws(() => settings({ selectedThemeName: "bad/name" }), /no slash/);
  assert.throws(() => settings({ selectedThemeName: "x".repeat(LIMITS.maxThemeNameCharacters + 1) }), /1-64/);
  assert.equal(settings({ sessionSettleDays: 1 }).values.sessionSettleDays, 1);
  assert.equal(settings({ sessionSettleDays: 3650 }).values.sessionSettleDays, 3650);
  for (const value of [0, 3651, 1.5, "30", null]) {
    assert.throws(() => settings({ sessionSettleDays: value }), /whole number|between 1 and 3650/);
  }
  assert.throws(() => settings([]), /values object/);

  assert.throws(() => validateRequest({ v: 1, id: "l", type: "open_link", url: "x".repeat(LIMITS.maxLinkUrlCharacters + 1) }), /exceeds/);
  assert.throws(() => validateRequest({ v: 1, id: "n", type: "notify", title: "x".repeat(LIMITS.maxNotificationCharacters + 1) }), /exceeds/);
  assert.equal(validateRequest({ v: 1, id: "n", type: "notify", title: "done" }).body, "");
});

test("theme requests require typed, bounded identities", () => {
  assert.deepEqual(validateRequest({ v: 1, id: "t", type: "themes_list" }), { id: "t", type: "themes_list" });
  assert.deepEqual(validateRequest({ v: 1, id: "t", type: "theme_select", selection: { kind: "external", name: "light" } }), {
    id: "t", type: "theme_select", selection: { kind: "external", name: "light" },
  });
  assert.deepEqual(validateRequest({ v: 1, id: "t", type: "theme_select", selection: { kind: "builtin", name: "automatic" } }).selection, { kind: "builtin", name: "automatic" });
  for (const selection of [null, "dark", {}, { kind: "other", name: "dark" }, { kind: "builtin", name: "sepia" }, { kind: "external", name: "bad/name" }]) {
    assert.throws(() => validateRequest({ v: 1, id: "t", type: "theme_select", selection }), (error) => error.code === "invalid_request");
  }
  assert(REQUEST_TYPES.includes("themes_list"));
  assert(REQUEST_TYPES.includes("theme_select"));
});

test("validateRequest normalizes bounded modelOrder setting writes", () => {
  const settings = (modelOrder) => validateRequest({ v: 1, id: "s", type: "settings_set", values: { modelOrder } }).values.modelOrder;
  assert.deepEqual(settings(["anthropic/claude-sonnet", "openrouter/anthropic/claude-sonnet", "anthropic/claude-sonnet"]), [
    "anthropic/claude-sonnet",
    "openrouter/anthropic/claude-sonnet",
  ]);
  assert.deepEqual(settings([]), []);
  assert.doesNotThrow(() => settings([`${"p".repeat(LIMITS.maxProviderCharacters)}/${"m".repeat(LIMITS.maxModelIdCharacters)}`]));
  assert.throws(() => settings("anthropic/claude-sonnet"), /must be an array/);
  for (const malformed of [[""], ["anthropic"], ["/claude"], ["anthropic/"], ["anthropic/   "], [7]]) {
    assert.throws(() => settings(malformed), (error) => error.code === "invalid_request");
  }
  assert.throws(() => settings(Array.from({ length: LIMITS.maxModels + 1 }, (_, index) => `provider/model-${index}`)), (error) => error.code === "limit_exceeded");
  assert.throws(() => settings([`${"p".repeat(LIMITS.maxProviderCharacters + 1)}/model`]), (error) => error.code === "limit_exceeded");
  assert.throws(() => settings([`provider/${"m".repeat(LIMITS.maxModelIdCharacters + 1)}`]), (error) => error.code === "limit_exceeded");
});

test("validateRequest bounds model, thinking, and compaction requests", () => {
  const model = (fields) => validateRequest({ v: 1, id: "m", type: "model_set", ...fields });
  assert.deepEqual(model({ provider: "anthropic", modelId: "claude" }), { id: "m", type: "model_set", provider: "anthropic", modelId: "claude" });
  assert.doesNotThrow(() => model({ provider: "p".repeat(LIMITS.maxProviderCharacters), modelId: "m".repeat(LIMITS.maxModelIdCharacters) }));
  assert.throws(() => model({ provider: "p".repeat(LIMITS.maxProviderCharacters + 1), modelId: "m" }), (error) => error.code === "limit_exceeded");
  assert.throws(() => model({ provider: "p", modelId: "m".repeat(LIMITS.maxModelIdCharacters + 1) }), (error) => error.code === "limit_exceeded");
  assert.throws(() => model({ provider: " ", modelId: "m" }), /requires a provider/);
  assert.throws(() => model({ provider: "p" }), /string modelId/);

  const thinking = (level) => validateRequest({ v: 1, id: "t", type: "thinking_set", level });
  for (const level of THINKING_LEVELS) assert.equal(thinking(level).level, level);
  assert.throws(() => thinking("ultra"), /thinking level must be one of/);
  assert.throws(() => thinking(3), /thinking level must be one of/);

  const compact = (fields) => validateRequest({ v: 1, id: "c", type: "compact", ...fields });
  assert.equal(compact({}).instructions, "");
  assert.equal(compact({ instructions: "x".repeat(LIMITS.maxCompactionInstructionCharacters) }).instructions.length, LIMITS.maxCompactionInstructionCharacters);
  assert.throws(() => compact({ instructions: "x".repeat(LIMITS.maxCompactionInstructionCharacters + 1) }), (error) => error.code === "limit_exceeded");
  assert.throws(() => compact({ instructions: 7 }), /string instructions/);
  assert.equal(validateRequest({ v: 1, id: "l", type: "models_list" }).type, "models_list");
  for (const type of ["models_list", "model_set", "model_cycle", "thinking_levels", "thinking_set", "thinking_cycle", "compact"]) {
    assert(REQUEST_TYPES.includes(type), `${type} must be a request type`);
  }
});

test("resource requests preserve null inheritance, intentional empty lists, and numeric bounds", () => {
  const valid = (type, fields) => validateRequest({ v: 1, id: "r", type, ...fields });
  assert.deepEqual(valid("tools_set", { scope: "session", enabledTools: null }).names, null);
  assert.deepEqual(valid("tools_set", { scope: "global", enabledTools: [] }).names, []);
  assert.deepEqual(valid("skills_set", { scope: "model", enabledSkills: ["review"] }).names, ["review"]);
  assert.throws(() => valid("skills_set", { scope: "model", disabledSkills: [] }), /requires enabledSkills/);
  assert.throws(() => valid("tools_set", { scope: "other", enabledTools: [] }), /scope must be/);
  assert.doesNotThrow(() => valid("tools_set", { scope: "session", enabledTools: Array.from({ length: LIMITS.maxResourceNames }, (_, index) => `t${index}`) }));
  assert.throws(() => valid("tools_set", { scope: "session", enabledTools: Array.from({ length: LIMITS.maxResourceNames + 1 }, (_, index) => `t${index}`) }), (error) => error.code === "limit_exceeded");
  assert.throws(() => valid("skills_set", { scope: "session", enabledSkills: ["same", "same"] }), /unique/);
  assert.deepEqual(valid("sampling_set", { scope: "global", params: null }).params, null);
  assert.deepEqual(valid("sampling_set", { scope: "model", params: { temperature: 0, seed: Number.MAX_SAFE_INTEGER } }).params, { temperature: 0, seed: Number.MAX_SAFE_INTEGER });
  assert.throws(() => valid("sampling_set", { scope: "session", params: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`p${index}`, 1])) }), (error) => error.code === "limit_exceeded");
  for (const type of ["resources_state", "tools_set", "skills_set", "sampling_set"]) assert(REQUEST_TYPES.includes(type));
});

test("resource profiles resolve session then exact model then global without collapsing empty selections", async (t) => {
  const global = { tools: ["read"], skills: [], sampling: { temperature: 0.4, top_p: 0.9 } };
  const model = { tools: [], skills: null, sampling: { temperature: 0.2 } };
  const session = { tools: null, skills: ["review"], sampling: { seed: 7 } };
  assert.deepEqual(resolveEffective({ session, model, global }), {
    tools: [], toolsSource: "model", skills: ["review"], skillsSource: "session",
    sampling: { temperature: 0.2, top_p: 0.9, seed: 7 },
    samplingSources: { temperature: "model", top_p: "global", seed: "session" },
  });
  assert.deepEqual(resolveEffective({ session: { tools: [], skills: [], sampling: {} }, model: null, global: null }).tools, []);
  assert.equal(resolveEffective({ session: null, model: null, global: null }).tools, null);

  const directory = await mkdtemp(path.join(os.tmpdir(), "qt-webui-resources-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sharedPath = path.join(directory, "webui-settings.json");
  const store = createResourceStore({ directory, sharedPath });
  await store.update("global", {}, "sampling", { temperature: 0.7, top_k: 99 });
  await store.update("model", { provider: "p", modelId: "m" }, "tools", []);
  assert.deepEqual((await store.profileFor("global")).sampling, { temperature: 0.7, top_k: 99 }, "unsupported values stay persisted locally");
  assert.deepEqual((await store.profileFor("model", "p", "m")).tools, []);
  await store.update("model", { provider: "p", modelId: "m" }, "tools", null);
  assert.equal(Object.hasOwn((await store.read()).value.models, resourceModelKey("p", "m")), false, "an all-inherit canonical model profile is removed");
  const mode = (await stat(store.path)).mode & 0o777;
  assert.equal(mode, 0o600);
  assert.equal(store.sharedPath, sharedPath);
  const invalid = validateResources({ global: { tools: "bad", sampling: { temperature: 3, top_k: 50 } }, models: {} });
  assert.deepEqual(invalid.value.global.sampling, { top_k: 50 });
  assert.equal(invalid.value.migrations.webuiToolSkillState, false);
  assert(invalid.problems.length >= 2);
  assert.deepEqual(updateProfile(global, "sampling", { temperature: null, seed: 4 }).sampling, { top_p: 0.9, seed: 4 });
});

test("resource store migrates legacy tool and skill profiles once without overriding canonical values or resurrecting clears", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "qt-webui-resource-migration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const localPath = path.join(directory, "resources.json");
  const sharedPath = path.join(directory, "webui-settings.json");
  await writeFile(localPath, JSON.stringify({
    version: 1,
    global: { tools: ["legacy-global-tool"], skills: ["legacy-global-skill"], sampling: { temperature: 0.7 } },
    models: {
      "provider/model": { tools: ["legacy-model-tool"], skills: ["legacy-model-skill"], sampling: { seed: 9 } },
    },
  }));
  await writeFile(sharedPath, JSON.stringify({
    version: 8,
    retained: { owner: "pi-webui" },
    resourceDefaults: {
      tools: { enabledTools: ["canonical-global-tool"] },
      skills: { enabledSkills: null },
      modelProfiles: [{
        provider: "provider",
        modelId: "model",
        tools: { enabledTools: ["canonical-model-tool"] },
        skills: { enabledSkills: null },
      }],
    },
  }));

  const store = createResourceStore({ directory, sharedPath });
  const migrated = await store.read();
  assert.deepEqual(migrated.value.global, {
    tools: ["canonical-global-tool"],
    skills: ["legacy-global-skill"],
    sampling: { temperature: 0.7 },
  }, "canonical values win while null fields receive the legacy fallback once");
  assert.deepEqual(migrated.value.models[resourceModelKey("provider", "model")], {
    tools: ["canonical-model-tool"],
    skills: ["legacy-model-skill"],
    sampling: { seed: 9 },
  });
  const canonicalAfterMigration = JSON.parse(await readFile(sharedPath, "utf8"));
  assert.deepEqual(canonicalAfterMigration.retained, { owner: "pi-webui" }, "the canonical latest-snapshot merge preserves unrelated settings");
  assert.equal(canonicalAfterMigration.resourceDefaults.qtWebuiMigrations.webuiToolSkillState, true, "the migration data and completion marker commit atomically in the canonical store");
  assert.equal(JSON.parse(await readFile(localPath, "utf8")).migrations, undefined, "migration never needs a second local marker write");

  const localAfterMigration = JSON.parse(await readFile(localPath, "utf8"));
  localAfterMigration.global.skills = ["must-not-migrate-again"];
  await writeFile(localPath, JSON.stringify(localAfterMigration));
  assert.deepEqual((await store.read()).value.global.skills, ["legacy-global-skill"], "the bounded marker prevents repeated fallback migration");

  await store.update("model", { provider: "provider", modelId: "model" }, "tools", null);
  await store.update("model", { provider: "provider", modelId: "model" }, "skills", null);
  const cleared = await store.read();
  const clearedModel = cleared.value.models[resourceModelKey("provider", "model")];
  assert.equal(clearedModel.tools, null);
  assert.equal(clearedModel.skills, null, "canonical inherit does not resurrect retained legacy selections");
  assert.deepEqual(clearedModel.sampling, { seed: 9 });
});

test("resource migration uses a failure-safe canonical marker even when the local directory cannot be written", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qt-webui-resource-marker-"));
  const directory = path.join(root, "local");
  const sharedPath = path.join(root, "shared", "settings.json");
  await mkdir(directory, { recursive: true });
  const localPath = path.join(directory, "resources.json");
  await writeFile(localPath, JSON.stringify({ global: { tools: ["legacy-tool"] }, models: {} }));
  if (process.platform !== "win32") await chmod(directory, 0o500);
  t.after(async () => {
    if (process.platform !== "win32") await chmod(directory, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  const store = createResourceStore({ directory, sharedPath });
  assert.deepEqual((await store.read()).value.global.tools, ["legacy-tool"]);
  const canonical = JSON.parse(await readFile(sharedPath, "utf8"));
  assert.equal(canonical.resourceDefaults.qtWebuiMigrations.webuiToolSkillState, true);
  assert.equal(JSON.parse(await readFile(localPath, "utf8")).migrations, undefined);

  canonical.resourceDefaults.tools.enabledTools = null;
  await writeFile(sharedPath, JSON.stringify(canonical));
  if (process.platform !== "win32") await chmod(directory, 0o700);
  await writeFile(localPath, JSON.stringify({ global: { tools: ["must-not-resurrect"] }, models: {} }));
  if (process.platform !== "win32") await chmod(directory, 0o500);
  assert.equal((await store.read()).value.global.tools, null, "a later canonical clear remains authoritative without a local marker write");
});

test("resource reads leave malformed, oversized, and partially invalid legacy files untouched", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qt-webui-resource-invalid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cases = [
    ["malformed", "{not json\n", /not valid JSON/],
    ["oversized", "x".repeat(LIMITS.maxResourcesFileBytes + 1), /exceeds/],
    ["partial", JSON.stringify({ global: { tools: "bad", sampling: { temperature: 0.4 } }, models: {} }), /tools must be a list/],
  ];
  for (const [name, contents, expectedProblem] of cases) {
    const directory = path.join(root, name);
    await mkdir(directory, { recursive: true });
    const localPath = path.join(directory, "resources.json");
    const sharedPath = path.join(root, `${name}-settings.json`);
    await writeFile(localPath, contents);
    const result = await createResourceStore({ directory, sharedPath }).read();
    assert(result.problems.some((problem) => expectedProblem.test(problem)), `${name} reports its validation problem`);
    assert.equal(await readFile(localPath, "utf8"), contents, `${name} storage is not rewritten merely by opening resources`);
    await assert.rejects(readFile(sharedPath, "utf8"), (error) => error.code === "ENOENT", `${name} does not persist a migration marker`);
  }
});

test("exact-model profile limits fail before migration or direct writes report a misleading commit", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qt-webui-resource-limit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const saturatedProfiles = Array.from({ length: 512 }, (_, index) => ({
    provider: "provider",
    modelId: `model-${index}`,
    tools: { enabledTools: ["read"] },
    skills: { enabledSkills: null },
  }));

  const migrationDirectory = path.join(root, "migration");
  await mkdir(migrationDirectory, { recursive: true });
  const migrationShared = path.join(root, "migration-settings.json");
  const saturatedSettings = { version: 8, resourceDefaults: { tools: { enabledTools: null }, skills: { enabledSkills: null }, modelProfiles: saturatedProfiles } };
  await writeFile(migrationShared, JSON.stringify(saturatedSettings));
  await writeFile(path.join(migrationDirectory, "resources.json"), JSON.stringify({
    global: {},
    models: { "legacy/extra": { tools: ["legacy-tool"] } },
  }));
  await assert.rejects(createResourceStore({ directory: migrationDirectory, sharedPath: migrationShared }).read(), (error) => error.code === "limit_exceeded");
  assert.deepEqual(JSON.parse(await readFile(migrationShared, "utf8")), saturatedSettings, "failed migration writes neither a profile nor its completion marker");

  const directDirectory = path.join(root, "direct");
  await mkdir(directDirectory, { recursive: true });
  const directShared = path.join(root, "direct-settings.json");
  await writeFile(directShared, JSON.stringify(saturatedSettings));
  await writeFile(path.join(directDirectory, "resources.json"), JSON.stringify({ migrations: { webuiToolSkillState: true }, models: {} }));
  const direct = createResourceStore({ directory: directDirectory, sharedPath: directShared });
  await assert.rejects(direct.update("model", { provider: "provider", modelId: "extra" }, "skills", []), (error) => error.code === "limit_exceeded");
  assert.deepEqual(JSON.parse(await readFile(directShared, "utf8")), saturatedSettings, "a saturated direct update leaves canonical settings unchanged");
});

test("canonical model identities remain distinct when providers and model IDs contain slashes", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "qt-webui-resource-tuples-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sharedPath = path.join(directory, "webui-settings.json");
  await writeFile(sharedPath, JSON.stringify({
    version: 8,
    resourceDefaults: {
      tools: { enabledTools: null },
      skills: { enabledSkills: null },
      qtWebuiMigrations: { webuiToolSkillState: true },
      modelProfiles: [
        { provider: "custom/acme", modelId: "model/one", tools: { enabledTools: ["read"] }, skills: { enabledSkills: null } },
        { provider: "custom", modelId: "acme/model/one", tools: { enabledTools: ["bash"] }, skills: { enabledSkills: null } },
      ],
    },
  }));
  await writeFile(path.join(directory, "resources.json"), JSON.stringify({
    migrations: { webuiToolSkillState: true },
    models: { "regular/model/with/slash": { sampling: { seed: 7 } } },
  }));
  const store = createResourceStore({ directory, sharedPath });
  const state = await store.read();
  assert.deepEqual(state.value.models[resourceModelKey("custom/acme", "model/one")].tools, ["read"]);
  assert.deepEqual(state.value.models[resourceModelKey("custom", "acme/model/one")].tools, ["bash"]);
  assert.deepEqual(state.value.models[resourceModelKey("regular", "model/with/slash")].sampling, { seed: 7 }, "legacy local sampling remains readable");

  const committed = await store.update("model", { provider: "custom/acme", modelId: "model/one" }, "skills", []);
  assert.deepEqual(committed.value.models[resourceModelKey("custom/acme", "model/one")].skills, []);
  const sampled = await store.update("model", { provider: "custom/acme", modelId: "model/one" }, "sampling", { temperature: 0.2 });
  assert.deepEqual(sampled.value.models[resourceModelKey("custom/acme", "model/one")].sampling, { temperature: 0.2 });
  const local = JSON.parse(await readFile(path.join(directory, "resources.json"), "utf8"));
  assert.deepEqual(local.models[resourceModelKey("custom/acme", "model/one")].sampling, { temperature: 0.2 }, "slash-bearing providers use an unambiguous local tuple key");
});

test("resource updates return their committed snapshot and read canonical state before local sampling writes", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "qt-webui-resource-commit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sharedPath = path.join(directory, "webui-settings.json");
  const store = createResourceStore({ directory, sharedPath });
  const committed = await store.update("global", {}, "tools", ["read"]);
  assert.deepEqual(committed.value.global.tools, ["read"]);
  assert.equal(committed.sharedPath, sharedPath);

  const invalidDirectory = path.join(directory, "invalid-local");
  const invalidShared = path.join(directory, "invalid-settings.json");
  await writeFile(invalidShared, "{bad json");
  const invalid = createResourceStore({ directory: invalidDirectory, sharedPath: invalidShared });
  await assert.rejects(invalid.update("global", {}, "sampling", { temperature: 0.3 }), /Cannot read Pi Web UI settings/);
  await assert.rejects(readFile(path.join(invalidDirectory, "resources.json"), "utf8"), (error) => error.code === "ENOENT", "sampling is not committed before canonical preflight succeeds");
});

test("canonical tool writes preserve configured names that are temporarily unavailable", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "qt-webui-resource-unavailable-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sharedPath = path.join(directory, "webui-settings.json");
  const store = createResourceStore({ directory, env: { PI_WEBUI_SETTINGS_FILE: sharedPath } });
  assert.equal(store.sharedPath, sharedPath, "PI_WEBUI_SETTINGS_FILE selects the canonical shared store");
  await store.update("global", {}, "tools", ["read", "temporarily-missing"]);
  await store.update("global", {}, "tools", ["bash"], { visibleNames: ["read", "bash"] });
  assert.deepEqual((await store.read()).value.global.tools, ["bash", "temporarily-missing"]);
});

test("sampling capabilities validate every parameter and serialize exact provider payload shapes", () => {
  assert.deepEqual(validateSamplingParams({ temperature: 0, top_p: 1, frequency_penalty: -2, presence_penalty: 2, seed: Number.MAX_SAFE_INTEGER, top_k: 1, min_p: 0 }).problems, {});
  for (const [key, value] of Object.entries({ temperature: 2.01, top_p: -0.01, frequency_penalty: -2.01, presence_penalty: 2.01, seed: 1.5, top_k: 0, min_p: 1.01 })) {
    assert(Object.hasOwn(validateSamplingParams({ [key]: value }).problems, key), `${key} rejects one over its range or integer contract`);
  }
  assert(Object.values(samplingCapabilities("unknown-api")).every((entry) => entry.supported === false));
  assert.equal(samplingCapabilities("anthropic-messages", { thinkingActive: true }).temperature.supported, false);
  const all = { temperature: 0.3, top_p: 0.8, frequency_penalty: -0.2, presence_penalty: 0.4, seed: 42, top_k: 30, min_p: 0.1 };
  assert.deepEqual(applySamplingToPayload({ model: "x" }, "openai-completions", all), { model: "x", temperature: 0.3, top_p: 0.8, frequency_penalty: -0.2, presence_penalty: 0.4, seed: 42 });
  assert.deepEqual(applySamplingToPayload({ config: { keep: true } }, "google-generative-ai", all), { config: { keep: true, temperature: 0.3, topP: 0.8, topK: 30, frequencyPenalty: -0.2, presencePenalty: 0.4, seed: 42 } });
  assert.deepEqual(applySamplingToPayload({}, "bedrock-converse-stream", all), { inferenceConfig: { temperature: 0.3, topP: 0.8 } });
  assert.deepEqual(applySamplingToPayload({}, "pi-messages", all), { options: { temperature: 0.3 } });
  assert.equal(applySamplingToPayload({}, "unknown-api", all), undefined, "unknown provider APIs apply no sampling values");
});

test("Pi helper persists enabled-name session overrides and translates effective skills and sampling internally", async () => {
  const handlers = new Map();
  const commands = new Map();
  const entries = [];
  const notifications = [];
  let activeTools = ["read", "bash"];
  let appendFailure = false;
  let persisted = true;
  let branchEntries = [];
  const allTools = [{ name: "read", description: "Read" }, { name: "bash", description: "Shell" }];
  const allSkills = [
    { name: "review", description: "Review", filePath: "/skills/review/SKILL.md" },
    { name: "search", description: "Search", filePath: "/skills/search/SKILL.md" },
  ];
  const pi = {
    on(name, handler) { handlers.set(name, handler); },
    registerCommand(name, command) { commands.set(name, command); },
    getActiveTools() { return [...activeTools]; },
    getAllTools() { return allTools; },
    setActiveTools(names) { activeTools = [...names]; },
    appendEntry(type, data) {
      if (appendFailure) throw new Error("deterministic append failure");
      entries.push({ type, data: structuredClone(data) });
    },
  };
  qtWebUiHelper(pi);
  const ctx = {
    model: { provider: "p", id: "m", api: "openai-completions", reasoning: false },
    scopedModels: [
      { model: { provider: "scope", id: "second" }, thinkingLevel: "high" },
      { model: { provider: "scope", id: "first" } },
    ],
    thinkingLevel: "off",
    sessionManager: { getBranch: () => branchEntries, isPersisted: () => persisted },
    getSystemPromptOptions: () => ({ skills: allSkills }),
    ui: { notify: (message) => notifications.push(message) },
  };
  await handlers.get("session_start")({}, ctx);
  const apply = commands.get("qt-webui-helper").handler;
  await apply(JSON.stringify({ requestId: "a", action: "apply", payload: {
    session: { tools: [], skills: [], sampling: { temperature: 0.3, top_k: 20 } },
    effective: { tools: [], skills: ["review"], sampling: { temperature: 0.3, top_k: 20 } },
  } }), ctx);
  assert.deepEqual(entries.slice(-3), [
    { type: "webui-tools-config", data: { version: 2, mode: "explicit", enabledTools: [] } },
    { type: "webui-skills-config", data: { version: 2, mode: "explicit", enabledSkills: [] } },
    { type: "qt-webui-resources", data: { version: 1, tools: [], skills: [], sampling: { temperature: 0.3, top_k: 20 } } },
  ], "tool and skill overrides use Pi Web UI entries while sampling retains the Qt entry");
  assert.deepEqual(activeTools, []);
  const answer = JSON.parse(notifications.at(-1).slice(RESPONSE_PREFIX.length));
  assert.deepEqual(answer.data.session, { tools: [], skills: [], sampling: { temperature: 0.3, top_k: 20 }, durability: { durable: true, reason: "" } });
  assert.deepEqual(answer.data.skills.enabled, ["review"], "the enabled list is translated to the helper's disabled set");
  assert.deepEqual(answer.data.scopedModels, {
    explicit: true,
    items: [
      { provider: "scope", id: "second", thinkingLevel: "high" },
      { provider: "scope", id: "first", thinkingLevel: "" },
    ],
    omitted: 0,
  });
  assert.deepEqual(handlers.get("before_provider_request")({ payload: { model: "m" } }, ctx), { model: "m", temperature: 0.3 }, "unsupported stored values are not serialized");

  await apply(JSON.stringify({ requestId: "b", action: "apply", payload: {
    session: { tools: null, skills: null, sampling: {} },
    effective: { tools: null, skills: [], sampling: {} },
  } }), ctx);
  const reset = JSON.parse(notifications.at(-1).slice(RESPONSE_PREFIX.length));
  assert.equal(reset.data.session.tools, null);
  assert.equal(reset.data.session.skills, null);
  assert.deepEqual(entries.slice(-3, -1), [
    { type: "webui-tools-config", data: { version: 2, mode: "inherit" } },
    { type: "webui-skills-config", data: { version: 2, mode: "inherit" } },
  ], "null session selections persist Pi Web UI's explicit inherit mode");
  assert.deepEqual(reset.data.skills.enabled, [], "an intentional empty effective selection is not treated as inherit");
  assert.deepEqual(activeTools, ["read", "bash"], "null effective tools restore Pi defaults");

  appendFailure = true;
  await apply(JSON.stringify({ requestId: "c", action: "apply", payload: {
    session: { tools: [] }, effective: { tools: [] },
  } }), ctx);
  const failed = JSON.parse(notifications.at(-1).slice(RESPONSE_PREFIX.length));
  assert.equal(failed.ok, false);
  assert.match(failed.error, /deterministic append failure/);
  assert.equal(reset.data.session.tools, null, "the last confirmed session state remains unchanged");
  assert.deepEqual(activeTools, ["read", "bash"], "effective tools do not change after a durability failure");

  persisted = false;
  await apply(JSON.stringify({ requestId: "d", action: "apply", payload: {
    session: { tools: [] }, effective: { tools: [] },
  } }), ctx);
  const ephemeral = JSON.parse(notifications.at(-1).slice(RESPONSE_PREFIX.length));
  assert.equal(ephemeral.ok, true);
  assert.deepEqual(ephemeral.data.session.durability, {
    durable: false,
    reason: "This Pi session is ephemeral; resource overrides apply only until it ends.",
  });
  assert.deepEqual(activeTools, [], "an explicitly non-durable override still applies in memory");

  appendFailure = false;
  persisted = true;
  branchEntries = [
    { type: "custom", customType: "qt-webui-resources", data: { version: 1, tools: ["bash"], skills: ["search"], sampling: { temperature: 0.4 } } },
    { type: "custom", customType: "webui-tools-config", data: { version: 2, mode: "inherit" } },
    { type: "custom", customType: "webui-skills-config", data: { disabledSkills: ["search"] } },
  ];
  await handlers.get("session_start")({}, ctx);
  await apply(JSON.stringify({ requestId: "restore", action: "state" }), ctx);
  const restored = JSON.parse(notifications.at(-1).slice(RESPONSE_PREFIX.length));
  assert.equal(restored.data.session.tools, null, "a shared inherit entry suppresses the legacy Qt tool fallback");
  assert.deepEqual(restored.data.session.skills, ["review"], "legacy Pi Web UI disabledSkills entries translate to enabled names");
  assert.deepEqual(restored.data.session.sampling, { temperature: 0.4 }, "Qt sampling still restores from its legacy entry");

  ctx.scopedModels = Array.from({ length: 514 }, (_, index) => ({
    model: { provider: "scope", id: `model-${index}` },
    thinkingLevel: index === 0 ? "medium" : undefined,
  }));
  await apply(JSON.stringify({ requestId: "e", action: "state" }), ctx);
  const boundedScope = JSON.parse(notifications.at(-1).slice(RESPONSE_PREFIX.length)).data.scopedModels;
  assert.equal(boundedScope.items.length, 512);
  assert.equal(boundedScope.omitted, 2);
  assert.deepEqual(boundedScope.items[0], { provider: "scope", id: "model-0", thinkingLevel: "medium" });
  assert.deepEqual(boundedScope.items.at(-1), { provider: "scope", id: "model-511", thinkingLevel: "" });
});

test("model inventories and thinking levels are normalized, deduplicated, and bounded", () => {
  const full = normalizeModel({ id: "m\u001b[31m1\u001b[0m", name: "Name", provider: "prov", reasoning: true, input: ["text", "image", "audio"], contextWindow: 1000.9, maxTokens: -5, baseUrl: "https://x", cost: {} });
  assert.deepEqual(full, { provider: "prov", id: "m1", name: "Name", reasoning: true, acceptsImages: true, contextWindow: 1000, maxTokens: 0 });
  assert.equal(normalizeModel({ id: "", provider: "p" }), null);
  assert.equal(normalizeModel({ id: "x" }), null);
  assert.equal(normalizeModel("text"), null);
  assert.equal(normalizeModel({ id: "x".repeat(LIMITS.maxModelIdCharacters + 5), provider: "p" }).id.length, LIMITS.maxModelIdCharacters);
  assert.equal(normalizeModel({ id: "x", provider: "p", name: "n".repeat(LIMITS.maxModelNameCharacters + 1) }).name.length, LIMITS.maxModelNameCharacters);

  const many = Array.from({ length: LIMITS.maxModels + 1 }, (_, index) => ({ id: `m${index}`, provider: "p" }));
  assert.deepEqual(normalizeModels(many.slice(0, LIMITS.maxModels)).omitted, 0);
  const over = normalizeModels(many.concat([{ id: "m0", provider: "p" }, null]));
  assert.equal(over.models.length, LIMITS.maxModels);
  assert.equal(over.omitted, 1, "duplicates and malformed entries do not count as omitted");
  assert.deepEqual(normalizeModels(undefined), { models: [], omitted: 0 });

  assert.deepEqual(normalizeModelScope({
    explicit: true,
    items: [
      { provider: "p", id: "second", thinkingLevel: "high" },
      { provider: "p", id: "first", thinkingLevel: "bogus" },
      { provider: "p", id: "second", thinkingLevel: "low" },
      { provider: "", id: "bad" },
    ],
    omitted: 2,
  }), {
    explicit: true,
    items: [
      { provider: "p", id: "second", thinkingLevel: "high" },
      { provider: "p", id: "first", thinkingLevel: "" },
    ],
    omitted: 2,
  });
  assert.deepEqual(normalizeModelScope({ explicit: false, items: [{ provider: "p", id: "ignored" }], omitted: 3 }), { explicit: false, items: [], omitted: 0 });
  assert.equal(normalizeModelScope(undefined), null);

  assert.deepEqual(normalizeThinkingLevels(["high", "bogus", "off", "low", "off"]), ["off", "low", "high"]);
  assert.deepEqual(normalizeThinkingLevels([]), ["off"]);
  assert.deepEqual(normalizeThinkingLevels("high"), ["off"]);
  assert.equal(normalizeThinkingLevels(THINKING_LEVELS).length, Math.min(THINKING_LEVELS.length, LIMITS.maxThinkingLevels));
});

test("safeExternalLink allows only http, https, and mailto without credentials or control characters", () => {
  assert.equal(safeExternalLink("https://example.com/path?q=1#x"), "https://example.com/path?q=1#x");
  assert.equal(safeExternalLink("http://example.com"), "http://example.com/");
  assert.equal(safeExternalLink("mailto:someone@example.com"), "mailto:someone@example.com");
  for (const bad of [
    "javascript:alert(1)", "file:///etc/passwd", "data:text/html,<b>x</b>", "ftp://example.com/x",
    "https://user:pw@example.com", "https://exa mple.com", "https://example.com/\u0000", "not a url", "", "https://",
    `https://example.com/${"a".repeat(LIMITS.maxLinkUrlCharacters)}`,
  ]) assert.equal(safeExternalLink(bad), null, `should reject ${bad}`);
});

test("stripAnsi removes SGR, CSI, OSC, bare bracket sequences, and control characters", () => {
  assert.equal(stripAnsi("\u001b[38;2;249;22;22mred\u001b[0m"), "red");
  assert.equal(stripAnsi("a\u001b[2Kb\u001b]0;title\u0007c"), "abc");
  assert.equal(stripAnsi("plain [38;2;1;2;3m leaked"), "plain  leaked");
  assert.equal(stripAnsi("tab\tkept\nnewline\u0000nul"), "tab\tkept\nnewlinenul");
  assert.equal(stripAnsi(undefined), "");
});

test("boundedString truncates at the limit with one marker character", () => {
  assert.equal(boundedString("abc", 3), "abc");
  assert.equal(boundedString("abcd", 3), "ab…");
  assert.equal(boundedString(undefined, 3, "fallback"), "fa…");
  assert.equal(boundedString(42, 5), "42");
});

// ---- jsonl ---------------------------------------------------------------------------------

test("JSONL reader splits on LF only, strips one CR, and keeps U+2028 inside strings", () => {
  const records = [];
  const reader = createJsonlReader({ maxFrameBytes: 1024, onRecord: (record) => records.push(record) });
  reader.write('{"a":1}\r\n{"b":"x\u2028y"}\n{"c":');
  reader.write("2}\n");
  reader.write('{"tail":true}');
  reader.end();
  assert.deepEqual(records, [{ a: 1 }, { b: "x\u2028y" }, { c: 2 }, { tail: true }]);
});

test("JSONL reader rejects oversized frames without buffering them and keeps delivering later frames", () => {
  const records = [];
  const oversized = [];
  const invalid = [];
  const reader = createJsonlReader({
    maxFrameBytes: 64,
    onRecord: (record) => records.push(record),
    onOversized: (bytes) => oversized.push(bytes),
    onInvalid: (error) => invalid.push(error.message),
  });
  reader.write(`{"ok":1}\n{"big":"${"x".repeat(200)}"}\n`);
  reader.write(`{"big2":"${"y".repeat(100)}`);
  reader.write(`${"y".repeat(100)}"}\n{"ok":2}\n{"ok":"exactly-64-bytes-long-frame-padding-xxxxxxxxxxxxxxxx"}\n`);
  reader.write("not json\n");
  reader.end();
  assert.deepEqual(records.filter((record) => record.ok !== undefined).map((record) => record.ok), [1, 2, "exactly-64-bytes-long-frame-padding-xxxxxxxxxxxxxxxx"]);
  assert.equal(oversized.length, 2);
  assert(oversized[0] > 64 && oversized[1] > 200);
  assert.equal(invalid.length, 1);
});

// ---- markdown ------------------------------------------------------------------------------

test("markdown rendering escapes raw HTML and keeps every inline element inside the whitelist", () => {
  const source = [
    "# Title <script>alert(1)</script>",
    "Plain <img src=\"file:///etc/passwd\" onerror=\"x()\"> and <a href=\"javascript:alert(1)\">x</a>.",
    "**bold** *em* ~~gone~~ `co<de>` [ok](https://example.com) [bad](javascript:alert(1)) <https://auto.example> ![pic](https://example.com/a.png)",
    "- item <b>x</b>",
    "> quote <i>y</i>",
    "| h<1> | h2 |", "|---|---|", "| c<1> | c2 |",
    "```html", "<script>alert('inside code')</script>", "```",
  ].join("\n");
  const { blocks, truncated } = renderMarkdown(source);
  assert.equal(truncated, false);
  for (const block of blocks) {
    if (block.styled !== undefined) assertWhitelistedMarkup(block.styled);
    if (block.type === "table") for (const cell of [...block.header, ...block.rows.flat()]) assertWhitelistedMarkup(cell);
  }
  const styledOnly = JSON.stringify(blocks.map((block) => (block.type === "code" ? { type: "code" } : block)));
  assert.doesNotMatch(styledOnly, /<script>|<img|href=\\"javascript|href=\\"file/);
  assert.match(styledOnly, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const inline = blocks.find((block) => block.type === "paragraph" && block.styled.includes("<b>bold</b>")).styled;
  assert.match(inline, /<i>em<\/i>/);
  assert.match(inline, /<s>gone<\/s>/);
  assert.match(inline, /<tt>co&lt;de&gt;<\/tt>/);
  assert.match(inline, /<a href="https:\/\/example.com\/">ok<\/a>/);
  assert.match(inline, /\[bad\]\(javascript:alert\(1\)\)/);
  assert.match(inline, /<a href="https:\/\/auto.example\/">/);
  assert.match(inline, /\[image: pic\]/);
  assert.doesNotMatch(inline, /a\.png/);
  const code = blocks.find((block) => block.type === "code");
  assert.equal(code.language, "html");
  assert.equal(code.text, "<script>alert('inside code')</script>");
  assert.equal(code.closed, true);
});

test("markdown input, block, depth, table, and list limits hold at the limit and one over", () => {
  const atLimit = renderMarkdown("a".repeat(LIMITS.maxMarkdownInputCharacters));
  assert.equal(atLimit.truncated, false);
  const overLimit = renderMarkdown("a".repeat(LIMITS.maxMarkdownInputCharacters + 1));
  assert.equal(overLimit.truncated, true);
  assert.equal(overLimit.blocks.at(-1).type, "notice");

  const headings = (count) => Array.from({ length: count }, (_, index) => `# h${index}`).join("\n\n");
  assert.equal(renderMarkdown(headings(LIMITS.maxMarkdownBlocks)).blocks.length, LIMITS.maxMarkdownBlocks);
  assert.equal(renderMarkdown(headings(LIMITS.maxMarkdownBlocks)).truncated, false);
  const tooMany = renderMarkdown(headings(LIMITS.maxMarkdownBlocks + 1));
  assert.equal(tooMany.truncated, true);
  assert.equal(tooMany.blocks.length, LIMITS.maxMarkdownBlocks);
  assert.equal(tooMany.blocks.at(-1).type, "notice");

  const deepQuote = renderMarkdown(`${"> ".repeat(LIMITS.maxMarkdownDepth + 3)}deep **bold**`);
  assert(deepQuote.blocks.every((block) => block.depth < LIMITS.maxMarkdownDepth), JSON.stringify(deepQuote.blocks));
  assert(deepQuote.blocks.every((block) => block.quote === true));

  const table = (rows) => ["| a | b |", "|---|---|", ...Array.from({ length: rows }, (_, index) => `| ${index} | x |`)].join("\n");
  assert.equal(renderMarkdown(table(LIMITS.maxTableRows)).blocks[0].droppedRows, 0);
  assert.equal(renderMarkdown(table(LIMITS.maxTableRows + 1)).blocks[0].droppedRows, 1);
  assert.equal(renderMarkdown(table(LIMITS.maxTableRows + 1)).blocks[0].rows.length, LIMITS.maxTableRows);
  const wide = renderMarkdown(`|${" c |".repeat(LIMITS.maxTableColumns + 4)}\n|${"---|".repeat(LIMITS.maxTableColumns + 4)}\n|${" d |".repeat(LIMITS.maxTableColumns + 4)}`);
  assert.equal(wide.blocks[0].header.length, LIMITS.maxTableColumns);

  const list = (count) => Array.from({ length: count }, (_, index) => `- item ${index}`).join("\n");
  assert.equal(renderMarkdown(list(LIMITS.maxListItems)).blocks.filter((block) => block.type === "listItem").length, LIMITS.maxListItems);
  const longList = renderMarkdown(list(LIMITS.maxListItems + 1));
  assert(longList.blocks.filter((block) => block.type === "listItem").length <= LIMITS.maxListItems);
  assert(longList.blocks.length <= LIMITS.maxMarkdownBlocks);
  assert.match(longList.blocks.at(-1).styled, /omitted|shortened/);
  const nested = renderMarkdown("- a\n  - b\n    - c\n      - d\n        - e\n          - f");
  assert(nested.blocks.every((block) => block.depth < LIMITS.maxMarkdownDepth));
});

test("markdown list numbering, tasks, rules, and unclosed fences render predictably", () => {
  const { blocks } = renderMarkdown("1. one\n2. two\n- [x] done\n- [ ] todo\n\n---\n\n```\nunclosed");
  assert.deepEqual(blocks.slice(0, 2).map((block) => [block.ordered, block.index]), [[true, 1], [true, 2]]);
  assert.deepEqual(blocks.slice(2, 4).map((block) => [block.task, block.checked]), [[true, true], [true, false]]);
  assert.equal(blocks[4].type, "rule");
  assert.equal(blocks[5].type, "code");
  assert.equal(blocks[5].closed, false);
  assert.equal(blocks[5].text, "unclosed");
});

test("plain text of rendered blocks matches the original text for copy and search", () => {
  const original = "Use <T> & \"quotes\" with **bold** and [x](https://example.com)";
  const { blocks } = renderMarkdown(original);
  assert.equal(blockPlainText(blocks[0]), 'Use <T> & "quotes" with bold and x');
  assert.equal(escapeStyledText("<&>\""), "&lt;&amp;&gt;&quot;");
  assert.equal(renderInline("plain"), "plain");
  assert.equal(renderInline("a \\* b"), "a * b");
});

test("markdown rendering stays fast and bounded for adversarial input", () => {
  const nasty = `${"[".repeat(3000)}${"*".repeat(3000)}${"`".repeat(2000)}`;
  const started = process.hrtime.bigint();
  const { blocks } = renderMarkdown(nasty);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert(elapsedMs < 2000, `adversarial render took ${elapsedMs}ms`);
  assert(blocks.length <= LIMITS.maxMarkdownBlocks);
});

// ---- settings ------------------------------------------------------------------------------

test("settings store uses XDG config, private permissions, atomic writes, and validated reads", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "qt-webui-settings-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = createSettingsStore({ env: { XDG_CONFIG_HOME: home } });
  assert.equal(store.path, path.join(home, "qt-webui", "settings.json"));
  assert.deepEqual(store.read(), { settings: defaultSettings(), problems: [], path: store.path });
  assert.equal(defaultSettings().selectedThemeName, "");
  assert.equal(defaultSettings().sessionSettleDays, 30);
  assert.deepEqual(defaultSettings().modelOrder, []);

  const modelOrder = ["anthropic/claude-sonnet", "openrouter/anthropic/claude-sonnet"];
  const written = store.write({ compactTranscript: true, appearanceMode: "dark", selectedThemeName: "bundle-theme", reducedMotion: true, sessionSettleDays: 45, modelOrder: [...modelOrder, modelOrder[0]] });
  assert.equal(written.settings.compactTranscript, true);
  assert.equal(written.settings.appearanceMode, "dark");
  assert.equal(written.settings.selectedThemeName, "bundle-theme");
  assert.equal(written.settings.reducedMotion, true);
  assert.equal(written.settings.sessionSettleDays, 45);
  assert.deepEqual(written.settings.modelOrder, modelOrder);
  assert.equal((await stat(store.directory)).mode & 0o777, 0o700);
  assert.equal((await stat(store.path)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(store.path, "utf8")), { ...defaultSettings(), compactTranscript: true, appearanceMode: "dark", selectedThemeName: "bundle-theme", reducedMotion: true, sessionSettleDays: 45, modelOrder });
  assert.equal(store.read().settings.sessionSettleDays, 45);
  assert.deepEqual(store.read().settings.modelOrder, modelOrder);
  assert.throws(() => store.write({ unknown: 1 }), /unknown setting/);
  assert.throws(() => store.write({ showThinking: "no" }), /expected boolean/);
  assert.throws(() => store.write({ appearanceMode: "sepia" }), /expected one of automatic, light, dark/);
  assert.throws(() => store.write({ selectedThemeName: "bad/name" }), /no slash/);
  assert.throws(() => store.write({ sessionSettleDays: 0 }), /expected between 1 and 3650/);
  assert.throws(() => store.write({ sessionSettleDays: 30.5 }), /expected a whole number/);
  assert.throws(() => store.write({ modelOrder: ["not-an-identity"] }), /provider\/model-id/);

  await writeFile(store.path, "{not json");
  assert.match(store.read().problems[0], /not valid JSON/);
  assert.deepEqual(store.read().settings, defaultSettings());
  await writeFile(store.path, JSON.stringify({ compactTranscript: true, appearanceMode: "light", sessionSettleDays: 3651, extra: 1, showThinking: 3 }));
  const partial = store.read();
  assert.equal(partial.settings.compactTranscript, true);
  assert.equal(partial.settings.appearanceMode, "light");
  assert.equal(partial.settings.sessionSettleDays, 30);
  assert.equal(partial.settings.showThinking, true);
  assert.equal(partial.problems.length, 3);
  await writeFile(store.path, `{"compactTranscript":true,"pad":"${"x".repeat(LIMITS.maxSettingsFileBytes)}"}`);
  assert.match(store.read().problems[0], /exceeds/);
  assert.equal(store.read().settings.compactTranscript, false);
});

test("settings reads ignore malformed persisted modelOrder values and report each problem", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "qt-webui-model-order-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = createSettingsStore({ env: { XDG_CONFIG_HOME: home } });
  await mkdir(store.directory, { recursive: true });
  const malformedValues = [
    "provider/model",
    ["not-an-identity"],
    Array.from({ length: LIMITS.maxModels + 1 }, (_, index) => `provider/model-${index}`),
    [`${"p".repeat(LIMITS.maxProviderCharacters + 1)}/model`],
    [`provider/${"m".repeat(LIMITS.maxModelIdCharacters + 1)}`],
  ];
  for (const modelOrder of malformedValues) {
    await writeFile(store.path, JSON.stringify({ compactTranscript: true, modelOrder }));
    const result = store.read();
    assert.equal(result.settings.compactTranscript, true, "valid scalar settings must survive an invalid modelOrder");
    assert.deepEqual(result.settings.modelOrder, []);
    assert(result.problems.some((problem) => problem.startsWith("ignored modelOrder:")));
  }

  await writeFile(store.path, JSON.stringify({ modelOrder: ["provider/model", "provider/model", "provider/other"] }));
  const deduplicated = store.read();
  assert.deepEqual(deduplicated.settings.modelOrder, ["provider/model", "provider/other"]);
  assert.deepEqual(deduplicated.problems, []);
});

test("automatic settlement state uses exact elapsed thresholds, persistent restore grace, and hashed bounded metadata", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "qt-webui-auto-settlement-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dayMs = 24 * 60 * 60 * 1000;
  let clock = 2_000_000_000_000;
  const exactIdentity = "/private/sessions/exact.jsonl";
  const belowIdentity = "/private/sessions/below.jsonl";
  const newerIdentity = "/private/sessions/newer.jsonl";
  const rows = [
    { identity: exactIdentity, modified: clock - 30 * dayMs },
    { identity: belowIdentity, modified: clock - 30 * dayMs + 1 },
    { identity: newerIdentity, modified: clock - dayMs },
  ];
  const store = createStateStore({ directory, now: () => clock });

  let settled = store.reconcileAutomaticSessionSettlement(rows, { thresholdMs: 30 * dayMs, nowMs: clock });
  assert.equal(settled.has(sessionSettlementKey(exactIdentity)), true, "a session settles at the exact threshold");
  assert.equal(settled.has(sessionSettlementKey(belowIdentity)), false, "one millisecond below the threshold remains working");
  assert.equal(settled.has(sessionSettlementKey(newerIdentity)), false, "newer activity remains working");

  assert.equal(store.setSessionSettled(exactIdentity, false), false);
  const exactKey = sessionSettlementKey(exactIdentity);
  assert.equal(store.read().value.sessionRestoreGrace[exactKey], clock);
  const stateText = await readFile(store.path, "utf8");
  assert.equal(stateText.includes(exactIdentity), false, "settlement and restore-grace metadata never persist a session path");
  assert.match(exactKey, /^[0-9a-f]{64}$/);

  const restarted = createStateStore({ directory, now: () => clock });
  clock += 10 * dayMs - 1;
  settled = restarted.reconcileAutomaticSessionSettlement([rows[0]], { thresholdMs: 10 * dayMs, nowMs: clock });
  assert.equal(settled.has(exactKey), false, "restore grace survives restart until the current threshold");
  clock += 1;
  settled = restarted.reconcileAutomaticSessionSettlement([rows[0]], { thresholdMs: 10 * dayMs, nowMs: clock });
  assert.equal(settled.has(exactKey), true, "lowering the threshold changes existing grace and expires it exactly");
  assert.equal(restarted.read().value.sessionRestoreGrace[exactKey], undefined, "automatic settlement clears expired grace");

  restarted.setSessionSettled(exactIdentity, false);
  const restoredAt = clock;
  settled = restarted.reconcileAutomaticSessionSettlement([rows[0]], { thresholdMs: 30 * dayMs, nowMs: restoredAt - dayMs });
  assert.equal(settled.has(exactKey), false, "a backward wall-clock movement clamps elapsed grace to zero");
  assert.equal(restarted.read().value.sessionRestoreGrace[exactKey], restoredAt, "rollback protection keeps the original restoration timestamp");
  settled = restarted.reconcileAutomaticSessionSettlement([rows[0]], { thresholdMs: 30 * dayMs, nowMs: restoredAt + 30 * dayMs - 1 });
  assert.equal(settled.has(exactKey), false);
  settled = restarted.reconcileAutomaticSessionSettlement([rows[0]], { thresholdMs: 30 * dayMs, nowMs: restoredAt + 30 * dayMs });
  assert.equal(settled.has(exactKey), true, "grace expires at the exact threshold");
  restarted.setSessionSettled(exactIdentity, false);
  restarted.setSessionSettled(exactIdentity, true);
  assert.equal(restarted.read().value.sessionRestoreGrace[exactKey], undefined, "manual settlement clears grace");

  const malformed = validateState({ automaticSettledSessions: {}, sessionRestoreGrace: { bad: 1, [exactKey]: -1 } });
  assert.deepEqual(malformed.value.automaticSettledSessions, []);
  assert.deepEqual(malformed.value.sessionRestoreGrace, {});
  assert(malformed.problems.some((problem) => problem.includes("automaticSettledSessions must be an array")));
  assert(malformed.problems.some((problem) => problem.includes("invalid identity or timestamp")));
  const tooMany = Object.fromEntries(Array.from({ length: LIMITS.maxSessionRestoreGraceEntries + 2 }, (_, index) => [sessionSettlementKey(`/session/${index}`), index + 1]));
  assert.equal(Object.keys(validateState({ sessionRestoreGrace: tooMany }).value.sessionRestoreGrace).length, LIMITS.maxSessionRestoreGraceEntries);
  const tooManyAutomatic = Array.from({ length: LIMITS.maxAutomaticSettledSessions + 2 }, (_, index) => sessionSettlementKey(`/automatic/${index}`));
  assert.equal(validateState({ automaticSettledSessions: tooManyAutomatic }).value.automaticSettledSessions.length, LIMITS.maxAutomaticSettledSessions);
  assert.equal(validateState({ activeTab: -1 }).value.activeTab, -1, "the empty workspace selection is persisted");
  assert.equal(validateState({ activeTab: -2 }).value.activeTab, 0, "unknown negative selections retain legacy startup behavior");
});

test("automatic settlement has an independent bounded capacity and Restore clears both collections", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "qt-webui-auto-settlement-cap-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const nowMs = 2_000_000_000_000;
  const store = createStateStore({ directory, now: () => nowMs });
  const manualKeys = Array.from({ length: LIMITS.maxSettledSessions }, (_, index) => sessionSettlementKey(`/manual/${index}.jsonl`));
  store.update((state) => {
    state.settledSessions = manualKeys;
    return state;
  });

  const automaticIdentity = "/automatic/eligible.jsonl";
  let settled = store.reconcileAutomaticSessionSettlement([{ identity: automaticIdentity, modified: 0 }], { thresholdMs: 1, nowMs });
  const automaticKey = sessionSettlementKey(automaticIdentity);
  assert.equal(settled.has(automaticKey), true, "automatic aging still works when manual settlement is at capacity");
  assert.equal(store.read().value.settledSessions.length, LIMITS.maxSettledSessions, "automatic aging does not consume manual capacity");
  assert.deepEqual(store.read().value.automaticSettledSessions, [automaticKey]);

  store.update((state) => {
    state.settledSessions[0] = automaticKey;
    state.automaticSettledSessions = Array.from({ length: LIMITS.maxAutomaticSettledSessions }, (_, index) => sessionSettlementKey(`/automatic/cap-${index}.jsonl`));
    state.automaticSettledSessions[0] = automaticKey;
    return state;
  });
  assert.equal(store.setSessionSettled(automaticIdentity, false), false);
  let state = store.read().value;
  assert.equal(state.settledSessions.includes(automaticKey), false, "Restore removes the manual identity");
  assert.equal(state.automaticSettledSessions.includes(automaticKey), false, "Restore removes the automatic identity");
  assert.equal(state.sessionRestoreGrace[automaticKey], nowMs);

  const manualIdentity = "/manual/after-automatic-cap.jsonl";
  assert.equal(store.setSessionSettled(manualIdentity, true), true, "manual Settle can use its remaining slot while automatic metadata is at capacity");
  state = store.read().value;
  assert.equal(state.settledSessions.length, LIMITS.maxSettledSessions);
  assert.equal(state.automaticSettledSessions.length, LIMITS.maxAutomaticSettledSessions - 1);
  assert.throws(() => store.setSessionSettled("/manual/over-cap.jsonl", true), /at most 2048 sessions can be settled/);

  store.update((value) => {
    value.automaticSettledSessions.push(sessionSettlementKey("/automatic/refill.jsonl"));
    return value;
  });
  settled = store.reconcileAutomaticSessionSettlement([{ identity: "/automatic/over-cap.jsonl", modified: 0 }], { thresholdMs: 1, nowMs });
  assert.equal(settled.has(sessionSettlementKey("/automatic/over-cap.jsonl")), false, "automatic settlement remains bounded at its independent cap");
  const metadata = JSON.stringify(store.read().value);
  for (const sessionPath of [automaticIdentity, manualIdentity, "/automatic/over-cap.jsonl"]) assert.equal(metadata.includes(sessionPath), false);
});

test("settings directory falls back to ~/.config when XDG_CONFIG_HOME is relative or unset", async () => {
  const { settingsDirectory } = await import("../lib/backend/settings.mjs");
  assert.equal(settingsDirectory({ XDG_CONFIG_HOME: "relative/path" }), path.join(os.homedir(), ".config", "qt-webui"));
  assert.equal(settingsDirectory({}), path.join(os.homedir(), ".config", "qt-webui"));
});

// ---- process tree --------------------------------------------------------------------------

test("terminateProcessTree escalates from SIGTERM to SIGKILL after the grace period", async () => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.exitCode = null;
  child.signalCode = null;
  const signals = [];
  const result = terminateProcessTree(child, {
    graceMs: 20,
    signalImpl: (target, signal) => {
      signals.push(signal);
      if (signal === "SIGKILL" && child.exitCode === null) {
        child.exitCode = null;
        child.signalCode = "SIGKILL";
        queueMicrotask(() => child.emit("exit", null, "SIGKILL"));
      }
      return true;
    },
  });
  assert.deepEqual(await result, { escalated: true, alreadyExited: false });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL", "SIGKILL"]);
});

test("terminateProcessTree resolves immediately for an exited child and still sweeps the group", async () => {
  const child = new EventEmitter();
  child.pid = 1;
  child.exitCode = 0;
  child.signalCode = null;
  const signals = [];
  const result = await terminateProcessTree(child, { graceMs: 5, signalImpl: (_target, signal) => signals.push(signal) });
  assert.deepEqual(result, { escalated: false, alreadyExited: true });
  assert.deepEqual(signals, ["SIGKILL"]);
});
