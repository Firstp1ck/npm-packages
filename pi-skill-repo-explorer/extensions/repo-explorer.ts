import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(extensionDir);
const skillDir = join(packageRoot, "skills", "repo-explorer");
const scriptsDir = join(skillDir, "scripts");
const cacheDir = join(homedir(), ".pi", "agent", "state", "repo-explorer");

const ExploreParams = Type.Object({
	targetPath: Type.String({ description: "Repository or directory to explore. Relative paths resolve from cwd; leading @ is ignored." }),
	goal: Type.String({ description: "What the caller needs to understand, e.g. 'find auth flow'." }),
	depth: Type.Optional(StringEnum(["shallow", "standard", "deep"] as const, { description: "Exploration depth. Defaults to standard." })),
	budget: Type.Optional(StringEnum(["compact", "normal", "full"] as const, { description: "Output budget for model-visible content. Defaults to compact." })),
	includeEvidence: Type.Optional(Type.Boolean({ description: "Include selected evidence snippets in model-visible output. Defaults to false." })),
});

type Budget = "compact" | "normal" | "full";
type ExecResult = Awaited<ReturnType<ExtensionAPI["exec"]>>;
type ReportStatus = "completed" | "failed";

type EffectivenessReportOptions = {
	startedAt: Date;
	completedAt: Date;
	params: {
		targetPath: string;
		goal: string;
		depth?: string;
		budget?: string;
		includeEvidence?: boolean;
	};
	repoPath?: string;
	depth: string;
	budget: Budget;
	includeEvidence: boolean;
	status: ReportStatus;
	handoff?: any;
	validation?: any;
	error?: unknown;
};

let cachedPython: string | undefined;

function cleanInputPath(value: string): string {
	return value.trim().replace(/^@+/, "");
}

function cacheKey(repoPath: string): string {
	const name = basename(repoPath).replace(/[^a-zA-Z0-9_.-]/g, "_") || "repo";
	const hash = createHash("sha256").update(repoPath).digest("hex").slice(0, 10);
	return `${name}-${hash}`;
}

function rel(repoRoot: string, filePath: string): string {
	const value = relative(repoRoot, filePath).replace(/\\/g, "/");
	return value && !value.startsWith("..") ? value : filePath.replace(/\\/g, "/");
}

async function resolvePython(pi: ExtensionAPI, signal?: AbortSignal): Promise<string> {
	if (cachedPython) return cachedPython;
	for (const command of ["python3", "python", "py"]) {
		const result = await pi.exec(command, ["--version"], { timeout: 5_000, signal }).catch(() => undefined);
		if (result?.code === 0) {
			cachedPython = command;
			return command;
		}
	}
	throw new Error("repo_explorer_explore requires python3/python/py on PATH.");
}

async function runPython(pi: ExtensionAPI, scriptName: string, args: string[], signal?: AbortSignal, timeout = 120_000): Promise<ExecResult> {
	const python = await resolvePython(pi, signal);
	const scriptPath = join(scriptsDir, scriptName);
	const result = await pi.exec(python, ["-X", "utf8", scriptPath, ...args], {
		cwd: packageRoot,
		timeout,
		signal,
	});
	if (result.code !== 0) {
		throw new Error(`${scriptName} failed (${result.code}): ${result.stderr || result.stdout}`.trim());
	}
	return result;
}

async function ensureReadableDirectory(targetPath: string, cwd: string): Promise<string> {
	const absolutePath = resolve(cwd, cleanInputPath(targetPath));
	await access(absolutePath);
	const info = await stat(absolutePath);
	if (!info.isDirectory()) throw new Error(`Target path is not a directory: ${absolutePath}`);
	return absolutePath;
}

function limitsFor(budget: Budget, includeEvidence: boolean) {
	if (budget === "full") return { files: 25, symbols: 30, deps: 20, evidence: includeEvidence ? 15 : 0 };
	if (budget === "normal") return { files: 15, symbols: 18, deps: 10, evidence: includeEvidence ? 4 : 0 };
	return { files: 8, symbols: 12, deps: 6, evidence: includeEvidence ? 2 : 0 };
}

function safeTimestamp(date: Date): string {
	return date.toISOString().replace(/[:.]/g, "-");
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function redactReportText(value: unknown): string {
	return String(value ?? "").replace(
		/(sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9_]{10,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._-]+|token\s*=\s*[^&\s]+|password\s*[:=]\s*[^,\s]+)/gi,
		"[REDACTED]",
	);
}

