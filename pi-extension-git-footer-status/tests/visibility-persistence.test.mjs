// Persistence coverage for /git-footer-visibility.
//
// Run with:
//   node --test pi-extension-git-footer-status/tests/visibility-persistence.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const testRoot = await mkdtemp(path.join(tmpdir(), "git-footer-visibility-"));
const settingsFile = path.join(testRoot, "agent", "git-footer-visibility.json");
process.env.PI_GIT_FOOTER_SETTINGS_FILE = settingsFile;
process.env.PI_GIT_FOOTER_FETCH = "0";

const envFlag = (name, fallback) => {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw);
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@firstpick/pi-utils") return { url: "virtual:pi-utils", shortCircuit: true };
    if (specifier === "@earendil-works/pi-tui") return { url: "virtual:pi-tui", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "virtual:pi-utils") {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export const collectInitialPromptCalibration = () => null;
          export const createInitialPromptEstimateService = () => ({
            refresh: async () => ({ status: "ok" }),
            getSnapshot: () => null,
            getFallbackSnapshot: () => null,
            clear: () => {},
          });
          export const envFlag = ${envFlag.toString()};
          export const normalizeTimestampMs = (timestamp) => timestamp < 1e11 ? timestamp * 1000 : timestamp > 1e14 ? Math.floor(timestamp / 1000) : timestamp;
          export const estimateStableInitialPromptFromPiContext = async () => null;
          export const estimateTokensFromCharCount = (chars) => Math.ceil(chars / 4);
          export const formatTokens = (n) => String(n);
          export const formatUserPath = (p) => String(p);
          export const pathExists = () => false;
        `,
      };
    }
    if (url === "virtual:pi-tui") {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export class Container {
            addChild() {}
            render() { return []; }
            invalidate() {}
          }
          export const Key = { ctrl: (key) => \`ctrl+\${key}\` };
          export const matchesKey = (data, key) => data === key;
          export class SettingsList {
            handleInput() {}
            render() { return []; }
            invalidate() {}
          }
          export const truncateToWidth = (s) => String(s);
          export const visibleWidth = (s) => String(s).length;
        `,
      };
    }
    return nextLoad(url, context);
  },
});

const extensionModule = await import("../index.ts");
const {
  default: gitFooterStatus,
  footerVisibilitySettingsFile,
  readFooterVisibilitySettings,
} = extensionModule;

const createHarness = (extension = gitFooterStatus) => {
  const commands = new Map();
  const notifications = [];
  const statuses = [];
  const pi = {
    on() {},
    registerCommand(name, command) {
      commands.set(name, command);
    },
    registerShortcut() {},
    exec() {
      return Promise.resolve({ code: 1, stdout: "", stderr: "not a git repository", killed: false });
    },
  };
  extension(pi);
  const ctx = {
    hasUI: true,
    mode: "rpc",
    cwd: testRoot,
    model: null,
    sessionManager: {
      getEntries: () => [],
      getSessionDir: () => testRoot,
      getSessionId: () => "visibility-test",
    },
    ui: {
      notify(message, level) {
        notifications.push({ message, level });
      },
      setStatus(key, value) {
        statuses.push({ key, value });
      },
    },
  };
  return {
    notifications,
    statuses,
    run(args) {
      const command = commands.get("git-footer-visibility");
      assert.ok(command, "git-footer-visibility command should be registered");
      return command.handler(args, ctx);
    },
  };
};

test.after(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

test("uses one global settings file under the Pi agent directory by default", () => {
  assert.equal(
    footerVisibilitySettingsFile({ PI_CODING_AGENT_DIR: path.join(testRoot, "custom-agent") }),
    path.join(testRoot, "custom-agent", "git-footer-visibility.json"),
  );
  assert.equal(
    footerVisibilitySettingsFile({ PI_GIT_FOOTER_SETTINGS_FILE: path.join(testRoot, "custom.json") }),
    path.join(testRoot, "custom.json"),
  );
});

test("malformed settings fall back once without disabling the extension", async () => {
  const malformedFile = path.join(testRoot, "malformed.json");
  await writeFile(malformedFile, "{not-json\n", "utf8");
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    const first = await readFooterVisibilitySettings(malformedFile);
    const second = await readFooterVisibilitySettings(malformedFile);
    assert.deepEqual(first.overrides, { all: {}, native: {}, webui: {} });
    assert.deepEqual(second.overrides, { all: {}, native: {}, webui: {} });
    assert.equal(warnings.length, 1, "repeated refreshes should not spam malformed-settings warnings");
    assert.match(warnings[0], /Ignoring malformed visibility settings/);
  } finally {
    console.warn = originalWarn;
  }
});

test("visibility commands persist normalized global overrides atomically", async () => {
  const harness = createHarness();
  await harness.run("hide webui cost context");

  const settings = await readFooterVisibilitySettings(settingsFile);
  assert.equal(settings.version, 1);
  assert.deepEqual(settings.overrides.webui, { cost: false, context: false });
  assert.deepEqual(settings.overrides.native, {});
  assert.match(await readFile(settingsFile, "utf8"), /"webui"/);
  assert.match(harness.notifications.at(-1)?.message ?? "", /saved globally/);

  await harness.run("reset webui cost");
  const resetSettings = await readFooterVisibilitySettings(settingsFile);
  assert.deepEqual(resetSettings.overrides.webui, { context: false });
});

test("a fresh extension instance reloads globally persisted visibility", async () => {
  const freshModule = await import(`../index.ts?visibility-restart=${Date.now()}`);
  const harness = createHarness(freshModule.default);
  await harness.run("status");

  const status = harness.notifications.at(-1)?.message ?? "";
  assert.match(status, /context: native=on, webui=off/);
  assert.match(status, /cost: native=on, webui=on/);
});
