import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import featureSystemPrompt, {
	buildClassifierPrompt,
	buildFeatureClassificationContext,
	CLASSIFIER_TIMEOUT_MS,
	createFeatureSystemPrompt,
	FEATURE_CLASSIFICATION_FALLBACK,
	FEATURE_PROMPT_LOAD_FAILURE_FALLBACK,
	getFeatureComplexity,
	isLikelyContinuation,
	MAX_CLASSIFIER_PROMPT_CHARS,
	parseRequestKind,
	REQUEST_KINDS,
	resolveRequestKind,
	shouldInjectFeaturePrompt,
	type ActiveClassifierModel,
	type ClassifierPromptInput,
	type FeatureSystemPromptDependencies,
	type RequestKind,
} from "../feature-system-prompt.ts";

type BeforeAgentStartEvent = { prompt: string; systemPrompt: string };
type BeforeAgentStartResult = { systemPrompt: string } | undefined;
type BeforeAgentStartHandler = (event: BeforeAgentStartEvent, ctx: Pick<ExtensionContext, "model">) => Promise<BeforeAgentStartResult>;
type LifecycleHandler = () => void;

const ACTIVE_MODEL = { provider: "local-provider", id: "active-conversation-model" } as ActiveClassifierModel;

function createFeaturePromptHarness(dependencies: FeatureSystemPromptDependencies) {
	let beforeAgentStart: BeforeAgentStartHandler | undefined;
	const lifecycleHandlers = new Map<string, LifecycleHandler>();
	createFeatureSystemPrompt(dependencies)({
		on(name: string, candidate: unknown) {
			if (name === "before_agent_start") beforeAgentStart = candidate as BeforeAgentStartHandler;
			else lifecycleHandlers.set(name, candidate as LifecycleHandler);
		},
	} as unknown as ExtensionAPI);

	if (!beforeAgentStart) throw new Error("before_agent_start handler was not registered");
	return {
		beforeAgentStart,
		lifecycleHandlers,
		run(prompt: string) {
			return beforeAgentStart({ prompt, systemPrompt: "BASE" }, { model: ACTIVE_MODEL } as Pick<ExtensionContext, "model">);
		},
		runWithoutModel(prompt: string) {
			return beforeAgentStart({ prompt, systemPrompt: "BASE" }, { model: undefined } as Pick<ExtensionContext, "model">);
		},
	};
}

function injectedFeaturePrompt(kind: "feature_lightweight" | "feature_complex", prompt = "FEATURE INSTRUCTIONS") {
	return `BASE\n\n${buildFeatureClassificationContext(kind)}\n\n${prompt}`;
}

test("the taxonomy has every approved label and parses only exact labels", () => {
	assert.deepEqual(REQUEST_KINDS, [
		"feature_lightweight",
		"feature_complex",
		"bug",
		"refactor",
		"maintenance",
		"documentation",
		"test",
		"planning",
		"research",
		"review",
		"troubleshooting",
		"operations",
		"question",
		"continuation",
		"other",
	]);

	for (const kind of REQUEST_KINDS) assert.equal(parseRequestKind(kind), kind);
	for (const output of ["", "feature", "Feature", " feature_lightweight", "feature_complex ", "feature_lightweight\n", "feature_complex.", "feature_lightweight\nbug"]) {
		assert.equal(parseRequestKind(output), undefined, output);
	}
});

test("continuation resolution inherits only a known effective kind", () => {
	assert.equal(resolveRequestKind("continuation", "feature_lightweight"), "feature_lightweight");
	assert.equal(resolveRequestKind("continuation", "feature_complex"), "feature_complex");
	assert.equal(resolveRequestKind("continuation", "bug"), "bug");
	assert.equal(resolveRequestKind("continuation", undefined), "other");
	assert.equal(resolveRequestKind("refactor", "feature_complex"), "refactor");
});

test("the continuation signal is conservative and exported", () => {
	for (const prompt of ["Continue", "Continue with that implementation", "go on", "Yes, please continue", "Approved", "Fix it"]) {
		assert.equal(isLikelyContinuation(prompt), true, prompt);
	}
	for (const prompt of ["Add a command palette", "Explain this error", "I approve a new deployment plan", "continue by writing a full proposal with alternatives", "x".repeat(241)]) {
		assert.equal(isLikelyContinuation(prompt), false, prompt);
	}
});