function markdownList(items: string[], fallback = "- None"): string {
	return items.length > 0 ? items.map((item) => `- ${redactReportText(item)}`).join("\n") : fallback;
}

function goalTokens(goal: string): Set<string> {
	return new Set(String(goal ?? "").toLowerCase().match(/[a-z0-9_]+/g) ?? []);
}

function classifyGoal(goal: string): string {
	const tokens = goalTokens(goal);
	if (["trace", "flow", "flows", "wiring", "wire", "dependency", "dependencies", "call", "calls", "route", "routes"].some((token) => tokens.has(token))) return "trace";
	if (["review", "audit", "evaluate", "check", "quality"].some((token) => tokens.has(token))) return "review";
	if (["modify", "implement", "change", "fix", "add", "update"].some((token) => tokens.has(token))) return "change-planning";
	if (["map", "structure", "architecture", "overview"].some((token) => tokens.has(token))) return "mapping";
	if (["find", "locate", "where"].some((token) => tokens.has(token))) return "lookup";
	return "general";
}

function isTraceGoal(goal: string): boolean {
	return classifyGoal(goal) === "trace";
}

function collectImprovementSignals(options: EffectivenessReportOptions, handoff: any, validation: any): string[] {
	const errors = handoff?.errors ?? [];
	const explorerLimitations = handoff?.explorer_limitations ?? [];
	const omitted = handoff?.omitted ?? {};
	const targetRisks = handoff?.risks_and_unknowns ?? [];
	const keyFiles = handoff?.key_files ?? [];
	const symbols = handoff?.relevant_symbols ?? [];
	const deps = handoff?.dependency_map ?? [];
	const reasons = Array.isArray(omitted.reasons) ? omitted.reasons : [];
	const errorCodes = new Set(errors.map((item: any) => item?.code).filter(Boolean));
	const limitationCodes = new Set(explorerLimitations.map((item: any) => item?.code).filter(Boolean));
	const signals: string[] = [];

	if (options.status === "failed") signals.push("invocation_failed");
	if (validation?.valid === false) signals.push("validation_failed");
	if (errorCodes.has("no_match")) signals.push("no_match");
	if (errorCodes.has("index_stale")) signals.push("stale_index");
	if (limitationCodes.has("dependency_trace_empty")) signals.push("dependency_trace_empty");
	if (isTraceGoal(options.params.goal) && options.depth !== "shallow" && deps.length === 0) signals.push("trace_goal_zero_dependencies");
	if (Number(omitted.key_files ?? 0) > Math.max(5, keyFiles.length)) signals.push("high_key_file_omission");
	if (Number(omitted.relevant_symbols ?? 0) > Math.max(5, symbols.length)) signals.push("high_symbol_omission");
	if (Number(omitted.dependency_map ?? 0) > 0) signals.push("dependency_omission");
	if (Number(omitted.evidence ?? 0) > 0 && !options.includeEvidence) signals.push("evidence_lazy_by_request");
	if (reasons.includes("symbol-diversity")) signals.push("symbol_diversity_cap_applied");
	if (targetRisks.some((item: any) => String(item?.description ?? "").toLowerCase().includes("no test"))) signals.push("target_repo_no_tests");

	return Array.from(new Set(signals));
}

function improvementCandidates(signals: string[]): string[] {
	const candidates: string[] = [];
	const has = (signal: string) => signals.includes(signal);
	if (has("invocation_failed") || has("validation_failed")) candidates.push("P0: inspect failed invocation/validation and add a regression fixture for the failing report shape.");
	if (has("no_match")) candidates.push("P0: improve goal keyword expansion, repository scope hints, or fallback structure-first results for no-match cases.");
	if (has("dependency_trace_empty") || has("trace_goal_zero_dependencies")) candidates.push("P1: improve dependency/call tracing for trace-oriented goals, including dynamic imports, re-exports, and call graph extraction.");
	if (has("high_symbol_omission") || has("symbol_diversity_cap_applied")) candidates.push("P1: tune symbol ranking/diversity so compact reports keep only the most goal-relevant symbols.");
	if (has("high_key_file_omission")) candidates.push("P1: tune file ranking or ask callers for narrower target paths when many candidate files are omitted.");
	if (has("dependency_omission")) candidates.push("P2: expose dependency omission details or raise dependency budget for dependency-heavy goals.");
	if (has("stale_index")) candidates.push("P1: force refresh or surface clearer stale-index recovery guidance.");
	if (has("evidence_lazy_by_request")) candidates.push("Info: evidence was intentionally lazy; request includeEvidence=true if exact snippets are needed.");
	if (has("target_repo_no_tests")) candidates.push("Target risk: repository has no tests; this is not an explorer failure but should be visible to the caller.");
	return candidates.length > 0 ? candidates : ["No immediate explorer improvement signal; use downstream feedback fields if the handoff still missed useful files."];
}

