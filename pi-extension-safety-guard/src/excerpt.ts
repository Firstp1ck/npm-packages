export type CommandRuleLike = {
  pattern: RegExp;
};

export type MatchingCommandExcerptOptions = {
  linesBefore?: number;
  linesAfter?: number;
};

const MATCHES_TO_RENDER = 3;
const DEFAULT_CONTEXT_LINES = 3;
const MAX_CONTEXT_LINES = 20;
const MATCHED_LINE_PREFIX_CHARS = 180;
const MATCHED_LINE_SUFFIX_CHARS = 420;
const CONTEXT_LINE_MAX_CHARS = 240;

export function previewCommand(command: string, maxChars = 800): string {
  if (command.length <= maxChars) return command;
  return `${command.slice(0, maxChars)}\n… [truncated ${command.length - maxChars} chars for prompt display]`;
}

function testLine(rule: CommandRuleLike, line: string): boolean {
  rule.pattern.lastIndex = 0;
  const matched = rule.pattern.test(line);
  rule.pattern.lastIndex = 0;
  return matched;
}

function truncateContextLine(line: string): string {
  if (line.length <= CONTEXT_LINE_MAX_CHARS) return line;
  return `${line.slice(0, CONTEXT_LINE_MAX_CHARS)} … [truncated ${line.length - CONTEXT_LINE_MAX_CHARS} chars]`;
}

function normalizeContextLineCount(value: number | undefined): number {
  if (!Number.isInteger(value)) return DEFAULT_CONTEXT_LINES;
  return Math.max(0, Math.min(MAX_CONTEXT_LINES, value!));
}

export function highlightMatchedPattern(
  rule: CommandRuleLike,
  line: string,
  highlight: (value: string) => string,
): string {
  rule.pattern.lastIndex = 0;
  const match = rule.pattern.exec(line);
  rule.pattern.lastIndex = 0;
  if (!match || match.index === undefined || match[0].length === 0) return truncateContextLine(line);

  const start = match.index;
  const end = start + match[0].length;
  const rawPrefix = line.slice(0, start);
  const rawSuffix = line.slice(end);
  const prefix = rawPrefix.length > MATCHED_LINE_PREFIX_CHARS
    ? `… [truncated ${rawPrefix.length - MATCHED_LINE_PREFIX_CHARS} chars before match] ${rawPrefix.slice(-MATCHED_LINE_PREFIX_CHARS)}`
    : rawPrefix;
  const suffix = rawSuffix.length > MATCHED_LINE_SUFFIX_CHARS
    ? `${rawSuffix.slice(0, MATCHED_LINE_SUFFIX_CHARS)} … [truncated ${rawSuffix.length - MATCHED_LINE_SUFFIX_CHARS} chars after match]`
    : rawSuffix;

  return `${prefix}${highlight(`>>> ${match[0]} <<<`)}${suffix}`;
}

export function matchingCommandExcerpt(
  rule: CommandRuleLike,
  commandForMatching: string,
  highlight: (value: string) => string = (value) => value,
  options: MatchingCommandExcerptOptions = {},
): string {
  const lines = commandForMatching.split(/\r?\n/);
  const matchedIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => testLine(rule, line))
    .map(({ index }) => index);

  if (matchedIndexes.length === 0) {
    return previewCommand(commandForMatching.trim() || commandForMatching, 800);
  }

  const matchedSet = new Set(matchedIndexes);
  const included = new Set<number>();
  const linesBefore = normalizeContextLineCount(options.linesBefore);
  const linesAfter = normalizeContextLineCount(options.linesAfter);
  for (const index of matchedIndexes.slice(0, MATCHES_TO_RENDER)) {
    for (let offset = -linesBefore; offset <= linesAfter; offset += 1) {
      const lineIndex = index + offset;
      if (lineIndex < 0 || lineIndex >= lines.length) continue;
      included.add(lineIndex);
    }
  }

  const lineNumberWidth = String(lines.length).length;
  const excerptLines: string[] = [];
  let previousLineIndex: number | undefined;

  for (const lineIndex of [...included].sort((a, b) => a - b)) {
    if (previousLineIndex !== undefined && lineIndex > previousLineIndex + 1) {
      excerptLines.push(`… lines ${previousLineIndex + 2}-${lineIndex} omitted`);
    }

    const isMatchedLine = matchedSet.has(lineIndex);
    const marker = isMatchedLine ? highlight("!!!") : "   ";
    const lineNumber = String(lineIndex + 1).padStart(lineNumberWidth, " ");
    const line = isMatchedLine
      ? highlightMatchedPattern(rule, lines[lineIndex], highlight)
      : truncateContextLine(lines[lineIndex]);
    excerptLines.push(`${marker} ${lineNumber} | ${line}`);
    previousLineIndex = lineIndex;
  }

  if (matchedIndexes.length > MATCHES_TO_RENDER) {
    excerptLines.push(`… ${matchedIndexes.length - MATCHES_TO_RENDER} more matching lines omitted`);
  }
  return excerptLines.join("\n");
}
