import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { delay, getAgentEnvPath, getWorkspaceEnvPath, readEnvValue, upsertEnvValue } from "@firstpick/pi-utils";
import { Text } from "@earendil-works/pi-tui";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createSerialRequestQueue } from "./request-queue.ts";

type BraveSearchResult = {
	title?: string;
	url?: string;
	description?: string;
	age?: string;
	extra_snippets?: string[];
};

type BraveResultBlock = {
	results?: BraveSearchResult[];
};

type BraveSearchResponse = {
	query?: Record<string, unknown>;
	mixed?: unknown;
	web?: BraveResultBlock;
	news?: BraveResultBlock;
	videos?: BraveResultBlock;
	faq?: BraveResultBlock;
	discussions?: BraveResultBlock;
	infobox?: BraveResultBlock;
	locations?: BraveResultBlock;
};

type ApiKeySource = "environment" | "workspace .env" | "Pi global .env";

type ApiKeyResolution = {
	apiKey?: string;
	source?: ApiKeySource;
	path?: string;
};

type SetupUiContext = {
	ui: {
		confirm(title: string, message: string): Promise<boolean>;
		input(title: string, placeholder?: string): Promise<string | undefined>;
		select(title: string, options: string[]): Promise<string | undefined>;
		notify(message: string, level?: "info" | "warning" | "error" | "success"): void;
	};
};

type NormalizedResult = BraveSearchResult & {
	canonicalUrl?: string;
	resultType: string;
	originalIndex: number;
	duplicateCount: number;
};

const ENV_KEY = "BRAVE_SEARCH_API_KEY";
const DEFAULT_COUNT_ENV_KEY = "BRAVE_SEARCH_RESULT_COUNT";
const SETUP_PROMPTED_KEY = "__piExtensionBraveSearchSetupPrompted";
const POST_SEARCH_DELAY_MS = 1_100;
const enqueueSearchRequest = createSerialRequestQueue(POST_SEARCH_DELAY_MS, delay);
const API_MIN_WEB_RESULTS = 1;
const API_MAX_WEB_RESULTS = 20;
const DEFAULT_WEB_RESULTS = 5;
const NEAR_API_MAX_WEB_RESULTS = 16;
const RESULT_BLOCKS = ["web", "news", "videos", "faq", "discussions", "infobox", "locations"] as const;

const BraveSearchParams = Type.Object({
	query: Type.String({ description: "Search query" }),
	count: Type.Optional(Type.Integer({ minimum: API_MIN_WEB_RESULTS, maximum: API_MAX_WEB_RESULTS, description: "Maximum number of web results (1-20). Brave only applies count to web results." })),
	country: Type.Optional(Type.String({ description: "Optional country code such as CH, DE, or US" })),
	search_lang: Type.Optional(Type.String({ description: "Optional language code such as en or de" })),
	freshness: Type.Optional(Type.String({ description: "Optional freshness filter such as pd, pw, pm, py, or a custom date range like 2024-01-01to2024-02-01" })),
	safesearch: Type.Optional(Type.String({ description: "Optional safesearch mode such as off, moderate, or strict" })),
	result_filter: Type.Optional(Type.String({ description: "Comma-separated result types, e.g. web,news,videos,faq,discussions,infobox,locations" })),
	extra_snippets: Type.Optional(Type.Boolean({ description: "Request up to 5 additional excerpts per web result when Brave has them" })),
	spellcheck: Type.Optional(Type.Boolean({ description: "Whether Brave should spellcheck the query. Defaults to Brave API default." })),
	text_decorations: Type.Optional(Type.Boolean({ description: "Whether snippets include decoration/highlight markers. Defaults to false for clean LLM-readable output." })),
	goggles: Type.Optional(Type.Array(Type.String(), { description: "Optional Brave Goggles URLs or inline definitions for custom ranking" })),
});

