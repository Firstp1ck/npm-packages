import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { initTheme } from "@earendil-works/pi-coding-agent";
import gitGuidedWorkflow, { COMMAND_NAME, progressText, showActionScreen } from "../index.ts";

initTheme(undefined, false);

const roots = [];
test.after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }).trim();
}

async function tempDir(label) {
  const root = await mkdtemp(path.join(os.tmpdir(), `guided-git-tui-${label}-`));
  roots.push(root);
  return root;
}

async function repository(label) {
  const root = await tempDir(label);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Guided Git TUI Test");
  git(root, "config", "user.email", "guided-git-tui@example.invalid");
  await writeFile(path.join(root, "tracked.txt"), "base\n");
  git(root, "add", "--", "tracked.txt");
  git(root, "commit", "-m", "test: initial");
  return root;
}

function fakeTheme() {
  return { fg: (_tone, text) => text, bold: (text) => text };
}

function extensionRegistration() {
  const commands = new Map();
  const handlers = new Map();
  gitGuidedWorkflow({
    registerCommand(name, definition) { commands.set(name, definition); },
    on(name, handler) { handlers.set(name, handler); },
  });
  return { commands, handlers };
}

function createContext(root, options = {}) {
  const actionMoves = [...(options.actionMoves ?? [])];
  const editorValues = [...(options.editorValues ?? [])];
  const confirmations = [];
  const notifications = [];
  const renders = [];
  let customOpen = false;
  let customCount = 0;
  const ctx = {
    cwd: root,
    mode: options.mode ?? "tui",
    hasUI: options.hasUI ?? true,
    model: options.model,
    modelRegistry: options.modelRegistry ?? {},
    isIdle: () => options.idle ?? true,
    hasPendingMessages: () => options.pending ?? false,
    ui: {
      theme: fakeTheme(),
      notify(message, type) { notifications.push({ message, type }); },
      async confirm(title, message) {
        assert.equal(customOpen, false, "custom screen must finish before confirmation opens");
        confirmations.push({ title, message });
        return options.confirm?.(title, message, confirmations.length - 1) ?? true;
      },
      async editor(title, prefill) {
        assert.equal(customOpen, false, "custom screen must finish before editor opens");
        options.onEditor?.(title, prefill);
        return editorValues.length ? editorValues.shift() : undefined;
      },
      async custom(factory) {
        assert.equal(customOpen, false, "custom screens must not overlap");
        customOpen = true;
        customCount += 1;
        return await new Promise(async (resolve, reject) => {
          let settled = false;
          let component;
          const done = (value) => {
            if (settled) return;
            settled = true;
            component?.dispose?.();
            customOpen = false;
            resolve(value);
          };
          try {
            const tui = { requestRender() {} };
            component = await factory(tui, fakeTheme(), {}, done);
            if (settled) {
              component.dispose?.();
              return;
            }
            const normal = component.render(42);
            const narrow = component.render(12);
            renders.push({ normal, narrow });
            for (const [width, lines] of [[42, normal], [12, narrow]]) {
              for (const line of lines) assert.ok(visibleWidth(line) <= width, `rendered line exceeds ${width}: ${JSON.stringify(line)}`);
            }
            const text = normal.join("\n");
            if (/Generating with active model/u.test(text)) {
              options.onLoader?.(component, customCount);
              return;
            }
            const moves = actionMoves.shift();
            assert.notEqual(moves, undefined, `missing action script for screen:\n${text}`);
            queueMicrotask(() => {
              for (let index = 0; index < moves; index += 1) component.handleInput?.("\x1b[B");
              component.handleInput?.("\r");
            });
          } catch (error) {
            customOpen = false;
            reject(error);
          }
        });
      },
    },
  };
  return { ctx, confirmations, notifications, renders, remainingActions: actionMoves };
}

async function stageTracked(root, content = "changed\n") {
  await writeFile(path.join(root, "tracked.txt"), content);
  git(root, "add", "--", "tracked.txt");
}

