import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { terminateProcessTree } from "./process-tree.mjs";
import { AGENT_RUN_PROVIDER_EVENT, normalizeAgentInstance } from "./agent-run-protocol.mjs";
import { AgentRunRegistry, createAgentRunRecordId } from "./agent-run-registry.mjs";

const STRUCTURED_LAUNCHERS = new Set(["pi-rpc", "pi-json"]);
const SUBPROCESS_LAUNCHERS = new Set(["pi-rpc", "pi-json", "pi-print"]);
const DEFAULT_OUTPUT_BYTES = 256 * 1024;

function text(value, maximum = 240) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maximum) : undefined;
}

function modelName(model) {
  if (!model || typeof model !== "object") return undefined;
  const provider = text(model.provider, 100);
  const id = text(model.id || model.modelId, 140);
  return provider && id ? `${provider}/${id}` : id;
}

function usageFrom(value) {
  if (!value || typeof value !== "object") return undefined;
  const usage = value.usage && typeof value.usage === "object" ? value.usage : value;
  const normalized = {};
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) {
    if (Number.isFinite(usage[key]) && usage[key] >= 0) normalized[key] = Math.floor(usage[key]);
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

function boundedTail(previous, chunk, maximum) {
  const combined = Buffer.concat([Buffer.from(previous), Buffer.from(chunk)]);
  return combined.subarray(Math.max(0, combined.length - maximum));
}

function sessionActivity(event) {
  switch (event?.type) {
    case "tool_execution_start": return { activityState: "tool", currentTool: text(event.toolName, 120) };
    case "tool_execution_update": return { activityState: "tool", currentTool: text(event.toolName, 120) };
    case "tool_execution_end": return { activityState: "thinking", currentTool: undefined };
    case "message_start":
    case "message_update": return { activityState: "responding", currentTool: undefined };
    case "agent_start":
    case "turn_start": return { activityState: "thinking", currentTool: undefined };
    case "agent_settled": return { activityState: "idle", currentTool: undefined };
    default: return {};
  }
}

function sdkAgentEndStatus(event) {
  if (event?.type !== "agent_end" || event.willRetry === true || !Array.isArray(event.messages)) return undefined;
  const assistant = [...event.messages].reverse().find((message) => message?.role === "assistant");
  if (assistant?.stopReason === "aborted") return "cancelled";
  if (assistant?.stopReason === "error") return "failed";
  return undefined;
}

function normalizedSdkEvent(event, now) {
  const type = text(event?.type, 80) || "event";
  const output = { type, at: now };
  if (type.startsWith("tool_execution_")) output.tool = text(event.toolName, 120);
  if (type === "tool_execution_end") output.isError = event.isError === true;
  const usage = usageFrom(event?.message || event?.result || event);
  if (usage) output.usage = usage;
  return output;
}

function sdkRecord(session, state, options, now) {
  return normalizeAgentInstance({
    version: 1,
    instanceId: options.instanceId,
    runId: options.runId,
    parentInstanceId: options.parentInstanceId || null,
    parentSessionId: options.parentSessionId || null,
    launcher: options.launcher || "sdk",
    provider: "webui-registry",
    origin: options.origin || "createAgentSession",
    name: options.name || session.sessionName,
    status: state.status,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    endedAt: state.endedAt,
    model: modelName(session.model) || options.model,
    thinking: text(session.thinkingLevel || options.thinking, 40),
    activityState: state.activityState,
    currentTool: state.currentTool,
    capabilities: { open: true, refresh: true, cancel: false, steer: false },
    outputRef: { kind: "registry-artifact", id: options.recordId },
  });
}

/** Track a caller-owned AgentSession. Disposing tracking never disposes the session itself. */
export function trackPiAgentSession(options = {}) {
  const { session, registry } = options;
  if (!session || typeof session.subscribe !== "function") throw new TypeError("session.subscribe is required");
  if (!registry || typeof registry.writeRecord !== "function" || typeof registry.appendArtifactEvent !== "function") throw new TypeError("registry is required");
  const producerId = text(options.producerId, 80) || "sdk";
  const recordId = options.recordId || createAgentRunRecordId();
  const now = typeof options.now === "function" ? options.now : Date.now;
  const startedAt = now();
  const ids = {
    instanceId: options.instanceId || `${text(session.sessionId, 100) || "sdk"}:${randomUUID()}`,
    runId: options.runId || randomUUID(),
    recordId,
  };
  const settings = { ...options, ...ids };
  const state = { status: session.isStreaming ? "running" : "queued", startedAt, updatedAt: startedAt, endedAt: null, activityState: session.isStreaming ? "thinking" : "idle", currentTool: undefined };
  let closed = false;
  let observationError;
  let queue = Promise.resolve();
  const write = (event, { artifact = true } = {}) => {
    const record = sdkRecord(session, { ...state }, settings, now);
    const artifactEvent = event && artifact ? normalizedSdkEvent(event, state.updatedAt) : null;
    queue = queue.then(async () => {
      await registry.writeRecord(producerId, record, { recordId });
      if (artifactEvent) await registry.appendArtifactEvent(producerId, recordId, artifactEvent);
    }).catch((error) => {
      observationError ||= text(error?.message || String(error), 240) || "Registry observation failed";
    });
    return queue;
  };
  const unsubscribe = session.subscribe((event) => {
    if (closed) return;
    state.updatedAt = now();
    Object.assign(state, sessionActivity(event));
    if (event.type === "agent_start") { state.status = "running"; state.endedAt = null; }
    const agentEndStatus = sdkAgentEndStatus(event);
    if (agentEndStatus) { state.status = agentEndStatus; state.endedAt = state.updatedAt; }
    if (event.type === "agent_settled") {
      if (!["failed", "cancelled"].includes(state.status)) state.status = "done";
      state.endedAt = state.updatedAt;
    }
    void write(event);
  });
  const heartbeatMs = Math.max(1_000, Number(options.heartbeatMs) || 10_000);
  const heartbeat = setInterval(() => {
    if (closed || state.status !== "running") return;
    state.updatedAt = now();
    void write(null, { artifact: false });
  }, heartbeatMs);
  heartbeat.unref?.();
  const ready = write({ type: "tracking_started" });

  return Object.freeze({
    instanceId: ids.instanceId,
    runId: ids.runId,
    recordId,
    ready,
    flush: () => queue,
    get observationError() { return observationError; },
    async dispose({ status } = {}) {
      if (closed) return queue;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      if (status) {
        if (!["done", "failed", "cancelled"].includes(status)) throw new TypeError("dispose status must be done, failed, or cancelled");
        state.status = status;
        state.updatedAt = now();
        state.endedAt = state.updatedAt;
        await write({ type: "tracking_disposed", status });
      }
      return queue;
    },
  });
}

function structuredEvent(lineValue, launcher, now) {
  const value = lineValue && typeof lineValue === "object" ? lineValue : {};
  const event = value.type === "event" && value.event && typeof value.event === "object" ? value.event : value;
  const type = value.type === "response" ? "rpc_response" : text(event.type, 80) || "event";
  const output = { type, at: now };
  if (type.startsWith("tool_execution_")) output.tool = text(event.toolName, 120);
  if (type === "tool_execution_end") output.isError = event.isError === true;
  const usage = usageFrom(event.message || event.result || event);
  if (usage) output.usage = usage;
  if (launcher === "pi-rpc" && value.type === "response") output.status = value.success === false ? "failed" : "ok";
  return output;
}

function processRecord(state, options) {
  return normalizeAgentInstance({
    version: 1,
    instanceId: options.instanceId,
    runId: options.runId,
    parentInstanceId: options.parentInstanceId || null,
    parentSessionId: options.parentSessionId || null,
    launcher: options.launcher,
    provider: "webui-registry",
    origin: options.origin || "pi-subprocess",
    name: options.name,
    status: state.status,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    endedAt: state.endedAt,
    model: options.model,
    thinking: options.thinking,
    activityState: state.activityState,
    currentTool: state.currentTool,
    capabilities: { open: true, refresh: true, cancel: false, steer: false },
    outputRef: { kind: options.launcher === "pi-rpc" ? "rpc-events" : options.launcher === "pi-json" ? "json-events" : "plain-log", id: options.recordId },
  });
}

/** Spawn and observe a declared Pi argv. The adapter owns only the returned child process. */
export function startObservedPiProcess(options = {}) {
  if (!SUBPROCESS_LAUNCHERS.has(options.launcher)) throw new TypeError("launcher must be pi-rpc, pi-json, or pi-print");
  if (typeof options.command !== "string" || !options.command) throw new TypeError("command is required");
  if (!Array.isArray(options.argv) || options.argv.some((arg) => typeof arg !== "string")) throw new TypeError("argv must be a string array");
  const registry = options.registry;
  if (!registry || typeof registry.writeRecord !== "function") throw new TypeError("registry is required");
  const spawnImpl = options.spawnImpl || spawn;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const outputBytes = Math.max(1_024, Math.min(Number(options.outputBytes) || DEFAULT_OUTPUT_BYTES, 4 * 1024 * 1024));
  const producerId = text(options.producerId, 80) || "pi-process";
  const recordId = options.recordId || createAgentRunRecordId();
  const normalized = {
    ...options,
    instanceId: options.instanceId || randomUUID(),
    runId: options.runId || randomUUID(),
    recordId,
    model: text(options.model, 240),
    thinking: text(options.thinking, 40),
  };
  const state = { status: "running", startedAt: now(), updatedAt: now(), endedAt: null, activityState: "starting", currentTool: undefined };
  let stdoutTail = Buffer.alloc(0);
  let stderrTail = Buffer.alloc(0);
  let framing = "";
  let cancelled = false;
  let observationError;
  let queue = Promise.resolve();
  const enqueue = (operation) => {
    queue = queue.then(operation).catch((error) => { observationError ||= text(error?.message || String(error), 240) || "Registry observation failed"; });
    return queue;
  };
  const append = (event) => enqueue(() => registry.appendArtifactEvent(producerId, recordId, event));
  const writeRecord = () => enqueue(() => registry.writeRecord(producerId, processRecord(state, normalized), { recordId }));
  const child = spawnImpl(options.command, [...options.argv], {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    stdio: [options.stdin || "ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
  });

  const processStructuredChunk = (chunk) => {
    framing += String(chunk);
    const lines = framing.split("\n");
    framing = lines.pop() || "";
    for (let line of lines) {
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line) continue;
      if (Buffer.byteLength(line) > 64 * 1024) { void append({ type: "invalid_frame", at: now(), status: "oversized" }); continue; }
      try {
        const event = structuredEvent(JSON.parse(line), options.launcher, now());
        if (event.tool) { state.activityState = "tool"; state.currentTool = event.tool; }
        else if (event.type === "message_update") { state.activityState = "responding"; state.currentTool = undefined; }
        state.updatedAt = event.at;
        void append(event);
      } catch { void append({ type: "invalid_frame", at: now(), status: "malformed" }); }
    }
  };

  child.stdout?.on("data", (chunk) => {
    state.updatedAt = now();
    options.stdoutSink?.write?.(chunk);
    if (STRUCTURED_LAUNCHERS.has(options.launcher)) processStructuredChunk(chunk);
    else {
      stdoutTail = boundedTail(stdoutTail, chunk, outputBytes);
      void append({ type: "output", stream: "stdout", at: state.updatedAt, message: String(chunk).slice(-8_192) });
    }
  });
  child.stderr?.on("data", (chunk) => {
    state.updatedAt = now();
    options.stderrSink?.write?.(chunk);
    stderrTail = boundedTail(stderrTail, chunk, outputBytes);
    void append({ type: "output", stream: "stderr", at: state.updatedAt, message: String(chunk).slice(-8_192) });
  });

  const ready = writeRecord().then(() => append({ type: "process_started", at: state.startedAt }));
  const heartbeatMs = Math.max(1_000, Number(options.heartbeatMs) || 10_000);
  const heartbeat = setInterval(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    state.updatedAt = now();
    void writeRecord();
  }, heartbeatMs);
  heartbeat.unref?.();
  const completion = new Promise((resolve) => {
    let settled = false;
    const finish = async (status, detail = {}) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      state.status = status;
      state.updatedAt = now();
      state.endedAt = state.updatedAt;
      state.activityState = "idle";
      state.currentTool = undefined;
      if (framing && STRUCTURED_LAUNCHERS.has(options.launcher)) await append({ type: "invalid_frame", at: state.updatedAt, status: "unterminated" });
      await append({ type: "process_exit", at: state.updatedAt, status, ...detail });
      await writeRecord();
      await queue;
      resolve(Object.freeze({ status, ...detail, observationError, stdout: stdoutTail.toString("utf8"), stderr: stderrTail.toString("utf8") }));
    };
    child.once("error", (error) => { void finish(cancelled ? "cancelled" : "failed", { error: text(error?.message || String(error), 240) }); });
    child.once("close", (code, signal) => { void finish(cancelled ? "cancelled" : code === 0 ? "done" : "failed", { code, signal: text(signal, 32) }); });
  });

  const cancel = (signal = "SIGTERM") => {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    cancelled = true;
    return terminateProcessTree(child, signal);
  };
  const abortHandler = () => cancel("SIGTERM");
  if (options.signal) {
    if (options.signal.aborted) abortHandler();
    else options.signal.addEventListener("abort", abortHandler, { once: true });
    completion.finally(() => options.signal.removeEventListener("abort", abortHandler));
  }
  return Object.freeze({ child, ready, completion, cancel, instanceId: normalized.instanceId, runId: normalized.runId, recordId });
}

