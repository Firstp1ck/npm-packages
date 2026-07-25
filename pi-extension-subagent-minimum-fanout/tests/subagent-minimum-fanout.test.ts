import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import subagentMinimumFanout, {
	analyzeSubagentCall,
	blocksForMinimumFanout,
	countStaticChainChildren,
	countStaticTasks,
	countStaticWorkers,
	MINIMUM_FANOUT_BLOCK_REASON,
	positiveTaskCount,
} from "../subagent-minimum-fanout.ts";

type ToolCallHandler = (event: ToolCallEvent) => ToolCallEventResult | undefined;

function createHarness() {
	let handler: ToolCallHandler | undefined;
	subagentMinimumFanout({
		on(name: string, candidate: unknown) {
			if (name === "tool_call") handler = candidate as ToolCallHandler;
		},
	} as unknown as ExtensionAPI);
	if (!handler) throw new Error("tool_call handler was not registered");

	return {
		call(toolName: string, input: unknown) {
			return handler({ type: "tool_call", toolCallId: "test", toolName, input } as ToolCallEvent);
		},
	};
}

function assertBlocked(input: unknown) {
	const result = createHarness().call("subagent", input);
	assert.deepEqual(result, { block: true, reason: MINIMUM_FANOUT_BLOCK_REASON });
}

function assertAllowed(input: Record<string, unknown>) {
	assert.equal(createHarness().call("subagent", input), undefined);
}

test("positive task count defaults invalid values to one and sums top-level tasks", () => {
	assert.equal(positiveTaskCount(2), 2);
	for (const value of [undefined, 0, -1, 1.5, Number.POSITIVE_INFINITY, "2"]) {
		assert.equal(positiveTaskCount(value), 1, String(value));
	}
	const tasks = [{ agent: "worker", count: 2 }, { agent: "reviewer" }];
	assert.equal(countStaticTasks(tasks), 3);
	assert.equal(countStaticWorkers(tasks), 2);
});

test("a direct single execution is analyzed and blocked", () => {
	const analysis = analyzeSubagentCall({ agent: "worker", task: "Implement the change" });
	assert.deepEqual(analysis, {
		kind: "direct",
		mode: "direct",
		guaranteedChildren: 1,
		guaranteedWorkers: 1,
		execution: true,
		workerExecution: true,
		dynamicFanout: false,
	});
	assert.equal(blocksForMinimumFanout(analysis), true);
	assertBlocked({ agent: "worker", task: "Implement the change" });
});

test("one-task and one-static-step workflows are blocked", () => {
	const oneTask = analyzeSubagentCall({ tasks: [{ agent: "worker", task: "Implement the change" }] });
	assert.equal(oneTask.kind, "tasks");
	assert.equal(oneTask.guaranteedChildren, 1);
	assert.equal(blocksForMinimumFanout(oneTask), true);

	const oneStep = analyzeSubagentCall({ chain: [{ agent: "worker", task: "Implement the change" }] });
	assert.equal(oneStep.kind, "chain");
	assert.equal(oneStep.guaranteedChildren, 1);
	assert.equal(blocksForMinimumFanout(oneStep), true);

	assertBlocked({ tasks: [{ agent: "worker", task: "Implement the change" }] });
	assertBlocked({ chain: [{ agent: "worker", task: "Implement the change" }] });
});

test("two declared children and two declared workers are allowed", () => {
	assertAllowed({
		tasks: [
			{ agent: "reviewer", task: "Review correctness" },
			{ agent: "reviewer", task: "Review tests" },
		],
	});
	assertAllowed({ tasks: [{ agent: "worker", task: "Implement the change", count: 2 }] });
	assertAllowed({
		chain: [
			{ agent: "worker", task: "Implement slice A" },
			{ agent: "worker", task: "Implement slice B" },
		],
	});
	assertAllowed({ chain: [{ parallel: [{ agent: "worker", task: "Implement the change", count: 2 }] }] });

	assert.deepEqual(countStaticChainChildren([
		{ agent: "worker", task: "Implement the change" },
		{ parallel: [{ agent: "reviewer", task: "Review the change", count: 2 }] },
	]), {
		guaranteedChildren: 3,
		guaranteedWorkers: 1,
		workerExecution: true,
		dynamicFanout: false,
	});
});

