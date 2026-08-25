#!/usr/bin/env node
import { writeFile } from "node:fs/promises";

const capturePath = process.env.FAKE_QUICKSHELL_CAPTURE_PATH;
if (!capturePath) {
  console.error("fake-quickshell: FAKE_QUICKSHELL_CAPTURE_PATH is required");
  process.exit(2);
}

const qtWebUiEnvironment = Object.fromEntries(
  Object.entries(process.env)
    .filter(([name]) => name.startsWith("QT_WEBUI_"))
    .sort(([left], [right]) => left.localeCompare(right)),
);

await writeFile(capturePath, `${JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: qtWebUiEnvironment,
})}\n`);

process.exitCode = Number.parseInt(process.env.FAKE_QUICKSHELL_EXIT_CODE ?? "0", 10);