function resolveApiKey(): ApiKeyResolution {
	if (process.env[ENV_KEY]) return { apiKey: process.env[ENV_KEY], source: "environment" };

	const workspaceEnvPath = getWorkspaceEnvPath();
	const workspaceKey = readEnvValue(workspaceEnvPath, ENV_KEY);
	if (workspaceKey) return { apiKey: workspaceKey, source: "workspace .env", path: workspaceEnvPath };

	const globalEnvPath = getAgentEnvPath();
	const globalKey = readEnvValue(globalEnvPath, ENV_KEY);
	if (globalKey) return { apiKey: globalKey, source: "Pi global .env", path: globalEnvPath };

	return {};
}

function resolveDefaultResultCount(): number {
	const configured = process.env[DEFAULT_COUNT_ENV_KEY] ?? readEnvValue(getWorkspaceEnvPath(), DEFAULT_COUNT_ENV_KEY) ?? readEnvValue(getAgentEnvPath(), DEFAULT_COUNT_ENV_KEY);
	const trimmed = configured?.trim();
	if (!trimmed) return DEFAULT_WEB_RESULTS;
	const parsed = Number(trimmed);
	if (Number.isInteger(parsed)) return Math.min(API_MAX_WEB_RESULTS, Math.max(API_MIN_WEB_RESULTS, parsed));
	return DEFAULT_WEB_RESULTS;
}

function persistDefaultResultCount(count: number): string {
	const workspaceEnvPath = getWorkspaceEnvPath();
	const globalEnvPath = getAgentEnvPath();
	const targetPath = readEnvValue(workspaceEnvPath, ENV_KEY) ? workspaceEnvPath : globalEnvPath;
	upsertEnvValue(targetPath, DEFAULT_COUNT_ENV_KEY, String(count));
	process.env[DEFAULT_COUNT_ENV_KEY] = String(count);
	return targetPath;
}

function formatResultCountWarning(count: number): string | undefined {
	if (count >= API_MAX_WEB_RESULTS) return `Brave Web Search count is at the API maximum (${API_MAX_WEB_RESULTS}). The actual number delivered may still be lower.`;
	if (count >= NEAR_API_MAX_WEB_RESULTS) return `Brave Web Search count is near the API maximum (${count}/${API_MAX_WEB_RESULTS}). Higher counts use more response budget and may return fewer actual results.`;
	return undefined;
}

function canonicalizeUrl(value?: string): string | undefined {
	if (!value) return undefined;
	try {
		const url = new URL(value);
		url.hash = "";
		for (const key of [...url.searchParams.keys()]) {
			const lower = key.toLowerCase();
			if (lower.startsWith("utm_") || ["fbclid", "gclid", "msclkid", "mc_cid", "mc_eid"].includes(lower)) {
				url.searchParams.delete(key);
			}
		}
		url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
		if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
		return url.toString();
	} catch {
		return value;
	}
}

function collectResults(data: BraveSearchResponse): NormalizedResult[] {
	const seen = new Map<string, NormalizedResult>();
	const results: NormalizedResult[] = [];

	for (const blockName of RESULT_BLOCKS) {
		const block = data[blockName];
		for (const [index, result] of (block?.results ?? []).entries()) {
			const canonicalUrl = canonicalizeUrl(result.url);
			const dedupeKey = canonicalUrl ?? `${blockName}:${result.title ?? ""}:${result.description ?? ""}`;
			const existing = seen.get(dedupeKey);
			if (existing) {
				existing.duplicateCount += 1;
				continue;
			}

			const normalized = {
				...result,
				canonicalUrl,
				resultType: blockName,
				originalIndex: index + 1,
				duplicateCount: 0,
			};
			seen.set(dedupeKey, normalized);
			results.push(normalized);
		}
	}

	return results;
}

