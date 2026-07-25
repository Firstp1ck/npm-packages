import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type SubagentExecutionMode = "direct" | "tasks" | "chain" | "indeterminate";
export type SubagentAnalysisKind = SubagentExecutionMode | "scheduled" | "non-execution";

export interface SubagentFanoutAnalysis {
	kind: SubagentAnalysisKind;
	mode?: SubagentExecutionMode;
	guaranteedChildren: number;
	guaranteedWorkers: number;
	execution: boolean;
	workerExecution: boolean;
	dynamicFanout: boolean;
	scheduledKind?: SubagentExecutionMode;
}

export const MINIMUM_FANOUT_BLOCK_REASON = [
	"Blocked by the zero-or-multiple delegation policy: every execution needs at least two statically guaranteed child launches, and any workflow that launches the worker agent needs at least two statically guaranteed worker launches.",
	"Do not retry a single child or hide one worker among non-worker children.",
	"Either work directly in the main agent, or issue one statically compliant tasks or chain workflow with the required launches.",
].join(" ");

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Returns a declared positive integer count, defaulting invalid or omitted values to one child. */
export function positiveTaskCount(value: unknown): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function isWorkerTask(task: unknown): task is Record<string, unknown> & { agent: "worker" } {
	return isRecord(task) && task.agent === "worker";
}

/** Sums the statically declared children in a top-level tasks workflow. */
export function countStaticTasks(tasks: unknown): number {
	if (!Array.isArray(tasks)) return 0;
	return tasks.reduce((total, task) => total + positiveTaskCount(isRecord(task) ? task.count : undefined), 0);
}

/** Sums statically declared launches of the implementation worker agent. */
export function countStaticWorkers(tasks: unknown): number {
	if (!Array.isArray(tasks)) return 0;
	return tasks.reduce((total, task) => total + (isWorkerTask(task)
		? positiveTaskCount(task.count)
		: 0), 0);
}

export interface StaticChainCount {
	guaranteedChildren: number;
	guaranteedWorkers: number;
	workerExecution: boolean;
	dynamicFanout: boolean;
}

/**
 * Counts only chain children that are known at tool-call time. Dynamic expand
 * templates intentionally contribute zero because their cardinality is unknown.
 */
export function countStaticChainChildren(chain: unknown): StaticChainCount {
	if (!Array.isArray(chain)) {
		return { guaranteedChildren: 0, guaranteedWorkers: 0, workerExecution: false, dynamicFanout: false };
	}

	return chain.reduce<StaticChainCount>((total, step) => {
		if (!isRecord(step)) return total;

		if (Array.isArray(step.parallel)) {
			return {
				guaranteedChildren: total.guaranteedChildren + countStaticTasks(step.parallel),
				guaranteedWorkers: total.guaranteedWorkers + countStaticWorkers(step.parallel),
				workerExecution: total.workerExecution || step.parallel.some(isWorkerTask),
				dynamicFanout: total.dynamicFanout,
			};
		}

		if (isRecord(step.parallel) || step.expand !== undefined) {
			return {
				...total,
				workerExecution: total.workerExecution || isWorkerTask(step.parallel),
				dynamicFanout: true,
			};
		}

		if (typeof step.agent === "string") {
			const worker = step.agent === "worker";
			return {
				...total,
				guaranteedChildren: total.guaranteedChildren + 1,
				guaranteedWorkers: total.guaranteedWorkers + (worker ? 1 : 0),
				workerExecution: total.workerExecution || worker,
			};
		}

		return total;
	}, { guaranteedChildren: 0, guaranteedWorkers: 0, workerExecution: false, dynamicFanout: false });
}

function analyzeExecution(input: Record<string, unknown>): SubagentFanoutAnalysis {
	if (Array.isArray(input.chain) && input.chain.length > 0) {
		const chain = countStaticChainChildren(input.chain);
		const mode: SubagentExecutionMode = chain.dynamicFanout && chain.guaranteedChildren === 0 ? "indeterminate" : "chain";
		return {
			kind: mode,
			mode,
			guaranteedChildren: chain.guaranteedChildren,
			guaranteedWorkers: chain.guaranteedWorkers,
			execution: true,
			workerExecution: chain.workerExecution,
			dynamicFanout: chain.dynamicFanout,
		};
	}

	if (Array.isArray(input.tasks) && input.tasks.length > 0) {
		return {
			kind: "tasks",
			mode: "tasks",
			guaranteedChildren: countStaticTasks(input.tasks),
			guaranteedWorkers: countStaticWorkers(input.tasks),
			execution: true,
			workerExecution: input.tasks.some(isWorkerTask),
			dynamicFanout: false,
		};
	}

	if (typeof input.agent === "string") {
		const worker = input.agent === "worker";
		return {
			kind: "direct",
			mode: "direct",
			guaranteedChildren: 1,
			guaranteedWorkers: worker ? 1 : 0,
			execution: true,
			workerExecution: worker,
			dynamicFanout: false,
		};
	}

	return {
		kind: "indeterminate",
		mode: "indeterminate",
		guaranteedChildren: 0,
		guaranteedWorkers: 0,
		execution: true,
		workerExecution: false,
		dynamicFanout: false,
	};
}

/**
 * Analyzes one model-initiated subagent call. Only action="schedule" is a new
 * deferred execution; all other actions are management or control operations.
 */
export function analyzeSubagentCall(input: unknown): SubagentFanoutAnalysis {
	if (!isRecord(input)) {
		return {
			kind: "indeterminate",
			mode: "indeterminate",
			guaranteedChildren: 0,
			guaranteedWorkers: 0,
			execution: true,
			workerExecution: false,
			dynamicFanout: false,
		};
	}

	if (typeof input.action === "string") {
		const actionAlias = input.action.toLowerCase();
		const aliasesSingleExecution = actionAlias === "single" && (input.agent !== undefined || input.task !== undefined);
		const aliasesTaskExecution = (actionAlias === "parallel" || actionAlias === "tasks")
			&& Array.isArray(input.tasks)
			&& input.tasks.length > 0;
		if (aliasesSingleExecution || aliasesTaskExecution) return analyzeExecution(input);

		if (input.action !== "schedule") {
			return {
				kind: "non-execution",
				guaranteedChildren: 0,
				guaranteedWorkers: 0,
				execution: false,
				workerExecution: false,
				dynamicFanout: false,
			};
		}

		const scheduled = analyzeExecution(input);
		return {
			kind: "scheduled",
			mode: scheduled.mode,
			guaranteedChildren: scheduled.guaranteedChildren,
			guaranteedWorkers: scheduled.guaranteedWorkers,
			execution: true,
			workerExecution: scheduled.workerExecution,
			dynamicFanout: scheduled.dynamicFanout,
			scheduledKind: scheduled.kind as SubagentExecutionMode,
		};
	}

	return analyzeExecution(input);
}

export function blocksForMinimumFanout(analysis: SubagentFanoutAnalysis): boolean {
	return analysis.execution && (
		analysis.guaranteedChildren < 2
		|| (analysis.workerExecution && analysis.guaranteedWorkers < 2)
	);
}

export default function subagentMinimumFanout(pi: ExtensionAPI): void {
	pi.on("tool_call", (event) => {
		if (!isToolCallEventType<"subagent", Record<string, unknown>>("subagent", event)) return;

		try {
			const analysis = analyzeSubagentCall(event.input);
			if (blocksForMinimumFanout(analysis)) {
				return { block: true, reason: MINIMUM_FANOUT_BLOCK_REASON };
			}
		} catch {
			return { block: true, reason: MINIMUM_FANOUT_BLOCK_REASON };
		}
	});
}
