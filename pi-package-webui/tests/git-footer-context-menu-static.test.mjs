import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [html, app] = await Promise.all([
  readFile(join(root, "public", "index.html"), "utf8"),
  readFile(join(root, "public", "app.js"), "utf8"),
]);

assert.match(
  html,
  /id="gitFooterContextMenu"[^>]*role="menu"[^>]*aria-label="Git footer box actions"[^>]*hidden[\s\S]*data-git-footer-menu-action="disable"[\s\S]*Disable this box[\s\S]*data-git-footer-menu-action="visibility"[\s\S]*Open Git-footer Visibility/,
  "the page should provide both requested Git footer context-menu actions",
);
assert.match(
  app,
  /function bindGitFooterContextMenu\(node, chip\)[\s\S]*aria-keyshortcuts", "ContextMenu Shift\+F10"[\s\S]*addEventListener\("contextmenu"[\s\S]*event\.key !== "ContextMenu"[\s\S]*event\.shiftKey && event\.key === "F10"/,
  "every bound footer box should support pointer and keyboard context-menu activation",
);
assert.match(
  app,
  /function renderGitFooterPayloadMetric\(chip, payload\)[\s\S]*return bindGitFooterContextMenu\(node, chip\);/,
  "metric boxes should receive the context menu",
);
assert.match(
  app,
  /function renderGitFooterPayloadMeta\(chip, tab, payload\)[\s\S]*return bindGitFooterContextMenu\(node, chip\);/,
  "metadata boxes should receive the context menu",
);
assert.match(
  app,
  /function showGitFooterContextMenu\(event, chip, trigger\)[\s\S]*disableButton\.textContent = `Disable \$\{label\} box`[\s\S]*window\.innerWidth[\s\S]*window\.innerHeight/,
  "the menu should name the clicked box and remain inside the viewport",
);
assert.match(
  app,
  /async function disableGitFooterContextChip\(key, label\)[\s\S]*runGitFooterVisibilityCommand\("hide", \[key\]\)[\s\S]*requestGitFooterWebuiPayload/,
  "disabling a box should persist its matching WebUI visibility key and refresh the payload",
);
assert.match(
  app,
  /data-git-footer-menu-action[\s\S]*action === "disable"[\s\S]*disableGitFooterContextChip\(state\.key, state\.label\)[\s\S]*action === "visibility"[\s\S]*openGitFooterVisibilityDialog\(\)/,
  "the menu should dispatch both requested actions",
);
assert.match(
  app,
  /gitFooterContextMenu[\s\S]*addEventListener\("keydown"[\s\S]*event\.key === "Escape"[\s\S]*event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"[\s\S]*event\.key === "Home" \|\| event\.key === "End"/,
  "the context menu should support standard keyboard navigation",
);
assert.match(
  app,
  /!elements\.gitFooterContextMenu\.hidden[\s\S]*!event\.target\?\.closest\?\.\("\.git-footer-context-menu"\)[\s\S]*closeGitFooterContextMenu\(\)/,
  "clicking outside should close the Git footer context menu",
);

console.log("git-footer-context-menu-static.test.mjs passed");
