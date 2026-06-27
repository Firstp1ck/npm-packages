import { AgentSession, formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";

const HELPER_COMMAND = "webui-helper";
const RESPONSE_PREFIX = "__PI_WEBUI_HELPER_RESPONSE__:";
const TOOLS_CONFIG_TYPE = "webui-tools-config";
const SKILLS_CONFIG_TYPE = "webui-skills-config";
const APP_RUNNER_CONTEXT_TYPE = "webui-app-runner-output";

const ACTIVE_COMMAND_SESSION_KEY = Symbol.for("pi.webui.helper.activeCommandSession");

function activeCommandSession() {
  return globalThis[ACTIVE_COMMAND_SESSION_KEY];
}

function setActiveCommandSession(session) {
  if (session) globalThis[ACTIVE_COMMAND_SESSION_KEY] = session;
  else delete globalThis[ACTIVE_COMMAND_SESSION_KEY];
}

function installActiveCommandSessionCapture() {
  const proto = AgentSession?.prototype;
  if (!proto || proto.__webuiHelperCommandSessionCaptureInstalled) return;
  const original = proto._tryExecuteExtensionCommand;
  if (typeof original !== "function") return;
  Object.defineProperty(proto, "__webuiHelperCommandSessionCaptureInstalled", { value: true });
  proto._tryExecuteExtensionCommand = async function webuiHelperTryExecuteExtensionCommand(...args) {
    const previous = activeCommandSession();
    setActiveCommandSession(this);
    try {
      return await original.apply(this, args);
    } finally {
      setActiveCommandSession(previous);
    }
  };
}

installActiveCommandSessionCapture();

function responseMessage(payload) {
  return `${RESPONSE_PREFIX}${JSON.stringify(payload)}`;
}

function safeSourceInfo(sourceInfo) {
  if (!sourceInfo || typeof sourceInfo !== "object") return undefined;
  return {
    path: typeof sourceInfo.path === "string" ? sourceInfo.path : undefined,
    source: typeof sourceInfo.source === "string" ? sourceInfo.source : undefined,
    scope: typeof sourceInfo.scope === "string" ? sourceInfo.scope : undefined,
    origin: typeof sourceInfo.origin === "string" ? sourceInfo.origin : undefined,
    baseDir: typeof sourceInfo.baseDir === "string" ? sourceInfo.baseDir : undefined,
  };
}

function lastBranchConfig(ctx, customType) {
  let found;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry?.type === "custom" && entry.customType === customType && entry.data && typeof entry.data === "object") {
      found = entry.data;
    }
  }
  return found;
}

