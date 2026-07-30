import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const SUBAGENT_GOVERNANCE_SKILL_NAME = "subagent-governance";

export const SUBAGENT_GOVERNANCE_SKILL_BRIDGE = [
	"Before deciding between direct and delegated work, launching or replacing children, accepting integration, or dispositioning reviewer findings, use read to load and follow the enabled `subagent-governance` skill from its path in <available_skills>.",
	"Read its references/PI-EXECUTION-ADAPTER.md for Pi-specific posture and use the installed `pi-subagents` skill for runtime mechanics.",
	"If the governance skill or required reference is unavailable or unreadable, stop delegation and report the configuration error; do not silently weaken governance.",
].join(" ");

export const SUBAGENT_GOVERNANCE_CONFIGURATION_ERROR =
	"Configuration error: the enabled `subagent-governance` skill or its Pi execution adapter is unavailable or unreadable. Stop delegation until the skill configuration is restored.";

function decodeXmlText(value: string): string {
	return value
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", "\"")
		.replaceAll("&apos;", "'")
		.replaceAll("&amp;", "&");
}

function findSkillLocation(systemPrompt: string, skillName: string): string | undefined {
	for (const match of systemPrompt.matchAll(/<skill>([\s\S]*?)<\/skill>/gu)) {
		const block = match[1];
		if (!block.includes(`<name>${skillName}</name>`)) continue;
		const location = block.match(/<location>([\s\S]*?)<\/location>/u)?.[1].trim();
		return location ? decodeXmlText(location) : undefined;
	}
	return undefined;
}

export function subagentGovernanceIsAvailable(systemPrompt: string): boolean {
	const skillPath = findSkillLocation(systemPrompt, SUBAGENT_GOVERNANCE_SKILL_NAME);
	if (!skillPath) return false;
	const skillDir = dirname(skillPath);
	try {
		return [
			skillPath,
			join(skillDir, "references", "PI-EXECUTION-ADAPTER.md"),
		].every((path) => readFileSync(path, "utf8").trim().length > 0);
	} catch {
		return false;
	}
}

export type SubagentGovernanceValidator = (systemPrompt: string) => boolean;

export interface ConditionalSystemPromptsDependencies {
	validateSubagentGovernance?: SubagentGovernanceValidator;
}

export function createConditionalSystemPrompts(dependencies: ConditionalSystemPromptsDependencies = {}) {
	return (pi: ExtensionAPI) => {
		const cache = new Map<string, string>();
		const validateSubagentGovernance = dependencies.validateSubagentGovernance ?? subagentGovernanceIsAvailable;
		const loadPrompt = (fileName: string): string => {
			const cached = cache.get(fileName);
			if (cached !== undefined) return cached;

			const prompt = readFileSync(join(getAgentDir(), fileName), "utf8").trim();
			cache.set(fileName, prompt);
			return prompt;
		};

		pi.on("before_agent_start", (event) => {
			const prompts: string[] = [];

			if (process.platform === "win32") {
				prompts.push(loadPrompt("APPEND_WINDOWS.md"));
			}

			if (event.systemPromptOptions.selectedTools?.includes("subagent")) {
				prompts.push(validateSubagentGovernance(event.systemPrompt)
					? SUBAGENT_GOVERNANCE_SKILL_BRIDGE
					: SUBAGENT_GOVERNANCE_CONFIGURATION_ERROR);
			}

			const conditionalPrompt = prompts.filter(Boolean).join("\n\n");
			if (!conditionalPrompt) return;

			return {
				systemPrompt: `${event.systemPrompt}\n\n${conditionalPrompt}`,
			};
		});
	};
}

export default createConditionalSystemPrompts();
