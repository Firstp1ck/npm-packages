import { parse } from "acorn";
import { getQuickJS } from "quickjs-emscripten";
import { WorkflowCancelledError, WorkflowError, WorkflowValidationError, errorMessage } from "./errors.ts";
import {
  DEFAULT_WORKFLOW_INSTRUCTION_LIMIT,
  DEFAULT_WORKFLOW_MEMORY_BYTES,
  DEFAULT_WORKFLOW_NESTING_DEPTH,
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

type RuntimeValidationNode = {
  type: string;
  start: number;
  end: number;
  loc?: { start?: { line?: number; column?: number } };
  [key: string]: unknown;
};

type RuntimeSourceInsertion = { offset: number; text: string };
type RuntimeCapabilityName = "phase" | "pipeline";

function runtimeLocation(node: RuntimeValidationNode): string {
  const line = node.loc?.start?.line;
  const column = node.loc?.start?.column;
  return line ? ` at ${line}:${(column ?? 0) + 1}` : "";
}

function runtimeCapabilityEscapeIssue(name: RuntimeCapabilityName, node: RuntimeValidationNode): string {
  return `${name} must be called directly; aliased or first-class references are not supported${runtimeLocation(node)}.`;
}

function isRuntimeCapabilityName(node: RuntimeValidationNode | null | undefined): node is RuntimeValidationNode & { name: RuntimeCapabilityName } {
  return node?.type === "Identifier" && (node.name === "phase" || node.name === "pipeline");
}

function isDirectRuntimeCapabilityCall(node: RuntimeValidationNode, parent: RuntimeValidationNode | null | undefined): boolean {
  return parent?.type === "CallExpression" && parent.callee === node;
}

function isNonReferenceRuntimeCapabilityPosition(node: RuntimeValidationNode, parent: RuntimeValidationNode | null | undefined): boolean {
  if (!parent) return false;
  if (parent.type === "MemberExpression") return parent.property === node && parent.computed !== true;
  if (parent.type === "Property") return parent.key === node && parent.computed !== true && parent.value !== node;
  if (parent.type === "MethodDefinition") return parent.key === node && parent.computed !== true;
  if (parent.type === "PropertyDefinition") return parent.key === node && parent.computed !== true;
  if (parent.type === "LabeledStatement") return parent.label === node;
  if (parent.type === "BreakStatement") return parent.label === node;
  if (parent.type === "ContinueStatement") return parent.label === node;
  return false;
}

function declarePatternBindings(node: RuntimeValidationNode | null | undefined, scope: Set<string>): void {
  if (!node) return;
  if (node.type === "Identifier" && typeof node.name === "string") {
    scope.add(node.name);
    return;
  }
  if (node.type === "RestElement") return declarePatternBindings(node.argument as RuntimeValidationNode | undefined, scope);
  if (node.type === "AssignmentPattern") return declarePatternBindings(node.left as RuntimeValidationNode | undefined, scope);
  if (node.type === "ArrayPattern") {
    for (const element of (node.elements as Array<RuntimeValidationNode | null> | undefined) ?? []) declarePatternBindings(element, scope);
    return;
  }
  if (node.type === "ObjectPattern") {
    for (const property of (node.properties as RuntimeValidationNode[] | undefined) ?? []) {
      if (property.type === "RestElement") declarePatternBindings(property.argument as RuntimeValidationNode | undefined, scope);
      else declarePatternBindings(property.value as RuntimeValidationNode | undefined, scope);
    }
  }
}

function visitPatternInitializers(
  node: RuntimeValidationNode | null | undefined,
  visitExpression: (node: RuntimeValidationNode | null | undefined, parent?: RuntimeValidationNode) => void,
  parent?: RuntimeValidationNode,
): void {
  if (!node || typeof node !== "object") return;
  switch (node.type) {
    case "Identifier":
      return;
    case "RestElement":
      visitPatternInitializers(node.argument as RuntimeValidationNode | undefined, visitExpression, node);
      return;
    case "AssignmentPattern":
      visitPatternInitializers(node.left as RuntimeValidationNode | undefined, visitExpression, node);
      visitExpression(node.right as RuntimeValidationNode | undefined, node);
      return;
    case "ArrayPattern":
      for (const element of (node.elements as Array<RuntimeValidationNode | null> | undefined) ?? []) {
        visitPatternInitializers(element, visitExpression, node);
      }
      return;
    case "ObjectPattern":
      for (const property of (node.properties as RuntimeValidationNode[] | undefined) ?? []) {
        if (property.type === "RestElement") {
          visitPatternInitializers(property.argument as RuntimeValidationNode | undefined, visitExpression, property);
          continue;
        }
        if (property.computed === true) visitExpression(property.key as RuntimeValidationNode | undefined, property);
        visitPatternInitializers(property.value as RuntimeValidationNode | undefined, visitExpression, property);
      }
      return;
  }
}

function prepareRuntimeCallbackBody(body: string): string {
  const program = parse(body, {
    ecmaVersion: "latest",
    sourceType: "script",
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    locations: true,
  }) as unknown as RuntimeValidationNode;
  const issues: string[] = [];
  const insertions: RuntimeSourceInsertion[] = [];
  const usedIdentifiers = new Set<string>();
  const collectIdentifiers = (node: RuntimeValidationNode | null | undefined): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "Identifier" && typeof node.name === "string") usedIdentifiers.add(node.name);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => collectIdentifiers(child as RuntimeValidationNode));
      else if (value && typeof value === "object") collectIdentifiers(value as RuntimeValidationNode);
    }
  };
  collectIdentifiers(program);
  let sequence = 0;
  const uniqueIdentifier = (label: string): string => {
    let candidate: string;
    do candidate = `__pi_workflow_${label}_${++sequence}`;
    while (usedIdentifiers.has(candidate));
    usedIdentifiers.add(candidate);
    return candidate;
  };
  const scopeStack: Set<string>[] = [];
  const visited = new WeakSet<object>();
  const pushScope = (seed: Iterable<string> = []): void => { scopeStack.push(new Set(seed)); };
  const popScope = (): void => { scopeStack.pop(); };
  const isBound = (name: string): boolean => scopeStack.some((scope) => scope.has(name));
  const lexicalBlockBindings = (node: RuntimeValidationNode): Set<string> => {
    const bindings = new Set<string>();
    for (const statement of (node.body as RuntimeValidationNode[] | undefined) ?? []) {
      if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") declarePatternBindings(statement.id as RuntimeValidationNode | undefined, bindings);
      if (statement.type === "VariableDeclaration" && statement.kind !== "var") {
        for (const declaration of (statement.declarations as RuntimeValidationNode[] | undefined) ?? []) declarePatternBindings(declaration.id as RuntimeValidationNode | undefined, bindings);
      }
    }
    return bindings;
  };
  const functionVarBindings = (node: RuntimeValidationNode): Set<string> => {
    const bindings = new Set<string>();
    const scan = (child: RuntimeValidationNode | null | undefined): void => {
      if (!child || typeof child !== "object") return;
      if (child !== node && (child.type === "FunctionDeclaration" || child.type === "FunctionExpression" || child.type === "ArrowFunctionExpression")) return;
      if (child.type === "VariableDeclaration" && child.kind === "var") {
        for (const declaration of (child.declarations as RuntimeValidationNode[] | undefined) ?? []) declarePatternBindings(declaration.id as RuntimeValidationNode | undefined, bindings);
      }
      for (const value of Object.values(child)) {
        if (Array.isArray(value)) value.forEach((item) => scan(item as RuntimeValidationNode));
        else if (value && typeof value === "object") scan(value as RuntimeValidationNode);
      }
    };
    scan(node);
    return bindings;
  };
  const visit = (node: RuntimeValidationNode | null | undefined, parent?: RuntimeValidationNode): void => {
    if (!node || typeof node !== "object") return;
    if (visited.has(node)) return;
    visited.add(node);
    switch (node.type) {
      case "Identifier":
        if (isRuntimeCapabilityName(node) && !isBound(node.name) && !isDirectRuntimeCapabilityCall(node, parent) && !isNonReferenceRuntimeCapabilityPosition(node, parent)) {
          issues.push(runtimeCapabilityEscapeIssue(node.name, node));
        }
        return;
      case "Program": {
        const bindings = lexicalBlockBindings(node);
        for (const name of functionVarBindings(node)) bindings.add(name);
        pushScope(bindings);
        for (const statement of (node.body as RuntimeValidationNode[] | undefined) ?? []) visit(statement, node);
        popScope();
        return;
      }
      case "BlockStatement": {
        pushScope(lexicalBlockBindings(node));
        for (const statement of (node.body as RuntimeValidationNode[] | undefined) ?? []) visit(statement, node);
        popScope();
        return;
      }
      case "FunctionDeclaration": {
        const parameterSeed = new Set<string>();
        const params = new Set<string>();
        declarePatternBindings(node.id as RuntimeValidationNode | undefined, parameterSeed);
        declarePatternBindings(node.id as RuntimeValidationNode | undefined, params);
        pushScope(parameterSeed);
        const visibleParams = scopeStack.at(-1)!;
        for (const param of (node.params as RuntimeValidationNode[] | undefined) ?? []) {
          visitPatternInitializers(param, visit, node);
          declarePatternBindings(param, visibleParams);
          declarePatternBindings(param, params);
        }
        popScope();
        for (const name of functionVarBindings(node.body as RuntimeValidationNode)) params.add(name);
        pushScope(params);
        visit(node.body as RuntimeValidationNode | undefined, node);
        popScope();
        return;
      }
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        const parameterSeed = new Set<string>();
        const params = new Set<string>();
        if (node.type === "FunctionExpression") {
          declarePatternBindings(node.id as RuntimeValidationNode | undefined, parameterSeed);
          declarePatternBindings(node.id as RuntimeValidationNode | undefined, params);
        }
        pushScope(parameterSeed);
        const visibleParams = scopeStack.at(-1)!;
        for (const param of (node.params as RuntimeValidationNode[] | undefined) ?? []) {
          visitPatternInitializers(param, visit, node);
          declarePatternBindings(param, visibleParams);
          declarePatternBindings(param, params);
        }
        popScope();
        if (node.body?.type === "BlockStatement") {
          for (const name of functionVarBindings(node.body as RuntimeValidationNode)) params.add(name);
        }
        pushScope(params);
        visit(node.body as RuntimeValidationNode | undefined, node);
        popScope();
        return;
      }
      case "VariableDeclarator":
        visit(node.init as RuntimeValidationNode | undefined, node);
        return;
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        const declaration = (node.init ?? node.left) as RuntimeValidationNode | undefined;
        if (declaration?.type === "VariableDeclaration" && declaration.kind !== "var") {
          pushScope();
          for (const item of (declaration.declarations as RuntimeValidationNode[] | undefined) ?? []) declarePatternBindings(item.id as RuntimeValidationNode | undefined, scopeStack.at(-1));
          visit(declaration, node);
          if (node.type === "ForStatement") {
            visit(node.test as RuntimeValidationNode | undefined, node);
            visit(node.update as RuntimeValidationNode | undefined, node);
          } else visit(node.right as RuntimeValidationNode | undefined, node);
          visit(node.body as RuntimeValidationNode | undefined, node);
          popScope();
          return;
        }
        break;
      }
      case "SwitchStatement": {
        visit(node.discriminant as RuntimeValidationNode | undefined, node);
        const bindings = new Set<string>();
        for (const branch of (node.cases as RuntimeValidationNode[] | undefined) ?? []) {
          for (const statement of (branch.consequent as RuntimeValidationNode[] | undefined) ?? []) {
            if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") declarePatternBindings(statement.id as RuntimeValidationNode | undefined, bindings);
            if (statement.type === "VariableDeclaration" && statement.kind !== "var") {
              for (const declaration of (statement.declarations as RuntimeValidationNode[] | undefined) ?? []) declarePatternBindings(declaration.id as RuntimeValidationNode | undefined, bindings);
            }
          }
        }
        pushScope(bindings);
        for (const branch of (node.cases as RuntimeValidationNode[] | undefined) ?? []) visit(branch, node);
        popScope();
        return;
      }
      case "CatchClause": {
        pushScope();
        declarePatternBindings(node.param as RuntimeValidationNode | undefined, scopeStack.at(-1));
        visit(node.body as RuntimeValidationNode | undefined, node);
        popScope();
        return;
      }
      case "CallExpression": {
        const callee = node.callee as RuntimeValidationNode | undefined;
        if (callee?.type === "Identifier" && (callee.name === "phase" || callee.name === "pipeline") && !isBound(String(callee.name))) {
          const callback = (node.arguments as RuntimeValidationNode[] | undefined)?.[1];
          const inline = callback?.type === "ArrowFunctionExpression" || callback?.type === "FunctionExpression";
          if (!inline) {
            issues.push(`${callee.name === "phase" ? "phase callback" : "pipeline worker"} must be an inline function expression or arrow function${runtimeLocation(node)}.`);
          } else {
            const api = uniqueIdentifier("api");
            // Preserve lexical bindings visible at the capability call site.
            // Destructuring every capability here would shadow e.g. an outer
            // `const agent` captured by the callback.
            const injected = ["agent", "phase", "parallel", "pipeline"].filter((name) => !isBound(name));
            const capabilities = injected.length > 0 ? `const { ${injected.join(", ")} } = ${api}; ` : "";
            if (callee.name === "phase") {
              insertions.push(
                { offset: callback.start, text: `async (${api}) => { ${capabilities}return await (` },
                { offset: callback.end, text: `)(); }` },
              );
            } else {
              const item = uniqueIdentifier("item");
              const index = uniqueIdentifier("index");
              insertions.push(
                { offset: callback.start, text: `async (${api}, ${item}, ${index}) => { ${capabilities}return await (` },
                { offset: callback.end, text: `)(${item}, ${index}); }` },
              );
            }
          }
        }
        visit(callee, node);
        for (const argument of (node.arguments as RuntimeValidationNode[] | undefined) ?? []) visit(argument, node);
        return;
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((child) => visit(child as RuntimeValidationNode, node));
      else if (value && typeof value === "object") visit(value as RuntimeValidationNode, node);
    }
  };
  visit(program);
  if (issues.length > 0) throw new WorkflowValidationError(issues);
  insertions.sort((left, right) => right.offset - left.offset);
  let transformed = body;
  for (const insertion of insertions) transformed = `${transformed.slice(0, insertion.offset)}${insertion.text}${transformed.slice(insertion.offset)}`
  return transformed;
}

