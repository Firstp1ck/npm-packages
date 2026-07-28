// Regression coverage for the always-visible, cumulative Speed card.
//
// Run with:
//   node --test pi-extension-git-footer-status/tests/speed-persistence.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const testRoot = await mkdtemp(path.join(tmpdir(), "git-footer-speed-"));
process.env.PI_GIT_FOOTER_SETTINGS_FILE = path.join(testRoot, "visibility.json");
process.env.PI_GIT_FOOTER_AUTO_REFRESH_MS = "0";
process.env.PI_GIT_FOOTER_FETCH = "0";
process.env.PI_GIT_FOOTER_DISABLE_PROMPT_ESTIMATE = "1";

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

const { default: gitFooterStatus } = await import("../index.ts");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createHarness = () => {
  const handlers = new Map();
  const commands = new Map();
  const statuses = [];
  const pi = {
    on(event, handler) {
      const eventHandlers = handlers.get(event) ?? [];
      eventHandlers.push(handler);
      handlers.set(event, eventHandlers);
    },
    registerCommand(name, command) {
      commands.set(name, command);
    },
    registerShortcut() {},
    getThinkingLevel: () => "off",
    exec: async () => ({ code: 1, stdout: "", stderr: "not a git repository", killed: false }),
  };

  gitFooterStatus(pi);

  const ctx = {
    hasUI: true,
    mode: "rpc",
    cwd: testRoot,
    model: null,
    modelRegistry: { isUsingOAuth: () => false },
    getContextUsage: () => ({ contextWindow: 128_000, percent: 0 }),
    sessionManager: {
      getEntries: () => [],
      getSessionDir: () => testRoot,
      getSessionId: () => "speed-test",
    },
    ui: {
      setFooter() {},
      notify() {},
      setStatus(key, value) {
        statuses.push({ key, value });
      },
    },
  };

  const emit = async (event, payload = {}) => {
    for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
  };

  const latestSpeedCard = () => {
    const entry = statuses.findLast(({ key, value }) => key === "git-footer-webui" && typeof value === "string");
    assert.ok(entry, "expected a published WebUI footer payload");
    const payload = JSON.parse(entry.value);
    return payload.main.find((chip) => chip.key === "speed");
  };

  const runVisibility = async (args) => {
    const command = commands.get("git-footer-visibility");
    assert.ok(command, "git-footer-visibility command should be registered");
    await command.handler(args, ctx);
  };

  return { ctx, emit, latestSpeedCard, runVisibility };
};

const assistantMessage = (output, timestamp) => ({
  role: "assistant",
  provider: "test",
  model: "test-model",
  timestamp,
  responseId: `response-${timestamp}`,
  usage: {
    input: 0,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    cost: { total: 0 },
  },
});

test.after(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

test("Speed stays visible while idle and keeps cumulative output and the latest measured speed", async () => {
  const harness = createHarness();
  await harness.emit("session_start");
  await sleep(20);

  assert.equal(harness.latestSpeedCard()?.value, "0 tok @ — tok/s", "Speed should exist before generation starts");

  const realDateNow = Date.now;
  let nowMs = realDateNow();
  Date.now = () => nowMs;

  try {
    const first = assistantMessage(12, 1);
    await harness.emit("message_start", { message: first });
    nowMs += 100;
    await harness.emit("message_update", {
      message: first,
      assistantMessageEvent: {
        type: "text_delta",
        delta: "first streamed response",
        partial: first,
      },
    });
    await sleep(280);

    const activeSpeed = harness.latestSpeedCard().value;
    assert.match(activeSpeed, /^12 tok @ (?!—)/, "a valid live speed should be published while the agent runs");
    assert.doesNotMatch(activeSpeed, / · (?:avg|1%|max) /, "session speed stats should be hidden by default");

    await harness.runVisibility("show webui speed-avg");
    const avgOnlySpeed = harness.latestSpeedCard().value;
    assert.match(avgOnlySpeed, / · avg \S+$/, "the selected average speed should be shown");
    assert.doesNotMatch(avgOnlySpeed, / · 1% | · max /, "unselected speed stats should remain hidden");

    await harness.runVisibility("show webui speed-low speed-max");
    const allStatsSpeed = harness.latestSpeedCard().value;
    assert.match(allStatsSpeed, / · avg \S+ · 1% \S+ · max \S+$/, "all selected speed stats should be shown");

    nowMs += 3_000;
    await harness.emit("message_update", {
      message: first,
      assistantMessageEvent: {
        type: "toolcall_delta",
        delta: "",
        partial: first,
      },
    });
    await sleep(20);
    assert.equal(
      harness.latestSpeedCard().value,
      allStatsSpeed,
      "a streaming pause or tool transition must retain the last valid live speed and selected stats",
    );

    // Exercise the problematic ordering where agent_end clears live state before
    // message_end publishes final usage.
    await harness.emit("agent_end");
    await harness.emit("message_end", { message: first });

    const idleAfterFirst = harness.latestSpeedCard();
    assert.ok(idleAfterFirst, "Speed should remain in the footer after agent_end");
    assert.match(idleAfterFirst.value, /^12 tok @ (?!—)/, "the completed output and measured speed should remain visible");

    const second = assistantMessage(8, 2);
    await harness.emit("message_start", { message: second });
    assert.match(
      harness.latestSpeedCard().value,
      /^12 tok @ (?!—)/,
      "starting another assistant message must not reset the displayed cumulative output or speed",
    );

    nowMs += 100;
    await harness.emit("message_update", {
      message: second,
      assistantMessageEvent: {
        type: "text_delta",
        delta: "second streamed response",
        partial: second,
      },
    });
    await harness.emit("message_end", { message: second });
    await harness.emit("turn_end", { message: second });
    await harness.emit("agent_end");

    assert.match(
      harness.latestSpeedCard().value,
      /^20 tok @ (?!—)/,
      "completed output should accumulate across assistant messages and remain visible while idle",
    );
  } finally {
    Date.now = realDateNow;
    await harness.emit("session_shutdown");
  }
});
