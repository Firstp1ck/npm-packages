import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import { applySamplingToPayload, samplingCapabilities, validateSamplingParams } from "../backend/sampling.mjs";

// Pi-side helper loaded by the Qt WebUI backend with `--extension`. It answers requests that the
// RPC protocol has no commands for: the tool and skill inventories, the active tool set, the
// skill visibility in the system prompt, and session sampling parameters. Requests arrive as
// `/qt-webui-helper {json}` prompts and every answer is one `notify` whose text starts with
// RESPONSE_PREFIX, so the backend can match it by request id without the model ever seeing it.

export const HELPER_COMMAND = "qt-webui-helper";
export const RESPONSE_PREFIX = "__QT_WEBUI_HELPER__";
const ENTRY_TYPE = "qt-webui-resources";
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
  return skills.filter((skill) => skill && typeof skill.name === "string").map((skill) => ({
    name: skill.name,
    description: typeof skill.description === "string" ? skill.description.slice(0, 256) : "",
    filePath: typeof skill.filePath === "string" ? skill.filePath : "",
    disableModelInvocation: skill.disableModelInvocation === true,
  }));
}

export default function qtWebUiHelper(pi) {
  let baselineTools = null; // the active tools before Qt WebUI changed anything
  let disabledSkills = new Set();
  let sessionSampling = {};
  let toolsPinned = false;

  function persist(ctx) {
    try {
      pi.appendEntry(ENTRY_TYPE, { version: 1, tools: toolsPinned ? pi.getActiveTools() : null, disabledSkills: [...disabledSkills], sampling: { ...sessionSampling } });
    } catch {
      // Ephemeral sessions cannot persist; the in-memory state still applies.
    }
  }

  function restore(ctx) {
    let saved = null;
    try {
      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry && entry.type === "custom" && entry.customType === ENTRY_TYPE && entry.data && typeof entry.data === "object") saved = entry.data;
      }
    } catch {
      saved = null;
    }
    if (!saved) return;
    disabledSkills = new Set(nameList(saved.disabledSkills));
    sessionSampling = validateSamplingParams(saved.sampling).values;
    for (const key of Object.keys(sessionSampling)) if (sessionSampling[key] === null) delete sessionSampling[key];
    if (Array.isArray(saved.tools)) {
      const known = new Set(pi.getAllTools().map((tool) => tool.name));
      pi.setActiveTools(nameList(saved.tools).filter((name) => known.has(name)));
      toolsPinned = true;
    }
  }

  function currentState(ctx) {
    const model = ctx.model ?? null;
    const api = model && typeof model.api === "string" ? model.api : "";
    const thinkingActive = !!(model && model.reasoning === true && typeof ctx.thinkingLevel === "string" && ctx.thinkingLevel !== "off");
    const options = typeof ctx.getSystemPromptOptions === "function" ? ctx.getSystemPromptOptions() : null;
    const active = new Set(pi.getActiveTools());
    return {
      model: model ? { provider: model.provider, id: model.id, api } : null,
      thinkingLevel: typeof ctx.thinkingLevel === "string" ? ctx.thinkingLevel : "",
      tools: {
        all: pi.getAllTools().slice(0, MAX_NAMES).map((tool) => ({ name: tool.name, description: String(tool.description || "").slice(0, 256), source: String(tool.sourceInfo?.source || ""), enabled: active.has(tool.name) })),
        active: [...active],
        baseline: baselineTools ? [...baselineTools] : [],
        pinned: toolsPinned,
      },
      skills: {
        all: skillsFrom(options).slice(0, MAX_NAMES),
        disabled: [...disabledSkills],
      },
      sampling: {
        session: { ...sessionSampling },
        api,
        capabilities: samplingCapabilities(api, { thinkingActive }),
        thinkingActive,
      },
    };
  }

  // payload: { tools?: string[] | null, skills?: { disabled: string[] } | null, sampling?: object | null }
  function apply(ctx, payload) {
    if (payload && Object.hasOwn(payload, "tools")) {
      const known = new Set(pi.getAllTools().map((tool) => tool.name));
      if (payload.tools === null) {
        if (baselineTools) pi.setActiveTools([...baselineTools].filter((name) => known.has(name)));
        toolsPinned = false;
      } else {
        pi.setActiveTools(nameList(payload.tools).filter((name) => known.has(name)));
        toolsPinned = true;
      }
    }
    if (payload && Object.hasOwn(payload, "skills")) {
      disabledSkills = payload.skills && typeof payload.skills === "object" ? new Set(nameList(payload.skills.disabled)) : new Set();
    }
    if (payload && Object.hasOwn(payload, "sampling")) {
      if (payload.sampling === null) sessionSampling = {};
      else {
        const { values, problems } = validateSamplingParams(payload.sampling);
        if (Object.keys(problems).length > 0) throw new Error(`Invalid sampling parameters: ${Object.values(problems).join("; ")}`);
        const next = {};
        for (const [key, value] of Object.entries(values)) if (value !== null) next[key] = value;
        sessionSampling = next;
      }
    }
    persist(ctx);
    return currentState(ctx);
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
    disabledSkills = new Set();
    sessionSampling = {};
    toolsPinned = false;
    restore(ctx);
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
    if (Object.keys(sessionSampling).length === 0) return undefined;
    const model = ctx.model ?? null;
    const api = model && typeof model.api === "string" ? model.api : "";
    const thinkingActive = !!(model && model.reasoning === true && typeof ctx.thinkingLevel === "string" && ctx.thinkingLevel !== "off");
    return applySamplingToPayload(event.payload, api, sessionSampling, { thinkingActive });
  });
}