function runtimeBootstrap(script: WorkflowScriptDefinition, argsJson: string, body: string): string {
  return `
"use strict";
const __hostAgent = globalThis.__pi_host_agent;
const __hostPhase = globalThis.__pi_host_phase;
const __hostPipeline = globalThis.__pi_host_pipeline;
const __hostLimit = globalThis.__pi_host_limit;
delete globalThis.__pi_host_agent;
delete globalThis.__pi_host_phase;
delete globalThis.__pi_host_pipeline;
delete globalThis.__pi_host_limit;
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
  const __maxNestingDepth = ${script.meta.pi.maxNestingDepth ?? DEFAULT_WORKFLOW_NESTING_DEPTH};
  let __pipelineSequence = 0;
  const __json = (value, label) => {
    const encoded = JSON.stringify(value === undefined ? null : value);
    if (encoded === undefined) throw new TypeError(label + " must be JSON-compatible");
    return encoded;
  };
  const __childContext = (context, values = {}) => {
    const depth = context.depth + 1;
    if (depth > __maxNestingDepth) __hostLimit("Workflow exceeded maxNestingDepth " + __maxNestingDepth + ".");
    return Object.freeze({
      phasePath: values.phasePath || context.phasePath,
      pipelineKey: values.pipelineKey === undefined ? context.pipelineKey : values.pipelineKey,
      depth,
    });
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
  const __agent = async (context, prompt, options = {}) => {
    if (typeof prompt !== "string" || !prompt.trim()) throw new TypeError("agent prompt must be a non-empty string");
    const encoded = await __hostAgent(__json({ prompt, options, phasePath: context.phasePath, pipelineKey: context.pipelineKey }, "agent request"));
    return JSON.parse(encoded);
  };
  const __phase = async (context, name, run) => {
    if (typeof name !== "string" || !name.trim()) throw new TypeError("phase name must be a non-empty string");
    if (typeof run !== "function") throw new TypeError("phase callback must be a function");
    const path = Object.freeze([...context.phasePath, name]);
    const childApi = __makeApi(__childContext(context, { phasePath: path }));
    __hostPhase(__json({ type: "start", name, path }, "phase event"));
    try {
      const value = await run(childApi);
      __hostPhase(__json({ type: "complete", name, path }, "phase event"));
      return value;
    } catch (error) {
      __hostPhase(__json({ type: "failed", name, path, error: String(error && error.message || error) }, "phase event"));
      throw error;
    }
  };
  const __parallel = async (_context, tasks, options = {}) => {
    if (!Array.isArray(tasks) || tasks.some(task => typeof task !== "function")) {
      throw new TypeError("parallel tasks must be an array of functions");
    }
    return await __mapLimited(tasks, options.concurrency || tasks.length, task => task());
  };
  const __pipeline = async (context, items, worker, options = {}) => {
    if (!Array.isArray(items)) throw new TypeError("pipeline items must be an array");
    if (typeof worker !== "function") throw new TypeError("pipeline worker must be a function");
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("pipeline options must be an object");
    if (options.key !== undefined && typeof options.key !== "function") throw new TypeError("pipeline key must be a function");
    const pipelineContext = __childContext(context);
    const pipelineId = [...context.phasePath, "pipeline-" + (++__pipelineSequence)].join("/");
    const keys = items.map((item, index) => options.key ? options.key(item, index) : String(index));
    if (keys.some(key => typeof key !== "string" || !key.trim())) throw new TypeError("pipeline keys must be non-empty strings");
    if (new Set(keys).size !== keys.length) throw new TypeError("pipeline keys must be unique within a pipeline");
    return await __mapLimited(items, options.concurrency || items.length, async (item, index) => {
      const key = keys[index];
      const pipelineKey = pipelineId + ":" + (typeof options.key === "function" ? "key:" : "index:") + key;
      const itemApi = __makeApi(Object.freeze({ ...pipelineContext, pipelineKey }));
      __hostPipeline(__json({ type: "start", pipelineId, index, key }, "pipeline event"));
      try {
        const value = await worker(itemApi, item, index);
        __hostPipeline(__json({ type: "complete", pipelineId, index, key }, "pipeline event"));
        return value;
      } catch (error) {
        __hostPipeline(__json({ type: "failed", pipelineId, index, key, error: String(error && error.message || error) }, "pipeline event"));
        throw error;
      }
    });
  };
  const __makeApi = (context) => Object.freeze({
    agent: (prompt, options) => __agent(context, prompt, options),
    phase: (name, run) => __phase(context, name, run),
    parallel: (tasks, options) => __parallel(context, tasks, options),
    pipeline: (items, worker, options) => __pipeline(context, items, worker, options),
  });
  const { agent, phase, parallel, pipeline } = __makeApi(Object.freeze({ phasePath: Object.freeze([]), pipelineKey: undefined, depth: 0 }));
  Object.freeze(agent);
  Object.freeze(phase);
  Object.freeze(parallel);
  Object.freeze(pipeline);
${body}
})()
`;
}