function assessEffectiveness(status: ReportStatus, handoff?: any, validation?: any): { label: string; rationale: string[] } {
	if (status === "failed") {
		return { label: "failed", rationale: ["The invocation failed before a validated handoff could be returned."] };
	}

	const errors = handoff?.errors ?? [];
	const keyFiles = handoff?.key_files ?? [];
	const symbols = handoff?.relevant_symbols ?? [];
	const explorerLimitations = handoff?.explorer_limitations ?? [];
	const targetRisks = handoff?.risks_and_unknowns ?? [];
	const errorCodes = new Set(errors.map((item: any) => item?.code).filter(Boolean));
	const meaningfulErrors = errors.filter((item: any) => item?.code !== "budget_exceeded");
	const rationale: string[] = [];

	if (!validation?.valid) {
		rationale.push("Handoff validation failed, so the exploration output needs review before use.");
		return { label: "needs-follow-up", rationale };
	}

	if (errorCodes.has("insufficient_scope") || errorCodes.has("no_match")) {
		rationale.push("The exploration reported insufficient scope or no goal-relevant matches.");
		return { label: "needs-follow-up", rationale };
	}

	if (errorCodes.has("index_stale")) {
		rationale.push("The index is stale enough that follow-up exploration should refresh before relying on the handoff.");
		return { label: "needs-follow-up", rationale };
	}

	if (keyFiles.length === 0 && symbols.length === 0) {
		rationale.push("No key files or symbols were identified, which limits downstream usefulness.");
		return { label: "partial", rationale };
	}

	if (explorerLimitations.some((item: any) => item?.severity === "high")) {
		rationale.push("A high-severity explorer limitation was reported; inspect before relying on the handoff.");
		return { label: "needs-follow-up", rationale };
	}

	if (meaningfulErrors.length > 0 || explorerLimitations.length > 0) {
		rationale.push("The handoff is valid but includes explorer errors or limitations that may require targeted follow-up.");
		return { label: "partial", rationale };
	}

	if (targetRisks.length > 0) {
		rationale.push("The handoff validated and identified goal-relevant files or symbols; target repository risks are reported separately.");
		return { label: "effective", rationale };
	}

	rationale.push("The handoff validated and identified goal-relevant files or symbols without blocking explorer errors.");
	return { label: "effective", rationale };
}

