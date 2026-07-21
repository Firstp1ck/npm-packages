import { watch as watchDirectory } from "node:fs";
import path from "node:path";

export const GIT_LIVE_WATCH_DEBOUNCE_MS = 250;
export const GIT_LIVE_WATCH_MAX_WAIT_MS = 2_000;

function cleanTabId(value) {
  return String(value || "").trim();
}

function canonicalRoot(value) {
  const root = String(value || "").trim();
  return root ? path.resolve(root) : "";
}

export function createGitLiveWatcher({
  watch = watchDirectory,
  debounceMs = GIT_LIVE_WATCH_DEBOUNCE_MS,
  maxWaitMs = GIT_LIVE_WATCH_MAX_WAIT_MS,
  onChange = () => {},
  onError = () => {},
} = {}) {
  const roots = new Map();
  const tabRoots = new Map();
  const delayMs = Math.max(0, Number(debounceMs) || 0);
  const maximumWaitMs = Math.max(0, Number(maxWaitMs) || GIT_LIVE_WATCH_MAX_WAIT_MS);

  function reportError(root, error) {
    try {
      onError({ root, error });
    } catch {
      // Watcher diagnostics must never crash the Web UI server.
    }
  }

  function closeRoot(root, { clearTabs = true } = {}) {
    const record = roots.get(root);
    if (!record) return false;
    roots.delete(root);
    if (record.timer) clearTimeout(record.timer);
    try {
      record.watcher?.close();
    } catch {
      // The watcher may already be closed after an error.
    }
    if (clearTabs) {
      for (const tabId of record.tabs) {
        if (tabRoots.get(tabId) === root) tabRoots.delete(tabId);
      }
    }
    return true;
  }

  function failRoot(root, error) {
    if (!roots.has(root)) return;
    closeRoot(root);
    reportError(root, error);
  }

  function scheduleChange(root) {
    const record = roots.get(root);
    if (!record) return;
    if (record.timer) clearTimeout(record.timer);
    const now = Date.now();
    if (!record.burstStartedAt) record.burstStartedAt = now;
    const remainingMs = Math.max(0, maximumWaitMs - (now - record.burstStartedAt));
    record.timer = setTimeout(() => {
      const current = roots.get(root);
      if (!current || current !== record) return;
      current.timer = null;
      current.burstStartedAt = 0;
      try {
        onChange({ root, changedAt: new Date().toISOString() });
      } catch (error) {
        reportError(root, error);
      }
    }, Math.min(delayMs, remainingMs));
    record.timer.unref?.();
  }

  function ensureRoot(root) {
    const existing = roots.get(root);
    if (existing) return existing;
    const record = { root, tabs: new Set(), watcher: null, timer: null, burstStartedAt: 0 };
    roots.set(root, record);
    try {
      record.watcher = watch(root, { recursive: true, persistent: false }, () => scheduleChange(root));
      record.watcher.on?.("error", (error) => failRoot(root, error));
      return record;
    } catch (error) {
      roots.delete(root);
      reportError(root, error);
      return null;
    }
  }

  function unsubscribe(tabIdValue) {
    const tabId = cleanTabId(tabIdValue);
    const root = tabRoots.get(tabId);
    if (!root) return false;
    tabRoots.delete(tabId);
    const record = roots.get(root);
    if (!record) return true;
    record.tabs.delete(tabId);
    if (!record.tabs.size) closeRoot(root, { clearTabs: false });
    return true;
  }

  function subscribe(tabIdValue, rootValue) {
    const tabId = cleanTabId(tabIdValue);
    const root = canonicalRoot(rootValue);
    if (!tabId || !root) return false;
    const previousRoot = tabRoots.get(tabId);
    if (previousRoot === root && roots.has(root)) return true;
    if (previousRoot) unsubscribe(tabId);
    const record = ensureRoot(root);
    if (!record) return false;
    record.tabs.add(tabId);
    tabRoots.set(tabId, root);
    return true;
  }

  function closeAll() {
    for (const root of [...roots.keys()]) closeRoot(root);
    tabRoots.clear();
  }

  return {
    subscribe,
    unsubscribe,
    closeAll,
    watchedRootCount: () => roots.size,
    subscribedRootForTab: (tabId) => tabRoots.get(cleanTabId(tabId)) || "",
  };
}
