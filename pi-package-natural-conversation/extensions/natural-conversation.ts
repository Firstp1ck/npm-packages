import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONVERSATION_STYLES, DEFAULT_ALLOWED_TOOLS, createConversationController } from "@firstpick/pi-package-natural-conversation/controller";
import { createNativeAudioLoop } from "@firstpick/pi-package-natural-conversation/native-audio-loop";
import { runSetupWizard } from "@firstpick/pi-package-natural-conversation/setup-wizard";
import { loadVoiceConfig, saveVoiceConfig } from "@firstpick/pi-package-natural-conversation/voice-config";
import { listPiperVoices, switchPiperVoice, voiceListText, VOICE_CATALOG } from "@firstpick/pi-package-natural-conversation/voice-switch";

const COMMAND_NAMES = ["talk", "voice", "conversation"] as const;
const COMMAND_COMPLETIONS = [
  "on",
  "off",
  "status",
  "setup",
  "audio on",
  "audio off",
  "pause",
  "resume",
  "doctor",
  "doctor mic",
  "doctor speaker",
  "doctor stt",
  "doctor tts",
  "metrics",
  "voice",
  ...VOICE_CATALOG.map((voice) => `voice ${voice.id}`),
  "style",
  ...Object.keys(CONVERSATION_STYLES).map((preset) => `style ${preset}`),
  "tools",
  "tools allow",
  "tools deny",
];

function usage(commandName = "talk"): string {
  return `Usage: /${commandName} [on|off|status|setup|audio on|audio off|pause|resume|doctor [mic|speaker|stt|tts]|voice [<id>]|style [<preset>]|tools [allow|deny <tool>...]|metrics]`;
}

