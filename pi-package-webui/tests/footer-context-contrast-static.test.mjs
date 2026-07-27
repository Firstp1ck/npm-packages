import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const progressOverlay = css.match(/\.footer-context-card\.has-context-usage::before\s*\{([^}]+)\}/)?.[1] ?? "";

assert.match(progressOverlay, /background:\s*var\(--context-card-gradient\)/, "context usage should retain its themed progress gradient");
assert.match(progressOverlay, /opacity:\s*0\.34/, "context progress should stay translucent enough for readable text");

console.log("footer context contrast static tests passed");
