import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { createAttachmentStore } from "./attachments.mjs";
import { resolveWorkspaceDirectory } from "./directories.mjs";
import { LIMITS, ProtocolError, boundedString } from "./protocol.mjs";
import { createTranscriptMirror, rowsFromHistory } from "./transcript.mjs";
import { createWorkspaceIndex } from "./workspace.mjs";

// One tab = one Pi session in one working directory, with its own attachments, path index, and a
// bounded transcript mirror. Every event a session emits is tagged with the tab id; the client
// only materializes the active tab and rebuilds it from the mirror when switching. Tabs, their
// directories, session files, and names are saved so a normal restart restores them.

const BADGE_EVENTS = new Set(["message.end", "run.end"]);

export function createTabRegistry({
  emit,
  state,
  createSession,
  callerCwd,
  now = () => Date.now(),
  onSessionPathsChange = () => {},
  onSessionIdle = () => {},
}) {
  const tabs = new Map();
  let order = [];
  let activeId = "";
  let serial = 0;
  let quiet = false; // suppresses tabs.update while a batch (restore) is in progress

  function get(id) {
    return tabs.get(id) ?? null;
  }

  function require(id) {
    const tab = get(id || activeId);
    if (!tab) throw new ProtocolError("stale_request", "That tab no longer exists");
    return tab;
  }

  function active() {
    return get(activeId);
  }

  function summary(tab) {
    const snapshot = tab.session.snapshot();
    return {
      id: tab.id,
      cwd: tab.cwd,
      name: tab.name,
      sessionFile: tab.sessionFile,
      sessionName: tab.sessionName,
      statusKind: snapshot.statusKind,
      statusText: snapshot.statusText,
      ready: snapshot.ready,
      active: snapshot.active,
      unread: tab.unread,
      needsInput: snapshot.pendingDialogs,
      pid: snapshot.pid,
    };
  }

  function list() {
    return { tabs: order.map((id) => summary(tabs.get(id))), activeTab: activeId, maxTabs: LIMITS.maxTabs };
  }

  let lastTabsJson = "";

  // Only changed summaries are sent, so status churn during a run does not flood the client.
  function emitTabs() {
    if (quiet) return;
    const next = list();
    const serialized = JSON.stringify(next);
    if (serialized === lastTabsJson) return;
    lastTabsJson = serialized;
    emit("tabs.update", next);
  }

  function saveState() {
    try {
      state.saveTabs(order.map((id) => {
        const tab = tabs.get(id);
        return { cwd: tab.cwd, sessionFile: tab.sessionFile, name: tab.name };
      }), activeId ? order.indexOf(activeId) : -1);
    } catch (error) {
      emit("notice", { level: "warning", message: `Could not save the tab layout: ${boundedString(error.message, 200)}` });
    }
  }

  function sessionPathsChanged() {
    try {
      const result = onSessionPathsChange(sessionPaths());
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch {
      // Monitoring is advisory and must not break tab lifecycle operations.
    }
  }

  function comparableRows(rows) {
    return rows.map((row) => [
      row.role,
      row.kind,
      row.text,
      row.blocksJson,
      row.truncated,
      row.modeLabel,
      row.attachments,
      row.toolName,
      row.toolSummary,
      row.toolStatus,
      row.toolOutput,
      row.toolError,
    ]);
  }

  function snapshotMetadata(snapshot) {
    return {
      sessionId: snapshot.sessionId,
      name: snapshot.name,
      thinkingLevel: snapshot.thinkingLevel,
      model: snapshot.model
        ? { provider: snapshot.model.provider ?? "", modelId: snapshot.model.modelId ?? snapshot.model.id ?? "" }
        : null,
    };
  }

  // Replays the mirror to the client as tagged events so a switch or resume rebuilds the
  // transcript from authoritative state. Rows go one per frame to respect the frame budget.
  function replay(tab) {
    emit("transcript.reset", { tab: tab.id });
    for (const row of tab.mirror.rows()) emit("transcript.row", { tab: tab.id, row });
  }

  function open({ cwd = callerCwd, sessionPath = "", name = "", select = true, notify = true } = {}) {
    if (tabs.size >= LIMITS.maxTabs) throw new ProtocolError("limit_exceeded", `At most ${LIMITS.maxTabs} tabs can be open`);
    const directory = resolveWorkspaceDirectory(cwd);
    serial += 1;
    const id = `tab-${serial}`;
    const tab = {
      id,
      cwd: directory,
      name: boundedString(name, LIMITS.maxTabNameCharacters, ""),
      sessionFile: "",
      sessionName: "",
      unread: 0,
      pendingResume: sessionPath && existsSync(sessionPath) ? sessionPath : "",
      transitionSessionFile: "",
      staleSessionFile: "",
      staleGeneration: 0,
      preparationPromise: null,
      persistedMetadataJson: "",
      mirror: createTranscriptMirror(),
      attachments: createAttachmentStore({ workspaceRoot: directory }),
      workspace: createWorkspaceIndex({ root: directory }),
      session: null,
      createdAt: now(),
    };
    tab.session = createSession({
      cwd: directory,
      emit: (type, payload = {}) => handleSessionEvent(tab, type, payload),
    });
    tabs.set(id, tab);
    order.push(id);
    if (select || !activeId) activeId = id;
    tab.session.start();
    if (notify) {
      saveState();
      emitTabs();
      sessionPathsChanged();
    }
    return tab;
  }

  function handleSessionEvent(tab, type, payload) {
    if (type === "transcript.row" && payload.row) tab.mirror.replace([...tab.mirror.rows(), payload.row]);
    else tab.mirror.apply(type, payload);
    let tabsChanged = false;
    if (type === "pi.runtime") {
      const sessionFile = typeof payload.sessionFile === "string" ? payload.sessionFile : "";
      const sessionName = typeof payload.sessionName === "string" ? payload.sessionName : "";
      if (sessionFile !== tab.sessionFile || sessionName !== tab.sessionName) {
        tab.sessionFile = sessionFile;
        tab.sessionName = sessionName;
        tabsChanged = true;
        saveState();
        sessionPathsChanged();
      }
    }
    if (type === "pi.status") {
      tabsChanged = true;
      if (payload.ready && tab.pendingResume) {
        const target = tab.pendingResume;
        const switching = switchSession(tab.id, target);
        tab.pendingResume = "";
        switching.catch((error) => {
          emit("notice", { tab: tab.id, level: "warning", message: `Could not resume ${path.basename(target)}: ${boundedString(error.message, 200)}` });
        });
      }
    }
    if (type === "pi.exit" || type === "pi.started") tabsChanged = true;
    if (type === "run.end" || (type === "pi.status" && payload.ready === true && payload.active === false)) {
      try {
        const result = onSessionIdle(tab);
        if (result && typeof result.catch === "function") result.catch(() => {});
      } catch {
        // A monitor retry must not disturb Pi event processing.
      }
    }
    if (tab.id !== activeId) {
      if (BADGE_EVENTS.has(type)) {
        tab.unread += 1;
        tabsChanged = true;
      }
      if (type === "extension.request" || type === "extension.cancelled" || type === "extension.answered") tabsChanged = true;
    }
    emit(type, { tab: tab.id, ...payload });
    if (tabsChanged) emitTabs();
  }

  // The client switches on tabs.update, so it is sent before the transcript replay.
  function select(id) {
    const tab = require(id);
    activeId = tab.id;
    tab.unread = 0;
    saveState();
    emitTabs();
    replay(tab);
    return tab;
  }

  async function close(id, { force = false } = {}) {
    const tab = require(id);
    const snapshot = tab.session.snapshot();
    if (snapshot.active && !force) throw new ProtocolError("busy", "A run is still in progress in that tab; closing it aborts the run and stops its Pi process");
    tabs.delete(tab.id);
    order = order.filter((entry) => entry !== tab.id);
    if (activeId === tab.id) activeId = "";
    await tab.session.stop();
    tab.attachments.clear();
    saveState();
    emitTabs();
    sessionPathsChanged();
    if (activeId) {
      const next = tabs.get(activeId);
      next.unread = 0;
      replay(next);
    }
    return { closed: tab.id, activeTab: activeId, pid: snapshot.pid };
  }

  function rename(id, name) {
    const tab = require(id);
    tab.name = boundedString(name, LIMITS.maxTabNameCharacters, "").trim();
    saveState();
    emitTabs();
    return summary(tab);
  }

  function move(id, delta) {
    const tab = require(id);
    const index = order.indexOf(tab.id);
    const target = Math.max(0, Math.min(order.length - 1, index + delta));
    order.splice(index, 1);
    order.splice(target, 0, tab.id);
    saveState();
    emitTabs();
    return list();
  }

  // Restores saved tabs whose directories still exist. An explicit -1 selection preserves the
  // empty workspace; older state still opens and selects the directory the user launched from.
  function restore() {
    let saved = [];
    let savedActive = 0;
    try {
      const read = state.read();
      saved = read.value.tabs;
      savedActive = read.value.activeTab;
      for (const problem of read.problems) emit("notice", { level: "warning", message: `State: ${problem}` });
    } catch (error) {
      emit("notice", { level: "warning", message: `Could not read the saved tabs: ${boundedString(error.message, 200)}` });
    }
    let restored = 0;
    quiet = true;
    for (const entry of saved) {
      if (tabs.size >= LIMITS.maxTabs) break;
      let usable = false;
      try {
        usable = statSync(entry.cwd).isDirectory();
      } catch {
        usable = false;
      }
      if (!usable) {
        emit("notice", { level: "info", message: `Skipped the saved tab for ${boundedString(entry.cwd, 120)}: the folder no longer exists` });
        continue;
      }
      try {
        open({ cwd: entry.cwd, sessionPath: entry.sessionFile, name: entry.name, select: false, notify: false });
        restored += 1;
      } catch (error) {
        emit("notice", { level: "warning", message: `Could not restore the tab for ${boundedString(entry.cwd, 120)}: ${boundedString(error.message, 160)}` });
      }
    }
    if (savedActive !== -1) {
      const callerReal = resolveWorkspaceDirectory(callerCwd);
      let callerTab = order.map((id) => tabs.get(id)).find((tab) => tab.cwd === callerReal);
      if (!callerTab) callerTab = tabs.size < LIMITS.maxTabs ? open({ cwd: callerReal, select: false, notify: false }) : tabs.get(order[0]);
      activeId = callerTab.id;
    } else {
      activeId = "";
    }
    quiet = false;
    saveState();
    emitTabs();
    sessionPathsChanged();
    return { restored, activeTab: activeId };
  }

  // Session targets stay registry-private while Pi is starting or changing sessions, so catalog
  // reconciliation can treat every path owned by an open tab as open throughout the transition.
  async function switchSession(id, sessionPath, { staleGeneration = null } = {}) {
    const tab = require(id);
    tab.transitionSessionFile = sessionPath;
    sessionPathsChanged();
    try {
      const result = await tab.session.switchSession(sessionPath);
      const clearsPreparedGeneration = staleGeneration === null
        || (tab.staleGeneration === staleGeneration && tab.staleSessionFile === sessionPath);
      if (clearsPreparedGeneration) {
        tab.staleSessionFile = "";
        tab.persistedMetadataJson = "";
        if (staleGeneration === null) tab.staleGeneration += 1;
      }
      return result;
    } finally {
      if (tab.transitionSessionFile === sessionPath) tab.transitionSessionFile = "";
      sessionPathsChanged();
    }
  }

  function prepareMutation(id) {
    const tab = require(id);
    if (tab.preparationPromise) return tab.preparationPromise;
    if (!tab.staleSessionFile) return Promise.resolve(false);
    const current = tab.sessionFile;
    const staleGeneration = tab.staleGeneration;
    if (!current || current !== tab.staleSessionFile) {
      if (tab.staleGeneration === staleGeneration) tab.staleSessionFile = "";
      return Promise.resolve(false);
    }
    const preparation = switchSession(tab.id, current, { staleGeneration }).then(() => true);
    tab.preparationPromise = preparation.finally(() => {
      if (tab.preparationPromise === preparationWithCleanup) tab.preparationPromise = null;
    });
    const preparationWithCleanup = tab.preparationPromise;
    return preparationWithCleanup;
  }

  function isPreparingMutation(id) {
    return Boolean(get(id)?.preparationPromise);
  }

  function sessionSyncGeneration(id) {
    return get(id)?.staleGeneration ?? -1;
  }

  async function newSession(id) {
    const tab = require(id);
    tab.transitionSessionFile = tab.sessionFile;
    sessionPathsChanged();
    try {
      const result = await tab.session.newSession();
      tab.staleSessionFile = "";
      tab.staleGeneration += 1;
      tab.persistedMetadataJson = "";
      return result;
    } finally {
      tab.transitionSessionFile = "";
      sessionPathsChanged();
    }
  }

  function applyExternalSnapshot(sessionPath, snapshot) {
    const resolved = path.resolve(sessionPath);
    const tab = order.map((id) => tabs.get(id)).find((candidate) => candidate.sessionFile && path.resolve(candidate.sessionFile) === resolved);
    if (!tab) return { applied: false, reason: "not-open" };
    if (tab.session.snapshot().active) return { applied: false, reason: "active" };

    const projected = rowsFromHistory(snapshot.messages);
    const rowsEqual = JSON.stringify(comparableRows(tab.mirror.rows())) === JSON.stringify(comparableRows(projected.rows));
    const metadata = snapshotMetadata(snapshot);
    const metadataJson = JSON.stringify(metadata);
    const runtime = tab.session.snapshot().runtime;
    const metadataEqual = tab.persistedMetadataJson
      ? metadataJson === tab.persistedMetadataJson
      : metadata.sessionId === runtime.sessionId
        && metadata.name === tab.sessionName
        && metadata.thinkingLevel === runtime.thinkingLevel
        && (metadata.model?.provider ?? "") === runtime.provider
        && (metadata.model?.modelId ?? "") === runtime.modelId;
    if (rowsEqual && metadataEqual) {
      tab.persistedMetadataJson = metadataJson;
      return { applied: false, reason: "equal" };
    }

    tab.mirror.replace(projected.rows);
    tab.persistedMetadataJson = metadataJson;
    tab.staleGeneration += 1;
    tab.staleSessionFile = tab.sessionFile;
    tab.session.applyPersistedSnapshotMetadata(snapshot, projected.messageCount);
    if (snapshot.name !== tab.sessionName) {
      tab.sessionName = snapshot.name;
      saveState();
    }
    if (tab.id === activeId) replay(tab);
    else {
      tab.unread += 1;
      emitTabs();
    }
    return { applied: true, reason: "different", tabId: tab.id, active: tab.id === activeId };
  }

  function sessionPaths() {
    const entries = [];
    for (const id of order) {
      const tab = tabs.get(id);
      const seen = new Set();
      for (const sessionPath of [tab.sessionFile, tab.pendingResume, tab.transitionSessionFile]) {
        if (!sessionPath || seen.has(sessionPath)) continue;
        seen.add(sessionPath);
        entries.push({ tabId: tab.id, path: sessionPath });
      }
    }
    return entries;
  }

  // Restart keeps continuity: the new Pi child resumes the session file the tab was showing.
  async function restart(id) {
    const tab = require(id);
    tab.pendingResume = tab.sessionFile && existsSync(tab.sessionFile) ? tab.sessionFile : "";
    sessionPathsChanged();
    return tab.session.restart();
  }

  async function stopAll() {
    await Promise.all(order.map((id) => tabs.get(id).session.stop()));
  }

  function children() {
    return order.map((id) => tabs.get(id).session.child).filter(Boolean);
  }

  return {
    open,
    close,
    select,
    rename,
    move,
    restart,
    restore,
    switchSession,
    prepareMutation,
    isPreparingMutation,
    sessionSyncGeneration,
    newSession,
    applyExternalSnapshot,
    sessionPaths,
    list,
    get,
    require,
    active,
    replay,
    stopAll,
    children,
    saveState,
    get activeId() { return activeId; },
    get size() { return tabs.size; },
  };
}
