import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");

assert.match(
  app,
  /function surfaceRuntimeDiagnostic\(title, content, level = "error"\)[\s\S]*?addEvent\(message, level\);[\s\S]*?addTransientMessage\(\{ role: level === "error" \? "error" : "warn", title, content: message, level \}\);/,
  "runtime diagnostics should be written to both the event log and the visible transcript",
);
assert.match(
  app,
  /function assistantStreamErrorMessage\(event,[\s\S]*?update\.error\?\.errorMessage[\s\S]*?update\.partial\?\.errorMessage[\s\S]*?event\?\.message\?\.errorMessage/,
  "assistant stream errors should prefer the provider's detailed final error message",
);
assert.match(
  app,
  /update\.type === "error"[\s\S]*?streamProviderErrorText = assistantStreamErrorMessage\(event, update\)[\s\S]*?content: streamProviderErrorText/,
  "streaming provider errors should immediately render their detailed text",
);
assert.match(
  app,
  /case "message_end":[\s\S]*?event\.message\.stopReason === "error"[\s\S]*?surfaceRuntimeDiagnostic\("Assistant error", message\)/,
  "final assistant errors should remain visible after transcript reconciliation",
);
for (const eventType of ["pi_process_exit", "pi_process_error", "pi_stderr", "pi_stderr_sink_error", "pi_stdout_line_too_large", "pi_stdout_parse_error"]) {
  assert.match(app, new RegExp(`case "${eventType}":[\\s\\S]*?surfaceRuntimeDiagnostic\\(`), `${eventType} should surface in the transcript`);
}
assert.match(
  app,
  /case "compaction_end":[\s\S]*?event\.errorMessage[\s\S]*?surfaceRuntimeDiagnostic\("Compaction error", event\.errorMessage\)/,
  "compaction failures should surface in the transcript",
);
assert.match(
  app,
  /case "response":[\s\S]*?event\.success === false[\s\S]*?surfaceRuntimeDiagnostic\(/,
  "failed RPC command responses should surface in the transcript",
);

console.log("runtime error visibility test passed");
