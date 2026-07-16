const WINDOWS_RESERVED_DEVICE_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
]);

function gitFailureText(result) {
  return [result?.stderr, result?.stdout, result?.error].filter(Boolean).join("\n");
}

function extractGitIndexFailurePath(text) {
  const patterns = [
    /unable to index file ['"]([^'"\r\n]+)['"]/i,
    /error:\s*([^:\r\n]+): failed to insert into database/i,
    /short read while indexing\s+['"]?([^'"\r\n]+?)['"]?\s*$/im,
    /invalid path ['"]([^'"\r\n]+)['"]/i,
  ];
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

export function classifyWindowsReservedGitPath(value) {
  const pathname = String(value || "").trim();
  if (!pathname) return null;
  for (const rawComponent of pathname.replace(/\\/g, "/").split("/")) {
    const component = rawComponent.replace(/[ .]+$/g, "");
    const deviceName = component.split(".", 1)[0].toUpperCase();
    if (WINDOWS_RESERVED_DEVICE_NAMES.has(deviceName)) {
      return { path: pathname, component, deviceName };
    }
  }
  return null;
}

export function findWindowsReservedGitPath(paths) {
  const values = typeof paths === "string" ? paths.split("\0") : paths;
  for (const pathname of values || []) {
    const match = classifyWindowsReservedGitPath(pathname);
    if (match) return match;
  }
  return null;
}

export function windowsReservedGitPathFailure(value) {
  const match = value && typeof value === "object" && value.path
    ? value
    : classifyWindowsReservedGitPath(value);
  if (!match) return null;
  const shownPath = JSON.stringify(String(match.path));
  return {
    code: "INVALID_WORKTREE_PATH",
    error: `Git cannot index the Windows-reserved path ${shownPath}.`,
    hint: `Delete or rename ${shownPath} in the working tree, then retry. If Windows treats it as a device, use an extended-length (\\\\?\\...) path or a POSIX-compatible tool. Review the staged set before continuing because an earlier failed git add may already have staged files.`,
  };
}

export function classifyGitPathFailure(result) {
  const text = gitFailureText(result);
  if (!/(?:short read while indexing|failed to insert into database|unable to index file|invalid path)/i.test(text)) return null;
  const pathname = extractGitIndexFailurePath(text);
  return pathname ? windowsReservedGitPathFailure(pathname) : null;
}
