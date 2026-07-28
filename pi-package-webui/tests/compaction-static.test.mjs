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
assert.match(server, /function eventForTabClients\(tab, event\)[\s\S]*event\?\.type === "queue_update"[\s\S]*source: "pi-runtime"/, "Pi runtime queue events should be decorated with their source at the server boundary");
assert.match(server, /function compactionQueueSnapshot\(tab\)[\s\S]*source: "webui-compaction"[\s\S]*revision: compactionQueueRevision\(tab\)[\s\S]*draining:/, "compaction queue snapshots should include source, monotonic revision, and draining state");
assert.match(server, /function mutateCompactionFollowUpQueue\(tab, request\)[\s\S]*if \(current\.draining\) return failed\("queue-draining"\)[\s\S]*request\.revision !== current\.revision[\s\S]*slots\.forEach\(\(slot, index\) => \{ queue\[slot\] = followUps\[index\]; \}\)/, "compaction mutations should reject draining/stale requests and only permute follow-up slots");
assert.match(server, /function mutateCompactionFollowUpQueue\(tab, request\)[\s\S]*queue\[slots\[operation\.index\]\]\.command\.message = operation\.text[\s\S]*advanceCompactionQueueRevision\(tab\)[\s\S]*broadcastTabEvent\(tab, compactionQueueEvent\(tab\)\)/, "compaction edits should preserve command metadata and emit one authoritative update after revision advancement");
assert.match(server, /url\.pathname === "\/api\/queue\/mutate" && req\.method === "POST"[\s\S]*request\.source === "webui-compaction"[\s\S]*mutateCompactionFollowUpQueue[\s\S]*status = data\?\.mutated === true \? 200 : conflict \? 409 : 400/, "queue mutation HTTP handling should keep compaction mutations source-specific and map conflicts to 409");

assert.match(app, /function isRunActive\(\) \{\n\s+return !!currentState\?\.isStreaming \|\| !!currentState\?\.isCompacting/, "frontend should treat compaction as an active run for composer controls");
assert.match(app, /const targetWasCompacting = !!currentState\?\.isCompacting;[\s\S]*const targetWasBusy = targetWasStreaming \|\| targetWasCompacting[\s\S]*if \(targetWasBusy\) body\.streamingBehavior = streamingBehavior \|\| busyBehavior/, "prompt send should use busy behavior while streaming or compacting");
assert.match(app, /case "webui_compaction_queue_update":[\s\S]*renderQueue\(event\)[\s\S]*queued compaction prompt sent; Pi is resuming/, "frontend should surface compaction queue and resume events");

console.log("compaction-static.test.mjs passed");
