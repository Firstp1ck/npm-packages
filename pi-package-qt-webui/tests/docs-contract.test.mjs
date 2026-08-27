import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const names = ["README.md", "TECHNICAL.md", "DEVELOPMENT.md"];
const documents = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(path.join(root, name), "utf8")])));

test("README has the package guide sections, exact install name, requirements, and technical link", () => {
  const readme = documents["README.md"];
  for (const heading of ["# Qt WebUI", "## What you can do", "## Install", "## How to use it", "## Main window", "## Before you start", "## Technical details"]) {
    assert(readme.includes(heading), `README should include ${heading}`);
  }
  assert.match(readme, /npm install -g @firstpick\/pi-package-qt-webui/);
  assert.match(readme, /pi install npm:@firstpick\/pi-package-qt-webui/);
  assert.match(readme, /\/qt-webui-start/);
  assert.doesNotMatch(readme, /npm run dev/, "README should not contain source-checkout contributor commands");
  assert.match(readme, /Quickshell 0\.3 or newer/);
  assert.match(readme, /Linux.*Wayland|Wayland.*Linux/s);
  assert.match(readme, /active provider, model ID, and thinking effort/i);
  assert.match(readme, /violet-charcoal or light counterpart/);
  assert.match(readme, /saved Pi sessions from every project/i);
  assert.match(readme, /Working[\s\S]*Settled[\s\S]*Restore/);
  assert.match(readme, /already open switches to its tab[\s\S]*opens it in a new tab/i);
  assert.match(readme, /Closing a tab does not settle it[\s\S]*settling a session does not close its tab/);
  assert.match(readme, /close the session you are viewing[\s\S]*main workspace stays empty[\s\S]*Other open sessions remain in \*\*Working\*\*/);
  assert.match(readme, /By default[\s\S]*closed sessions after 30 days without activity/);
  assert.match(readme, /More options[\s\S]*Automatic settlement[\s\S]*1–3,650 days/);
  assert.match(readme, /more than 100 saved sessions[\s\S]*floating \*\*Settle All\*\*[\s\S]*100 or fewer[\s\S]*Active runs stay in \*\*Working\*\*/);
  assert.match(readme, /choose \*\*Theme\*\*[\s\S]*Pi JSON theme[\s\S]*@firstpick\/pi-themes-bundle/);
  assert.match(readme, /never writes Pi's `theme` setting[\s\S]*ignores arbitrary CSS, gradients, and images[\s\S]*does not execute package extensions/);
  assert.match(readme, /Lowering it can move older closed sessions[\s\S]*open tabs stay in \*\*Working\*\*[\s\S]*Restore[\s\S]*fresh grace period/);
  assert.match(readme, /!\[Qt WebUI dark window with Working sessions above an expanded Settled section in the left rail\]\(screenshots\/session-settlement\.png\)/);
  assert.match(readme, /deterministic fake-session environment/);
  assert.match(readme, /\[TECHNICAL\.md\]\(TECHNICAL\.md\)/);
});

test("technical reference remains user-facing", () => {
  const technical = documents["TECHNICAL.md"];
  assert.match(technical, /Quickshell 0\.3 or newer/);
  assert.match(technical, /Linux on a Wayland desktop session/);
  assert.match(technical, /`qt-webui`/);
  assert.match(technical, /npm install -g @firstpick\/pi-package-qt-webui/);
  assert.match(technical, /pi install npm:@firstpick\/pi-package-qt-webui/);
  assert.match(technical, /`\/qt-webui-start`/);
  assert.match(technical, /`qt-webui dev`/);
  assert.doesNotMatch(technical, /npm run dev/, "TECHNICAL.md should remain installed-user documentation");
  assert.match(technical, /provider and model ID followed by the thinking effort/i);
  assert.match(technical, /periwinkle while working/i);
  assert.match(technical, /violet-charcoal dark surfaces/);
  assert.match(technical, /Green appears only for successful or ready status/);
  assert.match(technical, /tracked uppercase text stays limited to short section, role, and status labels/);
  assert.match(technical, /global \*\*Working\*\* and \*\*Settled\*\* session lists/);
  assert.match(technical, /Selecting a saved session that already has an open tab selects that tab[\s\S]*opens a new tab in the session's recorded folder/);
  assert.match(technical, /Closing the active tab leaves no session selected[\s\S]*does not select another open tab or create a replacement/);
  assert.match(technical, /no session selected[\s\S]*restored tabs resume in the background[\s\S]*main workspace stays empty/);
  assert.match(technical, /active run cannot be newly settled[\s\S]*\*\*Restore\*\* always moves a session back/);
  assert.match(technical, /does not stop, compact, move, delete, or rewrite Pi's session file/);
  assert.match(technical, /last activity time[\s\S]*elapsed 24-hour-day delay[\s\S]*default is 30 days[\s\S]*reaching the threshold qualifies/);
  assert.match(technical, /Every open tab is excluded[\s\S]*only closed inactive sessions can move automatically/);
  assert.match(technical, /immediately after you save a new delay[\s\S]*Manual \*\*Restore\*\* starts a fresh grace period/);
  assert.match(technical, /whole number from 1 through 3,650[\s\S]*Cancel leaves the existing value unchanged[\s\S]*backend rejection[\s\S]*keeps the confirmed value/);
  assert.match(technical, /more than 100 unsettled saved sessions[\s\S]*floating \*\*Settle All\*\*[\s\S]*one at a time[\s\S]*skips active runs[\s\S]*2,048 manual-settlement limit[\s\S]*Temporary unsaved tabs do not count/);
  assert.match(technical, /`sessionSettleDays` \| `30` \| Settle closed inactive sessions[\s\S]*1 through 3,650/);
  assert.match(technical, /## Requirements and compatibility[\s\S]*### Pi JSON themes/);
  assert.match(technical, /Automatic, Light, and Dark always appear first[\s\S]*@firstpick\/pi-themes-bundle/);
  assert.match(technical, /never installs or repairs a missing package[\s\S]*does not execute package extensions/);
  assert.match(technical, /does not read or write Pi's `theme` setting/);
  assert.match(technical, /`selectedThemeName` \| `""` \| Requested external Pi JSON theme/);
  assert.match(technical, /128 theme files[\s\S]*128 KiB[\s\S]*CSS, gradients, background images/);
  assert.match(technical, /lowering it applies on the refresh that follows a successful save[\s\S]*Invalid or cancelled edits do not replace the last confirmed setting/);
  assert.match(technical, /Working\/Settled organization live in `\$XDG_STATE_HOME\/qt-webui\/state\.json`/);
  assert.match(technical, /Manual and automatic settlement use separate lists of at most 2,048 hashed identities each[\s\S]*neither session paths nor conversation text/);
  assert.match(technical, /\[Back to README\]\(README\.md\)/);
  assert.match(technical, /\[Contributor guide\]\(DEVELOPMENT\.md\)/);
  for (const forbidden of [
    /\b(?:request|response|event) payload\b/i,
    /\b(?:JSON|RPC) schema\b/i,
    /\bsource layout\b/i,
    /(?:^|`)bin\//m,
    /(?:^|`)lib\//m,
    /(?:^|`)qml\//m,
    /npm test/,
    /node --check/,
  ]) {
    assert.doesNotMatch(technical, forbidden, `TECHNICAL.md contains contributor-only material: ${forbidden}`);
  }
});

test("development guide has required navigation and contributor contracts", () => {
  const development = documents["DEVELOPMENT.md"];
  assert.match(development, /^# Development guide: Qt WebUI/m);
  assert.match(development, /Contributor-only implementation, API, architecture, testing, and maintenance information\./);
  assert.match(development, /\[Back to README\]\(README\.md\) · \[Advanced user technical reference\]\(TECHNICAL\.md\)/);
  assert.match(development, /QT_WEBUI_CALLER_CWD/);
  assert.match(development, /model\.provider.*model\.id.*thinkingLevel/s);
  assert.match(development, /removes every inherited environment key whose name starts with `QT_WEBUI_`/);
  assert.match(development, /npm install --package-lock-only --ignore-scripts/);
  assert.match(development, /adds that prefix's bin directory to `PATH`/);
  assert.match(development, /invokes `qt-webui` by command name/);
  assert.match(development, /## Source-checkout development[\s\S]*npm run dev/);
  assert.match(development, /periwinkle structural accent/);
  assert.match(development, /rectangular tracked status punctuation/);
  assert.match(development, /`sessions_list` \| optional `scope` \(`workspace` or `all`\), `offset`/);
  assert.match(development, /`session_settled` \| `sessionPath` \(absolute `\.jsonl`\), `settled` \(boolean\)/);
  assert.match(development, /`settings_get` \/ `settings_set`[\s\S]*`selectedThemeName`[\s\S]*`sessionSettleDays` is an integer from 1 through 3,650/);
  assert.match(development, /`lib\/backend\/themes\.mjs`[\s\S]*no-install missing-package handling[\s\S]*contrast repair/);
  assert.match(development, /`themes_list`[\s\S]*complete palette[\s\S]*`theme_select`[\s\S]*stale external identities/);
  assert.match(development, /`themes\.changed` carries the same complete state[\s\S]*discard older list responses/);
  assert.match(development, /theme picker also reuses `PickerDialog`[\s\S]*external theme named `light`[\s\S]*one assignment/);
  assert.match(development, /Packed-install coverage[\s\S]*missing-package handling[\s\S]*fixture extension was not executed/);
  assert.match(development, /global session catalog starts after `hello`[\s\S]*deduplicates by canonical path[\s\S]*500 ms coalescing timer/);
  assert.match(development, /`settleAllSessions\(\)` snapshots loaded unsettled paths[\s\S]*excludes active tabs[\s\S]*existing mutation sequentially[\s\S]*reaches 100[\s\S]*bulk-pending guard/);
  assert.match(development, /stable registry snapshot[\s\S]*current, startup-resume, and explicit-switch path[\s\S]*canonicalizes that snapshot through the managed-session boundary/);
  assert.match(development, /separate automatic settled collection[\s\S]*automatic aging cannot consume manual Settle capacity[\s\S]*Restore removes the identity from both collections/);
  assert.match(development, /future remains protected with zero elapsed grace[\s\S]*expires exactly at the current threshold[\s\S]*hashed identities and timestamps[\s\S]*does not emit `sessions.changed`/);
  assert.match(development, /Drafts and state[\s\S]*512 KiB state file/);
  assert.match(development, /2,048 manual settled identities, 2,048 automatic settled identities, and 2,048 restore-grace entries/);
  assert.match(development, /`BackendBridge\.applySettings\(\)`[\s\S]*`settings_set`[\s\S]*`refreshSessionCatalog\(\)`/);
  assert.match(development, /automatic-settlement state\/application\/wiring\/input bounds\/cancel and failure behavior\/refresh-after-save/);
  assert.match(development, /SessionList` \(Working plus default-expanded\/collapsible Settled/);
});

test("relative Markdown links resolve", async () => {
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const [name, source] of Object.entries(documents)) {
    for (const match of source.matchAll(linkPattern)) {
      const target = match[1].split("#", 1)[0];
      if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
      await assert.doesNotReject(access(path.resolve(root, path.dirname(name), target)), `${name} link should resolve: ${target}`);
    }
  }
});
