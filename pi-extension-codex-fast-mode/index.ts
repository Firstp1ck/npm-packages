import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const FAST_MODE_STATUS_KEY = "codex-fast-mode";
export const FAST_MODE_STATE_ENTRY_TYPE = "codex-fast-mode";
export const FAST_MODE_SERVICE_TIER = "priority";

export type FastModeState = {
  enabled: boolean;
};

export type FastModeModel = {
  provider?: unknown;
  api?: unknown;
};

export type FastModeCommand = "toggle" | "on" | "off" | "status" | "invalid";

/** Returns true only for object records that can safely receive a shallow request rewrite. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Fast mode is limited to Pi's subscription-backed Codex Responses provider. */
export function isFastModeEligibleModel(model: FastModeModel | undefined): boolean {
  return model?.provider === "openai-codex" && model.api === "openai-codex-responses";
}

/**
 * Applies Fast-mode request intent without mutating the provider's serialized payload.
 * Undefined is intentional: Pi then retains the original payload unchanged.
 */
export function transformFastModeRequest(
  enabled: boolean,
  model: FastModeModel | undefined,
  payload: unknown,
): Record<string, unknown> | undefined {
  if (!enabled || !isFastModeEligibleModel(model) || !isPlainObject(payload)) return undefined;
  return { ...payload, service_tier: FAST_MODE_SERVICE_TIER };
}

/** Reconstructs the latest valid Fast-mode snapshot visible from the active session branch. */
export function reconstructFastModeState(entries: readonly unknown[]): FastModeState {
  let enabled = false;

  for (const entry of entries) {
    if (!isPlainObject(entry)) continue;
    if (entry.type !== "custom" || entry.customType !== FAST_MODE_STATE_ENTRY_TYPE) continue;
    if (!isPlainObject(entry.data) || typeof entry.data.enabled !== "boolean") continue;
    enabled = entry.data.enabled;
  }

  return { enabled };
}

export function parseFastModeCommand(args: string): FastModeCommand {
  const normalized = args.trim().toLowerCase();
  if (!normalized) return "toggle";
  if (normalized === "on" || normalized === "off" || normalized === "status") return normalized;
  return "invalid";
}

export function fastModeArgumentCompletions(prefix: string) {
  const normalized = prefix.trim().toLowerCase();
  return ["on", "off", "status"]
    .filter((value) => value.startsWith(normalized))
    .map((value) => ({ value, label: value }));
}

function isBusy(ctx: Pick<ExtensionCommandContext, "isIdle" | "hasPendingMessages">): boolean {
  return !ctx.isIdle() || ctx.hasPendingMessages();
}

function publishStatus(ctx: Pick<ExtensionContext, "ui">, enabled: boolean): void {
  ctx.ui.setStatus(FAST_MODE_STATUS_KEY, enabled ? "on" : "off");
}

function formatStatus(enabled: boolean): string {
  const state = enabled ? "on" : "off";
  return `Fast mode: ${state}. It only requests priority service for openai-codex/openai-codex-responses.`;
}

export default function codexFastModeExtension(pi: ExtensionAPI): void {
  let enabled = false;

  const restoreState = (ctx: ExtensionContext): void => {
    enabled = reconstructFastModeState(ctx.sessionManager.getBranch()).enabled;
    publishStatus(ctx, enabled);
  };

  const persistState = (): void => {
    pi.appendEntry<FastModeState>(FAST_MODE_STATE_ENTRY_TYPE, { enabled });
  };

  const setEnabled = (ctx: ExtensionCommandContext, nextEnabled: boolean): void => {
    if (enabled === nextEnabled) {
      publishStatus(ctx, enabled);
      ctx.ui.notify(`Fast mode is already ${enabled ? "on" : "off"}.`, "info");
      return;
    }

    enabled = nextEnabled;
    persistState();
    publishStatus(ctx, enabled);
    ctx.ui.notify(enabled
      ? "Fast mode enabled. Supported Codex requests will use priority service."
      : "Fast mode disabled. Supported Codex requests will keep their existing service tier.", "info");
  };

  pi.on("session_start", (_event, ctx) => {
    restoreState(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    restoreState(ctx);
  });

  pi.on("before_provider_request", (event, ctx) => {
    return transformFastModeRequest(enabled, ctx.model, event.payload);
  });

  pi.registerCommand("fast-mode", {
    description: "Toggle Codex subscription Fast mode. Usage: /fast-mode [on|off|status]",
    getArgumentCompletions: fastModeArgumentCompletions,
    handler: async (args, ctx) => {
      const command = parseFastModeCommand(args);

      if (command === "status") {
        publishStatus(ctx, enabled);
        ctx.ui.notify(formatStatus(enabled), "info");
        return;
      }

      if (command === "invalid") {
        ctx.ui.notify("Usage: /fast-mode [on|off|status]", "warning");
        return;
      }

      if (isBusy(ctx)) {
        ctx.ui.notify("Fast mode cannot be changed while the session is busy. Run /fast-mode status to inspect it.", "warning");
        return;
      }

      setEnabled(ctx, command === "toggle" ? !enabled : command === "on");
    },
  });
}
