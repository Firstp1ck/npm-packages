export type ParsedShellCommand = {
  argv: string[];
  executable: string;
  executableWasQuoted: boolean;
};

export type ShellCommandParseResult =
  | { ok: true; command: ParsedShellCommand }
  | { ok: false; reason: string };

export type ShellCommandValidationResult =
  | { ok: true; command: ParsedShellCommand }
  | { ok: false; reason: string };

type ParsedToken = { value: string; quoted: boolean };

function parseFailure(reason: string): ShellCommandParseResult {
  return { ok: false, reason };
}

/**
 * Parses the deliberately small shell language permitted to workflow agents:
 * one command with space/tab-separated arguments and balanced single/double
 * quotes. Shell control syntax, unquoted expansion/comment syntax, and escapes
 * are excluded so this parser is a strict subset of the command text accepted
 * by bash.
 */
export function parseSimpleShellCommand(command: unknown): ShellCommandParseResult {
  if (typeof command !== "string" || !command.trim()) return parseFailure("a non-empty command is required");
  if (/[\r\n]/.test(command)) return parseFailure("newlines are not allowed");

  const tokens: ParsedToken[] = [];
  let value = "";
  let quoted = false;
  let started = false;
  let quote: "'" | '"' | undefined;

  const finishToken = () => {
    if (started) tokens.push({ value, quoted });
    value = "";
    quoted = false;
    started = false;
  };

  for (const character of command) {
    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        if (character === "$" || character === "`") return parseFailure("shell substitutions are not allowed");
        if (character === "\\") return parseFailure("shell escape syntax is not allowed");
        value += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      quoted = true;
      started = true;
    } else if (character === " " || character === "\t") {
      finishToken();
    } else if (character === "$" || character === "`") {
      return parseFailure("shell substitutions are not allowed");
    } else if (character === "\\") {
      return parseFailure("shell escape syntax is not allowed");
    } else if (";|&<>()".includes(character)) {
      return parseFailure("shell operators and redirections are not allowed");
    } else if ("*?[]{}~#".includes(character)) {
      return parseFailure("unquoted shell expansion and comment syntax is not allowed");
    } else if (character < " " || character === "\u007f") {
      return parseFailure("control characters are not allowed");
    } else {
      value += character;
      started = true;
    }
  }

  if (quote) return parseFailure("malformed quoting");
  finishToken();
  if (!tokens.length || !tokens[0].value) return parseFailure("a command executable is required");

  return {
    ok: true,
    command: {
      argv: tokens.map((token) => token.value),
      executable: tokens[0].value,
      executableWasQuoted: tokens[0].quoted,
    },
  };
}

export function validateShellCommand(command: unknown, allowlist: readonly string[]): ShellCommandValidationResult {
  const parsed = parseSimpleShellCommand(command);
  if (!parsed.ok) return parsed;

  const executable = parsed.command.executable;
  if (parsed.command.executableWasQuoted || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(executable)) {
    return { ok: false, reason: "executable paths and shell bypasses are not allowed" };
  }
  if (!allowlist.includes(executable)) return { ok: false, reason: `executable '${executable}' is not in the shell allowlist` };
  return parsed;
}