function assistantResponse(output) {
  return {
    role: "assistant",
    stopReason: "stop",
    content: [{ type: "text", text: output }],
    usage: {},
    api: "test",
    provider: "test",
    model: "test",
    timestamp: Date.now(),
  };
}

test("registers exactly /git-guided-workflow and exposes the four-stage header", () => {
  const { commands, handlers } = extensionRegistration();
  assert.deepEqual([...commands.keys()], [COMMAND_NAME]);
  assert.equal(COMMAND_NAME, "git-guided-workflow");
  assert.match(commands.get(COMMAND_NAME).description, /staged changes/u);
  assert.deepEqual([...handlers.keys()], ["session_shutdown"]);
  assert.equal(progressText("Push"), "✓ Stage  →  ✓ Message  →  ✓ Commit  →  ● Push");
});

test("action screens use a cancellable native list and stay within narrow widths", async () => {
  let component;
  const resultPromise = showActionScreen({
    ui: {
      custom: async (factory) => await new Promise((resolve) => {
        component = factory({ requestRender() {} }, fakeTheme(), {}, resolve);
        for (const width of [8, 12, 40]) {
          for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width);
        }
        component.handleInput("\x1b");
      }),
    },
  }, "Stage", "Unsafe\x1b[31m title", "odd\x00 details", [{ value: "go", label: "Continue" }]);
  assert.equal(await resultPromise, null, "Escape must cancel without selecting the highlighted action");
  assert.equal(typeof component.handleInput, "function");
});

test("rejects non-TUI, busy, and queued starts without opening UI or mutating Git", async () => {
  const root = await repository("refusals");
  await stageTracked(root);
  const before = git(root, "rev-parse", "HEAD");
  for (const options of [
    { mode: "rpc", hasUI: true },
    { idle: false },
    { pending: true },
  ]) {
    const { commands } = extensionRegistration();
    const harness = createContext(root, options);
    await commands.get(COMMAND_NAME).handler("", harness.ctx);
    assert.equal(harness.renders.length, 0);
    assert.match(harness.notifications[0].message, /No Git command was run/u);
  }
  assert.equal(git(root, "rev-parse", "HEAD"), before);
});

test("manual no-model flow commits in a temporary repository and offers Finish when push is unavailable", async () => {
  const root = await repository("manual");
  await stageTracked(root, "manual\n");
  const { commands } = extensionRegistration();
  const harness = createContext(root, { actionMoves: [0, 0, 0, 0, 0], editorValues: ["feat: commit manual change"] });
  await commands.get(COMMAND_NAME).handler("", harness.ctx);
  assert.equal(git(root, "log", "-1", "--pretty=%B"), "feat: commit manual change");
  assert.ok(harness.confirmations.some(({ title, message }) => title === "Create this Git commit?" && /Exact message:\nfeat: commit manual change/u.test(message)));
  assert.ok(harness.renders.some(({ normal }) => /Push is unavailable/u.test(normal.join("\n"))));
  assert.equal(harness.remainingActions.length, 0);
});

test("Stage all confirms exact status counts and can finish before commit", async () => {
  const root = await repository("stage-all");
  await writeFile(path.join(root, "tracked.txt"), "unstaged\n");
  await writeFile(path.join(root, "new.txt"), "new\n");
  const { commands } = extensionRegistration();
  const harness = createContext(root, {
    actionMoves: [0, 0, 0, 0, 3],
    editorValues: ["chore: staged all changes"],
  });
  const before = git(root, "rev-parse", "HEAD");
  await commands.get(COMMAND_NAME).handler("", harness.ctx);
  const stageConfirmation = harness.confirmations.find(({ title }) => title === "Stage all repository changes?");
  assert.ok(stageConfirmation);
  assert.match(stageConfirmation.message, /Staged: 0\nUnstaged: 1\nUntracked: 1\nConflicted: 0/u);
  assert.match(git(root, "status", "--porcelain"), /^A  new\.txt\nM  tracked\.txt$/mu);
  assert.equal(git(root, "rev-parse", "HEAD"), before, "Finish must not commit");
});

