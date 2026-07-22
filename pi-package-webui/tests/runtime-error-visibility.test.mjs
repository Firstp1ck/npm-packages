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
  /case "message_end":[\s\S]*?event\.message\.stopReason === "error"[\s\S]*?surfaceRuntimeDiagnostic\("Assistant error", message\)[\s\S]*?assistantErrorSurfacedThisRun = true/,
  "final assistant errors should remain visible after transcript reconciliation",
);
assert.match(
  app,
  /function assistantErrorFromAgentEnd\(event\)[\s\S]*?event\?\.messages[\s\S]*?findLast\(\(item\) => item\?\.role === "assistant"\)[\s\S]*?message\?\.stopReason !== "error"[\s\S]*?message\.errorMessage/,
  "agent_end should recover provider errors from its terminal assistant message",
);
assert.match(
  app,
  /case "agent_end":[\s\S]*?!assistantErrorSurfacedThisRun && event\.willRetry !== true[\s\S]*?assistantErrorFromAgentEnd\(event\)[\s\S]*?surfaceRuntimeDiagnostic\("Assistant error", message\)/,
  "agent_end should visibly surface a non-retrying provider error when message_end was absent",
);
assert.match(
  app,
  /function toolImagePayloadError\(event\)[\s\S]*?event\?\.result\?\.content[\s\S]*?block\?\.type !== "image"[\s\S]*?btoa\(atob\(data\)\) === data[\s\S]*?invalid base64 data/,
  "tool image payloads should be checked for canonical base64 without exposing their contents",
);
assert.match(
  app,
  /case "tool_execution_end":[\s\S]*?toolImagePayloadError\(event\)[\s\S]*?surfaceRuntimeDiagnostic\("Tool image payload error", imagePayloadError\)/,
  "malformed tool image payloads should immediately surface in the transcript",
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
