import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import {
  branchResourceDirective,
  readResourceDefaults,
  resolveResourceSelection,
} from "@firstpick/pi-utils/resource-management";
import { registerScopedResourceCommand } from "@firstpick/pi-utils/scoped-resource-command";

const CUSTOM_TYPE = "webui-tools-config";

type ToolsState = {
  enabledTools?: string[];
};

export function toolSourceLabel(tool: ToolInfo): string {
  const source = tool.sourceInfo?.source ?? "unknown";
  if (source === "builtin") return "Pi built-in";
  if (source === "sdk") return "SDK custom tools";
  return source.replace(/^extension:/, "");
}

export function toolResourcePresentation(tool: ToolInfo) {
  return {
    name: tool.name,
    discovery: toolSourceLabel(tool),
    description: tool.description,
  };
}

function lastBranchConfig(ctx: ExtensionContext): ToolsState | undefined {
  let found: ToolsState | undefined;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === CUSTOM_TYPE) found = entry.data as ToolsState;
  }
  return found;
}

export default function toolsExtension(pi: ExtensionAPI) {
  let runtimeBaseline: string[] | undefined;
  let enabledTools = new Set<string>();
  let generation = 0;
  let tuiActive = false;

  const allToolNames = () => pi.getAllTools().map((tool) => tool.name).sort();
  const runtimeTools = () => runtimeBaseline ??= [...pi.getActiveTools()];

  async function recompute(ctx: ExtensionContext, model = ctx.model): Promise<boolean> {
    const requestedKey = model?.provider && model?.id ? `${model.provider}\0${model.id}` : "";
    const currentGeneration = ++generation;
    let defaults;
    try {
      defaults = await readResourceDefaults();
    } catch (error) {
      ctx.ui.notify(`Tool defaults could not be read: ${error instanceof Error ? error.message : String(error)}`, "error");
      return false;
    }
    const currentKey = ctx.model?.provider && ctx.model?.id ? `${ctx.model.provider}\0${ctx.model.id}` : "";
    if (currentGeneration !== generation || currentKey !== requestedKey) return false;

    const directive = branchResourceDirective(lastBranchConfig(ctx), "tools");
    const resolved = directive.pinned
      ? { names: directive.names || [] }
      : resolveResourceSelection(defaults, "tools", model?.provider, model?.id, runtimeTools());
    const available = new Set(allToolNames());
    enabledTools = new Set((resolved.names || runtimeTools()).filter((name) => available.has(name)));
    pi.setActiveTools([...enabledTools]);
    return true;
  }

  registerScopedResourceCommand(pi, {
    commandName: "tools",
    resourceType: "tools",
    resourceLabel: "Tools",
    selectionKey: "enabledTools",
    customType: CUSTOM_TYPE,
    getVisibleNames: async () => allToolNames(),
    getResourcePresentation: async () => pi.getAllTools().map(toolResourcePresentation),
    getRuntimeNames: async () => runtimeTools(),
    getEnabledNames: async () => [...enabledTools],
    recompute,
  });

  pi.on("session_start", async (_event, ctx) => {
    tuiActive = ctx.mode === "tui";
    if (!tuiActive) return;
    runtimeBaseline ??= [...pi.getActiveTools()];
    await recompute(ctx);
  });
  pi.on("session_tree", async (_event, ctx) => {
    if (tuiActive && ctx.mode === "tui") await recompute(ctx);
  });
  pi.on("model_select", async (event, ctx) => {
    if (tuiActive && ctx.mode === "tui") await recompute(ctx, event.model);
  });
  pi.on("session_shutdown", () => {
    tuiActive = false;
    generation += 1;
  });
}
