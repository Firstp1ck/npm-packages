import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../bin/pi-webui.mjs", import.meta.url), "utf8");

assert.match(
  server,
  /if \(push && \/fatal:\\s\+no configured push destination\\\.\/\.test\(text\)\) \{\s*return \{ code: "NO_REMOTE", hint: NO_REMOTE_HINT \};/,
  "only Git's explicit no-push-destination failure should receive NO_REMOTE classification",
);
assert.doesNotMatch(
  server,
  /does not appear to be a git repository[\s\S]{0,160}NO_REMOTE|NO_REMOTE[\s\S]{0,160}does not appear to be a git repository/,
  "an invalid configured remote must not be reclassified as remote-less",
);
assert.match(
  server,
  /const GIT_WORKFLOW_MUTATING_PATHS = new Set\(\[[\s\S]*"\/api\/git-workflow\/publish"[\s\S]*\]\);/,
  "publication must use the POST-only mutating workflow allowlist",
);
assert.match(
  server,
  /case "\/api\/git-workflow\/publish": \{[\s\S]*cleanGitHubRepoName\(body\.repoName\)[\s\S]*visibility !== "public" && visibility !== "private"[\s\S]*requireConfirmed\(body,[\s\S]*getGitRoot\(cwd\)[\s\S]*gitRemoteNames\(root\)[\s\S]*remotes\.length[\s\S]*currentGitBranch\(root\)/,
  "the server must validate name/visibility/confirmation and refuse existing-remote repair before publication",
);
assert.match(
  server,
  /runGitHubWorkflowCommand\(\s*\["repo", "create", repoName, `--\$\{visibility\}`, "--source", root, "--remote", "origin", "--push"\],[\s\S]*timeoutMs: 15 \* 60 \* 1000/,
  "publication must run the approved non-interactive gh repo create command through the bounded workflow runner",
);
assert.match(
  server,
  /if \(payload\.ok\) Object\.assign\(payload\.data, \{ repoName, visibility, remote: "origin", branch, protectedBranch \}\);/,
  "successful publication must extend the process envelope with the approved metadata",
);
assert.match(server, /payload\.code = "AUTH";[\s\S]*gh auth login/, "gh authentication failures should receive an actionable AUTH hint");
assert.match(server, /name already exists on this account\|repository \.\+ already exists[\s\S]*Choose another repository name/, "safe name-conflict output should receive a retry hint");
assert.match(server, /GH_PROMPT_DISABLED: process\.env\.GH_PROMPT_DISABLED \|\| "1"/, "gh publication must inherit disabled interactive prompts");

console.log("guided git publication backend static tests passed");
