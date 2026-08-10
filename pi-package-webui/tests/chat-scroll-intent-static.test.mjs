import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");

function findFunctionBody(source, name) {
  const signature = new RegExp(`function\\s+${name}\\s*\\(`, "m");
  const match = signature.exec(source);
  assert.ok(match, `${name} should be defined`);
  let parenDepth = 0;
  let openBrace = -1;
  for (let index = match.index + match[0].length - 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth -= 1;
    else if (char === "{" && parenDepth === 0) {
      openBrace = index;
      break;
    }
  }
  assert.notEqual(openBrace, -1, `${name} body should open`);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBrace + 1, index);
    }
  }
  assert.fail(`${name} body should close`);
}

const touchStart = findFunctionBody(app, "noteChatTouchStart");
const awayIntent = findFunctionBody(app, "isChatScrollAwayIntent");
const noteIntent = findFunctionBody(app, "noteChatUserScrollIntent");
const syncAutoFollow = findFunctionBody(app, "syncAutoFollowFromChatScroll");
const updateLatest = findFunctionBody(app, "updateJumpToLatestButton");
const applyFollow = findFunctionBody(app, "applyChatFollowScroll");
const resumeFollow = findFunctionBody(app, "resumeChatAutoFollow");
const forceFollow = findFunctionBody(app, "scrollChatToBottom");

assert.match(awayIntent, /event\?\.type === "wheel"[\s\S]*event\.deltaY < 0/, "wheel-up should be recognized as intent to read earlier output");
assert.match(touchStart, /touches\?\.\[0\]\?\.clientY[\s\S]*chatLastTouchClientY/, "touch scrolling should capture its starting direction");
assert.match(awayIntent, /event\?\.type === "touchmove"[\s\S]*clientY > chatLastTouchClientY[\s\S]*return scrollAway/, "downward finger movement should pause follow while upward movement can resume at Latest");
assert.match(awayIntent, /"ArrowUp"[\s\S]*"Home"[\s\S]*"PageUp"/, "upward keyboard navigation should pause streaming follow");
assert.match(noteIntent, /autoFollowChat = false;[\s\S]*updateJumpToLatestButton\(\)/, "upward intent should pause follow and reveal Latest before the scroll event fires");
assert.match(noteIntent, /!isChatScrollAwayIntent\(event\)[\s\S]*chatPausedScrollRestoreUntil = 0;/, "fresh downward user intent should be able to resume follow after a reconciliation guard");
assert.match(syncAutoFollow, /^\s*const nearBottom[\s\S]*if \(performance\.now\(\) <= chatPausedScrollRestoreUntil\) \{\s*autoFollowChat = false;[\s\S]*else if \(isChatUserScrollAwayIntentActive\(\)/, "transcript reconciliation and active upward input must both suppress transient near-bottom follow");
assert.match(syncAutoFollow, /else if \(!autoFollowChat\) \{\s*if \(nearBottom && \(isChatUserScrollIntentActive\(\) \|\| !recentProgrammaticScroll\)\) autoFollowChat = true;/, "a transient programmatic clamp at the bottom must not resume paused follow without fresh user intent");
assert.doesNotMatch(syncAutoFollow, /\|\| !autoFollowChat \|\|/, "paused follow should not be folded into generic near-bottom reconciliation");
assert.match(updateLatest, /hidden = autoFollowChat/, "Latest visibility should reflect paused follow even while still inside the near-bottom threshold");
assert.doesNotMatch(updateLatest, /isChatNearBottom/, "Latest must not remain hidden solely because the first upward movement is near the bottom");
assert.match(applyFollow, /if \(!autoFollowChat\)[\s\S]*return;/, "already queued streaming frames must honor the immediate follow pause");
assert.match(app, /if \(!autoFollowChat\) chatPausedScrollRestoreUntil = performance\.now\(\) \+ CHAT_PROGRAMMATIC_SCROLL_GRACE_MS;/, "paused transcript reconciliation should guard against scroll events from temporary DOM height changes");
assert.match(app, /lastChatProgrammaticScrollAt = performance\.now\(\);\s*setChatScrollTopInstant\(Math\.min\(previousScrollTop, elements\.chat\.scrollHeight\)\);/, "transcript reconciliation should mark its instant reader-position restoration as programmatic");
assert.match(resumeFollow, /chatUserScrollAwayIntentUntil = 0;\s*chatPausedScrollRestoreUntil = 0;\s*autoFollowChat = true;/, "explicit resume should clear stale upward intent and any reconciliation guard before following again");
assert.match(forceFollow, /if \(force\) resumeChatAutoFollow\(\)/, "Latest and other forced-bottom actions should use the explicit resume path");
assert.match(app, /addEventListener\("touchstart", noteChatTouchStart[\s\S]*addEventListener\("touchend", clearChatTouchIntent[\s\S]*addEventListener\("touchcancel", clearChatTouchIntent/, "touch direction tracking should be initialized and cleared for each gesture");

console.log("chat-scroll-intent-static.test.mjs passed");
