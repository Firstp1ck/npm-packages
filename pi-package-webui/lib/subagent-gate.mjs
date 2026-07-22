import { randomUUID } from "node:crypto";
import { Type } from "typebox";

export const SUBAGENT_GATE_UPDATE_EVENT = "webui:subagent-gate:v1:update";
export const SUBAGENT_GATE_PROTOCOL_VERSION = 1;

const SUBAGENT_RPC_VERSION = 1;
const SUBAGENT_RPC_REQUEST_EVENT = "subagents:rpc:v1:request";
const SUBAGENT_RPC_REPLY_PREFIX = "subagents:rpc:v1:reply:";
const SUBAGENT_ASYNC_COMPLETE_EVENT = "subagent:async-complete";
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_GATE_TIMEOUT_MS = 30 * 60 * 1000;
const RPC_TIMEOUT_MS = 10_000;
const COMPLETION_CACHE_LIMIT = 128;
const COMPLETION_CACHE_TTL_MS = 10 * 60 * 1000;
const GATE_ATTEMPT_LIMIT = 100;

const RetrySafety = Type.String({
  enum: ["read-only", "may-write"],
  description: "Post-launch retry safety. Defaults to may-write; only read-only tasks may retry automatically after a child starts.",
});

const GateTask = Type.Object({
  agent: Type.String({ minLength: 1 }),
  task: Type.String({ minLength: 1 }),
  label: Type.Optional(Type.String()),
  phase: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  fallbackModels: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 8 })),
  context: Type.Optional(Type.String({ enum: ["fresh", "fork"] })),
  cwd: Type.Optional(Type.String()),
  skill: Type.Optional(Type.Unsafe({ anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }, { type: "boolean" }] })),
  output: Type.Optional(Type.Unsafe({ anyOf: [{ type: "string" }, { type: "boolean" }] })),
  outputMode: Type.Optional(Type.String({ enum: ["inline", "file-only"] })),
  acceptance: Type.Optional(Type.Any()),
  retrySafety: Type.Optional(RetrySafety),
}, { additionalProperties: false });

export const SubagentGateParams = Type.Object({
  tasks: Type.Array(GateTask, { minItems: 1, maxItems: 20 }),
  requiredSuccesses: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Successful task slots required. Defaults to all tasks." })),
  maxAttemptsPerTask: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, description: "Total attempts per task slot, including the first. Defaults to 2." })),
  requireDistinctProviders: Type.Optional(Type.Boolean({ description: "Count at most one successful task per provider family." })),
  excludedProviders: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 12 })),
  concurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
  attemptTimeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 2 * 60 * 60 * 1000 })),
  gateTimeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 2 * 60 * 60 * 1000 })),
}, { additionalProperties: false });

function text(value, maxLength = 1000) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, maxLength) : "";
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = text(value, 240);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function providerFromModel(model) {
  const normalized = text(model, 240);
  const slash = normalized.indexOf("/");
  return (slash > 0 ? normalized.slice(0, slash) : normalized).toLowerCase();
}

function completionChild(result = {}) {
  const children = Array.isArray(result.results) ? result.results : [];
  return children.length === 1 ? children[0] || {} : {};
}

function completionOutput(result = {}) {
  const child = completionChild(result);
  return text(child.output || child.summary || result.summary || result.output, 50_000);
}

function completionModel(result = {}, requestedModel) {
  const child = completionChild(result);
  return text(child.model || result.model || requestedModel, 240);
}

function completionAcceptanceRejected(result = {}) {
  const child = completionChild(result);
  return child?.acceptance?.status === "rejected" || result?.acceptance?.status === "rejected";
}

const TRANSIENT_PROVIDER_PATTERN = /(?:rate\s*limit|too many requests|\b429\b|quota|billing|credit|auth(?:entication)?|unauthori[sz]ed|forbidden|api key|token expired|invalid key|provider.*unavailable|model.*(?:unavailable|disabled|not found|load|fail|error)|unknown model|overloaded|service unavailable|temporar(?:ily)? unavailable|connection refused|fetch failed|network error|socket hang up|stream ended without finish_reason|upstream|cold.?start|\b50[234]\b)/i;
const DETERMINISTIC_CONFIGURATION_PATTERN = /(?:unknown agent|invalid (?:request|params|model scope)|out of scope|skills? not found|tool.+unavailable|missing required|must not have additional properties|does not exist)/i;