async function promptForSetup(ctx: SetupUiContext): Promise<void> {
	const existing = resolveApiKey();
	if (existing.apiKey) return;

	const state = globalThis as typeof globalThis & { [SETUP_PROMPTED_KEY]?: boolean };
	if (state[SETUP_PROMPTED_KEY]) return;
	state[SETUP_PROMPTED_KEY] = true;

	const shouldConfigure = await ctx.ui.confirm(
		"Brave Search API key missing",
		`${ENV_KEY} is not configured. Set it up now?`
	);
	if (!shouldConfigure) return;

	const apiKey = await ctx.ui.input("Brave Search API key", "Paste your Brave Search API key");
	const trimmedApiKey = apiKey?.trim();
	if (!trimmedApiKey) {
		ctx.ui.notify("Brave Search setup cancelled: no API key entered.", "warning");
		return;
	}

	const target = await ctx.ui.select("Save Brave Search API key where?", [
		"Current workspace .env",
		"Pi global .env",
	]);
	if (!target) {
		ctx.ui.notify("Brave Search setup cancelled: no save location selected.", "warning");
		return;
	}

	const filePath = target === "Pi global .env" ? getAgentEnvPath() : getWorkspaceEnvPath();
	upsertEnvValue(filePath, ENV_KEY, trimmedApiKey);
	process.env[ENV_KEY] = trimmedApiKey;
	ctx.ui.notify(`Brave Search API key saved to ${filePath}`, "info");
}

