import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

interface GrillTurn {
	question: string;
	recommendedAnswer: string;
	userAnswer?: string;
	decisionStatus: "resolved" | "open" | "needs-codebase-check";
	notes?: string;
}

interface GrillState {
	createdAt: string;
	updatedAt: string;
	projectDir: string;
	plan: string;
	turns: GrillTurn[];
}

const RecordTurnParams = Type.Object({
	question: Type.String({ description: "The exact question asked, one question only." }),
	recommendedAnswer: Type.String({ description: "The assistant's recommended answer to the question." }),
	userAnswer: Type.Optional(Type.String({ description: "The user's explicit answer. Required when decisionStatus is resolved." })),
	decisionStatus: Type.Union([
		Type.Literal("resolved"),
		Type.Literal("open"),
		Type.Literal("needs-codebase-check"),
	]),
	notes: Type.Optional(Type.String({ description: "Short rationale, dependency, or follow-up notes." })),
});

const SaveResultsParams = Type.Object({
	path: Type.Optional(Type.String({ description: "Relative output path. Defaults to GRILL-ME.md." })),
	summary: Type.Optional(Type.String({ description: "Optional current shared-understanding summary." })),
	agreedDecisions: Type.Optional(Type.Array(Type.String())),
	openRisks: Type.Optional(Type.Array(Type.String())),
	nextDecisionNeeded: Type.Optional(Type.String()),
});

function stateDir(cwd: string): string {
	return join(cwd, ".pi", "grill-me");
}

function statePath(cwd: string): string {
	return join(stateDir(cwd), "state.json");
}

async function readState(cwd: string): Promise<GrillState | undefined> {
	try {
		return JSON.parse(await readFile(statePath(cwd), "utf8")) as GrillState;
	} catch {
		return undefined;
	}
}

async function writeState(cwd: string, state: GrillState): Promise<void> {
	await mkdir(stateDir(cwd), { recursive: true });
	await writeFile(statePath(cwd), JSON.stringify(state, null, 2) + "\n", "utf8");
}

function renderMarkdown(
	state: GrillState,
	extra: { summary?: string; agreedDecisions?: string[]; openRisks?: string[]; nextDecisionNeeded?: string },
): string {
	const lines: string[] = [];
	lines.push("# Grill Me Results", "");
	lines.push(`Generated: ${new Date().toISOString()}`, "");
	lines.push("## Plan", "", state.plan.trim() || "_(none recorded)_", "");
	if (extra.summary?.trim()) {
		lines.push("## Shared Understanding", "", extra.summary.trim(), "");
	}
	lines.push("## Questions and Answers", "");
	if (state.turns.length === 0) {
		lines.push("_(No turns recorded.)", "");
	} else {
		state.turns.forEach((turn, index) => {
			lines.push(`### ${index + 1}. ${turn.question}`, "");
			lines.push(`**Recommended answer:** ${turn.recommendedAnswer || "_(none)_"}`, "");
			lines.push(`**User answer:** ${turn.userAnswer || "_(not recorded)_"}`, "");
			lines.push(`**Status:** ${turn.decisionStatus}`, "");
			if (turn.notes?.trim()) lines.push(`**Notes:** ${turn.notes.trim()}`, "");
		});
	}
	if (extra.agreedDecisions?.length) {
		lines.push("## Agreed Decisions", "", ...extra.agreedDecisions.map((d) => `- ${d}`), "");
	}
	if (extra.openRisks?.length) {
		lines.push("## Open Risks", "", ...extra.openRisks.map((r) => `- ${r}`), "");
	}
	if (extra.nextDecisionNeeded?.trim()) {
		lines.push("## Next Decision Needed", "", extra.nextDecisionNeeded.trim(), "");
	}
	return lines.join("\n");
}

