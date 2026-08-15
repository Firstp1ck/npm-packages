export const MAX_SYNTAX_HIGHLIGHT_CHARACTERS = 50_000;
export const MAX_SYNTAX_HIGHLIGHT_LINES = 2_000;

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

const words = (value) => new Set(String(value || "").trim().split(/\s+/).filter(Boolean));
const lowerWords = (value) => new Set([...words(value)].map((word) => word.toLowerCase()));

const COMMON_JS_KEYWORDS = words(`
  as async await break case catch class const continue debugger default delete do else export extends
  false finally for from function get if import in instanceof let new null of return set static super
  switch this throw true try typeof undefined var void while with yield
`);
const TYPESCRIPT_KEYWORDS = new Set([...COMMON_JS_KEYWORDS, ...words(`
  abstract any asserts bigint boolean declare enum implements infer interface is keyof module namespace
  never number object override private protected public readonly require satisfies string symbol type
  unique unknown using
`)]);
const C_LIKE_KEYWORDS = words(`
  alignas alignof asm auto break case catch class const constexpr continue default delete do else enum
  explicit export extern false final for friend goto if inline mutable namespace new noexcept nullptr
  operator override private protected public register reinterpret_cast return sizeof static struct switch
  template this throw true try typedef typename union using virtual volatile while
`);
const C_LIKE_TYPES = words(`
  bool byte char char16_t char32_t double float int int16_t int32_t int64_t int8_t long ptrdiff_t
  short signed size_t ssize_t string uint uint16_t uint32_t uint64_t uint8_t ulong unsigned void wchar_t
`);