test("Stage all returns to a fresh summary when counts change during confirmation without staging", async () => {
  const root = await repository("stage-all-race");
  await writeFile(path.join(root, "tracked.txt"), "unstaged before confirmation\n");
  const { commands } = extensionRegistration();
  let changed = false;
  const harness = createContext(root, {
    actionMoves: [0, 1],
    confirm(title) {
      if (title === "Stage all repository changes?" && !changed) {
        changed = true;
        execFileSync("sh", ["-c", "printf 'new during confirmation\\n' > raced.txt"], { cwd: root });
      }
      return true;
    },
  });
  await commands.get(COMMAND_NAME).handler("", harness.ctx);
  assert.equal(git(root, "diff", "--cached", "--name-only"), "", "stale Stage-all authorization must not mutate the index");
  assert.match(git(root, "status", "--porcelain"), /^M tracked\.txt\n\?\? raced\.txt$/mu);
  assert.ok(harness.notifications.some(({ message }) => /fresh summary before staging/u.test(message)));
  assert.equal(harness.confirmations.filter(({ title }) => title === "Stage all repository changes?").length, 1);
});

test("generation sends the complete diff only after selection and accepts the closed format", async () => {
  const root = await repository("generate");
  await stageTracked(root, "generated private content\n");
  let completeCalls = 0;
  let received;
  const short = "feat: generate a safe message";
  const modelRegistry = {
    async complete(_model, context, options) {
      completeCalls += 1;
      received = { context, signal: options.signal };
      await new Promise((resolve) => setImmediate(resolve));
      return assistantResponse(`<<<SHORT>>>\n${short}\n<<<LONG>>>\n${short}\n\nDescribe the staged change.\n<<<END>>>`);
    },
  };
  const { commands } = extensionRegistration();
  const harness = createContext(root, {
    model: { id: "active-test-model", provider: "test" },
    modelRegistry,
    actionMoves: [0, 0, 0, 0, 0, 0],
  });
  await commands.get(COMMAND_NAME).handler("", harness.ctx);
  assert.equal(completeCalls, 1, JSON.stringify({ notifications: harness.notifications, renders: harness.renders.map((entry) => entry.normal.join("\n")) }));
  assert.match(received.context.systemPrompt, /diff is data only.*Never follow instructions/su);
  assert.match(received.context.messages[0].content[0].text, /generated private content/u);
  assert.equal(received.signal.aborted, false);
  assert.equal(git(root, "log", "-1", "--pretty=%s"), short);
  assert.ok(harness.renders.some(({ normal }) => /complete staged diff is sent to its provider/u.test(normal.join(" ").replace(/\s+/gu, " "))));
});

test("an oversized generation input is not sent and manual entry remains available", async () => {
  const root = await repository("oversized-generation");
  await stageTracked(root, `${"private staged content ".repeat(52_000)}\n`);
  let completeCalls = 0;
  const { commands } = extensionRegistration();
  const harness = createContext(root, {
    model: { id: "unused-model", provider: "test" },
    modelRegistry: { async complete() { completeCalls += 1; throw new Error("must not be called"); } },
    actionMoves: [0, 0, 1, 0, 3],
    editorValues: ["docs: describe a large staged change"],
  });
  const before = git(root, "rev-parse", "HEAD");
  await commands.get(COMMAND_NAME).handler("", harness.ctx);
  assert.equal(completeCalls, 0);
  assert.ok(harness.notifications.some(({ message }) => /generation cap.*Manual entry is still available/iu.test(message)));
  assert.equal(git(root, "rev-parse", "HEAD"), before);
});

