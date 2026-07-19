import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [server, app] = await Promise.all([
  readFile(join(root, "bin", "pi-webui.mjs"), "utf8"),
  readFile(join(root, "public", "app.js"), "utf8"),
]);

assert.match(server, /function maybeQueueCommandDuringCompaction\(tab, command\)[\s\S]*tab\?\.lastState\?\.isCompacting[\s\S]*enqueueCommandUntilCompactionEnds/, "server should queue prompt-like commands while the tab is compacting");
assert.match(server, /url\.pathname === "\/api\/prompt" && req\.method === "POST"[\s\S]*maybeQueueCommandDuringCompaction\(tab, command\)[\s\S]*sendJson\(res, 202/, "POST /api/prompt should return 202 when a prompt is queued for post-compaction resume");
assert.match(server, /if \(command\) \{[\s\S]*maybeQueueCommandDuringCompaction\(tab, command\)[\s\S]*sendJson\(res, 202/, "generic prompt-like POST commands should share the compaction queue path");
assert.match(server, /event\?\.type === "compaction_end"\)[\s\S]*flushCompactionQueue\(tab, event\)/, "every compaction_end should flush queued prompts instead of stranding them after an abort");
assert.match(server, /async function flushCompactionQueue\(tab, event = \{\}\)[\s\S]*queuedRetryCommand\(item\)/, "compaction queue flush should preserve steering, follow-up, and slash-command delivery when joining an active run");
assert.match(server, /async function flushCompactionQueue\(tab, event = \{\}\)[\s\S]*queuedPromptCommand\(item\)/, "compaction queue flush should start a new prompt when no run resumes automatically");
assert.match(server, /function queuedRetryCommand\(item\)[\s\S]*queuedStreamingCommand\(item\)/, "post-compaction continuation should send later queued items as steering or follow-up messages");
assert.match(server, /function stateWithPendingThinking\(tab, state\)[\s\S]*compactionQueueForTab\(tab\)\.length[\s\S]*pendingMessageCount/, "state responses should include Web UI compaction queue length while prompts wait to resume");

assert.match(app, /function isRunActive\(\) \{\n\s+return !!currentState\?\.isStreaming \|\| !!currentState\?\.isCompacting/, "frontend should treat compaction as an active run for composer controls");
assert.match(app, /const targetWasCompacting = !!currentState\?\.isCompacting;[\s\S]*const targetWasBusy = targetWasStreaming \|\| targetWasCompacting[\s\S]*if \(targetWasBusy\) body\.streamingBehavior = streamingBehavior \|\| busyBehavior/, "prompt send should use busy behavior while streaming or compacting");
assert.match(app, /case "webui_compaction_queue_update":[\s\S]*renderQueue\(event\)[\s\S]*queued compaction prompt sent; Pi is resuming/, "frontend should surface compaction queue and resume events");

console.log("compaction-static.test.mjs passed");
