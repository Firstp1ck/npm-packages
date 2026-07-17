import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parsePatch, parsePatchFile } from "../skills/patch-md/scripts/patch_md_extract.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "patch-md-parser-"));
}

function manifest(handler = "./handler.mjs") {
  return {
    schemaVersion: "2.0",
    id: "test.patch",
    version: "1.0.0",
    title: "Test patch",
    description: "Test lifecycle patch",
    risk: { level: "low", mutatesInstalledPackages: false, network: "none", billing: "none" },
    lifecycle: { handler },
    support: { platforms: ["linux", "darwin", "win32"], packages: [{ name: "test-package", range: ">=1.0.0 <2.0.0" }] },
    targets: [{ id: "test", role: "fixture", required: true, discover: { kind: "fixture" }, package: "test-package", fileCandidates: ["target.js"], fingerprints: ["fixture-v1"] }],
    verification: [{ id: "offline", phase: "post-apply", runner: "handler", network: false, billing: false }],
    rollback: { supported: true, strategy: "receipt-backup" }
  };
}

function patchText({ scope = "target:test", changeFiles = ["target:test"], extraPurpose = "", verificationBlocks, newline = "\n" } = {}) {
  const blocks = verificationBlocks ?? ["node --check target.js", "node verify.mjs\n--second-line-is-not-a-command"];
  const text = `# PATCH.md — Parser fixture

## Purpose

Fixture purpose.${extraPurpose}

### Root cause

Fixture root cause.

### Expected outcome

Fixture outcome.

## Lifecycle

**Manifest:** \`./patch.manifest.json\`

## Scope (exact files changed)

Path variables:

- \`ROOT=\${HOME}/fixture\`

Files or logical targets:
1. \`${scope}\`

## Change 1 — Fixture change

**Files:**
${changeFiles.map((file) => `- \`${file}\``).join("\n")}

### What was changed

Fixture transformation.

### Why

Fixture reason.

## Verification steps

Run from \`.\`:

${blocks.map((block) => `\`\`\`bash\n${block}\n\`\`\``).join("\n\n")}

Expected:
- Fixture passes.

## Rollback

\`\`\`bash
node rollback.mjs --confirm
\`\`\`

- Restore the receipt backup.

## Operational notes

- Fixture only.
`;
  return text.replace(/\n/g, newline);
}

function writeFixture(dir, markdown = patchText(), manifestData = manifest()) {
  fs.writeFileSync(path.join(dir, "PATCH.md"), markdown);
  fs.writeFileSync(path.join(dir, "patch.manifest.json"), JSON.stringify(manifestData, null, 2));
  fs.writeFileSync(path.join(dir, "handler.mjs"), "// fixture lifecycle handler\n");
  return path.join(dir, "PATCH.md");
}

