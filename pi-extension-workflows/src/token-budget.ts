import type { WorkflowAgentBudgetLimits, WorkflowBudgetPolicy, WorkflowUsage } from "./types.ts";

export const DEFAULT_BUDGETED_AGENT_MAX_TURNS = 8;

export type TokenBudgetRequest = {
  phaseId: string;
  maxTokens?: number;
  maxTurns?: number;
};

export type TokenBudgetScopeDiagnostics = {
  limit: number;
  measuredTokens: number;
  reservedTokens: number;
  availableTokens: number;
  quantum: number;
};

export type TokenBudgetDiagnostics = {
  activeReservations: number;
  run?: TokenBudgetScopeDiagnostics;
  phase?: TokenBudgetScopeDiagnostics;
};

export type TokenBudgetReservation = {
  id: string;
  phaseId: string;
  maxTokens: number;
};

export type TokenBudgetAdmission =
  | {
    ok: true;
    limits: WorkflowAgentBudgetLimits;
    reservation?: TokenBudgetReservation;
    diagnostics: TokenBudgetDiagnostics;
  }
  | {
    ok: false;
    limits: WorkflowAgentBudgetLimits;
    diagnostics: TokenBudgetDiagnostics;
  };

export type TokenBudgetController = {
  reserve(request: TokenBudgetRequest): TokenBudgetAdmission;
  reconcile(reservation: TokenBudgetReservation, usage?: WorkflowUsage): TokenBudgetDiagnostics;
  release(reservation: TokenBudgetReservation): TokenBudgetDiagnostics;
  charge(phaseId: string, usage?: WorkflowUsage): TokenBudgetDiagnostics;
  diagnostics(phaseId?: string): TokenBudgetDiagnostics;
};

export type TokenBudgetControllerOptions = {
  budgets?: WorkflowBudgetPolicy;
  maxConcurrency: number;
};

type ScopeState = {
  limit: number;
  measuredTokens: number;
  reservedTokens: number;
  quantum: number;
};

type ActiveReservation = {
  reservation: TokenBudgetReservation;
  run?: ScopeState;
  phase?: ScopeState;
};

function assertPositiveInteger(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
}

function assertPhaseId(phaseId: string): void {
  if (typeof phaseId !== "string" || !phaseId.trim()) throw new RangeError("phaseId must be a non-empty string.");
}

function optionalMinimum(...values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined);
  return defined.length > 0 ? Math.min(...defined) : undefined;
}

function usageTokens(usage: WorkflowUsage | undefined): number {
  return (usage?.input ?? 0) + (usage?.output ?? 0) + (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0);
}

function availableTokens(scope: ScopeState): number {
  return Math.max(0, scope.limit - scope.measuredTokens - scope.reservedTokens);
}

function scopeDiagnostics(scope: ScopeState): TokenBudgetScopeDiagnostics {
  return {
    limit: scope.limit,
    measuredTokens: scope.measuredTokens,
    reservedTokens: scope.reservedTokens,
    availableTokens: availableTokens(scope),
    quantum: scope.quantum,
  };
}

function toScope(limit: number, maxConcurrency: number): ScopeState {
  return { limit, measuredTokens: 0, reservedTokens: 0, quantum: tokenBudgetScopeQuantum(limit, maxConcurrency) };
}

/** Returns the deterministic per-call share reserved from an aggregate scope. */
export function tokenBudgetScopeQuantum(maxTokens: number, effectiveMaxConcurrency: number): number {
  assertPositiveInteger(maxTokens, "maxTokens");
  assertPositiveInteger(effectiveMaxConcurrency, "effectiveMaxConcurrency");
  return Math.max(1, Math.floor(maxTokens / Math.max(2, effectiveMaxConcurrency)));
}

/** Applies policy, reservation, and request caps as ceilings; requests never loosen policy. */
export function effectiveAgentBudgetLimits(
  policy: WorkflowAgentBudgetLimits | undefined,
  request: Pick<TokenBudgetRequest, "maxTokens" | "maxTurns"> = {},
  reservationMaxTokens?: number,
): WorkflowAgentBudgetLimits {
  assertPositiveInteger(policy?.maxTokens, "policy maxTokens");
  assertPositiveInteger(policy?.maxTurns, "policy maxTurns");
  assertPositiveInteger(request.maxTokens, "request maxTokens");
  assertPositiveInteger(request.maxTurns, "request maxTurns");
  assertPositiveInteger(reservationMaxTokens, "reservation maxTokens");
  const maxTokens = optionalMinimum(policy?.maxTokens, request.maxTokens, reservationMaxTokens);
  const configuredMaxTurns = optionalMinimum(policy?.maxTurns, request.maxTurns);
  const maxTurns = configuredMaxTurns ?? (maxTokens === undefined ? undefined : DEFAULT_BUDGETED_AGENT_MAX_TURNS);
  return {
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(maxTurns === undefined ? {} : { maxTurns }),
  };
}

/** Sum of the authoritative token fields used by aggregate token budgets. */
export function workflowUsageTokens(usage: WorkflowUsage | undefined): number {
  return usageTokens(usage);
}