/** Track an SDK session inside an extension and emit canonical complete snapshots on Pi's process-local event bus. */
export function trackPiAgentSessionEventBus(options = {}) {
  const { session } = options;
  const emit = options.emit || options.events?.emit?.bind(options.events);
  if (!session || typeof session.subscribe !== "function") throw new TypeError("session.subscribe is required");
  if (typeof emit !== "function") throw new TypeError("emit or events.emit is required");
  const now = typeof options.now === "function" ? options.now : Date.now;
  const producerId = text(options.producerId, 80) || "sdk";
  const ids = {
    instanceId: options.instanceId || `${text(session.sessionId, 100) || "sdk"}:${randomUUID()}`,
    runId: options.runId || randomUUID(),
    recordId: options.recordId || createAgentRunRecordId(),
  };
  const settings = { ...options, ...ids };
  const startedAt = now();
  const state = { status: session.isStreaming ? "running" : "queued", startedAt, updatedAt: startedAt, endedAt: null, activityState: session.isStreaming ? "thinking" : "idle", currentTool: undefined };
  let closed = false;
  let observationError;
  const publish = () => {
    try {
      const instance = sdkRecord(session, { ...state }, settings, now);
      emit(AGENT_RUN_PROVIDER_EVENT, { version: 1, producerId, complete: true, instances: [instance], removals: [] });
    } catch (error) {
      observationError ||= text(error?.message || String(error), 240) || "Event-bus observation failed";
    }
  };
  const unsubscribe = session.subscribe((event) => {
    if (closed) return;
    state.updatedAt = now();
    Object.assign(state, sessionActivity(event));
    if (event.type === "agent_start") { state.status = "running"; state.endedAt = null; }
    const endStatus = sdkAgentEndStatus(event);
    if (endStatus) { state.status = endStatus; state.endedAt = state.updatedAt; }
    if (event.type === "agent_settled") { if (!["failed", "cancelled"].includes(state.status)) state.status = "done"; state.endedAt = state.updatedAt; }
    publish();
  });
  const heartbeat = setInterval(() => { if (!closed && state.status === "running") { state.updatedAt = now(); publish(); } }, Math.max(1_000, Number(options.heartbeatMs) || 10_000));
  heartbeat.unref?.();
  publish();
  return Object.freeze({
    instanceId: ids.instanceId, runId: ids.runId,
    get observationError() { return observationError; },
    dispose({ status } = {}) {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      if (status) {
        if (!["done", "failed", "cancelled"].includes(status)) throw new TypeError("dispose status must be done, failed, or cancelled");
        state.status = status; state.updatedAt = now(); state.endedAt = state.updatedAt; publish();
      }
    },
  });
}

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function canonicalFileWithin(file, roots) {
  const info = await lstat(file).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) return null;
  const target = await realpath(file).catch(() => null);
  if (!target) return null;
  for (const root of roots) {
    const canonicalRoot = await realpath(root).catch(() => null);
    if (canonicalRoot && inside(canonicalRoot, target) && target !== canonicalRoot) return target;
  }
  return null;
}

