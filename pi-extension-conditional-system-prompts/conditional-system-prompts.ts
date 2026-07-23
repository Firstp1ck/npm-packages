import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function conditionalSystemPrompts(pi: ExtensionAPI) {
	const cache = new Map<string, string>();
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
			prompts.push(loadPrompt("APPEND_SUBAGENTS.md"));
		}

		const conditionalPrompt = prompts.filter(Boolean).join("\n\n");
		if (!conditionalPrompt) return;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${conditionalPrompt}`,
		};
	});
}
