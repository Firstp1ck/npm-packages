import assert from "node:assert/strict";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REQUIRED_THEME_TOKENS } from "../lib/backend/themes.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 120_000,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`,
  );
  return result;
}

function packedTheme(name) {
  const backgrounds = new Set(["selectedBg", "userMessageBg", "customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg"]);
  const colors = Object.fromEntries(REQUIRED_THEME_TOKENS.map((token) => [token, backgrounds.has(token) ? "bg" : "fg"]));
  return {
    name,
    vars: { bg: "#202020", fg: "#f0f0f0" },
    colors,
    export: { pageBg: "#101010", backgroundImage: "url(ignored.png)", backgroundOverlay: "linear-gradient(ignored)" },
  };
}

function packedFilename(stdout) {
  const parsed = JSON.parse(stdout);
  const record = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  assert.equal(typeof record?.filename, "string", "npm pack JSON should include a filename");
  return record.filename;
}

test("packed package installs in isolation and resolves packaged paths", { timeout: 180_000 }, async (t) => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "qt-webui-packed-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));

  const artifacts = path.join(workspace, "artifacts");
  const fakePiRoot = path.join(workspace, "fake-pi");
  const fakeWebuiRoot = path.join(workspace, "fake-webui");
  const installRoot = path.join(workspace, "install");
  const fakeBin = path.join(workspace, "bin");
  await mkdir(path.join(fakePiRoot, "dist", "bundle"), { recursive: true });
  await mkdir(path.join(fakeWebuiRoot, "lib"), { recursive: true });
  await mkdir(artifacts, { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  await writeFile(path.join(fakePiRoot, "package.json"), JSON.stringify({
    name: "@earendil-works/pi-coding-agent",
    version: "0.84.3",
    type: "module",
    main: "dist/index.js",
    bin: { pi: "dist/bundle/cli.js" },
  }));
  await writeFile(path.join(fakePiRoot, "dist", "index.js"), `
import { readFile } from "node:fs/promises";
import path from "node:path";
export function getAgentDir() { return process.env.PI_CODING_AGENT_DIR; }
export class SettingsManager {
  static create(cwd, agentDir, options) { return { cwd, agentDir, options, getDefaultProjectTrust: () => "ask" }; }
}
export class ProjectTrustStore { get() { return null; } }
export class DefaultPackageManager {
  constructor(options) { this.options = options; }
  async resolve(onMissing) {
    if (await onMissing("npm:missing-theme-package") !== "skip") throw new Error("theme discovery attempted package repair");
    const packageRoot = process.env.QT_WEBUI_PACKED_THEME_PACKAGE;
    const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
    return { themes: manifest.pi.themes.map((entry) => ({ path: path.resolve(packageRoot, entry), enabled: true, metadata: { scope: "user" } })) };
  }
}
`);
  await writeFile(path.join(fakePiRoot, "dist", "bundle", "cli.js"), "#!/usr/bin/env node\n");

  await writeFile(path.join(fakeWebuiRoot, "package.json"), JSON.stringify({
    name: "@firstpick/pi-package-webui",
    version: "0.9.9",
    type: "module",
    files: ["lib"],
  }));
  await writeFile(path.join(fakeWebuiRoot, "lib", "resource-selection.mjs"), `
+const names = value => Array.isArray(value) ? [...new Set(value.filter(item => typeof item === "string" && item))] : null;
+export function exactModelProfile(defaults, provider, modelId) { return (defaults.modelProfiles || []).find(profile => profile.provider === provider && profile.modelId === modelId) || null; }
+export function preserveUnavailableResourceNames(previous, visible, selected) {
+  const visibleSet = new Set(names(visible) || []);
+  return names([...(names(selected) || []), ...(names(previous) || []).filter(name => !visibleSet.has(name))]) || [];
+}
+export function setExactModelProfile(defaults, provider, modelId, type, selected) {
+  const key = type === "tools" ? "enabledTools" : "enabledSkills";
+  const profiles = structuredClone(defaults.modelProfiles || []);
+  let index = profiles.findIndex(profile => profile.provider === provider && profile.modelId === modelId);
+  const profile = index >= 0 ? profiles[index] : { provider, modelId, tools: { enabledTools: null }, skills: { enabledSkills: null } };
+  profile[type][key] = names(selected);
+  if (profile.tools.enabledTools === null && profile.skills.enabledSkills === null) { if (index >= 0) profiles.splice(index, 1); }
+  else if (index >= 0) profiles[index] = profile;
+  else profiles.push(profile);
+  return profiles;
+}
+export function branchResourceDirective(data, type) {
+  if (data?.version === 2 && data?.mode === "inherit") return { pinned: false, names: null, legacyDisabledNames: null };
+  const selected = names(data?.[type === "tools" ? "enabledTools" : "enabledSkills"]);
+  if (selected !== null) return { pinned: true, names: selected, legacyDisabledNames: null };
+  const disabled = type === "skills" ? names(data?.disabledSkills) : null;
+  return disabled !== null ? { pinned: true, names: null, legacyDisabledNames: disabled } : { pinned: false, names: null, legacyDisabledNames: null };
+}
+`.replace(/^\+/gm, ""));
+  await writeFile(path.join(fakeWebuiRoot, "lib", "git-workflow-preferences.mjs"), `
+import { mkdir, readFile, writeFile } from "node:fs/promises";
+import os from "node:os";
+import path from "node:path";
+const empty = () => ({ version: 8, resourceDefaults: { tools: { enabledTools: null }, skills: { enabledSkills: null }, modelProfiles: [] } });
+export function webuiSettingsFile(env = process.env) { return env.PI_WEBUI_SETTINGS_FILE || path.join(os.homedir(), ".pi", "webui", "settings.json"); }
+export async function readWebuiSettings(file = webuiSettingsFile()) { try { return { ...empty(), ...JSON.parse(await readFile(file, "utf8")) }; } catch (error) { if (error.code === "ENOENT") return empty(); throw error; } }
+export async function updateWebuiSettings(updater, file = webuiSettingsFile()) {
+  const current = await readWebuiSettings(file);
+  const patch = await updater(current);
+  if (patch === undefined) return current;
+  const next = { ...current, ...patch, resourceDefaults: patch.resourceDefaults ? { ...current.resourceDefaults, ...patch.resourceDefaults } : current.resourceDefaults };
+  await mkdir(path.dirname(file), { recursive: true });
+  await writeFile(file, JSON.stringify(next));
+  return next;
+}
+`.replace(/^\+/gm, ""));

  const fakePiPack = run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", artifacts], { cwd: fakePiRoot });
  const fakePiTarball = path.join(artifacts, packedFilename(fakePiPack.stdout));
  const fakeWebuiPack = run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", artifacts], { cwd: fakeWebuiRoot });
  const fakeWebuiTarball = path.join(artifacts, packedFilename(fakeWebuiPack.stdout));
  const packagePack = run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", artifacts], { cwd: packageRoot });
  const packageTarball = path.join(artifacts, packedFilename(packagePack.stdout));

  run("npm", ["install", "--prefix", installRoot, "--ignore-scripts", "--no-audit", "--no-fund", fakePiTarball, fakeWebuiTarball]);
  run("npm", ["install", "--prefix", installRoot, "--ignore-scripts", "--no-audit", "--no-fund", "--offline", packageTarball]);

  const fakeQuickshell = path.join(fakeBin, "quickshell");
  await cp(path.join(packageRoot, "tests", "fixtures", "fake-quickshell.mjs"), fakeQuickshell);
  await chmod(fakeQuickshell, 0o755);

  const capturePath = path.join(workspace, "capture.json");
  const installedBinDirectory = path.join(installRoot, "node_modules", ".bin");
  const invocation = run("qt-webui", ["dev"], {
    cwd: workspace,
    env: {
      ...process.env,
      PATH: `${installedBinDirectory}${path.delimiter}${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      FAKE_QUICKSHELL_CAPTURE_PATH: capturePath,
    },
  });
  assert.equal(invocation.stderr, "");

  const capture = JSON.parse(await readFile(capturePath, "utf8"));
  const installedPackageRoot = path.join(installRoot, "node_modules", "@firstpick", "pi-package-qt-webui");
  const installedWebuiRoot = path.join(installRoot, "node_modules", "@firstpick", "pi-package-webui");
  const installedWebuiManifest = JSON.parse(await readFile(path.join(installedWebuiRoot, "package.json"), "utf8"));
  assert.equal(installedWebuiManifest.name, "@firstpick/pi-package-webui", "the canonical resource owner installs with the packed Qt package");
  const installedResources = await import(pathToFileURL(path.join(installedPackageRoot, "lib", "backend", "resources.mjs")));
  const resourceDirectory = path.join(workspace, "resource-probe");
  const sharedSettingsPath = path.join(workspace, "shared-webui-settings.json");
  const resourceStore = installedResources.createResourceStore({ directory: resourceDirectory, sharedPath: sharedSettingsPath });
  assert.equal((await resourceStore.read()).sharedPath, sharedSettingsPath, "the packed resource adapter resolves and uses Pi Web UI's shipped modules");
  const expectedQmlEntry = path.join(installedPackageRoot, "qml", "shell.qml");
  const expectedPiEntry = path.join(installRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
  const installedReadme = await readFile(path.join(installedPackageRoot, "README.md"), "utf8");
  assert.match(installedReadme, /\(screenshots\/session-settlement\.png\)/, "the packed README should reference the session screenshot");
  const installedScreenshot = await readFile(path.join(installedPackageRoot, "screenshots", "session-settlement.png"));
  assert.deepEqual([...installedScreenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "the packed screenshot should have a PNG signature");
  assert.deepEqual(capture.argv, ["--path", expectedQmlEntry]);
  assert.equal(capture.cwd, workspace);
  assert.equal(capture.env.QT_WEBUI_CALLER_CWD, workspace);
  assert.equal(capture.env.QT_WEBUI_QML_ENTRY, expectedQmlEntry);
  assert.equal(capture.env.QT_WEBUI_BACKEND_ENTRY, path.join(installedPackageRoot, "lib", "backend", "main.mjs"));
  assert.equal(capture.env.QT_WEBUI_PI_CLI_ENTRY, expectedPiEntry);
  assert.equal(capture.env.QT_WEBUI_DEVELOPMENT_MODE, "1");
  assert.equal(capture.env.QT_WEBUI_NODE_EXECUTABLE, process.execPath);

  const themePackage = path.join(installRoot, "node_modules", "packed-theme-fixture");
  const themeDirectory = path.join(themePackage, "themes");
  const extensionMarker = path.join(workspace, "extension-ran");
  await mkdir(path.join(themePackage, "extensions"), { recursive: true });
  await mkdir(themeDirectory, { recursive: true });
  await writeFile(path.join(themePackage, "package.json"), JSON.stringify({
    name: "packed-theme-fixture",
    version: "1.0.0",
    type: "module",
    pi: { themes: ["./themes"], extensions: ["./extensions/should-not-run.mjs"] },
  }));
  await writeFile(path.join(themeDirectory, "packed-bundle.json"), JSON.stringify(packedTheme("packed-bundle")));
  await writeFile(path.join(themePackage, "extensions", "should-not-run.mjs"), `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(extensionMarker)}, "ran");\n`);

  const themeProbe = `
    const module = await import(${JSON.stringify(pathToFileURL(path.join(installedPackageRoot, "lib", "backend", "themes.mjs")).href)});
    const settings = { read: () => ({ settings: { appearanceMode: "automatic", selectedThemeName: "" } }), write: () => { throw new Error("unexpected write"); } };
    const service = module.createThemeService({ cwd: process.cwd(), settingsStore: settings });
    const state = await service.refresh();
    service.stop();
    process.stdout.write(JSON.stringify(state));
  `;
  const discovered = run(process.execPath, ["--input-type=module", "--eval", themeProbe], {
    cwd: workspace,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: path.join(workspace, "agent"),
      QT_WEBUI_PACKED_THEME_PACKAGE: themePackage,
    },
  });
  const themeState = JSON.parse(discovered.stdout);
  assert(themeState.inventory.some((entry) => entry.identity.kind === "external" && entry.identity.name === "packed-bundle"));
  assert.equal(themeState.diagnostics.some((entry) => entry.code === "invalid_theme"), false, "inert HTML export fields remain compatible");
  await assert.rejects(readFile(extensionMarker), /ENOENT/, "theme discovery never executes package extensions");
});
