// Regression test for the stale-extension-context crash (PATCH.md, Change 6).
//
// Run with:
//   node --test pi-extension-git-footer-status/tests/stale-ctx.test.mjs
//
// Requires Node >= 23.6: default type stripping for ../index.ts plus the
// module.registerHooks() API used below. No package dependencies need to be
// installed; both runtime imports are stubbed as virtual modules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Module-level constants in ../index.ts read these at import time.
process.env.PI_GIT_FOOTER_AUTO_REFRESH_MS = "50";
process.env.PI_GIT_FOOTER_FETCH = "0";

const STALE_MESSAGE =
  "This extension ctx is stale after session replacement or reload. " +
  "Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), " +
  "ctx.switchSession(), or ctx.reload().";

const envFlag = (name, fallback) => {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(raw);
};

// Mock the only two runtime dependencies of ../index.ts. The other package
// imports (@earendil-works/pi-ai, @earendil-works/pi-coding-agent) are
// type-only and erased by type stripping. Use a loader hook instead of
// node:test mock.module(): @firstpick/pi-utils publishes TypeScript sources,
// and Node refuses type-stripping for files under node_modules.
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
            refresh: async (_ctx) => {
              const control = globalThis.__gitFooterPromptRefreshControl;
              control?.started?.();
              if (control?.wait) await control.wait;
              if (control?.error) throw control.error;
              void _ctx.cwd;
              return { status: "ok" };
            },
            getSnapshot: () => null,
            getFallbackSnapshot: () => null,
            clear: () => {},
          });
          export const envFlag = ${envFlag.toString()};
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const newState = () => ({
  stale: false,
  execCalls: 0,
  execCallsWhileStale: 0,
  staleCtxAccesses: 0,
  setStatusCalls: [],
  setFooterCalls: [],
});

const createFakePi = (state) => {
  const handlers = new Map();
  const commands = new Map();
  const pi = {
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand(name, command) {
      commands.set(name, command);
    },
    registerShortcut() {},
    exec(_cmd, _args, _opts) {
      if (state.stale) {
        state.execCallsWhileStale += 1;
        // Real pi throws synchronously from assertActive() on a stale ctx.
        throw new Error(STALE_MESSAGE);
      }
      state.execCalls += 1;
      return Promise.resolve({ code: 0, stdout: "", stderr: "", killed: false });
    },
  };
  const emit = async (event, evt, ctx) => {
    for (const handler of handlers.get(event) ?? []) await handler(evt, ctx);
  };
  const runCommand = async (name, args, ctx) => {
    const command = commands.get(name);
    assert.ok(command, `expected command to be registered: ${name}`);
    return command.handler(args, ctx);
  };
  return { pi, emit, runCommand };
};

const createFakeCtx = (state, { hasUI }) => {
  const assertFresh = () => {
    if (state.stale) {
      state.staleCtxAccesses += 1;
      throw new Error(STALE_MESSAGE);
    }
  };
  const ui = {
    setStatus: (key, value) => {
      assertFresh();
      state.setStatusCalls.push([key, value]);
    },
    setFooter: (factory) => {
      assertFresh();
      state.setFooterCalls.push(factory);
    },
    notify: () => assertFresh(),
  };
  const sessionManager = {
    getSessionDir: () => "/tmp/fake-session-dir",
    getEntries: () => [],
    getSessionId: () => "fake-session",
  };
  const ctx = {};
  Object.defineProperty(ctx, "hasUI", { get: () => { assertFresh(); return hasUI; } });
  Object.defineProperty(ctx, "cwd", { get: () => { assertFresh(); return process.cwd(); } });
  Object.defineProperty(ctx, "ui", { get: () => { assertFresh(); return ui; } });
  Object.defineProperty(ctx, "sessionManager", { get: () => { assertFresh(); return sessionManager; } });
  Object.defineProperty(ctx, "model", { get: () => { assertFresh(); return null; } });
  return ctx;
};

