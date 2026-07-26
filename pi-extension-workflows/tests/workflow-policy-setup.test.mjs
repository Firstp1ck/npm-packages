import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import workflowExtension from "../index.ts";
import {
  WorkflowPolicyStaleRevisionError,
  WorkflowPolicyValidationError,
  createDeniedWorkflowPolicy,
  getWorkflowPolicyPath,
  WORKFLOW_POLICY_SUGGESTIONS,
  readWorkflowPolicyState,
  validateWorkflowPolicy,
  writeWorkflowPolicyState,
} from "../src/workflow-policy.mjs";

const temp = await mkdtemp(path.join(os.tmpdir(), "workflow-policy-setup-test-"));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

function policy(overrides = {}) {
  return {
    schemaVersion: 1,
    permissions: { write: false, shell: false, network: false },
    shellAllowlist: [],
    networkAllowlist: [],
    verificationCommands: [],
    ...overrides,
  };
}

function createExtensionHarness() {
  const commands = new Map();
  workflowExtension({
    registerCommand(name, definition) { commands.set(name, definition); },
    registerTool() {},
    getActiveTools() { return []; },
    getAllTools() { return []; },
    setActiveTools() {},
    on() {},
    events: { on() {}, emit() {} },
  });
  return commands;
}

try {
  assert.equal(
    getWorkflowPolicyPath("~/.pi/custom-workflow-agent"),
    path.join(os.homedir(), ".pi", "custom-workflow-agent", "workflow-policy.json"),
    "explicit and environment-style agent directories must expand a leading tilde like pi-utils getAgentDir",
  );

  assert.deepEqual(JSON.parse(JSON.stringify(WORKFLOW_POLICY_SUGGESTIONS)), {
    shellAllowlist: ["git", "node", "npm"],
    networkAllowlist: ["api.github.com", "registry.npmjs.org"],
    verificationCommands: [["npm", "test"], ["npm", "run", "lint"]],
  }, "suggestions must be JSON-safe exact policy values");
  assert.equal(Object.isFrozen(WORKFLOW_POLICY_SUGGESTIONS), true);
  assert.equal(Object.isFrozen(WORKFLOW_POLICY_SUGGESTIONS.shellAllowlist), true);
  assert.equal(Object.isFrozen(WORKFLOW_POLICY_SUGGESTIONS.verificationCommands), true);
  assert.equal(Object.isFrozen(WORKFLOW_POLICY_SUGGESTIONS.verificationCommands[0]), true);
  assert.throws(() => { WORKFLOW_POLICY_SUGGESTIONS.verificationCommands[0].push("unexpected"); }, TypeError);

  const agentDir = path.join(temp, "service-agent");
  const missing = await readWorkflowPolicyState({ agentDir });
  assert.equal(missing.exists, false);
  assert.equal(missing.revision, null);
  assert.deepEqual(missing.policy, createDeniedWorkflowPolicy());
  await assert.rejects(() => lstat(missing.filePath), { code: "ENOENT" }, "reading a missing policy must not create it");

  const normalized = validateWorkflowPolicy(policy({
    permissions: { write: true, shell: false, network: true },
    shellAllowlist: [" npm ", "git", "npm"],
    networkAllowlist: ["docs.example.com", " api.example.com ", "docs.example.com"],
    verificationCommands: [["npm", "test"], ["node", "-e", "process.exit(0)"]],
  }));
  assert.deepEqual(normalized.shellAllowlist, ["git", "npm"]);
  assert.deepEqual(normalized.networkAllowlist, ["api.example.com", "docs.example.com"]);
  assert.throws(() => validateWorkflowPolicy({ ...policy(), extra: true }), WorkflowPolicyValidationError);
  assert.deepEqual(
    validateWorkflowPolicy({ schemaVersion: 1, permissions: { write: true } }),
    policy({ permissions: { write: true, shell: false, network: false } }),
    "the canonical service must preserve the runtime's v1 compatibility for omitted deny-default fields",
  );

  const saved = await writeWorkflowPolicyState({ agentDir, expectedRevision: missing.revision, policy: normalized });
  assert.equal(saved.exists, true);
  assert.match(saved.revision, /^sha256:[a-f0-9]{64}$/);
  const metadata = await lstat(saved.filePath);
  assert.equal(metadata.mode & 0o777, 0o600, "workflow policy must be private");
  assert.deepEqual((await readWorkflowPolicyState({ agentDir })).policy, normalized);
  assert.deepEqual(await readdir(agentDir), ["workflow-policy.json"], "atomic write must not leave temporary files");
  await assert.rejects(
    () => writeWorkflowPolicyState({ agentDir, expectedRevision: null, policy: createDeniedWorkflowPolicy() }),
    WorkflowPolicyStaleRevisionError,
  );

  const malformedDir = path.join(temp, "malformed-agent");
  await mkdir(malformedDir, { recursive: true });
  await writeFile(path.join(malformedDir, "workflow-policy.json"), "{ definitely-not-json");
  await assert.rejects(() => readWorkflowPolicyState({ agentDir: malformedDir }), WorkflowPolicyValidationError);
  await assert.rejects(
    () => writeWorkflowPolicyState({ agentDir: malformedDir, expectedRevision: null, policy: createDeniedWorkflowPolicy() }),
    WorkflowPolicyValidationError,
    "a malformed policy must not be silently replaced",
  );

  const symlinkDir = path.join(temp, "symlink-agent");
  const outsidePolicy = path.join(temp, "outside-policy.json");
  await mkdir(symlinkDir, { recursive: true });
  await writeFile(outsidePolicy, JSON.stringify(policy()));
  await symlink(outsidePolicy, path.join(symlinkDir, "workflow-policy.json"));
  const symlinkState = await readWorkflowPolicyState({ agentDir: symlinkDir });
  assert.deepEqual(symlinkState.policy, policy(), "runtime reads must preserve v1 compatibility for symlinked policy files");
  await assert.rejects(
    () => writeWorkflowPolicyState({ agentDir: symlinkDir, expectedRevision: symlinkState.revision, policy: createDeniedWorkflowPolicy() }),
    /not a regular file/,
    "setup writes must refuse replacing a symlink target",
  );

  const commands = createExtensionHarness();
  assert.ok(commands.has("workflow-setup"), "/workflow-setup must be registered for Pi command discovery");
  const setup = commands.get("workflow-setup").handler;

  const tuiAgentDir = path.join(temp, "tui-agent");
  process.env.PI_CODING_AGENT_DIR = tuiAgentDir;
  const notifications = [];
  let review = "";
  const editorValues = [" npm \ngit\nnpm\n", "docs.example.com\napi.example.com\n", "[\"npm\",\"test\"]\n"];
  await setup("", {
    cwd: temp,
    hasUI: true,
    ui: {
      notify(message, level) { notifications.push({ message, level }); },
      async select(_title, options) { return options[0]; },
      async editor() { return editorValues.shift(); },
      async confirm(_title, message) { review = message; return true; },
    },
  });
  const tuiState = await readWorkflowPolicyState({ agentDir: tuiAgentDir });
  assert.equal(tuiState.exists, true);
  assert.deepEqual(tuiState.policy, policy({
    permissions: { write: true, shell: true, network: true },
    shellAllowlist: ["git", "npm"],
    networkAllowlist: ["api.example.com", "docs.example.com"],
    verificationCommands: [["npm", "test"]],
  }));
  assert.match(review, new RegExp(tuiState.filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(review, /Normalized policy:[\s\S]*"verificationCommands"/);
  assert.equal(notifications.at(-1).level, "success");

  const suggestedTuiAgentDir = path.join(temp, "suggested-tui-agent");
  const suggestedInitial = await readWorkflowPolicyState({ agentDir: suggestedTuiAgentDir });
  await writeWorkflowPolicyState({
    agentDir: suggestedTuiAgentDir,
    expectedRevision: suggestedInitial.revision,
    policy: policy({
      shellAllowlist: ["manual-shell", "git"],
      networkAllowlist: ["manual.example.com", "registry.npmjs.org"],
      verificationCommands: [["manual", "verify"]],
    }),
  });
  process.env.PI_CODING_AGENT_DIR = suggestedTuiAgentDir;
  const selectionCalls = [];
  const selectionChoices = [
    "Configure global policy",
    "Deny write (currently denied)",
    "Deny shell (currently denied)",
    "Deny network (currently denied)",
    "Add: node",
    "Add: npm",
    "Continue to manual editor",
    "Add: api.github.com",
    "Continue to manual editor",
    "Add: [\"npm\",\"run\",\"lint\"]",
    "Add: [\"npm\",\"test\"]",
    "Continue to manual editor",
  ];
  const editorInitialValues = [];
  let suggestionReview = "";
  await setup("", {
    cwd: temp,
    hasUI: true,
    ui: {
      notify() {},
      async select(title, options) {
        selectionCalls.push({ title, options });
        const choice = selectionChoices.shift();
        assert.ok(options.includes(choice), `${title} must expose '${choice}'`);
        return choice;
      },
      async editor(title, initialValue) {
        editorInitialValues.push({ title, initialValue });
        if (title.startsWith("Shell")) return `${initialValue}\nmanual-shell-added`;
        if (title.startsWith("Network")) return `${initialValue}\nmanual.example-added`;
        return `${initialValue}\n[\"manual\",\"added\"]`;
      },
      async confirm(_title, message) { suggestionReview = message; return true; },
    },
  });
  assert.deepEqual(selectionChoices, [], "all suggestion selectors must support repeated explicit additions");
  assert.deepEqual(
    selectionCalls.filter((call) => call.title === "Shell executable suggestions").map((call) => call.options),
    [
      ["Continue to manual editor", "Add: node", "Add: npm", "Cancel setup"],
      ["Continue to manual editor", "Add: npm", "Cancel setup"],
      ["Continue to manual editor", "Cancel setup"],
    ],
    "present and added shell suggestions must be hidden from later choices",
  );
  assert.deepEqual(
    selectionCalls.filter((call) => call.title === "Network host suggestions").map((call) => call.options),
    [
      ["Continue to manual editor", "Add: api.github.com", "Cancel setup"],
      ["Continue to manual editor", "Cancel setup"],
    ],
    "present network suggestions must be hidden from choices",
  );
  assert.deepEqual(editorInitialValues, [
    { title: "Shell executable allowlist (one entry per line; not an OS sandbox)", initialValue: "git\nmanual-shell\nnode\nnpm" },
    { title: "Network host allowlist (one entry per line)", initialValue: "manual.example.com\nregistry.npmjs.org\napi.github.com" },
    { title: "Verification commands (one JSON argv array per line)", initialValue: "[\"manual\",\"verify\"]\n[\"npm\",\"run\",\"lint\"]\n[\"npm\",\"test\"]" },
  ], "manual editors must receive current and explicitly added values");
  const suggestedTuiState = await readWorkflowPolicyState({ agentDir: suggestedTuiAgentDir });
  assert.deepEqual(suggestedTuiState.policy, policy({
    permissions: { write: false, shell: false, network: false },
    shellAllowlist: ["git", "manual-shell", "manual-shell-added", "node", "npm"],
    networkAllowlist: ["api.github.com", "manual.example-added", "manual.example.com", "registry.npmjs.org"],
    verificationCommands: [["manual", "verify"], ["npm", "run", "lint"], ["npm", "test"], ["manual", "added"]],
  }), "suggestions must preserve manual entries, selected verification order, and denied permissions");
  assert.deepEqual(
    Object.keys(JSON.parse(await readFile(suggestedTuiState.filePath, "utf8"))).sort(),
    ["schemaVersion", "permissions", "shellAllowlist", "networkAllowlist", "verificationCommands"].sort(),
    "suggestions must not add v1 persisted fields",
  );
  assert.match(suggestionReview, /"permissions": \{\n\s+"write": false/);

  const suggestionCancelledAgentDir = path.join(temp, "suggestion-cancelled-agent");
  process.env.PI_CODING_AGENT_DIR = suggestionCancelledAgentDir;
  const suggestionCancellationChoices = [
    "Configure global policy",
    "Deny write (currently denied)",
    "Deny shell (currently denied)",
    "Deny network (currently denied)",
    "Cancel setup",
  ];
  await setup("", {
    cwd: temp,
    hasUI: true,
    ui: {
      notify() {},
      async select(_title, options) {
        const choice = suggestionCancellationChoices.shift();
        assert.ok(options.includes(choice));
        return choice;
      },
      async editor() { throw new Error("cancelling a suggestion selector must not open an editor"); },
      async confirm() { throw new Error("cancelling a suggestion selector must not request confirmation"); },
    },
  });
  assert.equal((await readWorkflowPolicyState({ agentDir: suggestionCancelledAgentDir })).exists, false, "cancelling a suggestion selector must not write a policy");

  const cancelledAgentDir = path.join(temp, "cancelled-agent");
  process.env.PI_CODING_AGENT_DIR = cancelledAgentDir;
  await setup("", {
    cwd: temp,
    hasUI: true,
    ui: {
      notify() {},
      async select() { return "Cancel setup"; },
      async editor() { throw new Error("cancelled setup must not open an editor"); },
      async confirm() { throw new Error("cancelled setup must not request confirmation"); },
    },
  });
  assert.equal((await readWorkflowPolicyState({ agentDir: cancelledAgentDir })).exists, false, "cancelling setup must not create a policy");

  const declinedAgentDir = path.join(temp, "declined-agent");
  process.env.PI_CODING_AGENT_DIR = declinedAgentDir;
  await setup("", {
    cwd: temp,
    hasUI: true,
    ui: {
      notify() {},
      async select() { return "Reset global policy to deny-by-default"; },
      async editor() { throw new Error("reset setup must not open an editor"); },
      async confirm() { return false; },
    },
  });
  assert.equal((await readWorkflowPolicyState({ agentDir: declinedAgentDir })).exists, false, "declining review must not create a policy");

  const malformedTuiAgentDir = path.join(temp, "malformed-tui-agent");
  await mkdir(malformedTuiAgentDir, { recursive: true });
  await writeFile(path.join(malformedTuiAgentDir, "workflow-policy.json"), "not-json");
  process.env.PI_CODING_AGENT_DIR = malformedTuiAgentDir;
  const malformedNotifications = [];
  await setup("", {
    cwd: temp,
    hasUI: true,
    ui: {
      notify(message, level) { malformedNotifications.push({ message, level }); },
      async select() { throw new Error("malformed policy must not enter setup"); },
      async editor() { throw new Error("malformed policy must not enter setup"); },
      async confirm() { throw new Error("malformed policy must not enter setup"); },
    },
  });
  assert.equal(malformedNotifications.at(-1).level, "error");
  assert.match(malformedNotifications.at(-1).message, /invalid JSON/);
} finally {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(temp, { recursive: true, force: true });
}

console.log("workflow policy setup tests passed");