export function classifySubagentFailure(input = {}) {
  const result = input.result || {};
  const child = completionChild(result);
  const error = text(input.error || child.error || result.error || result.summary, 4000);
  const state = text(child.state || child.status || result.state, 80).toLowerCase();
  const output = completionOutput(result);

  if (input.phase === "spawn") {
    if (input.code === "invalid_request" || input.code === "invalid_params" || DETERMINISTIC_CONFIGURATION_PATTERN.test(error)) {
      return { kind: "configuration", retryable: false, reason: error || "Invalid subagent launch configuration." };
    }
    return { kind: "pre-launch", retryable: true, reason: error || "Subagent launch failed before a child run was created." };
  }
  if (result.stopped === true || child.stopped === true || state === "stopped") {
    return { kind: "stopped", retryable: false, reason: error || "Subagent was stopped." };
  }
  if (result.interrupted === true || child.interrupted === true || state === "paused" || state === "interrupted") {
    return { kind: "interrupted", retryable: false, reason: error || "Subagent was interrupted." };
  }
  if (result.timedOut === true || child.timedOut === true || /timed? out|timeout/i.test(error)) {
    return { kind: "timeout", retryable: true, reason: error || "Subagent timed out." };
  }
  if (result.protocolError || child.protocolError) {
    return { kind: "protocol", retryable: true, reason: error || "Subagent protocol failed." };
  }
  if (completionAcceptanceRejected(result)) {
    return { kind: "acceptance", retryable: true, reason: error || "Subagent output failed acceptance." };
  }
  if (DETERMINISTIC_CONFIGURATION_PATTERN.test(error)) {
    return { kind: "configuration", retryable: false, reason: error };
  }
  if (TRANSIENT_PROVIDER_PATTERN.test(error)) {
    return { kind: "transient-provider", retryable: true, reason: error };
  }
  if (!output || output === "(no output)") {
    return { kind: "empty-output", retryable: true, reason: error || "Subagent produced no usable output." };
  }
  return { kind: "task-failure", retryable: false, reason: error || "Subagent task failed." };
}

function isSuccessfulCompletion(result = {}) {
  const child = completionChild(result);
  const state = text(result.state, 80).toLowerCase();
  const childSucceeded = typeof child.success === "boolean" ? child.success : undefined;
  const success = result.success === true || (result.success === undefined && childSucceeded === true) || state === "complete" || state === "completed";
  return success && childSucceeded !== false && !completionAcceptanceRejected(result) && Boolean(completionOutput(result)) && completionOutput(result) !== "(no output)";
}

function attemptSnapshot(attempt) {
  return {
    id: attempt.id,
    taskIndex: attempt.taskIndex,
    attempt: attempt.attempt,
    maxAttempts: attempt.maxAttempts,
    agent: text(attempt.agent, 160),
    label: text(attempt.label, 200) || undefined,
    phase: text(attempt.phase, 120) || undefined,
    retrySafety: attempt.retrySafety,
    runId: text(attempt.runId, 160) || undefined,
    retryOf: text(attempt.retryOf, 160) || undefined,
    model: text(attempt.model, 240) || undefined,
    provider: text(attempt.provider, 80) || undefined,
    status: attempt.status,
    failureKind: text(attempt.failureKind, 80) || undefined,
    error: text(attempt.error, 1000) || undefined,
    startedAt: attempt.startedAt,
    endedAt: attempt.endedAt,
  };
}

function gateSnapshot(gate) {
  return {
    version: SUBAGENT_GATE_PROTOCOL_VERSION,
    id: gate.id,
    status: gate.status,
    requiredSuccesses: gate.requiredSuccesses,
    qualifyingSuccesses: gate.qualifyingSuccesses,
    requireDistinctProviders: gate.requireDistinctProviders,
    startedAt: gate.startedAt,
    updatedAt: gate.updatedAt,
    endedAt: gate.endedAt,
    attempts: gate.attempts.slice(-GATE_ATTEMPT_LIMIT).map(attemptSnapshot),
  };
}

