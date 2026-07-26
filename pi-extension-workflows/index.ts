import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createWorkflowApprovalStore } from "./src/approval.ts";
import { createWorkflowBundle, importWorkflowBundle, writeWorkflowBundle } from "./src/bundles.ts";
import { WorkflowLoadError, errorMessage } from "./src/errors.ts";
import { EXCLUSIVE_MODE_EVENT, WORKFLOW_EXCLUSIVE_MODE_ID, exclusiveModeEvent, isExclusiveModeEvent } from "./src/exclusive-mode.ts";
import { requestWorkflowLaunchApproval } from "./src/launch-approval.ts";
import { buildWorkflowInspectorPayload, WORKFLOW_INSPECTOR_WIDGET_KEY, workflowInspectorPayloadLine, type WorkflowInspectorAgent } from "./src/inspector.ts";
import { findWorkflowSource, formatWorkflowList, loadWorkflowRegistry, loadWorkflowScriptPath, workflowSourceKey } from "./src/loader.ts";
import { hashWorkflowPolicy, workflowProjectIdentity, type WorkflowRunRecordV1 } from "./src/persistence-schema.ts";
import { deniedRequestedPermissions, loadWorkflowPolicyCeiling, policyCeilingForScript, type WorkflowPolicyCeilingV1 } from "./src/policy.ts";
import { createDeniedWorkflowPolicy, readWorkflowPolicyState, validateWorkflowPolicy, WORKFLOW_POLICY_SUGGESTIONS, writeWorkflowPolicyState } from "./src/workflow-policy.mjs";
import { loadWorkflowReplayCache, type WorkflowReplayCache } from "./src/replay.ts";
import { runWorkflow } from "./src/runner.ts";
import { WorkflowRunManager, type WorkflowRunLaunchReceipt } from "./src/run-manager.ts";
import { createWorkflowRunStorage } from "./src/run-storage.ts";
import { createWorkflowModeController, workflowModeDescription } from "./src/mode.ts";
import { parseWorkflowScript } from "./src/script-parser.ts";
import { createJavaScriptRun, effectiveScript, runJavaScriptWorkflow } from "./src/script-runner.ts";
import { saveWorkflowSnapshot } from "./src/saved-workflows.ts";
import { WorkflowScheduleStore } from "./src/schedules.ts";
import { createWorkflowRun, createWorkflowStateStore } from "./src/state.ts";
import { createSubprocessTaskRunner } from "./src/task-runner.ts";
import { publishWorkflowSubagentsSnapshot } from "./src/webui-subagents.ts";
import { formatWorkflowScript, importClaudeWorkflowScript } from "./src/tooling.ts";
import type { TaskRunner, WorkflowInput, WorkflowJavaScriptSource, WorkflowRun, WorkflowScriptPolicy, WorkflowSource } from "./src/types.ts";
import { clearWorkflowUI, notifyWorkflow, renderWorkflowRun, type WorkflowUIContext } from "./src/ui.ts";
import { parseJsonObject, splitFirstToken } from "./src/utils.ts";
import { applyWorkflowWorktrees, cleanupWorkflowWorktrees, listWorkflowWorktrees } from "./src/worktree.ts";

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
    "  /workflow pause <run-id>",
    "  /workflow resume <run-id>",
    "  /workflow abort [run-id]",
    "  /workflow retry <run-id> <call-id>",
    "  /workflow worktrees <run-id>",
    "  /workflow apply <run-id>",
    "  /workflow cleanup <run-id>",
    "  /workflow save <run-id> --project|--user",
    "  /workflow format <trusted-workflow-path>",
    "  /workflow import-claude <path>",
    "  /workflow bundle export <run-id> <bundle-path>",
    "  /workflow bundle import <bundle-path> --project|--user",
    "  /workflow schedule list|add|remove|run-due",
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

function parseWorkflowSetupList(value: string): string[] {
  return [...new Set(value.split("\n").map((entry) => entry.trim()).filter(Boolean))].sort();
}

function parseWorkflowSetupVerificationCommands(value: string): string[][] {
  const commands: string[][] = [];
  for (const [index, line] of value.split("\n").entries()) {
    if (!line.trim()) continue;
    let command: unknown;
    try {
      command = JSON.parse(line);
    } catch (error) {
      throw new Error(`Verification command line ${index + 1} is not valid JSON: ${errorMessage(error)}`);
    }
    if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== "string" || !part.length)) {
      throw new Error(`Verification command line ${index + 1} must be a non-empty JSON string argv array.`);
    }
    commands.push(command as string[]);
  }
  return commands;
}

async function selectWorkflowSetupPermission(
  ui: NonNullable<WorkflowUIContext["ui"]>,
  permission: "write" | "shell" | "network",
  current: boolean,
): Promise<boolean | undefined> {
  const choice = await ui.select!(
    `Workflow ${permission} permission`,
    [
      `Allow ${permission} (${current ? "currently allowed" : "currently denied"})`,
      `Deny ${permission} (${current ? "currently allowed" : "currently denied"})`,
      "Cancel setup",
    ],
  );
  if (!choice || choice === "Cancel setup") return undefined;
  return choice.startsWith("Allow ");
}

async function selectWorkflowSetupSuggestions<T>(
  ui: NonNullable<WorkflowUIContext["ui"]>,
  title: string,
  current: readonly T[],
  suggestions: readonly T[],
  format: (suggestion: T) => string,
): Promise<T[] | undefined> {
  const selected = [...current];
  while (true) {
    const remaining = suggestions.filter((suggestion) => !selected.some((entry) => format(entry) === format(suggestion)));
    const choices = [
      "Continue to manual editor",
      ...remaining.map((suggestion) => `Add: ${format(suggestion)}`),
      "Cancel setup",
    ];
    const choice = await ui.select!(title, choices);
    if (!choice || choice === "Cancel setup") return undefined;
    if (choice === "Continue to manual editor") return selected;
    const selectedSuggestion = remaining.find((suggestion) => `Add: ${format(suggestion)}` === choice);
    if (selectedSuggestion) selected.push(selectedSuggestion);
  }
}