export default function braveSearchExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		await promptForSetup(ctx);
	});

	pi.registerCommand("brave-search-status", {
		description: "Show Brave Search API key configuration status",
		handler: async (_args, ctx) => {
			const resolution = resolveApiKey();
			if (!resolution.apiKey) {
				ctx.ui.notify(`${ENV_KEY} is not configured.`, "warning");
				return;
			}
			ctx.ui.notify(
				`Brave Search configured via ${resolution.source}${resolution.path ? ` (${resolution.path})` : ""}.`,
				"info"
			);
		},
	});

	pi.registerCommand("brave-search-setup", {
		description: "Interactively configure the Brave Search API key",
		handler: async (_args, ctx) => {
			const state = globalThis as typeof globalThis & { [SETUP_PROMPTED_KEY]?: boolean };
			state[SETUP_PROMPTED_KEY] = false;
			await promptForSetup(ctx);
		},
	});

	pi.registerCommand("brave-search-results", {
		description: "Show and adjust the default Brave Search web result count",
		handler: async (_args, ctx) => {
			const current = resolveDefaultResultCount();
			const warning = formatResultCountWarning(current);
			const answer = await ctx.ui.input(
				"Brave Search result count",
				`Current: ${current}. Enter ${API_MIN_WEB_RESULTS}-${API_MAX_WEB_RESULTS} web results. ${warning ?? ""}`.trim()
			);
			const trimmed = answer?.trim();
			if (!trimmed) {
				ctx.ui.notify(`Brave Search default result count remains ${current}.`, "info");
				return;
			}

			const requested = Number(trimmed);
			if (!Number.isInteger(requested)) {
				ctx.ui.notify(`Invalid result count: ${trimmed}. Enter an integer from ${API_MIN_WEB_RESULTS} to ${API_MAX_WEB_RESULTS}.`, "error");
				return;
			}

			const next = Math.min(API_MAX_WEB_RESULTS, Math.max(API_MIN_WEB_RESULTS, requested));
			const filePath = persistDefaultResultCount(next);
			const clampNote = next !== requested ? ` Requested ${requested}, clamped to API range.` : "";
			const nextWarning = formatResultCountWarning(next);
			ctx.ui.notify(`Brave Search default result count set to ${next} in ${filePath}.${clampNote}`, nextWarning ? "warning" : "info");
			if (nextWarning) ctx.ui.notify(nextWarning, "warning");
		},
	});

	pi.registerTool({
		name: "brave_search",
		label: "Brave Search",
		description: `Search the public web with Brave Search API for current information and official documentation. Brave Web Search supports ${API_MIN_WEB_RESULTS}-${API_MAX_WEB_RESULTS} web results per request; count only applies to web results. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first).`,
		promptSnippet: "Search the public web for current information, documentation, and official references.",
		promptGuidelines: [
			"Use brave_search before claiming current facts from the web.",
			"Use brave_search for official documentation and up-to-date external references.",
			"Use result_filter, freshness, and extra_snippets to narrow searches when useful.",
		],
		parameters: BraveSearchParams,
		renderCall(args, theme, _context) {
			let text = theme.fg("toolTitle", theme.bold("brave_search "));
			if (typeof args.query === "string" && args.query.trim()) {
				text += theme.fg("accent", `\"${args.query}\"`);
			} else {
				text += theme.fg("muted", "searching...");
			}
			const count = typeof args.count === "number" ? args.count : resolveDefaultResultCount();
			text += theme.fg("dim", ` (${count} results)`);
			return new Text(text, 0, 0);
		},
		async execute(_toolCallId, params, signal) {
			const { apiKey } = resolveApiKey();
			if (!apiKey) throw new Error(`${ENV_KEY} is not set. Run /brave-search-setup to configure it.`);

			return enqueueSearchRequest(async () => {
				const url = new URL("https://api.search.brave.com/res/v1/web/search");
				const requestedCount = params.count ?? resolveDefaultResultCount();
				const count = Math.min(API_MAX_WEB_RESULTS, Math.max(API_MIN_WEB_RESULTS, requestedCount));
				url.searchParams.set("q", params.query);
				url.searchParams.set("count", String(count));
				url.searchParams.set("text_decorations", String(params.text_decorations ?? false));
				if (params.country) url.searchParams.set("country", params.country);
				if (params.search_lang) url.searchParams.set("search_lang", params.search_lang);
				if (params.freshness) url.searchParams.set("freshness", params.freshness);
				if (params.safesearch) url.searchParams.set("safesearch", params.safesearch);
				if (params.result_filter) url.searchParams.set("result_filter", params.result_filter);
				if (typeof params.extra_snippets === "boolean") url.searchParams.set("extra_snippets", String(params.extra_snippets));
				if (typeof params.spellcheck === "boolean") url.searchParams.set("spellcheck", String(params.spellcheck));
				if (Array.isArray(params.goggles)) {
					for (const goggle of params.goggles) url.searchParams.append("goggles", goggle);
				}

				const response = await fetch(url, {
					method: "GET",
					headers: {
						Accept: "application/json",
						"Accept-Encoding": "gzip",
						"X-Subscription-Token": apiKey,
					},
					signal,
				});

				if (!response.ok) {
					const body = await response.text();
					throw new Error(`Brave Search API failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`);
				}

				const data = (await response.json()) as BraveSearchResponse;
				const countWarning = formatResultCountWarning(count);
				const results = collectResults(data);

				if (results.length === 0) {
					return {
						content: [{ type: "text", text: "No results found." }],
						details: {
							query: params.query,
							queryInfo: data.query,
							responseTypes: Object.keys(data),
							requestedWebResultCount: count,
							resultCountWarning: countWarning,
							resultCount: 0,
							results: [],
							truncation: undefined,
						},
					};
				}

				const rawOutput = results
					.map((result, index) => {
						const lines = [`${index + 1}. [${result.resultType}] ${result.title ?? "Untitled"}`, result.url ?? ""];
						if (result.description) lines.push(result.description);
						for (const snippet of result.extra_snippets ?? []) lines.push(`Extra: ${snippet}`);
						if (result.age) lines.push(`Age: ${result.age}`);
						if (result.duplicateCount > 0) lines.push(`Duplicates removed: ${result.duplicateCount}`);
						return lines.join("\n");
					})
					.join("\n\n");

				const truncation = truncateHead(rawOutput, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});

				let text = truncation.content;
				if (truncation.truncated) {
					text += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
				}

				return {
					content: [{ type: "text", text }],
					details: {
						query: params.query,
						queryInfo: data.query,
						responseTypes: Object.keys(data),
						requestedWebResultCount: count,
						resultCountWarning: countWarning,
						resultCount: results.length,
						results: results.map((result) => ({
							title: result.title,
							url: result.url,
							canonicalUrl: result.canonicalUrl,
							description: result.description,
							extra_snippets: result.extra_snippets,
							age: result.age,
							resultType: result.resultType,
							originalIndex: result.originalIndex,
							duplicateCount: result.duplicateCount,
						})),
						truncation: truncation.truncated ? truncation : undefined,
					},
				};
			});
		},
	});
}
