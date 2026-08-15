import assert from "node:assert/strict";
import {
  MAX_SYNTAX_HIGHLIGHT_CHARACTERS,
  MAX_SYNTAX_HIGHLIGHT_LINES,
  SUPPORTED_SYNTAX_LANGUAGES,
  SYNTAX_LANGUAGE_ALIASES,
  normalizeSyntaxLanguage,
  tokenizeCode,
} from "../public/syntax-highlight.mjs";

const TOKEN_TYPES = new Set([
  "plain",
  "comment",
  "keyword",
  "function",
  "variable",
  "string",
  "number",
  "type",
  "operator",
  "punctuation",
]);

function assertRoundTrip(language, source, message = language) {
  const tokens = tokenizeCode(source, language);
  assert.equal(tokens.map(({ text }) => text).join(""), source, `${message} should preserve source exactly`);
  for (const token of tokens) {
    assert.ok(TOKEN_TYPES.has(token.type), `${message} emitted unsupported token type ${token.type}`);
    assert.equal(typeof token.text, "string", `${message} token text should be a string`);
    assert.notEqual(token.text, "", `${message} should not emit empty tokens`);
    assert.deepEqual(Object.keys(token).sort(), ["text", "type"], `${message} tokens should keep the small public shape`);
  }
  return tokens;
}

function tokenText(tokens, type) {
  return tokens.filter((token) => token.type === type).map((token) => token.text).join("");
}

const expectedAliases = {
  python: ["python", "py"],
  javascript: ["javascript", "js", "jsx", "mjs", "cjs", "node"],
  typescript: ["typescript", "ts", "tsx"],
  bash: ["bash", "sh", "shell", "zsh"],
  powershell: ["powershell", "pwsh", "ps1"],
  cmd: ["cmd", "bat", "batch", "dos"],
  json: ["json"],
  jsonc: ["jsonc"],
  ini: ["ini", "cfg", "conf", "properties"],
  toml: ["toml"],
  yaml: ["yaml", "yml"],
  diff: ["diff", "patch"],
  sql: ["sql"],
  css: ["css"],
  html: ["html", "htm"],
  xml: ["xml", "svg"],
  dockerfile: ["dockerfile", "docker"],
  c: ["c", "h"],
  cpp: ["cpp", "c++", "cc", "cxx", "hpp", "hxx"],
  java: ["java"],
  go: ["go", "golang"],
  rust: ["rust", "rs"],
  csharp: ["csharp", "cs", "c#", "dotnet"],
};

assert.deepEqual(new Set(SUPPORTED_SYNTAX_LANGUAGES), new Set(Object.keys(expectedAliases)), "supported languages should expose every canonical profile exactly once");
for (const [canonical, aliases] of Object.entries(expectedAliases)) {
  for (const alias of aliases) {
    assert.equal(normalizeSyntaxLanguage(alias), canonical, `${alias} should normalize to ${canonical}`);
    assert.equal(SYNTAX_LANGUAGE_ALIASES[alias], canonical, `${alias} should be present in the exported alias catalog`);
  }
}
assert.equal(normalizeSyntaxLanguage("  TSX  "), "typescript", "language normalization should trim and ignore case");
assert.equal(normalizeSyntaxLanguage("unknown-language"), "", "unknown languages should not be guessed");
for (const inheritedName of ["constructor", "toString", "__proto__"]) {
  assert.equal(normalizeSyntaxLanguage(inheritedName), "", `inherited object key ${inheritedName} must not resolve as a language alias`);
}

