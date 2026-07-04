import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { InitialPromptCalibration, InitialPromptInputEstimate, InitialPromptToolInfo } from "./tokens.ts";
import {
  estimateInitialPromptForPiContext,
  estimateInitialPromptFromPiExport,
  getActiveInitialPromptToolInfos,
  type ExportBackedInitialPromptEstimate,
} from "./prompt-export-estimate.ts";
import {
  buildInitialPromptEstimateKey,
  resolveInitialPromptEstimateRefreshDecision,
} from "./initial-prompt-estimate-state.ts";

export type InitialPromptEstimatePiApi = Pick<ExtensionAPI, "getActiveTools" | "getAllTools">;
export type InitialPromptEstimateContext = Pick<ExtensionContext, "getSystemPrompt" | "sessionManager">;
export type InitialPromptEstimateSource = ExportBackedInitialPromptEstimate["source"] | "fallback";

export type InitialPromptEstimateSnapshot = {
  key: string;
  estimate: InitialPromptInputEstimate;
  systemPrompt: string;
  tools: InitialPromptToolInfo[];
  source: InitialPromptEstimateSource;
  settled: boolean;
  attempts: number;
  warning?: string;
};

export type InitialPromptCalibrationGetter<Ctx extends InitialPromptEstimateContext> = (
  ctx: Ctx,
) => InitialPromptCalibration | null | undefined;

export type StableInitialPromptEstimateOptions = {
  maxAttempts?: number;
};

export type InitialPromptEstimateServiceOptions<Ctx extends InitialPromptEstimateContext> = StableInitialPromptEstimateOptions & {
  pi: InitialPromptEstimatePiApi;
  getCalibration: InitialPromptCalibrationGetter<Ctx>;
  /** Publish provisional fallback snapshots while export-backed estimation is still running. */
  publishFallback?: boolean;
  onUpdate?: (snapshot: InitialPromptEstimateSnapshot, ctx: Ctx) => void;
};

export type InitialPromptEstimateRefreshResult =
  | { status: "updated"; snapshot: InitialPromptEstimateSnapshot }
  | { status: "unsettled"; snapshot: InitialPromptEstimateSnapshot }
  | { status: "stale"; snapshot: null };

const DEFAULT_STABLE_ESTIMATE_ATTEMPTS = 3;

function resolveMaxAttempts(value: number | undefined): number {
  const attempts = Math.floor(Number(value ?? DEFAULT_STABLE_ESTIMATE_ATTEMPTS));
  return Number.isFinite(attempts) && attempts > 0 ? attempts : DEFAULT_STABLE_ESTIMATE_ATTEMPTS;
}

function appendWarning(existing: string | undefined, warning: string): string {
  return existing ? `${existing} ${warning}` : warning;
}

export function buildInitialPromptFallbackSnapshot(
  pi: InitialPromptEstimatePiApi,
  ctx: InitialPromptEstimateContext,
  calibration?: InitialPromptCalibration | null,
  attempts = 0,
): InitialPromptEstimateSnapshot {
  const systemPrompt = ctx.getSystemPrompt();
  const tools = getActiveInitialPromptToolInfos(pi);
  const estimate = estimateInitialPromptForPiContext(pi, systemPrompt, calibration, tools);
  return {
    key: buildInitialPromptEstimateKey(estimate),
    estimate,
    systemPrompt,
    tools,
    source: "fallback",
    settled: false,
    attempts,
  };
}

function snapshotFromExportEstimate(
  key: string,
  promptEstimate: ExportBackedInitialPromptEstimate,
  attempts: number,
): InitialPromptEstimateSnapshot {
  return {
    key,
    estimate: promptEstimate.estimate,
    systemPrompt: promptEstimate.systemPrompt,
    tools: promptEstimate.tools,
    source: promptEstimate.source,
    settled: true,
    attempts,
    warning: promptEstimate.warning,
  };
}