function rpcRequest(pi, method, params, { signal, timeoutMs = RPC_TIMEOUT_MS, preserveReplyOnAbort = false } = {}) {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    let unsubscribe;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (typeof unsubscribe === "function") unsubscribe();
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => {
      if (!preserveReplyOnAbort) finish(Object.assign(new Error("Subagent gate cancelled."), { name: "AbortError" }));
    };
    const timeout = setTimeout(() => finish(Object.assign(new Error(`pi-subagents RPC ${method} timed out.`), { code: "rpc_timeout" })), timeoutMs);
    timeout.unref?.();
    unsubscribe = pi.events.on(`${SUBAGENT_RPC_REPLY_PREFIX}${requestId}`, (reply) => {
      if (reply?.success === false) {
        finish(Object.assign(new Error(reply.error?.message || `pi-subagents RPC ${method} failed.`), { code: reply.error?.code || "execution_failed" }));
        return;
      }
      finish(null, reply?.data || {});
    });
    if (signal?.aborted) {
      finish(Object.assign(new Error("Subagent gate cancelled."), { name: "AbortError" }));
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    try {
      pi.events.emit(SUBAGENT_RPC_REQUEST_EVENT, {
        version: SUBAGENT_RPC_VERSION,
        requestId,
        method,
        params,
        source: { extension: "@firstpick/pi-package-webui", feature: "subagent_gate" },
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function createCompletionRegistry(pi) {
  const completed = new Map();
  const waiters = new Map();
  const prune = () => {
    const cutoff = Date.now() - COMPLETION_CACHE_TTL_MS;
    for (const [runId, entry] of completed) if (entry.receivedAt < cutoff) completed.delete(runId);
    while (completed.size > COMPLETION_CACHE_LIMIT) completed.delete(completed.keys().next().value);
  };
  const unsubscribe = pi.events.on(SUBAGENT_ASYNC_COMPLETE_EVENT, (value) => {
    const runId = text(value?.runId || value?.id, 160);
    if (!runId) return;
    const waiter = waiters.get(runId);
    if (waiter) {
      waiters.delete(runId);
      waiter.resolve(value || {});
    } else {
      completed.set(runId, { value: value || {}, receivedAt: Date.now() });
      prune();
    }
  });
  return {
    wait(runId, signal) {
      const cached = completed.get(runId);
      if (cached) {
        completed.delete(runId);
        return Promise.resolve(cached.value);
      }
      return new Promise((resolve, reject) => {
        const abort = () => {
          waiters.delete(runId);
          reject(Object.assign(new Error("Subagent gate cancelled."), { name: "AbortError" }));
        };
        waiters.set(runId, {
          resolve: (value) => {
            signal?.removeEventListener("abort", abort);
            resolve(value);
          },
        });
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
    },
    dispose() {
      if (typeof unsubscribe === "function") unsubscribe();
      for (const waiter of waiters.values()) waiter.resolve({ success: false, state: "stopped", summary: "Subagent gate extension disposed." });
      waiters.clear();
      completed.clear();
    },
  };
}

async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

function modelForAttempt(task, attemptIndex, successfulProviders, requireDistinctProviders, excludedProviders) {
  const declaredCandidates = uniqueStrings([task.model, ...(task.fallbackModels || [])]);
  if (!declaredCandidates.length) return { model: undefined, exhausted: false };
  const candidates = declaredCandidates.filter((candidate) => !excludedProviders.has(providerFromModel(candidate)));
  const available = requireDistinctProviders
    ? candidates.filter((candidate) => !successfulProviders.has(providerFromModel(candidate)))
    : candidates;
  if (!available.length) return { model: undefined, exhausted: true };
  return { model: available[Math.min(attemptIndex, available.length - 1)], exhausted: false };
}

function spawnParams(task, model, attemptTimeoutMs) {
  return {
    agent: task.agent,
    task: task.task,
    ...(model ? { model } : {}),
    ...(task.context ? { context: task.context } : {}),
    ...(task.cwd ? { cwd: task.cwd } : {}),
    ...(task.skill !== undefined ? { skill: task.skill } : {}),
    ...(task.output !== undefined ? { output: task.output } : {}),
    ...(task.outputMode ? { outputMode: task.outputMode } : {}),
    ...(task.acceptance !== undefined ? { acceptance: task.acceptance } : {}),
    ...(attemptTimeoutMs ? { timeoutMs: attemptTimeoutMs } : {}),
    async: true,
  };
}

function formatGateResult(gate, slotResults) {
  const lines = [
    `Subagent gate ${gate.status}: ${gate.qualifyingSuccesses}/${gate.requiredSuccesses} qualifying successes.`,
    `Attempts: ${gate.attempts.length}.`,
  ];
  const failures = gate.attempts.filter((attempt) => attempt.status === "failed" || attempt.status === "not-qualifying" || attempt.status === "cancelled");
  if (failures.length) lines.push(`Failures: ${failures.map((attempt) => `${attempt.agent}#${attempt.attempt} ${attempt.failureKind || "failed"}`).join(", ")}.`);
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    ...(gate.status === "satisfied" ? {} : { isError: true }),
    details: {
      mode: "gate",
      gate: gateSnapshot(gate),
      results: slotResults.filter((slot) => slot && !slot.skipped).map((slot) => ({
        taskIndex: slot.taskIndex,
        agent: slot.agent,
        success: slot.success,
        output: slot.output,
        model: slot.model,
        provider: slot.provider,
        runId: slot.runId,
        error: slot.error,
      })),
      exhaustedSlots: slotResults.filter((slot) => slot && slot.success === false && !slot.skipped).map((slot) => slot.taskIndex),
      skippedSlots: slotResults.filter((slot) => slot?.skipped).map((slot) => slot.taskIndex),
      residualFailures: gate.attempts.filter((attempt) => attempt.status === "failed" || attempt.status === "not-qualifying" || attempt.status === "cancelled").map((attempt) => ({
        taskIndex: attempt.taskIndex,
        attempt: attempt.attempt,
        kind: attempt.failureKind,
        error: attempt.error,
      })),
    },
  };
}

export function registerSubagentGate(pi) {
  const completionRegistry = createCompletionRegistry(pi);
  const activeGates = new Map();

  const emitGate = (gate) => {
    gate.updatedAt = Date.now();
    pi.events.emit(SUBAGENT_GATE_UPDATE_EVENT, gateSnapshot(gate));
  };

  const tool = {
    name: "subagent_gate",
    label: "Subagent Gate",
    description: "Launch generic subagent task slots through pi-subagents RPC v1, require a success quorum, and perform bounded failure-aware retries. Post-launch retries require retrySafety='read-only'; may-write is the safe default.",
    promptSnippet: "Run subagent tasks with bounded retries and a required success quorum",
    promptGuidelines: [
      "Use subagent_gate instead of raw subagent calls when a delegated result must be retried safely or a success quorum must be enforced.",
      "Set each subagent_gate task retrySafety to read-only only when rerunning it cannot duplicate file mutations or external side effects; omission defaults to may-write.",
    ],
    parameters: SubagentGateParams,
    async execute(_toolCallId, params, signal, onUpdate) {
      const requiredSuccesses = params.requiredSuccesses ?? params.tasks.length;
      if (requiredSuccesses > params.tasks.length) throw new Error("requiredSuccesses cannot exceed the number of task slots.");
      const maxAttempts = params.maxAttemptsPerTask ?? DEFAULT_MAX_ATTEMPTS;
      const gateTimeoutMs = params.gateTimeoutMs ?? DEFAULT_GATE_TIMEOUT_MS;
      const excludedProviders = new Set((params.excludedProviders || []).map((provider) => text(provider, 80).toLowerCase()).filter(Boolean));
      const gate = {
        id: randomUUID(),
        status: "running",
        requiredSuccesses,
        qualifyingSuccesses: 0,
        requireDistinctProviders: params.requireDistinctProviders === true,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        attempts: [],
      };
      activeGates.set(gate.id, gate);
      emitGate(gate);

      const controller = new AbortController();
      let gateDeadlineReached = false;
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => {
        gateDeadlineReached = true;
        controller.abort();
      }, gateTimeoutMs);
      const activeRunIds = new Set();
      const successfulProviders = new Set();
      const slotResults = new Array(params.tasks.length);

      const publishProgress = () => {
        emitGate(gate);
        onUpdate?.({
          content: [{ type: "text", text: `Subagent gate running: ${gate.qualifyingSuccesses}/${gate.requiredSuccesses} qualifying successes across ${gate.attempts.length} attempts.` }],
          details: { mode: "gate", gate: gateSnapshot(gate), results: [] },
        });
      };

      const cancelAttempt = (attempt) => {
        attempt.status = "cancelled";
        attempt.failureKind = gateDeadlineReached ? "timeout" : "cancelled";
        attempt.error = gateDeadlineReached ? "Subagent gate deadline reached." : "Subagent gate cancelled.";
        attempt.endedAt = Date.now();
        publishProgress();
      };

      const runSlot = async (task, taskIndex) => {
        let previousRunId;
        for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex++) {
          if (controller.signal.aborted) break;
          if (gate.qualifyingSuccesses >= gate.requiredSuccesses) {
            const skipped = { taskIndex, agent: task.agent, success: false, skipped: true };
            slotResults[taskIndex] = skipped;
            return skipped;
          }
          const selection = modelForAttempt(task, attemptIndex, successfulProviders, gate.requireDistinctProviders, excludedProviders);
          const model = selection.model;
          const attempt = {
            id: `${gate.id}:${taskIndex}:${attemptIndex + 1}`,
            taskIndex,
            attempt: attemptIndex + 1,
            maxAttempts,
            agent: task.agent,
            label: task.label,
            phase: task.phase,
            retrySafety: task.retrySafety || "may-write",
            retryOf: previousRunId,
            model,
            provider: providerFromModel(model),
            status: "launching",
            startedAt: Date.now(),
          };
          gate.attempts.push(attempt);
          publishProgress();

          if (selection.exhausted) {
            attempt.status = "failed";
            attempt.failureKind = "provider-exhausted";
            attempt.error = "No declared model candidate can satisfy the gate's provider constraints.";
            attempt.endedAt = Date.now();
            slotResults[taskIndex] = { taskIndex, agent: task.agent, success: false, error: attempt.error };
            publishProgress();
            break;
          }

          let spawn;
          try {
            spawn = await rpcRequest(pi, "spawn", spawnParams(task, model, params.attemptTimeoutMs), { signal: controller.signal, preserveReplyOnAbort: true });
          } catch (error) {
            if (controller.signal.aborted || error?.name === "AbortError") {
              cancelAttempt(attempt);
              break;
            }
            const classified = classifySubagentFailure({ phase: "spawn", code: error?.code, error: error?.message || error });
            attempt.status = "failed";
            attempt.failureKind = classified.kind;
            attempt.error = classified.reason;
            attempt.endedAt = Date.now();
            publishProgress();
            if (!classified.retryable || attemptIndex + 1 >= maxAttempts) {
              slotResults[taskIndex] = { taskIndex, agent: task.agent, success: false, error: classified.reason };
              break;
            }
            continue;
          }

          const runId = text(spawn?.details?.asyncId || spawn?.details?.runId, 160);
          if (!runId) {
            if (controller.signal.aborted) {
              cancelAttempt(attempt);
              break;
            }
            const reason = "pi-subagents RPC spawn succeeded without an async run id; child creation is ambiguous.";
            attempt.status = "failed";
            attempt.failureKind = "protocol-ambiguous";
            attempt.error = reason;
            attempt.endedAt = Date.now();
            publishProgress();
            if (attempt.retrySafety !== "read-only" || attemptIndex + 1 >= maxAttempts) {
              slotResults[taskIndex] = { taskIndex, agent: task.agent, success: false, error: reason };
              break;
            }
            continue;
          }

          attempt.runId = runId;
          previousRunId = runId;
          activeRunIds.add(runId);
          if (controller.signal.aborted) {
            cancelAttempt(attempt);
            break;
          }
          attempt.status = "running";
          publishProgress();

          let completion;
          let completionSettled = false;
          try {
            completion = await completionRegistry.wait(runId, controller.signal);
            completionSettled = true;
          } catch (error) {
            if (error?.name === "AbortError") {
              cancelAttempt(attempt);
              break;
            }
            completion = { success: false, state: "failed", summary: error?.message || String(error) };
            completionSettled = true;
          } finally {
            if (completionSettled) activeRunIds.delete(runId);
          }

          const effectiveModel = completionModel(completion, model);
          const provider = providerFromModel(effectiveModel);
          attempt.model = effectiveModel || model;
          attempt.provider = provider || attempt.provider;
          attempt.endedAt = Date.now();

          if (isSuccessfulCompletion(completion)) {
            if (excludedProviders.has(provider)) {
              attempt.status = "not-qualifying";
              attempt.failureKind = "excluded-provider";
              attempt.error = `Provider ${provider || "unknown"} is excluded by this gate.`;
            } else if (gate.requireDistinctProviders && !provider) {
              attempt.status = "not-qualifying";
              attempt.failureKind = "provider-unknown";
              attempt.error = "The effective provider is unknown, so provider diversity cannot be verified.";
            } else if (gate.requireDistinctProviders && successfulProviders.has(provider)) {
              attempt.status = "not-qualifying";
              attempt.failureKind = "provider-diversity";
              attempt.error = `Provider ${provider} already supplied a qualifying success.`;
            } else {
              attempt.status = "succeeded";
              if (provider) successfulProviders.add(provider);
              gate.qualifyingSuccesses += 1;
              slotResults[taskIndex] = {
                taskIndex,
                agent: task.agent,
                success: true,
                output: completionOutput(completion),
                model: effectiveModel || model,
                provider,
                runId,
              };
              publishProgress();
              return slotResults[taskIndex];
            }
          } else {
            const classified = classifySubagentFailure({ phase: "completion", result: completion });
            attempt.status = "failed";
            attempt.failureKind = classified.kind;
            attempt.error = classified.reason;
          }
          publishProgress();

          const postLaunchRetrySafe = attempt.retrySafety === "read-only";
          const retryableFailure = attempt.failureKind === "provider-diversity" || attempt.failureKind === "provider-unknown" || attempt.failureKind === "excluded-provider"
            ? postLaunchRetrySafe
            : postLaunchRetrySafe && classifySubagentFailure({ phase: "completion", result: completion }).retryable;
          if (!retryableFailure || attemptIndex + 1 >= maxAttempts) {
            slotResults[taskIndex] = {
              taskIndex,
              agent: task.agent,
              success: false,
              model: effectiveModel || model,
              provider,
              runId,
              error: attempt.error,
            };
            break;
          }
        }
        return slotResults[taskIndex];
      };

      try {
        await mapConcurrent(params.tasks, params.concurrency ?? Math.min(4, params.tasks.length), runSlot);
        gate.status = gate.qualifyingSuccesses >= gate.requiredSuccesses ? "satisfied" : gateDeadlineReached ? "failed" : controller.signal.aborted ? "cancelled" : "failed";
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        if (controller.signal.aborted && activeRunIds.size) {
          await Promise.allSettled([...activeRunIds].map((runId) => rpcRequest(pi, "stop", { id: runId }, { timeoutMs: RPC_TIMEOUT_MS })));
        }
        gate.endedAt = Date.now();
        emitGate(gate);
        activeGates.delete(gate.id);
      }

      const result = formatGateResult(gate, slotResults);
      if (gate.status !== "satisfied") {
        const error = new Error(result.content[0].text);
        error.name = "SubagentGateError";
        error.details = result.details;
        throw error;
      }
      return result;
    },
  };

  pi.registerTool(tool);
  return {
    dispose() {
      completionRegistry.dispose();
      activeGates.clear();
    },
  };
}
