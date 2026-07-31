import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");

function functionBody(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should be defined`);
  const next = app.indexOf("\nfunction ", start + 1);
  return app.slice(start, next === -1 ? app.length : next);
}

const menuItems = functionBody("gitPanelContextMenuItems");
const runAction = functionBody("runGitPanelAction");

// Repository menus must not gain the action.
const repositoryBranch = menuItems.slice(
  menuItems.indexOf('if (kind === "repository")'),
  menuItems.indexOf('const target = kind === "folder"'),
);
assert.ok(repositoryBranch.length > 0, "the repository menu branch should still exist");
assert.doesNotMatch(repositoryBranch, /gitignore/i, "repository context menus should not offer the .gitignore action");

// File/folder menus share one action entry that carries the selected kind.
assert.match(
  menuItems,
  /const ignoreAction = target === "folder" \? "ignore-folder" : "ignore-file";/,
  "the menu should select the ignore action matching the selected row kind",
);
assert.match(
  menuItems,
  /const ignoreItem = \{ label: "Add to \.gitignore", disabled: gitPanelActionBusy\(card, ignoreAction, path\), run: \(\) => runGitPanelAction\(card, ignoreAction, path\) \};/,
  "file and folder menus should share one busy-aware Add to .gitignore item",
);
assert.match(
  menuItems,
  /const target = kind === "folder" \? "folder" : "file";/,
  "the action should resolve exactly the file or folder kind accepted by the endpoint",
);

// Staged rows keep their early return but still include the action.
const stagedBranch = menuItems.slice(
  menuItems.indexOf('if (category === "staged")'),
  menuItems.indexOf("const stageLabel ="),
);
assert.match(stagedBranch, /Unstage \$\{target\}/, "the staged branch should keep its unstage item");
assert.match(stagedBranch, /\bignoreItem,/, "the staged early-return branch should also offer Add to .gitignore");

// Changed/conflicted/untracked menus include the action before destructive controls.
const ignoreIndex = menuItems.indexOf("run: () => runGitPanelAction(card, \"stage\", path) }, ignoreItem]");
assert.ok(ignoreIndex > 0, "non-staged menus should list Add to .gitignore next to the stage item");
assert.ok(
  ignoreIndex < menuItems.indexOf('label: "Discard changes…"') &&
    ignoreIndex < menuItems.indexOf('label: "Delete file…"'),
  "Add to .gitignore should be ordered ahead of the destructive discard/delete controls",
);

// Action flow: route, body, and kind handling.
assert.match(
  app,
  /async function runGitPanelAction\(card, action, path = ""\) \{/,
  "the shared action runner should keep its existing signature",
);
assert.match(
  runAction,
  /const gitignoreAction = \(kind\) => \(\{\s*url: "\/api\/git-changes\/add-to-gitignore",\s*body: \{ path, kind \},/,
  "the ignore action should POST path and kind to the approved endpoint",
);
assert.match(runAction, /"ignore-file": gitignoreAction\("file"\),/, "file rows should send kind file");
assert.match(runAction, /"ignore-folder": gitignoreAction\("folder"\),/, "folder rows should send kind folder");

// Feedback distinguishes newly added entries from already-present ones.
const ignoreConfig = runAction.slice(runAction.indexOf("const gitignoreAction ="), runAction.indexOf("const config = {"));
assert.match(ignoreConfig, /data\?\.added/, "success feedback should read the response added flag");
assert.match(ignoreConfig, /data\?\.entry \|\| path/, "success feedback should prefer the normalized response entry");
assert.match(ignoreConfig, /Added \$\{data\?\.entry \|\| path\} to \.gitignore\./, "newly added entries should report an addition");
assert.match(ignoreConfig, /\$\{data\?\.entry \|\| path\} is already in \.gitignore\./, "already-present entries should not claim an addition");
assert.doesNotMatch(ignoreConfig, /confirm/, "the ignore action should not introduce confirmation UI");
assert.match(
  runAction,
  /addEvent\(typeof config\.done === "function" \? config\.done\(response\.data\) : config\.past, "success"\);/,
  "response-derived feedback should replace the static past-tense message only when configured",
);

// Regression: shared busy, error, and refresh behavior stays in the flow.
assert.match(runAction, /const busyKey = `\$\{card\.root\}\\u0000\$\{action\}\\u0000\$\{path\}`;/, "the ignore action should reuse the shared busy key scheme");
assert.match(runAction, /if \(gitPanelState\.busy\.has\(busyKey\)\) return;/, "concurrent duplicate actions should still be blocked");
assert.match(runAction, /gitPanelState\.busy\.add\(busyKey\);/, "the shared busy state should still be set before the request");
assert.match(runAction, /gitPanelState\.busy\.delete\(busyKey\);/, "the shared busy state should still be cleared afterwards");
assert.match(runAction, /if \(!response\.ok\) throw new Error/, "the shared error path should still reject failed responses");
assert.match(runAction, /await loadGitPanelRepository\(card, \{ force: true \}\);/, "successful actions should still force a Git repository refresh");
assert.match(runAction, /requestGitFooterWebuiPayload\(\{ tabId: card\.tabId \}, \{ force: true \}\);/, "successful actions should still refresh footer Git state");

// Regression: existing actions keep their static messages and endpoints.
assert.match(runAction, /stage: \{ url: "\/api\/git-changes\/stage-file", body: \{ path \}, past: `Staged \$\{path\}\.` \}/, "the stage action should be unchanged");
assert.match(runAction, /unstage: \{ url: "\/api\/git-changes\/unstage-file", body: \{ path \}, past: `Unstaged \$\{path\}\.` \}/, "the unstage action should be unchanged");
assert.match(runAction, /url: "\/api\/git-changes\/discard-file"/, "the discard action should be unchanged");
assert.match(runAction, /url: "\/api\/git-changes\/delete-untracked"/, "the delete action should be unchanged");

console.log("git-panel-gitignore-static.test.mjs passed");
