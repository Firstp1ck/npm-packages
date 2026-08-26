#!/usr/bin/env node
import path from "node:path";
import { openExternalLink, openLocalPath, sendDesktopNotification } from "./desktop.mjs";
import { createDirectory, listDirectory } from "./directories.mjs";
import { createWorktree, listWorktrees, planWorktree } from "./git.mjs";
import { attachJsonlReader } from "./jsonl.mjs";
import { createPiSession } from "./pi-session.mjs";
import { killProcessTreeNow } from "./process-tree.mjs";
import {
  LIMITS,
  PROTOCOL_VERSION,
  ProtocolError,
  boundedError,
  encodeFrame,
  makeErrorResponse,
  makeEvent,
  makeResponse,
  validateRequest,
} from "./protocol.mjs";
import { createSequenceStore } from "./sequences.mjs";
import { listSessions } from "./sessions-index.mjs";
import { createSettingsStore } from "./settings.mjs";
import { createStateStore } from "./state.mjs";
import { createTabRegistry } from "./tabs.mjs";

// Backend entry point. Quickshell starts this process, writes protocol requests to its stdin,
// and reads responses and events from its stdout. The backend owns every Pi child (one per tab)
// and every helper it starts; closing stdin, SIGINT, SIGTERM, SIGHUP, or a fatal error all lead
// to the same bounded shutdown that terminates and reaps the whole process tree.

const COALESCABLE_EVENTS = new Set(["part.render", "tool.update"]);

