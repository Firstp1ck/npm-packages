import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseSimpleShellCommand, validateShellCommand } from "../src/shell-command-policy.ts";
import workflowGuard from "../src/subprocess-policy-guard.ts";

const parse = parseSimpleShellCommand("git log --format='%(refname:short)' \"two words\"");
assert.equal(parse.ok, true);
if (parse.ok) {
  assert.deepEqual(parse.command.argv, ["git", "log", "--format=%(refname:short)", "two words"]);
  assert.equal(parse.command.executable, "git");
}

assert.equal(validateShellCommand("git status --short", ["git"]).ok, true);
for (const command of [
  undefined,
  "",
  " \t ",
  "git status\nwhoami",
  "git status; whoami",
  "git status | cat",
  "git status && whoami",
  "git > output",
  "git *",
  "git status # comment",
  "git ~",
  "git {status,log}",
  "git $(whoami)",
  "git `whoami`",
  "git 'unterminated",
  "git \\; whoami",
  "/usr/bin/git status",
  "./git status",
  '"git" status',
  "g\\it status",
  "FOO=bar git status",
  `git status ${String.fromCharCode(0x7f)}`,
]) {
  assert.equal(validateShellCommand(command, ["git"]).ok, false, command ?? "missing command");
}
assert.equal(validateShellCommand("git \"\"", ["git"]).ok, true, "quoted empty arguments remain stable and are allowed");
assert.equal(validateShellCommand("npm test", ["git"]).ok, false);

function createGuard(policy) {
  process.env.PI_WORKFLOW_AGENT_POLICY = JSON.stringify(policy);
  let handler;
  workflowGuard({
    on(name, callback) {
      if (name === "tool_call") handler = callback;
    },
  });
  assert.ok(handler, "guard must register a tool_call handler");
  return handler;
}

const temp = await mkdtemp(path.join(os.tmpdir(), "workflow-shell-policy-test-"));
const originalPolicy = process.env.PI_WORKFLOW_AGENT_POLICY;
try {
  const root = path.join(temp, "root");
  await mkdir(root);
  const fullPolicy = {
    root,
    permissions: { write: true, shell: true, network: true },
    allowedTools: ["read", "write", "bash", "fetch_content"],
    shellAllowlist: ["git"],
    networkAllowlist: ["example.com"],
  };
  const guard = createGuard(fullPolicy);
  assert.equal(await guard({ toolName: "bash", input: { command: "git status --short" } }), undefined);
  assert.match((await guard({ toolName: "bash", input: { command: "npm test" } })).reason, /shell allowlist/);
  assert.match((await guard({ toolName: "bash", input: { command: "git status; whoami" } })).reason, /operators/);
  assert.match((await guard({ toolName: "bash", input: {} })).reason, /non-empty command/);
  assert.equal(await guard({ toolName: "write", input: { path: "inside.txt" } }), undefined);
  assert.match((await guard({ toolName: "write", input: { path: "../outside.txt" } })).reason, /outside isolated root/);
  assert.equal(await guard({ toolName: "fetch_content", input: { url: "https://example.com/docs" } }), undefined);
  assert.match((await guard({ toolName: "fetch_content", input: { url: "https://evil.invalid" } })).reason, /allowlist denied/);

  const toolDenied = createGuard({ ...fullPolicy, allowedTools: ["read"] });
  assert.match((await toolDenied({ toolName: "bash", input: { command: "git status" } })).reason, /denied tool 'bash'/);

  const shellDenied = createGuard({ ...fullPolicy, permissions: { ...fullPolicy.permissions, shell: false } });
  assert.match((await shellDenied({ toolName: "bash", input: { command: "git status" } })).reason, /denied shell access/);

  assert.throws(
    () => createGuard({ root, allowedTools: ["read"] }),
    /Workflow agent policy is invalid/,
    "malformed subprocess policies must fail closed at extension load",
  );
} finally {
  if (originalPolicy === undefined) delete process.env.PI_WORKFLOW_AGENT_POLICY;
  else process.env.PI_WORKFLOW_AGENT_POLICY = originalPolicy;
  await rm(temp, { recursive: true, force: true });
}

console.log("shell command policy tests passed");
