#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tests = readdirSync(path.join(packageRoot, "tests"))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => path.join("tests", name));

// Files run one at a time: the live Quickshell smoke is CPU-heavy and made the timing-sensitive
// backend tests flaky when they ran alongside it.
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...tests], {
  cwd: packageRoot,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
