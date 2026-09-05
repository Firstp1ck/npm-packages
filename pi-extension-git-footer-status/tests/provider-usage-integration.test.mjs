// Integration test for provider usage footer rendering (WS2).
//
// Drives ../index.ts with a fake ExtensionAPI/ExtensionContext, captures
// after_provider_response events, and asserts native + WebUI Usage rendering
// for Codex and Anthropic OAuth, plus hiding for API-key Anthropic, unrelated
// providers, stale-provider snapshots, and malformed headers.
//
// Run with:
//   node --experimental-strip-types --test tests/provider-usage-integration.test.mjs
//
// Requires Node >= 23.6 (type stripping + module.registerHooks). Runtime
// imports are stubbed as virtual modules like tests/stale-ctx.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const settingsModuleUrl = new URL("core/settings-manager.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href;

// Module-level constants in ../index.ts read these at import time.
process.env.PI_GIT_FOOTER_AUTO_REFRESH_MS = "0";
process.env.PI_GIT_FOOTER_FETCH = "0";
process.env.PI_GIT_FOOTER_DISABLE_PROMPT_ESTIMATE = "1";
process.env.PI_GIT_FOOTER_SETTINGS_FILE = "/tmp/git-footer-visibility-test-nonexistent.json";

const envFlag = (name, fallback) => {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw);
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@earendil-works/pi-coding-agent") return { url: "virtual:pi-coding-agent", shortCircuit: true };
    if (specifier === "@firstpick/pi-utils") return { url: "virtual:pi-utils", shortCircuit: true };
    if (specifier === "@earendil-works/pi-tui") return { url: "virtual:pi-tui", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "virtual:pi-coding-agent") {
      return { format: "module", shortCircuit: true, source: `export { SettingsManager } from ${JSON.stringify(settingsModuleUrl)};` };
    }
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
            children = [];
            addChild(component) { this.children.push(component); }
            render(width) { return this.children.flatMap((component) => component.render?.(width) ?? []); }
            invalidate() { for (const component of this.children) component.invalidate?.(); }
          }
          export const Key = { ctrl: (key) => \`ctrl+\${key}\` };
          export const matchesKey = (data, key) => data === key;
          export class SettingsList {
            constructor() {}
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

const { default: gitFooterStatus } = await import("../index.ts");

const WEBUI_STATUS_KEY = "git-footer-webui";

const createHarness = () => {
  const state = {
    model: { id: "gpt-5.5", provider: "openai-codex", contextWindow: 272000, reasoning: true },
    usingOAuth: true,
    projectTrusted: true,
    notifications: [],
    setStatusCalls: [],
    footerFactory: null,
  };
  const handlers = new Map();
  const pi = {
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand() {},
    registerShortcut() {},
    getThinkingLevel: () => "low",
    exec: () => Promise.resolve({ code: 0, stdout: "", stderr: "", killed: false }),
  };
  const ui = {
    setStatus: (key, value) => state.setStatusCalls.push([key, value]),
    setFooter: (factory) => { state.footerFactory = factory; },
    notify: (message, level) => state.notifications.push({ message, level }),
    theme: { fg: (_tone, text) => text, bold: (text) => text },
  };
  const sessionManager = {
    getSessionDir: () => "/tmp/fake-session-dir",
    getEntries: () => [],
    getSessionId: () => "fake-session",
  };
  const ctx = {
    hasUI: true,
    cwd: process.cwd(),
    ui,
    sessionManager,
    modelRegistry: { isUsingOAuth: () => state.usingOAuth },
    isProjectTrusted: () => state.projectTrusted,
    getContextUsage: () => null,
  };
  Object.defineProperty(ctx, "model", { get: () => state.model });
  const emit = async (event, evt) => {
    for (const handler of handlers.get(event) ?? []) await handler(evt, ctx);
  };
  return { state, pi, ctx, emit };
};

const lastWebuiPayload = (state) => {
  const calls = state.setStatusCalls.filter(([key]) => key === WEBUI_STATUS_KEY);
  const last = calls[calls.length - 1];
  return last?.[1] ? JSON.parse(last[1]) : null;
};

const usageChip = (payload) =>
  payload?.main?.find((chip) => chip.key === "usage") ??
  payload?.meta?.find((chip) => chip.key === "usage");

const nativeLines = (state, ctx, extensionStatuses = new Map()) => {
  assert.ok(state.footerFactory, "expected a native footer to be registered");
  const theme = { fg: (_tone, text) => text, bold: (text) => text };
  const tui = { requestRender: () => {} };
  const footerData = {
    onBranchChange: () => () => {},
    getGitBranch: () => "main",
    getAvailableProviderCount: () => 1,
    getExtensionStatuses: () => extensionStatuses,
  };
  const component = state.footerFactory(tui, theme, footerData);
  return component.render(400);
};

const startSession = async (harness) => {
  gitFooterStatus(harness.pi);
  await harness.emit("session_start", {});
};

test("Codex Auto startup warning respects saved settings, auth, UI, and lifecycle", async (t) => {
  const cases = [
    { name: "default Auto on startup", warn: true },
    { name: "explicit Auto on new session", global: { transport: "auto" }, reason: "new", warn: true },
    { name: "SSE", global: { transport: "sse" } },
    { name: "WebSocket", global: { transport: "websocket" } },
    { name: "cached WebSocket", global: { transport: "websocket-cached" } },
    { name: "trusted project SSE overrides global Auto", global: { transport: "auto" }, project: { transport: "sse" } },
    { name: "trusted project Auto overrides global SSE", global: { transport: "sse" }, project: { transport: "auto" }, warn: true },
    { name: "untrusted project ignored", global: { transport: "auto" }, project: { transport: "sse" }, trusted: false, warn: true },
    { name: "malformed global settings", rawGlobal: "{" },
    { name: "malformed trusted project", global: { transport: "auto" }, rawProject: "{" },
    { name: "non-OAuth Codex", oauth: false },
    { name: "other provider", provider: "anthropic" },
    { name: "no active model", noModel: true },
    { name: "no UI", hasUI: false },
    { name: "reload", reason: "reload" },
    { name: "resume", reason: "resume" },
    { name: "fork", reason: "fork" },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const root = await mkdtemp(join(tmpdir(), "git-footer-transport-"));
      const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
      const harness = createHarness();
      const files = [];
      try {
        const agentDir = join(root, "agent");
        const cwd = join(root, "project");
        await mkdir(agentDir);
        await mkdir(join(cwd, ".pi"), { recursive: true });
        process.env.PI_CODING_AGENT_DIR = agentDir;
        for (const [path, value, raw] of [
          [join(agentDir, "settings.json"), scenario.global, scenario.rawGlobal],
          [join(cwd, ".pi", "settings.json"), scenario.project, scenario.rawProject],
        ]) {
          if (value === undefined && raw === undefined) continue;
          const contents = raw ?? JSON.stringify(value);
          await writeFile(path, contents);
          files.push([path, contents]);
        }
        harness.ctx.cwd = cwd;
        harness.ctx.hasUI = scenario.hasUI ?? true;
        harness.state.usingOAuth = scenario.oauth ?? true;
        harness.state.projectTrusted = scenario.trusted ?? true;
        if (scenario.noModel) harness.state.model = undefined;
        else harness.state.model.provider = scenario.provider ?? "openai-codex";
        gitFooterStatus(harness.pi);
        await harness.emit("session_start", { reason: scenario.reason ?? "startup" });
        assert.equal(harness.state.notifications.length, scenario.warn ? 1 : 0);
        if (scenario.warn) {
          assert.equal(harness.state.notifications[0].level, "warning");
          assert.match(harness.state.notifications[0].message, /weekly usage.*select SSE transport in \/settings/);
          await harness.emit("model_select", {});
          await harness.emit("after_provider_response", { status: 200, headers: {} });
          assert.equal(harness.state.notifications.length, 1, "no repeated warnings during requests or model changes");
        }
        if (harness.ctx.hasUI) assert.ok(harness.state.footerFactory, "settings failures must not block footer startup");
        for (const [path, contents] of files) assert.equal(await readFile(path, "utf8"), contents);
      } finally {
        await harness.emit("session_shutdown", {});
        if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

const CODEX_HEADERS = {
  "x-codex-primary-used-percent": "29",
  "x-codex-primary-window-minutes": "10080",
  "x-codex-primary-reset-at": "1760000000",
  "x-codex-secondary-used-percent": "0",
  "x-codex-secondary-window-minutes": "10080",
  "x-codex-secondary-reset-after-seconds": "7200",
  "x-codex-plan-type": "plus",
};

const ANTHROPIC_HEADERS = {
  "anthropic-ratelimit-unified-5h-utilization": "0.4",
  "anthropic-ratelimit-unified-5h-reset": "2026-01-02T03:04:05.000Z",
  "anthropic-ratelimit-unified-7d-utilization": "0.9",
  "anthropic-ratelimit-unified-7d-reset": "1760000000",
};

test("native footer suppresses the cd extension's duplicate cwd status", async () => {
  const harness = createHarness();
  await startSession(harness);

  const lines = nativeLines(harness.state, harness.ctx, new Map([
    ["cd-history", `cwd ${harness.ctx.cwd}`],
    ["codex-fast-mode", "Fast-mode: off"],
  ])).join("\n");

  assert.doesNotMatch(lines, /cwd /u, "the native footer already renders cwd as its leading path");
  assert.match(lines, /Fast-mode: off/u, "unrelated extension statuses must remain visible");

  await harness.emit("session_shutdown", {});
});

test("native footer labels bare Codex fast-mode states without changing status data", async () => {
  const harness = createHarness();
  await startSession(harness);

  try {
    for (const value of ["off", "on"]) {
      const statuses = new Map([
        ["codex-fast-mode", value],
        ["other-extension", "Other status"],
      ]);
      const lines = nativeLines(harness.state, harness.ctx, statuses).join("\n");
      assert.ok(lines.includes(`Codex fast: ${value}`));
      assert.ok(lines.includes("Other status"));
      assert.equal(statuses.get("codex-fast-mode"), value);
    }

    const labeled = nativeLines(harness.state, harness.ctx, new Map([
      ["codex-fast-mode", "Fast-mode: off"],
    ])).join("\n");
    assert.ok(labeled.includes("Fast-mode: off"));
    assert.ok(!labeled.includes("Codex fast: Fast-mode:"));
  } finally {
    await harness.emit("session_shutdown", {});
  }
});

test("openai-codex: captures usage and renders native segment and WebUI Usage chip", async () => {
  const harness = createHarness();
  await startSession(harness);

  await harness.emit("after_provider_response", { status: 200, headers: CODEX_HEADERS });

  const payload = lastWebuiPayload(harness.state);
  const chip = usageChip(payload);
  assert.ok(chip, "expected a WebUI usage chip after a Codex response");
  assert.equal(payload.version, 1, "structured usage metadata must preserve payload version 1");
  assert.equal(chip.label, "Usage");
  assert.equal(chip.value, "weekly 29% · weekly 0%");
  assert.deepEqual(chip.usageWindows, { primaryPercent: 29, secondaryPercent: 0 });
  assert.equal(payload.providerUsage.provider, "openai-codex");
  assert.ok(Number.isFinite(payload.providerUsage.capturedAt), "structured provider usage should carry its response-capture timestamp");
  assert.deepEqual(payload.providerUsage.primary, {
    label: "weekly",
    usedPercent: 29,
    windowMinutes: 10080,
    resetAt: 1760000000000,
  });
  assert.match(chip.title, /plan plus/);
  assert.match(chip.title, /weekly window: 29% used/);
  assert.match(chip.title, /weekly window: 0% used/);
  assert.match(chip.title, /resets 2025-10-09T/);
  assert.match(chip.title, /resets in 2h/);

  const lines = nativeLines(harness.state, harness.ctx).join("\n");
  assert.match(lines, /weekly 29% · weekly 0%/, "native footer should use Codex window metadata instead of fixed labels");

  await harness.emit("session_shutdown", {});
});

test("openai-codex: renders a valid partial usage response instead of hiding it", async () => {
  const harness = createHarness();
  await startSession(harness);

  await harness.emit("after_provider_response", {
    status: 200,
    headers: {
      "x-codex-primary-used-percent": "7",
      "x-codex-primary-window-minutes": "10080",
      "x-codex-primary-reset-after-seconds": "600000",
      "x-codex-plan-type": "prolite",
    },
  });

  const chip = usageChip(lastWebuiPayload(harness.state));
  assert.ok(chip, "expected partial Codex usage to remain visible");
  assert.equal(chip.value, "weekly 7%");
  assert.deepEqual(chip.usageWindows, { primaryPercent: 7 });
  assert.match(chip.title, /weekly window: 7% used/);

  const lines = nativeLines(harness.state, harness.ctx).join("\n");
  assert.match(lines, /weekly 7%/);

  await harness.emit("session_shutdown", {});
});

test("anthropic OAuth: renders usage from unified headers", async () => {
  const harness = createHarness();
  harness.state.model = { id: "claude-opus-4.8", provider: "anthropic", contextWindow: 200000, reasoning: true };
  harness.state.usingOAuth = true;
  await startSession(harness);

  await harness.emit("after_provider_response", { status: 200, headers: ANTHROPIC_HEADERS });

  const payload = lastWebuiPayload(harness.state);
  const chip = usageChip(payload);
  assert.ok(chip, "expected a WebUI usage chip for OAuth Anthropic");
  assert.equal(chip.value, "5h 40% · 7d 90%");
  assert.deepEqual(chip.usageWindows, { primaryPercent: 40, secondaryPercent: 90 });
  assert.equal(payload.providerUsage.provider, "anthropic");
  assert.ok(Number.isFinite(payload.providerUsage.capturedAt), "Anthropic usage should publish the live response-capture timestamp");
  assert.deepEqual(payload.providerUsage.primary, {
    label: "5h",
    usedPercent: 40,
    windowMinutes: 300,
    resetAt: Date.parse("2026-01-02T03:04:05.000Z"),
  });
  assert.match(chip.title, /Anthropic subscription usage/);

  const lines = nativeLines(harness.state, harness.ctx).join("\n");
  assert.match(lines, /5h 40% · 7d 90%/);

  await harness.emit("session_shutdown", {});
});

test("anthropic API-key auth: headers are ignored and usage stays hidden", async () => {
  const harness = createHarness();
  harness.state.model = { id: "claude-opus-4.8", provider: "anthropic", contextWindow: 200000, reasoning: true };
  harness.state.usingOAuth = false;
  await startSession(harness);

  await harness.emit("after_provider_response", { status: 200, headers: ANTHROPIC_HEADERS });

  const payload = lastWebuiPayload(harness.state);
  assert.equal(usageChip(payload), undefined, "API-key Anthropic must not show usage");

  const lines = nativeLines(harness.state, harness.ctx).join("\n");
  assert.doesNotMatch(lines, /📊/);

  await harness.emit("session_shutdown", {});
});

test("unrelated provider: usage headers are not captured or shown", async () => {
  const harness = createHarness();
  harness.state.model = { id: "gemini-3-pro", provider: "google", contextWindow: 1000000, reasoning: true };
  await startSession(harness);

  await harness.emit("after_provider_response", { status: 200, headers: { ...CODEX_HEADERS, ...ANTHROPIC_HEADERS } });

  assert.equal(usageChip(lastWebuiPayload(harness.state)), undefined);
  const lines = nativeLines(harness.state, harness.ctx).join("\n");
  assert.doesNotMatch(lines, /📊/);

  await harness.emit("session_shutdown", {});
});

test("stale-provider snapshot: hidden after switching to another provider", async () => {
  const harness = createHarness();
  await startSession(harness);

  await harness.emit("after_provider_response", { status: 200, headers: CODEX_HEADERS });
  assert.ok(usageChip(lastWebuiPayload(harness.state)), "usage visible while Codex is active");

  harness.state.model = { id: "claude-opus-4.8", provider: "anthropic", contextWindow: 200000, reasoning: true };
  harness.state.usingOAuth = true;
  await harness.emit("model_select", { model: harness.state.model, previousModel: undefined, source: "set" });

  assert.equal(
    usageChip(lastWebuiPayload(harness.state)),
    undefined,
    "a Codex snapshot must not render while Anthropic is active",
  );
  const lines = nativeLines(harness.state, harness.ctx).join("\n");
  assert.doesNotMatch(lines, /📊/);

  await harness.emit("session_shutdown", {});
});

test("malformed headers: clear the snapshot instead of showing stale/guessed data", async () => {
  const harness = createHarness();
  await startSession(harness);

  await harness.emit("after_provider_response", { status: 200, headers: CODEX_HEADERS });
  assert.ok(usageChip(lastWebuiPayload(harness.state)));

  await harness.emit("after_provider_response", {
    status: 200,
    headers: { "x-codex-primary-used-percent": "NaN" },
  });

  assert.equal(usageChip(lastWebuiPayload(harness.state)), undefined, "malformed usage must hide the box");
  const lines = nativeLines(harness.state, harness.ctx).join("\n");
  assert.doesNotMatch(lines, /📊/);

  await harness.emit("session_shutdown", {});
});

test("visibility: usage key is registered, default-visible, and published in the payload", async () => {
  const harness = createHarness();
  await startSession(harness);
  // The startup git refresh publishes asynchronously; wait for it to land.
  await new Promise((resolve) => setTimeout(resolve, 20));

  const payload = lastWebuiPayload(harness.state);
  assert.ok(payload.visibility, "expected a visibility record in the payload");
  assert.equal(payload.visibility.usage, true, "usage must be visible by default");
  assert.equal(payload.version, 1, "WebUI payload version must be preserved");

  await harness.emit("session_shutdown", {});
});
