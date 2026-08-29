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
  /case "\/api\/git-workflow\/publish": \{[\s\S]*const root = await getGitRoot\(cwd\);[\s\S]*cleanGitHubRepoName\(path\.basename\(root\)\)[\s\S]*visibility !== "public" && visibility !== "private"[\s\S]*requireConfirmed\(body,[\s\S]*gitRemoteNames\(root\)[\s\S]*remotes\.length[\s\S]*currentGitBranch\(root\)/,
  "the server must derive and validate the Git root directory name, validate visibility/confirmation, and refuse existing-remote repair before publication",
);
assert.doesNotMatch(
  server,
  /case "\/api\/git-workflow\/publish": \{[\s\S]*?cleanGitHubRepoName\(body\.repoName\)[\s\S]*?case "\/api\/git-workflow\/create-pr"/,
  "publication must not trust a client-selected repository name",
);
assert.match(
  server,
  /runGitHubWorkflowCommand\(\s*\["repo", "create", repoName, `--\$\{visibility\}`, "--source", "\.", "--remote", "origin", "--push"\],[\s\S]*\{ cwd: root, timeoutMs: 15 \* 60 \* 1000/,
  "publication must run gh repo create from the Git root so system GitHub CLI configuration adds origin and pushes",
);
assert.match(
  server,
  /if \(payload\.ok\) Object\.assign\(payload\.data, \{ repoName, visibility, remote: "origin", branch, protectedBranch \}\);/,
  "successful publication must extend the process envelope with the approved metadata",
);
assert.match(server, /payload\.code = "AUTH";[\s\S]*gh auth login/, "gh authentication failures should receive an actionable AUTH hint");
assert.match(server, /name already exists on this account\|repository \.\+ already exists[\s\S]*rename the local directory before retrying/, "name conflicts should explain how the directory-derived name can be changed");
assert.match(server, /GH_PROMPT_DISABLED: process\.env\.GH_PROMPT_DISABLED \|\| "1"/, "gh publication must inherit disabled interactive prompts");

console.log("guided git publication backend static tests passed");
