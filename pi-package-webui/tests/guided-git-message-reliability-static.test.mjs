import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(testsDir, "..");
const [app, server, artifacts] = await Promise.all([
  readFile(path.join(packageDir, "public", "app.js"), "utf8"),
  readFile(path.join(packageDir, "bin", "pi-webui.mjs"), "utf8"),
  readFile(path.join(packageDir, "lib", "git-message-artifacts.mjs"), "utf8"),
]);

assert.match(server, /async function createGitWorkflowMessageGeneration\(tab\)[\s\S]*id: randomUUID\(\)[\s\S]*baseline: await readStableGitMessageArtifactPair\(paths\)/, "commit generation must capture a server-owned ID and exact two-file baseline");
assert.match(server, /generationId: messageGeneration\?\.id \|\| ""/, "generation dispatch must return the server correlation ID");
assert.match(server, /tab\.gitWorkflowMessageGeneration = messageGeneration/, "the generation record must be owned by the originating tab");
assert.match(server, /case "\/api\/git-workflow\/message"[\s\S]*generationId[\s\S]*tab\?\.gitWorkflowMessageGeneration/, "fresh message reads must resolve the generation from the requested tab");
assert.match(server, /readGitWorkflowMessages\(cwd, \{ generationId = "", generation = null \} = \{\}\)[\s\S]*generation\.cwd !== messageCwd[\s\S]*expired: true/, "message readiness must reject wrong-ID, wrong-kind, and wrong-cwd generations");
assert.match(server, /gitMessageArtifactPairReadiness\(generation\.baseline, pair\)[\s\S]*GIT_WORKFLOW_MESSAGE_PAIR_SETTLE_MS[\s\S]*sameGitMessageArtifactPair\(pair, settledPair\)/, "the backend must require both changed artifacts and a stable settled pair");
assert.doesNotMatch(app, /newestMtime \+ 10000 < currentWorkflow\.messageRequestedAt/, "freshness must not use the previous wall-clock/mtime tolerance");

assert.match(app, /const gitWorkflowMessageLoadsByTab = new Map\(\)/, "browser message loading must have tab-scoped single-flight ownership");
assert.match(app, /messageGenerationId: ""/, "workflow state must retain the active commit-message generation ID");
assert.match(app, /const generationId = String\(generation\.generationId \|\| ""\)\.trim\(\)[\s\S]*setGitWorkflow\(\{ messageGenerationId: generationId \}/, "the browser must bind the returned generation ID before loading files");
assert.match(app, /const loadKey = `\$\{expectedRunId\}:\$\{expectedGenerationId \|\| "preview"\}`[\s\S]*existing\?\.key === loadKey[\s\S]*return existing\.promise/, "duplicate timer/resume/agent_end wakeups must reuse one poll promise");
assert.match(app, /gitWorkflowMessageLoadIsCurrent\(tabId, expectedRunId, expectedGenerationId\)/, "poll results must be guarded by tab, run, and generation identity");
assert.match(app, /GIT_WORKFLOW_MESSAGE_POLL_TIMEOUT_MS = 30_000[\s\S]*GIT_WORKFLOW_MESSAGE_POLL_DELAYS_MS/, "fresh message polling must be adaptive and bounded");
assert.match(app, /\?generationId=\$\{encodeURIComponent\(expectedGenerationId\)\}/, "fresh reads must send the correlation ID to the backend");
assert.match(app, /message\.ready === false[\s\S]*message\.expired[\s\S]*Regenerate/, "pending and expired generation states must remain actionable");
assert.match(app, /gitWorkflow\.step === "generating"[\s\S]*gitWorkflow\.messageGenerationId[\s\S]*Starting message generation…/, "the refresh action must stay disabled until the server correlation ID is bound");
assert.match(app, /requireFresh && !expectedGenerationId[\s\S]*workflow\.step === "generating"\) return;/, "early timer and agent_end wakeups must no-op during the generation-ID dispatch window");
assert.doesNotMatch(app, /loadGitWorkflowMessage\(\{ requireFresh: true, retries:/, "legacy competing retry chains must be removed");

assert.match(artifacts, /mtimeNs: String\(stats\.mtimeNs\)[\s\S]*ctimeNs: String\(stats\.ctimeNs\)[\s\S]*sha256: createHash\("sha256"\)/, "artifact snapshots must combine high-resolution metadata with a content hash");
assert.match(artifacts, /stat\(filePath, \{ bigint: true \}\)[\s\S]*readFile\(filePath\)[\s\S]*stat\(filePath, \{ bigint: true \}\)/, "artifact reads must verify stable metadata around the file read");
assert.match(artifacts, /for \(const key of \["short", "long"\]\)[\s\S]*unchanged\.push\(key\)[\s\S]*empty\.push\(key\)/, "pair readiness must independently validate both non-empty files");

console.log("guided Git message reliability static tests passed");
