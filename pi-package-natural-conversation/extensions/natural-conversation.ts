import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createConversationController } from "../lib/conversation-controller.mjs";

const COMMAND_NAMES = ["talk", "voice", "conversation"] as const;
const COMMAND_COMPLETIONS = ["on", "off", "status", "setup"];

function usage(commandName = "talk"): string {
  return `Usage: /${commandName} [on|off|status|setup]`;
}

function firstWord(args: string | undefined): string {
  return (args ?? "").trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
}

export default function naturalConversationExtension(pi: ExtensionAPI): void {
  const controller = createConversationController(pi);

  async function handleConversationCommand(args: string, ctx: ExtensionCommandContext, commandName: string): Promise<void> {
    const subcommand = firstWord(args);

    if (!subcommand) {
      if (controller.isEnabled()) controller.disable(ctx);
      else controller.enable(ctx);
      return;
    }

    if (subcommand === "on" || subcommand === "enable" || subcommand === "start") {
      controller.enable(ctx);
      return;
    }

    if (subcommand === "off" || subcommand === "disable" || subcommand === "end" || subcommand === "stop") {
      controller.disable(ctx);
      return;
    }

    if (subcommand === "status") {
      ctx.ui.notify(controller.statusText(), "info");
      controller.updateStatus(ctx);
      return;
    }

    if (subcommand === "setup") {
      ctx.ui.notify(
        [
          "Natural Conversation setup (phase 1): native safe-mode controls are available now.",
          "Full native microphone/speaker audio needs a local STT/TTS provider in a later phase.",
          "Current safe defaults: thinking off; tools limited to read, grep, find, ls.",
        ].join("\n"),
        "info",
      );
      controller.updateStatus(ctx);
      return;
    }

    ctx.ui.notify(usage(commandName), "warning");
  }

  for (const name of COMMAND_NAMES) {
    pi.registerCommand(name, {
      description: "Toggle Natural Conversation Mode safety constraints. Usage: on | off | status | setup",
      getArgumentCompletions: (prefix: string) =>
        COMMAND_COMPLETIONS.filter((item) => item.startsWith(prefix)).map((item) => ({ value: item, label: item })),
      handler: async (args, ctx) => handleConversationCommand(args, ctx, name),
    });
  }

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    controller.updateStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx: ExtensionContext) => {
    controller.shutdown(ctx);
  });

  pi.on("input", async (_event, ctx: ExtensionContext) => {
    controller.ensureConversationConstraints(ctx);
    return { action: "continue" as const };
  });

  pi.on("before_agent_start", async (event, ctx: ExtensionContext) => {
    if (!controller.isEnabled()) return;
    controller.ensureConversationConstraints(ctx);
    return { systemPrompt: controller.buildSystemPrompt(event.systemPrompt) };
  });

  pi.on("turn_start", async (_event, ctx: ExtensionContext) => {
    controller.ensureConversationConstraints(ctx);
  });

  pi.on("tool_call", async (event) => controller.handleToolCall(event));

  pi.on("user_bash", async () => controller.handleUserBash());
}