const PROFILES = {
  python: {
    keywords: words(`
      False None True and as assert async await break case class continue def del elif else except finally
      for from global if import in is lambda match nonlocal not or pass raise return try while with yield
    `),
    types: words("bool bytes complex dict float frozenset int list memoryview object range set slice str tuple type"),
    lineComments: ["#"],
    quotes: ["\"", "'"],
    tripleQuotes: true,
  },
  javascript: {
    keywords: COMMON_JS_KEYWORDS,
    types: words("Array ArrayBuffer BigInt Boolean Date Error Function Map Number Object Promise RegExp Set String Symbol Uint8Array WeakMap WeakSet"),
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    quotes: ["\"", "'", "`"],
    multilineQuotes: new Set(["`"]),
    dollarVariables: true,
  },
  typescript: {
    keywords: TYPESCRIPT_KEYWORDS,
    types: words("Array ArrayBuffer BigInt Boolean Date Error Function Map Number Object Promise Record RegExp Set String Symbol Uint8Array WeakMap WeakSet any bigint boolean never number object string symbol unknown"),
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    quotes: ["\"", "'", "`"],
    multilineQuotes: new Set(["`"]),
    dollarVariables: true,
  },
  bash: {
    keywords: words("break case continue coproc do done elif else esac fi for function if in select then time until while"),
    lineComments: ["#"],
    boundaryComments: new Set(["#"]),
    quotes: ["\"", "'", "`"],
    multilineQuotes: new Set(["\"", "'", "`"]),
    dollarVariables: true,
  },
  powershell: {
    keywords: lowerWords(`
      begin break catch class continue data define do dynamicparam else elseif end enum exit filter finally
      for foreach from function hidden if in inlineScript parallel param process return sequence switch
      throw trap try until using var while workflow
    `),
    types: lowerWords("array bool byte char datetime decimal double float guid hashtable int int16 int32 int64 long object psobject scriptblock string switch timespan type uint uint16 uint32 uint64 xml"),
    lineComments: ["#"],
    blockComments: [["<#", "#>"]],
    quotes: ["\"", "'", "`"],
    multilineQuotes: new Set(["\"", "'", "`"]),
    dollarVariables: true,
    dashVariables: true,
    caseInsensitive: true,
  },
  cmd: {
    keywords: lowerWords("assoc break call cd chdir cls color copy date del dir echo else endlocal erase exit for ftype goto if md mkdir move path pause popd prompt pushd rd rem ren rename rmdir set setlocal shift start time title type ver verify vol"),
    quotes: ["\""],
    cmdVariables: true,
    caseInsensitive: true,
    cmdComments: true,
  },
  json: {
    keywords: words("false null true"),
    quotes: ["\""],
    quotedKeys: true,
    keySeparators: new Set([":"]),
  },
  jsonc: {
    keywords: words("false null true"),
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    quotes: ["\""],
    quotedKeys: true,
    keySeparators: new Set([":"]),
  },
  ini: {
    keywords: lowerWords("false no null off on true yes"),
    lineComments: [";", "#"],
    boundaryComments: new Set([";", "#"]),
    quotes: ["\"", "'"],
    keySeparators: new Set(["=", ":"]),
    sections: true,
    hyphenIdentifiers: true,
    caseInsensitive: true,
  },
  toml: {
    keywords: lowerWords("false inf nan true"),
    lineComments: ["#"],
    quotes: ["\"", "'"],
    tripleQuotes: true,
    keySeparators: new Set(["="]),
    sections: true,
    hyphenIdentifiers: true,
    caseInsensitive: true,
  },
  yaml: {
    keywords: lowerWords("false no null off on true yes"),
    lineComments: ["#"],
    boundaryComments: new Set(["#"]),
    quotes: ["\"", "'"],
    keySeparators: new Set([":"]),
    hyphenIdentifiers: true,
    caseInsensitive: true,
  },
  diff: { custom: "diff" },
  sql: {
    keywords: lowerWords(`
      add all alter and any as asc between by case check column constraint create cross database default
      delete desc distinct drop else end except exists foreign from full grant group having in index inner
      insert intersect into is join left like limit not null offset on or order outer primary references
      return returning revoke right select set table then union unique update using values view when where with
    `),
    types: lowerWords("bigint binary bit blob boolean char date datetime decimal double float int integer json numeric real text time timestamp uuid varchar"),
    lineComments: ["--"],
    blockComments: [["/*", "*/"]],
    quotes: ["\"", "'", "`"],
    caseInsensitive: true,
  },
  css: {
    keywords: lowerWords("important inherit initial revert unset auto none block flex grid inline relative absolute fixed sticky transparent currentcolor"),
    blockComments: [["/*", "*/"]],
    quotes: ["\"", "'"],
    keySeparators: new Set([":"]),
    hyphenIdentifiers: true,
    caseInsensitive: true,
  },
  html: { custom: "markup" },
  xml: { custom: "markup" },
  dockerfile: {
    keywords: lowerWords("add arg cmd copy entrypoint env expose from healthcheck label maintainer onbuild run shell stopsignal user volume workdir"),
    lineComments: ["#"],
    boundaryComments: new Set(["#"]),
    quotes: ["\"", "'", "`"],
    multilineQuotes: new Set(["\"", "'", "`"]),
    dollarVariables: true,
    lineLeadingKeywords: true,
    caseInsensitive: true,
  },
  c: {
    keywords: C_LIKE_KEYWORDS,
    types: C_LIKE_TYPES,
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    quotes: ["\"", "'"],
  },
  cpp: {
    keywords: C_LIKE_KEYWORDS,
    types: C_LIKE_TYPES,
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    quotes: ["\"", "'"],
  },
  java: {
    keywords: words("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true try void volatile while false"),
    types: words("BigDecimal BigInteger Boolean Byte Character Class Double Exception Float Integer Long Object Optional Short String StringBuilder Throwable Void"),
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    quotes: ["\"", "'"],
  },
  go: {
    keywords: words("break case chan const continue default defer else fallthrough false for func go goto if import interface map nil package range return select struct switch true type var"),
    types: words("bool byte complex128 complex64 error float32 float64 int int16 int32 int64 int8 rune string uint uint16 uint32 uint64 uint8 uintptr"),
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    quotes: ["\"", "'", "`"],
    multilineQuotes: new Set(["`"]),
  },
  rust: {
    keywords: words("Self as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self static struct super trait true type unsafe use where while"),
    types: words("bool char f32 f64 i128 i16 i32 i64 i8 isize str u128 u16 u32 u64 u8 usize String Vec Option Result"),
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    quotes: ["\"", "'"],
  },
  csharp: {
    keywords: words("abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while yield"),
    types: words("Boolean Byte Char DateTime Decimal Double Guid Int16 Int32 Int64 Object SByte Single String UInt16 UInt32 UInt64 bool byte char decimal double float int long object sbyte short string uint ulong ushort void"),
    lineComments: ["//"],
    blockComments: [["/*", "*/"]],
    quotes: ["\"", "'"],
    dollarVariables: true,
  },
};