function normalizedAbortReason(reason: unknown): WorkflowError {
  if (reason instanceof WorkflowError) return reason;
  if (reason instanceof Error && reason.name !== "AbortError") return new WorkflowCancelledError(reason.message);
  if (typeof reason === "string" && reason.trim()) return new WorkflowCancelledError(reason);
  return new WorkflowCancelledError();
}

async function awaitWithAbort<T>(
  pending: Promise<T>,
  signal: AbortSignal,
  options: { graceMs?: number; beforeAbort?: () => Promise<void> } = {},
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    let abortTask: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      if (abortTask) clearTimeout(abortTask);
    };
    const onAbort = () => {
      if (abortTask) return;
      // Give interrupted QuickJS work a short, bounded window to surface its
      // own rejection before falling back to the host abort contract.
      abortTask = setTimeout(() => {
        void (options.beforeAbort?.() ?? Promise.resolve()).then(() => {
          if (finished) return;
          finished = true;
          cleanup();
          reject(normalizedAbortReason(signal.reason));
        });
      }, options.graceMs ?? 0);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void pending.then(
      (value) => {
        if (finished) {
          (value as { dispose?: () => void })?.dispose?.();
          return;
        }
        finished = true;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

const HOST_AGENT_ABORT_GRACE_MS = 10;
const HOST_OPERATION_SETTLE_TIMEOUT_MS = 25;

async function waitForHostOperations(operations: Set<Promise<void>>, timeoutMs = HOST_OPERATION_SETTLE_TIMEOUT_MS): Promise<void> {
  const pending = [...operations];
  if (pending.length === 0) return;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(pending),
    new Promise<void>((resolve) => { timeout = setTimeout(resolve, timeoutMs); }),
  ]);
  if (timeout) clearTimeout(timeout);
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
  const onAbort = () => controller.abort(normalizedAbortReason(options.signal?.reason));
  if (options.signal?.aborted) onAbort();
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
  const hostOperations = new Set<Promise<void>>();
  const semaphore = createSemaphore(script.meta.pi.maxConcurrency);
  const labels = new Set<string>();
  let agentCalls = 0;
  let runtimeActive = true;
  let runtimeFailure: WorkflowError | undefined;
  let abortCleanupStarted = false;

  const hostAgent = vm.newFunction("__pi_host_agent", (payloadHandle) => {
    const deferred = vm.newPromise();
    deferredPromises.push(deferred);
    const operation = (async () => {
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
        const handlerPromise = Promise.resolve(handlers.agent(request, controller.signal));
        const result = await awaitWithAbort(handlerPromise, controller.signal, { graceMs: HOST_AGENT_ABORT_GRACE_MS });
        if (!runtimeActive) return;
        const value = vm.newString(ensureJsonCompatible(result, "agent result"));
        deferred.resolve(value);
        value.dispose();
      } catch (error) {
        if (runtimeActive) {
          const value = vm.newError(errorMessage(error));
          deferred.reject(value);
          value.dispose();
        }
      } finally {
        release?.();
        if (runtimeActive) runtime.executePendingJobs();
      }
    })();
    hostOperations.add(operation);
    void operation.then(
      () => hostOperations.delete(operation),
      () => hostOperations.delete(operation),
    );
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

  const hostLimit = vm.newFunction("__pi_host_limit", (messageHandle) => {
    runtimeFailure ??= new WorkflowError("budget_exhausted", vm.getString(messageHandle));
    controller.abort(runtimeFailure);
    throw runtimeFailure;
  });
  vm.setProp(vm.global, "__pi_host_limit", hostLimit);
  hostLimit.dispose();

  try {
    if (controller.signal.aborted) throw normalizedAbortReason(controller.signal.reason);
    const argsJson = ensureJsonCompatible(args, "workflow args");
    const runtimeBody = prepareRuntimeCallbackBody(script.body);
    const evaluation = vm.evalCode(runtimeBootstrap(script, argsJson, runtimeBody), script.meta.name, { type: "global" });
    if (evaluation.error) {
      const dumped = vm.dump(evaluation.error) as { name?: string; message?: string; stack?: string } | string;
      evaluation.error.dispose();
      const message = typeof dumped === "string" ? dumped : dumped.message || dumped.stack || dumped.name || "Workflow script evaluation failed.";
      if (runtimeFailure) throw runtimeFailure;
      if (controller.signal.aborted) throw normalizedAbortReason(controller.signal.reason);
      throw new WorkflowError("validation_error", message);
    }

    const promiseHandle = evaluation.value;
    const resolvedPromise = vm.resolvePromise(promiseHandle);
    promiseHandle.dispose();
    runtime.executePendingJobs();
    const resolved = await awaitWithAbort(resolvedPromise, controller.signal, {
      beforeAbort: async () => {
        abortCleanupStarted = true;
        await waitForHostOperations(hostOperations);
      },
    });
    if (resolved.error) {
      const dumped = vm.dump(resolved.error) as { name?: string; message?: string; stack?: string } | string;
      resolved.error.dispose();
      const message = typeof dumped === "string" ? dumped : dumped.message || dumped.stack || dumped.name || "Workflow script failed.";
      if (runtimeFailure) throw runtimeFailure;
      if (controller.signal.aborted) throw normalizedAbortReason(controller.signal.reason);
      if (message === `Workflow exceeded maxNestingDepth ${script.meta.pi.maxNestingDepth}.`) {
        throw new WorkflowError("budget_exhausted", message);
      }
      throw new WorkflowError("task_error", message);
    }
    // A script may call agent() without awaiting it. Do not report a completed
    // workflow while its host-side work can still mutate run state.
    if (hostOperations.size > 0) {
      runtimeFailure = new WorkflowError("task_error", "Workflow completed while host agent operations remain outstanding.");
      controller.abort(runtimeFailure);
      abortCleanupStarted = true;
      await waitForHostOperations(hostOperations);
      throw runtimeFailure;
    }
    const dumpedResult = vm.dump(resolved.value);
    resolved.value.dispose();
    if (runtimeFailure) throw runtimeFailure;
    if (controller.signal.aborted) throw normalizedAbortReason(controller.signal.reason);
    if (dumpedResult === undefined) throw new WorkflowError("validation_error", "Workflow completed without a top-level return value.");
    const result = JSON.parse(ensureJsonCompatible(dumpedResult, "workflow result")) as unknown;
    return { result, agentCalls, interruptChecks, startedAt, finishedAt: new Date().toISOString() };
  } finally {
    if (!abortCleanupStarted) await waitForHostOperations(hostOperations);
    runtimeActive = false;
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
    for (const deferred of deferredPromises) {
      try { deferred.dispose(); } catch { /* already disposed by runtime shutdown */ }
    }
    vm.dispose();
    runtime.dispose();
  }
}
