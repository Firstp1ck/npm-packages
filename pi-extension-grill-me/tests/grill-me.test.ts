import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import grillMeExtension from "../index.ts";

type Tool = {
	execute: (
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: { cwd: string },
	) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
};

function createHarness() {
	const tools = new Map<string, Tool>();
	grillMeExtension({
		registerCommand() {},
		registerTool(tool: Tool & { name: string }) {
			tools.set(tool.name, tool);
		},
	} as unknown as ExtensionAPI);

	const recordTurn = tools.get("grill_record_turn");
	const saveResults = tools.get("grill_save_results");
	assert.ok(recordTurn && saveResults, "grill tools should be registered");
	return { recordTurn, saveResults };
}

async function withTempProject(run: (cwd: string) => Promise<void>): Promise<void> {
	const cwd = await mkdtemp(join(tmpdir(), "grill-me-test-"));
	try {
		await run(cwd);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}

test("a resolved turn without a user answer is rejected instead of saving a placeholder", async () => {
	for (const userAnswer of [undefined, "   "]) {
		await withTempProject(async (cwd) => {
			const { recordTurn } = createHarness();
			const result = await recordTurn.execute("test", {
				question: "How should results be displayed?",
				recommendedAnswer: "A: Detailed",
				...(userAnswer === undefined ? {} : { userAnswer }),
				decisionStatus: "resolved",
				notes: "User chose detailed display.",
			}, undefined, undefined, { cwd });

			assert.equal(result.isError, true);
			assert.match(result.content[0]?.text ?? "", /userAnswer is required for resolved turns/i);
			await assert.rejects(readFile(join(cwd, ".pi", "grill-me", "state.json"), "utf8"), { code: "ENOENT" });
		});
	}
});

test("an explicit user answer is preserved in saved results", async () => {
	await withTempProject(async (cwd) => {
		const { recordTurn, saveResults } = createHarness();
		const recordResult = await recordTurn.execute("test", {
			question: "How should results be displayed?",
			recommendedAnswer: "A: Detailed",
			userAnswer: "A: Detailed",
			decisionStatus: "resolved",
			notes: "User chose detailed display.",
		}, undefined, undefined, { cwd });
		assert.equal(recordResult.isError, undefined);

		const saveResult = await saveResults.execute("test", {}, undefined, undefined, { cwd });
		assert.equal(saveResult.isError, undefined);
		const markdown = await readFile(join(cwd, "GRILL-ME.md"), "utf8");
		assert.match(markdown, /\*\*User answer:\*\* A: Detailed/);
		assert.doesNotMatch(markdown, /\*\*User answer:\*\* _\(not recorded\)_/);
	});
});