export const SYNTAX_LANGUAGE_ALIASES = Object.freeze({
  python: "python", py: "python",
  javascript: "javascript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", node: "javascript",
  typescript: "typescript", ts: "typescript", tsx: "typescript",
  bash: "bash", sh: "bash", shell: "bash", zsh: "bash",
  powershell: "powershell", pwsh: "powershell", ps1: "powershell",
  cmd: "cmd", bat: "cmd", batch: "cmd", dos: "cmd",
  json: "json", jsonc: "jsonc",
  ini: "ini", cfg: "ini", conf: "ini", properties: "ini",
  toml: "toml",
  yaml: "yaml", yml: "yaml",
  diff: "diff", patch: "diff",
  sql: "sql",
  css: "css",
  html: "html", htm: "html",
  xml: "xml", svg: "xml",
  dockerfile: "dockerfile", docker: "dockerfile",
  c: "c", h: "c",
  cpp: "cpp", "c++": "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hxx: "cpp",
  java: "java",
  go: "go", golang: "go",
  rust: "rust", rs: "rust",
  csharp: "csharp", cs: "csharp", "c#": "csharp", dotnet: "csharp",
});

export const SUPPORTED_SYNTAX_LANGUAGES = Object.freeze(Object.keys(PROFILES));

export function normalizeSyntaxLanguage(language) {
  const alias = String(language || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SYNTAX_LANGUAGE_ALIASES, alias) ? SYNTAX_LANGUAGE_ALIASES[alias] : "";
}

function pushToken(tokens, type, text) {
  if (!text) return;
  const safeType = TOKEN_TYPES.has(type) ? type : "plain";
  const previous = tokens[tokens.length - 1];
  if (previous?.type === safeType) previous.text += text;
  else tokens.push({ type: safeType, text });
}

function plainTokens(source) {
  return source ? [{ type: "plain", text: source }] : [];
}

function exceedsHighlightBounds(source) {
  if (source.length > MAX_SYNTAX_HIGHLIGHT_CHARACTERS) return true;
  let lines = 1;
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10 && ++lines > MAX_SYNTAX_HIGHLIGHT_LINES) return true;
  }
  return false;
}

