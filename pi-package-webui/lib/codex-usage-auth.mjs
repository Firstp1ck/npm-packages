export const CODEX_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

function privateCredentialStore(modelRuntime) {
  // Compatibility adapter: ModelRuntime intentionally does not expose a
  // force-refresh API. Its RuntimeCredentials store still provides the
  // lock-safe modify() primitive used by normal OAuth resolution.
  const credentials = modelRuntime?.credentials;
  if (!credentials || typeof credentials.read !== "function" || typeof credentials.modify !== "function") {
    throw new Error("Codex OAuth force refresh is unavailable in this Pi version.");
  }
  return credentials;
}

export async function resolveCodexUsageAuth(modelRuntime, providerId, options = {}) {
  const now = options.now ?? Date.now();
  const forceRefresh = options.forceRefresh === true;
  const credentials = privateCredentialStore(modelRuntime);
  const provider = modelRuntime.getProvider(providerId);
  let stored = await credentials.read(providerId);
  let refreshed = false;

  if (stored?.type === "oauth") {
    const oauth = provider?.auth?.oauth;
    if (!oauth || typeof oauth.refresh !== "function") throw new Error("Codex OAuth refresh is unavailable.");
    const rejectedAccess = forceRefresh ? stored.access : undefined;
    const expires = Number(stored.expires);
    const shouldRefresh = forceRefresh || !Number.isFinite(expires) || now + CODEX_TOKEN_REFRESH_SKEW_MS >= expires;

    if (shouldRefresh) {
      await credentials.modify(providerId, async (current) => {
        if (current?.type !== "oauth") return undefined;
        // Another process may have refreshed while this caller waited for the
        // auth-file lock. Reuse that newer token rather than refreshing twice.
        if (forceRefresh && current.access !== rejectedAccess) return undefined;
        const currentExpires = Number(current.expires);
        if (!forceRefresh && Number.isFinite(currentExpires) && now + CODEX_TOKEN_REFRESH_SKEW_MS < currentExpires) return undefined;
        const next = await oauth.refresh(current, options.signal);
        if (!next || next.type !== "oauth") throw new Error("Codex OAuth refresh returned no credential.");
        refreshed = true;
        return next;
      });
      stored = await credentials.read(providerId);
    }

    if (forceRefresh && stored?.type === "oauth" && stored.access === rejectedAccess) {
      throw new Error("Codex OAuth refresh returned the rejected credential.");
    }
    return {
      accessToken: stored?.type === "oauth" ? stored.access : undefined,
      credential: stored,
      refreshed: refreshed || (forceRefresh && stored?.type === "oauth" && stored.access !== rejectedAccess),
    };
  }

  const resolved = await modelRuntime.getAuth(providerId);
  return {
    accessToken: resolved?.auth?.apiKey,
    credential: stored,
    refreshed: false,
  };
}
