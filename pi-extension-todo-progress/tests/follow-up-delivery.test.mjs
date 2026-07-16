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

function createHarness(extension) {
  const handlers = new Map();
  const entries = [];
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
    registerCommand() {},
  };
  extension(pi);

  const ctx = {
    hasUI: false,
    sessionManager: { getBranch: () => [] },
  };

  return {
    entries,
    hasHandlers(type) {
      return (handlers.get(type) || []).length > 0;
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
