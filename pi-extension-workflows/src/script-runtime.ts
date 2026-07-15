import { getQuickJS } from "quickjs-emscripten";
import { WorkflowCancelledError, WorkflowError, WorkflowValidationError, errorMessage } from "./errors.ts";
import {
  DEFAULT_WORKFLOW_INSTRUCTION_LIMIT,
  DEFAULT_WORKFLOW_MEMORY_BYTES,
  DEFAULT_WORKFLOW_STACK_BYTES,
  HARD_MAX_WORKFLOW_INSTRUCTION_LIMIT,
  HARD_MAX_WORKFLOW_MEMORY_BYTES,
} from "./script-schema.ts";
import type { WorkflowArgs, WorkflowScriptDefinition } from "./types.ts";

export type WorkflowAgentOptions = {
  label?: string;
  model?: string;
  tools?: string[];
  cwd?: string;
  schema?: unknown;
  timeoutMs?: number;
};

export type WorkflowAgentRequest = {
  prompt: string;
  options: WorkflowAgentOptions;
  phasePath: string[];
  pipelineKey?: string;
  callIndex: number;
};

export type WorkflowPhaseEvent = {
  type: "start" | "complete" | "failed";
  name: string;
  path: string[];
  error?: string;
  timestamp: string;
};

export type WorkflowPipelineEvent = {
  type: "start" | "complete" | "failed";
  pipelineId: string;
  index: number;
  key: string;
  error?: string;
  timestamp: string;
};

export type WorkflowScriptRuntimeHandlers = {
  agent(request: WorkflowAgentRequest, signal: AbortSignal): Promise<unknown>;
  onPhaseEvent?: (event: WorkflowPhaseEvent) => void;
  onPipelineEvent?: (event: WorkflowPipelineEvent) => void;
};

export type WorkflowScriptRuntimeOptions = {
  signal?: AbortSignal;
  memoryLimitBytes?: number;
  stackLimitBytes?: number;
  instructionLimit?: number;
  timeoutMs?: number;
};

export type WorkflowScriptExecutionResult = {
  result: unknown;
  agentCalls: number;
  interruptChecks: number;
  startedAt: string;
  finishedAt: string;
};

type HostAgentPayload = {
  prompt?: unknown;
  options?: unknown;
  phasePath?: unknown;
  pipelineKey?: unknown;
};

type HostPhasePayload = {
  type?: unknown;
  name?: unknown;
  path?: unknown;
  error?: unknown;
};

type HostPipelinePayload = {
  type?: unknown;
  pipelineId?: unknown;
  index?: unknown;
  key?: unknown;
  error?: unknown;
};

