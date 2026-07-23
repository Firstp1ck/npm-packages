import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type SubagentExecutionMode = "direct" | "tasks" | "chain" | "indeterminate";
export type SubagentAnalysisKind = SubagentExecutionMode | "scheduled" | "non-execution";

export interface SubagentFanoutAnalysis {
	kind: SubagentAnalysisKind;
	mode?: SubagentExecutionMode;
	guaranteedChildren: number;
	execution: boolean;
	dynamicFanout: boolean;
	scheduledKind?: SubagentExecutionMode;
}

export const MINIMUM_FANOUT_BLOCK_REASON = [
	"Blocked by the zero-or-multiple delegation policy: this request declares fewer than two statically guaranteed child launches.",
	"Do not retry a single child.",
	"Either work directly in the main agent, or issue one statically compliant tasks or chain workflow with at least two necessary child launches.",
].join(" ");

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Returns a declared positive integer count, defaulting invalid or omitted values to one child. */
export function positiveTaskCount(value: unknown): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 1;
}

/** Sums the statically declared children in a top-level tasks workflow. */
export function countStaticTasks(tasks: unknown): number {
	if (!Array.isArray(tasks)) return 0;
	return tasks.reduce((total, task) => total + positiveTaskCount(isRecord(task) ? task.count : undefined), 0);
}

export interface StaticChainCount {
	guaranteedChildren: number;
	dynamicFanout: boolean;
}

/**
 * Counts only chain children that are known at tool-call time. Dynamic expand
 * templates intentionally contribute zero because their cardinality is unknown.
 */
export function countStaticChainChildren(chain: unknown): StaticChainCount {
	if (!Array.isArray(chain)) return { guaranteedChildren: 0, dynamicFanout: false };

	return chain.reduce<StaticChainCount>((total, step) => {
		if (!isRecord(step)) return total;

		if (Array.isArray(step.parallel)) {
			return {
				guaranteedChildren: total.guaranteedChildren + countStaticTasks(step.parallel),
				dynamicFanout: total.dynamicFanout,
			};
		}

		if (isRecord(step.parallel) || step.expand !== undefined) {
			return { ...total, dynamicFanout: true };
		}

		if (typeof step.agent === "string") {
			return { ...total, guaranteedChildren: total.guaranteedChildren + 1 };
		}

		return total;
	}, { guaranteedChildren: 0, dynamicFanout: false });
}

function analyzeExecution(input: Record<string, unknown>): SubagentFanoutAnalysis {
	if (Array.isArray(input.chain) && input.chain.length > 0) {
		const chain = countStaticChainChildren(input.chain);
		const mode: SubagentExecutionMode = chain.dynamicFanout && chain.guaranteedChildren === 0 ? "indeterminate" : "chain";
		return {
			kind: mode,
			mode,
			guaranteedChildren: chain.guaranteedChildren,
			execution: true,
			dynamicFanout: chain.dynamicFanout,
		};
	}

	if (Array.isArray(input.tasks) && input.tasks.length > 0) {
		return {
			kind: "tasks",
			mode: "tasks",
			guaranteedChildren: countStaticTasks(input.tasks),
			execution: true,
			dynamicFanout: false,
		};
	}

	if (typeof input.agent === "string") {
		return {
			kind: "direct",
			mode: "direct",
			guaranteedChildren: 1,
			execution: true,
			dynamicFanout: false,
		};
	}

	return {
		kind: "indeterminate",
		mode: "indeterminate",
		guaranteedChildren: 0,
		execution: true,
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
			execution: true,
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
				execution: false,
				dynamicFanout: false,
			};
		}

		const scheduled = analyzeExecution(input);
		return {
			kind: "scheduled",
			mode: scheduled.mode,
			guaranteedChildren: scheduled.guaranteedChildren,
			execution: true,
			dynamicFanout: scheduled.dynamicFanout,
			scheduledKind: scheduled.kind as SubagentExecutionMode,
		};
	}

	return analyzeExecution(input);
}

export function blocksForMinimumFanout(analysis: SubagentFanoutAnalysis): boolean {
	return analysis.execution && analysis.guaranteedChildren < 2;
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
