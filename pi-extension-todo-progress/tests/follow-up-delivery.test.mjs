import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadExtension() {
  const sourcePath = join(root, "index.ts");
  const dependencyStub = `data:text/javascript,${encodeURIComponent([
    "export const extractChecklist = () => [];",
    "export const stripChecklistLines = (text) => text;",
  ].join("\n"))}`;
  const source = (await readFile(sourcePath, "utf8")).replace(
    '"@firstpick/pi-utils"',
    JSON.stringify(dependencyStub),
  );
  const tempDir = await mkdtemp(join(tmpdir(), "todo-progress-follow-up-test-"));
  const tempModule = join(tempDir, "index.ts");
  await writeFile(tempModule, source, "utf8");
  try {
    return (await import(`${pathToFileURL(tempModule).href}?test=${Date.now()}`)).default;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function createHarness(extension, options = {}) {
  const handlers = new Map();
  const commands = new Map();
  const entries = [];
  const notifications = [];
  const prompts = [];
  const widgets = [];
  const inputAnswers = [...(options.inputAnswers || [])];
  const pi = {
    on(type, handler) {
      const registered = handlers.get(type) || [];
      registered.push(handler);
      handlers.set(type, registered);
    },
    appendEntry(customType, data) {
      entries.push({ customType, data: structuredClone(data) });
    },
    registerShortcut() {},
    registerCommand(name, command) {
      commands.set(name, command);
    },
  };
  extension(pi);

  const ctx = {
    hasUI: options.hasUI ?? false,
    sessionManager: { getBranch: () => options.branch || [] },
    ui: {
      input: async (title, placeholder) => {
        prompts.push({ title, placeholder });
        return inputAnswers.shift();
      },
      notify: (message, level) => notifications.push({ message, level }),
      setWidget: (key, lines) => widgets.push({ key, lines }),
      theme: { fg: (_style, text) => text },
    },
  };

  return {
    entries,
    notifications,
    prompts,
    widgets,
    hasHandlers(type) {
      return (handlers.get(type) || []).length > 0;
    },
    async command(name, args = "") {
      const command = commands.get(name);
      assert.ok(command, `Expected /${name} to be registered`);
      return command.handler(args, ctx);
    },
    async emit(type, event) {
      let result;
      for (const handler of handlers.get(type) || []) result = await handler(event, ctx);
      return result;
    },
    async injectedContext() {
      const result = await this.emit("context", { messages: [] });
      return result?.messages?.find((message) => message.customType === "todo-progress-context")?.content || "";
    },
  };
}

function userMessage(text) {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

test("/goal sets a normalized goal from its argument and persists it", async () => {
  const extension = await loadExtension();
  const harness = createHarness(extension);

  await harness.command("goal", "  Ship the release\nwithout regressions.  ");

  assert.match(await harness.injectedContext(), /Goal: Ship the release without regressions\./);
  assert.equal(harness.entries.at(-1)?.data?.goal, "Ship the release without regressions.");
  assert.deepEqual(harness.notifications.at(-1), {
    message: "Todo goal set: Ship the release without regressions.",
    level: "info",
  });
});

test("argumentless /goal prompts, updates an active widget, and preserves its checklist", async () => {
  const extension = await loadExtension();
  const branch = [{
    type: "custom",
    customType: "todo-progress-state",
    data: {
      version: 1,
      visible: true,
      items: [{ text: "Keep this item", status: "partial" }],
      offset: 0,
      goal: "Old goal",
      awaitingGoalCheck: false,
      allowNextListReplacement: false,
    },
  }];
  const harness = createHarness(extension, {
    hasUI: true,
    inputAnswers: ["Set the new goal."],
    branch,
  });

  await harness.emit("session_start", {});
  await harness.command("goal");

  assert.deepEqual(harness.prompts, [{
    title: "Set one-sentence todo goal",
    placeholder: "Current: Old goal",
  }]);
  assert.deepEqual(harness.widgets.at(-1)?.lines, [
    "Goal: Set the new goal.",
    "Todo 0/1 done, 1 partial",
    "[-] Keep this item",
  ]);
  assert.equal(harness.entries.at(-1)?.data?.goal, "Set the new goal.");
  assert.deepEqual(harness.entries.at(-1)?.data?.items, [{ text: "Keep this item", status: "partial" }]);
});

test("argumentless /goal leaves state unchanged when cancelled or headless", async () => {
  const extension = await loadExtension();
  const interactive = createHarness(extension, { hasUI: true, inputAnswers: ["  "] });
  await interactive.command("goal", "Existing goal");
  const persistedBeforeCancel = interactive.entries.length;
  await interactive.command("goal");

  assert.equal(interactive.entries.length, persistedBeforeCancel);
  assert.match(await interactive.injectedContext(), /Goal: Existing goal/);
  assert.deepEqual(interactive.notifications.at(-1), { message: "Todo goal update cancelled", level: "info" });

  const headless = createHarness(extension);
  await headless.command("goal");
  assert.equal(headless.entries.length, 0);
  assert.deepEqual(headless.notifications.at(-1), {
    message: "Usage: /goal <one-sentence goal> (interactive input is unavailable)",
    level: "warning",
  });
});

test("queued follow-ups update todo context only when the user message is delivered", async () => {
  const extension = await loadExtension();
  const harness = createHarness(extension);

  const beforeStart = await harness.emit("before_agent_start", {
    prompt: "Original styling task",
    systemPrompt: "base prompt",
  });
  assert.match(beforeStart.systemPrompt, /\[TODO PROGRESS POLICY\]/);

  await harness.emit("message_start", { message: userMessage("Original styling task") });
  assert.match(await harness.injectedContext(), /Goal: Original styling task/);
  const persistedBeforeQueue = harness.entries.length;

  // Pi emits input as soon as a follow-up is accepted, while message_start is
  // delayed until the active run has finished. Queue acceptance must not alter
  // the context seen by that still-active run.
  await harness.emit("input", {
    text: "Queued follow-up question",
    source: "rpc",
    streamingBehavior: "followUp",
  });
  assert.equal(harness.hasHandlers("input"), false);
  assert.equal(harness.entries.length, persistedBeforeQueue);
  assert.match(await harness.injectedContext(), /Goal: Original styling task/);
  assert.doesNotMatch(await harness.injectedContext(), /Queued follow-up question/);

  await harness.emit("message_start", { message: userMessage("Queued follow-up question") });
  const deliveredContext = await harness.injectedContext();
  assert.match(deliveredContext, /Goal: Queued follow-up question/);
  assert.doesNotMatch(deliveredContext, /Original styling task/);
  assert.equal(harness.entries.at(-1)?.data?.goal, "Queued follow-up question");
});
