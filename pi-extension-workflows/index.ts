import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createWorkflowApprovalStore } from "./src/approval.ts";
import { WorkflowLoadError, errorMessage } from "./src/errors.ts";
import { EXCLUSIVE_MODE_EVENT, WORKFLOW_EXCLUSIVE_MODE_ID, exclusiveModeEvent, isExclusiveModeEvent } from "./src/exclusive-mode.ts";
import { requestWorkflowLaunchApproval } from "./src/launch-approval.ts";
import { findWorkflowSource, formatWorkflowList, loadWorkflowRegistry, loadWorkflowScriptPath, workflowSourceKey } from "./src/loader.ts";
import { hashWorkflowPolicy, workflowProjectIdentity, type WorkflowRunRecordV1 } from "./src/persistence-schema.ts";
import { runWorkflow } from "./src/runner.ts";
import { WorkflowRunManager, type WorkflowRunLaunchReceipt } from "./src/run-manager.ts";
import { createWorkflowRunStorage } from "./src/run-storage.ts";
import { createWorkflowModeController, workflowModeDescription } from "./src/mode.ts";
import { parseWorkflowScript } from "./src/script-parser.ts";
import { createJavaScriptRun, effectiveScript, runJavaScriptWorkflow } from "./src/script-runner.ts";
import { saveWorkflowSnapshot } from "./src/saved-workflows.ts";
import { createWorkflowRun, createWorkflowStateStore } from "./src/state.ts";
import { createSubprocessTaskRunner } from "./src/task-runner.ts";
import type { WorkflowInput, WorkflowJavaScriptSource, WorkflowRun, WorkflowSource } from "./src/types.ts";
import { clearWorkflowUI, notifyWorkflow, renderWorkflowRun, type WorkflowUIContext } from "./src/ui.ts";
import { parseJsonObject, splitFirstToken } from "./src/utils.ts";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));

function projectTrusted(ctx: unknown): boolean {
  const maybe = ctx as { isProjectTrusted?: () => boolean };
  try {
    return Boolean(maybe.isProjectTrusted?.());
  } catch {
    return false;
  }
}

async function loadSources(ctx: { cwd: string } & WorkflowUIContext): Promise<WorkflowSource[]> {
  return await loadWorkflowRegistry({
    cwd: ctx.cwd,
    extensionDir: EXTENSION_DIR,
    includeUser: true,
    includeProject: true,
    projectTrusted: projectTrusted(ctx),
  });
}

function formatRunStatus(run: WorkflowRun | undefined): string {
  if (!run) return "No workflow run has been recorded in this session.";
  const taskCount = run.phases.reduce((total, phase) => total + phase.tasks.length, 0);
  const done = run.phases.reduce((total, phase) => total + phase.tasks.filter((task) => task.status === "completed").length, 0);
  const failed = run.phases.reduce((total, phase) => total + phase.tasks.filter((task) => task.status === "failed").length, 0);
  return [
    `Workflow: ${run.workflowKey}`,
    `Run: ${run.runId}`,
    `Status: ${run.status}`,
    `Tasks: ${done}/${taskCount} completed${failed ? `, ${failed} failed` : ""}`,
    run.sourcePath ? `Source: ${run.sourcePath}` : undefined,
    run.error ? `Error: ${run.error}` : undefined,
  ].filter(Boolean).join("\n");
}

function formatRunRecord(record: WorkflowRunRecordV1 | undefined): string {
  if (!record) return "No workflow run has been recorded in this session.";
  return [
    `Workflow: ${record.workflowName}`,
    `Run: ${record.runId}`,
    `Status: ${record.status}`,
    `Updated: ${record.updatedAt}`,
    record.snapshotPath ? `Snapshot: ${record.snapshotPath}` : undefined,
  ].filter(Boolean).join("\n");
}

function formatRunList(records: WorkflowRunRecordV1[]): string {
  if (records.length === 0) return "No workflow runs have been recorded in this session.";
  return records.map((record) => `- ${record.runId} [${record.status}] ${record.workflowName}`).join("\n");
}