function words(args: string | undefined): string[] {
  return (args ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export default function naturalConversationExtension(pi: ExtensionAPI): void {
  const controller = createConversationController(pi);
  const loop = createNativeAudioLoop(pi, controller);

  // Silence/barge-in settings live in voice.json but the controller is the
  // one-shot authority, so sync them into the enable() overrides.
  function enableSafeMode(ctx: ExtensionCommandContext): { autoStart: boolean } {
    let overrides: Record<string, unknown> = {};
    let autoStart = false;
    try {
      const { config } = loadVoiceConfig();
      overrides = {
        silenceEnabled: config.native.silence.enabled,
        silenceTimeoutMs: config.native.silence.timeoutMs,
        bargeInEnabled: config.native.bargeIn.enabled === true || config.native.headphones === true,
        stylePreset: config.style.preset,
        allowedTools: [...DEFAULT_ALLOWED_TOOLS, ...config.tools.allow],
      };
      autoStart = config.native.enabled === true && config.native.autoStartWithTalkOn === true;
    } catch {
      // defaults are fine
    }
    controller.enable(ctx, overrides);
    return { autoStart };
  }

  async function disableConversationMode(ctx: ExtensionCommandContext): Promise<void> {
    // Order is a safety invariant: the companion (and with it every
    // capture/playback process) dies BEFORE tools/thinking are restored.
    await loop.stop(ctx, { notify: false });
    controller.disable(ctx);
  }

  async function handleConversationCommand(args: string, ctx: ExtensionCommandContext, commandName: string): Promise<void> {
    const parts = words(args);
    const subcommand = parts[0] ?? "";

    if (!subcommand) {
      if (controller.isEnabled()) await disableConversationMode(ctx);
      else {
        const { autoStart } = enableSafeMode(ctx);
        if (autoStart) await loop.start(ctx, { auto: true });
      }
      return;
    }

    if (subcommand === "on" || subcommand === "enable" || subcommand === "start") {
      const { autoStart } = enableSafeMode(ctx);
      if (autoStart) await loop.start(ctx, { auto: true });
      return;
    }

    if (subcommand === "off" || subcommand === "disable" || subcommand === "end" || subcommand === "stop") {
      await disableConversationMode(ctx);
      return;
    }

    if (subcommand === "audio") {
      const mode = parts[1] ?? "";
      if (mode === "on") {
        await loop.start(ctx);
      } else if (mode === "off") {
        await loop.stop(ctx);
      } else {
        ctx.ui.notify(`Usage: /${commandName} audio on|off`, "warning");
      }
      return;
    }

    if (subcommand === "pause") {
      loop.pause(ctx);
      return;
    }

    if (subcommand === "resume") {
      loop.resume(ctx);
      return;
    }

    if (subcommand === "doctor") {
      await loop.doctor(ctx, parts[1]);
      return;
    }

    if (subcommand === "voice") {
      const voiceId = (args ?? "").trim().split(/\s+/).slice(1).join(" ");
      if (!voiceId || voiceId === "list") {
        ctx.ui.notify(voiceListText(listPiperVoices()), "info");
        return;
      }
      const result = await switchPiperVoice(voiceId, {
        loop,
        controller,
        ctx,
        deps: {
          onStatus: (text: string | undefined) => {
            if (ctx.hasUI && ctx.ui.setStatus) ctx.ui.setStatus("natural-conversation", text);
            if (text === undefined) controller.updateStatus(ctx);
          },
        },
      });
      if (!result.ok) throw new Error(`Failed to switch conversation voice to ${result.id || voiceId}.`);
      return;
    }

    if (subcommand === "style") {
      const preset = parts[1] ?? "";
      const current = controller.getStyle();
      if (!preset || preset === "list") {
        const lines = Object.keys(CONVERSATION_STYLES).map(
          (id) => `${id === current ? "●" : " "} ${id} — ${CONVERSATION_STYLES[id].label}`,
        );
        ctx.ui.notify([`Spoken styles (/${commandName} style <preset> to switch):`, ...lines].join("\n"), "info");
        return;
      }
      if (!CONVERSATION_STYLES[preset]) {
        ctx.ui.notify(`Unknown style '${preset}'. Available: ${Object.keys(CONVERSATION_STYLES).join(", ")}`, "warning");
        return;
      }
      controller.setStyle(preset, ctx);
      try {
        const { config } = loadVoiceConfig();
        config.style.preset = preset;
        saveVoiceConfig(config);
      } catch {
        ctx.ui.notify("Style applied for this session, but voice.json could not be updated.", "warning");
      }
      ctx.ui.notify(`Spoken style: ${preset} — ${CONVERSATION_STYLES[preset].label}. Takes effect on the next answer.`, "info");
      return;
    }

    if (subcommand === "tools") {
      const action = parts[1] ?? "";
      // Preserve case for tool names (words() lowercases; names may not be).
      const names = (args ?? "").trim().split(/\s+/).slice(2).filter(Boolean);
      let config;
      try {
        config = loadVoiceConfig().config;
      } catch {
        ctx.ui.notify("Could not read voice.json.", "error");
        return;
      }
      if (action === "allow" || action === "deny") {
        if (names.length === 0) {
          ctx.ui.notify(`Usage: /${commandName} tools allow|deny <tool> [...]`, "warning");
          return;
        }
        const extras = new Set<string>(config.tools.allow);
        for (const name of names) {
          if (action === "allow") extras.add(name);
          else extras.delete(name);
        }
        config.tools.allow = [...extras];
        saveVoiceConfig(config);
        controller.setAllowedTools([...DEFAULT_ALLOWED_TOOLS, ...config.tools.allow], ctx);
        ctx.ui.notify(`Conversation tools: ${[...DEFAULT_ALLOWED_TOOLS, ...config.tools.allow].join(", ")}`, "info");
        return;
      }
      ctx.ui.notify(
        [
          `Read-only defaults: ${DEFAULT_ALLOWED_TOOLS.join(", ")}`,
          `Extra allowed: ${config.tools.allow.length > 0 ? config.tools.allow.join(", ") : "(none)"}`,
          `Add with /${commandName} tools allow <tool>. Only allow read-only tools — conversation mode stays nondestructive.`,
        ].join("\n"),
        "info",
      );
      return;
    }

    if (subcommand === "metrics") {
      ctx.ui.notify(loop.statusLines().join("\n"), "info");
      return;
    }

    if (subcommand === "status") {
      ctx.ui.notify([controller.statusText(), ...loop.statusLines()].join("\n"), "info");
      controller.updateStatus(ctx);
      return;
    }

    if (subcommand === "setup") {
      await runSetupWizard({ pi, controller, loop, ctx });
      return;
    }

    ctx.ui.notify(usage(commandName), "warning");
  }

  for (const name of COMMAND_NAMES) {
    pi.registerCommand(name, {
      description: "Natural Conversation Mode. Usage: on | off | status | setup | audio on/off | pause | resume | doctor | metrics",
      getArgumentCompletions: (prefix: string) =>
        COMMAND_COMPLETIONS.filter((item) => item.startsWith(prefix)).map((item) => ({ value: item, label: item })),
      handler: async (args, ctx) => handleConversationCommand(args, ctx, name),
    });
  }

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    controller.updateStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx: ExtensionContext) => {
    await loop.stop(ctx, { notify: false });
    controller.shutdown(ctx);
  });

  pi.on("input", async (_event, ctx: ExtensionContext) => {
    controller.ensureConversationConstraints(ctx);
    loop.notifyUserInput(ctx);
    return { action: "continue" as const };
  });

  pi.on("before_agent_start", async (event, ctx: ExtensionContext) => {
    if (!controller.isEnabled()) return;
    controller.ensureConversationConstraints(ctx);
    return { systemPrompt: controller.buildSystemPrompt(event.systemPrompt) };
  });

  pi.on("turn_start", async (_event, ctx: ExtensionContext) => {
    controller.ensureConversationConstraints(ctx);
    loop.handleTurnStart(ctx);
  });

  pi.on("message_update", async (event, ctx: ExtensionContext) => {
    loop.handleMessageUpdate(event, ctx);
  });

  pi.on("agent_start", async (_event, ctx: ExtensionContext) => {
    loop.handleAgentStart(ctx);
  });

  pi.on("agent_end", async (event, ctx: ExtensionContext) => {
    loop.handleAgentEnd(event, ctx);
  });

  pi.on("tool_execution_start", async (_event, ctx: ExtensionContext) => {
    loop.handleToolExecutionStart(ctx);
  });

  pi.on("tool_execution_end", async (_event, ctx: ExtensionContext) => {
    loop.handleToolExecutionEnd(ctx);
  });

  pi.on("tool_call", async (event) => controller.handleToolCall(event));

  pi.on("user_bash", async () => controller.handleUserBash());
}