test("strict v2 preserves every shell fence and nested variables resolve", () => {
  const dir = tempDir();
  const patchPath = writeFixture(dir);
  const result = parsePatchFile(patchPath, { strict: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.schemaVersion, "2.0");
  assert.equal(result.patch.verification.shellBlocks.length, 2);
  assert.equal(result.patch.verification.shellBlocks[1], "node verify.mjs\n--second-line-is-not-a-command");
  assert.equal(result.patch.scopeFiles[0], "target:test");
  assert.equal(result.patch.lifecycle.manifest.id, "test.patch");
});

test("strict v2 supports CRLF without changing command semantics", () => {
  const dir = tempDir();
  const patchPath = writeFixture(dir, patchText({ newline: "\r\n" }));
  const result = parsePatchFile(patchPath, { strict: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.patch.verification.shellBlocks.length, 2);
  assert.match(result.patch.verification.shellBlocks[1], /\n--second-line/u);
});

test("duplicate fixed headings are rejected", () => {
  const dir = tempDir();
  const markdown = patchText().replace("## Lifecycle", "## Purpose\n\nduplicate\n\n## Lifecycle");
  const result = parsePatchFile(writeFixture(dir, markdown), { strict: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "DUPLICATE_SECTION" && error.section === "purpose"));
});

test("scope and changes must map exactly", () => {
  const dir = tempDir();
  const result = parsePatchFile(writeFixture(dir, patchText({ scope: "target:one", changeFiles: ["target:two"] })), { strict: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "UNMAPPED_SCOPE_FILE"));
  assert.ok(result.errors.some((error) => error.code === "CHANGE_OUTSIDE_SCOPE"));
});

test("nested variables resolve recursively and cycles fail closed", () => {
  const dir = tempDir();
  const nested = patchText({ scope: "${ROOT}/target.js", changeFiles: ["${ROOT}/target.js"] });
  const nestedResult = parsePatchFile(writeFixture(dir, nested), { strict: true });
  assert.equal(nestedResult.ok, true, JSON.stringify(nestedResult.errors));
  assert.equal(nestedResult.patch.scopeFiles[0], path.posix.join(os.homedir().replace(/\\/gu, "/"), "fixture/target.js"));

  const cycleDir = tempDir();
  const cycle = patchText({ scope: "${ROOT}/target.js", changeFiles: ["${ROOT}/target.js"] }).replace("- `ROOT=${HOME}/fixture`", "- `ROOT=${OTHER}/fixture`\n- `OTHER=${ROOT}`");
  const cycleResult = parsePatchFile(writeFixture(cycleDir, cycle), { strict: true });
  assert.equal(cycleResult.ok, false);
  assert.ok(cycleResult.errors.some((error) => error.code === "CYCLIC_PATH_VARIABLE"));
});

test("manifest and handler paths cannot escape the patch directory", () => {
  const dir = tempDir();
  const markdown = patchText().replace("./patch.manifest.json", "../patch.manifest.json");
  const result = parsePatch(markdown, { strict: true, patchPath: path.join(dir, "PATCH.md") });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "MANIFEST_PATH_ESCAPE"));
});

test("v2 manifest risk, support, target, verification, and rollback contracts are enforced", () => {
  const dir = tempDir();
  const invalid = manifest();
  invalid.risk.network = "surprise";
  invalid.support.platforms = [];
  invalid.targets[0].fingerprints = [];
  invalid.verification[0].network = "no";
  invalid.rollback.strategy = "unknown";
  const result = parsePatchFile(writeFixture(dir, patchText(), invalid), { strict: true });
  assert.equal(result.ok, false);
  const messages = result.errors.filter((error) => error.code === "INVALID_MANIFEST").map((error) => error.message).join("\n");
  assert.match(messages, /risk\.network/u);
  assert.match(messages, /support\.platforms/u);
  assert.match(messages, /fingerprints/u);
  assert.match(messages, /network and billing booleans/u);
  assert.match(messages, /rollback/u);
});

test("non-contiguous change numbering is rejected", () => {
  const dir = tempDir();
  const markdown = patchText().replace("## Change 1 —", "## Change 2 —");
  const result = parsePatchFile(writeFixture(dir, markdown), { strict: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "NON_CONTIGUOUS_CHANGES"));
});

test("legacy documents are migration-only", () => {
  const legacy = `# PATCH.md — Legacy\n\n## Purpose\n\nPurpose.\n\n### Root cause\n\nCause.\n\n### Expected outcome\n\nOutcome.\n\n## Scope (exact files changed)\n\nFiles:\n1. \`a.js\`\n\n## Change 1 — Change\n\n**File:** \`a.js\`\n\n### What was changed\n\nChanged.\n\n### Why\n\nReason.\n\n## Verification steps\n\n\`\`\`bash\nnode --check a.js\n\`\`\`\n\n## Operational notes\n\n- Legacy.\n`;
  const strict = parsePatch(legacy, { strict: true, patchPath: "/tmp/PATCH.md" });
  assert.equal(strict.ok, false);
  assert.ok(strict.errors.some((error) => error.section === "lifecycle"));
  const migration = parsePatch(legacy, { strict: false, patchPath: "/tmp/PATCH.md" });
  assert.equal(migration.ok, true, JSON.stringify(migration.errors));
  assert.ok(migration.warnings.some((warning) => warning.includes("no machine-readable lifecycle manifest")));
});
