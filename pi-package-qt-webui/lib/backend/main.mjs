#!/usr/bin/env node
import path from "node:path";
import { createPortalAppearanceMonitor } from "./appearance.mjs";
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
import { createResourceStore, resolveEffective, updateProfile, validateProfile } from "./resources.mjs";
import { SAMPLING_KEYS, supportedSamplingValues } from "./sampling.mjs";
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
  const helperTimeoutMs = smokeMode ? Number.parseInt(env.QT_WEBUI_HELPER_TIMEOUT_MS ?? "", 10) : Number.NaN;

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

  const appearance = createPortalAppearanceMonitor({
    env,
    onChange: (portalColorScheme) => emit("appearance.changed", { portalColorScheme }),
  });
  const settings = createSettingsStore({ env });
  const state = createStateStore({ env });
  const sequences = createSequenceStore({ env });
  const resources = createResourceStore({ env });
  const sessionOptions = {
    nodeExecutable,
    piCliEntry,
    env,
    ...(Number.isFinite(startupReadinessMs) && startupReadinessMs > 0 ? { startupReadinessMs } : {}),
    ...(Number.isFinite(piRequestTimeoutMs) && piRequestTimeoutMs > 0
      ? { requestTimeouts: { ...LIMITS.requestTimeoutMs, prompt: piRequestTimeoutMs, abort: piRequestTimeoutMs, state: piRequestTimeoutMs } }
      : {}),
    ...(Number.isFinite(helperTimeoutMs) && helperTimeoutMs > 0 ? { helperTimeoutMs } : {}),
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

  function normalizedNames(value, known, field) {
    if (value === null) return null;
    if (!Array.isArray(value)) throw new ProtocolError("unavailable", `The helper did not report a valid ${field} session override`);
    const result = [];
    for (const entry of value) {
      if (typeof entry !== "string" || !known.has(entry) || result.includes(entry)) throw new ProtocolError("unavailable", `The helper reported an invalid ${field} name`);
      result.push(entry);
      if (result.length > LIMITS.maxResourceNames) throw new ProtocolError("unavailable", `The helper reported too many ${field} names`);
    }
    return result;
  }

  function normalizeHelperState(tab, raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProtocolError("unavailable", "The helper did not report resource capability state");
    const runtime = tab.session.snapshot().runtime;
    const model = raw.model && typeof raw.model === "object" ? raw.model : null;
    if (!model || model.provider !== runtime.provider || model.id !== runtime.modelId || typeof model.api !== "string") {
      throw new ProtocolError("unavailable", "The helper resource capability state is stale for the active model");
    }
    const toolRows = raw.tools && Array.isArray(raw.tools.all) ? raw.tools.all : null;
    const skillRows = raw.skills && Array.isArray(raw.skills.all) ? raw.skills.all : null;
    if (!toolRows || !skillRows || toolRows.length > LIMITS.maxResourceNames || skillRows.length > LIMITS.maxResourceNames) {
      throw new ProtocolError("unavailable", "The helper did not report bounded tool and skill inventories");
    }
    const tools = toolRows.filter((entry) => entry && typeof entry.name === "string" && entry.name.length > 0 && entry.name.length <= 128)
      .map((entry) => ({ name: entry.name, description: String(entry.description || "").slice(0, 256), source: String(entry.source || "").slice(0, 128) }));
    const skills = skillRows.filter((entry) => entry && typeof entry.name === "string" && entry.name.length > 0 && entry.name.length <= 128)
      .map((entry) => ({ name: entry.name, description: String(entry.description || "").slice(0, 256), filePath: typeof entry.filePath === "string" && entry.filePath.length <= LIMITS.maxPathCharacters ? entry.filePath : "", disableModelInvocation: entry.disableModelInvocation === true }));
    if (new Set(tools.map((entry) => entry.name)).size !== tools.length || new Set(skills.map((entry) => entry.name)).size !== skills.length) {
      throw new ProtocolError("unavailable", "The helper reported duplicate resource names");
    }
    const capabilities = raw.sampling && raw.sampling.capabilities && typeof raw.sampling.capabilities === "object" ? raw.sampling.capabilities : null;
    if (!capabilities || SAMPLING_KEYS.some((key) => !capabilities[key] || typeof capabilities[key].supported !== "boolean" || typeof capabilities[key].reason !== "string")) {
      throw new ProtocolError("unavailable", "The helper did not report complete sampling capabilities");
    }
    const toolNames = new Set(tools.map((entry) => entry.name));
    const skillNames = new Set(skills.map((entry) => entry.name));
    const activeTools = normalizedNames(raw.tools.active, toolNames, "active tool");
    const enabledSkills = normalizedNames(raw.skills.enabled, skillNames, "enabled skill");
    if (!Array.isArray(activeTools) || !Array.isArray(enabledSkills) || !raw.sampling.applied || typeof raw.sampling.applied !== "object" || Array.isArray(raw.sampling.applied)) {
      throw new ProtocolError("unavailable", "The helper did not report validated applied resource values");
    }
    const appliedSampling = validateProfile({ sampling: raw.sampling.applied }).sampling;
    const sessionRaw = raw.session && typeof raw.session === "object" ? raw.session : {};
    const sessionProfile = validateProfile({
      tools: normalizedNames(sessionRaw.tools ?? null, toolNames, "tool"),
      skills: normalizedNames(sessionRaw.skills ?? null, skillNames, "skill"),
      sampling: sessionRaw.sampling,
    });
    const durabilityRaw = sessionRaw.durability;
    if (!durabilityRaw || typeof durabilityRaw !== "object" || typeof durabilityRaw.durable !== "boolean" || typeof durabilityRaw.reason !== "string") {
      throw new ProtocolError("unavailable", "The helper did not report session profile durability");
    }
    const durability = { durable: durabilityRaw.durable, reason: boundedError(durabilityRaw.reason) };
    return {
      model: { provider: model.provider, id: model.id, api: model.api },
      thinkingLevel: typeof raw.thinkingLevel === "string" ? raw.thinkingLevel : "",
      sessionProfile,
      durability,
      tools,
      skills,
      toolNames,
      skillNames,
      activeTools,
      enabledSkills,
      appliedSampling,
      sampling: { api: model.api, capabilities, thinkingActive: raw.sampling.thinkingActive === true },
    };
  }

  function resourceContextFrom(tab, helper, stored) {
    const modelProfile = stored.value.models[`${helper.model.provider}/${helper.model.id}`] ?? validateProfile(null);
    const effective = resolveEffective({ session: helper.sessionProfile, model: modelProfile, global: stored.value.global });
    return { tab, helper, stored, modelProfile, effective };
  }

  async function resourceContext(tab) {
    const helper = normalizeHelperState(tab, await tab.session.helperState());
    return resourceContextFrom(tab, helper, resources.read());
  }

  function helperEffective(context) {
    return {
      tools: context.effective.tools,
      skills: context.effective.skills,
      sampling: supportedSamplingValues(context.effective.sampling, context.helper.sampling.capabilities),
    };
  }

  function validateAppliedHelper(context, helper) {
    const expected = helperEffective(context);
    if (expected.tools !== null && JSON.stringify(helper.activeTools) !== JSON.stringify(expected.tools)) {
      throw new ProtocolError("unavailable", "The helper did not apply the requested enabled tools exactly");
    }
    if (expected.skills !== null && JSON.stringify(helper.enabledSkills) !== JSON.stringify(expected.skills)) {
      throw new ProtocolError("unavailable", "The helper did not apply the requested enabled skills exactly");
    }
    if (JSON.stringify(helper.appliedSampling) !== JSON.stringify(expected.sampling)) {
      throw new ProtocolError("unavailable", "The helper did not apply the requested sampling values exactly");
    }
    if (JSON.stringify(helper.sessionProfile) !== JSON.stringify(context.helper.sessionProfile)) {
      throw new ProtocolError("unavailable", "The helper did not retain the requested session resource profile exactly");
    }
    return helper;
  }

  function resourceResult(context) {
    return {
      available: true,
      model: context.helper.model,
      thinkingLevel: context.helper.thinkingLevel,
      profiles: { session: context.helper.sessionProfile, model: context.modelProfile, global: context.stored.value.global },
      sessionDurability: context.helper.durability,
      effective: context.effective,
      tools: { all: context.helper.tools },
      skills: { all: context.helper.skills },
      sampling: { ...context.helper.sampling, applied: context.helper.appliedSampling },
      problems: context.stored.problems,
      path: context.stored.path,
    };
  }

  async function readResources(tab, { apply = true } = {}) {
    const context = await resourceContext(tab);
    if (!apply) return resourceResult(context);
    const applied = normalizeHelperState(tab, await tab.session.helperApply({ effective: helperEffective(context) }));
    validateAppliedHelper(context, applied);
    return resourceResult(resourceContextFrom(tab, applied, context.stored));
  }

  async function safeReadResources(tab) {
    try {
      return await readResources(tab);
    } catch (error) {
      return { available: false, error: { code: error instanceof ProtocolError ? error.code : "unavailable", message: boundedError(error?.message ?? String(error)) } };
    }
  }

  const exclusiveTabOperations = new Set();

  function assertExclusiveTabOperationAvailable(tab) {
    if (exclusiveTabOperations.has(tab.id)) throw new ProtocolError("busy", "Another resource, model, or session operation is already in progress for this tab");
  }

  async function withExclusiveTabOperation(tab, operation) {
    assertExclusiveTabOperationAvailable(tab);
    exclusiveTabOperations.add(tab.id);
    try {
      return await operation();
    } finally {
      exclusiveTabOperations.delete(tab.id);
    }
  }

  function prospectiveStored(before, scope, field, value) {
    if (scope === "session") return before.stored;
    const nextValue = structuredClone(before.stored.value);
    if (scope === "global") nextValue.global = updateProfile(nextValue.global, field, value);
    else {
      const key = `${before.helper.model.provider}/${before.helper.model.id}`;
      nextValue.models[key] = updateProfile(nextValue.models[key] ?? validateProfile(null), field, value);
    }
    return { ...before.stored, value: nextValue };
  }

  function prospectiveContext(before, scope, field, value, stored) {
    const helper = scope === "session"
      ? { ...before.helper, sessionProfile: updateProfile(before.helper.sessionProfile, field, value) }
      : before.helper;
    return resourceContextFrom(before.tab, helper, stored);
  }

  async function rollbackResources(attempted, beforeById, scope, field, cause) {
    const failures = [];
    for (const target of attempted.slice().reverse()) {
      const before = beforeById.get(target.id);
      if (!before) continue;
      try {
        const session = scope === "session" ? { [field]: before.helper.sessionProfile[field] } : undefined;
        await target.session.helperApply({ ...(session ? { session } : {}), effective: helperEffective(before) });
      } catch (error) {
        failures.push(`${target.id}: ${boundedError(error?.message ?? String(error))}`);
      }
    }
    if (failures.length > 0) {
      throw new ProtocolError("internal_error", `The resource change did not commit, and rollback failed (${failures.join("; ")}). The affected session state may be inconsistent. Original error: ${boundedError(cause?.message ?? String(cause))}`);
    }
    throw cause;
  }

  async function setResource(tab, scope, field, value) {
    const acquired = [];
    let targets = [tab];
    try {
      if (scope === "global") targets = allTabs();
      else if (scope === "model") {
        const runtime = tab.session.snapshot().runtime;
        targets = allTabs().filter((candidate) => {
          const candidateRuntime = candidate.session.snapshot().runtime;
          return candidateRuntime.provider === runtime.provider && candidateRuntime.modelId === runtime.modelId;
        });
      }
      for (const target of targets) {
        if (target.session.snapshot().active) throw new ProtocolError("busy", "A broader resource profile cannot change while an affected tab is active");
        if (target.id !== tab.id) {
          if (exclusiveTabOperations.has(target.id)) throw new ProtocolError("busy", "Another resource, model, or session operation is already in progress for an affected tab");
          exclusiveTabOperations.add(target.id);
          acquired.push(target.id);
        }
      }

      const beforeById = new Map();
      for (const target of targets) beforeById.set(target.id, await resourceContext(target));
      const before = beforeById.get(tab.id);
      const known = field === "tools" ? before.helper.toolNames : before.helper.skillNames;
      if (field !== "sampling" && value !== null) {
        const unknown = value.find((name) => !known.has(name));
        if (unknown) throw new ProtocolError("invalid_request", `Unknown ${field === "tools" ? "tool" : "skill"} ${unknown}`);
      }
      const storedBefore = before.stored;
      const storedProspective = prospectiveStored(before, scope, field, value);
      const prospectiveById = new Map();
      for (const target of targets) prospectiveById.set(target.id, prospectiveContext(beforeById.get(target.id), scope, field, value, storedProspective));

      const attempted = [];
      const appliedHelpers = new Map();
      for (const target of targets) {
        attempted.push(target);
        const prospective = prospectiveById.get(target.id);
        const session = scope === "session" ? { [field]: prospective.helper.sessionProfile[field] } : undefined;
        try {
          const raw = await target.session.helperApply({ ...(session ? { session } : {}), effective: helperEffective(prospective) });
          const applied = normalizeHelperState(target, raw);
          validateAppliedHelper(prospective, applied);
          appliedHelpers.set(target.id, applied);
        } catch (error) {
          await rollbackResources(attempted, beforeById, scope, field, error);
        }
      }

      let committedStored = storedBefore;
      if (scope !== "session") {
        try {
          resources.update(scope, { provider: before.helper.model.provider, modelId: before.helper.model.id }, field, value);
          committedStored = resources.read();
        } catch (error) {
          await rollbackResources(attempted, beforeById, scope, field, error);
        }
      }

      let requestedResult = null;
      for (const target of targets) {
        const finalContext = resourceContextFrom(target, appliedHelpers.get(target.id), committedStored);
        const stateResult = resourceResult(finalContext);
        emit("resources.changed", { tab: target.id, scope, field, state: stateResult });
        if (target.id === tab.id) requestedResult = stateResult;
      }
      return requestedResult;
    } finally {
      for (const id of acquired) exclusiveTabOperations.delete(id);
    }
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
        appearance: appearance.snapshot(),
        recentActions: state.read().value.recentActions,
        stats: { maxWritableLength, droppedTotal, backpressurePauses, queuedRecords },
      };
    },
    async prompt(request) {
      const tab = tabFor(request);
      assertExclusiveTabOperationAvailable(tab);
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
      const tab = tabFor(request);
      return withExclusiveTabOperation(tab, () => registry.restart(tab.id));
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
        paths: { settings: settings.path, state: state.path, sequences: sequences.path, resources: resources.path },
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
      const tab = tabFor(request);
      return withExclusiveTabOperation(tab, async () => {
        const result = await tab.session.setModel({ provider: request.provider, modelId: request.modelId });
        return { ...result, resources: await safeReadResources(tab) };
      });
    },
    async model_cycle(request) {
      const tab = tabFor(request);
      return withExclusiveTabOperation(tab, async () => {
        const result = await tab.session.cycleModel();
        return { ...result, resources: await safeReadResources(tab) };
      });
    },
    async thinking_levels(request) {
      return tabFor(request).session.listThinkingLevels();
    },
    async thinking_set(request) {
      const tab = tabFor(request);
      return withExclusiveTabOperation(tab, async () => {
        const result = await tab.session.setThinkingLevel({ level: request.level });
        return { ...result, resources: await safeReadResources(tab) };
      });
    },
    async thinking_cycle(request) {
      const tab = tabFor(request);
      return withExclusiveTabOperation(tab, async () => {
        const result = await tab.session.cycleThinkingLevel();
        return { ...result, resources: await safeReadResources(tab) };
      });
    },
    async resources_state(request) {
      const tab = tabFor(request);
      try {
        return await withExclusiveTabOperation(tab, () => safeReadResources(tab));
      } catch (error) {
        return { available: false, error: { code: error.code || "unavailable", message: boundedError(error.message) } };
      }
    },
    async tools_set(request) {
      const tab = tabFor(request);
      return withExclusiveTabOperation(tab, () => setResource(tab, request.scope, "tools", request.names));
    },
    async skills_set(request) {
      const tab = tabFor(request);
      return withExclusiveTabOperation(tab, () => setResource(tab, request.scope, "skills", request.names));
    },
    async sampling_set(request) {
      const tab = tabFor(request);
      return withExclusiveTabOperation(tab, () => setResource(tab, request.scope, "sampling", request.params));
    },
    async compact(request) {
      const tab = tabFor(request);
      return withExclusiveTabOperation(tab, () => tab.session.compact({ instructions: request.instructions }));
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
      const tab = tabFor(request);
      assertExclusiveTabOperationAvailable(tab);
      return tab.session.runSequence({ sequenceId: sequence.id, entries: sequence.entries });
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
      const tab = tabFor(request);
      return withExclusiveTabOperation(tab, async () => {
        const wasActive = registry.activeId === tab.id;
        const result = await registry.close(tab.id, { force: request.force });
        const next = wasActive ? registry.active() : null;
        return { ...result, ...(next ? tabSnapshot(next) : {}) };
      });
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
      return withExclusiveTabOperation(tab, () => tab.session.switchSession(request.sessionPath));
    },
    async session_new(request) {
      const tab = tabFor(request);
      return withExclusiveTabOperation(tab, () => tab.session.newSession());
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
    appearance.stopNow();
    for (const child of registry.children()) killProcessTreeNow(child);
  }

  function shutdown(code, reason) {
    if (shutdownPromise) return shutdownPromise;
    closing = true;
    const appearanceStop = appearance.stop();
    emit("backend.closing", { reason });
    const forced = setTimeout(() => {
      killAllNow();
      exit(code);
    }, LIMITS.shutdownGraceMs + 1_000);
    shutdownPromise = Promise.all([appearanceStop, registry.stopAll()]).then(() => {
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
    appearance.start();
    emit("backend.ready", { protocolVersion: PROTOCOL_VERSION, backendPid: process.pid, limits: LIMITS, cwd, smokeMode, appearance: appearance.snapshot() });
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