function normalizeNameList(value) {
  if (!Array.isArray(value)) return [];
  const names = [];
  const seen = new Set();
  for (const item of value) {
    const name = String(item || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function queueMessageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text").map((part) => String(part.text || "")).join("\n");
}

function queuedMessagesSnapshot(session) {
  return {
    steering: Array.from(session?.getSteeringMessages?.() || []).map((item) => String(item || "")).filter((item) => item.trim()),
    followUp: Array.from(session?.getFollowUpMessages?.() || []).map((item) => String(item || "")).filter((item) => item.trim()),
  };
}

function normalizeQueueKind(value) {
  const normalized = String(value || "").trim();
  if (normalized === "follow-up" || normalized.toLowerCase() === "followup") return "followUp";
  if (normalized === "steer") return "steering";
  if (normalized === "steering" || normalized === "followUp") return normalized;
  throw new Error("Queue removal requires kind 'followUp' or 'steering'");
}

function removeQueuedPrompt(payload = {}) {
  const session = activeCommandSession();
  if (!session) throw new Error("Web UI queue removal is unavailable in this Pi version; reload this tab and retry.");
  const kind = normalizeQueueKind(payload.kind || "followUp");
  const index = Number.parseInt(String(payload.index ?? ""), 10);
  if (!Number.isInteger(index) || index < 0) throw new Error("Queue removal requires a zero-based item index");
  const expectedText = String(payload.message ?? payload.text ?? "");
  const tracked = kind === "followUp" ? session._followUpMessages : session._steeringMessages;
  const agentQueue = kind === "followUp" ? session.agent?.followUpQueue : session.agent?.steeringQueue;
  if (!Array.isArray(tracked) || !Array.isArray(agentQueue?.messages)) {
    throw new Error("Web UI queue removal is not supported by this Pi runtime.");
  }
  const currentText = String(tracked[index] || "");
  const agentText = queueMessageText(agentQueue.messages[index]);
  if (!currentText || (expectedText && currentText !== expectedText) || (expectedText && agentText !== expectedText)) {
    return { removed: false, reason: "queue-changed", queue: queuedMessagesSnapshot(session) };
  }
  tracked.splice(index, 1);
  agentQueue.messages.splice(index, 1);
  session._emitQueueUpdate?.();
  return { removed: true, kind, index, message: currentText, queue: queuedMessagesSnapshot(session) };
}

function parseHelperArgs(args) {
  let parsed;
  try {
    parsed = JSON.parse(args || "{}");
  } catch (error) {
    throw new Error(`Invalid ${HELPER_COMMAND} payload: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error(`${HELPER_COMMAND} payload must be an object`);
  const requestId = String(parsed.requestId || "").trim();
  const action = String(parsed.action || "").trim();
  if (!requestId) throw new Error(`${HELPER_COMMAND} payload requires requestId`);
  if (!action) throw new Error(`${HELPER_COMMAND} payload requires action`);
  return { requestId, action, payload: parsed.payload && typeof parsed.payload === "object" ? parsed.payload : {} };
}

function skillBlockPattern(name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\n?  <skill>\\n    <name>${escaped}<\\/name>[\\s\\S]*?  <\\/skill>`, "g");
}

function replaceAvailableSkillsSection(systemPrompt, skills) {
  const nextSection = formatSkillsForPrompt(skills);
  const replacement = nextSection ? `\n${nextSection}\n` : "\n";
  if (systemPrompt.includes("<available_skills>")) {
    return systemPrompt.replace(/\n?The following skills provide[\s\S]*?<\/available_skills>\n?/m, replacement);
  }
  return systemPrompt;
}

export default function webuiRpcHelper(pi) {
  let enabledTools = new Set();
  let disabledSkills = new Set();

  function allToolNames() {
    return pi.getAllTools().map((tool) => tool.name);
  }

  function persistToolsState() {
    pi.appendEntry(TOOLS_CONFIG_TYPE, { enabledTools: [...enabledTools] });
  }

  function applyTools() {
    const existing = new Set(allToolNames());
    pi.setActiveTools([...enabledTools].filter((name) => existing.has(name)));
  }

  function restoreToolsFromBranch(ctx) {
    const saved = lastBranchConfig(ctx, TOOLS_CONFIG_TYPE)?.enabledTools;
    if (Array.isArray(saved)) {
      const existing = new Set(allToolNames());
      enabledTools = new Set(normalizeNameList(saved).filter((name) => existing.has(name)));
      applyTools();
      return;
    }
    enabledTools = new Set(pi.getActiveTools());
  }

  function toolState() {
    const active = new Set(pi.getActiveTools());
    enabledTools = new Set([...active]);
    return {
      tools: pi.getAllTools().map((tool) => ({
        name: tool.name,
        description: tool.description || "",
        enabled: active.has(tool.name),
        sourceInfo: safeSourceInfo(tool.sourceInfo),
      })),
    };
  }

  function setToolState(payload) {
    const existing = new Set(allToolNames());
    if (Array.isArray(payload.enabledTools)) {
      enabledTools = new Set(normalizeNameList(payload.enabledTools).filter((name) => existing.has(name)));
    } else if (Array.isArray(payload.disabledTools)) {
      const disabled = new Set(normalizeNameList(payload.disabledTools));
      enabledTools = new Set([...existing].filter((name) => !disabled.has(name)));
    } else {
      throw new Error("Tool update requires enabledTools or disabledTools");
    }
    applyTools();
    persistToolsState();
    return toolState();
  }

  function persistSkillsState() {
    pi.appendEntry(SKILLS_CONFIG_TYPE, { disabledSkills: [...disabledSkills] });
  }

  function restoreSkillsFromBranch(ctx) {
    const saved = lastBranchConfig(ctx, SKILLS_CONFIG_TYPE)?.disabledSkills;
    disabledSkills = new Set(normalizeNameList(saved));
  }

  function skillsFromContext(ctx) {
    const options = ctx.getSystemPromptOptions?.();
    const skills = Array.isArray(options?.skills) ? options.skills : [];
    return skills.map((skill) => ({
      name: skill.name,
      description: skill.description || "",
      enabled: !disabledSkills.has(skill.name),
      disableModelInvocation: skill.disableModelInvocation === true,
      filePath: skill.filePath,
      sourceInfo: safeSourceInfo(skill.sourceInfo),
    }));
  }

  function skillState(ctx) {
    const known = new Set(skillsFromContext(ctx).map((skill) => skill.name));
    disabledSkills = new Set([...disabledSkills].filter((name) => known.has(name)));
    return { skills: skillsFromContext(ctx) };
  }

  function setSkillState(ctx, payload) {
    const allNames = new Set(skillsFromContext(ctx).map((skill) => skill.name));
    if (Array.isArray(payload.enabledSkills)) {
      const enabled = new Set(normalizeNameList(payload.enabledSkills));
      disabledSkills = new Set([...allNames].filter((name) => !enabled.has(name)));
    } else if (Array.isArray(payload.disabledSkills)) {
      disabledSkills = new Set(normalizeNameList(payload.disabledSkills).filter((name) => allNames.has(name)));
    } else {
      throw new Error("Skill update requires enabledSkills or disabledSkills");
    }
    persistSkillsState();
    return skillState(ctx);
  }

  function transferAppRunnerContext(ctx, payload) {
    const content = String(payload?.content || "").trimEnd();
    if (!content.trim()) throw new Error("App runner context content is empty");
    const details = payload?.details && typeof payload.details === "object" ? payload.details : {};
    const isIdle = ctx.isIdle();
    pi.sendMessage({
      customType: APP_RUNNER_CONTEXT_TYPE,
      content,
      display: true,
      details,
    }, isIdle ? undefined : { deliverAs: "steer" });
    return {
      customType: APP_RUNNER_CONTEXT_TYPE,
      delivery: isIdle ? "context" : "steer",
      lineCount: Number(details.lineCount || 0) || undefined,
    };
  }

  function executeAction(action, payload, ctx) {
    switch (action) {
      case "tools-state":
        return toolState();
      case "tools-set":
        return setToolState(payload);
      case "skills-state":
        return skillState(ctx);
      case "skills-set":
        return setSkillState(ctx, payload);
      case "app-runner-context":
        return transferAppRunnerContext(ctx, payload);
      case "queue-remove":
        return removeQueuedPrompt(payload);
      default:
        throw new Error(`Unknown ${HELPER_COMMAND} action: ${action}`);
    }
  }

  pi.registerCommand(HELPER_COMMAND, {
    description: "Internal Web UI helper for browser-native tools and skills configuration",
    handler: async (args, ctx) => {
      let requestId = "";
      try {
        const request = parseHelperArgs(args);
        requestId = request.requestId;
        const data = executeAction(request.action, request.payload, ctx);
        ctx.ui.notify(responseMessage({ requestId, ok: true, data }), "info");
      } catch (error) {
        ctx.ui.notify(responseMessage({ requestId, ok: false, error: error instanceof Error ? error.message : String(error) }), "error");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    restoreToolsFromBranch(ctx);
    restoreSkillsFromBranch(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    restoreToolsFromBranch(ctx);
    restoreSkillsFromBranch(ctx);
  });

  pi.on("input", async (event, ctx) => {
    const match = String(event.text || "").trim().match(/^\/skill:([^\s]+)/i);
    if (!match) return { action: "continue" };
    const skillName = match[1];
    if (!disabledSkills.has(skillName)) return { action: "continue" };
    ctx.ui.notify(`Skill /skill:${skillName} is disabled in the Web UI /skills selector.`, "warning");
    return { action: "handled" };
  });

  pi.on("before_agent_start", async (event) => {
    if (disabledSkills.size === 0) return;
    const allSkills = Array.isArray(event.systemPromptOptions?.skills) ? event.systemPromptOptions.skills : [];
    if (allSkills.length === 0) return;
    const filteredSkills = allSkills.filter((skill) => !disabledSkills.has(skill.name));
    let nextPrompt = replaceAvailableSkillsSection(event.systemPrompt, filteredSkills);
    for (const name of disabledSkills) nextPrompt = nextPrompt.replace(skillBlockPattern(name), "");
    return { systemPrompt: nextPrompt };
  });
}