/** True only after reported usage has exceeded a scope limit; equality remains allowed. */
export function tokenBudgetExceeded(diagnostics: TokenBudgetDiagnostics): boolean {
  return Boolean(
    (diagnostics.run && diagnostics.run.measuredTokens > diagnostics.run.limit)
    || (diagnostics.phase && diagnostics.phase.measuredTokens > diagnostics.phase.limit),
  );
}

/**
 * Maintains measured usage and in-flight reservations separately for one workflow run.
 * All methods are synchronous so an admission is visible before another host operation
 * can reserve the same capacity.
 */
export function createTokenBudgetController(options: TokenBudgetControllerOptions): TokenBudgetController {
  assertPositiveInteger(options.maxConcurrency, "maxConcurrency");
  const budgets = options.budgets;
  assertPositiveInteger(budgets?.run?.maxTokens, "run maxTokens");
  assertPositiveInteger(budgets?.phase?.maxTokens, "phase maxTokens");
  assertPositiveInteger(budgets?.agent?.maxTokens, "agent maxTokens");
  assertPositiveInteger(budgets?.agent?.maxTurns, "agent maxTurns");

  const run = budgets?.run?.maxTokens === undefined ? undefined : toScope(budgets.run.maxTokens, options.maxConcurrency);
  const phaseLimit = budgets?.phase?.maxTokens;
  const phases = new Map<string, ScopeState>();
  const active = new Map<string, ActiveReservation>();
  let sequence = 0;

  const phaseFor = (phaseId: string): ScopeState | undefined => {
    if (phaseLimit === undefined) return undefined;
    let phase = phases.get(phaseId);
    if (!phase) {
      phase = toScope(phaseLimit, options.maxConcurrency);
      phases.set(phaseId, phase);
    }
    return phase;
  };

  const diagnostics = (phaseId?: string): TokenBudgetDiagnostics => {
    const phase = phaseId ? phases.get(phaseId) : undefined;
    return {
      activeReservations: active.size,
      ...(run ? { run: scopeDiagnostics(run) } : {}),
      ...(phase ? { phase: scopeDiagnostics(phase) } : {}),
    };
  };

  const removeReservation = (reservation: TokenBudgetReservation): ActiveReservation => {
    const activeReservation = active.get(reservation.id);
    if (!activeReservation || activeReservation.reservation.phaseId !== reservation.phaseId || activeReservation.reservation.maxTokens !== reservation.maxTokens) {
      throw new RangeError(`Unknown token budget reservation '${reservation.id}'.`);
    }
    active.delete(reservation.id);
    if (activeReservation.run) activeReservation.run.reservedTokens -= reservation.maxTokens;
    if (activeReservation.phase) activeReservation.phase.reservedTokens -= reservation.maxTokens;
    return activeReservation;
  };

  return {
    reserve(request) {
      assertPhaseId(request.phaseId);
      const phase = phaseFor(request.phaseId);
      const requestLimits = effectiveAgentBudgetLimits(budgets?.agent, request);
      const scopeCaps: number[] = [];
      if (run) {
        const available = availableTokens(run);
        if (available <= 0) return { ok: false, limits: requestLimits, diagnostics: diagnostics(request.phaseId) };
        scopeCaps.push(available, run.quantum);
      }
      if (phase) {
        const available = availableTokens(phase);
        if (available <= 0) return { ok: false, limits: requestLimits, diagnostics: diagnostics(request.phaseId) };
        scopeCaps.push(available, phase.quantum);
      }
      if (scopeCaps.length === 0) {
        return { ok: true, limits: requestLimits, diagnostics: diagnostics(request.phaseId) };
      }
      const maxTokens = optionalMinimum(requestLimits.maxTokens, ...scopeCaps)!;
      const reservation: TokenBudgetReservation = { id: `token-reservation-${++sequence}`, phaseId: request.phaseId, maxTokens };
      if (run) run.reservedTokens += maxTokens;
      if (phase) phase.reservedTokens += maxTokens;
      active.set(reservation.id, { reservation, ...(run ? { run } : {}), ...(phase ? { phase } : {}) });
      return {
        ok: true,
        limits: effectiveAgentBudgetLimits(budgets?.agent, request, maxTokens),
        reservation,
        diagnostics: diagnostics(request.phaseId),
      };
    },
    reconcile(reservation, usage) {
      const activeReservation = removeReservation(reservation);
      const measured = usageTokens(usage);
      if (activeReservation.run) activeReservation.run.measuredTokens += measured;
      if (activeReservation.phase) activeReservation.phase.measuredTokens += measured;
      return diagnostics(reservation.phaseId);
    },
    release(reservation) {
      removeReservation(reservation);
      return diagnostics(reservation.phaseId);
    },
    charge(phaseId, usage) {
      assertPhaseId(phaseId);
      const measured = usageTokens(usage);
      if (run) run.measuredTokens += measured;
      const phase = phaseFor(phaseId);
      if (phase) phase.measuredTokens += measured;
      return diagnostics(phaseId);
    },
    diagnostics,
  };
}
