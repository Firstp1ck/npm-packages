import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createConditionalSystemPrompts,
	SUBAGENT_GOVERNANCE_CONFIGURATION_ERROR,
	SUBAGENT_GOVERNANCE_SKILL_BRIDGE,
	SUBAGENT_GOVERNANCE_SKILL_NAME,
	subagentGovernanceIsAvailable,
} from "../conditional-system-prompts.ts";

function createHarness(dependencies = {}) {
	let beforeAgentStart;
	createConditionalSystemPrompts({ validateSubagentGovernance: () => true, ...dependencies })({
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

test("routes the governance skill bridge only when selected tools include subagent and preserves prior prompt content", () => {
	const harness = createHarness();
	assert.deepEqual(harness.run("BASE\n\nEARLIER", ["read", "subagent"]), {
		systemPrompt: `BASE\n\nEARLIER\n\n${SUBAGENT_GOVERNANCE_SKILL_BRIDGE}`,
	});
	assert.equal(harness.run("BASE", ["read", "grep"]), undefined);
	assert.equal(harness.run("BASE", []), undefined);
	assert.match(SUBAGENT_GOVERNANCE_SKILL_BRIDGE, /read to load and follow the enabled `subagent-governance` skill/);
	assert.match(SUBAGENT_GOVERNANCE_SKILL_BRIDGE, /references\/PI-EXECUTION-ADAPTER\.md/);
	assert.match(SUBAGENT_GOVERNANCE_SKILL_BRIDGE, /stop delegation and report the configuration error/);
	assert.match(SUBAGENT_GOVERNANCE_SKILL_BRIDGE, /do not silently weaken governance/);
});

test("injects a model-visible configuration error when governance is unavailable", () => {
	const harness = createHarness({ validateSubagentGovernance: () => false });
	assert.deepEqual(harness.run("BASE", ["subagent"]), {
		systemPrompt: `BASE\n\n${SUBAGENT_GOVERNANCE_CONFIGURATION_ERROR}`,
	});
	assert.match(SUBAGENT_GOVERNANCE_CONFIGURATION_ERROR, /Stop delegation until the skill configuration is restored/);
});

test("governance availability checks prompt discovery and required files", () => {
	const agentDir = createAgentDir();
	try {
		const skillDir = join(agentDir, "skills", SUBAGENT_GOVERNANCE_SKILL_NAME);
		mkdirSync(join(skillDir, "references"), { recursive: true });
		const skillPath = join(skillDir, "SKILL.md");
		writeFileSync(skillPath, "# Governance\n", "utf8");
		const systemPrompt = `<available_skills><skill><name>${SUBAGENT_GOVERNANCE_SKILL_NAME}</name><location>${skillPath}</location></skill></available_skills>`;
		assert.equal(subagentGovernanceIsAvailable(systemPrompt), false);
		writeFileSync(join(skillDir, "references", "PI-EXECUTION-ADAPTER.md"), "# Adapter\n", "utf8");
		assert.equal(subagentGovernanceIsAvailable(systemPrompt), true);
		assert.equal(subagentGovernanceIsAvailable("<available_skills></available_skills>"), false);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("routes the Windows prompt first and the governance bridge second", () => {
	const agentDir = createAgentDir();
	try {
		writePrompt(agentDir, "APPEND_WINDOWS.md", "WINDOWS POLICY");
		withAgentDir(agentDir, () => withPlatform("win32", () => {
			const harness = createHarness();
			assert.deepEqual(harness.run("BASE", ["subagent"]), {
				systemPrompt: `BASE\n\nWINDOWS POLICY\n\n${SUBAGENT_GOVERNANCE_SKILL_BRIDGE}`,
			});
		}));
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("caches the Windows prompt for the lifetime of an extension instance", () => {
	const agentDir = createAgentDir();
	try {
		writePrompt(agentDir, "APPEND_WINDOWS.md", "FIRST WINDOWS POLICY");
		withAgentDir(agentDir, () => withPlatform("win32", () => {
			const harness = createHarness();
			assert.deepEqual(harness.run("BASE", ["read"]), { systemPrompt: "BASE\n\nFIRST WINDOWS POLICY" });
			writePrompt(agentDir, "APPEND_WINDOWS.md", "SECOND WINDOWS POLICY");
			assert.deepEqual(harness.run("BASE", ["read"]), { systemPrompt: "BASE\n\nFIRST WINDOWS POLICY" });
		}));
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("missing-file failure applies only to Windows while the subagent bridge needs no file", () => {
	const agentDir = createAgentDir();
	try {
		withAgentDir(agentDir, () => {
			const harness = createHarness();
			assert.deepEqual(harness.run("BASE", ["subagent"]), {
				systemPrompt: `BASE\n\n${SUBAGENT_GOVERNANCE_SKILL_BRIDGE}`,
			});
			assert.throws(
				() => withPlatform("win32", () => harness.run("BASE", ["read"])),
				(error) => error?.code === "ENOENT",
			);
		});
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});
