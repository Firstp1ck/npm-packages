import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");

assert.match(
  app,
  /renderContent\(body, message\.content, \{ markdown: message\.role === "assistant" \|\| message\.role === "custom" \}\)/,
  "assistant and custom message output should render as Markdown",
);

console.log("custom message Markdown static check passed");