export function createBackend({
  input = process.stdin,
  output = process.stdout,
  env = process.env,
  exit = (code) => process.exit(code),
  onFatal = null,
} = {}) {
  const smokeMode = env.QT_WEBUI_SMOKE_MODE === "1";
  const nodeExecutable = env.QT_WEBUI_NODE_EXECUTABLE || process.execPath;
  const piCliEntry = env.QT_WEBUI_PI_CLI_ENTRY || "";
  const cwd = env.QT_WEBUI_CALLER_CWD || process.cwd();
  const startupReadinessMs = Number.parseInt(env.QT_WEBUI_PI_STARTUP_TIMEOUT_MS ?? "", 10);
  const piRequestTimeoutMs = smokeMode ? Number.parseInt(env.QT_WEBUI_PI_REQUEST_TIMEOUT_MS ?? "", 10) : Number.NaN;

  let sequence = 0;
  let dropped = 0;
  let droppedTotal = 0;
  let queuedRecords = 0;
  let maxWritableLength = 0;
  let backpressured = false;
  let backpressurePauses = 0;
  let closing = false;
  let shutdownPromise = null;
  const inflight = new Map();

  // Slow-consumer policy: coalescable records (streaming renders, tool progress) are dropped
  // while the outbound queue is over budget; essential records are always written, and every
  // Pi child's stdout is paused until the queue drains so memory stays bounded.
  function engageBackpressure() {
    if (backpressured) return;
    backpressured = true;
    backpressurePauses += 1;
    for (const tab of allTabs()) tab.session.pauseInput();
    emit("backend.backpressure", { paused: true, queuedBytes: output.writableLength });
    output.once("drain", () => {
      backpressured = false;
      for (const tab of allTabs()) tab.session.resumeInput();
      emit("backend.backpressure", { paused: false, queuedBytes: output.writableLength });
    });
  }

  function writeFrame(record, { essential }) {
    let text = encodeFrame(record);
    if (Buffer.byteLength(text, "utf8") > LIMITS.maxOutboundFrameBytes) {
      const replacement = record.kind === "response"
        ? makeErrorResponse(record.id, "limit_exceeded", "response exceeded the outbound frame limit")
        : makeEvent("notice", { seq: record.seq, level: "error", message: `Dropped an oversized ${record.type} event` });
      text = encodeFrame(replacement);
    }
    const bytes = Buffer.byteLength(text, "utf8");
    const queuedBytes = output.writableLength;
    if (queuedBytes > maxWritableLength) maxWritableLength = queuedBytes;
    const overBudget = queuedBytes + bytes > LIMITS.maxQueuedBytes;
    if ((overBudget || queuedRecords >= LIMITS.maxQueuedRecords) && !essential) {
      dropped += 1;
      droppedTotal += 1;
      return false;
    }
    queuedRecords += 1;
    const flushed = output.write(text, () => {
      queuedRecords = Math.max(0, queuedRecords - 1);
      if (dropped > 0 && queuedRecords === 0) {
        const count = dropped;
        dropped = 0;
        emit("events.dropped", { count });
      }
    });
    // Node emits "drain" only after a write returned false, so engage only on that path.
    if (overBudget && !flushed) engageBackpressure();
    return true;
  }

  function emit(type, payload = {}) {
    sequence += 1;
    const essential = !COALESCABLE_EVENTS.has(type) || payload.final === true;
    return writeFrame(makeEvent(type, { seq: sequence, ...payload }), { essential });
  }

  function respond(id, data) {
    writeFrame(makeResponse(id, data), { essential: true });
  }

  function respondError(id, code, message) {
    writeFrame(makeErrorResponse(id, code, message), { essential: true });
  }

  const settings = createSettingsStore({ env });
  const state = createStateStore({ env });
  const sequences = createSequenceStore({ env });
  const sessionOptions = {
    nodeExecutable,
    piCliEntry,
    env,
    ...(Number.isFinite(startupReadinessMs) && startupReadinessMs > 0 ? { startupReadinessMs } : {}),
    ...(Number.isFinite(piRequestTimeoutMs) && piRequestTimeoutMs > 0
      ? { requestTimeouts: { ...LIMITS.requestTimeoutMs, prompt: piRequestTimeoutMs, abort: piRequestTimeoutMs, state: piRequestTimeoutMs } }
      : {}),
  };
  const registry = createTabRegistry({
    emit,
    state,
    callerCwd: cwd,
    createSession: ({ cwd: tabCwd, emit: tabEmit }) => createPiSession({ ...sessionOptions, cwd: tabCwd, emit: tabEmit }),
  });

  function allTabs() {
    return registry.list().tabs.map((entry) => registry.get(entry.id)).filter(Boolean);
  }

  function tabFor(request) {
    return registry.require(request.tab);
  }

  function tabSnapshot(tab) {
    return { tab: registry.list().tabs.find((entry) => entry.id === tab.id), session: tab.session.snapshot(), attachments: tab.attachments.list() };
  }

  const handlers = {
    async hello() {
      const active = registry.active();
      if (active) registry.replay(active);
      return {
        protocolVersion: PROTOCOL_VERSION,
        backendPid: process.pid,
        cwd,
        limits: LIMITS,
        smokeMode,
        tabs: registry.list(),
        session: active ? active.session.snapshot() : null,
        attachments: active ? active.attachments.list() : [],
        settings: settings.read().settings,
        recentActions: state.read().value.recentActions,
        stats: { maxWritableLength, droppedTotal, backpressurePauses, queuedRecords },
      };
    },
    async prompt(request) {
      const tab = tabFor(request);
      // Attachments are consumed only once the prompt is known to be acceptable.
      tab.session.assertPromptAllowed(request.mode);
      const taken = request.attachments.length > 0 ? tab.attachments.take(request.attachments) : null;
      return tab.session.prompt({ message: request.message, mode: request.mode, attachments: taken });
    },
    async abort(request) {
      return tabFor(request).session.abort();
    },
    async state(request) {
      return tabFor(request).session.requestState();
    },
    async restart(request) {
      return registry.restart(tabFor(request).id);
    },
    async extension_response(request) {
      return tabFor(request).session.answerDialog(request);
    },
    async settings_get() {
      const result = settings.read();
      for (const problem of result.problems) emit("notice", { level: "warning", message: `Settings: ${problem}` });
      return { settings: result.settings, path: result.path };
    },
    async settings_set(request) {
      const result = settings.write(request.values);
      emit("settings.changed", { settings: result.settings });
      return { settings: result.settings, path: result.path };
    },
    async open_link(request) {
      if (smokeMode) return { delivered: false, suppressed: "smoke-mode", url: request.url };
      const result = await openExternalLink({ url: request.url });
      if (!result.delivered) throw new ProtocolError("rejected", result.reason || "could not open link");
      return result;
    },
    async open_path(request) {
      if (smokeMode) return { delivered: false, suppressed: "smoke-mode", path: request.path };
      const result = await openLocalPath({ path: request.path });
      if (!result.delivered) throw new ProtocolError("rejected", result.reason || "could not open the file");
      return result;
    },
    async session_stats(request) {
      return tabFor(request).session.sessionStats();
    },
    async recent_action(request) {
      return { recentActions: state.pushRecent("recentActions", request.action) };
    },
    async diagnostics() {
      const saved = state.read().value;
      return {
        backendPid: process.pid,
        cwd,
        smokeMode,
        uptimeMs: Math.round(process.uptime() * 1000),
        memoryRssBytes: process.memoryUsage().rss,
        stats: { maxWritableLength, droppedTotal, backpressurePauses, queuedRecords, sequence, inflight: inflight.size },
        tabs: registry.list(),
        recentActions: saved.recentActions,
        paths: { settings: settings.path, state: state.path, sequences: sequences.path },
        limits: LIMITS,
      };
    },
    async notify(request) {
      if (smokeMode) return { delivered: false, suppressed: "smoke-mode" };
      return sendDesktopNotification({ title: request.title, body: request.body });
    },
    async models_list(request) {
      return tabFor(request).session.listModels();
    },
    async model_set(request) {
      return tabFor(request).session.setModel({ provider: request.provider, modelId: request.modelId });
    },
    async model_cycle(request) {
      return tabFor(request).session.cycleModel();
    },
    async thinking_levels(request) {
      return tabFor(request).session.listThinkingLevels();
    },
    async thinking_set(request) {
      return tabFor(request).session.setThinkingLevel({ level: request.level });
    },
    async thinking_cycle(request) {
      return tabFor(request).session.cycleThinkingLevel();
    },
    async compact(request) {
      return tabFor(request).session.compact({ instructions: request.instructions });
    },
    async draft_get(request) {
      return { key: request.key, text: state.getDraft(request.key) };
    },
    async draft_set(request) {
      return { key: request.key, text: state.setDraft(request.key, request.text) };
    },
    async sequences_list() {
      const result = sequences.list();
      for (const problem of result.problems) emit("notice", { level: "warning", message: `Sequences: ${problem}` });
      return { sequences: result.sequences, path: result.path };
    },
    async sequence_save(request) {
      const saved = sequences.save({ id: request.sequenceId, name: request.name, entries: request.entries });
      return { sequence: saved, sequences: sequences.list().sequences };
    },
    async sequence_delete(request) {
      const removed = sequences.remove(request.sequenceId);
      return { removed: removed.id, sequences: sequences.list().sequences };
    },
    async sequence_move(request) {
      return { sequences: sequences.move(request.sequenceId, request.delta) };
    },
    async sequence_run(request) {
      const sequence = sequences.get(request.sequenceId);
      if (!sequence) throw new ProtocolError("stale_request", "That sequence no longer exists");
      return tabFor(request).session.runSequence({ sequenceId: sequence.id, entries: sequence.entries });
    },
    async commands_list(request) {
      return tabFor(request).session.listCommands();
    },
    async attachment_add(request) {
      const tab = tabFor(request);
      return { attachment: tab.attachments.add({ path: request.path, granted: request.granted }), attachments: tab.attachments.list() };
    },
    async attachment_update(request) {
      const tab = tabFor(request);
      return { attachment: tab.attachments.update(request.attachmentId, request.text), attachments: tab.attachments.list() };
    },
    async attachment_remove(request) {
      const tab = tabFor(request);
      tab.attachments.remove(request.attachmentId);
      return { attachments: tab.attachments.list() };
    },
    async path_complete(request) {
      return tabFor(request).workspace.complete(request.query);
    },
    async tabs_list() {
      return registry.list();
    },
    async tab_open(request) {
      const base = request.tab ? registry.require(request.tab) : registry.active();
      const tab = registry.open({ cwd: request.cwd || (base ? base.cwd : cwd), sessionPath: request.sessionPath, name: request.name, select: true });
      registry.select(tab.id);
      if (request.cwd) state.pushRecent("recentDirectories", tab.cwd);
      return tabSnapshot(tab);
    },
    async tab_close(request) {
      const result = await registry.close(tabFor(request).id, { force: request.force });
      const next = registry.active();
      return { ...result, ...(next ? tabSnapshot(next) : {}) };
    },
    async tab_select(request) {
      const tab = registry.select(tabFor(request).id);
      return tabSnapshot(tab);
    },
    async tab_rename(request) {
      const tab = tabFor(request);
      const summary = registry.rename(tab.id, request.name);
      let sessionRenamed = false;
      try {
        await tab.session.setSessionName(request.name);
        sessionRenamed = true;
      } catch (error) {
        emit("notice", { tab: tab.id, level: "warning", message: `The tab was renamed but Pi did not record the session name: ${boundedError(error.message)}` });
      }
      return { tab: summary, sessionRenamed };
    },
    async tab_move(request) {
      return registry.move(tabFor(request).id, request.delta);
    },
    async sessions_list(request) {
      const tab = tabFor(request);
      const result = await listSessions(tab.cwd, { env });
      return { ...result, current: tab.sessionFile, cwd: tab.cwd };
    },
    async session_switch(request) {
      const tab = tabFor(request);
      return tab.session.switchSession(request.sessionPath);
    },
    async session_new(request) {
      return tabFor(request).session.newSession();
    },
    async directory_list(request) {
      const listing = listDirectory(request.path, { showHidden: request.showHidden });
      const saved = state.read().value;
      return { ...listing, recent: saved.recentDirectories, pinned: saved.pinnedDirectories };
    },
    async directory_create(request) {
      return createDirectory(request.path, request.name);
    },
    async directory_pin(request) {
      return { pinned: state.togglePinned(request.path) };
    },
    async worktrees_list(request) {
      const tab = tabFor(request);
      return { worktrees: await listWorktrees(tab.cwd), cwd: tab.cwd };
    },
    async worktree_plan(request) {
      const tab = tabFor(request);
      return planWorktree({ cwd: tab.cwd, branch: request.branch, base: request.base, targetPath: request.path });
    },
    async worktree_create(request) {
      const tab = tabFor(request);
      const worktree = await createWorktree({ cwd: tab.cwd, branch: request.branch, base: request.base, targetPath: request.path });
      let opened = null;
      if (request.openTab) {
        const newTab = registry.open({ cwd: worktree.path, name: worktree.branch, select: true });
        registry.select(newTab.id);
        state.pushRecent("recentDirectories", newTab.cwd);
        opened = tabSnapshot(newTab);
      }
      return { worktree, tab: opened };
    },
    async shutdown() {
      queueMicrotask(() => shutdown(0, "shutdown request"));
      return { closing: true };
    },
    async debug_crash() {
      if (!smokeMode) throw new ProtocolError("unknown_request", "debug_crash is only available in smoke mode");
      setImmediate(() => {
        throw new Error("deterministic backend crash for smoke testing");
      });
      return { crashing: true };
    },
  };

  function handleRequest(frame) {
    let request;
    try {
      request = validateRequest(frame);
    } catch (error) {
      const id = frame && typeof frame.id === "string" ? frame.id.slice(0, LIMITS.maxRequestIdCharacters) : "";
      if (id) respondError(id, error.code ?? "invalid_request", error.message);
      else emit("notice", { level: "error", message: `Rejected request: ${boundedError(error.message)}` });
      return;
    }
    if (inflight.has(request.id)) {
      respondError(request.id, "duplicate_request", `request id ${request.id} is already in flight`);
      return;
    }
    if (inflight.size >= LIMITS.maxPendingRequests) {
      respondError(request.id, "busy", "too many requests are in flight");
      return;
    }
    const timeoutMs = LIMITS.requestTimeoutMs[request.type];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      inflight.delete(request.id);
      respondError(request.id, "timeout", `${request.type} did not complete within ${timeoutMs} ms`);
    }, timeoutMs);
    inflight.set(request.id, { type: request.type, timer });
    Promise.resolve()
      .then(() => handlers[request.type](request))
      .then((data) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        inflight.delete(request.id);
        respond(request.id, data ?? null);
      }, (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        inflight.delete(request.id);
        respondError(request.id, error instanceof ProtocolError ? error.code : "internal_error", error?.message ?? String(error));
      });
  }

  function killAllNow() {
    for (const child of registry.children()) killProcessTreeNow(child);
  }

  function shutdown(code, reason) {
    if (shutdownPromise) return shutdownPromise;
    closing = true;
    emit("backend.closing", { reason });
    const forced = setTimeout(() => {
      killAllNow();
      exit(code);
    }, LIMITS.shutdownGraceMs + 1_000);
    shutdownPromise = registry.stopAll().then(() => {
      clearTimeout(forced);
      for (const entry of inflight.values()) clearTimeout(entry.timer);
      inflight.clear();
      exit(code);
    });
    return shutdownPromise;
  }

  function fatal(error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    try {
      emit("backend.fatal", { message: boundedError(message) });
    } catch {
      // Output may already be closed.
    }
    killAllNow();
    if (onFatal) onFatal(error);
    exit(70);
  }

  function run() {
    if (!piCliEntry || !path.isAbsolute(piCliEntry)) {
      emit("backend.fatal", { message: "QT_WEBUI_PI_CLI_ENTRY must be an absolute path" });
      exit(64);
      return;
    }
    process.on("uncaughtException", fatal);
    process.on("unhandledRejection", fatal);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(signal, () => shutdown(signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 129, signal));
    }
    output.on("error", (error) => {
      if (error && (error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED")) shutdown(0, "stdout closed");
      else fatal(error);
    });
    input.setEncoding("utf8");
    attachJsonlReader(input, {
      maxFrameBytes: LIMITS.maxInboundFrameBytes,
      onRecord: (record) => {
        if (!closing) handleRequest(record);
      },
      onInvalid: (error) => emit("notice", { level: "error", message: `Rejected malformed request: ${boundedError(error.message)}` }),
      onOversized: (bytes) => emit("notice", { level: "error", message: `Rejected a request larger than ${LIMITS.maxInboundFrameBytes} bytes (${bytes} bytes)` }),
    });
    input.on("end", () => shutdown(0, "stdin closed"));
    input.on("error", () => shutdown(0, "stdin error"));
    emit("backend.ready", { protocolVersion: PROTOCOL_VERSION, backendPid: process.pid, limits: LIMITS, cwd, smokeMode });
    // Restored tabs start their Pi children now; their events carry tab ids from the first frame.
    try {
      registry.restore();
    } catch (error) {
      fatal(error);
    }
  }

  return { run, shutdown, emit, registry, get session() { return registry.active()?.session ?? null; } };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) createBackend().run();
