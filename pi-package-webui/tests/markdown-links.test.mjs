import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = await readFile(join(root, "public", "app.js"), "utf8");

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

const helperNames = [
  "markdownFilePathFromHref",
  "safeMarkdownLinkHref",
  "normalizeMarkdownWorkspacePath",
  "markdownWorkspaceFilePath",
];
const context = { URL };
vm.runInNewContext(
  `${helperNames.map((name) => findFunctionSource(app, name)).join("\n\n")}\nthis.markdownLinkHelpers = { ${helperNames.join(", ")} };`,
  context,
);
const {
  markdownFilePathFromHref,
  safeMarkdownLinkHref,
  markdownWorkspaceFilePath,
} = context.markdownLinkHelpers;

for (const href of [
  "https://example.com/docs",
  "mailto:dev@example.com",
  "#details",
  "docs/README.md",
  "./docs/README.md",
  "../README.md",
  "/home/dev/project/README.md",
  "C:/Users/dev/project/README.md",
  String.raw`C:\Users\dev\project\README.md`,
  "file:///C:/Users/dev/project/README.md",
]) {
  assert.equal(safeMarkdownLinkHref(href), href, `safe Markdown link should be accepted: ${href}`);
}

for (const href of [
  "javascript:alert(1)",
  "data:text/html,unsafe",
  "vbscript:msgbox(1)",
  "//example.com/unsafe",
  String.raw`\\server\share\README.md`,
  "file://server/share/README.md",
]) {
  assert.equal(safeMarkdownLinkHref(href), "", `unsafe or remote-file Markdown link should be rejected: ${href}`);
}

assert.equal(markdownFilePathFromHref("README.md#overview"), "README.md");
assert.equal(markdownFilePathFromHref("file:///C:/My%20Project/README.md#overview"), "C:/My Project/README.md");
assert.equal(markdownFilePathFromHref(String.raw`C:\My Project\README.md`), "C:/My Project/README.md");
assert.equal(markdownFilePathFromHref("https://example.com/README.md"), "");

assert.equal(
  markdownWorkspaceFilePath("C:/Users/Dev/Project/docs/README.md", String.raw`c:\users\dev\project`),
  "docs/README.md",
  "Windows workspace matching should be case-insensitive",
);
assert.equal(
  markdownWorkspaceFilePath("file:///C:/Users/Dev/Project/My%20Doc.md", "C:/Users/Dev/Project"),
  "My Doc.md",
  "file URLs should resolve to a workspace-relative path",
);
assert.equal(
  markdownWorkspaceFilePath("/home/dev/project/docs/README.md", "/home/dev/project"),
  "docs/README.md",
  "POSIX absolute paths should resolve inside the workspace",
);
assert.equal(markdownWorkspaceFilePath("docs/../README.md", "/unused"), "README.md");
assert.equal(markdownWorkspaceFilePath("../README.md", "/unused", "docs/guides"), "docs/README.md");
assert.equal(markdownWorkspaceFilePath("../../secret.txt", "/unused", "docs"), "", "relative traversal outside the workspace should be rejected");
assert.equal(markdownWorkspaceFilePath("D:/secret.txt", "C:/Users/Dev/Project"), "", "absolute paths outside the workspace should be rejected");
assert.equal(markdownWorkspaceFilePath("/home/dev/other/secret.txt", "/home/dev/project"), "", "POSIX paths outside the workspace should be rejected");

const configureMarkdownLinkSource = findFunctionSource(app, "configureMarkdownLink");
assert.match(configureMarkdownLinkSource, /link\.dataset\.markdownFileHref = href/, "local Markdown links should retain their file target");
assert.match(configureMarkdownLinkSource, /markdownWorkspaceFilePath\(href, cwd, basePath\)/, "local Markdown links should be scoped to the active workspace");
assert.match(configureMarkdownLinkSource, /openFileInViewer\(workspacePath\)/, "local Markdown links should open in the WebUI file viewer");
assert.match(app, /configureMarkdownLink\(link, href\);/, "inline Markdown rendering should configure every accepted link");

console.log("markdown link tests passed");