function isAsciiLetter(character) {
  const code = character?.charCodeAt(0) || 0;
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDigit(character) {
  const code = character?.charCodeAt(0) || 0;
  return code >= 48 && code <= 57;
}

function isIdentifierStart(character) {
  return character === "_" || isAsciiLetter(character);
}

function isIdentifierPart(character, profile) {
  return isIdentifierStart(character) || isDigit(character) || (profile.hyphenIdentifiers && character === "-");
}

function isWhitespace(character) {
  return character === " " || character === "\t" || character === "\r" || character === "\n";
}

function nextNonWhitespace(source, start) {
  let index = start;
  while (index < source.length && isWhitespace(source[index])) index += 1;
  return index;
}

function linePrefixIsWhitespace(source, index) {
  for (let cursor = index - 1; cursor >= 0 && source[cursor] !== "\n"; cursor -= 1) {
    if (source[cursor] !== " " && source[cursor] !== "\t" && source[cursor] !== "\r") return false;
  }
  return true;
}

function consumeQuoted(source, start, quote, profile) {
  const triple = profile.tripleQuotes && (quote === "\"" || quote === "'") && source.startsWith(quote.repeat(3), start);
  const delimiter = triple ? quote.repeat(3) : quote;
  const multiline = triple || profile.multilineQuotes?.has(quote);
  let index = start + delimiter.length;
  while (index < source.length) {
    if (source[index] === "\\") {
      index = Math.min(source.length, index + 2);
      continue;
    }
    if (source.startsWith(delimiter, index)) return index + delimiter.length;
    if (!multiline && source[index] === "\n") return index;
    index += 1;
  }
  return source.length;
}

function consumeNumber(source, start) {
  let index = start;
  if (source[index] === "0" && /[box]/i.test(source[index + 1] || "")) {
    index += 2;
    while (index < source.length && /[0-9a-f_]/i.test(source[index])) index += 1;
    return index;
  }
  while (index < source.length && (isDigit(source[index]) || source[index] === "_")) index += 1;
  if (source[index] === "." && isDigit(source[index + 1])) {
    index += 1;
    while (index < source.length && (isDigit(source[index]) || source[index] === "_")) index += 1;
  }
  if (/[eE]/.test(source[index] || "")) {
    const exponentStart = index;
    index += 1;
    if (source[index] === "+" || source[index] === "-") index += 1;
    const digitsStart = index;
    while (index < source.length && (isDigit(source[index]) || source[index] === "_")) index += 1;
    if (index === digitsStart) index = exponentStart;
  }
  return index;
}

function consumeDollarVariable(source, start) {
  if (source[start + 1] === "{") {
    const end = source.indexOf("}", start + 2);
    if (end !== -1) return end + 1;
  }
  let index = start + 1;
  if ("0123456789?*@#$!-".includes(source[index] || "")) return index + 1;
  while (index < source.length && (isIdentifierPart(source[index], {}) || source[index] === ":")) index += 1;
  return Math.max(start + 1, index);
}

function consumeCmdVariable(source, start) {
  const delimiter = source[start];
  const next = source[start + 1] || "";
  if (delimiter === "%" && (isDigit(next) || "*~".includes(next))) return Math.min(source.length, start + 2);
  const lineEnd = source.indexOf("\n", start + 1);
  const end = source.indexOf(delimiter, start + 1);
  if (end !== -1 && (lineEnd === -1 || end < lineEnd)) return end + 1;
  return start + 1;
}

function commentEnd(source, start, profile) {
  for (const [open, close] of profile.blockComments || []) {
    if (!source.startsWith(open, start)) continue;
    const end = source.indexOf(close, start + open.length);
    return end === -1 ? source.length : end + close.length;
  }
  for (const prefix of profile.lineComments || []) {
    if (!source.startsWith(prefix, start)) continue;
    if (profile.boundaryComments?.has(prefix) && start > 0 && !isWhitespace(source[start - 1])) continue;
    const end = source.indexOf("\n", start + prefix.length);
    return end === -1 ? source.length : end;
  }
  if (profile.cmdComments) {
    const rest = source.slice(start, start + 4).toLowerCase();
    const remBoundary = rest.startsWith("rem") && (rest.length === 3 || isWhitespace(rest[3]));
    const commentCandidate = source.startsWith("::", start) || remBoundary;
    if (commentCandidate && linePrefixIsWhitespace(source, start)) {
      const end = source.indexOf("\n", start + 2);
      return end === -1 ? source.length : end;
    }
  }
  return -1;
}

function sectionEnd(source, start, profile) {
  if (!profile.sections || source[start] !== "[" || !linePrefixIsWhitespace(source, start)) return null;
  const doubled = source[start + 1] === "[";
  const close = doubled ? "]]" : "]";
  const contentStart = start + (doubled ? 2 : 1);
  const end = source.indexOf(close, contentStart);
  const newline = source.indexOf("\n", contentStart);
  if (end === -1 || (newline !== -1 && newline < end)) return null;
  return { open: doubled ? "[[" : "[", contentStart, contentEnd: end, close, end: end + close.length };
}

function classifyIdentifier(source, start, end, profile) {
  const original = source.slice(start, end);
  const comparable = profile.caseInsensitive ? original.toLowerCase() : original;
  if (profile.types?.has(comparable)) return "type";
  if (profile.keywords?.has(comparable)) return "keyword";
  if (profile.lineLeadingKeywords && linePrefixIsWhitespace(source, start)) return "keyword";
  const next = nextNonWhitespace(source, end);
  if (profile.keySeparators?.has(source[next])) return "variable";
  if (source[next] === "(") return "function";
  return "plain";
}

function tokenizeGeneric(source, profile) {
  const tokens = [];
  const punctuation = "(){}[],:;.@";
  const operators = "+-*/%=!<>|&^~?\\";
  let index = 0;

  while (index < source.length) {
    const commentStop = commentEnd(source, index, profile);
    if (commentStop !== -1) {
      pushToken(tokens, "comment", source.slice(index, commentStop));
      index = commentStop;
      continue;
    }

    const section = sectionEnd(source, index, profile);
    if (section) {
      pushToken(tokens, "punctuation", section.open);
      pushToken(tokens, "type", source.slice(section.contentStart, section.contentEnd));
      pushToken(tokens, "punctuation", section.close);
      index = section.end;
      continue;
    }

    const character = source[index];
    if (profile.quotes?.includes(character)) {
      const end = consumeQuoted(source, index, character, profile);
      const next = nextNonWhitespace(source, end);
      const type = profile.quotedKeys && profile.keySeparators?.has(source[next]) ? "variable" : "string";
      pushToken(tokens, type, source.slice(index, end));
      index = end;
      continue;
    }

    if (profile.dollarVariables && character === "$" && source[index + 1] !== undefined) {
      const end = consumeDollarVariable(source, index);
      pushToken(tokens, "variable", source.slice(index, end));
      index = end;
      continue;
    }

    if (profile.cmdVariables && (character === "%" || character === "!")) {
      const end = consumeCmdVariable(source, index);
      if (end > index + 1) {
        pushToken(tokens, "variable", source.slice(index, end));
        index = end;
        continue;
      }
    }

    if (profile.dashVariables && character === "-" && isAsciiLetter(source[index + 1]) && (index === 0 || isWhitespace(source[index - 1]) || "(,[".includes(source[index - 1]))) {
      let end = index + 2;
      while (end < source.length && (isIdentifierPart(source[end], { hyphenIdentifiers: true }))) end += 1;
      pushToken(tokens, "variable", source.slice(index, end));
      index = end;
      continue;
    }

    if (isDigit(character)) {
      const end = consumeNumber(source, index);
      pushToken(tokens, "number", source.slice(index, end));
      index = end;
      continue;
    }

    if (isIdentifierStart(character)) {
      let end = index + 1;
      while (end < source.length && isIdentifierPart(source[end], profile)) end += 1;
      pushToken(tokens, classifyIdentifier(source, index, end, profile), source.slice(index, end));
      index = end;
      continue;
    }

    if (operators.includes(character)) {
      let end = index + 1;
      while (end < source.length && operators.includes(source[end])) end += 1;
      pushToken(tokens, "operator", source.slice(index, end));
      index = end;
      continue;
    }

    if (punctuation.includes(character)) {
      pushToken(tokens, "punctuation", character);
      index += 1;
      continue;
    }

    pushToken(tokens, "plain", character);
    index += 1;
  }

  return tokens;
}

function tokenizeDiff(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const newline = source.indexOf("\n", index);
    const end = newline === -1 ? source.length : newline + 1;
    const line = source.slice(index, end);
    let type = "plain";
    if (line.startsWith("@@") || line.startsWith("diff ") || line.startsWith("index ")) type = "keyword";
    else if (line.startsWith("+++") || line.startsWith("---")) type = "type";
    else if (line.startsWith("+")) type = "string";
    else if (line.startsWith("-")) type = "comment";
    pushToken(tokens, type, line);
    index = end;
  }
  return tokens;
}