function helpText(): string {
  return [
    "Usage:",
    "  /workflow list",
    "  /workflow status [run-id]",
    "  /workflow mode [once|on|off|toggle|status]",
    "  /workflow run <workflow-key> [json-input]",
    "  /workflow <workflow-key> [json-input]",
    "  /workflow abort [run-id]",
    "  /workflow save <run-id> --project|--user",
    "  /workflows",
    "",
    "Example:",
    '  /workflow run deep-research-minimal {"topic":"Pi workflow extensions"}',
  ].join("\n");
}

function normalizeInput(value: unknown): WorkflowInput {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("workflow input must be a JSON object.");
  }
  return value as WorkflowInput;
}

export default function workflowExtension(pi: ExtensionAPI) {
  const state = createWorkflowStateStore(pi);
  const approvals = createWorkflowApprovalStore(pi);
  const mode = createWorkflowModeController(pi);
  const taskRunner = createSubprocessTaskRunner();
  const knownWorkflowNames = new Set<string>(["deep-research-minimal"]);
  const rememberSources = (sources: WorkflowSource[]) => {
    for (const source of sources) knownWorkflowNames.add(workflowSourceKey(source));
    return sources;
  };
  let conflictingExclusiveMode: string | undefined;
  pi.events?.on?.(EXCLUSIVE_MODE_EVENT, (payload: unknown) => {
    if (!isExclusiveModeEvent(payload) || payload.mode === WORKFLOW_EXCLUSIVE_MODE_ID) return;
    if (payload.enabled) conflictingExclusiveMode = payload.mode;
    else if (conflictingExclusiveMode === payload.mode) conflictingExclusiveMode = undefined;
  });
  const publishWorkflowMode = () => {
    pi.events?.emit?.(EXCLUSIVE_MODE_EVENT, exclusiveModeEvent(WORKFLOW_EXCLUSIVE_MODE_ID, mode.isEnabled()));
  };
  const assertWorkflowModeAvailable = () => {
    if (conflictingExclusiveMode) throw new Error(`Workflow Mode conflicts with active exclusive mode '${conflictingExclusiveMode}'. Disable that mode first.`);
  };

  const manager = new WorkflowRunManager({
    onRequest(run) {
      pi.sendMessage?.({
        customType: "workflow-request",
        content: `Workflow launched: ${run.workflowName}\nRun: ${run.runId}`,
        display: true,
        details: { runId: run.runId, workflowKey: run.workflowKey, status: run.status },
      }, { triggerTurn: false });
    },
    onResult(run) {
      const content = run.status === "completed"
        ? (typeof run.result === "string" ? run.result : JSON.stringify(run.result ?? run.summary ?? null, null, 2))
        : `Workflow ${run.status}: ${run.error ?? run.summary ?? run.workflowName}`;
      pi.sendMessage?.({
        customType: "workflow-result",
        content,
        display: true,
        details: { runId: run.runId, workflowKey: run.workflowKey, status: run.status, usage: run.usage },
      }, { triggerTurn: true, deliverAs: "followUp" });
    },
  });

  const startSource = async (
    source: WorkflowSource,
    input: unknown,
    ctx: { cwd: string } & WorkflowUIContext,
  ): Promise<WorkflowRunLaunchReceipt> => {
    const sessionId = (ctx as { sessionManager?: { getSessionId?: () => string } }).sessionManager?.getSessionId?.() ?? "ephemeral";
    const storage = createWorkflowRunStorage({ sessionId });
    if (source.sourceType === "json") {
      notifyWorkflow(ctx, `Legacy JSON workflow '${source.definition.key}' is deprecated. Save or rewrite it as a .js workflow before JSON execution is removed.`, "warning");
    }
    const projectId = await workflowProjectIdentity(ctx.cwd);
    const run = source.sourceType === "javascript"
      ? createJavaScriptRun(source, input)
      : createWorkflowRun(source.definition, normalizeInput(input), source.path);
    run.projectId = projectId;
    if (source.sourceType === "javascript" && Object.entries(source.script.meta.pi.permissions).some(([, enabled]) => enabled)) {
      throw new Error("Workflow policy denied: write, shell, and network permissions are unavailable in the read-only release.");
    }
    const policySnapshot = source.sourceType === "javascript"
      ? effectiveScript(source.script).meta.pi
      : {
          version: 1,
          legacyJson: true,
          maxConcurrency: source.definition.defaults?.maxConcurrency ?? 3,
          maxAgents: source.definition.defaults?.maxTasks ?? 50,
          permissions: { write: false, shell: false, network: false },
        };
    if (source.sourceType === "javascript") {
      run.policyHash = hashWorkflowPolicy(policySnapshot);
      await requestWorkflowLaunchApproval({
        approvals,
        key: { projectId, scriptHash: source.script.sourceHash, policyHash: run.policyHash },
        workflowName: source.script.meta.name,
        source: source.script.source,
        ctx,
      });
    }

    const receipt = await manager.launch({
      run,
      storage,
      projectId,
      policySnapshot,
      ...(source.sourceType === "javascript" ? { scriptSnapshot: { source: source.script.source, hash: source.script.sourceHash } } : {}),
      execute: async (signal, onRunUpdate) => {
        const commonOptions = { cwd: ctx.cwd, taskRunner, state, storage, run, signal, onRunUpdate };
        return source.sourceType === "javascript"
          ? await runJavaScriptWorkflow(source, input, ctx, commonOptions)
          : await runWorkflow(source, normalizeInput(input), ctx, commonOptions);
      },
    });
    notifyWorkflow(ctx, `Workflow launched: ${workflowSourceKey(source)} (${receipt.runId})`, "info");
    return receipt;
  };

  const startRun = async (
    key: string,
    input: unknown,
    ctx: { cwd: string } & WorkflowUIContext,
  ): Promise<WorkflowRunLaunchReceipt> => {
    const sources = rememberSources(await loadSources(ctx));
    const source = findWorkflowSource(sources, key);
    if (!source) {
      const available = sources.map(workflowSourceKey).join(", ") || "none";
      throw new Error(`Unknown workflow '${key}'. Available workflows: ${available}.`);
    }
    return await startSource(source, input, ctx);
  };

  const startInlineScript = async (
    sourceCode: string,
    input: unknown,
    ctx: { cwd: string } & WorkflowUIContext,
  ): Promise<WorkflowRunLaunchReceipt> => {
    const script = parseWorkflowScript(sourceCode, { sourcePath: "inline-workflow.js" });
    const source: WorkflowJavaScriptSource = {
      path: `inline:${script.sourceHash.slice(0, 16)}`,
      scope: "inline",
      sourceType: "javascript",
      script,
    };
    return await startSource(source, input, ctx);
  };

  const startScriptPath = async (
    reference: string,
    input: unknown,
    ctx: { cwd: string } & WorkflowUIContext,
  ): Promise<WorkflowRunLaunchReceipt> => {
    const source = await loadWorkflowScriptPath(reference, {
      cwd: ctx.cwd,
      extensionDir: EXTENSION_DIR,
      includeUser: true,
      includeProject: true,
      projectTrusted: projectTrusted(ctx),
    });
    return await startSource(source, input, ctx);
  };

  pi.registerCommand("workflow", {
    description: "Run minimal modular Pi workflows",
    getArgumentCompletions(prefix) {
      const input = prefix.trimStart();
      const [action = "", ...tailParts] = input.split(/\s+/);
      const tail = tailParts.join(" ");
      const complete = (values: string[], lead = "") => {
        const query = lead ? tail : action;
        const items = values
          .filter((value) => value.startsWith(query))
          .map((value) => ({ value: lead ? `${lead} ${value}` : value, label: value }));
        return items.length > 0 ? items : null;
      };
      if (action === "run") return complete([...knownWorkflowNames].sort(), "run");
      if (action === "status" || action === "abort") return complete(manager.list().map((record) => record.runId), action);
      if (action === "save") {
        if (tailParts.length <= 1) return complete(manager.list().map((record) => record.runId), "save");
        const runId = tailParts[0];
        const flagQuery = tailParts.at(-1) ?? "";
        const flags = ["--project", "--user"].filter((flag) => flag.startsWith(flagQuery));
        return flags.map((flag) => ({ value: `save ${runId} ${flag}`, label: flag }));
      }
      if (action === "mode") return complete(["once", "on", "off", "toggle", "status"], "mode");
      return complete(["list", "status", "mode", "run", "abort", "save", ...knownWorkflowNames].sort());
    },
    handler: async (args, ctx) => {
      const { token: actionOrKey, rest } = splitFirstToken(args);
      const action = actionOrKey || "help";

      try {
        if (action === "help" || action === "--help" || action === "-h") {
          ctx.ui.notify(helpText(), "info");
          return;
        }

        if (action === "list") {
          const sources = rememberSources(await loadSources(ctx));
          ctx.ui.notify(formatWorkflowList(sources), "info");
          return;
        }

        if (action === "mode") {
          const { token: requestedMode } = splitFirstToken(rest);
          const modeAction = requestedMode.toLowerCase() || "status";
          if (modeAction === "on" || modeAction === "enable" || modeAction === "start") {
            assertWorkflowModeAvailable();
            mode.setEnabled(true, ctx);
            publishWorkflowMode();
          } else if (modeAction === "once") {
            assertWorkflowModeAvailable();
            mode.armOnce(ctx);
            publishWorkflowMode();
          } else if (modeAction === "off" || modeAction === "disable" || modeAction === "stop") {
            mode.setEnabled(false, ctx);
            publishWorkflowMode();
          } else if (modeAction === "toggle") {
            if (!mode.isEnabled()) assertWorkflowModeAvailable();
            mode.toggle(ctx);
            publishWorkflowMode();
          } else if (modeAction !== "status") throw new Error("Usage: /workflow mode [once|on|off|toggle|status]");
          ctx.ui.notify(workflowModeDescription(mode.getState()), "info");
          return;
        }

        if (action === "status") {
          const { token: requestedRunId } = splitFirstToken(rest);
          const run = requestedRunId ? manager.get(requestedRunId) : manager.active().at(-1) ?? state.getLastRun();
          const record = requestedRunId ? manager.getRecord(requestedRunId) : manager.list().at(0);
          renderWorkflowRun(ctx, run);
          ctx.ui.notify(run ? formatRunStatus(run) : formatRunRecord(record), "info");
          return;
        }

        if (action === "abort") {
          const { token: requestedRunId } = splitFirstToken(rest);
          const runId = requestedRunId || manager.active().at(-1)?.runId;
          if (!runId || !manager.abort(runId)) {
            ctx.ui.notify("No matching active workflow run to abort.", "info");
            return;
          }
          ctx.ui.notify(`Abort requested for workflow run ${runId}.`, "warning");
          return;
        }

        if (action === "save") {
          const parts = rest.trim().split(/\s+/).filter(Boolean);
          const runId = parts.find((part) => !part.startsWith("--"));
          const scope = parts.includes("--project") ? "project" : parts.includes("--user") ? "user" : undefined;
          if (!runId || !scope || (parts.includes("--project") && parts.includes("--user"))) {
            throw new Error("Usage: /workflow save <run-id> --project|--user");
          }
          const record = manager.getRecord(runId);
          if (!record) throw new Error(`Unknown workflow run '${runId}'.`);
          const confirm = (ctx.ui as { confirm?: (title: string, message: string) => Promise<boolean> }).confirm;
          const saved = await saveWorkflowSnapshot({
            record,
            scope,
            cwd: ctx.cwd,
            projectTrusted: projectTrusted(ctx),
            confirmOverwrite: confirm ? async (targetPath) => await confirm("Overwrite saved workflow?", targetPath) : undefined,
          });
          ctx.ui.notify(`${saved.changed ? "Saved" : "Already saved"} workflow '${saved.name}' at ${saved.path}.`, "success");
          return;
        }

        const runRequest = action === "run" ? splitFirstToken(rest) : { token: action, rest };
        if (!runRequest.token) {
          ctx.ui.notify(helpText(), "warning");
          return;
        }

        const input = parseJsonObject(runRequest.rest);
        await startRun(runRequest.token, input, ctx);
      } catch (error) {
        const message = error instanceof WorkflowLoadError ? error.issues.join("\n") : errorMessage(error);
        ctx.ui.notify(message, "error");
      }
    },
  });

  pi.registerCommand("workflows", {
    description: "List active and historical workflow runs",
    handler: async (_args, ctx) => {
      ctx.ui.notify(formatRunList(manager.list()), "info");
    },
  });

  pi.registerTool({
    name: "workflow_run",
    label: "Run Workflow",
    description: "Launch a reusable capability-only JavaScript workflow for an explicit workflow request or substantive multi-agent task. Do not use for routine one-agent work.",
    parameters: Type.Object({
      key: Type.Optional(Type.String({ description: "Legacy saved-workflow key. Prefer name for new calls." })),
      name: Type.Optional(Type.String({ description: "Saved workflow name, for example deep-research-minimal." })),
      script: Type.Optional(Type.String({ description: "Generated JavaScript workflow source beginning with export const meta." })),
      scriptPath: Type.Optional(Type.String({ description: "Path to a .js workflow under bundled, user, or trusted-project workflow directories. Takes precedence over script and name." })),
      resumeFromRunId: Type.Optional(Type.String({ description: "Existing run ID to resume through replay once replay support is available." })),
      input: Type.Optional(Type.Any({ description: "Legacy alias for structured workflow arguments." })),
      args: Type.Optional(Type.Any({ description: "Structured workflow arguments exposed through the script's args global." })),
      confirmRun: Type.Boolean({ description: "Must be true only when the user explicitly requested workflow execution or enabled Workflow Mode. Launch approval may still be required." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!params.confirmRun) {
        throw new Error("Blocked: confirmRun must be true with explicit user intent.");
      }
      const input = params.args ?? params.input;
      const name = params.name ?? params.key;
      if (params.resumeFromRunId) throw new Error("resumeFromRunId requires replay support from milestone M7 and is not available yet.");
      if (!params.scriptPath && !params.script && !name) throw new Error("workflow_run requires scriptPath, script, name, or legacy key.");
      const receipt = params.scriptPath
        ? await startScriptPath(params.scriptPath, input, ctx)
        : params.script
          ? await startInlineScript(params.script, input, ctx)
          : await startRun(name as string, input, ctx);
      return {
        content: [{ type: "text", text: `Workflow launched asynchronously.\nRun: ${receipt.runId}\nTask: ${receipt.taskId}` }],
        details: {
          status: receipt.status,
          taskId: receipt.taskId,
          runId: receipt.runId,
          summary: receipt.summary,
          scriptPath: receipt.scriptPath,
        },
        terminate: true,
      };
    },
  });

  pi.registerTool({
    name: "workflow_status",
    label: "Workflow Status",
    description: "Inspect the active or latest Pi workflow run in this session.",
    parameters: Type.Object({ runId: Type.Optional(Type.String({ description: "Optional workflow run ID." })) }),
    async execute(_toolCallId, params) {
      const run = params.runId ? manager.get(params.runId) : manager.active().at(-1) ?? state.getLastRun();
      const record = params.runId ? manager.getRecord(params.runId) : manager.list().at(0);
      return {
        content: [{ type: "text", text: run ? formatRunStatus(run) : formatRunRecord(record) }],
        details: run ?? record ?? null,
      };
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const entries = ctx.sessionManager?.getEntries?.() ?? [];
    const restored = state.restoreFromEntries(entries as never);
    approvals.restoreFromEntries(entries as never);
    mode.restoreFromEntries(entries as never);
    mode.render(ctx);
    publishWorkflowMode();
    const sessionId = ctx.sessionManager?.getSessionId?.() ?? "ephemeral";
    try { rememberSources(await loadSources(ctx)); } catch { /* command execution reports loader errors when requested */ }
    const diskRuns = await manager.restore(createWorkflowRunStorage({ sessionId }));
    if (diskRuns.some((record) => record.status === "failed" && record.finishedAt)) {
      notifyWorkflow(ctx, "Recovered inspectable workflow state from a previous host lifecycle.", "warning");
    }
    renderWorkflowRun(ctx, manager.active().at(-1) ?? restored);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!mode.isEnabled()) return;
    if (conflictingExclusiveMode) {
      mode.setRunning(false, ctx);
      notifyWorkflow(ctx, `Workflow Mode did not run because exclusive mode '${conflictingExclusiveMode}' is active. Disable one mode and retry.`, "warning");
      return;
    }
    mode.setRunning(true, ctx);
    return { systemPrompt: mode.buildSystemPrompt(event.systemPrompt) };
  });

  pi.on("agent_end", async (_event, ctx) => {
    mode.finishTurn(ctx);
    publishWorkflowMode();
  });

  pi.on("session_shutdown", async () => {
    await manager.shutdown();
  });

  pi.registerCommand("workflow-clear", {
    description: "Clear workflow status UI",
    handler: async (_args, ctx) => {
      clearWorkflowUI(ctx);
      ctx.ui.notify("Workflow UI cleared.", "info");
    },
  });
}
