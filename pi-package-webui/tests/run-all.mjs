import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = dirname(fileURLToPath(import.meta.url));
const files = (await readdir(testsDir)).filter((name) => name.endsWith(".test.mjs")).sort();

const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, [join(testsDir, file)], {
    stdio: "inherit",
    env: { ...process.env, PI_WEBUI_RPC_SUPERVISOR: "0" },
  });
  if (result.status !== 0) failures.push(`${file} (exit ${result.status ?? "signal"})`);
}

if (failures.length) {
  console.error(`\n${failures.length}/${files.length} test file(s) failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`\nall ${files.length} test files passed`);