function safeOutputPath(cwd: string, input?: string): string {
	const requested = input?.trim() || "GRILL-ME.md";
	const absolute = resolve(cwd, requested);
	const root = resolve(cwd);
	if (absolute !== root && !absolute.startsWith(root + "/")) {
		throw new Error(`Refusing to write outside project directory: ${requested}`);
	}
	return absolute;
}

export default function grillMeExtension(pi: ExtensionAPI) {
	pi.registerCommand("grill-me", {
		description: "Start a deterministic design interview and save results to Markdown",
		handler: async (args, ctx) => {
			const plan = args.trim() || "(No plan supplied yet. Ask the user to paste or describe the plan first.)";
			const state: GrillState = {
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				projectDir: ctx.cwd,
				plan,
				turns: [],
			};
			await writeState(ctx.cwd, state);
			ctx.ui.notify(`Grill session initialized: ${statePath(ctx.cwd)}`, "info");

			pi.sendUserMessage(`Start /grill-me for this plan:\n\n${plan}\n\nRules:\n- Interview me relentlessly about every aspect of this plan until we reach shared understanding.\n- Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.\n- Ask exactly one question at a time.\n- For each question, provide your recommended answer.\n- If a question can be answered by exploring the codebase, explore the codebase instead.\n- Use grill_record_turn after each question/answer decision is captured.\n- For every resolved turn, include my explicit choice in userAnswer; do not leave the answer only in notes.\n- Use grill_save_results to save the results into a Markdown file in the project directory when enough understanding has been reached or when I ask to stop/save.`);
		},
	});

	pi.registerTool({
		name: "grill_record_turn",
		label: "Grill Record Turn",
		description: "Record one /grill-me question, recommended answer, user answer, and decision status in project state.",
		promptSnippet: "Record structured progress for an active /grill-me design interview",
		promptGuidelines: [
			"Use grill_record_turn after each /grill-me interview question is answered or resolved from codebase exploration.",
			"For a resolved turn, userAnswer must contain the explicit selected or discovered answer; notes are not a substitute.",
			"Do not use grill_record_turn for more than one question at a time.",
		],
		parameters: RecordTurnParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (params.decisionStatus === "resolved" && !params.userAnswer?.trim()) {
				return {
					content: [{
						type: "text",
						text: "userAnswer is required for resolved turns. Retry with the user's explicit choice or the answer discovered from the codebase.",
					}],
					isError: true,
					details: { path: statePath(ctx.cwd), decisionStatus: params.decisionStatus },
				};
			}
			const state = (await readState(ctx.cwd)) ?? {
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				projectDir: ctx.cwd,
				plan: "(state was created by grill_record_turn; no plan recorded)",
				turns: [],
			};
			state.turns.push({
				...params,
				userAnswer: params.userAnswer?.trim() || undefined,
			} as GrillTurn);
			state.updatedAt = new Date().toISOString();
			await writeState(ctx.cwd, state);
			return {
				content: [{ type: "text", text: `Recorded grill turn #${state.turns.length}` }],
				details: { path: statePath(ctx.cwd), count: state.turns.length },
			};
		},
	});

	pi.registerTool({
		name: "grill_save_results",
		label: "Grill Save Results",
		description: "Save the active /grill-me interview state as a Markdown file inside the project directory.",
		promptSnippet: "Save /grill-me interview decisions and risks to Markdown in the project directory",
		promptGuidelines: ["Use grill_save_results when the /grill-me interview is complete or the user asks to save/stop."],
		parameters: SaveResultsParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const state = await readState(ctx.cwd);
			if (!state) {
				return {
					content: [{ type: "text", text: "No active /grill-me state found. Run /grill-me first." }],
					isError: true,
					details: { path: statePath(ctx.cwd) },
				};
			}
			const outputPath = safeOutputPath(ctx.cwd, params.path);
			await writeFile(outputPath, renderMarkdown(state, params), "utf8");
			return {
				content: [{ type: "text", text: `Saved grill results to ${outputPath}` }],
				details: { path: outputPath, turns: state.turns.length },
			};
		},
	});
}
