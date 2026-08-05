import { randomUUID } from "node:crypto";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import {
  SESSION_SUMMARY_DISPLAY_TYPE,
  SESSION_SUMMARY_MAX_OUTPUT_TOKENS,
  SESSION_SUMMARY_NAME_PROVENANCE_TYPE,
  SESSION_SUMMARY_PROMPT_REVISION,
  SESSION_SUMMARY_RPC_TYPE,
  SESSION_SUMMARY_STATE_TYPE,
  SESSION_SUMMARY_SYSTEM_PROMPT,
  SESSION_SUMMARY_TIMEOUT_MS,
  boundedRpcPayload,
  buildSummaryUserPrompt,
  captureSummarySource,
  createSummaryScheduler,
  filterAndInjectSummaryContext,
  isSummarySourceCurrent,
  latestSummaryNameProvenance,
  latestSummaryState,
  parseSummaryOutput,
  shouldApplySummaryTitle,
} from "./lib/session-summary-core.mjs";
import {
  readSessionSummaryPreferences,
  sessionSummaryPreferencesSummary,
  supportedSessionSummaryThinkingLevels,
  writeSessionSummaryPreferences,
} from "./lib/session-summary-preferences.mjs";

type SummaryContext = ExtensionContext | ExtensionCommandContext;
type CompleteFunction = typeof completeSimple;
type GenerationInput = { ctx: SummaryContext; manual: boolean };

function modelKey(model: any): string {
  return `${model?.provider || ""}/${model?.id || model?.modelId || ""}`;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, " ").slice(0, 512);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("abort"));
}

function sendRpc(pi: ExtensionAPI, ctx: SummaryContext, kind: string, payload: Record<string, unknown> = {}): void {
  pi.sendMessage({
    customType: SESSION_SUMMARY_RPC_TYPE,
    content: "",
    display: false,
    details: boundedRpcPayload(kind, {
      sessionId: ctx.sessionManager.getSessionId(),
      durable: !!ctx.sessionManager.getSessionFile(),
      ...payload,
    }),
  }, { triggerTurn: false });
}

function displaySummary(pi: ExtensionAPI, state: any): void {
  if (!state?.result?.summaryMarkdown) return;
  pi.appendEntry(SESSION_SUMMARY_DISPLAY_TYPE, {
    version: 1,
    title: state.result.title || "Session summary",
    summaryMarkdown: state.result.summaryMarkdown,
  });
}

function availableModels(ctx: ExtensionCommandContext): any[] {
  return ctx.modelRegistry.getAvailable()
    .filter((model: any) => model?.provider && model?.id)
    .sort((left: any, right: any) => modelKey(left).localeCompare(modelKey(right)));
}

async function selectValue(
  ctx: ExtensionCommandContext,
  title: string,
  options: Array<{ value: string; label: string }>,
  current?: string,
): Promise<string | undefined> {
  const labels = options.map((option) => option.value === current ? `${option.label} (current)` : option.label);
  const selected = await ctx.ui.select(title, labels);
  if (!selected) return undefined;
  const index = labels.indexOf(selected);
  return index < 0 ? undefined : options[index].value;
}