const AGENT_OPTION_KEYS = new Set(["label", "model", "tools", "cwd", "schema", "timeoutMs"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureJsonCompatible(value: unknown, label: string): string {
  try {
    const serialized = JSON.stringify(value === undefined ? null : value);
    if (serialized === undefined) throw new Error("value cannot be represented as JSON");
    return serialized;
  } catch (error) {
    throw new WorkflowValidationError([`${label} must be JSON-compatible: ${errorMessage(error)}`]);
  }
}

function parseHostPayload(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new WorkflowValidationError([`${label} is not valid JSON: ${errorMessage(error)}`]);
  }
}

function validateAgentOptions(value: unknown): WorkflowAgentOptions {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new WorkflowValidationError(["agent options must be an object."]);
  for (const key of Object.keys(value)) {
    if (!AGENT_OPTION_KEYS.has(key)) throw new WorkflowValidationError([`agent option '${key}' is not supported.`]);
  }

  const result: WorkflowAgentOptions = {};
  for (const key of ["label", "model", "cwd"] as const) {
    const item = value[key];
    if (item !== undefined && (typeof item !== "string" || !item.trim())) {
      throw new WorkflowValidationError([`agent option '${key}' must be a non-empty string.`]);
    }
    if (typeof item === "string") result[key] = item;
  }
  if (value.tools !== undefined) {
    if (!Array.isArray(value.tools) || value.tools.some((tool) => typeof tool !== "string" || !tool.trim())) {
      throw new WorkflowValidationError(["agent option 'tools' must be an array of non-empty strings."]);
    }
    result.tools = [...value.tools] as string[];
  }
  if (value.timeoutMs !== undefined) {
    if (!Number.isInteger(value.timeoutMs) || Number(value.timeoutMs) <= 0) {
      throw new WorkflowValidationError(["agent option 'timeoutMs' must be a positive integer."]);
    }
    result.timeoutMs = value.timeoutMs as number;
  }
  if (value.schema !== undefined) result.schema = value.schema;
  return result;
}

function validateAgentPayload(value: unknown, callIndex: number): WorkflowAgentRequest {
  if (!isRecord(value)) throw new WorkflowValidationError(["agent request must be an object."]);
  const payload = value as HostAgentPayload;
  if (typeof payload.prompt !== "string" || !payload.prompt.trim()) {
    throw new WorkflowValidationError(["agent prompt must be a non-empty string."]);
  }
  if (!Array.isArray(payload.phasePath) || payload.phasePath.some((part) => typeof part !== "string" || !part.trim())) {
    throw new WorkflowValidationError(["agent phasePath must be an array of non-empty strings."]);
  }
  return {
    prompt: payload.prompt,
    options: validateAgentOptions(payload.options),
    phasePath: [...payload.phasePath] as string[],
    ...(typeof payload.pipelineKey === "string" && payload.pipelineKey.trim() ? { pipelineKey: payload.pipelineKey } : {}),
    callIndex,
  };
}

function validatePhasePayload(value: unknown): WorkflowPhaseEvent {
  if (!isRecord(value)) throw new WorkflowValidationError(["phase event must be an object."]);
  const payload = value as HostPhasePayload;
  if (payload.type !== "start" && payload.type !== "complete" && payload.type !== "failed") {
    throw new WorkflowValidationError(["phase event type is invalid."]);
  }
  if (typeof payload.name !== "string" || !payload.name.trim()) {
    throw new WorkflowValidationError(["phase event name must be a non-empty string."]);
  }
  if (!Array.isArray(payload.path) || payload.path.some((part) => typeof part !== "string" || !part.trim())) {
    throw new WorkflowValidationError(["phase event path must be an array of non-empty strings."]);
  }
  return {
    type: payload.type,
    name: payload.name,
    path: [...payload.path] as string[],
    ...(typeof payload.error === "string" ? { error: payload.error } : {}),
    timestamp: new Date().toISOString(),
  };
}

function validatePipelinePayload(value: unknown): WorkflowPipelineEvent {
  if (!isRecord(value)) throw new WorkflowValidationError(["pipeline event must be an object."]);
  const payload = value as HostPipelinePayload;
  if (payload.type !== "start" && payload.type !== "complete" && payload.type !== "failed") {
    throw new WorkflowValidationError(["pipeline event type is invalid."]);
  }
  if (typeof payload.pipelineId !== "string" || !payload.pipelineId.trim()) throw new WorkflowValidationError(["pipelineId must be a non-empty string."]);
  if (!Number.isSafeInteger(payload.index) || Number(payload.index) < 0) throw new WorkflowValidationError(["pipeline index must be a non-negative safe integer."]);
  if (typeof payload.key !== "string" || !payload.key.trim()) throw new WorkflowValidationError(["pipeline key must be a non-empty string."]);
  return {
    type: payload.type,
    pipelineId: payload.pipelineId,
    index: Number(payload.index),
    key: payload.key,
    ...(typeof payload.error === "string" ? { error: payload.error } : {}),
    timestamp: new Date().toISOString(),
  };
}

function createSemaphore(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  const acquire = async (signal: AbortSignal): Promise<(() => void)> => {
    if (signal.aborted) throw new WorkflowCancelledError();
    if (active >= limit) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          const index = waiters.indexOf(onReady);
          if (index >= 0) waiters.splice(index, 1);
          reject(new WorkflowCancelledError());
        };
        const onReady = () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        };
        waiters.push(onReady);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
    if (signal.aborted) throw new WorkflowCancelledError();
    active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
      waiters.shift()?.();
    };
  };
  return { acquire };
}