async function openWorkflowSetup(ctx: { cwd: string } & WorkflowUIContext): Promise<void> {
  const ui = ctx.ui;
  if (!ui?.select || !ui.editor || !ui.confirm) {
    throw new Error("/workflow-setup requires an interactive Pi UI with selection, editor, and confirmation support.");
  }

  const state = await readWorkflowPolicyState();
  ui.notify?.([
    "Workflow setup edits the global user authorization ceiling only; it is not blanket permission.",
    "Every workflow and agent call still needs its own explicit requested capability.",
    "A shell allowlist limits admitted commands but is not an OS sandbox.",
  ].join("\n"), "info");
  const action = await ui.select("Workflow permission ceiling", [
    "Configure global policy",
    "Reset global policy to deny-by-default",
    "Cancel setup",
  ]);
  if (!action || action === "Cancel setup") return;

  let candidate: WorkflowPolicyCeilingV1;
  if (action === "Reset global policy to deny-by-default") {
    candidate = createDeniedWorkflowPolicy() as WorkflowPolicyCeilingV1;
  } else {
    const write = await selectWorkflowSetupPermission(ui, "write", state.policy.permissions.write);
    if (write === undefined) return;
    const shell = await selectWorkflowSetupPermission(ui, "shell", state.policy.permissions.shell);
    if (shell === undefined) return;
    const network = await selectWorkflowSetupPermission(ui, "network", state.policy.permissions.network);
    if (network === undefined) return;

    const suggestedShellAllowlist = await selectWorkflowSetupSuggestions(
      ui,
      "Shell executable suggestions",
      state.policy.shellAllowlist,
      WORKFLOW_POLICY_SUGGESTIONS.shellAllowlist,
      (suggestion) => suggestion,
    );
    if (!suggestedShellAllowlist) return;
    const shellAllowlist = await ui.editor("Shell executable allowlist (one entry per line; not an OS sandbox)", suggestedShellAllowlist.join("\n"));
    if (shellAllowlist === undefined) return;

    const suggestedNetworkAllowlist = await selectWorkflowSetupSuggestions(
      ui,
      "Network host suggestions",
      state.policy.networkAllowlist,
      WORKFLOW_POLICY_SUGGESTIONS.networkAllowlist,
      (suggestion) => suggestion,
    );
    if (!suggestedNetworkAllowlist) return;
    const networkAllowlist = await ui.editor("Network host allowlist (one entry per line)", suggestedNetworkAllowlist.join("\n"));
    if (networkAllowlist === undefined) return;

    const suggestedVerificationCommands = await selectWorkflowSetupSuggestions(
      ui,
      "Verification command suggestions",
      state.policy.verificationCommands,
      WORKFLOW_POLICY_SUGGESTIONS.verificationCommands,
      (suggestion) => JSON.stringify(suggestion),
    );
    if (!suggestedVerificationCommands) return;
    const verificationCommands = await ui.editor("Verification commands (one JSON argv array per line)", suggestedVerificationCommands.map((command) => JSON.stringify(command)).join("\n"));
    if (verificationCommands === undefined) return;

    candidate = validateWorkflowPolicy({
      schemaVersion: 1,
      permissions: { write, shell, network },
      shellAllowlist: parseWorkflowSetupList(shellAllowlist),
      networkAllowlist: parseWorkflowSetupList(networkAllowlist),
      verificationCommands: parseWorkflowSetupVerificationCommands(verificationCommands),
    }, "workflow setup") as WorkflowPolicyCeilingV1;
  }

  const verificationNote = candidate.verificationCommands.length
    ? `Verification commands: ${candidate.verificationCommands.length} configured.`
    : "Verification commands: none — applying workflow worktrees will require an explicit waiver.";
  const reviewed = await ui.confirm("Review workflow permission ceiling", [
    `Target: ${state.filePath}`,
    `Revision: ${state.revision ?? "missing (file is created only after Save)"}`,
    "This is an authorization ceiling, not blanket permission.",
    "Shell allowlists constrain admitted commands only; they are not an OS sandbox.",
    verificationNote,
    "",
    "Normalized policy:",
    JSON.stringify(candidate, null, 2),
  ].join("\n"));
  if (!reviewed) return;

  const saved = await writeWorkflowPolicyState({ policy: candidate, expectedRevision: state.revision });
  ui.notify?.(`Saved global workflow permission ceiling at ${saved.filePath}.`, "success");
}

function inspectValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function largeWorkflowWarnings(policy: WorkflowScriptPolicy): string[] {
  const agentThreshold = Math.max(1, Number(process.env.PI_WORKFLOW_WARN_AGENTS) || 20);
  const tokenThreshold = Math.max(1, Number(process.env.PI_WORKFLOW_WARN_TOKENS) || 100_000);
  const warnings: string[] = [];
  if (policy.maxAgents > agentThreshold) warnings.push(`Large workflow: policy allows ${policy.maxAgents} agents (warning threshold ${agentThreshold}).`);
  const projectedTokens = policy.budgets?.run?.maxTokens;
  if (projectedTokens && projectedTokens > tokenThreshold) warnings.push(`Large workflow: token budget ${projectedTokens} exceeds warning threshold ${tokenThreshold}.`);
  return warnings;
}

