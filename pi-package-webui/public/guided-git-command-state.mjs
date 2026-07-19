function commandBaseName(name) {
  return String(name || "").replace(/:\d+$/, "");
}

function commandNameMatches(commandName, requestedName) {
  const commandText = String(commandName || "");
  const requested = String(requestedName || "");
  return commandText === requested || (commandText.startsWith(`${requested}:`) && /^\d+$/.test(commandText.slice(requested.length + 1)));
}

/** Resolve only from one tab's already-normalized command catalog. */
export function resolveCommandForTabCatalog(catalog, name, { rpcOnly = false } = {}) {
  const requested = String(name || "").trim();
  if (!requested) return null;
  const raw = Array.isArray(catalog?.raw) ? catalog.raw : [];
  const available = Array.isArray(catalog?.available) ? catalog.available : raw;
  const commands = (rpcOnly ? raw : available).filter((command) => !rpcOnly || command.source !== "native");
  const exact = commands.find((command) => command.name === requested || command.invokeName === requested || command.duplicateNames?.includes(requested));
  if (exact) return exact;
  const canUseBaseAlias = available.some((command) => commandBaseName(command.name) === requested && command.invokeName && command.duplicateCount > 1);
  return canUseBaseAlias ? commands.find((command) => commandNameMatches(command?.name, requested)) || null : null;
}

export function resolveRpcSlashCommandForTabCatalog(catalog, message) {
  const text = String(message || "");
  const match = text.match(/^\/([^\s]+)([\s\S]*)$/);
  if (!match) return text;
  const resolvedName = resolveCommandForTabCatalog(catalog, match[1], { rpcOnly: true })?.name || "";
  return resolvedName && resolvedName !== match[1] ? `/${resolvedName}${match[2]}` : text;
}

export function guidedGitReviewAvailableForTabCatalog(catalog) {
  return !!resolveCommandForTabCatalog(catalog, "aur-review", { rpcOnly: true });
}
