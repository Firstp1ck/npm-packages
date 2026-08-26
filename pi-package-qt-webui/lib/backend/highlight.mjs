import { LIMITS } from "./protocol.mjs";

const STYLED_ENTITY = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function escapeStyledText(text) {
  return String(text ?? "").replace(/[&<>"]/g, (character) => STYLED_ENTITY[character]);
}

// Bounded, language-aware tokenizer for fenced code blocks.
//
// Output is a flat token list of [kind, escapedText] pairs. Kinds are semantic (keyword, string,
// comment, …) so the QML side maps them to theme colors; the backend never emits colors or any
// markup beyond escaped text. Unknown languages and oversized blocks produce no tokens, and the
// QML side falls back to the plain code view. Every regex is anchored and linear so adversarial
// input cannot blow up the render loop.

export const TOKEN_KINDS = Object.freeze(["comment", "string", "number", "keyword", "constant", "type", "function", "attribute", "tag", "variable", "operator", "punctuation", "text"]);

const C_LIKE_KEYWORDS = [
  "abstract", "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "defer", "delete", "do", "else", "enum", "export", "extends", "extern", "final", "finally", "fn", "for", "from", "func", "function", "go", "goto", "if", "impl", "implements", "import", "in", "inline", "instanceof", "interface", "internal", "let", "loop", "match", "mod", "module", "mut", "namespace", "new", "of", "operator", "override", "package", "private", "protected", "pub", "public", "readonly", "ref", "return", "sealed", "select", "self", "signal", "sizeof", "static", "struct", "super", "switch", "template", "this", "throw", "throws", "trait", "try", "type", "typedef", "typeof", "unsafe", "use", "using", "var", "virtual", "void", "volatile", "where", "while", "with", "yield", "property", "required", "alias", "on",
];
const C_LIKE_TYPES = ["bool", "boolean", "byte", "char", "double", "float", "int", "long", "short", "string", "u8", "u16", "u32", "u64", "i8", "i16", "i32", "i64", "f32", "f64", "usize", "isize", "size_t", "uint", "any", "unknown", "never", "number", "object", "symbol", "bigint", "String", "Int", "Float", "Bool"];
const CONSTANTS = ["true", "false", "null", "undefined", "nil", "None", "True", "False", "NaN", "Infinity"];
const PYTHON_KEYWORDS = ["and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield", "match", "case", "self"];
const RUBY_KEYWORDS = ["alias", "and", "begin", "break", "case", "class", "def", "defined?", "do", "else", "elsif", "end", "ensure", "for", "if", "in", "module", "next", "not", "or", "redo", "rescue", "retry", "return", "self", "super", "then", "undef", "unless", "until", "when", "while", "yield", "require", "attr_reader", "attr_accessor", "private", "public"];
const SHELL_KEYWORDS = ["if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac", "in", "function", "select", "time", "return", "exit", "export", "local", "readonly", "declare", "set", "unset", "shift", "source", "alias", "end", "begin", "switch", "and", "or", "not", "sudo", "cd", "echo", "printf", "read", "test"];
const SQL_KEYWORDS = ["select", "from", "where", "insert", "into", "values", "update", "set", "delete", "create", "table", "drop", "alter", "add", "column", "index", "primary", "key", "foreign", "references", "join", "inner", "left", "right", "outer", "full", "on", "group", "by", "order", "having", "limit", "offset", "as", "and", "or", "not", "in", "is", "null", "distinct", "union", "all", "exists", "between", "like", "case", "when", "then", "else", "end", "begin", "commit", "rollback", "transaction", "with", "returning", "constraint", "unique", "default", "cascade", "view", "if", "asc", "desc", "count", "sum", "avg", "min", "max"];
const CSS_KEYWORDS = ["important", "media", "import", "font-face", "keyframes", "supports", "charset", "layer", "container"];

function wordPattern(words, { caseInsensitive = false } = {}) {
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?:${escaped.join("|")})(?![\\w$?])`, caseInsensitive ? "yi" : "y");
}

const IDENTIFIER = /[A-Za-z_$][\w$]*/y;
const NUMBER = /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)(?:[uUlLnf]{0,3})\b/y;
const DOUBLE_STRING = /"(?:[^"\\\n]|\\.)*"?/y;
const SINGLE_STRING = /'(?:[^'\\\n]|\\.)*'?/y;
const TEMPLATE_STRING = /`(?:[^`\\]|\\.)*`?/y;
const LINE_COMMENT_SLASH = /\/\/[^\n]*/y;
const LINE_COMMENT_HASH = /#[^\n]*/y;
const LINE_COMMENT_DASH = /--[^\n]*/y;
const BLOCK_COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/y;
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/y;
const PYTHON_TRIPLE = /(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$))/y;
const OPERATOR = /(?:=>|->|::|\*\*|\+\+|--|&&|\|\||[=!<>]=?|[+\-*/%&|^~?:.]=?|\.\.\.?)/y;
const PUNCTUATION = /[()[\]{};,]/y;
const WHITESPACE = /[ \t]+|\n/y;
const SHELL_VARIABLE = /\$(?:\{[^}\n]*\}?|[A-Za-z_][\w]*|[0-9@#?*$!-])/y;
const SHELL_OPTION = /(?<=\s|^)-{1,2}[A-Za-z][\w-]*/y;
const CSS_PROPERTY = /[-a-zA-Z]+(?=\s*:)/y;
const CSS_SELECTOR = /[.#][A-Za-z_-][\w-]*/y;
const CSS_AT = /@[a-z-]+/y;
const CSS_UNIT_NUMBER = /-?\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?/y;
const YAML_KEY = /(?<=^[ \t-]*)[A-Za-z_][\w. -]*(?=\s*:(?:\s|$))/my;
const YAML_ANCHOR = /[&*][\w-]+/y;
const TOML_TABLE = /^\s*\[[^\]\n]*\]/my;
const TOML_KEY = /(?<=^\s*)[A-Za-z0-9_.-]+(?=\s*=)/my;
const MARKUP_TAG = /<\/?[A-Za-z][\w:.-]*|\/?>/y;
const MARKUP_ATTRIBUTE = /[A-Za-z_:][\w:.-]*(?==)/y;
const DIFF_ADD = /^\+[^\n]*/my;
const DIFF_REMOVE = /^-[^\n]*/my;
const DIFF_HUNK = /^@@[^\n]*/my;
const DIFF_META = /^(?:diff|index|---|\+\+\+)[^\n]*/my;

const C_LIKE = [
  ["comment", LINE_COMMENT_SLASH], ["comment", BLOCK_COMMENT],
  ["string", TEMPLATE_STRING], ["string", DOUBLE_STRING], ["string", SINGLE_STRING],
  ["number", NUMBER],
  ["constant", wordPattern(CONSTANTS)], ["keyword", wordPattern(C_LIKE_KEYWORDS)], ["type", wordPattern(C_LIKE_TYPES)],
  ["identifier", IDENTIFIER], ["operator", OPERATOR], ["punctuation", PUNCTUATION],
];
const PYTHON = [
  ["comment", LINE_COMMENT_HASH], ["string", PYTHON_TRIPLE], ["string", DOUBLE_STRING], ["string", SINGLE_STRING],
  ["number", NUMBER], ["constant", wordPattern(CONSTANTS)], ["keyword", wordPattern(PYTHON_KEYWORDS)],
  ["identifier", IDENTIFIER], ["operator", OPERATOR], ["punctuation", PUNCTUATION],
];
const RUBY = [
  ["comment", LINE_COMMENT_HASH], ["string", DOUBLE_STRING], ["string", SINGLE_STRING], ["number", NUMBER],
  ["constant", wordPattern(CONSTANTS)], ["keyword", wordPattern(RUBY_KEYWORDS)], ["variable", /[@$][A-Za-z_]\w*/y], ["variable", /:[A-Za-z_]\w*/y],
  ["identifier", IDENTIFIER], ["operator", OPERATOR], ["punctuation", PUNCTUATION],
];
const SHELL = [
  ["comment", LINE_COMMENT_HASH], ["string", DOUBLE_STRING], ["string", SINGLE_STRING], ["variable", SHELL_VARIABLE],
  ["keyword", wordPattern(SHELL_KEYWORDS)], ["attribute", SHELL_OPTION], ["number", NUMBER],
  ["identifier", IDENTIFIER], ["operator", /(?:\|\||&&|[|&;<>]+|=)/y], ["punctuation", PUNCTUATION],
];
const JSON_RULES = [
  ["attribute", /"(?:[^"\\\n]|\\.)*"(?=\s*:)/y], ["string", DOUBLE_STRING], ["number", NUMBER], ["constant", wordPattern(["true", "false", "null"])],
  ["punctuation", /[{}[\],:]/y],
];
const YAML = [
  ["comment", LINE_COMMENT_HASH], ["attribute", YAML_KEY], ["string", DOUBLE_STRING], ["string", SINGLE_STRING], ["variable", YAML_ANCHOR],
  ["number", NUMBER], ["constant", wordPattern(["true", "false", "null", "yes", "no", "~"])], ["punctuation", /[-:|>[\]{},]/y], ["identifier", IDENTIFIER],
];
const TOML = [
  ["comment", LINE_COMMENT_HASH], ["tag", TOML_TABLE], ["attribute", TOML_KEY], ["string", DOUBLE_STRING], ["string", SINGLE_STRING],
  ["number", NUMBER], ["constant", wordPattern(["true", "false"])], ["punctuation", /[=[\],{}.]/y], ["identifier", IDENTIFIER],
];
const CSS = [
  ["comment", BLOCK_COMMENT], ["string", DOUBLE_STRING], ["string", SINGLE_STRING], ["keyword", CSS_AT], ["keyword", wordPattern(CSS_KEYWORDS)],
  ["attribute", CSS_PROPERTY], ["tag", CSS_SELECTOR], ["number", CSS_UNIT_NUMBER], ["identifier", IDENTIFIER], ["punctuation", /[{}();:,]/y], ["operator", /[>+~*=!]/y],
];
const MARKUP = [
  ["comment", HTML_COMMENT], ["tag", MARKUP_TAG], ["string", DOUBLE_STRING], ["string", SINGLE_STRING], ["attribute", MARKUP_ATTRIBUTE], ["operator", /=/y],
];
const SQL = [
  ["comment", LINE_COMMENT_DASH], ["comment", BLOCK_COMMENT], ["string", SINGLE_STRING], ["string", DOUBLE_STRING], ["number", NUMBER],
  ["keyword", wordPattern(SQL_KEYWORDS, { caseInsensitive: true })], ["identifier", IDENTIFIER], ["operator", OPERATOR], ["punctuation", PUNCTUATION],
];
const DIFF = [["tag", DIFF_HUNK], ["comment", DIFF_META], ["string", DIFF_ADD], ["keyword", DIFF_REMOVE]];

const FAMILIES = new Map([
  [C_LIKE, ["js", "javascript", "mjs", "cjs", "jsx", "ts", "typescript", "tsx", "mts", "cts", "java", "kotlin", "kt", "scala", "swift", "c", "h", "cpp", "cc", "cxx", "hpp", "cs", "csharp", "go", "golang", "rust", "rs", "qml", "php", "dart", "zig", "objc", "groovy"]],
  [PYTHON, ["py", "python", "python3"]],
  [RUBY, ["rb", "ruby"]],
  [SHELL, ["sh", "bash", "zsh", "fish", "shell", "console", "shellsession", "nu"]],
  [JSON_RULES, ["json", "jsonc", "json5"]],
  [YAML, ["yaml", "yml"]],
  [TOML, ["toml", "ini", "cfg", "conf"]],
  [CSS, ["css", "scss", "less"]],
  [MARKUP, ["html", "xml", "svg", "vue", "xhtml", "xul"]],
  [SQL, ["sql", "mysql", "postgres", "postgresql", "sqlite", "psql"]],
  [DIFF, ["diff", "patch"]],
]);

const RULES_BY_LANGUAGE = new Map();
for (const [rules, names] of FAMILIES) for (const name of names) RULES_BY_LANGUAGE.set(name, rules);

export const HIGHLIGHT_LANGUAGES = Object.freeze([...RULES_BY_LANGUAGE.keys()].sort());

export function highlightSupported(language) {
  return RULES_BY_LANGUAGE.has(String(language ?? "").toLowerCase());
}

function classifyIdentifier(text, source, end) {
  // A call site becomes a function; PascalCase becomes a type. Everything else is plain text.
  let cursor = end;
  while (cursor < source.length && (source[cursor] === " " || source[cursor] === "\t")) cursor += 1;
  if (source[cursor] === "(") return "function";
  if (/^[A-Z][a-z]/.test(text) || /^[A-Z][A-Z0-9_]*[a-z]/.test(text)) return "type";
  return "text";
}

// Returns { tokens: [[kind, escapedText], …], truncated } or { tokens: null } when the language
// is unknown or the block exceeds the highlighting budget.
export function highlightCode(language, text) {
  const rules = RULES_BY_LANGUAGE.get(String(language ?? "").toLowerCase());
  const source = String(text ?? "");
  if (!rules || source.length === 0 || source.length > LIMITS.maxHighlightCharacters) return { tokens: null, truncated: false };
  const tokens = [];
  let index = 0;
  let last = null;
  const push = (kind, value) => {
    if (last && last[0] === kind) {
      last[1] += value;
      return;
    }
    last = [kind, value];
    tokens.push(last);
  };
  while (index < source.length) {
    if (tokens.length >= LIMITS.maxHighlightTokens) return { tokens: null, truncated: true };
    WHITESPACE.lastIndex = index;
    const space = WHITESPACE.exec(source);
    if (space) {
      push("text", space[0]);
      index += space[0].length;
      continue;
    }
    let matched = false;
    for (const [kind, pattern] of rules) {
      pattern.lastIndex = index;
      const match = pattern.exec(source);
      if (!match || match[0].length === 0) continue;
      const value = match[0];
      push(kind === "identifier" ? classifyIdentifier(value, source, index + value.length) : kind, value);
      index += value.length;
      matched = true;
      break;
    }
    if (!matched) {
      push("text", source[index]);
      index += 1;
    }
  }
  return { tokens: tokens.map(([kind, value]) => [kind, escapeStyledText(value)]), truncated: false };
}