/** Resolve an explicit session ID or file strictly through configured Pi session roots. */
export async function resolveAttachSession(options = {}) {
  const selector = text(options.session, 4_096);
  if (!selector) throw new TypeError("session is required");
  const sessionRoots = (options.sessionRoots || []).map((root) => path.resolve(root));
  if (!sessionRoots.length) throw new TypeError("at least one configured session root is required");
  const managerType = options.SessionManagerImpl || SessionManager;
  let candidate = null;
  if (path.isAbsolute(selector) || selector.includes("/") || selector.includes("\\")) {
    candidate = path.resolve(selector);
  } else {
    const sessions = await managerType.listAll(options.sessionDir);
    const matches = sessions.filter((item) => item?.id === selector);
    if (matches.length !== 1) throw Object.assign(new Error(matches.length ? "Session ID is ambiguous" : "Session ID was not found"), { code: matches.length ? "ATTACH_SESSION_AMBIGUOUS" : "ATTACH_SESSION_NOT_FOUND" });
    candidate = matches[0].path;
  }
  const canonical = await canonicalFileWithin(candidate, sessionRoots);
  if (!canonical) throw Object.assign(new Error("Session must be a regular file inside a configured Pi session root"), { code: "ATTACH_SESSION_OUTSIDE_ROOT" });
  const manager = managerType.open(canonical, options.sessionDir);
  return Object.freeze({
    sessionFile: canonical,
    sessionId: manager.getSessionId(),
    name: manager.getSessionName?.(),
    model: manager.buildSessionContext?.().model || null,
    thinking: manager.buildSessionContext?.().thinkingLevel,
  });
}

