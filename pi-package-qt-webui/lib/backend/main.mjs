#!/usr/bin/env node
import path from "node:path";
import { openExternalLink, sendDesktopNotification } from "./desktop.mjs";
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
import { createSettingsStore } from "./settings.mjs";

// Backend entry point. Quickshell starts this process, writes protocol requests to its stdin,
// and reads responses and events from its stdout. The backend owns the Pi child and every
// helper it starts; closing stdin, SIGINT, SIGTERM, SIGHUP, or a fatal error all lead to the
// same bounded shutdown that terminates and reaps the whole process tree.

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
  // while the outbound queue is over budget; essential records are always written, and the
  // Pi child's stdout is paused until the queue drains so memory stays bounded.
  function engageBackpressure() {
    if (backpressured) return;
    backpressured = true;
    backpressurePauses += 1;
    session.pauseInput();
    emit("backend.backpressure", { paused: true, queuedBytes: output.writableLength });
    output.once("drain", () => {
      backpressured = false;
      session.resumeInput();
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
  const session = createPiSession({
    nodeExecutable,
    piCliEntry,
    cwd,
    env,
    emit,
    ...(Number.isFinite(startupReadinessMs) && startupReadinessMs > 0 ? { startupReadinessMs } : {}),
    ...(Number.isFinite(piRequestTimeoutMs) && piRequestTimeoutMs > 0
      ? { requestTimeouts: { ...LIMITS.requestTimeoutMs, prompt: piRequestTimeoutMs, abort: piRequestTimeoutMs, state: piRequestTimeoutMs } }
      : {}),
  });

  const handlers = {
    async hello() {
      return {
        protocolVersion: PROTOCOL_VERSION,
        backendPid: process.pid,
        cwd,
        limits: LIMITS,
        smokeMode,
        session: session.snapshot(),
        settings: settings.read().settings,
        stats: { maxWritableLength, droppedTotal, backpressurePauses, queuedRecords },
      };
    },
    async prompt(request) {
      return session.prompt({ message: request.message, mode: request.mode });
    },
    async abort() {
      return session.abort();
    },
    async state() {
      return session.requestState();
    },
    async restart() {
      return session.restart();
    },
    async extension_response(request) {
      return session.answerDialog(request);
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
    async notify(request) {
      if (smokeMode) return { delivered: false, suppressed: "smoke-mode" };
      return sendDesktopNotification({ title: request.title, body: request.body });
    },
    async models_list() {
      return session.listModels();
    },
    async model_set(request) {
      return session.setModel({ provider: request.provider, modelId: request.modelId });
    },
    async model_cycle() {
      return session.cycleModel();
    },
    async thinking_levels() {
      return session.listThinkingLevels();
    },
    async thinking_set(request) {
      return session.setThinkingLevel({ level: request.level });
    },
    async thinking_cycle() {
      return session.cycleThinkingLevel();
    },
    async compact(request) {
      return session.compact({ instructions: request.instructions });
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

  function shutdown(code, reason) {
    if (shutdownPromise) return shutdownPromise;
    closing = true;
    emit("backend.closing", { reason });
    const forced = setTimeout(() => {
      killProcessTreeNow(session.child);
      exit(code);
    }, LIMITS.shutdownGraceMs + 1_000);
    shutdownPromise = session.stop().then(() => {
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
    killProcessTreeNow(session.child);
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
    session.start();
  }

  return { run, shutdown, emit, session };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) createBackend().run();
