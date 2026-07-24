import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [app, css] = await Promise.all([
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
]);

function findFunctionSource(source, name) {
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
      if (depth === 0) return source.slice(match.index, index + 1);
    }
  }
  assert.fail(`${name} body should close`);
}

const context = {
  FOOTER_MIDDLE_TRUNCATION_END_CHARS: 16,
  FOOTER_MIDDLE_TRUNCATION_MIN_START_CHARS: 6,
};
vm.runInNewContext(
  `${findFunctionSource(app, "splitMiddleTruncationText")}\nthis.splitMiddleTruncationText = splitMiddleTruncationText;`,
  context,
);
const { splitMiddleTruncationText } = context;

assert.deepEqual(
  { ...splitMiddleTruncationText("/tmp/project") },
  { start: "/tmp/project", end: "" },
  "short paths should remain a single uninterrupted value",
);

const boundary = "x".repeat(22);
assert.deepEqual(
  { ...splitMiddleTruncationText(boundary) },
  { start: boundary, end: "" },
  "the split threshold should leave enough room for the visible prefix",
);

const longPath = "/mnt/SSD_NVME_4TB/GitHub/laboratory-planning-app";
const split = { ...splitMiddleTruncationText(longPath) };
assert.equal(split.start + split.end, longPath, "split spans should preserve the complete path text and accessible name");
assert.equal(split.end, "/laboratory-planning-app", "the suffix should preserve the complete final POSIX path component");
assert.ok(split.start.startsWith("/mnt/"), "the flexible prefix should contain the path beginning");

const windowsPath = String.raw`C:\Users\Dev\Repos\project-tail-component`;
const windowsSplit = { ...splitMiddleTruncationText(windowsPath) };
assert.equal(windowsSplit.end, String.raw`\project-tail-component`, "the suffix should preserve the complete final Windows path component");
assert.equal(windowsSplit.start + windowsSplit.end, windowsPath, "Windows split spans should preserve the complete path");

const trailingSeparatorsPath = "/mnt/data/project-tail-component///";
const trailingSeparatorsSplit = { ...splitMiddleTruncationText(trailingSeparatorsPath) };
assert.equal(trailingSeparatorsSplit.end, "/project-tail-component///", "trailing separators should remain attached to the final component");
assert.equal(trailingSeparatorsSplit.start + trailingSeparatorsSplit.end, trailingSeparatorsPath, "trailing-separator paths should reconstruct exactly");
assert.deepEqual(
  { ...splitMiddleTruncationText(longPath, 0) },
  { start: longPath, end: "" },
  "a disabled suffix should fall back to the untouched value",
);

const unicodeBoundaryPath = `/long/prefix/${"x".repeat(20)}😀${"y".repeat(15)}`;
const unicodeSplit = { ...splitMiddleTruncationText(unicodeBoundaryPath) };
assert.equal(unicodeSplit.start + unicodeSplit.end, unicodeBoundaryPath, "Unicode paths should reconstruct exactly");
assert.ok(unicodeSplit.end.includes("😀"), "the suffix split should preserve an astral character at the boundary");
assert.doesNotMatch(unicodeSplit.start, /[\uD800-\uDBFF]$/, "the prefix should not end with an unpaired high surrogate");
assert.doesNotMatch(unicodeSplit.end, /^[\uDC00-\uDFFF]/, "the suffix should not begin with an unpaired low surrogate");

assert.match(
  app,
  /function setMiddleTruncatedText[\s\S]*?if \(!parts\.end\)[\s\S]*?classList\.remove\("middle-truncate-value"\)[\s\S]*?classList\.add\("middle-truncate-value"\)/,
  "short unsplit CWD values should retain the normal end-ellipsis fallback",
);
assert.match(
  app,
  /function renderTuiFooterLine[\s\S]*?footer-tui-cwd[\s\S]*?middleTruncate: true/,
  "the fallback TUI footer should middle-truncate its CWD",
);
assert.match(
  app,
  /function renderGitFooterPayloadMeta[\s\S]*?options\.middleTruncate = chip\.key === "cwd";[\s\S]*?footerMeta\(chip\.label, chip\.value/,
  "the enhanced git footer should middle-truncate only its CWD chip",
);
assert.match(
  app,
  /function updateGitFooterChipNodeValue[\s\S]*?chip\.key === "cwd"[\s\S]*?setMiddleTruncatedText\(valueNode, nextValue\)/,
  "dynamic CWD updates should retain structured middle truncation",
);
assert.match(
  css,
  /\.middle-truncate-start \{[\s\S]*?flex:\s*0 1 auto;[\s\S]*?min-width:\s*6ch;[\s\S]*?text-overflow:\s*ellipsis[\s\S]*?\.middle-truncate-end \{[\s\S]*?flex:\s*0 0 auto/,
  "responsive styling should keep split path parts contiguous until the prefix must shrink, then preserve the suffix",
);

console.log("footer-middle-truncation.test.mjs passed");
