import type { WorkflowModeState } from "./types.ts";
import type { WorkflowUIContext } from "./ui.ts";

export const WORKFLOW_MODE_ENTRY_TYPE = "workflow-mode-state";
export const WORKFLOW_MODE_STATUS_KEY = "workflow-mode";
export const WORKFLOW_MODE_RPC_WIDGET_KEY = "workflow-mode:rpc";
export const WORKFLOW_MODE_RPC_PAYLOAD_PREFIX = "WORKFLOW_MODE_RPC_PAYLOAD ";

const WORKFLOW_MODE_PROMPT = `
# Workflow Mode

Workflow Mode is enabled for this session. For a substantive task, design a reusable JavaScript workflow and invoke the workflow_run tool instead of executing the task directly.

The script must:
- begin with a static \`export const meta = { name, description, phases?, pi? }\` declaration;
- use only the injected \`args\`, \`agent()\`, \`phase()\`, \`parallel()\`, and \`pipeline()\` capabilities;
- use top-level await and return one consolidated result;
- avoid imports, Node globals, filesystem/network/shell APIs, eval, Function, and WebAssembly;
- use stable, unique agent labels and conservative concurrency;
- request only read-only tools unless the user explicitly approved broader capabilities and the runtime supports them.

Call workflow_run with the generated script, structured args, and confirmRun=true. Do not merely print the script. If the request is trivial and fanout would add no value, answer directly and briefly explain that a workflow was unnecessary.
`.trim();

type EntryLike = {
  type?: string;
  customType?: string;
  data?: unknown;
};

type PiLike = {
  appendEntry?: (customType: string, data?: unknown) => void;
};

export type WorkflowModeController = {
  getState(): WorkflowModeState;
  isEnabled(): boolean;
  setEnabled(enabled: boolean, ctx?: WorkflowUIContext): WorkflowModeState;
  armOnce(ctx?: WorkflowUIContext): WorkflowModeState;
  toggle(ctx?: WorkflowUIContext): WorkflowModeState;
  setRunning(running: boolean, ctx?: WorkflowUIContext): WorkflowModeState;
  finishTurn(ctx?: WorkflowUIContext): WorkflowModeState;
  restoreFromEntries(entries: EntryLike[]): WorkflowModeState;
  render(ctx: WorkflowUIContext): void;
  buildSystemPrompt(basePrompt: string): string;
};

function initialModeState(): WorkflowModeState {
  return {
    schemaVersion: 1,
    enabled: false,
    behavior: "persistent",
    phase: "off",
    updatedAt: new Date().toISOString(),
  };
}

function snapshot(state: WorkflowModeState): WorkflowModeState {
  return { ...state };
}

function isModeState(value: unknown): value is WorkflowModeState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const state = value as Partial<WorkflowModeState>;
  return state.schemaVersion === 1
    && typeof state.enabled === "boolean"
    && (state.behavior === "persistent" || state.behavior === "once")
    && ["off", "armed", "running"].includes(String(state.phase))
    && typeof state.updatedAt === "string";
}

export function latestWorkflowModeFromEntries(entries: EntryLike[]): WorkflowModeState | undefined {
  let latest: WorkflowModeState | undefined;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== WORKFLOW_MODE_ENTRY_TYPE || !isModeState(entry.data)) continue;
    latest = snapshot(entry.data);
  }
  return latest;
}

export function workflowModeStatusText(state: WorkflowModeState): string {
  if (!state.enabled) return "";
  if (state.phase === "running") return "Workflow: running";
  return state.behavior === "once" ? "Workflow: once" : "Workflow: on";
}

export function workflowModeDescription(state: WorkflowModeState): string {
  return state.enabled
    ? `Workflow Mode is ${state.behavior === "once" ? "armed for one turn" : "on"} (${state.phase}). Substantive prompts are routed through generated JavaScript workflows.`
    : "Workflow Mode is off. Prompts use normal Pi behavior.";
}

export function createWorkflowModeController(pi?: PiLike): WorkflowModeController {
  let state = initialModeState();

  const render = (ctx: WorkflowUIContext): void => {
    if (ctx.hasUI === false || !ctx.ui) return;
    ctx.ui.setStatus?.(WORKFLOW_MODE_STATUS_KEY, workflowModeStatusText(state));
    if (ctx.mode === "rpc") {
      const payload = {
        type: "firstpick.pi-extension-workflows.mode",
        version: 1,
        enabled: state.enabled,
        behavior: state.behavior,
        phase: state.phase,
        updatedAt: state.updatedAt,
      };
      ctx.ui.setWidget?.(WORKFLOW_MODE_RPC_WIDGET_KEY, [`${WORKFLOW_MODE_RPC_PAYLOAD_PREFIX}${JSON.stringify(payload)}`]);
    }
  };

  const persist = (): void => {
    try {
      pi?.appendEntry?.(WORKFLOW_MODE_ENTRY_TYPE, snapshot(state));
    } catch {
      // Session persistence is best-effort; in-memory mode state remains authoritative.
    }
  };

  const setState = (next: WorkflowModeState, ctx?: WorkflowUIContext, shouldPersist = true): WorkflowModeState => {
    state = next;
    if (shouldPersist) persist();
    if (ctx) render(ctx);
    return snapshot(state);
  };

  return {
    getState: () => snapshot(state),
    isEnabled: () => state.enabled,
    setEnabled(enabled, ctx) {
      return setState({
        ...state,
        enabled,
        behavior: "persistent",
        phase: enabled ? "armed" : "off",
        updatedAt: new Date().toISOString(),
      }, ctx);
    },
    armOnce(ctx) {
      return setState({
        ...state,
        enabled: true,
        behavior: "once",
        phase: "armed",
        updatedAt: new Date().toISOString(),
      }, ctx);
    },
    toggle(ctx) {
      return this.setEnabled(!state.enabled, ctx);
    },
    setRunning(running, ctx) {
      if (!state.enabled) return snapshot(state);
      return setState({
        ...state,
        phase: running ? "running" : "armed",
        updatedAt: new Date().toISOString(),
      }, ctx, false);
    },
    finishTurn(ctx) {
      if (!state.enabled) return snapshot(state);
      if (state.behavior === "once") return this.setEnabled(false, ctx);
      return this.setRunning(false, ctx);
    },
    restoreFromEntries(entries) {
      const restored = latestWorkflowModeFromEntries(entries);
      if (restored) {
        state = {
          ...restored,
          phase: restored.enabled ? "armed" : "off",
          updatedAt: new Date().toISOString(),
        };
      }
      return snapshot(state);
    },
    render,
    buildSystemPrompt(basePrompt) {
      if (!state.enabled) return basePrompt;
      return `${basePrompt}\n\n${WORKFLOW_MODE_PROMPT}`;
    },
  };
}
