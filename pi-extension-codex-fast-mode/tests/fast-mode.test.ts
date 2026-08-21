import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import codexFastModeExtension, {
  FAST_MODE_SERVICE_TIER,
  FAST_MODE_STATE_ENTRY_TYPE,
  FAST_MODE_STATUS_KEY,
  fastModeArgumentCompletions,
  isFastModeEligibleModel,
  isPlainObject,
  parseFastModeCommand,
  reconstructFastModeState,
  transformFastModeRequest,
} from "../index.ts";

type StatusUpdate = { key: string; value: string | undefined };
type Notification = { message: string; level: string };
type Handler = (event: any, ctx: any) => unknown;

function createHarness(options: { entries?: unknown[]; busy?: boolean; pending?: boolean } = {}) {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, any>();
  const entries = options.entries ?? [];
  const statusUpdates: StatusUpdate[] = [];
  const notifications: Notification[] = [];
  const appendCalls: Array<{ customType: string; data: unknown }> = [];
  let busy = options.busy ?? false;
  let pending = options.pending ?? false;

  const context = {
    model: { provider: "openai-codex", api: "openai-codex-responses" },
    sessionManager: { getBranch: () => entries },
    isIdle: () => !busy,
    hasPendingMessages: () => pending,
    ui: {
      setStatus(key: string, value: string | undefined) {
        statusUpdates.push({ key, value });
      },
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  } as unknown as ExtensionCommandContext;

  codexFastModeExtension({
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
    registerCommand(name: string, command: unknown) {
      commands.set(name, command);
    },
    appendEntry(customType: string, data: unknown) {
      appendCalls.push({ customType, data });
      entries.push({ type: "custom", customType, data });
    },
  } as unknown as ExtensionAPI);

  return {
    appendCalls,
    commands,
    context,
    entries,
    handlers,
    notifications,
    setBusy(value: boolean) { busy = value; },
    setPending(value: boolean) { pending = value; },
    statusUpdates,
  };
}

test("plain-object guard excludes malformed payloads", () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject(Object.create(null)), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(new Date()), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject("payload"), false);
});

test("provider eligibility is exact", () => {
  assert.equal(isFastModeEligibleModel({ provider: "openai-codex", api: "openai-codex-responses" }), true);
  assert.equal(isFastModeEligibleModel({ provider: "openai", api: "openai-codex-responses" }), false);
  assert.equal(isFastModeEligibleModel({ provider: "openai-codex", api: "openai-responses" }), false);
  assert.equal(isFastModeEligibleModel(undefined), false);
});

test("request transformer is isolated, non-mutating, and overwrites only service_tier", () => {
  const payload = { model: "gpt-5.6-codex", service_tier: "default", nested: { preserved: true } };
  const transformed = transformFastModeRequest(true, { provider: "openai-codex", api: "openai-codex-responses" }, payload);

  assert.deepEqual(transformed, {
    model: "gpt-5.6-codex",
    service_tier: FAST_MODE_SERVICE_TIER,
    nested: { preserved: true },
  });
  assert.notStrictEqual(transformed, payload);
  assert.strictEqual(transformed?.nested, payload.nested);
  assert.equal(payload.service_tier, "default");
  assert.equal(transformFastModeRequest(false, { provider: "openai-codex", api: "openai-codex-responses" }, payload), undefined);
  assert.equal(transformFastModeRequest(true, { provider: "openai", api: "openai-codex-responses" }, payload), undefined);
  assert.equal(transformFastModeRequest(true, { provider: "openai-codex", api: "openai-codex-responses" }, []), undefined);
});

test("branch reconstruction uses the latest valid custom snapshot and defaults off", () => {
  assert.deepEqual(reconstructFastModeState([]), { enabled: false });
  assert.deepEqual(reconstructFastModeState([
    { type: "custom", customType: FAST_MODE_STATE_ENTRY_TYPE, data: { enabled: true } },
    { type: "custom", customType: "other", data: { enabled: false } },
    { type: "custom", customType: FAST_MODE_STATE_ENTRY_TYPE, data: { enabled: "invalid" } },
    { type: "custom", customType: FAST_MODE_STATE_ENTRY_TYPE, data: { enabled: false } },
  ]), { enabled: false });
});

