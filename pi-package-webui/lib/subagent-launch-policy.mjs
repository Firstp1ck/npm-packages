import {
  normalizeSubagentLaunchSlotRoles,
  SUBAGENT_LAUNCH_SLOT_THINKING_LEVELS,
} from "./subagent-launch-slots.mjs";

const SUPPORTED_TOOLS = new Set(["subagent", "subagent_gate"]);
const WORKFLOW_WRAPPER_MARKER = "/* PI_WEBUI_SUBAGENT_LAUNCH_SLOTS_V1 */";
const WRAPPED_WORKFLOW_INPUTS = new WeakSet();
const REVIEWER_ROLE = "reviewer";
const MAX_DEVIATIONS = 8;
const MAX_DEVIATION_ID_LENGTH = 160;
const MAX_REQUESTED_MODEL_LENGTH = 280;
const THINKING_LEVELS = new Set(SUBAGENT_LAUNCH_SLOT_THINKING_LEVELS);
const THINKING_SUFFIX_PATTERN = new RegExp(`:(${SUBAGENT_LAUNCH_SLOT_THINKING_LEVELS.join("|")})$`, "i");

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function modelSpec(slot) {
  if (!slot?.model) return "";
  return slot.thinking ? `${slot.model}:${slot.thinking}` : slot.model;
}

function parseModelSpec(value) {
  const requestedModel = typeof value === "string" ? value.trim() : "";
  const match = requestedModel.match(THINKING_SUFFIX_PATTERN);
  if (!match || !THINKING_LEVELS.has(match[1].toLowerCase())) {
    return { requestedModel, model: requestedModel, thinking: null };
  }
  return {
    requestedModel,
    model: requestedModel.slice(0, -match[0].length),
    thinking: match[1],
  };
}