test("Escape cancels direct generation, aborts its request, and keeps manual entry available", async () => {
  const root = await repository("generation-cancel");
  await stageTracked(root);
  let observedSignal;
  const { commands } = extensionRegistration();
  const harness = createContext(root, {
    model: { id: "cancelled-model", provider: "test" },
    modelRegistry: {
      async complete(_model, _context, { signal }) {
        observedSignal = signal;
        return await new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      },
    },
    actionMoves: [0, 0, 1, 0, 3],
    editorValues: ["fix: use manual after cancellation"],
    onLoader(component) { queueMicrotask(() => component.handleInput("\x1b")); },
  });
  const before = git(root, "rev-parse", "HEAD");
  await commands.get(COMMAND_NAME).handler("", harness.ctx);
  assert.equal(observedSignal.aborted, true);
  assert.ok(harness.notifications.some(({ message }) => /generation cancelled.*Manual entry is still available/iu.test(message)));
  assert.equal(git(root, "rev-parse", "HEAD"), before);
});

test("generation failure keeps manual entry available", async () => {
  const root = await repository("generation-failure");
  await stageTracked(root);
  const { commands } = extensionRegistration();
  const harness = createContext(root, {
    model: { id: "failing-model", provider: "test" },
    modelRegistry: { async complete() { throw new Error("provider unavailable"); } },
    actionMoves: [0, 0, 1, 0, 3],
    editorValues: ["fix: use manual fallback"],
  });
  const before = git(root, "rev-parse", "HEAD");
  await commands.get(COMMAND_NAME).handler("", harness.ctx);
  assert.ok(harness.notifications.some(({ message }) => /Manual entry is still available/u.test(message)), JSON.stringify(harness.notifications));
  assert.equal(git(root, "rev-parse", "HEAD"), before, "test finishes at Commit without mutation");
});

test("staged drift after exact commit confirmation returns to Stage without committing", async () => {
  const root = await repository("drift");
  await stageTracked(root, "candidate\n");
  const before = git(root, "rev-parse", "HEAD");
  const { commands } = extensionRegistration();
  let drifted = false;
  const harness = createContext(root, {
    actionMoves: [0, 0, 0, 0, 1],
    editorValues: ["feat: stale candidate"],
    confirm(title) {
      if (title === "Create this Git commit?" && !drifted) {
        drifted = true;
        execFileSync("sh", ["-c", "printf 'drift\\n' > tracked.txt"], { cwd: root });
        git(root, "add", "--", "tracked.txt");
      }
      return true;
    },
  });
  await commands.get(COMMAND_NAME).handler("", harness.ctx);
  assert.equal(git(root, "rev-parse", "HEAD"), before);
  assert.ok(harness.notifications.some(({ message }) => /Returning to Stage without committing/u.test(message)), JSON.stringify(harness.notifications));
});