test("command grammar and completions are deterministic", () => {
  assert.equal(parseFastModeCommand(""), "toggle");
  assert.equal(parseFastModeCommand(" ON "), "on");
  assert.equal(parseFastModeCommand("off"), "off");
  assert.equal(parseFastModeCommand("status"), "status");
  assert.equal(parseFastModeCommand("on now"), "invalid");
  assert.deepEqual(fastModeArgumentCompletions("o"), [
    { value: "on", label: "on" },
    { value: "off", label: "off" },
  ]);
  assert.deepEqual(fastModeArgumentCompletions("status"), [{ value: "status", label: "status" }]);
});

test("extension restores state, publishes concise status, and persists successful mutations", async () => {
  const harness = createHarness({
    entries: [{ type: "custom", customType: FAST_MODE_STATE_ENTRY_TYPE, data: { enabled: true } }],
  });
  const sessionStart = harness.handlers.get("session_start");
  const request = harness.handlers.get("before_provider_request");
  const command = harness.commands.get("fast-mode");
  assert.ok(sessionStart && request && command);

  sessionStart!({}, harness.context as unknown as ExtensionContext);
  assert.deepEqual(harness.statusUpdates.at(-1), { key: FAST_MODE_STATUS_KEY, value: "Fast-mode: on" });
  assert.deepEqual(request!({ payload: { service_tier: "standard", keep: true } }, harness.context), {
    service_tier: FAST_MODE_SERVICE_TIER,
    keep: true,
  });

  await command.handler("off", harness.context);
  assert.deepEqual(harness.appendCalls, [{ customType: FAST_MODE_STATE_ENTRY_TYPE, data: { enabled: false } }]);
  assert.deepEqual(harness.statusUpdates.at(-1), { key: FAST_MODE_STATUS_KEY, value: "Fast-mode: off" });
  assert.equal(request!({ payload: { keep: true } }, harness.context), undefined);

  await command.handler("status", harness.context);
  assert.match(harness.notifications.at(-1)?.message ?? "", /Fast mode: off/u);
  assert.equal(harness.notifications.at(-1)?.level, "info");
});

test("extension rejects every mutation while busy but leaves status readable", async () => {
  const harness = createHarness({ busy: true });
  const sessionStart = harness.handlers.get("session_start");
  const command = harness.commands.get("fast-mode");
  assert.ok(sessionStart && command);
  sessionStart!({}, harness.context as unknown as ExtensionContext);

  await command.handler("on", harness.context);
  await command.handler("", harness.context);
  await command.handler("off", harness.context);
  assert.equal(harness.appendCalls.length, 0);
  assert.equal(harness.notifications.filter((item) => item.level === "warning").length, 3);

  await command.handler("status", harness.context);
  assert.match(harness.notifications.at(-1)?.message ?? "", /Fast mode: off/u);
  assert.equal(harness.notifications.at(-1)?.level, "info");

  harness.setBusy(false);
  harness.setPending(true);
  await command.handler("on", harness.context);
  assert.equal(harness.appendCalls.length, 0);
});

test("tree navigation reconstructs the active branch state", () => {
  const harness = createHarness({
    entries: [{ type: "custom", customType: FAST_MODE_STATE_ENTRY_TYPE, data: { enabled: true } }],
  });
  const sessionStart = harness.handlers.get("session_start");
  const sessionTree = harness.handlers.get("session_tree");
  assert.ok(sessionStart && sessionTree);

  sessionStart!({}, harness.context as unknown as ExtensionContext);
  harness.entries.push({ type: "custom", customType: FAST_MODE_STATE_ENTRY_TYPE, data: { enabled: false } });
  sessionTree!({}, harness.context as unknown as ExtensionContext);
  assert.deepEqual(harness.statusUpdates.at(-1), { key: FAST_MODE_STATUS_KEY, value: "Fast-mode: off" });
});