function requestedRole(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasExplicitModel(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function occurrence(map, role) {
  const index = map.get(role) || 0;
  map.set(role, index + 1);
  return index;
}

function boundedDeviations(value) {
  if (!Array.isArray(value)) return [];
  const deviations = [];
  const seenIds = new Set();
  for (const item of value.slice(0, MAX_DEVIATIONS)) {
    if (!isRecord(item)
      || typeof item.id !== "string"
      || item.id.length === 0
      || item.id.length > MAX_DEVIATION_ID_LENGTH
      || item.role !== REVIEWER_ROLE
      || !Number.isInteger(item.occurrence)
      || item.occurrence < 1
      || item.occurrence > MAX_DEVIATIONS
      || typeof item.requestedModel !== "string"
      || item.requestedModel.length === 0
      || item.requestedModel.length > MAX_REQUESTED_MODEL_LENGTH
      || item.requestedModel.trim() !== item.requestedModel
      || !Number.isSafeInteger(item.expiresAt)
      || item.expiresAt <= 0
      || seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    deviations.push({
      id: item.id,
      role: REVIEWER_ROLE,
      occurrence: item.occurrence,
      requestedModel: item.requestedModel,
      expiresAt: item.expiresAt,
    });
  }
  return deviations;
}

function reviewerMismatch(slot, requested, occurrenceNumber, location) {
  const expected = parseModelSpec(modelSpec(slot));
  if (!expected.requestedModel || expected.requestedModel === requested.requestedModel) return null;
  const code = expected.model !== requested.model
    ? "reviewer-model-mismatch"
    : "reviewer-thinking-mismatch";
  return {
    code,
    role: REVIEWER_ROLE,
    occurrence: occurrenceNumber,
    location,
    slotId: slot.id,
    expectedModel: expected.requestedModel,
    requestedModel: requested.requestedModel,
    correctionModel: expected.requestedModel,
  };
}

function matchingDeviationIndex(deviations, consumedIndexes, occurrenceNumber, requestedModel, now = Date.now()) {
  return deviations.findIndex((deviation, index) => !consumedIndexes.has(index)
    && deviation.expiresAt > now
    && deviation.occurrence === occurrenceNumber
    && deviation.requestedModel === requestedModel);
}

function enforceReviewerModel(target, role, slot, occurrenceNumber, location, policy) {
  if (role !== REVIEWER_ROLE || !slot?.model || !hasExplicitModel(target.model)) return;
  const requested = parseModelSpec(target.model);
  const decision = reviewerMismatch(slot, requested, occurrenceNumber, location);
  if (!decision) return;
  const deviationIndex = matchingDeviationIndex(
    policy.deviations,
    policy.consumedDeviationIndexes,
    occurrenceNumber,
    requested.requestedModel,
  );
  if (deviationIndex >= 0) {
    policy.consumedDeviationIndexes.add(deviationIndex);
    const id = policy.deviations[deviationIndex].id;
    if (!policy.report.consumedDeviationIds.includes(id)) policy.report.consumedDeviationIds.push(id);
    return;
  }
  policy.report.blocked.push(decision);
}

function applyRolePreset(target, role, roles, occurrences, report, location, policy) {
  if (!isRecord(target) || !Object.hasOwn(roles, role)) return;
  const index = occurrence(occurrences, role);
  const slot = roles[role][index];
  if (!slot) {
    report.unsupported.push({ role, occurrence: index + 1, location, reason: "slot-overflow" });
    return;
  }
  const model = modelSpec(slot);
  enforceReviewerModel(target, role, slot, index + 1, location, policy);
  if (!model || hasExplicitModel(target.model)) return;
  target.model = model;
  report.applied.push({ role, occurrence: index + 1, slotId: slot.id, model, location });
}

function applyCountedRolePreset(target, role, count, roles, occurrences, report, location, policy) {
  const start = occurrences.get(role) || 0;
  const copies = Number.isInteger(count) && count > 0 ? count : 1;
  const slots = roles[role]?.slice(start, start + copies) || [];
  occurrences.set(role, start + copies);
  if (slots.length !== copies) {
    report.unsupported.push({ role, occurrence: start + 1, location, reason: "slot-overflow" });
  }
  if (hasExplicitModel(target.model)) {
    for (const [offset, slot] of slots.entries()) {
      enforceReviewerModel(target, role, slot, start + offset + 1, location, policy);
    }
    return;
  }
  if (slots.length !== copies) return;
  const models = [...new Set(slots.map(modelSpec).filter(Boolean))];
  if (models.length === 0) return;
  if (models.length !== 1 || slots.some((slot) => !modelSpec(slot))) {
    report.unsupported.push({ role, occurrence: start + 1, location, reason: "count-needs-explicit-tasks" });
    return;
  }
  target.model = models[0];
  report.applied.push({ role, occurrence: start + 1, count: copies, slotId: slots[0].id, model: models[0], location });
}

function applyTaskList(tasks, roles, occurrences, report, prefix, policy) {
  if (!Array.isArray(tasks)) return;
  for (const [index, task] of tasks.entries()) {
    const role = requestedRole(task?.agent);
    if (!role) continue;
    applyCountedRolePreset(task, role, task?.count, roles, occurrences, report, `${prefix}[${index}]`, policy);
  }
}

function applyLegacyChain(chain, roles, occurrences, report, policy) {
  if (!Array.isArray(chain)) return;
  for (const [stepIndex, step] of chain.entries()) {
    if (!isRecord(step)) continue;
    const role = requestedRole(step.agent);
    if (role) {
      applyRolePreset(step, role, roles, occurrences, report, `chain[${stepIndex}]`, policy);
      continue;
    }
    if (Array.isArray(step.parallel)) {
      applyTaskList(step.parallel, roles, occurrences, report, `chain[${stepIndex}].parallel`, policy);
      continue;
    }
    if (isRecord(step.parallel)) {
      const dynamicRole = requestedRole(step.parallel.agent);
      if (dynamicRole) report.unsupported.push({ role: dynamicRole, occurrence: occurrence(occurrences, dynamicRole) + 1, location: `chain[${stepIndex}].parallel`, reason: "dynamic-needs-explicit-model" });
    }
  }
}

function workflowRoleSlots(roles) {
  return Object.fromEntries(Object.entries(roles).flatMap(([role, slots]) => {
    const values = slots.map((slot) => ({ id: slot.id, model: modelSpec(slot) || null }));
    return values.some((slot) => slot.model) ? [[role, values]] : [];
  }));
}

function wrapWorkflowScript(script, roles, deviations) {
  const roleSlots = workflowRoleSlots(roles);
  if (Object.keys(roleSlots).length === 0) return script;
  return [
    WORKFLOW_WRAPPER_MARKER,
    "runs = ((__piWebuiOriginalRuns) => {",
    "  const __piWebuiArrayIsArray = Array.isArray;",
    "  const __piWebuiCreateRecord = Object.create;",
    "  const __piWebuiDefineProperty = Object.defineProperty;",
    "  const __piWebuiSetPrototypeOf = Object.setPrototypeOf;",
    "  const __piWebuiHasOwn = Object.hasOwn;",
    "  const __piWebuiError = Error;",
    "  const __piWebuiTrim = Function.call.bind(String.prototype.trim);",
    "  const __piWebuiSlice = Function.call.bind(String.prototype.slice);",
    "  const __piWebuiRegExpExec = Function.call.bind(RegExp.prototype.exec);",
    `  const __piWebuiRoleSlots = ${JSON.stringify(roleSlots)};`,
    "  __piWebuiSetPrototypeOf(__piWebuiRoleSlots, null);",
    `  const __piWebuiDeviations = ${JSON.stringify(deviations)};`,
    `  const __piWebuiThinkingPattern = ${THINKING_SUFFIX_PATTERN.toString()};`,
    "  const __piWebuiNow = Date.now.bind(Date);",
    "  const __piWebuiRoleOccurrences = __piWebuiCreateRecord(null);",
    "  const __piWebuiConsumedDeviationIndexes = __piWebuiCreateRecord(null);",
    "  const __piWebuiOriginalRun = __piWebuiOriginalRuns.run.bind(__piWebuiOriginalRuns);",
    "  const __piWebuiOriginalAll = __piWebuiOriginalRuns.all.bind(__piWebuiOriginalRuns);",
    "  const __piWebuiOriginalStatus = __piWebuiOriginalRuns.status.bind(__piWebuiOriginalRuns);",
    "  const __piWebuiOriginalRef = __piWebuiOriginalRuns.ref.bind(__piWebuiOriginalRuns);",
    "  const __piWebuiOriginalRefs = __piWebuiOriginalRuns.refs.bind(__piWebuiOriginalRuns);",
    "  const __piWebuiSnapshotRecord = (value) => {",
    "    if (!value || typeof value !== 'object' || __piWebuiArrayIsArray(value)) return value;",
    "    const snapshot = { ...value };",
    "    __piWebuiSetPrototypeOf(snapshot, null);",
    "    return snapshot;",
    "  };",
    "  const __piWebuiCloneRecord = (source) => {",
    "    const clone = __piWebuiCreateRecord(null);",
    "    for (const key in source) clone[key] = source[key];",
    "    return clone;",
    "  };",
    "  const __piWebuiCommitRecord = (target, source) => {",
    "    for (const key in source) target[key] = source[key];",
    "  };",
    "  const __piWebuiParseModel = (value) => {",
    "    const requestedModel = typeof value === 'string' ? __piWebuiTrim(value) : '';",
    "    const match = __piWebuiRegExpExec(__piWebuiThinkingPattern, requestedModel);",
    "    return match ? { requestedModel, model: __piWebuiSlice(requestedModel, 0, -match[0].length), thinking: match[1] } : { requestedModel, model: requestedModel, thinking: null };",
    "  };",
    "  const __piWebuiPrepare = (params, location, occurrences, consumedDeviationIndexes, decisions) => {",
    "    if (!params || typeof params !== 'object' || __piWebuiArrayIsArray(params) || params.resume !== undefined || typeof params.agent !== 'string') return params;",
    "    const role = __piWebuiTrim(params.agent);",
    "    const slots = __piWebuiRoleSlots[role];",
    "    if (!slots) return params;",
    "    const index = occurrences[role] || 0;",
    "    occurrences[role] = index + 1;",
    "    const slot = __piWebuiHasOwn(slots, index) ? slots[index] : undefined;",
    "    if (!slot || !slot.model) return params;",
    "    const modelValue = params.model;",
    "    const explicit = typeof modelValue === 'string' ? __piWebuiTrim(modelValue) : '';",
    "    if (!explicit) {",
    "      __piWebuiDefineProperty(params, 'model', { value: slot.model, writable: true, enumerable: true, configurable: true });",
    "      return params;",
    "    }",
    `    if (role !== ${JSON.stringify(REVIEWER_ROLE)}) return params;`,
    "    const expected = __piWebuiParseModel(slot.model);",
    "    const requested = __piWebuiParseModel(explicit);",
    "    if (expected.requestedModel === requested.requestedModel) return params;",
    "    const now = __piWebuiNow();",
    "    let deviationIndex = -1;",
    "    for (let candidateIndex = 0; candidateIndex < __piWebuiDeviations.length; candidateIndex += 1) {",
    "      const deviation = __piWebuiDeviations[candidateIndex];",
    "      if (consumedDeviationIndexes[candidateIndex] !== true && deviation.expiresAt > now && deviation.occurrence === index + 1 && deviation.requestedModel === requested.requestedModel) {",
    "        deviationIndex = candidateIndex;",
    "        break;",
    "      }",
    "    }",
    "    if (deviationIndex >= 0) { consumedDeviationIndexes[deviationIndex] = true; return params; }",
    "    __piWebuiDefineProperty(decisions, decisions.length, {",
    "      value: {",
    "        code: expected.model !== requested.model ? 'reviewer-model-mismatch' : 'reviewer-thinking-mismatch',",
    "        role, occurrence: index + 1, location, slotId: slot.id, expectedModel: expected.requestedModel, requestedModel: requested.requestedModel, correctionModel: expected.requestedModel,",
    "      },",
    "      writable: true, enumerable: true, configurable: true,",
    "    });",
    "    return params;",
    "  };",
    "  const __piWebuiThrowBlocked = (decisions) => {",
    "    const error = new __piWebuiError('Reviewer model policy blocked the requested workflow launch.');",
    "    __piWebuiDefineProperty(error, 'code', { value: 'reviewer-model-policy-blocked', writable: true, enumerable: true, configurable: true });",
    "    __piWebuiDefineProperty(error, 'decisions', { value: decisions, writable: true, enumerable: true, configurable: true });",
    "    throw error;",
    "  };",
    "  const __piWebuiRuns = Object.freeze({",
    "    run(key, params) {",
    "      const prepared = __piWebuiSnapshotRecord(params);",
    "      const occurrences = __piWebuiCloneRecord(__piWebuiRoleOccurrences);",
    "      const consumed = __piWebuiCloneRecord(__piWebuiConsumedDeviationIndexes);",
    "      const decisions = [];",
    "      __piWebuiPrepare(prepared, 'runs.run', occurrences, consumed, decisions);",
    "      if (decisions.length) return __piWebuiThrowBlocked(decisions);",
    "      const result = __piWebuiOriginalRun(key, prepared);",
    "      __piWebuiCommitRecord(__piWebuiRoleOccurrences, occurrences);",
    "      __piWebuiCommitRecord(__piWebuiConsumedDeviationIndexes, consumed);",
    "      return result;",
    "    },",
    "    all(items) {",
    "      if (!__piWebuiArrayIsArray(items)) return __piWebuiOriginalAll(items);",
    "      const itemCount = items.length;",
    "      const prepared = [];",
    "      prepared.length = itemCount;",
    "      for (let index = 0; index < itemCount; index += 1) {",
    "        if (__piWebuiHasOwn(items, index)) {",
    "          __piWebuiDefineProperty(prepared, index, { value: __piWebuiSnapshotRecord(items[index]), writable: true, enumerable: true, configurable: true });",
    "        }",
    "      }",
    "      const occurrences = __piWebuiCloneRecord(__piWebuiRoleOccurrences);",
    "      const consumed = __piWebuiCloneRecord(__piWebuiConsumedDeviationIndexes);",
    "      const decisions = [];",
    "      for (let index = 0; index < itemCount; index += 1) {",
    "        if (__piWebuiHasOwn(prepared, index)) __piWebuiPrepare(prepared[index], `runs.all[${index}]`, occurrences, consumed, decisions);",
    "      }",
    "      if (decisions.length) return __piWebuiThrowBlocked(decisions);",
    "      const result = __piWebuiOriginalAll(prepared);",
    "      __piWebuiCommitRecord(__piWebuiRoleOccurrences, occurrences);",
    "      __piWebuiCommitRecord(__piWebuiConsumedDeviationIndexes, consumed);",
    "      return result;",
    "    },",
    "    status(keyOrRunId) { return __piWebuiOriginalStatus(keyOrRunId); },",
    "    ref(result) { return __piWebuiOriginalRef(result); },",
    "    refs(results) { return __piWebuiOriginalRefs(results); },",
    "  });",
    "  return __piWebuiRuns;",
    "})(runs);",
    script,
  ].join("\n");
}

/**
 * Fill omitted model fields and report explicit reviewer model policy decisions.
 * Deviation descriptors are caller-owned, capped, and matched once per invocation.
 */
export function applySubagentLaunchSlotDefaults(toolName, input, roleConfig, options = {}) {
  const report = { applied: [], unsupported: [], blocked: [], consumedDeviationIds: [] };
  if (!SUPPORTED_TOOLS.has(toolName) || !isRecord(input)) return report;

  const roles = normalizeSubagentLaunchSlotRoles(roleConfig);
  const occurrences = new Map();
  const deviations = boundedDeviations(options?.deviations);
  const policy = { deviations, consumedDeviationIndexes: new Set(), report };

  if (toolName === "subagent_gate") {
    applyTaskList(input.tasks, roles, occurrences, report, "tasks", policy);
    return report;
  }

  if (input.action !== undefined || input.resume !== undefined) return report;
  if (typeof input.workflowScript === "string" && input.workflowScript.trim()) {
    if (WRAPPED_WORKFLOW_INPUTS.has(input)) return report;
    const wrapped = wrapWorkflowScript(input.workflowScript, roles, deviations);
    if (wrapped !== input.workflowScript) {
      input.workflowScript = wrapped;
      WRAPPED_WORKFLOW_INPUTS.add(input);
      report.applied.push({ location: "workflowScript", reason: "runtime-role-defaults" });
    }
    return report;
  }

  const role = requestedRole(input.agent);
  if (role) applyRolePreset(input, role, roles, occurrences, report, "agent", policy);
  applyTaskList(input.tasks, roles, occurrences, report, "tasks", policy);
  applyLegacyChain(input.chain, roles, occurrences, report, policy);
  return report;
}
