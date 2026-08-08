import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
spawn(process.execPath, [join(fixtureDir, "tree-timeout-descendant.mjs"), process.argv[2]], {
  stdio: "ignore",
  windowsHide: true,
});
console.log("descendant-started");
setInterval(() => {}, 1_000);