function runtimeBootstrap(script: WorkflowScriptDefinition, argsJson: string): string {
  return `
"use strict";
const __hostAgent = globalThis.__pi_host_agent;
const __hostPhase = globalThis.__pi_host_phase;
const __hostPipeline = globalThis.__pi_host_pipeline;
delete globalThis.__pi_host_agent;
delete globalThis.__pi_host_phase;
delete globalThis.__pi_host_pipeline;
const __codeGeneratingPrototypes = [
  globalThis.Function && globalThis.Function.prototype,
  Object.getPrototypeOf(async function() {}),
  Object.getPrototypeOf(function*() {}),
  Object.getPrototypeOf(async function*() {})
].filter(Boolean);
for (const prototype of __codeGeneratingPrototypes) {
  try { Object.defineProperty(prototype, "constructor", { value: undefined, writable: false, configurable: false }); }
  catch {}
}
delete globalThis.eval;
delete globalThis.Function;
delete globalThis.WebAssembly;
delete globalThis.console;
(async () => {
  const args = JSON.parse(${JSON.stringify(argsJson)});
  const __phaseStack = [];
  let __pipelineSequence = 0;
  let __currentPipelineKey;
  const __json = (value, label) => {
    const encoded = JSON.stringify(value === undefined ? null : value);
    if (encoded === undefined) throw new TypeError(label + " must be JSON-compatible");
    return encoded;
  };
  const agent = async (prompt, options = {}) => {
    if (typeof prompt !== "string" || !prompt.trim()) throw new TypeError("agent prompt must be a non-empty string");
    const encoded = await __hostAgent(__json({ prompt, options, phasePath: [...__phaseStack], pipelineKey: __currentPipelineKey }, "agent request"));
    return JSON.parse(encoded);
  };
  const phase = async (name, run) => {
    if (typeof name !== "string" || !name.trim()) throw new TypeError("phase name must be a non-empty string");
    if (typeof run !== "function") throw new TypeError("phase callback must be a function");
    const path = [...__phaseStack, name];
    __hostPhase(__json({ type: "start", name, path }, "phase event"));
    __phaseStack.push(name);
    try {
      const value = await run();
      __hostPhase(__json({ type: "complete", name, path }, "phase event"));
      return value;
    } catch (error) {
      __hostPhase(__json({ type: "failed", name, path, error: String(error && error.message || error) }, "phase event"));
      throw error;
    } finally {
      __phaseStack.pop();
    }
  };
  const __mapLimited = async (items, concurrency, worker) => {
    const result = new Array(items.length);
    let next = 0;
    let firstError;
    const count = Math.max(1, Math.min(Math.trunc(concurrency || items.length || 1), items.length || 1));
    const workers = Array.from({ length: count }, async () => {
      while (firstError === undefined) {
        const index = next++;
        if (index >= items.length) return;
        try { result[index] = await worker(items[index], index); }
        catch (error) { firstError = error; return; }
      }
    });
    await Promise.all(workers);
    if (firstError !== undefined) throw firstError;
    return result;
  };
  const parallel = async (tasks, options = {}) => {
    if (!Array.isArray(tasks) || tasks.some(task => typeof task !== "function")) {
      throw new TypeError("parallel tasks must be an array of functions");
    }
    return __mapLimited(tasks, options.concurrency || tasks.length, task => task());
  };
  const pipeline = async (items, worker, options = {}) => {
    if (!Array.isArray(items)) throw new TypeError("pipeline items must be an array");
    if (typeof worker !== "function") throw new TypeError("pipeline worker must be a function");
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("pipeline options must be an object");
    if (options.key !== undefined && typeof options.key !== "function") throw new TypeError("pipeline key must be a function");
    const pipelineId = [...__phaseStack, "pipeline-" + (++__pipelineSequence)].join("/");
    const keys = items.map((item, index) => options.key ? options.key(item, index) : String(index));
    if (keys.some(key => typeof key !== "string" || !key.trim())) throw new TypeError("pipeline keys must be non-empty strings");
    if (new Set(keys).size !== keys.length) throw new TypeError("pipeline keys must be unique within a pipeline");
    return __mapLimited(items, options.concurrency || items.length, async (item, index) => {
      const key = keys[index];
      __hostPipeline(__json({ type: "start", pipelineId, index, key }, "pipeline event"));
      try {
        const previousPipelineKey = __currentPipelineKey;
        let pending;
        try {
          __currentPipelineKey = pipelineId + ":" + (typeof options.key === "function" ? "key:" : "index:") + key;
          pending = worker(item, index);
        } finally {
          __currentPipelineKey = previousPipelineKey;
        }
        const value = await pending;
        __hostPipeline(__json({ type: "complete", pipelineId, index, key }, "pipeline event"));
        return value;
      } catch (error) {
        __hostPipeline(__json({ type: "failed", pipelineId, index, key, error: String(error && error.message || error) }, "pipeline event"));
        throw error;
      }
    });
  };
  Object.freeze(agent);
  Object.freeze(phase);
  Object.freeze(parallel);
  Object.freeze(pipeline);
${script.body}
})()
`;
}

