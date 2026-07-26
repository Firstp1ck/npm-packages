import assert from "node:assert/strict";
import {
  createTokenBudgetController,
  DEFAULT_BUDGETED_AGENT_MAX_TURNS,
  effectiveAgentBudgetLimits,
  tokenBudgetExceeded,
  tokenBudgetScopeQuantum,
  workflowUsageTokens,
} from "../src/token-budget.ts";

assert.equal(tokenBudgetScopeQuantum(100, 1), 50, "a single-worker scope still reserves at least two shares");
assert.equal(tokenBudgetScopeQuantum(100, 3), 33);
assert.throws(() => tokenBudgetScopeQuantum(1.5, 2), /positive integer/i);
assert.deepEqual(
  effectiveAgentBudgetLimits({ maxTokens: 30, maxTurns: 8 }, { maxTokens: 20, maxTurns: 3 }, 24),
  { maxTokens: 20, maxTurns: 3 },
  "requests and reservations can tighten but never loosen policy ceilings",
);
assert.deepEqual(
  effectiveAgentBudgetLimits({ maxTokens: 30, maxTurns: 8 }, { maxTokens: 40, maxTurns: 10 }, 24),
  { maxTokens: 24, maxTurns: 8 },
  "larger request controls cannot loosen policy or reservation ceilings",
);
assert.equal(workflowUsageTokens({ input: 2, output: 3, cacheRead: 5, cacheWrite: 7 }), 17);

const controller = createTokenBudgetController({
  budgets: {
    run: { maxTokens: 100 },
    phase: { maxTokens: 80 },
    agent: { maxTokens: 40, maxTurns: 8 },
  },
  maxConcurrency: 3,
});
const first = controller.reserve({ phaseId: "discover", maxTokens: 30, maxTurns: 4 });
assert.equal(first.ok, true);
assert.equal(first.limits.maxTokens, 26, "phase quantum is the effective aggregate cap");
assert.equal(first.limits.maxTurns, 4);
assert.ok(first.reservation);
const second = controller.reserve({ phaseId: "discover" });
const third = controller.reserve({ phaseId: "discover" });
assert.equal(second.ok, true);
assert.equal(third.ok, true);
assert.equal(first.diagnostics.phase?.quantum, 26);
assert.equal(third.reservation?.maxTokens, 26);
const fourth = controller.reserve({ phaseId: "discover" });
assert.equal(fourth.ok, true, "the final positive remainder is admissible");
assert.equal(fourth.reservation?.maxTokens, 2);
assert.equal(controller.reserve({ phaseId: "discover" }).ok, false, "active reservations must synchronously block oversubscription");

const afterFirst = controller.reconcile(first.reservation, { input: 4, output: 6 });
assert.equal(afterFirst.phase?.measuredTokens, 10);
assert.equal(afterFirst.phase?.reservedTokens, 54);
assert.equal(afterFirst.phase?.availableTokens, 16, "unused reservation capacity is released after settlement");
controller.release(second.reservation);
controller.release(third.reservation);
controller.release(fourth.reservation);
const later = controller.reserve({ phaseId: "discover" });
assert.equal(later.ok, true);
assert.equal(later.reservation?.maxTokens, 26, "released reservations restore capacity for later calls");
controller.reconcile(later.reservation, { output: 71 });
const exhausted = controller.diagnostics("discover");
assert.equal(tokenBudgetExceeded(exhausted), true, "reported one-response overshoot is visible after reconciliation");
assert.equal(exhausted.phase?.reservedTokens, 0, "measured usage and active reservations remain separate");
assert.equal(controller.reserve({ phaseId: "discover" }).ok, false, "no positive capacity remains after measured exhaustion");

const runOnly = createTokenBudgetController({ budgets: { run: { maxTokens: 20 } }, maxConcurrency: 2 });
const runOne = runOnly.reserve({ phaseId: "a" });
const runTwo = runOnly.reserve({ phaseId: "b" });
assert.equal(runOne.reservation?.maxTokens, 10);
assert.equal(runOne.limits.maxTurns, DEFAULT_BUDGETED_AGENT_MAX_TURNS, "token-bounded calls receive a finite default turn cap");
assert.equal(runTwo.reservation?.maxTokens, 10);
assert.equal(runOnly.reserve({ phaseId: "c" }).ok, false, "run reservations span phases");
runOnly.reconcile(runOne.reservation, { output: 2 });
const replayCharge = runOnly.charge("cached", { input: 3 });
assert.equal(replayCharge.run?.measuredTokens, 5, "cached usage is charged once without creating a reservation");
assert.equal(replayCharge.run?.reservedTokens, 10);

const unseenPhaseController = createTokenBudgetController({ budgets: { phase: { maxTokens: 20 } }, maxConcurrency: 2 });
assert.equal(unseenPhaseController.diagnostics("unseen").phase, undefined, "read-only diagnostics must not create phase accounting state");
const unseenAdmission = unseenPhaseController.reserve({ phaseId: "unseen" });
assert.equal(unseenAdmission.diagnostics.phase?.measuredTokens, 0);

const agentOnly = createTokenBudgetController({ budgets: { agent: { maxTokens: 12, maxTurns: 2 } }, maxConcurrency: 1 });
const agentOnlyAdmission = agentOnly.reserve({ phaseId: "root", maxTokens: 20, maxTurns: 4 });
assert.equal(agentOnlyAdmission.ok, true);
assert.deepEqual(agentOnlyAdmission.limits, { maxTokens: 12, maxTurns: 2 });
assert.equal(agentOnlyAdmission.reservation, undefined, "per-agent-only controls require no aggregate reservation");
const tokenOnlyAdmission = createTokenBudgetController({ budgets: { agent: { maxTokens: 12 } }, maxConcurrency: 1 }).reserve({ phaseId: "root" });
assert.equal(tokenOnlyAdmission.limits.maxTurns, DEFAULT_BUDGETED_AGENT_MAX_TURNS, "explicit token-only policy also receives the bounded default turn cap");

console.log("token budget tests passed");