export async function estimateStableInitialPromptFromPiContext<Ctx extends InitialPromptEstimateContext>(
  pi: InitialPromptEstimatePiApi,
  ctx: Ctx,
  getCalibration: InitialPromptCalibrationGetter<Ctx>,
  options: StableInitialPromptEstimateOptions = {},
): Promise<InitialPromptEstimateSnapshot> {
  const maxAttempts = resolveMaxAttempts(options.maxAttempts);
  let latestFallback = buildInitialPromptFallbackSnapshot(pi, ctx, getCalibration(ctx) ?? null, 0);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const calibration = getCalibration(ctx) ?? null;
    const fallback = buildInitialPromptFallbackSnapshot(pi, ctx, calibration, attempt - 1);
    const promptEstimate = await estimateInitialPromptFromPiExport(pi, ctx, calibration);
    latestFallback = buildInitialPromptFallbackSnapshot(pi, ctx, getCalibration(ctx) ?? null, attempt);

    const decision = resolveInitialPromptEstimateRefreshDecision({
      requestId: attempt,
      currentRequestId: attempt,
      initialKey: fallback.key,
      latestKey: latestFallback.key,
    });
    if (decision === "accept-exported-estimate") {
      return snapshotFromExportEstimate(fallback.key, promptEstimate, attempt);
    }
  }

  return {
    ...latestFallback,
    attempts: maxAttempts,
    warning: appendWarning(
      latestFallback.warning,
      "Initial prompt inputs changed while estimating; used live context fallback.",
    ),
  };
}

export function createInitialPromptEstimateService<Ctx extends InitialPromptEstimateContext>(
  options: InitialPromptEstimateServiceOptions<Ctx>,
) {
  let snapshot: InitialPromptEstimateSnapshot | null = null;
  let activeRequestId = 0;

  const publish = (nextSnapshot: InitialPromptEstimateSnapshot, ctx: Ctx): InitialPromptEstimateSnapshot => {
    snapshot = nextSnapshot;
    options.onUpdate?.(nextSnapshot, ctx);
    return nextSnapshot;
  };

  const getFallbackSnapshot = (ctx: Ctx, attempts = 0): InitialPromptEstimateSnapshot => {
    return buildInitialPromptFallbackSnapshot(options.pi, ctx, options.getCalibration(ctx) ?? null, attempts);
  };

  const refresh = async (ctx: Ctx): Promise<InitialPromptEstimateRefreshResult> => {
    const requestId = ++activeRequestId;
    const maxAttempts = resolveMaxAttempts(options.maxAttempts);
    let latestFallback = getFallbackSnapshot(ctx, 0);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const calibration = options.getCalibration(ctx) ?? null;
      const fallback = buildInitialPromptFallbackSnapshot(options.pi, ctx, calibration, attempt - 1);
      latestFallback = fallback;
      if (options.publishFallback) publish(fallback, ctx);

      const promptEstimate = await estimateInitialPromptFromPiExport(options.pi, ctx, calibration);
      latestFallback = getFallbackSnapshot(ctx, attempt);

      const decision = resolveInitialPromptEstimateRefreshDecision({
        requestId,
        currentRequestId: activeRequestId,
        initialKey: fallback.key,
        latestKey: latestFallback.key,
      });
      if (decision === "ignore-stale-request") return { status: "stale", snapshot: null };
      if (decision === "restart-inputs-changed") continue;

      return {
        status: "updated",
        snapshot: publish(snapshotFromExportEstimate(fallback.key, promptEstimate, attempt), ctx),
      };
    }

    const unsettled = {
      ...latestFallback,
      attempts: maxAttempts,
      warning: appendWarning(
        latestFallback.warning,
        "Initial prompt inputs changed while estimating; kept the previous settled estimate.",
      ),
    };
    if (options.publishFallback) publish(unsettled, ctx);
    return { status: "unsettled", snapshot: unsettled };
  };

  return {
    clear() {
      activeRequestId++;
      snapshot = null;
    },
    getSnapshot() {
      return snapshot;
    },
    getFallbackSnapshot,
    refresh,
  };
}