test("one worker cannot hide inside an otherwise compliant multi-child workflow", () => {
	for (const input of [
		{
			tasks: [
				{ agent: "worker", task: "Implement" },
				{ agent: "reviewer", task: "Review" },
			],
		},
		{
			chain: [
				{ agent: "worker", task: "Implement" },
				{ agent: "reviewer", task: "Review" },
			],
		},
		{
			tasks: [
				{ agent: "worker", task: "Implement" },
				{ agent: "reviewer", task: "Review", count: 2 },
			],
		},
		{
			action: "parallel",
			tasks: [
				{ agent: "worker", task: "Implement" },
				{ agent: "reviewer", task: "Review" },
			],
		},
		{
			action: "schedule",
			chain: [
				{ agent: "worker", task: "Implement" },
				{ agent: "reviewer", task: "Review" },
			],
			schedule: "+10m",
		},
	]) {
		const analysis = analyzeSubagentCall(input);
		assert.equal(analysis.guaranteedChildren >= 2, true);
		assert.equal(analysis.guaranteedWorkers, 1);
		assert.equal(analysis.workerExecution, true);
		assert.equal(blocksForMinimumFanout(analysis), true);
		assertBlocked(input);
	}

	assertAllowed({
		tasks: [
			{ agent: "worker", task: "Implement slice A" },
			{ agent: "worker", task: "Implement slice B" },
			{ agent: "reviewer", task: "Review" },
		],
	});
});

test("dynamic expand contributes zero guaranteed children", () => {
	const dynamicStep = {
		expand: { from: { output: "targets", path: "/items" } },
		parallel: { agent: "worker", task: "Inspect {item}" },
		collect: { as: "results" },
	};

	const dynamicOnly = analyzeSubagentCall({ chain: [dynamicStep] });
	assert.equal(dynamicOnly.kind, "indeterminate");
	assert.equal(dynamicOnly.guaranteedChildren, 0);
	assert.equal(dynamicOnly.dynamicFanout, true);
	assert.equal(dynamicOnly.workerExecution, true);
	assert.equal(dynamicOnly.guaranteedWorkers, 0);
	assert.equal(blocksForMinimumFanout(dynamicOnly), true);

	const oneStaticPlusDynamic = analyzeSubagentCall({
		chain: [{ agent: "planner", task: "Identify targets" }, dynamicStep],
	});
	assert.equal(oneStaticPlusDynamic.kind, "chain");
	assert.equal(oneStaticPlusDynamic.guaranteedChildren, 1);
	assert.equal(oneStaticPlusDynamic.dynamicFanout, true);
	assert.equal(oneStaticPlusDynamic.workerExecution, true);
	assert.equal(oneStaticPlusDynamic.guaranteedWorkers, 0);
	assert.equal(blocksForMinimumFanout(oneStaticPlusDynamic), true);

	const twoStaticPlusDynamic = analyzeSubagentCall({
		chain: [
			{ agent: "planner", task: "Identify targets" },
			{ agent: "reviewer", task: "Review the plan" },
			dynamicStep,
		],
	});
	assert.equal(twoStaticPlusDynamic.guaranteedChildren, 2);
	assert.equal(twoStaticPlusDynamic.dynamicFanout, true);
	assert.equal(twoStaticPlusDynamic.workerExecution, true);
	assert.equal(twoStaticPlusDynamic.guaranteedWorkers, 0);
	assert.equal(blocksForMinimumFanout(twoStaticPlusDynamic), true);

	assertBlocked({ chain: [dynamicStep] });
	assertBlocked({ chain: [{ agent: "planner", task: "Identify targets" }, dynamicStep] });
	assertBlocked({
		chain: [
			{ agent: "planner", task: "Identify targets" },
			{ agent: "reviewer", task: "Review the plan" },
			dynamicStep,
		],
	});
	assertAllowed({
		chain: [
			{ parallel: [{ agent: "worker", task: "Inspect A", count: 2 }] },
			dynamicStep,
		],
	});
});

