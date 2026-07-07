export const TRUST_GUARD_TYPES = new Set([
  "none",
  "confirmation",
  "localhost",
  "trusted-context",
  "feature-flag",
  "upstream-rpc",
  "read-only",
]);

/** HTTP POST routes that mutate server state and require a localhost client. */
export const LOCALHOST_ONLY_POST_ROUTES = new Map([
  ["/api/network/open", "Opening to the network is only allowed from localhost"],
  ["/api/network/close", "Closing network access is only allowed from localhost"],
  ["/api/remote-auth/settings", "Remote PIN authentication settings are only allowed from localhost"],
  ["/api/restart", "Restart is only allowed from localhost"],
  ["/api/update", "Updating Pi from the Web UI is only allowed from localhost"],
  ["/api/shutdown", "Shutdown is only allowed from localhost"],
  ["/api/optional-feature-install", "Installing optional Web UI features is only allowed from localhost"],
  ["/api/skill-file", "Saving skill files is only allowed from localhost"],
  ["/api/files/content", "Saving files from the Web UI is only allowed from localhost"],
  ["/api/files/open-default", "Opening files in the default editor is only allowed from localhost"],
  ["/api/session-delete", "Deleting sessions is only allowed from localhost"],
  ["/api/auth-logout", "Removing stored provider credentials is only allowed from localhost"],
]);

export const REMOTE_SHELL_WARNING =
  "This Web UI client is not on localhost. Shell commands run on the server as the Web UI process user.";

/** Guards enforced before native slash commands run; confirmation stays handler-specific. */
export const DISPATCH_TRUST_GUARDS = new Set(["localhost", "trusted-context"]);

export function isLocalAddress(address = "") {
  const normalized = String(address || "").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "::1" || normalized === "localhost") return true;
  if (normalized.startsWith("127.")) return true;
  if (normalized.startsWith("::ffff:127.")) return true;
  return normalized === "::ffff:127.0.0.1";
}

export function isLocalRequest(req) {
  return isLocalAddress(req?.socket?.remoteAddress);
}

export function makeTrustError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.trust = details;
  return error;
}

export function requireLocalhost(req, message = "This action is only allowed from localhost") {
  if (!isLocalRequest(req)) throw makeTrustError(403, message, { guard: "localhost" });
}

export function requireLocalhostRoute(req, pathname) {
  const message = LOCALHOST_ONLY_POST_ROUTES.get(pathname);
  if (message) requireLocalhost(req, message);
}

export function nativeParitySurfaces(matrix) {
  return Array.isArray(matrix?.surfaces) ? matrix.surfaces : [];
}

export function guardsForNativeCommand(commandName, matrix) {
  const surface = nativeParitySurfaces(matrix).find(
    (item) => item?.kind === "slash-command" && item.command?.name === commandName,
  );
  return Array.isArray(surface?.guards) ? surface.guards : ["none"];
}

export function evaluateDispatchTrustGuards(guards, context = {}) {
  const relevant = (guards || []).filter((guard) => DISPATCH_TRUST_GUARDS.has(guard));
  if (!relevant.length) return { allowed: true, blocked: [], warnings: [] };
  return evaluateTrustGuards(relevant, context);
}

export function evaluateTrustGuards(guards, context = {}) {
  const blocked = [];
  const warnings = [];
  const isLocal = context.isLocal === true;
  const confirmed = context.confirmed === true;
  const networkOpen = context.networkOpen === true;

  for (const guard of guards || []) {
    if (!TRUST_GUARD_TYPES.has(guard)) continue;
    switch (guard) {
      case "none":
      case "read-only":
      case "upstream-rpc":
      case "feature-flag":
        break;
      case "localhost":
        if (!isLocal) blocked.push(guard);
        break;
      case "trusted-context":
        if (!isLocal) blocked.push(guard);
        break;
      case "confirmation":
        if (!confirmed) blocked.push(guard);
        break;
      default:
        break;
    }
  }

  if (!isLocal && networkOpen && (guards || []).some((guard) => guard === "trusted-context" || guard === "localhost")) {
    warnings.push(REMOTE_SHELL_WARNING);
  }

  return { allowed: blocked.length === 0, blocked, warnings };
}

export function trustBlockMessage(commandName, blockedGuards = []) {
  if (blockedGuards.includes("localhost") || blockedGuards.includes("trusted-context")) {
    return `/${commandName} is blocked for non-localhost browser clients. Connect via localhost or use the Pi TUI.`;
  }
  if (blockedGuards.includes("confirmation")) {
    return `/${commandName} requires explicit confirmation before it can run from the Web UI.`;
  }
  return `/${commandName} is blocked by Web UI trust policy.`;
}

export function assertNativeCommandTrust(req, commandName, matrix, options = {}) {
  const guards = guardsForNativeCommand(commandName, matrix);
  const evaluation = evaluateDispatchTrustGuards(guards, {
    isLocal: isLocalRequest(req),
    confirmed: options.confirmed === true,
    networkOpen: options.networkOpen === true,
  });
  if (evaluation.allowed) return evaluation;
  throw makeTrustError(403, trustBlockMessage(commandName, evaluation.blocked), {
    guard: evaluation.blocked[0],
    command: commandName,
    blocked: evaluation.blocked,
    warnings: evaluation.warnings,
  });
}

export function remoteShellTrustWarning(req, networkOpen = false) {
  if (isLocalRequest(req) || !networkOpen) return undefined;
  return REMOTE_SHELL_WARNING;
}
