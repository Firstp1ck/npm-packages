import { normalizeSubagentLaunchSlotRoles } from "./subagent-launch-slots.mjs";

const SUPPORTED_TOOLS = new Set(["subagent", "subagent_gate"]);
const WORKFLOW_WRAPPER_MARKER = "/* PI_WEBUI_SUBAGENT_LAUNCH_SLOTS_V1 */";

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function modelSpec(slot) {
  if (!slot?.model) return "";
  return slot.thinking ? `${slot.model}:${slot.thinking}` : slot.model;
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

function applyRolePreset(target, role, roles, occurrences, applied, unsupported, location) {
  if (!isRecord(target) || !Object.hasOwn(roles, role)) return;
  const index = occurrence(occurrences, role);
  const slot = roles[role][index];
  if (!slot) {
    unsupported.push({ role, occurrence: index + 1, location, reason: "slot-overflow" });
    return;
  }
  const model = modelSpec(slot);
  if (!model || hasExplicitModel(target.model)) return;
  target.model = model;
  applied.push({ role, occurrence: index + 1, slotId: slot.id, model, location });
}

function applyCountedRolePreset(target, role, count, roles, occurrences, applied, unsupported, location) {
  const start = occurrences.get(role) || 0;
  const copies = Number.isInteger(count) && count > 0 ? count : 1;
  const slots = roles[role]?.slice(start, start + copies) || [];
  occurrences.set(role, start + copies);
  if (slots.length !== copies) {
    unsupported.push({ role, occurrence: start + 1, location, reason: "slot-overflow" });
    return;
  }
  const models = [...new Set(slots.map(modelSpec).filter(Boolean))];
  if (models.length === 0 || hasExplicitModel(target.model)) return;
  if (models.length !== 1 || slots.some((slot) => !modelSpec(slot))) {
    unsupported.push({ role, occurrence: start + 1, location, reason: "count-needs-explicit-tasks" });
    return;
  }
  target.model = models[0];
  applied.push({ role, occurrence: start + 1, count: copies, slotId: slots[0].id, model: models[0], location });
}

function applyTaskList(tasks, roles, occurrences, applied, unsupported, prefix) {
  if (!Array.isArray(tasks)) return;
  for (const [index, task] of tasks.entries()) {
    const role = requestedRole(task?.agent);
    if (!role) continue;
    applyCountedRolePreset(task, role, task?.count, roles, occurrences, applied, unsupported, `${prefix}[${index}]`);
  }
}

function applyLegacyChain(chain, roles, occurrences, applied, unsupported) {
  if (!Array.isArray(chain)) return;
  for (const [stepIndex, step] of chain.entries()) {
    if (!isRecord(step)) continue;
    const role = requestedRole(step.agent);
    if (role) {
      applyRolePreset(step, role, roles, occurrences, applied, unsupported, `chain[${stepIndex}]`);
      continue;
    }
    if (Array.isArray(step.parallel)) {
      applyTaskList(step.parallel, roles, occurrences, applied, unsupported, `chain[${stepIndex}].parallel`);
      continue;
    }
    if (isRecord(step.parallel)) {
      const dynamicRole = requestedRole(step.parallel.agent);
      if (dynamicRole) unsupported.push({ role: dynamicRole, occurrence: occurrence(occurrences, dynamicRole) + 1, location: `chain[${stepIndex}].parallel`, reason: "dynamic-needs-explicit-model" });
    }
  }
}

function workflowRoleModels(roles) {
  return Object.fromEntries(Object.entries(roles).flatMap(([role, slots]) => {
    const models = slots.map((slot) => modelSpec(slot) || null);
    return models.some(Boolean) ? [[role, models]] : [];
  }));
}

function wrapWorkflowScript(script, roles) {
  if (script.includes(WORKFLOW_WRAPPER_MARKER)) return script;
  const roleModels = workflowRoleModels(roles);
  if (Object.keys(roleModels).length === 0) return script;
  return [
    WORKFLOW_WRAPPER_MARKER,
    `const __piWebuiRoleModels = ${JSON.stringify(roleModels)};`,
    "const __piWebuiRoleOccurrences = Object.create(null);",
    "const __piWebuiOriginalRuns = runs;",
    "const __piWebuiApplyModel = (params) => {",
    "  if (!params || typeof params !== 'object' || Array.isArray(params) || params.resume !== undefined || typeof params.agent !== 'string') return params;",
    "  const role = params.agent.trim();",
    "  const slots = __piWebuiRoleModels[role];",
    "  if (!slots) return params;",
    "  const index = __piWebuiRoleOccurrences[role] || 0;",
    "  __piWebuiRoleOccurrences[role] = index + 1;",
    "  const model = slots[index];",
    "  return model && !(typeof params.model === 'string' && params.model.trim()) ? { ...params, model } : params;",
    "};",
    "const __piWebuiRuns = Object.freeze({",
    "  run(key, params) { return __piWebuiOriginalRuns.run(key, __piWebuiApplyModel(params)); },",
    "  all(items) {",
    "    return __piWebuiOriginalRuns.all(items.map((item) => {",
    "      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;",
    "      const { key, ...params } = item;",
    "      return { key, ...__piWebuiApplyModel(params) };",
    "    }));",
    "  },",
    "  status(keyOrRunId) { return __piWebuiOriginalRuns.status(keyOrRunId); },",
    "  ref(result) { return __piWebuiOriginalRuns.ref(result); },",
    "  refs(results) { return __piWebuiOriginalRuns.refs(results); },",
    "});",
    "return await (async (runs) => {",
    script,
    "})(__piWebuiRuns);",
  ].join("\n");
}

/**
 * Fill omitted model fields from the active WebUI launch-slot snapshot.
 * Explicit model arguments are preserved so an explicit user request can win.
 */
export function applySubagentLaunchSlotDefaults(toolName, input, roleConfig) {
  const report = { applied: [], unsupported: [] };
  if (!SUPPORTED_TOOLS.has(toolName) || !isRecord(input)) return report;

  const roles = normalizeSubagentLaunchSlotRoles(roleConfig);
  const occurrences = new Map();

  if (toolName === "subagent_gate") {
    applyTaskList(input.tasks, roles, occurrences, report.applied, report.unsupported, "tasks");
    return report;
  }

  if (input.action !== undefined || input.resume !== undefined) return report;
  if (typeof input.workflowScript === "string" && input.workflowScript.trim()) {
    const wrapped = wrapWorkflowScript(input.workflowScript, roles);
    if (wrapped !== input.workflowScript) {
      input.workflowScript = wrapped;
      report.applied.push({ location: "workflowScript", reason: "runtime-role-defaults" });
    }
    return report;
  }

  const role = requestedRole(input.agent);
  if (role) applyRolePreset(input, role, roles, occurrences, report.applied, report.unsupported, "agent");
  applyTaskList(input.tasks, roles, occurrences, report.applied, report.unsupported, "tasks");
  applyLegacyChain(input.chain, roles, occurrences, report.applied, report.unsupported);
  return report;
}