test("classifier prompt is bounded and current-only by default", () => {
	const current = `${"c".repeat(MAX_CLASSIFIER_PROMPT_CHARS)}CURRENT-TAIL`;
	const previous = `${"p".repeat(MAX_CLASSIFIER_PROMPT_CHARS)}PREVIOUS-TAIL`;
	const currentOnly = buildClassifierPrompt({ prompt: current });
	assert.ok(currentOnly.includes(JSON.stringify(`${"c".repeat(MAX_CLASSIFIER_PROMPT_CHARS - 1)}…`)));
	assert.ok(!currentOnly.includes("Previous request"));
	assert.ok(!currentOnly.includes("CURRENT-TAIL"));

	const withContinuation = buildClassifierPrompt({
		prompt: current,
		previousPrompt: previous,
		previousEffectiveKind: "feature_complex",
	});
	assert.ok(withContinuation.includes(JSON.stringify(`${"p".repeat(MAX_CLASSIFIER_PROMPT_CHARS - 1)}…`)));
	assert.ok(withContinuation.includes("Previous effective kind: feature_complex"));
	assert.ok(withContinuation.includes("use only for continuation detection"));
	assert.ok(!withContinuation.includes("PREVIOUS-TAIL"));
});

test("feature complexity and injection are limited to successful feature labels", () => {
	assert.equal(getFeatureComplexity("feature_lightweight"), "lightweight");
	assert.equal(getFeatureComplexity("feature_complex"), "complex");
	assert.equal(getFeatureComplexity("bug"), undefined);
	for (const kind of REQUEST_KINDS) {
		assert.equal(shouldInjectFeaturePrompt(kind), kind === "feature_lightweight" || kind === "feature_complex", kind);
	}
	assert.equal(shouldInjectFeaturePrompt(undefined), false);
	assert.match(buildFeatureClassificationContext("feature_lightweight"), /`lightweight` feature/);
	assert.match(buildFeatureClassificationContext("feature_complex"), /`complex` feature/);
	assert.throws(() => buildFeatureClassificationContext("question"), /requires a feature result/);
});

test("the handler uses the active conversation model and sends prior context only for likely continuations", async () => {
	const classifierInputs: ClassifierPromptInput[] = [];
	const classifierModels: ActiveClassifierModel[] = [];
	const classifications: RequestKind[] = ["feature_complex", "continuation", "question", "continuation"];
	const harness = createFeaturePromptHarness({
		classifyRequest: async (input, model) => {
			classifierInputs.push(input);
			classifierModels.push(model);
			return classifications.shift();
		},
		loadFeaturePrompt: () => "FEATURE INSTRUCTIONS",
	});

	assert.deepEqual(await harness.run("Add a command palette"), { systemPrompt: injectedFeaturePrompt("feature_complex") });
	assert.deepEqual(await harness.run("Continue with that implementation"), { systemPrompt: injectedFeaturePrompt("feature_complex") });
	assert.equal(await harness.run("Explain the existing API"), undefined);
	assert.equal(await harness.run("Continue"), undefined);

	assert.deepEqual(classifierModels, [ACTIVE_MODEL, ACTIVE_MODEL, ACTIVE_MODEL, ACTIVE_MODEL]);
	assert.deepEqual(classifierInputs[0], { prompt: "Add a command palette" });
	assert.deepEqual(classifierInputs[1], {
		prompt: "Continue with that implementation",
		previousPrompt: "Add a command palette",
		previousEffectiveKind: "feature_complex",
	});
	assert.deepEqual(classifierInputs[2], { prompt: "Explain the existing API" });
	assert.deepEqual(classifierInputs[3], {
		prompt: "Continue",
		previousPrompt: "Explain the existing API",
		previousEffectiveKind: "question",
	});
});

test("successful feature and non-feature routing injects only the appropriate policy", async () => {
	const classifications: RequestKind[] = ["feature_lightweight", "review"];
	const harness = createFeaturePromptHarness({
		classifyRequest: async () => classifications.shift(),
		loadFeaturePrompt: () => "FEATURE INSTRUCTIONS",
	});

	assert.deepEqual(await harness.run("Add a focused command"), { systemPrompt: injectedFeaturePrompt("feature_lightweight") });
	assert.equal(await harness.run("Review this diff"), undefined);
});

