#!/usr/bin/env node
// Fake playback tool for companion integration tests. Counts the PCM bytes it
// receives on stdin and writes the total to the file given as argv[2] when
// stdin ends. Ignores a trailing {rate} argv token.
// Usage: node fake-playback.mjs <outFile> [rate]
import { appendFileSync } from "node:fs";

const outFile = process.argv[2];
let total = 0;

process.stdin.on("data", (chunk) => {
  total += chunk.length;
});
process.stdin.on("end", () => {
  if (outFile) appendFileSync(outFile, `${total}\n`);
  process.exit(0);
});