function formatEffectivenessReport(options: EffectivenessReportOptions): string {
	const handoff = options.handoff ?? {};
	const validation = options.validation ?? {};
	const assessment = assessEffectiveness(options.status, handoff, validation);
	const errors = handoff.errors ?? [];
	const targetRisks = handoff.risks_and_unknowns ?? [];
	const explorerLimitations = handoff.explorer_limitations ?? [];
	const validationErrors = validation.errors ?? [];
	const omitted = handoff.omitted ?? {};
	const keyFiles = handoff.key_files ?? [];
	const symbols = handoff.relevant_symbols ?? [];
	const deps = handoff.dependency_map ?? [];
	const evidence = handoff.evidence ?? [];
	const limits = limitsFor(options.budget, options.includeEvidence);
	const targetPath = options.repoPath ?? cleanInputPath(options.params.targetPath);
	const runSeconds = Math.max(0, (options.completedAt.getTime() - options.startedAt.getTime()) / 1000).toFixed(2);
	const modelVisibleText = options.status === "completed" ? formatHandoff(handoff, targetPath, options.budget, options.includeEvidence, validation) : "";
	const omittedCount = (field: string) => Math.max(0, Number(omitted?.[field] ?? 0));
	const totalWithOmitted = (current: number, field: string) => current + omittedCount(field);
	const shown = (current: number, limit: number) => Math.min(current, limit);
	const goalCategory = classifyGoal(options.params.goal);
	const improvementSignals = collectImprovementSignals(options, handoff, validation);
	const candidates = improvementCandidates(improvementSignals);
	const targetKey = cacheKey(targetPath);

	const lines: string[] = [
		"# Repo Explorer Effectiveness Report",
		"",
		`- Generated: ${options.completedAt.toISOString()}`,
		`- Status: ${options.status}`,
		`- Assessment: ${assessment.label}`,
		`- Runtime: ${runSeconds}s`,
		`- Target path: \`${redactReportText(targetPath)}\``,
		`- Goal: ${redactReportText(options.params.goal)}`,
		"",
		"## Tracking Metadata",
		"",
		"- Tracking schema: repo-explorer-effectiveness/v2",
		`- Goal category: ${goalCategory}`,
		`- Trace-oriented goal: ${isTraceGoal(options.params.goal) ? "yes" : "no"}`,
		`- Target repo key: ${redactReportText(targetKey)}`,
		`- Report purpose: per-invocation evidence plus improvement-signal capture`,
		"",
		"## Run Configuration",
		"",
		`- Depth: ${options.depth}`,
		`- Budget: ${options.budget}`,
		`- Evidence requested in tool output: ${options.includeEvidence ? "yes" : "no"}`,
		"",
		"## Effectiveness Signals",
		"",
		`- Handoff validation: ${validation.valid === true ? "valid" : validation.valid === false ? "invalid" : "not available"}`,
		`- Files indexed: ${handoff.index_info?.files_indexed ?? "not available"}`,
		`- Key files found: ${keyFiles.length}`,
		`- Relevant symbols found: ${symbols.length}`,
		`- Dependency edges found: ${deps.length}`,
		`- Evidence snippets collected: ${evidence.length}`,
		`- Explorer limitations reported: ${explorerLimitations.length}`,
		`- Target repository risks reported: ${targetRisks.length}`,
		`- Errors reported: ${errors.length}`,
		"",
		"## Model-Visible Output",
		"",
		`- Key files shown: ${shown(keyFiles.length, limits.files)}/${totalWithOmitted(keyFiles.length, "key_files")}`,
		`- Symbols shown: ${shown(symbols.length, limits.symbols)}/${totalWithOmitted(symbols.length, "relevant_symbols")}`,
		`- Dependency edges shown: ${shown(deps.length, limits.deps)}/${totalWithOmitted(deps.length, "dependency_map")}`,
		`- Evidence snippets shown: ${shown(evidence.length, limits.evidence)}/${totalWithOmitted(evidence.length, "evidence")}`,
		`- Approx output chars: ${modelVisibleText.length || "not available"}`,
		"",
		"## Omitted Items",
		"",
		`- Key files omitted: ${omittedCount("key_files")}`,
		`- Symbols omitted: ${omittedCount("relevant_symbols")}`,
		`- Dependency edges omitted: ${omittedCount("dependency_map")}`,
		`- Evidence omitted: ${omittedCount("evidence")}`,
		`- Omission reasons: ${Array.isArray(omitted.reasons) && omitted.reasons.length > 0 ? omitted.reasons.map(redactReportText).join(", ") : "None"}`,
		"",
		"## Improvement Signals",
		"",
		markdownList(improvementSignals),
		"",
		"## Improvement Candidates",
		"",
		markdownList(candidates),
		"",
		"## Downstream Feedback Capture",
		"",
		"- Downstream files touched: unknown",
		"- Top-ranked file used: unknown",
		"- Manual search needed after handoff: unknown",
		"- Missed files: unknown",
		"- False-positive files: unknown",
		"- User correction or note: unknown",
		"",
		"## Assessment Rationale",
		"",
		markdownList(assessment.rationale),
		"",
		"## Explorer Limitations",
		"",
		markdownList(explorerLimitations.map((item: any) => `[${item?.severity ?? "unknown"}] ${item?.code ?? "unknown"}: ${item?.message ?? "Unnamed limitation"}`)),
		"",
		"## Target Repository Risks",
		"",
		markdownList(targetRisks.map((item: any) => `[${item?.severity ?? "unknown"}] ${item?.description ?? "Unnamed risk"}`)),
		"",
		"## Errors and Validation",
		"",
		markdownList([
			...errors.map((item: any) => `${item?.code ?? "unknown"}: ${item?.message ?? "Unnamed error"}`),
			...validationErrors.map((item: any) => `validation: ${item}`),
		]),
	];

	if (options.error) {
		lines.push("", "## Invocation Failure", "", `- ${redactReportText(errorMessage(options.error))}`);
	}

	lines.push("", "## Notes", "", "This report is written automatically by `repo_explorer_explore` after every invocation.");
	return lines.join("\n") + "\n";
}

