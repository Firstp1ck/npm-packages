import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import conditionalSystemPrompts from "../conditional-system-prompts.ts";

function createHarness() {
	let beforeAgentStart;
	conditionalSystemPrompts({
		on(name, handler) {
			if (name === "before_agent_start") beforeAgentStart = handler;
		},
	});
	assert.equal(typeof beforeAgentStart, "function", "before_agent_start handler is registered");
	return {
		run(systemPrompt = "BASE", selectedTools) {
			return beforeAgentStart({
				systemPrompt,
				systemPromptOptions: selectedTools === undefined ? undefined : { selectedTools },
			});
		},
	};
}

function withAgentDir(agentDir, run) {
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		return run();
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	}
}

function withPlatform(platform, run) {
	const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
	assert.ok(descriptor, "process.platform descriptor is available");
	Object.defineProperty(process, "platform", { ...descriptor, value: platform });
	try {
		return run();
	} finally {
		Object.defineProperty(process, "platform", descriptor);
	}
}

function createAgentDir() {
	return mkdtempSync(join(tmpdir(), "pi-conditional-system-prompts-test-"));
}

function writePrompt(agentDir, fileName, content) {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, fileName), content, "utf8");
}

test("routes the subagent prompt only when the selected tools include subagent and preserves prior prompt content", () => {
	const agentDir = createAgentDir();
	try {
		writePrompt(agentDir, "APPEND_SUBAGENTS.md", "SUBAGENT POLICY");
		withAgentDir(agentDir, () => {
			const harness = createHarness();
			assert.deepEqual(harness.run("BASE\n\nEARLIER", ["read", "subagent"]), { systemPrompt: "BASE\n\nEARLIER\n\nSUBAGENT POLICY" });
			assert.equal(harness.run("BASE", ["read", "grep"]), undefined);
			assert.equal(harness.run("BASE", []), undefined);
		});
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("routes the Windows prompt first and combines both matching prompts in a stable order", () => {
	const agentDir = createAgentDir();
	try {
		writePrompt(agentDir, "APPEND_WINDOWS.md", "WINDOWS POLICY");
		writePrompt(agentDir, "APPEND_SUBAGENTS.md", "SUBAGENT POLICY");
		withAgentDir(agentDir, () => withPlatform("win32", () => {
			const harness = createHarness();
			assert.deepEqual(harness.run("BASE", ["subagent"]), { systemPrompt: "BASE\n\nWINDOWS POLICY\n\nSUBAGENT POLICY" });
		}));
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("caches each loaded prompt for the lifetime of an extension instance", () => {
	const agentDir = createAgentDir();
	try {
		writePrompt(agentDir, "APPEND_SUBAGENTS.md", "FIRST POLICY");
		withAgentDir(agentDir, () => {
			const harness = createHarness();
			assert.deepEqual(harness.run("BASE", ["subagent"]), { systemPrompt: "BASE\n\nFIRST POLICY" });
			writePrompt(agentDir, "APPEND_SUBAGENTS.md", "SECOND POLICY");
			assert.deepEqual(harness.run("BASE", ["subagent"]), { systemPrompt: "BASE\n\nFIRST POLICY" });
		});
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("propagates a missing required prompt-file error only when its condition matches", () => {
	const agentDir = createAgentDir();
	try {
		withAgentDir(agentDir, () => {
			const harness = createHarness();
			assert.equal(harness.run("BASE", ["read"]), undefined);
			assert.throws(
				() => harness.run("BASE", ["subagent"]),
				(error) => error?.code === "ENOENT",
			);
		});
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});