test("stale ctx hit by the auto-refresh timer neither rejects unhandled nor keeps polling", async () => {
  const unhandledRejections = [];
  const uncaughtExceptions = [];
  const onRejection = (reason) => unhandledRejections.push(reason);
  const onException = (error) => uncaughtExceptions.push(error);
  process.on("unhandledRejection", onRejection);
  process.on("uncaughtException", onException);

  const state = newState();
  const { pi, emit } = createFakePi(state);
  gitFooterStatus(pi);

  const ctx = createFakeCtx(state, { hasUI: true });
  await emit("session_start", {}, ctx);
  await sleep(130); // initial refresh + ~2 interval ticks while fresh

  try {
    assert.ok(state.execCalls > 0, "expected git exec activity while the ctx is fresh");
    assert.equal(state.setFooterCalls.length, 1, "expected the footer to be registered in UI mode");

    state.stale = true;
    await sleep(200); // >= 150ms: the 50ms interval fires against the stale ctx

    assert.ok(state.staleCtxAccesses > 0, "expected the timer to have hit the stale ctx");

    // The interval must be stopped after the first stale hit: no further
    // stale ctx accesses and no further exec attempts of any kind.
    const staleAccessesAfterFirstWindow = state.staleCtxAccesses;
    const staleExecAttemptsAfterFirstWindow = state.execCallsWhileStale;
    const freshExecCallsAtStale = state.execCalls;
    await sleep(150); // 3 more interval periods, were it still running
    assert.equal(
      state.staleCtxAccesses,
      staleAccessesAfterFirstWindow,
      "auto-refresh interval must be stopped after the first stale hit",
    );
    assert.equal(state.execCallsWhileStale, staleExecAttemptsAfterFirstWindow);
    assert.equal(state.execCalls, freshExecCallsAtStale, "no further fresh exec calls once stale");

    assert.deepEqual(unhandledRejections, [], "stale ctx must not produce unhandled rejections");
    assert.deepEqual(uncaughtExceptions, [], "stale ctx must not produce uncaught exceptions");
  } finally {
    state.stale = false;
    await emit("session_shutdown", {}, ctx);
    process.off("unhandledRejection", onRejection);
    process.off("uncaughtException", onException);
  }
});

test("git-footer-refresh exits quietly when /new invalidates its in-flight command ctx", async () => {
  const state = newState();
  const { pi, runCommand } = createFakePi(state);
  gitFooterStatus(pi);

  let markRefreshStarted;
  let releaseRefresh;
  const refreshStarted = new Promise((resolve) => { markRefreshStarted = resolve; });
  const waitForReplacement = new Promise((resolve) => { releaseRefresh = resolve; });
  globalThis.__gitFooterPromptRefreshControl = {
    started: markRefreshStarted,
    wait: waitForReplacement,
  };

  const ctx = createFakeCtx(state, { hasUI: true });
  const commandPromise = runCommand("git-footer-refresh", "--webui-silent", ctx);
  await refreshStarted;
  state.stale = true;
  releaseRefresh();

  try {
    await assert.doesNotReject(
      commandPromise,
      "a refresh already in flight during session replacement must not emit a command error",
    );
    assert.ok(state.staleCtxAccesses > 0, "expected the old command ctx to be rejected as stale");
    assert.equal(state.execCallsWhileStale, 0, "the stale command must stop before executing git");
    assert.equal(state.setStatusCalls.length, 0, "the stale command must not publish old-session status");
  } finally {
    delete globalThis.__gitFooterPromptRefreshControl;
  }
});

test("git-footer-refresh still reports non-stale command failures", async () => {
  const state = newState();
  const { pi, runCommand } = createFakePi(state);
  gitFooterStatus(pi);

  globalThis.__gitFooterPromptRefreshControl = { error: new Error("prompt estimate failed") };
  const ctx = createFakeCtx(state, { hasUI: true });

  try {
    await assert.rejects(
      runCommand("git-footer-refresh", "--webui-silent", ctx),
      /prompt estimate failed/,
      "only stale-context failures should be suppressed",
    );
  } finally {
    delete globalThis.__gitFooterPromptRefreshControl;
  }
});

test("non-UI session (hasUI=false) arms no background work and never execs", async () => {
  const state = newState();
  const { pi, emit } = createFakePi(state);
  gitFooterStatus(pi);

  const ctx = createFakeCtx(state, { hasUI: false });
  await emit("session_start", {}, ctx);
  await emit("agent_start", {}, ctx);
  await emit("agent_end", {}, ctx);
  await emit("turn_end", { message: { role: "user" } }, ctx);
  await sleep(200); // > 3 auto-refresh periods, were a timer armed

  assert.equal(state.execCalls, 0, "no git exec in non-UI mode");
  assert.equal(state.execCallsWhileStale, 0);
  assert.equal(state.setFooterCalls.length, 0, "no footer registration in non-UI mode");
  assert.equal(state.setStatusCalls.length, 0, "no status publishing in non-UI mode");

  await emit("session_shutdown", {}, ctx);
});
