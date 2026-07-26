export const SUBAGENT_GATE_RETENTION_MS = 30_000;

export function subagentGateKey(tabId, gateId) {
  const normalizedTabId = String(tabId || "").trim();
  const normalizedGateId = String(gateId || "").trim();
  return normalizedTabId && normalizedGateId ? `${normalizedTabId}:${normalizedGateId}` : "";
}

export function subagentGateIsTerminal(gate) {
  return gate?.status !== "running";
}

export function visibleSubagentGates(tab, dismissedGateKeys, now = Date.now(), retentionMs = SUBAGENT_GATE_RETENTION_MS) {
  const gates = Array.isArray(tab?.gates) ? tab.gates : [];
  return gates.filter((gate) => {
    if (!subagentGateIsTerminal(gate)) return true;
    const key = subagentGateKey(tab?.tabId, gate?.id);
    if (key && dismissedGateKeys?.has?.(key)) return false;
    const endedAt = Number(gate?.endedAt ?? gate?.updatedAt);
    return !Number.isFinite(endedAt) || Math.max(0, now - endedAt) < retentionMs;
  });
}

export function pruneDismissedSubagentGateKeys(tabs, dismissedGateKeys) {
  if (!dismissedGateKeys?.size) return;
  const liveKeys = new Set();
  for (const tab of Array.isArray(tabs) ? tabs : []) {
    for (const gate of Array.isArray(tab?.gates) ? tab.gates : []) {
      const key = subagentGateKey(tab?.tabId, gate?.id);
      if (key) liveKeys.add(key);
    }
  }
  for (const key of dismissedGateKeys) {
    if (!liveKeys.has(key)) dismissedGateKeys.delete(key);
  }
}