function markupNameEnd(source, start) {
  let index = start;
  while (index < source.length && (isIdentifierPart(source[index], { hyphenIdentifiers: true }) || source[index] === ":" || source[index] === "!")) index += 1;
  return index;
}

function tokenizeMarkup(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("<!--", index)) {
      const close = source.indexOf("-->", index + 4);
      const end = close === -1 ? source.length : close + 3;
      pushToken(tokens, "comment", source.slice(index, end));
      index = end;
      continue;
    }
    if (source.startsWith("<![CDATA[", index)) {
      const close = source.indexOf("]]>", index + 9);
      const end = close === -1 ? source.length : close + 3;
      pushToken(tokens, "string", source.slice(index, end));
      index = end;
      continue;
    }
    if (source[index] !== "<") {
      const end = source.indexOf("<", index);
      pushToken(tokens, "plain", source.slice(index, end === -1 ? source.length : end));
      index = end === -1 ? source.length : end;
      continue;
    }

    pushToken(tokens, "punctuation", "<");
    index += 1;
    if ("/?!".includes(source[index] || "")) {
      pushToken(tokens, "punctuation", source[index]);
      index += 1;
    }
    while (index < source.length && isWhitespace(source[index])) {
      pushToken(tokens, "plain", source[index]);
      index += 1;
    }
    const nameEnd = markupNameEnd(source, index);
    if (nameEnd > index) {
      pushToken(tokens, "type", source.slice(index, nameEnd));
      index = nameEnd;
    }

    while (index < source.length) {
      if (source.startsWith("/>", index) || source.startsWith("?>", index)) {
        pushToken(tokens, "punctuation", source.slice(index, index + 2));
        index += 2;
        break;
      }
      if (source[index] === ">") {
        pushToken(tokens, "punctuation", ">");
        index += 1;
        break;
      }
      const character = source[index];
      if (character === "\"" || character === "'") {
        const end = consumeQuoted(source, index, character, { quotes: [character] });
        pushToken(tokens, "string", source.slice(index, end));
        index = end;
        continue;
      }
      if (character === "=") {
        pushToken(tokens, "operator", character);
        index += 1;
        continue;
      }
      if (isIdentifierStart(character)) {
        const end = markupNameEnd(source, index);
        pushToken(tokens, "variable", source.slice(index, end));
        index = end;
        continue;
      }
      pushToken(tokens, isWhitespace(character) ? "plain" : "punctuation", character);
      index += 1;
    }
  }
  return tokens;
}

export function tokenizeCode(code, language) {
  const source = String(code ?? "");
  if (!source) return [];
  const normalized = normalizeSyntaxLanguage(language);
  if (!normalized || exceedsHighlightBounds(source)) return plainTokens(source);
  const profile = PROFILES[normalized];
  if (profile.custom === "diff") return tokenizeDiff(source);
  if (profile.custom === "markup") return tokenizeMarkup(source);
  return tokenizeGeneric(source, profile);
}
