import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createSettingsStore } from "../lib/backend/settings.mjs";
import {
  REQUIRED_THEME_TOKENS,
  SEMANTIC_PALETTE_ROLES,
  THEME_LIMITS,
  contrastRatio,
  createThemeService,
  mapThemePalette,
  parsePiTheme,
  resolveInstalledThemeResources,
  xtermColor,
} from "../lib/backend/themes.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function validTheme(name = "fixture", overrides = {}) {
  const colors = Object.fromEntries(REQUIRED_THEME_TOKENS.map((token) => [token, "fg"]));
  Object.assign(colors, {
    selectedBg: "bg", userMessageBg: "bg", customMessageBg: "bg", toolPendingBg: "bg", toolSuccessBg: "bg", toolErrorBg: "bg",
    text: "", userMessageText: "", customMessageText: "", mdCodeBlock: "", toolOutput: "",
  }, overrides);
  return {
    name,
    vars: { fg: "#777777", bg: "#777777", accent256: 39 },
    colors,
    export: { pageBg: "#777777" },
  };
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "qt-webui-themes-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const themePath = path.join(directory, "fixture.json");
  await writeFile(themePath, `${JSON.stringify(validTheme())}\n`);
  const settings = createSettingsStore({ directory: path.join(directory, "settings") });
  const resources = [{ path: themePath, enabled: true, metadata: { scope: "user" } }];
  return { directory, themePath, settings, resources };
}

test("Pi theme validation resolves variables, xterm colors, terminal defaults, and bounded schema fields", () => {
  const raw = validTheme("resolved", { accent: "accent256", warning: 232, error: "#Aa00Ff" });
  raw.extra = true;
  raw.colors.futureToken = "#000000";
  raw.export.backgroundImage = "url(ignored.png)";
  raw.export.backgroundOverlay = "linear-gradient(ignored)";
  raw.vars["surface/raised"] = "#112233";
  const parsed = parsePiTheme(raw);
  assert.equal(parsed.colors.accent, xtermColor(39));
  assert.equal(parsed.colors.warning, "#080808");
  assert.equal(parsed.colors.error, "#aa00ff");
  assert.equal(parsed.colors.text, null);
  assert.equal(parsed.colors.thinkingMax, parsed.colors.thinkingXhigh);
  assert.equal(parsed.colors.searchMatchBg, parsed.colors.selectedBg);
  assert.deepEqual(parsed.export, { pageBg: "#777777" }, "non-color HTML export fields are ignored rather than interpreted");
  assert.equal(parsed.colors.futureToken, undefined, "future Pi tokens do not invalidate known palette fields");
  assert.throws(() => parsePiTheme({ ...raw, name: "bad/name" }), /name must/);
  assert.throws(() => parsePiTheme({ ...raw, colors: { ...raw.colors, accent: "missing" } }), /unknown color variable/);
  const missing = structuredClone(raw);
  delete missing.colors.bashMode;
  assert.throws(() => parsePiTheme(missing), /missing required color bashMode/);
  const cyclic = validTheme("cycle", { accent: "a" });
  cyclic.vars.a = "b";
  cyclic.vars.b = "a";
  assert.throws(() => parsePiTheme(cyclic), /cycle/);
  const tooMany = validTheme("variables");
  tooMany.vars = Object.fromEntries(Array.from({ length: THEME_LIMITS.maxVariables + 1 }, (_, index) => [`v${index}`, "#000000"]));
  assert.throws(() => parsePiTheme(tooMany), /at most/);
});

test("palette mapping is deterministic, complete, and repairs every shared text surface plus indicators", () => {
  const raw = validTheme("adversarial-surfaces", {
    userMessageBg: "#ffffff",
    customMessageBg: "#777777",
    selectedBg: "#eeeeee",
    text: "#888888",
    mdHeading: "#999999",
    muted: "#aaaaaa",
    accent: "#bbbbbb",
    mdLink: "#cccccc",
  });
  raw.export.pageBg = "#000000";
  const theme = parsePiTheme(raw);
  const first = mapThemePalette(theme);
  const second = mapThemePalette(theme);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first.palette).sort(), [...SEMANTIC_PALETTE_ROLES].sort());
  for (const value of Object.values(first.palette)) assert.match(value, /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i);
  assert.equal(first.palette.dialogOverlay, "#99000000", "QML overlays retain alpha instead of becoming opaque surfaces");
  const sharedForegrounds = ["foreground", "heading", "muted", "accentForeground", "link", "buttonForeground"];
  const sharedBackgrounds = [
    "mainSurface", "sidebarSurface", "panelSurface", "windowBackground", "surface", "surfaceRaised", "assistantBubble", "userBubble",
    "controlSurface", "controlHover", "controlPressed", "controlActive", "controlSelected", "composerSurface", "searchHighlight",
  ];
  for (const foreground of sharedForegrounds) {
    for (const background of sharedBackgrounds) {
      assert(contrastRatio(first.palette[foreground], first.palette[background]) >= 4.5, `${foreground} remains readable on ${background}`);
    }
  }
  assert(contrastRatio(first.palette.selectionForeground, first.palette.selection) >= 4.5);
  assert(contrastRatio(first.palette.selectionForeground, first.palette.controlSelected) >= 4.5, "selected picker text stays readable on its actual row fill");
  assert(contrastRatio(first.palette.focusRing, first.palette.windowBackground) >= 3);
  assert(first.diagnostics.some((entry) => entry.code === "contrast_repaired"));
});

