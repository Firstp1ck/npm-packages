import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { createAttachmentStore } from "./attachments.mjs";
import { resolveWorkspaceDirectory } from "./directories.mjs";
import { LIMITS, ProtocolError, boundedString } from "./protocol.mjs";
import { createTranscriptMirror } from "./transcript.mjs";
import { createWorkspaceIndex } from "./workspace.mjs";

// One tab = one Pi session in one working directory, with its own attachments, path index, and a
// bounded transcript mirror. Every event a session emits is tagged with the tab id; the client
// only materializes the active tab and rebuilds it from the mirror when switching. Tabs, their
// directories, session files, and names are saved so a normal restart restores them.

const BADGE_EVENTS = new Set(["message.end", "run.end"]);

export function createTabRegistry({ emit, state, createSession, callerCwd, now = () => Date.now() }) {
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
      }), Math.max(0, order.indexOf(activeId)));
    } catch (error) {
      emit("notice", { level: "warning", message: `Could not save the tab layout: ${boundedString(error.message, 200)}` });
    }
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
    }
    return tab;
  }

  function handleSessionEvent(tab, type, payload) {
    tab.mirror.apply(type, payload);
    let tabsChanged = false;
    if (type === "pi.runtime") {
      const sessionFile = typeof payload.sessionFile === "string" ? payload.sessionFile : "";
      const sessionName = typeof payload.sessionName === "string" ? payload.sessionName : "";
      if (sessionFile !== tab.sessionFile || sessionName !== tab.sessionName) {
        tab.sessionFile = sessionFile;
        tab.sessionName = sessionName;
        tabsChanged = true;
        saveState();
      }
    }
    if (type === "pi.status") {
      tabsChanged = true;
      if (payload.ready && tab.pendingResume) {
        const target = tab.pendingResume;
        tab.pendingResume = "";
        tab.session.switchSession(target).catch((error) => {
          emit("notice", { tab: tab.id, level: "warning", message: `Could not resume ${path.basename(target)}: ${boundedString(error.message, 200)}` });
        });
      }
    }
    if (type === "pi.exit" || type === "pi.started") tabsChanged = true;
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
    if (order.length === 1) {
      // The window always shows one tab; replace the last one with a fresh session in the same place.
      open({ cwd: tab.cwd, select: false });
    }
    tabs.delete(tab.id);
    order = order.filter((entry) => entry !== tab.id);
    if (activeId === tab.id) activeId = order[Math.min(order.length - 1, Math.max(0, order.indexOf(tab.id)))] ?? order[0];
    await tab.session.stop();
    tab.attachments.clear();
    saveState();
    emitTabs();
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

  // Restores the saved tabs whose directories still exist, then makes sure the directory the
  // user launched from has a tab and is selected. Each restored tab resumes its session file.
  function restore() {
    let saved = [];
    try {
      const read = state.read();
      saved = read.value.tabs;
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
    const callerReal = resolveWorkspaceDirectory(callerCwd);
    let callerTab = order.map((id) => tabs.get(id)).find((tab) => tab.cwd === callerReal);
    if (!callerTab) callerTab = tabs.size < LIMITS.maxTabs ? open({ cwd: callerReal, select: false, notify: false }) : tabs.get(order[0]);
    activeId = callerTab.id;
    quiet = false;
    saveState();
    emitTabs();
    return { restored, activeTab: activeId };
  }

  // Restart keeps continuity: the new Pi child resumes the session file the tab was showing.
  async function restart(id) {
    const tab = require(id);
    tab.pendingResume = tab.sessionFile && existsSync(tab.sessionFile) ? tab.sessionFile : "";
    return tab.session.restart();
  }

  async function stopAll() {
    await Promise.all(order.map((id) => tabs.get(id).session.stop()));
  }

  function children() {
    return order.map((id) => tabs.get(id).session.child).filter(Boolean);
  }

  return { open, close, select, rename, move, restart, restore, list, get, require, active, replay, stopAll, children, saveState, get activeId() { return activeId; }, get size() { return tabs.size; } };
}