function parseCli(args) {
  const command = args[0];
  const options = {};
  const rest = [];
  let afterSeparator = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (afterSeparator) { rest.push(arg); continue; }
    if (arg === "--") { afterSeparator = true; continue; }
    if (["--launcher", "--name", "--parent-session", "--session", "--session-dir", "--port", "--producer"].includes(arg)) {
      if (!args[index + 1]) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = args[++index];
      continue;
    }
    throw new Error(`Unknown agent option: ${arg}`);
  }
  return { command, options, rest };
}

export async function runAgentCli(args, context = {}) {
  const output = context.output || process.stdout;
  const errorOutput = context.errorOutput || process.stderr;
  if (!args.length || ["help", "--help", "-h"].includes(args[0])) {
    output.write("Usage:\n  pi-webui agent run --launcher <rpc|json|print> [options] -- <command> [args...]\n  pi-webui agent attach --session <id-or-file> [options]\n");
    return 0;
  }
  const parsed = parseCli(args);
  const agentDir = context.agentDir || process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent");
  const port = Number(parsed.options.port || process.env.PI_WEBUI_PORT || 31415);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port/PI_WEBUI_PORT must be an integer between 1 and 65535");
  const registry = context.registry || new AgentRunRegistry({ agentDir, port });
  await registry.init();
  const scopeId = registry.paths?.scopeId || "custom-registry";
  output.write(`WebUI registration: port=${port} scope=${scopeId}\n`);
  if (parsed.command === "run") {
    const launcher = { rpc: "pi-rpc", json: "pi-json", print: "pi-print" }[parsed.options.launcher] || parsed.options.launcher;
    if (!SUBPROCESS_LAUNCHERS.has(launcher)) throw new Error("--launcher must be rpc, json, or print");
    if (!parsed.rest.length) throw new Error("A command is required after --");
    const observed = startObservedPiProcess({
      registry, launcher, producerId: parsed.options.producer || "pi-webui-cli", command: parsed.rest[0], argv: parsed.rest.slice(1),
      name: parsed.options.name, parentSessionId: parsed.options["parent-session"], cwd: context.cwd || process.cwd(), env: context.env || process.env,
      stdin: "inherit", stdoutSink: output, stderrSink: errorOutput,
    });
    const result = await observed.completion;
    if (result.observationError) return 1;
    return result.status === "done" ? 0 : result.status === "cancelled" ? 130 : 1;
  }
  if (parsed.command === "attach") {
    if (parsed.rest.length) throw new Error("attach does not accept a command after --");
    const sessionDir = parsed.options["session-dir"] ? path.resolve(parsed.options["session-dir"]) : undefined;
    const sessionRoots = sessionDir ? [sessionDir] : [path.join(agentDir, "sessions")];
    const attached = await resolveAttachSession({ session: parsed.options.session, sessionDir, sessionRoots, SessionManagerImpl: context.SessionManagerImpl });
    const now = Date.now();
    const recordId = createAgentRunRecordId();
    const model = attached.model?.provider && attached.model?.modelId ? `${attached.model.provider}/${attached.model.modelId}` : undefined;
    const record = normalizeAgentInstance({
      version: 1, instanceId: `${attached.sessionId}:${randomUUID()}`, runId: randomUUID(), parentInstanceId: null,
      parentSessionId: parsed.options["parent-session"] || null, launcher: "interactive", provider: "webui-registry", origin: "explicit-attach",
      name: parsed.options.name || attached.name, status: "stale", startedAt: now, updatedAt: now, endedAt: null,
      model, thinking: attached.thinking, activityState: "idle", capabilities: { open: true, refresh: true, cancel: false, steer: false },
      outputRef: { kind: "session-jsonl", id: recordId },
    });
    await registry.writeRecord(parsed.options.producer || "pi-webui-attach", record, { recordId });
    await registry.writeSessionLocator(parsed.options.producer || "pi-webui-attach", recordId, attached.sessionFile, { allowedRoots: sessionRoots });
    output.write(`${record.instanceId}\n`);
    return 0;
  }
  errorOutput.write(`Unknown pi-webui agent command: ${parsed.command || ""}\n`);
  return 2;
}
