import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, win32 } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [app, html, styles, readme, technical, development, serviceWorker] = await Promise.all([
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "public", "index.html"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
  readFile(join(root, "README.md"), "utf8"),
  readFile(join(root, "TECHNICAL.md"), "utf8"),
  readFile(join(root, "DEVELOPMENT.md"), "utf8"),
  readFile(join(root, "public", "service-worker.js"), "utf8"),
]);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `expected source block from ${start} to ${end}`);
  return source.slice(startIndex, endIndex);
}

assert.equal(win32.resolve("C:\\repo", "D:/"), "D:\\", "Node should treat a slash-form drive root as an absolute Windows cwd");
assert.match(html, /id="pathPickerPathInput"[^>]*placeholder="Path, e\.g\. C:\/ or D:\/project"[^>]*aria-label="Directory path"/, "the cwd picker should expose an accessible direct-path field with Windows drive examples");
assert.match(html, /id="pathPickerPathButton"[^>]*>Go<\/button>/, "the direct-path field should have an explicit Go action");
assert.match(app, /pathPickerPathInput: \$\("#pathPickerPathInput"\)[\s\S]*pathPickerPathButton: \$\("#pathPickerPathButton"\)/, "the browser should bind both direct-path controls");

const openEnteredPath = sourceBetween(app, "async function openPathPickerEnteredPath()", "function pathPickerCreateName()");
assert.match(openEnteredPath, /const cwd = pathPickerEnteredPath\(\)[\s\S]*await loadPathPickerDirectory\(cwd\)/, "direct paths should use the existing validated directory loader without rewriting drive-qualified input");
const loadDirectory = sourceBetween(app, "async function loadPathPickerDirectory(cwd)", "async function createPathPickerDirectory()");
assert.match(loadDirectory, /encodeURIComponent\(cwd\)/, "drive-qualified paths should be URL-encoded before the directory request");
assert.doesNotMatch(loadDirectory.slice(loadDirectory.indexOf("} catch (error)")), /pathPickerPathInput\.value\s*=/, "failed drive lookups should keep the entered path editable");
assert.match(app, /pathPickerPathInput\.addEventListener\("keydown"[\s\S]*event\.key !== "Enter"[\s\S]*openPathPickerEnteredPath\(\)/, "Enter should open the entered path");
assert.match(app, /pathPickerPathButton\.addEventListener\("click"[\s\S]*openPathPickerEnteredPath\(\)/, "the Go button should open the entered path");

const newTabFlow = sourceBetween(app, "async function createTerminalTabFromChosenDirectory", "async function createFirstTerminalTabFromChosenDirectory");
assert.match(newTabFlow, /pickCwd\([\s\S]*createTerminalTab\(cwd/, "new terminal tabs should use the shared drive-aware picker");
const cwdChangeFlow = sourceBetween(app, "async function changeActiveTabCwd()", "function footerControlKey(node)");
assert.match(cwdChangeFlow, /await pickCwd\([\s\S]*method: "PATCH", body: \{ cwd \}/, "cwd changes should use the shared picker and pass its selected drive-qualified path to the existing tab route");

assert.match(styles, /\.path-picker-path-row[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/, "the direct-path controls should use the picker row layout");
assert.match(styles, /\.path-picker-current-row,[\s\S]*\.path-picker-path-row,[\s\S]*grid-template-columns: 1fr/, "the direct-path controls should stack on narrow screens");
assert.match(readme, /Windows[\s\S]*`C:\/`[\s\S]*`D:\/project`/, "the README should explain Windows drive switching in the first-use flow");
assert.match(technical, /working-directory picker accepts a direct path[\s\S]*`C:\/`[\s\S]*`D:\/project`/i, "the technical reference should document supported Windows path syntax and validation");
assert.match(development, /direct path entry including rooted Windows drive paths/i, "the contributor guide should record the picker capability");
assert.match(html, /styles\.css\?v=143/, "the changed picker styles should advance the stylesheet revision");
assert.match(html, /app\.js\?v=173/, "the changed picker behavior should advance the app revision");
assert.match(serviceWorker, /pi-webui-pwa-v140/, "the changed browser assets should advance the PWA cache identity");

console.log("windows-drive-cwd-picker-static.test.mjs passed");
