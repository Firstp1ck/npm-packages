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
  const nativeOwnsBaseName = rpcOnly && raw.some((command) => command.source === "native" && command.name === requested);
  const canUseBaseAlias = nativeOwnsBaseName
    || available.some((command) => commandBaseName(command.name) === requested && command.invokeName && command.duplicateCount > 1);
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

export function guidedGitLaunchModeForTabCatalog(catalog, { disabled = false } = {}) {
  if (disabled) return "disabled";
  if (resolveCommandForTabCatalog(catalog, "git-guided-workflow", { rpcOnly: true })) return "extension";
  if (resolveCommandForTabCatalog(catalog, "git-staged-msg", { rpcOnly: true })) return "fallback";
  return "unavailable";
}

export function guidedGitWorkflowCommandForTabCatalog(catalog, message) {
  const match = String(message || "").trim().match(/^\/([^\s]+)$/u);
  if (!match) return false;
  const command = resolveCommandForTabCatalog(catalog, match[1], { rpcOnly: true });
  return commandBaseName(command?.name) === "git-guided-workflow";
}

export function guidedGitLaunchBlockedReason(state, queuedMessageCount = 0) {
  if (!state || typeof state !== "object") return "state-unavailable";
  if (state.isCompacting === true) return "compacting";
  if (state.isStreaming === true) return "streaming";
  if (Number(state.pendingMessageCount || 0) > 0 || Number(queuedMessageCount || 0) > 0) return "pending";
  return "";
}

export function createGuidedGitLaunchPermitController({ maxTrackedTabs = 64, permitTtlMs = 15_000 } = {}) {
  const permitsByTab = new Map();

  function prune(now) {
    for (const [tabId, permit] of permitsByTab) {
      if (now - permit.grantedAt > permitTtlMs) permitsByTab.delete(tabId);
    }
  }

  function grant(tabId, launchId, now = Date.now()) {
    if (typeof tabId !== "string" || !tabId || typeof launchId !== "string" || !GUIDED_GIT_START_REQUEST_ID.test(launchId)) return false;
    prune(now);
    if (permitsByTab.has(tabId)) return false;
    permitsByTab.set(tabId, { launchId, grantedAt: now });
    while (permitsByTab.size > maxTrackedTabs) permitsByTab.delete(permitsByTab.keys().next().value);
    return permitsByTab.has(tabId);
  }

  function consume(tabId, launchId, now = Date.now()) {
    prune(now);
    const permit = permitsByTab.get(tabId);
    if (!permit || permit.launchId !== launchId) return false;
    permitsByTab.delete(tabId);
    return true;
  }

  function clearTab(tabId) {
    permitsByTab.delete(tabId);
  }

  return {
    grant,
    consume,
    clearTab,
    inspect() {
      return {
        trackedTabs: permitsByTab.size,
        hasPermit: (tabId) => permitsByTab.has(tabId),
        launchIdForTab: (tabId) => permitsByTab.get(tabId)?.launchId || "",
      };
    },
  };
}

export const GUIDED_GIT_START_STATUS_KEY = "git-guided-workflow:webui-start";
export const GUIDED_GIT_START_PAYLOAD_TYPE = "firstpick.pi-extension-git-guided-workflow.start";
export const GUIDED_GIT_START_PAYLOAD_VERSION = 1;
export const GUIDED_GIT_START_PAYLOAD_MAX_BYTES = 1024;
const GUIDED_GIT_START_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const GUIDED_GIT_START_PAYLOAD_KEYS = ["action", "requestId", "type", "version"];

export function parseGuidedGitStartPayload(raw) {
  if (typeof raw !== "string" || !raw || new TextEncoder().encode(raw).length > GUIDED_GIT_START_PAYLOAD_MAX_BYTES) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== GUIDED_GIT_START_PAYLOAD_KEYS.length || keys.some((key, index) => key !== GUIDED_GIT_START_PAYLOAD_KEYS[index])) return null;
  if (value.type !== GUIDED_GIT_START_PAYLOAD_TYPE || value.version !== GUIDED_GIT_START_PAYLOAD_VERSION || value.action !== "start") return null;
  if (typeof value.requestId !== "string" || !GUIDED_GIT_START_REQUEST_ID.test(value.requestId)) return null;
  return { type: value.type, version: value.version, action: value.action, requestId: value.requestId };
}

export function createGuidedGitActivationController({ maxSeenPerTab = 64, maxTrackedTabs = 64, seenTtlMs = 5 * 60 * 1000, claimStart = () => true } = {}) {
  const seenByTab = new Map();
  const startsByTab = new Map();
  const startOwnersByTab = new Map();

  function prune(now) {
    for (const [tabId, seen] of seenByTab) {
      for (const [requestId, receivedAt] of seen) {
        if (now - receivedAt > seenTtlMs) seen.delete(requestId);
      }
      if (!seen.size) seenByTab.delete(tabId);
    }
    while (seenByTab.size > maxTrackedTabs) seenByTab.delete(seenByTab.keys().next().value);
  }

  function accept(tabId, requestId, now) {
    prune(now);
    let seen = seenByTab.get(tabId);
    if (!seen) {
      seen = new Map();
      seenByTab.set(tabId, seen);
      while (seenByTab.size > maxTrackedTabs) seenByTab.delete(seenByTab.keys().next().value);
      if (!seenByTab.has(tabId)) return false;
    }
    if (seen.has(requestId)) return false;
    seen.set(requestId, now);
    while (seen.size > maxSeenPerTab) seen.delete(seen.keys().next().value);
    return true;
  }

  function run(tabId, start) {
    const existing = startsByTab.get(tabId);
    if (existing) return existing;
    const owner = Symbol(tabId);
    startOwnersByTab.set(tabId, owner);
    let promise;
    promise = Promise.resolve()
      .then(() => start(tabId, () => startOwnersByTab.get(tabId) === owner))
      .finally(() => {
        if (startsByTab.get(tabId) === promise) startsByTab.delete(tabId);
        if (startOwnersByTab.get(tabId) === owner) startOwnersByTab.delete(tabId);
      });
    startsByTab.set(tabId, promise);
    return promise;
  }

  function consume(request, start, now = Date.now()) {
    const tabId = typeof request?.tabId === "string" ? request.tabId : "";
    if (!tabId || request?.replayed === true || !request?.statusText) return { status: "ignored", payload: null, promise: null };
    const payload = parseGuidedGitStartPayload(request.statusText);
    if (!payload) return { status: "invalid", payload: null, promise: null };
    let claimed = false;
    try {
      claimed = claimStart(tabId, payload, request, now) === true;
    } catch {
      claimed = false;
    }
    if (!claimed) return { status: "unclaimed", payload, promise: null };
    if (!accept(tabId, payload.requestId, now)) return { status: "duplicate", payload, promise: null };
    const folded = startsByTab.has(tabId);
    return { status: folded ? "folded" : "started", payload, promise: run(tabId, start) };
  }

  function clearTab(tabId) {
    seenByTab.delete(tabId);
    startsByTab.delete(tabId);
    startOwnersByTab.delete(tabId);
  }

  return {
    consume,
    run,
    clearTab,
    inspect() {
      return {
        trackedTabs: seenByTab.size,
        seenForTab: (tabId) => seenByTab.get(tabId)?.size || 0,
        inFlightTabs: startsByTab.size,
      };
    },
  };
}