function formatAgentInspection(agent: WorkflowInspectorAgent): string {
  const activity = agent.recentEvents.slice(-8).map((event) => {
    const timestamp = typeof event.timestamp === "string" ? event.timestamp : "";
    const detail = event.line ?? event.command ?? event.eventType ?? event.type ?? "event";
    return `- ${timestamp} ${String(detail)}`.trimEnd();
  }).join("\n") || "—";
  return [
    `Agent: ${agent.name}`,
    `Call: ${agent.callId}`,
    `Status: ${agent.status}`,
    `Prompt:\n${agent.prompt || "—"}`,
    `Recent activity:\n${activity}`,
    `Result:\n${inspectValue(agent.result)}`,
    `Usage:\n${inspectValue(agent.usage)}`,
    agent.error ? `Error:\n${agent.error}` : undefined,
  ].filter(Boolean).join("\n\n");
}

export default function workflowExtension(pi: ExtensionAPI, dependencies: { taskRunner?: TaskRunner } = {}) {
  const state = createWorkflowStateStore(pi);
  const approvals = createWorkflowApprovalStore(pi);
  const mode = createWorkflowModeController(pi);
  const taskRunner = dependencies.taskRunner ?? createSubprocessTaskRunner();
  const schedules = new WorkflowScheduleStore();
  let schedulesLoaded = false;
  const ensureSchedules = async () => {
    if (!schedulesLoaded) { await schedules.load(); schedulesLoaded = true; }
    return schedules;
  };
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
  const activateWorkflowTools = () => {
    const required = ["workflow_run", "workflow_status"];
    const active = pi.getActiveTools();
    const missing = required.filter((name) => !active.includes(name));
    if (missing.length === 0) return;

    const available = new Set(pi.getAllTools().map((tool) => tool.name));
    const unavailable = missing.filter((name) => !available.has(name));
    if (unavailable.length > 0) {
      throw new Error(`Workflow Mode cannot start because required tools are unavailable: ${unavailable.join(", ")}.`);
    }

    pi.setActiveTools([...new Set([...active, ...required])]);
    const stillMissing = required.filter((name) => !pi.getActiveTools().includes(name));
    if (stillMissing.length > 0) {
      throw new Error(`Workflow Mode could not activate required tools: ${stillMissing.join(", ")}.`);
    }
  };
  const assertWorkflowModeAvailable = () => {
    if (conflictingExclusiveMode) throw new Error(`Workflow Mode conflicts with active exclusive mode '${conflictingExclusiveMode}'. Disable that mode first.`);
  };

  let publishWorkflowSubagents = () => {};
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
      publishWorkflowSubagents();
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
  publishWorkflowSubagents = () => {
    publishWorkflowSubagentsSnapshot(manager, (event, snapshot) => { pi.events?.emit?.(event, snapshot); });
  };

  let inspectorPublishSequence = 0;
  const publishInspector = async (ctx: { cwd: string } & WorkflowUIContext, storage?: ReturnType<typeof createWorkflowRunStorage>) => {
    if (ctx.hasUI === false || ctx.mode !== "rpc" || !ctx.ui) return;
    const sequence = ++inspectorPublishSequence;
    const sessionId = (ctx as { sessionManager?: { getSessionId?: () => string } }).sessionManager?.getSessionId?.() ?? "ephemeral";
    const payload = await buildWorkflowInspectorPayload({ manager, storage: storage ?? createWorkflowRunStorage({ sessionId }), mode: mode.getState() });
    if (sequence !== inspectorPublishSequence) return;
    ctx.ui.setWidget?.(WORKFLOW_INSPECTOR_WIDGET_KEY, [workflowInspectorPayloadLine(payload)]);
  };

  const startSource = async (
    source: WorkflowSource,
    input: unknown,
    ctx: { cwd: string } & WorkflowUIContext,
    replayOptions?: { sourceRunId: string; excludeCallIds?: string[] },
  ): Promise<WorkflowRunLaunchReceipt> => {
    const sessionId = (ctx as { sessionManager?: { getSessionId?: () => string } }).sessionManager?.getSessionId?.() ?? "ephemeral";
    const storage = createWorkflowRunStorage({ sessionId });
    let replay: WorkflowReplayCache | undefined;
    let effectiveInput = input;
    if (replayOptions) {
      const sourceRecord = manager.getRecord(replayOptions.sourceRunId);
      if (!sourceRecord) throw new Error(`Unknown workflow run '${replayOptions.sourceRunId}'.`);
      if (sourceRecord.sessionId !== sessionId) throw new Error("Replay is limited to runs in the current session.");
      if (sourceRecord.sourceType !== "javascript") throw new Error("Only JavaScript workflow runs can be resumed.");
      replay = await loadWorkflowReplayCache(storage, sourceRecord.runId, { excludeCallIds: replayOptions.excludeCallIds });
      effectiveInput ??= sourceRecord.input ?? {};
    }
    if (source.sourceType === "json") {
      notifyWorkflow(ctx, `Legacy JSON workflow '${source.definition.key}' is deprecated. Save or rewrite it as a .js workflow before JSON execution is removed.`, "warning");
    }
    const projectId = await workflowProjectIdentity(ctx.cwd);
    const run = source.sourceType === "javascript"
      ? createJavaScriptRun(source, effectiveInput)
      : createWorkflowRun(source.definition, normalizeInput(effectiveInput), source.path);
    if (replay) run.resumedFromRunId = replay.sourceRunId;
    run.projectId = projectId;
    let javaScriptPolicy;
    if (source.sourceType === "javascript") {
      const ceiling = await loadWorkflowPolicyCeiling({ cwd: ctx.cwd, projectTrusted: projectTrusted(ctx) });
      const denied = deniedRequestedPermissions(source.script.meta.pi.permissions, ceiling);
      if (denied.length) throw new Error(`Workflow policy denied requested capabilities: ${denied.join(", ")}. Configure explicit user${projectTrusted(ctx) ? "/project" : ""} workflow-policy.json ceilings.`);
      javaScriptPolicy = effectiveScript(source.script, policyCeilingForScript(ceiling)).meta.pi;
      run.warnings = largeWorkflowWarnings(javaScriptPolicy);
    }
    const policySnapshot = source.sourceType === "javascript"
      ? javaScriptPolicy!
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
        plan: [
          `Repository: ${ctx.cwd}`,
          `Isolation: ${policySnapshot.permissions.write ? "one git worktree per write agent; serial confirmed apply" : "read-only working directory"}`,
          `Capabilities: write=${policySnapshot.permissions.write}, shell=${policySnapshot.permissions.shell}, network=${policySnapshot.permissions.network}`,
          policySnapshot.shellAllowlist?.length ? `Shell allowlist: ${policySnapshot.shellAllowlist.join(", ")}` : undefined,
          policySnapshot.networkAllowlist?.length ? `Network allowlist: ${policySnapshot.networkAllowlist.join(", ")}` : undefined,
          ...(run.warnings ?? []),
        ].filter(Boolean).join("\n"),
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
        const commonOptions = {
          cwd: ctx.cwd,
          taskRunner,
          state,
          storage,
          run,
          signal,
          onRunUpdate: (updated: WorkflowRun) => {
            onRunUpdate(updated);
            publishWorkflowSubagents();
            void publishInspector(ctx, storage);
          },
        };
        return source.sourceType === "javascript"
          ? await runJavaScriptWorkflow(source, effectiveInput, ctx, { ...commonOptions, replay, policy: javaScriptPolicy })
          : await runWorkflow(source, normalizeInput(effectiveInput), ctx, commonOptions);
      },
    });
    publishWorkflowSubagents();
    void publishInspector(ctx, storage);
    notifyWorkflow(ctx, `Workflow launched: ${workflowSourceKey(source)} (${receipt.runId})`, "info");
    return receipt;
  };

  const startRun = async (
    key: string,
    input: unknown,
    ctx: { cwd: string } & WorkflowUIContext,
    replayOptions?: { sourceRunId: string; excludeCallIds?: string[] },
  ): Promise<WorkflowRunLaunchReceipt> => {
    const sources = rememberSources(await loadSources(ctx));
    const source = findWorkflowSource(sources, key);
    if (!source) {
      const available = sources.map(workflowSourceKey).join(", ") || "none";
      throw new Error(`Unknown workflow '${key}'. Available workflows: ${available}.`);
    }
    return await startSource(source, input, ctx, replayOptions);
  };

  const startInlineScript = async (
    sourceCode: string,
    input: unknown,
    ctx: { cwd: string } & WorkflowUIContext,
    replayOptions?: { sourceRunId: string; excludeCallIds?: string[] },
  ): Promise<WorkflowRunLaunchReceipt> => {
    const script = parseWorkflowScript(sourceCode, { sourcePath: "inline-workflow.js" });
    const source: WorkflowJavaScriptSource = {
      path: `inline:${script.sourceHash.slice(0, 16)}`,
      scope: "inline",
      sourceType: "javascript",
      script,
    };
    return await startSource(source, input, ctx, replayOptions);
  };

  const startScriptPath = async (
    reference: string,
    input: unknown,
    ctx: { cwd: string } & WorkflowUIContext,
    replayOptions?: { sourceRunId: string; excludeCallIds?: string[] },
  ): Promise<WorkflowRunLaunchReceipt> => {
    const source = await loadWorkflowScriptPath(reference, {
      cwd: ctx.cwd,
      extensionDir: EXTENSION_DIR,
      includeUser: true,
      includeProject: true,
      projectTrusted: projectTrusted(ctx),
    });
    return await startSource(source, input, ctx, replayOptions);
  };

  const startResume = async (
    sourceRunId: string,
    input: unknown,
    ctx: { cwd: string } & WorkflowUIContext,
    excludeCallIds: string[] = [],
  ): Promise<WorkflowRunLaunchReceipt> => {
    const record = manager.getRecord(sourceRunId);
    if (!record) throw new Error(`Unknown workflow run '${sourceRunId}'.`);
    if (record.sourceType !== "javascript" || !record.snapshotPath) throw new Error("Only JavaScript runs with immutable snapshots can be resumed.");
    const sourceCode = await readFile(record.snapshotPath, "utf8");
    const script = parseWorkflowScript(sourceCode, { sourcePath: record.snapshotPath });
    const source: WorkflowJavaScriptSource = { path: record.snapshotPath, scope: "inline", sourceType: "javascript", script };
    return await startSource(source, input, ctx, { sourceRunId, excludeCallIds });
  };

  const saveRun = async (runId: string, scope: "project" | "user", ctx: { cwd: string } & WorkflowUIContext) => {
    const record = manager.getRecord(runId);
    if (!record) throw new Error(`Unknown workflow run '${runId}'.`);
    const saved = await saveWorkflowSnapshot({
      record,
      scope,
      cwd: ctx.cwd,
      projectTrusted: projectTrusted(ctx),
      confirmOverwrite: ctx.ui?.confirm ? async (targetPath) => await ctx.ui!.confirm!("Overwrite saved workflow?", targetPath) : undefined,
    });
    ctx.ui?.notify?.(`${saved.changed ? "Saved" : "Already saved"} workflow '${saved.name}' at ${saved.path}.`, "success");
    return saved;
  };

  const openNativeInspector = async (ctx: { cwd: string } & WorkflowUIContext) => {
    const sessionId = (ctx as { sessionManager?: { getSessionId?: () => string } }).sessionManager?.getSessionId?.() ?? "ephemeral";
    const payload = await buildWorkflowInspectorPayload({ manager, storage: createWorkflowRunStorage({ sessionId }), mode: mode.getState() });
    if (payload.runs.length === 0) {
      ctx.ui?.notify?.("No workflow runs have been recorded in this session.", "info");
      return;
    }
    if (!ctx.ui?.select) {
      ctx.ui?.notify?.(formatRunList(manager.list()), "info");
      return;
    }
    const runOptions = payload.runs.map((run) => `[${run.status}] ${run.workflowName} — ${run.runId}`);
    const selectedRunLabel = await ctx.ui.select("Select workflow run", runOptions);
    const selectedRun = payload.runs[runOptions.indexOf(selectedRunLabel ?? "")];
    if (!selectedRun) return;
    const actions = [
      ...(selectedRun.phases.length ? ["Inspect phases and agents"] : []),
      ...(selectedRun.controls.canPause ? ["Pause"] : []),
      ...(selectedRun.controls.canResume ? [selectedRun.status === "paused" ? "Resume" : "Replay"] : []),
      ...(selectedRun.controls.canAbort ? ["Abort"] : []),
      ...(selectedRun.controls.canSave ? ["Save"] : []),
      ...(selectedRun.script ? ["View raw script"] : []),
      "Show run summary",
    ];
    const action = await ctx.ui.select(`${selectedRun.workflowName} (${selectedRun.status})`, actions);
    if (!action) return;
    if (action === "Pause") {
      if (!manager.pause(selectedRun.runId)) throw new Error("Run is no longer pausable.");
      ctx.ui.notify?.("Run paused. Active agent calls may finish; no new calls will start.", "warning");
    } else if (action === "Resume") {
      if (!manager.resume(selectedRun.runId)) throw new Error("Run is no longer paused.");
      ctx.ui.notify?.("Run resumed.", "success");
    } else if (action === "Replay") {
      if (!ctx.ui.confirm || !(await ctx.ui.confirm("Replay workflow?", `Launch a replay of ${selectedRun.runId}?`))) return;
      await startResume(selectedRun.runId, undefined, ctx);
    } else if (action === "Abort") {
      if (!ctx.ui.confirm || !(await ctx.ui.confirm("Abort workflow?", `Abort ${selectedRun.runId} and its active subprocesses?`))) return;
      if (!manager.abort(selectedRun.runId)) throw new Error("Run is no longer abortable.");
    } else if (action === "Save") {
      const scopeLabel = await ctx.ui.select("Save workflow", ["User workflow", "Project workflow"]);
      if (scopeLabel) await saveRun(selectedRun.runId, scopeLabel === "Project workflow" ? "project" : "user", ctx);
    } else if (action === "View raw script") {
      ctx.ui.notify?.(selectedRun.script ?? "No script snapshot is available.", "info");
    } else if (action === "Inspect phases and agents") {
      const phaseOptions = selectedRun.phases.map((phase) => `[${phase.status}] ${phase.name} — ${phase.phaseId}`);
      const phaseLabel = await ctx.ui.select("Select workflow phase", phaseOptions);
      const phase = selectedRun.phases[phaseOptions.indexOf(phaseLabel ?? "")];
      if (!phase) return;
      if (phase.agents.length === 0) {
        ctx.ui.notify?.(`Phase ${phase.name}\nStatus: ${phase.status}\nUsage: ${inspectValue(phase.usage)}\n${phase.error ? `Error: ${phase.error}` : ""}`, "info");
        return;
      }
      const agentOptions = phase.agents.map((agent) => `[${agent.status}] ${agent.name} — ${agent.callId}`);
      const agentLabel = await ctx.ui.select("Select workflow agent", agentOptions);
      const agent = phase.agents[agentOptions.indexOf(agentLabel ?? "")];
      if (!agent) return;
      ctx.ui.notify?.(formatAgentInspection(agent), agent.error ? "error" : "info");
      if (selectedRun.controls.canRetry) {
        const retry = await ctx.ui.select("Agent action", ["Close", "Retry agent"]);
        if (retry === "Retry agent" && ctx.ui.confirm && await ctx.ui.confirm("Retry workflow agent?", `Retry ${agent.callId}; unrelated calls remain cached?`)) {
          await startResume(selectedRun.runId, undefined, ctx, [agent.callId]);
        }
      }
    } else {
      ctx.ui.notify?.([
        `Workflow: ${selectedRun.workflowName}`,
        `Run: ${selectedRun.runId}`,
        `Status: ${selectedRun.status}`,
        `Usage: ${inspectValue(selectedRun.usage)}`,
        `Result: ${inspectValue(selectedRun.result)}`,
        selectedRun.error ? `Error: ${selectedRun.error}` : undefined,
      ].filter(Boolean).join("\n"), selectedRun.error ? "error" : "info");
    }
    void publishInspector(ctx);
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
      if (["status", "pause", "resume", "abort", "retry", "worktrees", "apply", "cleanup"].includes(action)) return complete(manager.list().map((record) => record.runId), action);
      if (action === "save") {
        if (tailParts.length <= 1) return complete(manager.list().map((record) => record.runId), "save");
        const runId = tailParts[0];
        const flagQuery = tailParts.at(-1) ?? "";
        const flags = ["--project", "--user"].filter((flag) => flag.startsWith(flagQuery));
        return flags.map((flag) => ({ value: `save ${runId} ${flag}`, label: flag }));
      }
      if (action === "mode") return complete(["once", "on", "off", "toggle", "status"], "mode");
      return complete(["list", "status", "mode", "run", "pause", "resume", "abort", "retry", "worktrees", "apply", "cleanup", "save", "format", "import-claude", "bundle", "schedule", ...knownWorkflowNames].sort());
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

        if (action === "format") {
          const { token: reference } = splitFirstToken(rest);
          if (!reference) throw new Error("Usage: /workflow format <trusted-workflow-path>");
          const source = await loadWorkflowScriptPath(reference, { cwd: ctx.cwd, extensionDir: EXTENSION_DIR, includeUser: true, includeProject: true, projectTrusted: projectTrusted(ctx) });
          if (source.scope === "bundled") throw new Error("Bundled workflows are immutable; copy one to user or project scope before formatting.");
          const formatted = formatWorkflowScript(source.script.source, source.path);
          if (formatted === source.script.source) { ctx.ui.notify("Workflow is already formatted.", "info"); return; }
          if (!ctx.ui.confirm || !(await ctx.ui.confirm("Format workflow source?", `Rewrite ${source.path} using deterministic whitespace formatting?`))) return;
          await writeFile(source.path, formatted, { mode: 0o600 });
          ctx.ui.notify(`Formatted ${source.path}.`, "success");
          return;
        }

        if (action === "import-claude") {
          const { token: reference } = splitFirstToken(rest);
          if (!reference) throw new Error("Usage: /workflow import-claude <path>");
          const report = importClaudeWorkflowScript(await readFile(reference, "utf8"), reference);
          if (!report.supported) throw new Error(`Claude-shaped workflow is unsupported without silent rewriting:\n- ${report.unsupported.join("\n- ")}`);
          ctx.ui.notify(`${report.warnings.join("\n")}${report.warnings.length ? "\n\n" : ""}${report.source}`, "info");
          return;
        }

        if (action === "bundle") {
          const { token: bundleAction, rest: bundleRest } = splitFirstToken(rest);
          const { token: first, rest: secondRest } = splitFirstToken(bundleRest);
          if (bundleAction === "export") {
            const { token: targetPath } = splitFirstToken(secondRest);
            if (!first || !targetPath) throw new Error("Usage: /workflow bundle export <run-id> <bundle-path>");
            const record = manager.getRecord(first);
            if (!record) throw new Error(`Unknown workflow run '${first}'.`);
            const storage = createWorkflowRunStorage({ sessionId: record.sessionId });
            const bundle = await createWorkflowBundle(record, storage);
            const saved = await writeWorkflowBundle(bundle, targetPath, ctx.ui.confirm ? async (filePath) => await ctx.ui!.confirm!("Overwrite workflow bundle?", filePath) : undefined);
            ctx.ui.notify(`Exported workflow bundle to ${saved}.`, "success");
            return;
          }
          if (bundleAction === "import") {
            const flags = secondRest.split(/\s+/).filter(Boolean);
            const scope = flags.includes("--project") ? "project" : flags.includes("--user") ? "user" : undefined;
            if (!first || !scope || (flags.includes("--project") && flags.includes("--user"))) throw new Error("Usage: /workflow bundle import <bundle-path> --project|--user");
            const imported = await importWorkflowBundle({ bundlePath: first, scope, cwd: ctx.cwd, projectTrusted: projectTrusted(ctx), confirmConflict: ctx.ui.confirm ? async (filePath) => await ctx.ui!.confirm!("Replace conflicting workflow?", filePath) : undefined });
            ctx.ui.notify(`Imported workflow bundle to ${imported}.`, "success");
            return;
          }
          throw new Error("Usage: /workflow bundle export|import ...");
        }

        if (action === "schedule") {
          const store = await ensureSchedules();
          const { token: scheduleAction, rest: scheduleRest } = splitFirstToken(rest);
          if (!scheduleAction || scheduleAction === "list") {
            const records = store.list();
            ctx.ui.notify(records.length ? records.map((item) => `${item.scheduleId} [${item.enabled ? "enabled" : "disabled"}] ${item.workflowName} @ ${item.nextRunAt}`).join("\n") : "No workflow schedules.", "info");
            return;
          }
          if (scheduleAction === "add") {
            const idPart = splitFirstToken(scheduleRest);
            const namePart = splitFirstToken(idPart.rest);
            const timePart = splitFirstToken(namePart.rest);
            if (!idPart.token || !namePart.token || !timePart.token) throw new Error("Usage: /workflow schedule add <id> <workflow-name> <ISO-time> [json-args]");
            await store.upsert({ schemaVersion: 1, scheduleId: idPart.token, workflowName: namePart.token, args: parseJsonObject(timePart.rest), nextRunAt: new Date(timePart.token).toISOString(), enabled: true });
            ctx.ui.notify(`Scheduled '${namePart.token}' as ${idPart.token}.`, "success");
            return;
          }
          if (scheduleAction === "remove") {
            const { token: scheduleId } = splitFirstToken(scheduleRest);
            if (!scheduleId || !(await store.remove(scheduleId))) throw new Error(`Unknown schedule '${scheduleId}'.`);
            ctx.ui.notify(`Removed schedule ${scheduleId}.`, "success");
            return;
          }
          if (scheduleAction === "run-due") {
            const due = store.due();
            if (!due.length) { ctx.ui.notify("No workflow schedules are due.", "info"); return; }
            if (!ctx.ui.confirm || !(await ctx.ui.confirm("Launch due workflows?", due.map((item) => `${item.scheduleId}: ${item.workflowName}`).join("\n")))) return;
            for (const item of due) {
              await startRun(item.workflowName, item.args, ctx);
              await store.markLaunched(item.scheduleId);
            }
            ctx.ui.notify(`Launched ${due.length} due workflow schedule${due.length === 1 ? "" : "s"}.`, "success");
            return;
          }
          throw new Error("Usage: /workflow schedule list|add|remove|run-due");
        }

        if (action === "mode") {
          const { token: requestedMode } = splitFirstToken(rest);
          const modeAction = requestedMode.toLowerCase() || "status";
          if (modeAction === "on" || modeAction === "enable" || modeAction === "start") {
            assertWorkflowModeAvailable();
            activateWorkflowTools();
            mode.setEnabled(true, ctx);
            publishWorkflowMode();
          } else if (modeAction === "once") {
            assertWorkflowModeAvailable();
            activateWorkflowTools();
            mode.armOnce(ctx);
            publishWorkflowMode();
          } else if (modeAction === "off" || modeAction === "disable" || modeAction === "stop") {
            mode.setEnabled(false, ctx);
            publishWorkflowMode();
          } else if (modeAction === "toggle") {
            if (!mode.isEnabled()) {
              assertWorkflowModeAvailable();
              activateWorkflowTools();
            }
            mode.toggle(ctx);
            publishWorkflowMode();
          } else if (modeAction !== "status") throw new Error("Usage: /workflow mode [once|on|off|toggle|status]");
          ctx.ui.notify(workflowModeDescription(mode.getState()), "info");
          void publishInspector(ctx);
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

        if (action === "pause") {
          const { token: runId } = splitFirstToken(rest);
          if (!runId || !manager.pause(runId)) throw new Error("Usage: /workflow pause <running-run-id>");
          publishWorkflowSubagents();
          ctx.ui.notify(`Workflow run ${runId} paused. Active agent calls may finish; no new calls will start.`, "warning");
          return;
        }

        if (action === "resume") {
          const { token: runId, rest: resumeArgs } = splitFirstToken(rest);
          if (!runId) throw new Error("Usage: /workflow resume <run-id> [json-args]");
          if (manager.resume(runId)) {
            publishWorkflowSubagents();
            ctx.ui.notify(`Workflow run ${runId} resumed.`, "success");
            return;
          }
          const receipt = await startResume(runId, resumeArgs.trim() ? parseJsonObject(resumeArgs) : undefined, ctx);
          ctx.ui.notify(`Workflow replay launched as ${receipt.runId}.`, "success");
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

        if (action === "retry") {
          const { token: runId, rest: callRest } = splitFirstToken(rest);
          const { token: callId } = splitFirstToken(callRest);
          if (!runId || !callId) throw new Error("Usage: /workflow retry <run-id> <call-id>");
          const confirm = (ctx.ui as { confirm?: (title: string, message: string) => Promise<boolean> }).confirm;
          if (!confirm || !(await confirm("Retry workflow agent?", `Retry ${callId} from ${runId}; unchanged calls will be replayed from cache.`))) {
            throw new Error("Agent retry cancelled.");
          }
          const receipt = await startResume(runId, undefined, ctx, [callId]);
          ctx.ui.notify(`Agent retry replay launched as ${receipt.runId}.`, "success");
          return;
        }

        if (action === "worktrees" || action === "apply" || action === "cleanup") {
          const { token: runId } = splitFirstToken(rest);
          if (!runId) throw new Error(`Usage: /workflow ${action} <run-id>`);
          const record = manager.getRecord(runId);
          if (!record) throw new Error(`Unknown workflow run '${runId}'.`);
          const sessionId = (ctx as { sessionManager?: { getSessionId?: () => string } }).sessionManager?.getSessionId?.() ?? "ephemeral";
          if (record.sessionId !== sessionId) throw new Error("Worktree controls are limited to the current session.");
          const storage = createWorkflowRunStorage({ sessionId });
          const runDir = await storage.runDirectory(runId);
          const worktrees = await listWorkflowWorktrees(runDir);
          if (action === "worktrees") {
            ctx.ui.notify(worktrees.length ? worktrees.map((unit) => `${unit.callId} [${unit.status}] ${unit.worktreePath}\n  ${unit.changedFiles.join(", ") || "no changed files"}`).join("\n") : "No isolated write worktrees were recorded.", "info");
            return;
          }
          if (!ctx.ui.confirm) throw new Error(`${action} requires interactive confirmation.`);
          if (action === "apply") {
            const changed = worktrees.filter((unit) => unit.status === "changed");
            if (!changed.length) throw new Error("No unapplied worktree patches are available.");
            const files = [...new Set(changed.flatMap((unit) => unit.changedFiles))].sort();
            const policy = await storage.readPolicy(runId) as { verificationCommands?: string[][] };
            const verification = policy.verificationCommands?.length
              ? policy.verificationCommands.map((command) => command.join(" ")).join("; ")
              : "WAIVED — no verificationCommands were configured in the approved policy";
            if (!(await ctx.ui.confirm("Apply workflow patches?", `Repository: ${ctx.cwd}\nFiles: ${files.join(", ")}\nVerification: ${verification}\nPatches are applied serially after verification; confirming explicitly accepts any displayed waiver.`))) return;
            const applied = await applyWorkflowWorktrees(runDir, policy.verificationCommands ?? []);
            ctx.ui.notify(`Applied ${applied.length} isolated workflow patch${applied.length === 1 ? "" : "es"}.`, "success");
          } else {
            if (!(await ctx.ui.confirm("Clean workflow worktrees?", "Only clean or already-applied worktrees are removed. Unmerged changes are always preserved."))) return;
            const result = await cleanupWorkflowWorktrees(runDir);
            ctx.ui.notify(`Removed ${result.removed.length}; preserved ${result.preserved.length} worktree${result.preserved.length === 1 ? "" : "s"} with changes.`, result.preserved.length ? "warning" : "success");
          }
          return;
        }

        if (action === "save") {
          const parts = rest.trim().split(/\s+/).filter(Boolean);
          const runId = parts.find((part) => !part.startsWith("--"));
          const scope = parts.includes("--project") ? "project" : parts.includes("--user") ? "user" : undefined;
          if (!runId || !scope || (parts.includes("--project") && parts.includes("--user"))) {
            throw new Error("Usage: /workflow save <run-id> --project|--user");
          }
          await saveRun(runId, scope, ctx);
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

  pi.registerCommand("workflow-setup", {
    description: "Review and save the global workflow permission ceiling",
    handler: async (args, ctx) => {
      try {
        if (args.trim()) throw new Error("Usage: /workflow-setup");
        await openWorkflowSetup(ctx);
      } catch (error) {
        ctx.ui.notify(errorMessage(error), "error");
      }
    },
  });

  pi.registerCommand("workflows", {
    description: "Select and inspect active or historical workflow runs",
    handler: async (_args, ctx) => {
      try { await openNativeInspector(ctx); }
      catch (error) { ctx.ui.notify(errorMessage(error), "error"); }
    },
  });

  pi.registerTool({
    name: "workflow_run",
    label: "Run Workflow",
    description: "Launch a reusable capability-only JavaScript workflow only when the user explicitly requests workflow execution or Workflow Mode is armed. Tool availability alone does not authorize execution.",
    promptSnippet: "Launch an explicitly requested or Workflow-Mode-authorized JavaScript workflow",
    promptGuidelines: [
      "Use workflow_run only when the user explicitly requests workflow execution or Workflow Mode is armed; the tool being enabled or the task being substantive is not sufficient authorization.",
      "When using workflow_run, provide a generated or saved workflow plus structured args and set confirmRun=true only when the user requested execution or enabled Workflow Mode.",
    ],
    parameters: Type.Object({
      key: Type.Optional(Type.String({ description: "Legacy saved-workflow key. Prefer name for new calls." })),
      name: Type.Optional(Type.String({ description: "Saved workflow name, for example deep-research-minimal." })),
      script: Type.Optional(Type.String({ description: "Generated JavaScript workflow source beginning with export const meta." })),
      scriptPath: Type.Optional(Type.String({ description: "Path to a .js workflow under bundled, user, or trusted-project workflow directories. Takes precedence over script and name." })),
      resumeFromRunId: Type.Optional(Type.String({ description: "Existing JavaScript run ID whose completed unchanged calls should be replayed from the persisted call ledger." })),
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
      if (!params.scriptPath && !params.script && !name && !params.resumeFromRunId) {
        throw new Error("workflow_run requires scriptPath, script, name, resumeFromRunId, or legacy key.");
      }
      const replayOptions = params.resumeFromRunId ? { sourceRunId: params.resumeFromRunId } : undefined;
      const receipt = params.scriptPath
        ? await startScriptPath(params.scriptPath, input, ctx, replayOptions)
        : params.script
          ? await startInlineScript(params.script, input, ctx, replayOptions)
          : name
            ? await startRun(name as string, input, ctx, replayOptions)
            : await startResume(params.resumeFromRunId as string, input, ctx);
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
    promptSnippet: "Inspect an active or historical Pi workflow run by ID",
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
    if (mode.isEnabled()) {
      try {
        activateWorkflowTools();
      } catch (error) {
        mode.setEnabled(false, ctx);
        notifyWorkflow(ctx, errorMessage(error), "error");
      }
    }
    mode.render(ctx);
    publishWorkflowMode();
    const sessionId = ctx.sessionManager?.getSessionId?.() ?? "ephemeral";
    try { rememberSources(await loadSources(ctx)); } catch { /* command execution reports loader errors when requested */ }
    const sessionStorage = createWorkflowRunStorage({ sessionId });
    const diskRuns = await manager.restore(sessionStorage);
    if (diskRuns.some((record) => record.status === "failed" && record.finishedAt)) {
      notifyWorkflow(ctx, "Recovered inspectable workflow state from a previous host lifecycle.", "warning");
    }
    renderWorkflowRun(ctx, manager.active().at(-1) ?? restored);
    publishWorkflowSubagents();
    await publishInspector(ctx, sessionStorage);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!mode.isEnabled()) return;
    if (conflictingExclusiveMode) {
      mode.setRunning(false, ctx);
      notifyWorkflow(ctx, `Workflow Mode did not run because exclusive mode '${conflictingExclusiveMode}' is active. Disable one mode and retry.`, "warning");
      return;
    }
    try {
      activateWorkflowTools();
    } catch (error) {
      mode.setEnabled(false, ctx);
      publishWorkflowMode();
      notifyWorkflow(ctx, errorMessage(error), "error");
      return;
    }
    mode.setRunning(true, ctx);
    return { systemPrompt: mode.buildSystemPrompt(event.systemPrompt) };
  });

  pi.on("agent_end", async (_event, ctx) => {
    mode.finishTurn(ctx);
    publishWorkflowMode();
    void publishInspector(ctx);
  });

  pi.on("session_shutdown", async () => {
    await manager.shutdown();
    publishWorkflowSubagents();
  });

  pi.registerCommand("workflow-clear", {
    description: "Clear workflow status UI",
    handler: async (_args, ctx) => {
      clearWorkflowUI(ctx);
      ctx.ui.notify("Workflow UI cleared.", "info");
    },
  });
}