test("the bundled Catppuccin theme parses while non-color HTML export fields stay inert", async () => {
  const bundlePath = path.resolve(packageRoot, "..", "pi-package-themes-bundle", "themes", "catppuccin-mocha.json");
  const parsed = parsePiTheme(JSON.parse(await readFile(bundlePath, "utf8")));
  assert.equal(parsed.name, "catppuccin-mocha");
  assert.equal(parsed.export.pageBg, "#11111b");
  assert.equal(Object.hasOwn(parsed.export, "backgroundImage"), false);
  assert.equal(mapThemePalette(parsed).palette.windowBackground, "#11111b");
});

test("public Pi discovery mirrors saved/default trust and always skips missing packages", async () => {
  const scenarios = [
    { saved: null, fallback: "always", expected: true },
    { saved: null, fallback: "ask", expected: false },
    { saved: null, fallback: "never", expected: false },
    { saved: true, fallback: "never", expected: true },
    { saved: false, fallback: "always", expected: false },
  ];
  for (const scenario of scenarios) {
    const creates = [];
    let missingAction = "";
    class FakeSettings {
      static create(_cwd, _agentDir, options) {
        creates.push(options);
        return { getDefaultProjectTrust: () => scenario.fallback };
      }
    }
    class FakeTrust { get() { return scenario.saved; } }
    class FakePackages {
      constructor(options) { this.options = options; }
      async resolve(onMissing) {
        missingAction = await onMissing("npm:missing-package");
        return { themes: [{ path: "/installed/theme.json", enabled: true, metadata: { scope: "user" } }] };
      }
    }
    const result = await resolveInstalledThemeResources({
      cwd: "/project", agentDir: "/agent", SettingsManagerClass: FakeSettings, ProjectTrustStoreClass: FakeTrust, PackageManagerClass: FakePackages,
    });
    assert.equal(result.projectTrusted, scenario.expected);
    assert.equal(creates.at(-1).projectTrusted, scenario.expected);
    assert.equal(missingAction, "skip", "missing packages must never be installed or repaired");
  }
});

test("catalog filters untrusted project resources, keeps first duplicate, bounds diagnostics, and omits source paths", async (t) => {
  const { directory, settings } = await fixture(t);
  const globalPath = path.join(directory, "global.json");
  const duplicatePath = path.join(directory, "duplicate.json");
  const projectPath = path.join(directory, "project.json");
  const invalidPath = path.join(directory, "private-invalid-location.json");
  await writeFile(globalPath, JSON.stringify(validTheme("same", { accent: "#112233" })));
  await writeFile(duplicatePath, JSON.stringify(validTheme("same", { accent: "#abcdef" })));
  await writeFile(projectPath, JSON.stringify(validTheme("project-only")));
  await writeFile(invalidPath, "{not-json");
  const service = createThemeService({
    cwd: directory,
    settingsStore: settings,
    resolveResources: async () => ({ projectTrusted: false, resources: [
      { path: globalPath, enabled: true, metadata: { scope: "user" } },
      { path: duplicatePath, enabled: true, metadata: { scope: "user" } },
      { path: projectPath, enabled: true, metadata: { scope: "project" } },
      { path: invalidPath, enabled: true, metadata: { scope: "user" } },
    ] }),
  });
  t.after(() => service.stop());
  const state = await service.refresh();
  assert(state.inventory.some((entry) => entry.identity.kind === "external" && entry.identity.name === "same"));
  assert(!state.inventory.some((entry) => entry.identity.name === "project-only"));
  assert(state.diagnostics.some((entry) => entry.code === "duplicate_theme"));
  assert(state.diagnostics.length <= THEME_LIMITS.maxDiagnostics);
  assert(!JSON.stringify(state).includes(directory), "published state must not contain source paths");
  await service.select({ kind: "external", name: "same" });
  assert.equal(service.snapshot().palette.accent, "#112233", "resolved resource order determines duplicate precedence");
});