async function writeEffectivenessReport(options: EffectivenessReportOptions): Promise<string> {
	await mkdir(skillDir, { recursive: true });
	const keySource = options.repoPath ?? cleanInputPath(options.params.targetPath) ?? "unresolved-target";
	const reportPath = join(skillDir, `repo-explorer-effectiveness-${safeTimestamp(options.startedAt)}-${cacheKey(keySource)}.md`);
	await writeFile(reportPath, formatEffectivenessReport(options), "utf8");
	return reportPath;
}

function formatHandoff(handoff: any, repoRoot: string, budget: Budget, includeEvidence: boolean, validation: any): string {
	const limits = limitsFor(budget, includeEvidence);
	const lines: string[] = [];
	const keyFiles = handoff.key_files ?? [];
	const symbols = handoff.relevant_symbols ?? [];
	const deps = handoff.dependency_map ?? [];
	const targetRisks = handoff.risks_and_unknowns ?? [];
	const explorerLimitations = handoff.explorer_limitations ?? [];
	const errors = handoff.errors ?? [];
	const evidence = handoff.evidence ?? [];
	const omitted = handoff.omitted ?? {};

	lines.push(`repo_explorer_explore: ${validation?.valid ? "valid" : "invalid"} handoff`);
	lines.push(`goal: ${handoff.request?.goal ?? ""}`);
	lines.push(`repo: ${repoRoot}`);
	lines.push(`indexed: ${handoff.index_info?.files_indexed ?? 0} files, age ${handoff.index_info?.index_age_seconds ?? 0}s`);

	lines.push(`\nkey_files (${Math.min(keyFiles.length, limits.files)}/${keyFiles.length}):`);
	for (const item of keyFiles.slice(0, limits.files)) {
		const confidence = item.confidence ? `, confidence=${item.confidence}` : "";
		lines.push(`- ${rel(repoRoot, item.path)} — ${item.role}, ${item.relevance}${confidence}`);
	}

	if (symbols.length > 0) {
		lines.push(`\nsymbols (${Math.min(symbols.length, limits.symbols)}/${symbols.length}):`);
		for (const item of symbols.slice(0, limits.symbols)) {
			const confidence = item.confidence ? `, confidence=${item.confidence}` : "";
			lines.push(`- ${item.name} (${item.kind}) @ ${rel(repoRoot, item.file)}:${item.line_start}-${item.line_end}${confidence}`);
		}
	}

	if (deps.length > 0) {
		lines.push(`\ndependencies (${Math.min(deps.length, limits.deps)}/${deps.length}):`);
		for (const item of deps.slice(0, limits.deps)) lines.push(`- ${item.source} -> ${item.target} (${item.kind})`);
	}

	if (explorerLimitations.length > 0) {
		lines.push("\nexplorer_limitations:");
		for (const item of explorerLimitations.slice(0, 5)) lines.push(`- [${item.severity}] ${item.code}: ${item.message}`);
	}

	if (targetRisks.length > 0) {
		lines.push("\ntarget_risks:");
		for (const item of targetRisks.slice(0, 5)) lines.push(`- [${item.severity}] ${item.description}`);
	}

	if (errors.length > 0) {
		lines.push("\nerrors:");
		for (const item of errors.slice(0, 5)) lines.push(`- ${item.code}: ${item.message}`);
	}

	if (limits.evidence > 0 && evidence.length > 0) {
		lines.push(`\nevidence (${Math.min(evidence.length, limits.evidence)}/${evidence.length}):`);
		for (const item of evidence.slice(0, limits.evidence)) {
			const confidence = item.confidence ? `, confidence=${item.confidence}` : "";
			lines.push(`- ${rel(repoRoot, item.file)}:${item.line_start}-${item.line_end}${confidence} — ${item.context}`);
			lines.push("```text");
			lines.push(String(item.snippet ?? "").split(/\r?\n/).slice(0, 12).join("\n"));
			lines.push("```");
		}
	}

	const omittedEntries = [
		["key_files", omitted.key_files],
		["symbols", omitted.relevant_symbols],
		["dependencies", omitted.dependency_map],
		["evidence", omitted.evidence],
	].filter(([, value]) => Number(value ?? 0) > 0);
	if (omittedEntries.length > 0) {
		lines.push("\nomitted:");
		for (const [label, value] of omittedEntries) lines.push(`- ${label}: ${value}`);
		if (Array.isArray(omitted.reasons) && omitted.reasons.length > 0) lines.push(`- reasons: ${omitted.reasons.join(", ")}`);
	}

	if (budget !== "full") lines.push("\nUse budget='normal'/'full' or includeEvidence=true only when more detail is needed.");
	if (explorerLimitations.length > 0 || errors.length > 0 || omittedEntries.length > 0) {
		lines.push("If a reported limitation, error, or omission blocks the goal, retry repo_explorer_explore with a narrower target or larger budget, then use targeted read/grep/find/ls only for the remaining explicit gap. Do not use Bash fallback.");
	}
	return lines.join("\n");
}