export async function executeWorkflowScript(
  script: WorkflowScriptDefinition,
  args: WorkflowArgs,
  handlers: WorkflowScriptRuntimeHandlers,
  options: WorkflowScriptRuntimeOptions = {},
): Promise<WorkflowScriptExecutionResult> {
  const startedAt = new Date().toISOString();
  const memoryLimit = Math.max(1024 * 1024, Math.min(options.memoryLimitBytes ?? DEFAULT_WORKFLOW_MEMORY_BYTES, HARD_MAX_WORKFLOW_MEMORY_BYTES));
  const stackLimit = Math.max(128 * 1024, options.stackLimitBytes ?? DEFAULT_WORKFLOW_STACK_BYTES);
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? script.meta.pi.timeoutMs, script.meta.pi.timeoutMs));
  const instructionLimit = Math.max(1, Math.min(options.instructionLimit ?? DEFAULT_WORKFLOW_INSTRUCTION_LIMIT, HARD_MAX_WORKFLOW_INSTRUCTION_LIMIT));
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  else options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(new WorkflowError("timeout", `Workflow exceeded timeout ${timeoutMs}ms.`)), timeoutMs);

  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(memoryLimit);
  runtime.setMaxStackSize(stackLimit);
  let interruptChecks = 0;
  runtime.setInterruptHandler(() => {
    interruptChecks++;
    if (!controller.signal.aborted && interruptChecks > instructionLimit) {
      controller.abort(new WorkflowError("budget_exhausted", `Workflow exceeded instruction limit ${instructionLimit}.`));
    }
    if (!controller.signal.aborted && Date.now() > deadline) {
      controller.abort(new WorkflowError("timeout", `Workflow exceeded timeout ${timeoutMs}ms.`));
    }
    return controller.signal.aborted;
  });
  const vm = runtime.newContext({
    intrinsics: {
      BaseObjects: true,
      Date: true,
      Eval: true,
      StringNormalize: true,
      RegExp: true,
      JSON: true,
      Proxy: true,
      MapSet: true,
      TypedArrays: true,
      Promise: true,
    },
  });
  const deferredPromises: Array<{ dispose(): void }> = [];
  const semaphore = createSemaphore(script.meta.pi.maxConcurrency);
  const labels = new Set<string>();
  let agentCalls = 0;

  const hostAgent = vm.newFunction("__pi_host_agent", (payloadHandle) => {
    const deferred = vm.newPromise();
    deferredPromises.push(deferred);
    void (async () => {
      let release: (() => void) | undefined;
      try {
        if (controller.signal.aborted) throw controller.signal.reason ?? new WorkflowCancelledError();
        const payload = parseHostPayload(vm.getString(payloadHandle), "agent request");
        const request = validateAgentPayload(payload, agentCalls + 1);
        agentCalls++;
        if (agentCalls > script.meta.pi.maxAgents) {
          throw new WorkflowError("budget_exhausted", `Workflow exceeded maxAgents ${script.meta.pi.maxAgents}.`);
        }
        if (request.options.label) {
          const labelKey = `${request.phasePath.join("/")}::${request.options.label}`;
          if (labels.has(labelKey)) throw new WorkflowValidationError([`duplicate agent label '${request.options.label}' in phase '${request.phasePath.join("/") || "root"}'.`]);
          labels.add(labelKey);
        }
        release = await semaphore.acquire(controller.signal);
        const result = await handlers.agent(request, controller.signal);
        const value = vm.newString(ensureJsonCompatible(result, "agent result"));
        deferred.resolve(value);
        value.dispose();
      } catch (error) {
        const value = vm.newError(errorMessage(error));
        deferred.reject(value);
        value.dispose();
      } finally {
        release?.();
        runtime.executePendingJobs();
      }
    })();
    return deferred.handle;
  });
  vm.setProp(vm.global, "__pi_host_agent", hostAgent);
  hostAgent.dispose();

  const hostPhase = vm.newFunction("__pi_host_phase", (payloadHandle) => {
    try {
      const payload = parseHostPayload(vm.getString(payloadHandle), "phase event");
      handlers.onPhaseEvent?.(validatePhasePayload(payload));
      return vm.undefined;
    } catch (error) {
      return vm.newError(errorMessage(error));
    }
  });
  vm.setProp(vm.global, "__pi_host_phase", hostPhase);
  hostPhase.dispose();

  const hostPipeline = vm.newFunction("__pi_host_pipeline", (payloadHandle) => {
    try {
      const payload = parseHostPayload(vm.getString(payloadHandle), "pipeline event");
      handlers.onPipelineEvent?.(validatePipelinePayload(payload));
      return vm.undefined;
    } catch (error) {
      return vm.newError(errorMessage(error));
    }
  });
  vm.setProp(vm.global, "__pi_host_pipeline", hostPipeline);
  hostPipeline.dispose();

  try {
    if (controller.signal.aborted) throw controller.signal.reason ?? new WorkflowCancelledError();
    const argsJson = ensureJsonCompatible(args, "workflow args");
    const evaluation = vm.evalCode(runtimeBootstrap(script, argsJson), script.meta.name, { type: "global" });
    if (evaluation.error) {
      const dumped = vm.dump(evaluation.error) as { name?: string; message?: string; stack?: string } | string;
      evaluation.error.dispose();
      const message = typeof dumped === "string" ? dumped : dumped.message || dumped.stack || dumped.name || "Workflow script evaluation failed.";
      throw new WorkflowError(controller.signal.aborted ? "cancelled" : "validation_error", message);
    }

    const promiseHandle = evaluation.value;
    const resolvedPromise = vm.resolvePromise(promiseHandle);
    promiseHandle.dispose();
    runtime.executePendingJobs();
    const resolved = await resolvedPromise;
    if (resolved.error) {
      const dumped = vm.dump(resolved.error) as { name?: string; message?: string; stack?: string } | string;
      resolved.error.dispose();
      const message = typeof dumped === "string" ? dumped : dumped.message || dumped.stack || dumped.name || "Workflow script failed.";
      if (controller.signal.aborted) {
        const reason = controller.signal.reason;
        if (reason instanceof WorkflowError) throw reason;
        throw new WorkflowCancelledError(message);
      }
      throw new WorkflowError("task_error", message);
    }
    const dumpedResult = vm.dump(resolved.value);
    resolved.value.dispose();
    if (dumpedResult === undefined) throw new WorkflowError("validation_error", "Workflow completed without a top-level return value.");
    const result = JSON.parse(ensureJsonCompatible(dumpedResult, "workflow result")) as unknown;
    return { result, agentCalls, interruptChecks, startedAt, finishedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
    for (const deferred of deferredPromises) {
      try { deferred.dispose(); } catch { /* already disposed by runtime shutdown */ }
    }
    vm.dispose();
    runtime.dispose();
  }
}