async function runSetup(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<boolean> {
  if (!ctx.hasUI) {
    ctx.ui.notify("Session summary setup requires TUI or RPC dialog support.", "warning");
    return false;
  }
  try {
    const current = await readSessionSummaryPreferences();
    const models = availableModels(ctx);
    if (!models.length) {
      ctx.ui.notify("No authenticated Pi models are available. Run /login or configure a provider first.", "warning");
      return false;
    }
    const preferred = modelKey(current.model);
    const defaultKey = "openai-codex/gpt-5.6-luna";
    const availableKeys = new Set(models.map(modelKey));
    const selectedModelKey = await selectValue(
      ctx,
      `Session summary model\n\n${sessionSummaryPreferencesSummary(current)}`,
      models.map((model: any) => ({ value: modelKey(model), label: `${modelKey(model)}${model.name && model.name !== model.id ? ` — ${model.name}` : ""}` })),
      availableKeys.has(preferred) ? preferred : (availableKeys.has(defaultKey) ? defaultKey : undefined),
    );
    if (!selectedModelKey) return false;
    const selectedModel = models.find((model: any) => modelKey(model) === selectedModelKey);
    if (!selectedModel) return false;

    const levels = supportedSessionSummaryThinkingLevels(selectedModel);
    const selectedThinking = await selectValue(
      ctx,
      "Session summary reasoning effort",
      levels.map((value: string) => ({ value, label: value })),
      levels.includes(current.model.thinkingLevel) ? current.model.thinkingLevel : (levels.includes("low") ? "low" : levels[0]),
    );
    if (!selectedThinking) return false;
    const enabled = await selectValue(ctx, "Generate automatically after settled turns?", [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No (manual /summary only)" },
    ], current.enabled ? "yes" : "no");
    if (!enabled) return false;
    const titleEnabled = await selectValue(ctx, "Allow generated session titles?", [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ], current.title.enabled ? "yes" : "no");
    if (!titleEnabled) return false;
    const minSettledTurns = await selectValue(ctx, "Minimum settled user turns between changed titles", [1, 2, 3, 5, 10, 20].map((value) => ({ value: String(value), label: String(value) })), String(current.title.minSettledTurns));
    if (!minSettledTurns) return false;
    const injectLatest = await selectValue(ctx, "Inject the latest summary into main-agent context?", [
      { value: "no", label: "No (privacy-first default)" },
      { value: "yes", label: "Yes, latest active-branch summary only" },
    ], current.context.injectLatest ? "yes" : "no");
    if (!injectLatest) return false;
    const titlePrompt = await ctx.ui.editor("Editable title prompt (maximum 8 KiB)", current.prompts.title);
    if (titlePrompt === undefined) return false;
    const summaryPrompt = await ctx.ui.editor("Editable Markdown summary prompt (maximum 8 KiB)", current.prompts.summary);
    if (summaryPrompt === undefined) return false;

    const next = {
      configured: true,
      enabled: enabled === "yes",
      model: { provider: selectedModel.provider, modelId: selectedModel.id, thinkingLevel: selectedThinking },
      prompts: { title: titlePrompt, summary: summaryPrompt },
      input: { scope: "text-and-tool-names" },
      context: { injectLatest: injectLatest === "yes" },
      title: { enabled: titleEnabled === "yes", minSettledTurns: Number(minSettledTurns) },
    };
    const disclosure = [
      sessionSummaryPreferencesSummary(next),
      "",
      "Privacy/cost: each automatic settled refresh sends active-branch user text, final assistant text, and tool names to the selected model in one request. Thinking, images, tool arguments/results, credentials, and prior summary messages are excluded. There is no fallback or automatic provider retry.",
    ].join("\n");
    if (!await ctx.ui.confirm("Save session summary setup?", disclosure)) return false;
    const saved = await writeSessionSummaryPreferences(next);
    sendRpc(pi, ctx, "setup", { configured: saved.configured, enabled: saved.enabled });
    ctx.ui.notify(`Session summary setup saved.\n\n${sessionSummaryPreferencesSummary(saved)}`, "info");
    return true;
  } catch (error) {
    ctx.ui.notify(`Session summary setup failed: ${errorMessage(error)}`, "error");
    return false;
  }
}

export function createSessionSummaryExtension({ completeFn = completeSimple }: { completeFn?: CompleteFunction } = {}) {
  return function registerSessionSummary(pi: ExtensionAPI): void {
    let selfGeneratedName: { sessionId: string; name: string } | undefined;

    const publishCurrentState = async (ctx: SummaryContext): Promise<void> => {
      const state = latestSummaryState(ctx.sessionManager.getBranch());
      const preferences = await readSessionSummaryPreferences();
      sendRpc(pi, ctx, "state", {
        configured: preferences.configured,
        enabled: preferences.enabled,
        title: state?.result?.title,
        summaryMarkdown: state?.result?.summaryMarkdown,
      });
    };

    const scheduler = createSummaryScheduler({
      run: async ({ ctx, manual }: GenerationInput, outerSignal: AbortSignal) => {
        try {
          const preferences = await readSessionSummaryPreferences();
        if (!preferences.configured || (!manual && !preferences.enabled)) return { skipped: true };

        sendRpc(pi, ctx, "generating", { configured: true, enabled: preferences.enabled });
        const captured = captureSummarySource(ctx.sessionManager);
        if (!captured.serialized.text.trim()) throw new Error("No conversation text found");
        const previousState = latestSummaryState(captured.entries);
        const model = ctx.modelRegistry.find(preferences.model.provider, preferences.model.modelId);
        if (!model) throw new Error(`Configured summary model is unavailable: ${preferences.model.provider}/${preferences.model.modelId}`);
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        if (!auth?.ok) throw new Error(auth?.error || `Authentication failed for ${preferences.model.provider}`);

        const timeoutSignal = AbortSignal.timeout(SESSION_SUMMARY_TIMEOUT_MS);
        const signal = AbortSignal.any([outerSignal, timeoutSignal]);
        const response = await completeFn(model, {
          systemPrompt: SESSION_SUMMARY_SYSTEM_PROMPT,
          messages: [{
            role: "user",
            content: [{ type: "text", text: buildSummaryUserPrompt({
              transcript: captured.serialized.text,
              titlePrompt: preferences.prompts.title,
              summaryPrompt: preferences.prompts.summary,
              previousState,
            }) }],
            timestamp: Date.now(),
          }],
        }, {
          apiKey: auth.apiKey,
          headers: auth.headers,
          env: auth.env,
          reasoning: preferences.model.thinkingLevel,
          cacheRetention: "none",
          sessionId: randomUUID(),
          signal,
          timeoutMs: SESSION_SUMMARY_TIMEOUT_MS,
          maxRetries: 0,
          maxTokens: SESSION_SUMMARY_MAX_OUTPUT_TOKENS,
        });
        if (response.stopReason === "error" || response.stopReason === "aborted") throw new Error(`Summary model stopped with ${response.stopReason}`);
        const output = parseSummaryOutput(response.content
          .filter((part: any) => part?.type === "text" && typeof part.text === "string")
          .map((part: any) => part.text)
          .join("\n"));
        if (!isSummarySourceCurrent(ctx.sessionManager, captured)) {
          const currentState = latestSummaryState(ctx.sessionManager.getBranch());
          sendRpc(pi, ctx, "state", {
            configured: preferences.configured,
            enabled: preferences.enabled,
            title: currentState?.result?.title,
            summaryMarkdown: currentState?.result?.summaryMarkdown,
          });
          return { stale: true };
        }

        const currentName = pi.getSessionName();
        const applyTitle = shouldApplySummaryTitle({
          candidate: output.title,
          currentSessionName: currentName,
          previousState,
          explicitName: latestSummaryNameProvenance(captured.entries)?.explicit,
          settledTurnOrdinal: captured.serialized.userTurns,
          enabled: preferences.title.enabled,
          minSettledTurns: preferences.title.minSettledTurns,
        });
        const previouslyAppliedTitle = previousState?.titleAppliedAtOrdinal !== undefined ? previousState.result.title : undefined;
        const durableTitle = applyTitle ? output.title : (previouslyAppliedTitle || output.title);
        const titleAppliedAtOrdinal = applyTitle
          ? captured.serialized.userTurns
          : previousState?.titleAppliedAtOrdinal;
        const state = {
          version: 1,
          source: {
            sessionId: captured.source.sessionId,
            leafId: captured.source.leafId,
            fingerprint: captured.source.fingerprint,
            entryCount: captured.source.entryCount,
          },
          result: { ...(durableTitle ? { title: durableTitle } : {}), summaryMarkdown: output.summaryMarkdown },
          generation: {
            provider: preferences.model.provider,
            modelId: preferences.model.modelId,
            thinkingLevel: preferences.model.thinkingLevel,
            promptRevision: SESSION_SUMMARY_PROMPT_REVISION,
          },
          generatedAt: new Date().toISOString(),
          settledTurnOrdinal: captured.serialized.userTurns,
          ...(titleAppliedAtOrdinal === undefined ? {} : { titleAppliedAtOrdinal }),
        };
        pi.appendEntry(SESSION_SUMMARY_STATE_TYPE, state);
        if (applyTitle && output.title) {
          selfGeneratedName = { sessionId: captured.source.sessionId, name: output.title };
          try {
            pi.setSessionName(output.title);
          } catch (error) {
            selfGeneratedName = undefined;
            throw error;
          }
          sendRpc(pi, ctx, "title", { title: output.title });
        }
        sendRpc(pi, ctx, "success", { title: state.result.title, summaryMarkdown: state.result.summaryMarkdown });
          if (!ctx.sessionManager.getSessionFile() && manual) ctx.ui.notify("Summary created in memory; this session has no durable session file.", "warning");
          return { state, appliedTitle: applyTitle };
        } catch (error) {
          if (!isAbort(error)) sendRpc(pi, ctx, "failure", { message: errorMessage(error) });
          throw error;
        }
      },
    });

    pi.registerEntryRenderer<{ summaryMarkdown?: string }>(SESSION_SUMMARY_DISPLAY_TYPE, (entry) => {
      const markdown = typeof entry.data?.summaryMarkdown === "string" ? entry.data.summaryMarkdown : "";
      return new Markdown(markdown, 1, 1, getMarkdownTheme());
    });

    pi.on("agent_settled", (_event, ctx) => {
      void readSessionSummaryPreferences().then((preferences) => {
        if (!preferences.configured || !preferences.enabled) return;
        void scheduler.schedule({ ctx, manual: false });
      }).catch((error) => {
        sendRpc(pi, ctx, "failure", { message: errorMessage(error) });
      });
    });

    pi.on("context", async (event, ctx) => {
      const state = latestSummaryState(ctx.sessionManager.getBranch());
      try {
        const preferences = await readSessionSummaryPreferences();
        return { messages: filterAndInjectSummaryContext(event.messages, { injectLatest: preferences.configured && preferences.context.injectLatest, state }) };
      } catch {
        return { messages: filterAndInjectSummaryContext(event.messages) };
      }
    });

    pi.on("session_info_changed", (event, ctx) => {
      if (selfGeneratedName?.sessionId === ctx.sessionManager.getSessionId() && selfGeneratedName.name === event.name) {
        selfGeneratedName = undefined;
        return;
      }
      selfGeneratedName = undefined;
      pi.appendEntry(SESSION_SUMMARY_NAME_PROVENANCE_TYPE, {
        version: 1,
        explicit: event.name !== undefined,
      });
    });

    pi.on("session_start", async (_event, ctx) => {
      selfGeneratedName = undefined;
      try {
        await publishCurrentState(ctx);
      } catch (error) {
        sendRpc(pi, ctx, "failure", { message: errorMessage(error) });
      }
    });

    pi.on("session_tree", async (_event, ctx) => {
      try {
        await publishCurrentState(ctx);
      } catch (error) {
        sendRpc(pi, ctx, "failure", { message: errorMessage(error) });
      }
    });

    pi.on("session_shutdown", () => {
      selfGeneratedName = undefined;
      scheduler.abort();
    });

    const generateManual = async (ctx: ExtensionCommandContext): Promise<any> => {
      const result = await scheduler.schedule({ ctx, manual: true }, { manual: true });
      if (result.status === "failure") {
        const message = errorMessage(result.error);
        ctx.ui.notify(`Session summary failed: ${message}`, "error");
      } else if (result.status === "aborted") {
        ctx.ui.notify("Session summary generation was cancelled.", "warning");
      }
      return result;
    };

    pi.registerCommand("summary", {
      description: "Show the latest session summary or generate one; use /summary refresh to force an update",
      handler: async (args, ctx) => {
        const preferences = await readSessionSummaryPreferences().catch((error) => {
          ctx.ui.notify(`Session summary settings failed: ${errorMessage(error)}`, "error");
          return undefined;
        });
        if (!preferences) return;
        if (!preferences.configured) {
          if (!await runSetup(pi, ctx)) return;
          await generateManual(ctx);
        } else {
          const state = latestSummaryState(ctx.sessionManager.getBranch());
          const refresh = args.trim().toLowerCase() === "refresh";
          if (args.trim() && !refresh) {
            ctx.ui.notify("Usage: /summary [refresh]", "warning");
            return;
          }
          if (!state || refresh) await generateManual(ctx);
        }
        const latest = latestSummaryState(ctx.sessionManager.getBranch());
        if (latest) displaySummary(pi, latest);
      },
    });

    pi.registerCommand("summary-setup", {
      description: "Configure persistent session titles and Markdown summaries",
      handler: async (_args, ctx) => {
        if (!await runSetup(pi, ctx)) return;
        await generateManual(ctx);
        const latest = latestSummaryState(ctx.sessionManager.getBranch());
        if (latest) displaySummary(pi, latest);
      },
    });
  };
}

export default createSessionSummaryExtension();
