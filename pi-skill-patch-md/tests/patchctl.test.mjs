import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const patchctl = path.resolve("skills/patch-md/scripts/patchctl.mjs");

function run(args, cwd, entrypoint = patchctl) {
  const child = spawnSync(process.execPath, [entrypoint, ...args], { cwd, encoding: "utf8", timeout: 30_000 });
  let payload;
  try { payload = JSON.parse(child.stdout); } catch { payload = { stdout: child.stdout, stderr: child.stderr }; }
  return { status: child.status, payload, stderr: child.stderr };
}

function symlinkedEntrypoint(script, parent) {
  const alias = path.join(parent, "scripts-alias");
  fs.symlinkSync(path.dirname(script), alias, process.platform === "win32" ? "junction" : "dir");
  return path.join(alias, path.basename(script));
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchctl-test-"));
  const stateDir = path.join(dir, "state");
  const target = path.join(dir, "target.txt");
  fs.writeFileSync(target, "before\n");
  const manifest = {
    schemaVersion: "2.0",
    id: "test.lifecycle",
    version: "1.0.0",
    title: "Lifecycle fixture",
    description: "Lifecycle fixture",
    risk: { level: "low", mutatesInstalledPackages: false, network: "none", billing: "none" },
    lifecycle: { handler: "./handler.mjs" },
    support: { platforms: ["linux", "darwin", "win32"], packages: [{ name: "fixture", range: ">=1.0.0 <2.0.0" }] },
    targets: [{ id: "fixture", role: "test", required: true, discover: { kind: "static" }, package: "fixture", fileCandidates: ["target.txt"], fingerprints: ["before"] }],
    verification: [{ id: "offline", phase: "post-apply", runner: "handler", network: false, billing: false }],
    rollback: { supported: true, strategy: "receipt-backup" },
    fixtureTarget: target
  };
  fs.writeFileSync(path.join(dir, "patch.manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(dir, "PATCH.md"), `# PATCH.md — Lifecycle fixture

## Purpose

Exercise patchctl.

### Root cause

Fixture is unpatched.

### Expected outcome

Fixture is patched.

## Lifecycle

**Manifest:** \`./patch.manifest.json\`

## Scope (exact files changed)

Files or logical targets:
1. \`target:fixture\`

## Change 1 — Patch fixture

**File:** \`target:fixture\`

### What was changed

Replace fixture content.

### Why

Exercise lifecycle.

## Verification steps

\`\`\`bash
node handler.mjs verify --manifest patch.manifest.json
\`\`\`

Expected:
- Fixture is patched.

## Rollback

\`\`\`bash
node handler.mjs rollback --manifest patch.manifest.json --receipt-file receipt.json
\`\`\`

- Restore receipt content.

## Operational notes

- Test fixture.
`);
  fs.writeFileSync(path.join(dir, "handler.mjs"), `import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const args=process.argv.slice(2); const action=args.shift();
function arg(name){const i=args.indexOf(name); return i>=0?args[i+1]:"";}
const manifest=JSON.parse(fs.readFileSync(arg("--manifest"),"utf8")); const target=manifest.fixtureTarget;
const hash=(value)=>createHash("sha256").update(value).digest("hex");
const before=fs.readFileSync(target,"utf8"); const patched="after\\n";
function out(value){process.stdout.write(JSON.stringify(value));}
if(action==="status") out({ok:true,targets:[{path:target,status:before===patched?"already-applied":"applicable"}]});
else if(action==="plan") out({ok:true,blocked:false,writes:before===patched?0:1,noop:before===patched,targets:[{path:target,beforeHash:hash(before),afterHash:hash(patched)}]});
else if(action==="apply") { const plan=JSON.parse(fs.readFileSync(arg("--plan-file"),"utf8")); if(plan.targets[0].beforeHash!==hash(before)) throw new Error("precondition drift"); const temp=target+"."+randomUUID()+".tmp"; fs.writeFileSync(temp,patched,{mode:0o600}); fs.renameSync(temp,target); out({ok:true,receipt:{targets:[{path:target,beforeContent:before,beforeHash:hash(before),afterHash:hash(patched)}]},result:{writes:1}}); }
else if(action==="verify") out({ok:fs.readFileSync(target,"utf8")===patched,checks:[{id:"content",passed:fs.readFileSync(target,"utf8")===patched}]});
else if(action==="rollback") { const receipt=JSON.parse(fs.readFileSync(arg("--receipt-file"),"utf8")); const entry=receipt.targets[0]; const current=fs.readFileSync(target,"utf8"); if(hash(current)!==entry.afterHash) throw new Error("rollback drift"); const temp=target+"."+randomUUID()+".tmp"; fs.writeFileSync(temp,entry.beforeContent,{mode:0o600}); fs.renameSync(temp,target); out({ok:true,result:{writes:1}}); }
else throw new Error("unknown action");
`);
  return { dir, stateDir, target };
}

test("patchctl binds apply to a plan hash, preserves idempotency, verifies, and rolls back", () => {
  const fixture = setup();
  const common = ["--patch", path.join(fixture.dir, "PATCH.md"), "--state-dir", fixture.stateDir];

  const status = run(["status", ...common], fixture.dir);
  assert.equal(status.status, 0, JSON.stringify(status.payload));
  assert.equal(status.payload.targets[0].status, "applicable");

  const unapproved = run(["apply", ...common], fixture.dir);
  assert.equal(unapproved.status, 1);
  assert.match(unapproved.payload.error, /plan-hash/u);
  assert.equal(fs.readFileSync(fixture.target, "utf8"), "before\n");

  const plan = run(["plan", ...common], fixture.dir);
  assert.equal(plan.status, 0, JSON.stringify(plan.payload));
  assert.match(plan.payload.planHash, /^[a-f0-9]{64}$/u);
  assert.equal(plan.payload.writes, 1);

  const mismatch = run(["apply", ...common, "--plan-hash", "0".repeat(64)], fixture.dir);
  assert.equal(mismatch.status, 1);
  assert.equal(fs.readFileSync(fixture.target, "utf8"), "before\n");

  const applied = run(["apply", ...common, "--plan-hash", plan.payload.planHash], fixture.dir);
  assert.equal(applied.status, 0, JSON.stringify(applied.payload));
  assert.equal(applied.payload.ok, true);
  assert.equal(fs.readFileSync(fixture.target, "utf8"), "after\n");
  assert.equal(fs.statSync(applied.payload.receiptPath).mode & 0o777, 0o600);

  const verify = run(["verify", ...common], fixture.dir);
  assert.equal(verify.status, 0, JSON.stringify(verify.payload));
  assert.equal(verify.payload.ok, true);

  const secondPlan = run(["plan", ...common], fixture.dir);
  assert.equal(secondPlan.payload.writes, 0);
  const secondApply = run(["apply", ...common, "--plan-hash", secondPlan.payload.planHash], fixture.dir);
  assert.equal(secondApply.status, 0, JSON.stringify(secondApply.payload));
  assert.equal(secondApply.payload.noop, true);
  assert.equal(fs.readFileSync(fixture.target, "utf8"), "after\n");

  const rollbackWithoutConfirmation = run(["rollback", ...common], fixture.dir);
  assert.equal(rollbackWithoutConfirmation.status, 1);
  assert.equal(fs.readFileSync(fixture.target, "utf8"), "after\n");

  const rollback = run(["rollback", ...common, "--confirm"], fixture.dir);
  assert.equal(rollback.status, 0, JSON.stringify(rollback.payload));
  assert.equal(fs.readFileSync(fixture.target, "utf8"), "before\n");
  assert.ok(fs.existsSync(rollback.payload.archivedReceiptPath));
});

test("patchctl runs when its entrypoint parent is symlinked", () => {
  const fixture = setup();
  const entrypoint = symlinkedEntrypoint(patchctl, fixture.dir);
  const result = run([
    "status",
    "--patch", path.join(fixture.dir, "PATCH.md"),
    "--state-dir", fixture.stateDir,
  ], fixture.dir, entrypoint);

  assert.equal(result.status, 0, JSON.stringify(result.payload));
  assert.equal(result.payload.action, "status");
  assert.equal(result.payload.targets[0].status, "applicable");
});

test("handler output containing likely secrets is rejected without echoing the value", () => {
  const fixture = setup();
  fs.writeFileSync(path.join(fixture.dir, "handler.mjs"), 'process.stdout.write(JSON.stringify({ok:true,authorization:"Bearer hidden-secret-material"}));\n');
  const result = run(["status", "--patch", path.join(fixture.dir, "PATCH.md"), "--state-dir", fixture.stateDir], fixture.dir);
  assert.equal(result.status, 1);
  assert.match(result.payload.error, /forbidden sensitive field/u);
  assert.ok(!JSON.stringify(result.payload).includes("hidden-secret-material"));
});

test("rollback refuses drifted targets", () => {
  const fixture = setup();
  const common = ["--patch", path.join(fixture.dir, "PATCH.md"), "--state-dir", fixture.stateDir];
  const plan = run(["plan", ...common], fixture.dir);
  const applied = run(["apply", ...common, "--plan-hash", plan.payload.planHash], fixture.dir);
  assert.equal(applied.status, 0, JSON.stringify(applied.payload));
  fs.writeFileSync(fixture.target, "external drift\n");
  const rollback = run(["rollback", ...common, "--confirm"], fixture.dir);
  assert.equal(rollback.status, 1);
  assert.match(rollback.payload.error, /rollback.*failed|drift/iu);
  assert.equal(fs.readFileSync(fixture.target, "utf8"), "external drift\n");
});
