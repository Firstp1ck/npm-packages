import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import { branchResourceDirective } from "@firstpick/pi-package-webui/lib/resource-selection.mjs";
import { applySamplingToPayload, samplingCapabilities, validateSamplingParams } from "../backend/sampling.mjs";

// Pi-side helper loaded by the Qt WebUI backend with `--extension`. It answers requests that the
// RPC protocol has no commands for: the tool and skill inventories, the active tool set, the
// skill visibility in the system prompt, and session sampling parameters. Requests arrive as
// `/qt-webui-helper {json}` prompts and every answer is one `notify` whose text starts with
// RESPONSE_PREFIX, so the backend can match it by request id without the model ever seeing it.

export const HELPER_COMMAND = "qt-webui-helper";
export const RESPONSE_PREFIX = "__QT_WEBUI_HELPER__";
const QT_RESOURCES_ENTRY_TYPE = "qt-webui-resources";
const WEBUI_TOOLS_ENTRY_TYPE = "webui-tools-config";
const WEBUI_SKILLS_ENTRY_TYPE = "webui-skills-config";
const MAX_NAMES = 512;

function nameList(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 128 || result.includes(entry)) continue;
    result.push(entry);
    if (result.length >= MAX_NAMES) break;
  }
  return result;
}

function skillsFrom(options) {
  const skills = options && Array.isArray(options.skills) ? options.skills : [];
  return skills.filter((skill) => skill && typeof skill.name === "string" && skill.name.length > 0 && skill.name.length <= 128).map((skill) => ({
    name: skill.name,
    description: typeof skill.description === "string" ? skill.description.slice(0, 128) : "",
    filePath: typeof skill.filePath === "string" ? skill.filePath.slice(0, 512) : "",
    disableModelInvocation: skill.disableModelInvocation === true,
  }));
}