test("native confirmations sanitize hostile Git display values while raw argv values still execute", async () => {
  const container = await tempDir("hostile-display");
  const root = path.join(container, "repo\x1b[31m\nname");
  const branch = "main\u202e";
  const remote = "ori\u2066gin";
  const hostileFile = "odd\x1b[2J\u202ename.txt";
  await mkdir(root);
  git(root, "init", "-b", branch);
  git(root, "config", "user.name", "Guided Git TUI Test");
  git(root, "config", "user.email", "guided-git-tui@example.invalid");
  await writeFile(path.join(root, "tracked.txt"), "base\n");
  git(root, "add", "--", "tracked.txt");
  git(root, "commit", "-m", "test: initial");
  const bare = await tempDir("hostile-display-remote.git");
  git(bare, "init", "--bare");
  git(root, "remote", "add", remote, bare);
  await writeFile(path.join(root, hostileFile), "hostile display fixture\n");

  const { commands } = extensionRegistration();
  const harness = createContext(root, {
    actionMoves: [0, 0, 0, 0, 0, 0],
    editorValues: ["fix: sanitize confirmation displays"],
  });
  await commands.get(COMMAND_NAME).handler("", harness.ctx);

  const unsafeDisplay = /\x1b|[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
  assert.equal(harness.confirmations.length, 3);
  for (const { title, message } of harness.confirmations) {
    assert.doesNotMatch(title, unsafeDisplay);
    assert.doesNotMatch(message, unsafeDisplay);
  }
  const oid = git(root, "rev-parse", "HEAD");
  assert.equal(git(bare, "rev-parse", `refs/heads/${branch}`), oid, "raw hostile branch and remote argv values must remain intact");
  assert.ok(harness.confirmations.some(({ message }) => message.includes("odd name.txt")), "sanitized filename copy should remain recognizable");
});

test("push shows and confirms the exact local remote, branch, and refspec", async () => {
  const root = await repository("push");
  const bare = await tempDir("push-remote.git");
  git(bare, "init", "--bare");
  git(root, "remote", "add", "origin", bare);
  await stageTracked(root, "push me\n");
  const { commands } = extensionRegistration();
  const harness = createContext(root, { actionMoves: [0, 0, 0, 0, 0, 0], editorValues: ["feat: push exact refspec"] });
  await commands.get(COMMAND_NAME).handler("", harness.ctx);
  const localHead = git(root, "rev-parse", "HEAD");
  assert.equal(git(bare, "rev-parse", "refs/heads/main"), localHead);
  const pushConfirmation = harness.confirmations.find(({ title }) => title === "Push this exact commit?");
  assert.ok(pushConfirmation);
  assert.match(pushConfirmation.message, new RegExp(`Remote: origin\\nBranch: main\\nRefspec: ${localHead}:refs/heads/main`, "u"));
  assert.doesNotMatch(pushConfirmation.message, /--force/iu);
});

test("push blocks a remote replacement during confirmation and requires a fresh preview", async () => {
  const root = await repository("push-destination-race");
  const origin = await tempDir("push-race-origin.git");
  const backup = await tempDir("push-race-backup.git");
  git(origin, "init", "--bare");
  git(backup, "init", "--bare");
  git(root, "remote", "add", "origin", origin);
  await stageTracked(root, "push destination race\n");
  const { commands } = extensionRegistration();
  let replaced = false;
  const harness = createContext(root, {
    actionMoves: [0, 0, 0, 0, 0, 1],
    editorValues: ["fix: bind push to confirmed destination"],
    confirm(title) {
      if (title === "Push this exact commit?" && !replaced) {
        replaced = true;
        git(root, "remote", "remove", "origin");
        git(root, "remote", "add", "backup", backup);
      }
      return true;
    },
  });
  await commands.get(COMMAND_NAME).handler("", harness.ctx);

  const createdOid = git(root, "rev-parse", "HEAD");
  for (const remote of [origin, backup]) {
    assert.notEqual(spawnSync("git", ["rev-parse", "refs/heads/main"], { cwd: remote, encoding: "utf8" }).status, 0);
    assert.notEqual(spawnSync("git", ["cat-file", "-e", `${createdOid}^{commit}`], { cwd: remote, encoding: "utf8" }).status, 0);
  }
  assert.equal(harness.confirmations.filter(({ title }) => title === "Push this exact commit?").length, 1);
  assert.ok(harness.notifications.some(({ message }) => /destination changed after confirmation.*No push was attempted/iu.test(message)));
  assert.ok(harness.renders.some(({ normal }) => /Remote: backup/u.test(normal.join("\n"))), "replacement destination must receive a fresh preview");
});

test("multiple remotes require an explicit native selection", async () => {
  const root = await repository("remote-select");
  const origin = await tempDir("origin.git");
  const backup = await tempDir("backup.git");
  git(origin, "init", "--bare");
  git(backup, "init", "--bare");
  git(root, "remote", "add", "origin", origin);
  git(root, "remote", "add", "backup", backup);
  await stageTracked(root);
  const { commands } = extensionRegistration();
  const harness = createContext(root, {
    actionMoves: [0, 0, 0, 0, 0, 0, 0],
    editorValues: ["feat: select backup remote"],
  });
  await commands.get(COMMAND_NAME).handler("", harness.ctx);
  const head = git(root, "rev-parse", "HEAD");
  assert.equal(git(backup, "rev-parse", "refs/heads/main"), head, "alphabetically first explicit selection should be backup");
  assert.notEqual(spawnSync("git", ["rev-parse", "refs/heads/main"], { cwd: origin, encoding: "utf8" }).status, 0);
  assert.ok(harness.renders.some(({ normal }) => /A remote will not be chosen silently/u.test(normal.join("\n"))));
});

test("session shutdown settles generation even when the provider ignores abort", async () => {
  const root = await repository("shutdown-non-cooperative");
  await stageTracked(root);
  const { commands, handlers } = extensionRegistration();
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  let observedSignal;
  const harness = createContext(root, {
    model: { id: "non-cooperative-model", provider: "test" },
    modelRegistry: {
      async complete(_model, _context, { signal }) {
        observedSignal = signal;
        startedResolve();
        return await new Promise(() => {});
      },
    },
    actionMoves: [0, 0],
  });
  const running = commands.get(COMMAND_NAME).handler("", harness.ctx);
  await started;
  await handlers.get("session_shutdown")({ type: "session_shutdown", reason: "reload" }, harness.ctx);
  await Promise.race([
    running,
    new Promise((_, reject) => setTimeout(() => reject(new Error("workflow did not settle after shutdown")), 250)),
  ]);
  assert.equal(observedSignal.aborted, true);
});

test("session shutdown aborts direct generation and duplicate invocation is refused", async () => {
  const root = await repository("shutdown");
  await stageTracked(root);
  const { commands, handlers } = extensionRegistration();
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  let observedSignal;
  const modelRegistry = {
    async complete(_model, _context, { signal }) {
      observedSignal = signal;
      startedResolve();
      return await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
  };
  const first = createContext(root, {
    model: { id: "slow-model", provider: "test" },
    modelRegistry,
    actionMoves: [0, 0],
  });
  const running = commands.get(COMMAND_NAME).handler("", first.ctx);
  await started;
  const second = createContext(root, { actionMoves: [] });
  await commands.get(COMMAND_NAME).handler("", second.ctx);
  assert.ok(second.notifications.some(({ message }) => /already active/u.test(message)));
  await handlers.get("session_shutdown")({ type: "session_shutdown", reason: "reload" }, first.ctx);
  await running;
  assert.equal(observedSignal.aborted, true);
});

test("package metadata and documentation expose only the approved package contract", async () => {
  const root = new URL("../", import.meta.url);
  const [packageRaw, readme, technical, development, catalog] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL("TECHNICAL.md", root), "utf8"),
    readFile(new URL("DEVELOPMENT.md", root), "utf8"),
    readFile(new URL("../../README.md", import.meta.url), "utf8"),
  ]);
  const pkg = JSON.parse(packageRaw);
  assert.equal(pkg.name, "@firstpick/pi-extension-git-guided-workflow");
  assert.deepEqual(pkg.pi.extensions, ["./index.ts"]);
  assert.deepEqual(pkg.files, ["index.ts", "src/core.ts", "README.md", "TECHNICAL.md", "DEVELOPMENT.md", "LICENSE"]);
  assert.equal(pkg.peerDependencies["@earendil-works/pi-tui"], "*");
  assert.match(readme, /pi install npm:@firstpick\/pi-extension-git-guided-workflow/u);
  assert.match(readme, /only after you select message generation/u);
  assert.match(technical, /1 MiB/u);
  assert.match(development, /tests\/tui\.test\.mjs/u);
  assert.match(catalog, /pi-extension-git-guided-workflow\/README\.md/u);
  for (const nonGoal of ["Create PR", "branch creation", "repository publication"]) assert.doesNotMatch(readme, new RegExp(nonGoal, "iu"));
});
