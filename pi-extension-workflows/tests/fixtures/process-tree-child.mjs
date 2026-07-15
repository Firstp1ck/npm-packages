import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const pidFile = process.argv.at(-1);
if (!pidFile) throw new Error("missing pid file prompt");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
});
writeFileSync(pidFile, String(child.pid), "utf8");
setInterval(() => {}, 1000);