function scopedModelsFrom(ctx) {
  const source = Array.isArray(ctx?.scopedModels) ? ctx.scopedModels : [];
  const items = [];
  const seen = new Set();
  let omitted = 0;
  for (const entry of source) {
    const model = entry && typeof entry === "object" ? entry.model : null;
    if (!model || typeof model.provider !== "string" || typeof model.id !== "string") continue;
    const provider = model.provider.slice(0, 64).trim();
    const id = model.id.slice(0, 128).trim();
    if (!provider || !id) continue;
    const identity = `${provider}/${id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (items.length >= MAX_NAMES) {
      omitted += 1;
      continue;
    }
    items.push({
      provider,
      id,
      thinkingLevel: typeof entry.thinkingLevel === "string" ? entry.thinkingLevel.slice(0, 32) : "",
    });
  }
  return { explicit: source.length > 0, items, omitted };
}

export default function qtWebUiHelper(pi) {
  let baselineTools = null;
  let sessionTools = null;
  let sessionSkills = null;
  let sessionSampling = {};
  let disabledSkills = new Set();
  let appliedSampling = {};

  function validatedSampling(value) {
    const { values, problems } = validateSamplingParams(value);
    if (Object.keys(problems).length > 0) throw new Error(`Invalid sampling parameters: ${Object.values(problems).join("; ")}`);
    const result = {};
    for (const [key, entry] of Object.entries(values)) if (entry !== null) result[key] = entry;
    return result;
  }

  function sessionDurability(ctx) {
    const persisted = typeof ctx?.sessionManager?.isPersisted === "function" ? ctx.sessionManager.isPersisted() : true;
    return persisted
      ? { durable: true, reason: "" }
      : { durable: false, reason: "This Pi session is ephemeral; resource overrides apply only until it ends." };
  }

  function persist(ctx, update, next) {
    const durability = sessionDurability(ctx);
    if (!durability.durable) return durability;
    if (Object.hasOwn(update, "tools")) {
      pi.appendEntry(WEBUI_TOOLS_ENTRY_TYPE, next.tools === null
        ? { version: 2, mode: "inherit" }
        : { version: 2, mode: "explicit", enabledTools: [...next.tools] });
    }
    if (Object.hasOwn(update, "skills")) {
      pi.appendEntry(WEBUI_SKILLS_ENTRY_TYPE, next.skills === null
        ? { version: 2, mode: "inherit" }
        : { version: 2, mode: "explicit", enabledSkills: [...next.skills] });
    }
    if (Object.hasOwn(update, "sampling")) {
      // Keep the version-1 Qt entry for sampling and downgrade recovery. Current Qt releases
      // ignore its tool/skill fields whenever a newer shared Web UI entry exists.
      pi.appendEntry(QT_RESOURCES_ENTRY_TYPE, { version: 1, tools: next.tools, skills: next.skills, sampling: { ...next.sampling } });
    }
    return durability;
  }

  function restore(ctx) {
    let legacy = null;
    let toolConfig = null;
    let skillConfig = null;
    try {
      for (const entry of ctx.sessionManager.getBranch()) {
        if (!entry || entry.type !== "custom" || !entry.data || typeof entry.data !== "object") continue;
        if (entry.customType === QT_RESOURCES_ENTRY_TYPE) legacy = entry.data;
        else if (entry.customType === WEBUI_TOOLS_ENTRY_TYPE) toolConfig = entry.data;
        else if (entry.customType === WEBUI_SKILLS_ENTRY_TYPE) skillConfig = entry.data;
      }
    } catch {
      legacy = null;
      toolConfig = null;
      skillConfig = null;
    }
    const knownTools = new Set(pi.getAllTools().map((tool) => tool.name));
    const knownSkills = new Set(skillsFrom(typeof ctx.getSystemPromptOptions === "function" ? ctx.getSystemPromptOptions() : null).map((skill) => skill.name));

    if (toolConfig) {
      const directive = branchResourceDirective(toolConfig, "tools");
      sessionTools = directive.pinned ? nameList(directive.names || []).filter((name) => knownTools.has(name)) : null;
    } else if (legacy) {
      sessionTools = Array.isArray(legacy.tools) ? nameList(legacy.tools).filter((name) => knownTools.has(name)) : null;
    }

    if (skillConfig) {
      const directive = branchResourceDirective(skillConfig, "skills");
      if (!directive.pinned) sessionSkills = null;
      else if (directive.legacyDisabledNames !== null) {
        const disabled = new Set(nameList(directive.legacyDisabledNames));
        sessionSkills = [...knownSkills].filter((name) => !disabled.has(name));
      } else sessionSkills = nameList(directive.names || []).filter((name) => knownSkills.has(name));
    } else if (legacy) {
      sessionSkills = Array.isArray(legacy.skills) ? nameList(legacy.skills).filter((name) => knownSkills.has(name)) : null;
    }

    if (legacy) sessionSampling = validatedSampling(legacy.sampling || {});
  }

  function currentState(ctx, durability = sessionDurability(ctx)) {
    const model = ctx.model ?? null;
    const api = model && typeof model.api === "string" ? model.api : "";
    const thinkingActive = !!(model && model.reasoning === true && typeof ctx.thinkingLevel === "string" && ctx.thinkingLevel !== "off");
    const options = typeof ctx.getSystemPromptOptions === "function" ? ctx.getSystemPromptOptions() : null;
    const allSkills = skillsFrom(options).slice(0, MAX_NAMES);
    const active = new Set(pi.getActiveTools());
    return {
      model: model ? { provider: String(model.provider || ""), id: String(model.id || ""), api } : null,
      thinkingLevel: typeof ctx.thinkingLevel === "string" ? ctx.thinkingLevel : "",
      session: {
        tools: sessionTools === null ? null : [...sessionTools],
        skills: sessionSkills === null ? null : [...sessionSkills],
        sampling: { ...sessionSampling },
        durability,
      },
      tools: {
        all: pi.getAllTools().slice(0, MAX_NAMES).filter((tool) => tool && typeof tool.name === "string" && tool.name.length > 0 && tool.name.length <= 128).map((tool) => ({ name: tool.name, description: String(tool.description || "").slice(0, 128), source: String(tool.sourceInfo?.source || "").slice(0, 128), enabled: active.has(tool.name) })),
        active: [...active],
        baseline: baselineTools ? [...baselineTools] : [],
      },
      skills: {
        all: allSkills,
        enabled: allSkills.filter((skill) => !disabledSkills.has(skill.name)).map((skill) => skill.name),
      },
      scopedModels: scopedModelsFrom(ctx),
      sampling: {
        applied: { ...appliedSampling },
        api,
        capabilities: samplingCapabilities(api, { thinkingActive }),
        thinkingActive,
      },
    };
  }

  // Session values are persisted separately from the already-resolved effective values. Skill
  // enabled-name lists are translated to Pi's internal disabled set only at this boundary.
  function apply(ctx, payload) {
    const allTools = new Set(pi.getAllTools().map((tool) => tool.name));
    const allSkills = new Set(skillsFrom(typeof ctx.getSystemPromptOptions === "function" ? ctx.getSystemPromptOptions() : null).map((skill) => skill.name));
    const sessionUpdate = payload && payload.session && typeof payload.session === "object" ? payload.session : null;
    let durability = sessionDurability(ctx);
    if (sessionUpdate) {
      const next = {
        tools: Object.hasOwn(sessionUpdate, "tools") ? (sessionUpdate.tools === null ? null : nameList(sessionUpdate.tools).filter((name) => allTools.has(name))) : sessionTools,
        skills: Object.hasOwn(sessionUpdate, "skills") ? (sessionUpdate.skills === null ? null : nameList(sessionUpdate.skills).filter((name) => allSkills.has(name))) : sessionSkills,
        sampling: Object.hasOwn(sessionUpdate, "sampling") ? validatedSampling(sessionUpdate.sampling || {}) : sessionSampling,
      };
      durability = persist(ctx, sessionUpdate, next);
      sessionTools = next.tools;
      sessionSkills = next.skills;
      sessionSampling = next.sampling;
    }
    const effective = payload && payload.effective && typeof payload.effective === "object" ? payload.effective : {};
    if (Object.hasOwn(effective, "tools")) {
      const selected = effective.tools === null ? [...(baselineTools || [])] : nameList(effective.tools);
      pi.setActiveTools(selected.filter((name) => allTools.has(name)));
    }
    if (Object.hasOwn(effective, "skills")) {
      const enabled = effective.skills === null ? allSkills : new Set(nameList(effective.skills).filter((name) => allSkills.has(name)));
      disabledSkills = new Set([...allSkills].filter((name) => !enabled.has(name)));
    }
    if (Object.hasOwn(effective, "sampling")) appliedSampling = validatedSampling(effective.sampling || {});
    return currentState(ctx, durability);
  }

  pi.registerCommand(HELPER_COMMAND, {
    description: "Internal Qt WebUI helper for tool, skill, and sampling controls",
    handler: async (args, ctx) => {
      let requestId = "";
      try {
        const request = JSON.parse(String(args || "{}"));
        requestId = typeof request.requestId === "string" ? request.requestId.slice(0, 96) : "";
        let data;
        switch (request.action) {
          case "state":
            data = currentState(ctx);
            break;
          case "apply":
            data = apply(ctx, request.payload && typeof request.payload === "object" ? request.payload : {});
            break;
          default:
            throw new Error(`Unknown ${HELPER_COMMAND} action`);
        }
        ctx.ui.notify(`${RESPONSE_PREFIX}${JSON.stringify({ requestId, ok: true, data })}`, "info");
      } catch (error) {
        ctx.ui.notify(`${RESPONSE_PREFIX}${JSON.stringify({ requestId, ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 512) })}`, "info");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!baselineTools) baselineTools = new Set(pi.getActiveTools());
    sessionTools = null;
    sessionSkills = null;
    sessionSampling = {};
    disabledSkills = new Set();
    appliedSampling = {};
    restore(ctx);
    apply(ctx, { effective: { tools: sessionTools, skills: sessionSkills, sampling: sessionSampling } });
  });

  // Disabled skills disappear from the system prompt; the section is rebuilt with Pi's own
  // formatter so the remaining skills keep their exact shape.
  pi.on("before_agent_start", async (event) => {
    if (disabledSkills.size === 0) return undefined;
    const prompt = typeof event.systemPrompt === "string" ? event.systemPrompt : "";
    const skills = skillsFrom(event.systemPromptOptions);
    if (!prompt.includes("<available_skills>") || skills.length === 0) return undefined;
    const kept = skills.filter((skill) => !disabledSkills.has(skill.name));
    const stripped = prompt.replace(/\n?\n?The following skills provide specialized instructions[\s\S]*?<\/available_skills>\n?/, "");
    return { systemPrompt: stripped + formatSkillsForPrompt(kept) };
  });

  pi.on("input", async (event, ctx) => {
    if (disabledSkills.size === 0) return { action: "continue" };
    const match = String(event.text || "").trim().match(/^\/skill:([^\s]+)/);
    if (!match || !disabledSkills.has(match[1])) return { action: "continue" };
    ctx.ui.notify(`Skill ${match[1]} is disabled in Qt WebUI`, "warning");
    return { action: "handled" };
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (Object.keys(appliedSampling).length === 0) return undefined;
    const model = ctx.model ?? null;
    const api = model && typeof model.api === "string" ? model.api : "";
    const thinkingActive = !!(model && model.reasoning === true && typeof ctx.thinkingLevel === "string" && ctx.thinkingLevel !== "off");
    return applySamplingToPayload(event.payload, api, appliedSampling, { thinkingActive });
  });
}
