import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, html, css, stateModule, server, serviceWorker, packageJson] = await Promise.all([
  readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../public/issue-wizard-state.mjs", import.meta.url), "utf8"),
  readFile(new URL("../bin/pi-webui.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/service-worker.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

assert.match(app, /from "\.\/issue-wizard-state\.mjs"/, "the browser controller must import the approved pure wizard module");
assert.match(app, /createIssueWizardCatalog\(OPTIONAL_FEATURES\.map\(\(feature\) => feature\.label\)\)/, "optional feature labels must come from the existing catalog");
assert.match(app, /page\.hidden = step !== issueWizardState\.step/, "the controller must expose exactly one wizard page at a time");
assert.match(app, /action === "select-template"[\s\S]*item\.fields\.map\(\(field\) => field\.label\)/, "template choices must preview their structured fields before selection");
assert.match(app, /function focusIssueWizardChoice\([\s\S]*target\?\.focus/, "rerendered selection controls must preserve keyboard focus");
assert.match(app, /button\.setAttribute\("aria-pressed", selected \? "true" : "false"\)/, "selection buttons must expose native toggle-button semantics without an incomplete ARIA radio pattern");
assert.doesNotMatch(app, /setAttribute\("role", "radio(?:group)?"\)/, "the wizard must not advertise radio keyboard semantics it does not implement");
assert.match(app, /elements\.issueWizardBotHint\.hidden = step !== 5/, "the future-bot explanation should appear only on the review step");
assert.match(app, /issueClipboardText\(payload\)/, "copy must include the complete title and body payload");
assert.match(app, /submitIssueToGithubBot\(payload\)/, "the unavailable future submission seam must remain explicit");
assert.doesNotMatch(app.match(/async function sendIssueToGithubBot\(\)[\s\S]*?\n}\n\nfunction initializeIssueWizard/)?.[0] || "", /\bfetch\s*\(/, "the browser bot seam must not make a network request");
assert.doesNotMatch(stateModule.match(/export async function submitIssueToGithubBot[\s\S]*?\n}/)?.[0] || "", /\bfetch\s*\(/, "the pure future-bot adapter must perform no network I/O");
assert.match(stateModule, /description: "[^"]+"[\s\S]*?fields:/, "template definitions must include a human-readable preview description");
assert.match(server, /"issue-wizard-state\.mjs"/, "the server static allowlist must serve the browser module");
assert.match(serviceWorker, /"\/issue-wizard-state\.mjs"/, "the PWA shell must cache the browser module for offline startup");
assert.match(packageJson, /node --check public\/issue-wizard-state\.mjs/, "the package check must syntax-check the pure module");

assert.match(html, /id="openIssueButton"[\s\S]*?aria-controls="issueWizardDialog"/, "the persistent Control Deck action must target the dialog");
assert.match(html, /<footer class="side-panel-footer">[\s\S]*?id="openIssueButton"/, "the action must live outside scrolling Control Deck content");
assert.match(html, /<dialog id="issueWizardDialog"[\s\S]*?aria-labelledby="issueWizardTitle"[\s\S]*?aria-describedby="issueWizardDescription"/, "the dialog must have an accessible name and description");
for (const step of [1, 2, 3, 4, 5]) {
  assert.match(html, new RegExp(`data-issue-wizard-page="${step}"`), `step ${step} markup must exist`);
}
assert.match(html, /id="issueWizardStatus"[^>]*role="status"[^>]*aria-live="polite"/, "wizard status must announce progress and copy results");
assert.doesNotMatch(html, /id="issueWizardProgress"[^>]*aria-live/, "the progress label must not duplicate the status region's live announcement");
assert.match(html, /id="issueWizardBotButton"[^>]*disabled[^>]*>Send to GitHub bot \(coming soon\)</, "the unavailable bot control must stay visibly labelled and disabled");
assert.match(html, /id="issueWizardBotHint"[^>]*hidden/, "the future-bot hint must start hidden before the review page");
assert.match(html, /id="issueWizardCopyButton"[^>]*>Copy complete issue</, "the review page must expose a complete issue copy action");

assert.match(css, /\.side-panel-footer\s*\{[\s\S]*justify-content:\s*flex-end/, "the Control Deck action must anchor at the footer's right edge");
assert.match(css, /\.issue-wizard-dialog\s*\{[\s\S]*max-height:/, "the dialog must bound its height");
assert.match(css, /\.issue-wizard-pages\s*\{[\s\S]*overflow:\s*auto/, "wizard page content must remain scrollable");
assert.match(css, /\.issue-wizard-choice-description,[\s\S]*\.issue-wizard-choice-preview/, "template descriptions and field previews must have dedicated styling");
assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.issue-wizard-choice-grid/, "wizard choices must adapt for mobile");

console.log("open-issue-wizard-static.test.mjs passed");
