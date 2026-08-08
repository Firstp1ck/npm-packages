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
    notify: () => {},
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

const nativeLines = (state, ctx) => {
  assert.ok(state.footerFactory, "expected a native footer to be registered");
  const theme = { fg: (_tone, text) => text, bold: (text) => text };
  const tui = { requestRender: () => {} };
  const footerData = {
    onBranchChange: () => () => {},
    getGitBranch: () => "main",
    getAvailableProviderCount: () => 1,
    getExtensionStatuses: () => new Map(),
  };
  const component = state.footerFactory(tui, theme, footerData);
  return component.render(400);
};

const startSession = async (harness) => {
  gitFooterStatus(harness.pi);
  await harness.emit("session_start", {});
};

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
  assert.match(chip.title, /plan plus/);
  assert.match(chip.title, /weekly window: 29% used/);
  assert.match(chip.title, /weekly window: 0% used/);
  assert.match(chip.title, /resets 2025-10-09T/);
  assert.match(chip.title, /resets in 2h/);

  const lines = nativeLines(harness.state, harness.ctx).join("\n");
  assert.match(lines, /weekly 29% · weekly 0%/, "native footer should use Codex window metadata instead of fixed labels");

  await harness.emit("session_shutdown", {});
});

test("anthropic OAuth: renders usage from unified headers", async () => {
  const harness = createHarness();
  harness.state.model = { id: "claude-opus-4.8", provider: "anthropic", contextWindow: 200000, reasoning: true };
  harness.state.usingOAuth = true;
  await startSession(harness);

  await harness.emit("after_provider_response", { status: 200, headers: ANTHROPIC_HEADERS });

  const chip = usageChip(lastWebuiPayload(harness.state));
  assert.ok(chip, "expected a WebUI usage chip for OAuth Anthropic");
  assert.equal(chip.value, "5h 40% · 7d 90%");
  assert.deepEqual(chip.usageWindows, { primaryPercent: 40, secondaryPercent: 90 });
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