const fixtures = [
  {
    language: "python",
    source: "def greet(name: str):\n    # keep this\n    return f\"Hello, {name}\" + str(42)",
    types: ["keyword", "function", "type", "comment", "string", "number", "punctuation"],
  },
  {
    language: "javascript",
    source: "// browser code\nconst answer = format(`value ${42}`) + 42;",
    types: ["comment", "keyword", "function", "string", "number", "operator", "punctuation"],
  },
  {
    language: "typescript",
    source: "interface User { name: string }\nconst load = async (id: number) => fetch(`/u/${id}`);",
    types: ["keyword", "type", "function", "string", "operator", "punctuation"],
  },
  {
    language: "bash",
    source: "#!/usr/bin/env bash\nif [[ -n $HOME ]]; then echo \"ready\"; fi",
    types: ["comment", "keyword", "variable", "string", "operator", "punctuation"],
  },
  {
    language: "powershell",
    source: "# profile\nparam([string]$Name)\nWrite-Output -InputObject \"Hi $Name\"",
    types: ["comment", "keyword", "type", "variable", "string", "punctuation"],
  },
  {
    language: "cmd",
    source: "REM startup\r\nIF DEFINED USERPROFILE ECHO %USERPROFILE% & ECHO \"ready\"",
    types: ["comment", "keyword", "variable", "string"],
  },
  {
    language: "json",
    source: "{\"enabled\": true, \"retries\": 3, \"value\": null}",
    types: ["variable", "keyword", "number", "punctuation"],
  },
  {
    language: "jsonc",
    source: "{\n  // safe comment\n  \"path\": \"C:\\\\tmp\",\n  \"ok\": false\n}",
    types: ["comment", "variable", "string", "keyword", "punctuation"],
  },
  {
    language: "ini",
    source: "[server]\nhost-name = localhost\n; local only",
    types: ["type", "variable", "operator", "comment", "punctuation"],
  },
  {
    language: "toml",
    source: "[[servers.alpha]]\nenabled = true\nport = 8080 # local",
    types: ["type", "variable", "keyword", "number", "comment", "operator", "punctuation"],
  },
  {
    language: "yaml",
    source: "service-name: api\nenabled: true\nports:\n  - 8080 # local",
    types: ["variable", "keyword", "number", "comment", "operator", "punctuation"],
  },
  {
    language: "diff",
    source: "diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-old\n+new\n",
    types: ["keyword", "type", "comment", "string"],
  },
  {
    language: "sql",
    source: "SELECT COUNT(id) FROM users WHERE created_at > DATE('2025-01-01'); -- bounded",
    types: ["keyword", "function", "type", "string", "comment", "operator", "punctuation"],
  },
  {
    language: "css",
    source: ".card { color: #fff; margin-top: 12px; /* compact */ }",
    types: ["variable", "number", "comment", "punctuation"],
  },
  {
    language: "html",
    source: "<!-- safe -->\n<section class=\"card\" data-id='7'><span>Text</span></section>",
    types: ["comment", "type", "variable", "string", "operator", "punctuation"],
  },
  {
    language: "xml",
    source: "<?xml version=\"1.0\"?><root id=\"a\"><child /></root>",
    types: ["type", "variable", "string", "operator", "punctuation"],
  },
  {
    language: "dockerfile",
    source: "FROM node:22\nARG APP_HOME=/app\nRUN echo $APP_HOME && echo \"ready\" # build path",
    types: ["keyword", "variable", "string", "comment", "operator", "punctuation"],
  },
  {
    language: "c",
    source: "// C\nstatic int add(int a, int b) { return a + b; }",
    types: ["comment", "keyword", "type", "function", "operator", "punctuation"],
  },
  {
    language: "cpp",
    source: "class Box { public: size_t size() const { return 1; } };",
    types: ["keyword", "type", "function", "number", "punctuation"],
  },
  {
    language: "java",
    source: "public class Main { static String greet(String name) { return \"Hi \" + name; } }",
    types: ["keyword", "type", "function", "string", "operator", "punctuation"],
  },
  {
    language: "go",
    source: "package main\nfunc add(a int, b int) int { return a + b }",
    types: ["keyword", "type", "function", "operator", "punctuation"],
  },
  {
    language: "rust",
    source: "pub fn add(a: i32, b: i32) -> i32 { a + b }",
    types: ["keyword", "type", "function", "operator", "punctuation"],
  },
  {
    language: "csharp",
    source: "public static string Greet(string name) => $\"Hi {name}\";",
    types: ["keyword", "type", "string", "operator", "punctuation"],
  },
];

for (const fixture of fixtures) {
  const tokens = assertRoundTrip(fixture.language, fixture.source);
  for (const type of fixture.types) {
    assert.notEqual(tokenText(tokens, type), "", `${fixture.language} should emit a representative ${type} token`);
  }
}

const malicious = "const payload = \"</code><img src=x onerror=alert(1)>\"; // <script>alert(2)</script>";
const maliciousTokens = assertRoundTrip("js", malicious, "malicious-looking JavaScript");
assert.ok(tokenText(maliciousTokens, "string").includes("<img"), "HTML-looking source should remain inert token text for DOM-safe integration");
assert.ok(tokenText(maliciousTokens, "comment").includes("<script>"), "comment source should remain exact text rather than markup");

const unknown = "<b>plain & exact</b>\nconst x = 1;";
assert.deepEqual(tokenizeCode(unknown, "not-a-language"), [{ type: "plain", text: unknown }], "unknown languages should use one exact plain token");
assert.deepEqual(tokenizeCode(unknown, ""), [{ type: "plain", text: unknown }], "missing language metadata should use one exact plain token");
assert.deepEqual(tokenizeCode("", "python"), [], "empty source should not emit empty token objects");
assert.deepEqual(tokenizeCode(null, "python"), [], "null source should normalize to empty source");
assert.deepEqual(tokenizeCode(12345, "python"), [{ type: "number", text: "12345" }], "non-string source should normalize to its exact string form");

const characterLimit = "if ".repeat(Math.ceil(MAX_SYNTAX_HIGHLIGHT_CHARACTERS / 3)).slice(0, MAX_SYNTAX_HIGHLIGHT_CHARACTERS);
assert.notDeepEqual(tokenizeCode(characterLimit, "python"), [{ type: "plain", text: characterLimit }], "the exact character limit should remain eligible for highlighting");
const oversizedCharacters = `${characterLimit}x`;
assert.deepEqual(tokenizeCode(oversizedCharacters, "python"), [{ type: "plain", text: oversizedCharacters }], "source above the character cap should skip tokenization exactly");

const lineLimit = `${"if True:\n".repeat(MAX_SYNTAX_HIGHLIGHT_LINES - 1)}pass`;
assert.notDeepEqual(tokenizeCode(lineLimit, "python"), [{ type: "plain", text: lineLimit }], "the exact line limit should remain eligible for highlighting");
const oversizedLines = `${lineLimit}\npass`;
assert.deepEqual(tokenizeCode(oversizedLines, "python"), [{ type: "plain", text: oversizedLines }], "source above the line cap should skip tokenization exactly");

const cmdComment = "REM bounded";
const nearCapCmdLine = `${" ".repeat(MAX_SYNTAX_HIGHLIGHT_CHARACTERS - cmdComment.length)}${cmdComment}`;
const nearCapCmdTokens = assertRoundTrip("cmd", nearCapCmdLine, "near-cap indented cmd comment");
assert.equal(tokenText(nearCapCmdTokens, "comment"), cmdComment, "near-cap cmd input should scan indentation once and recognize the line-leading comment");

for (const alias of Object.keys(SYNTAX_LANGUAGE_ALIASES)) {
  assertRoundTrip(alias, "keyword = \"value\" # exact\nnext(42)", `alias ${alias}`);
}

console.log(`syntax-highlight.test.mjs passed (${fixtures.length} language fixtures, ${Object.keys(SYNTAX_LANGUAGE_ALIASES).length} aliases)`);