test("selection persists app-locally, typed names do not collide, and unavailable themes retain intent through fallback and recovery", async (t) => {
  const { themePath, settings, resources } = await fixture(t);
  const service = createThemeService({ settingsStore: settings, resolveResources: async () => ({ resources, projectTrusted: true }) });
  t.after(() => service.stop());
  await service.refresh();
  let selected = await service.select({ kind: "external", name: "fixture" });
  assert.deepEqual(selected.requested, { kind: "external", name: "fixture" });
  assert.deepEqual(selected.effective, { kind: "external", name: "fixture" });
  assert(selected.palette);
  assert.equal(settings.read().settings.selectedThemeName, "fixture");
  assert.equal(settings.read().settings.appearanceMode, "automatic");

  await rm(themePath);
  selected = await service.refresh();
  assert.deepEqual(selected.requested, { kind: "external", name: "fixture" });
  assert.deepEqual(selected.effective, { kind: "builtin", name: "automatic" });
  assert.equal(selected.fallbackReason, "requested_theme_unavailable");
  assert.equal(selected.palette, null);

  await writeFile(themePath, JSON.stringify(validTheme("fixture")));
  selected = await service.refresh();
  assert.deepEqual(selected.effective, { kind: "external", name: "fixture" });
  assert(selected.palette, "restoring a valid theme reapplies the retained request");

  const colliding = path.join(path.dirname(themePath), "light.json");
  await writeFile(colliding, JSON.stringify(validTheme("light")));
  resources.push({ path: colliding, enabled: true, metadata: { scope: "user" } });
  await service.refresh();
  await service.select({ kind: "external", name: "light" });
  assert.deepEqual(service.snapshot().requested, { kind: "external", name: "light" });
  await service.select({ kind: "builtin", name: "light" });
  assert.deepEqual(service.snapshot().requested, { kind: "builtin", name: "light" });
  assert.equal(settings.read().settings.selectedThemeName, "");
  assert.equal(settings.read().settings.appearanceMode, "light");
});

test("a failed settings write leaves the stable theme snapshot and event stream unchanged", async (t) => {
  const { resources } = await fixture(t);
  const settings = {
    read: () => ({ settings: { appearanceMode: "automatic", selectedThemeName: "" } }),
    write: () => { throw new Error("settings write failed"); },
  };
  const changes = [];
  const service = createThemeService({
    settingsStore: settings,
    resolveResources: async () => ({ resources, projectTrusted: true }),
    onChange: (state) => changes.push(state),
  });
  t.after(() => service.stop());
  await service.refresh();
  const before = service.snapshot();
  await assert.rejects(service.select({ kind: "builtin", name: "dark" }), /settings write failed/);
  assert.strictEqual(service.snapshot(), before);
  assert.deepEqual(changes, []);
});

test("refreshes serialize generations and active directory watchers are replaced and cleaned up", async (t) => {
  const { directory, themePath, settings, resources } = await fixture(t);
  const watches = [];
  const watch = (watchedPath, _options, callback) => {
    const handle = new EventEmitter();
    handle.path = watchedPath;
    handle.callback = callback;
    handle.closed = false;
    handle.close = () => { handle.closed = true; };
    watches.push(handle);
    return handle;
  };
  let calls = 0;
  let release;
  const firstGate = new Promise((resolve) => { release = resolve; });
  const service = createThemeService({
    settingsStore: settings,
    watch,
    resolveResources: async () => {
      calls += 1;
      if (calls === 1) await firstGate;
      return { resources, projectTrusted: true };
    },
  });
  t.after(() => service.stop());
  const first = service.refresh();
  const second = service.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1, "a second generation waits for the active discovery");
  release();
  const [stateOne, stateTwo] = await Promise.all([first, second]);
  assert.equal(stateOne.generation, 1);
  assert.equal(stateTwo.generation, 2);
  await service.select({ kind: "external", name: "fixture" });
  assert.equal(watches.length, 1);
  assert.equal(watches[0].path, directory);
  assert.equal(watches[0].closed, false);
  service.stop();
  assert.equal(watches[0].closed, true);
  assert.equal(path.dirname(themePath), directory);
});

test("theme files and catalog diagnostics remain bounded", async (t) => {
  const { directory, settings } = await fixture(t);
  const oversized = path.join(directory, "oversized.json");
  await writeFile(oversized, "x".repeat(THEME_LIMITS.maxThemeFileBytes + 1));
  const resources = Array.from({ length: THEME_LIMITS.maxDiagnostics + 20 }, () => ({ path: oversized, enabled: true, metadata: { scope: "user" } }));
  const service = createThemeService({ settingsStore: settings, resolveResources: async () => ({ resources, projectTrusted: true }) });
  t.after(() => service.stop());
  const state = await service.refresh();
  assert.equal(state.diagnostics.length, THEME_LIMITS.maxDiagnostics);
  assert(state.diagnostics.every((entry) => entry.message.length <= THEME_LIMITS.maxDiagnosticCharacters));
  assert(!JSON.stringify(state.diagnostics).includes(oversized));
});