test("classifier invalid output, throw, and no active model inject only the short fallback", async () => {
	let featurePromptLoads = 0;
	const invalidHarness = createFeaturePromptHarness({
		classifyRequest: async () => undefined,
		loadFeaturePrompt: () => {
			featurePromptLoads += 1;
			return "FEATURE INSTRUCTIONS";
		},
	});
	assert.deepEqual(await invalidHarness.run("Do some work"), { systemPrompt: `BASE\n\n${FEATURE_CLASSIFICATION_FALLBACK}` });

	const throwingHarness = createFeaturePromptHarness({
		classifyRequest: async () => {
			throw new Error("classifier unavailable");
		},
	});
	assert.deepEqual(await throwingHarness.run("Do some work"), { systemPrompt: `BASE\n\n${FEATURE_CLASSIFICATION_FALLBACK}` });

	let classifierCalls = 0;
	const noModelHarness = createFeaturePromptHarness({
		classifyRequest: async () => {
			classifierCalls += 1;
			return "feature_complex";
		},
	});
	assert.deepEqual(await noModelHarness.runWithoutModel("Do some work"), { systemPrompt: `BASE\n\n${FEATURE_CLASSIFICATION_FALLBACK}` });
	assert.equal(featurePromptLoads, 0);
	assert.equal(classifierCalls, 0);
	assert.ok(!FEATURE_CLASSIFICATION_FALLBACK.includes("## Feature Request Classification"));
	assert.ok(!FEATURE_CLASSIFICATION_FALLBACK.includes("FEATURE INSTRUCTIONS"));
});

test("a successful classified feature retains the missing feature-prompt safety fallback", async () => {
	const harness = createFeaturePromptHarness({
		classifyRequest: async () => "feature_lightweight",
		loadFeaturePrompt: () => {
			throw new Error("APPEND_FEATURE.md is missing");
		},
	});
	assert.deepEqual(await harness.run("Add a command palette"), {
		systemPrompt: injectedFeaturePrompt("feature_lightweight", FEATURE_PROMPT_LOAD_FAILURE_FALLBACK),
	});
	assert.match(FEATURE_PROMPT_LOAD_FAILURE_FALLBACK, /Do not implement feature work until APPEND_FEATURE\.md is restored\./);
});

test("session starts reset continuation state for startup, new, resume, fork, and reload", async () => {
	for (const reason of ["startup", "new", "resume", "fork", "reload"]) {
		const classifications: RequestKind[] = ["feature_complex", "continuation"];
		const harness = createFeaturePromptHarness({
			classifyRequest: async () => classifications.shift(),
			loadFeaturePrompt: () => "FEATURE INSTRUCTIONS",
		});
		assert.deepEqual(await harness.run("Add a command palette"), { systemPrompt: injectedFeaturePrompt("feature_complex") }, reason);
		const sessionStart = harness.lifecycleHandlers.get("session_start");
		assert.ok(sessionStart, `${reason}: session_start handler is registered`);
		sessionStart();
		assert.equal(await harness.run("Continue"), undefined, reason);
	}
});

test("tree navigation resets branch-local continuation state", async () => {
	const classifications: RequestKind[] = ["feature_lightweight", "continuation"];
	const harness = createFeaturePromptHarness({
		classifyRequest: async () => classifications.shift(),
		loadFeaturePrompt: () => "FEATURE INSTRUCTIONS",
	});
	assert.deepEqual(await harness.run("Add a command palette"), { systemPrompt: injectedFeaturePrompt("feature_lightweight") });
	const sessionTree = harness.lifecycleHandlers.get("session_tree");
	assert.ok(sessionTree, "session_tree handler is registered");
	sessionTree();
	assert.equal(await harness.run("Continue"), undefined);
});

test("extension registration is inert until a lifecycle event and has no hard-coded classifier model contract", () => {
	const registeredEvents: string[] = [];
	featureSystemPrompt({
		on(name: string) {
			registeredEvents.push(name);
		},
	} as unknown as ExtensionAPI);
	assert.deepEqual(registeredEvents, ["session_start", "session_tree", "before_agent_start"]);
	assert.equal(CLASSIFIER_TIMEOUT_MS, 15_000);
});