test("execution-mode action aliases follow the same minimum case-insensitively", () => {
	for (const action of ["single", "SINGLE", "Single"]) {
		assertBlocked({ action, agent: "worker", task: "Implement" });
	}
	for (const action of ["tasks", "TASKS", "parallel", "Parallel"]) {
		assertBlocked({ action, tasks: [{ agent: "worker", task: "Implement" }] });
		assertAllowed({
			action,
			tasks: [
				{ agent: "reviewer", task: "Review correctness" },
				{ agent: "reviewer", task: "Review tests" },
			],
		});
	}
});

test("schedule applies the same minimum to deferred direct, tasks, and chain execution", () => {
	const scheduledDirect = analyzeSubagentCall({ action: "schedule", agent: "worker", task: "Implement", schedule: "+10m" });
	assert.equal(scheduledDirect.kind, "scheduled");
	assert.equal(scheduledDirect.scheduledKind, "direct");
	assert.equal(scheduledDirect.guaranteedChildren, 1);
	assert.equal(blocksForMinimumFanout(scheduledDirect), true);
	assertBlocked({ action: "schedule", agent: "worker", task: "Implement", schedule: "+10m" });

	const scheduledTasks = { action: "schedule", tasks: [{ agent: "worker", task: "Implement", count: 2 }], schedule: "+10m" };
	const scheduledChain = {
		action: "schedule",
		chain: [
			{ agent: "worker", task: "Implement slice A" },
			{ agent: "worker", task: "Implement slice B" },
		],
		schedule: "+10m",
	};
	assert.equal(analyzeSubagentCall(scheduledTasks).guaranteedChildren, 2);
	assert.equal(analyzeSubagentCall(scheduledChain).guaranteedChildren, 2);
	assertAllowed(scheduledTasks);
	assertAllowed(scheduledChain);
});

test("management, status, control, recovery, and non-schedule actions remain exempt", () => {
	for (const action of ["list", "status", "resume", "steer", "interrupt", "stop", "append-step", "watchdog.status", "watchdog.configure", "schedule-list", "schedule-status", "schedule-cancel", "unknown-action"]) {
		const analysis = analyzeSubagentCall({ action, agent: "worker" });
		assert.deepEqual(analysis, {
			kind: "non-execution",
			guaranteedChildren: 0,
			guaranteedWorkers: 0,
			execution: false,
			workerExecution: false,
			dynamicFanout: false,
		}, action);
		assert.equal(blocksForMinimumFanout(analysis), false, action);
		assertAllowed({ action, agent: "worker" });
	}
});

test("each independent single-child call and malformed subagent input fail closed", () => {
	const harness = createHarness();
	const input = { agent: "worker", task: "Implement" };
	assert.deepEqual(harness.call("subagent", input), { block: true, reason: MINIMUM_FANOUT_BLOCK_REASON });
	assert.deepEqual(harness.call("subagent", input), { block: true, reason: MINIMUM_FANOUT_BLOCK_REASON });
	assertBlocked(null);
	assertBlocked({});
	assert.equal(harness.call("read", { path: "README.md" }), undefined);

	assert.match(MINIMUM_FANOUT_BLOCK_REASON, /Do not retry a single child/);
	assert.match(MINIMUM_FANOUT_BLOCK_REASON, /work directly in the main agent/i);
	assert.match(MINIMUM_FANOUT_BLOCK_REASON, /one statically compliant tasks or chain workflow/i);
});