async function buildOrRefreshIndex(pi: ExtensionAPI, repoPath: string, indexPath: string, signal?: AbortSignal): Promise<void> {
	await mkdir(cacheDir, { recursive: true });
	const refresh = await (async () => {
		try {
			return await runPython(pi, "refresh_repo_index.py", ["--repo", repoPath, "--data-dir", cacheDir], signal);
		} catch (error) {
			return error;
		}
	})();

	if (!(refresh instanceof Error)) return;
	await runPython(pi, "build_repo_index.py", ["--repo", repoPath, "--output", indexPath], signal);
}

export default function repoExplorerExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "repo_explorer_explore",
		label: "Repo Explorer",
		description: "Routine native repository exploration: build or refresh a local index, extract and validate a goal-focused handoff, write an effectiveness report, and return compact results.",
		promptSnippet: "Use repo_explorer_explore as the routine repository-exploration path with compact validated output; do not use Bash for routine exploration.",
		promptGuidelines: [
			"Call repo_explorer_explore first for repository exploration; do not use Bash to preflight availability, run helper scripts, or duplicate a successful result.",
			"Start with budget='compact' and includeEvidence=false; retry the native tool with a narrower target, larger budget, or includeEvidence=true only when a reported gap blocks the goal.",
			"For a still-missing fact explicitly identified by limitations, errors, or omissions, use targeted non-shell read/grep/find/ls tools; Bash is diagnostic-only after native unavailability or failure.",
			"Expect every invocation to write a Markdown effectiveness report under skills/repo-explorer/.",
		],
		parameters: ExploreParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const startedAt = new Date();
			const depth = params.depth ?? "standard";
			const budget = (params.budget ?? "compact") as Budget;
			const includeEvidence = params.includeEvidence ?? false;
			let repoPath: string | undefined;

			try {
				repoPath = await ensureReadableDirectory(params.targetPath, ctx.cwd);
				const key = cacheKey(repoPath);
				const indexPath = join(cacheDir, `${key}-index.json`);
				const handoffPath = join(cacheDir, `${key}-handoff.json`);

				await buildOrRefreshIndex(pi, repoPath, indexPath, signal);

				const extract = await runPython(pi, "extract_explorer_handoff.py", [
					"--index", indexPath,
					"--goal", params.goal,
					"--depth", depth,
					"--budget", budget,
					"--include-evidence", includeEvidence ? "true" : "false",
					"--target-paths", repoPath,
				], signal);
				await writeFile(handoffPath, extract.stdout, "utf8");

				const validate = await runPython(pi, "validate_handoff.py", ["--input", handoffPath], signal);
				const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
				const validation = JSON.parse(validate.stdout);
				const reportPath = await writeEffectivenessReport({
					startedAt,
					completedAt: new Date(),
					params,
					repoPath,
					depth,
					budget,
					includeEvidence,
					status: "completed",
					handoff,
					validation,
				});
				const text = `${formatHandoff(handoff, repoPath, budget, includeEvidence, validation)}\n\neffectiveness_report: ${reportPath}`;

				return {
					content: [{ type: "text", text }],
					details: {
						repoPath,
						indexPath,
						handoffPath,
						effectivenessReportPath: reportPath,
						budget,
						includeEvidence,
						validation,
						handoff,
					},
				};
			} catch (error) {
				let reportPath: string;
				try {
					reportPath = await writeEffectivenessReport({
						startedAt,
						completedAt: new Date(),
						params,
						repoPath,
						depth,
						budget,
						includeEvidence,
						status: "failed",
						error,
					});
				} catch (reportError) {
					throw new Error(`${errorMessage(error)}\nAdditionally failed to write repo-explorer effectiveness report: ${errorMessage(reportError)}`);
				}
				throw new Error(`${errorMessage(error)}\nrepo_explorer_effectiveness_report: ${reportPath}`);
			}
		},
	});
}
