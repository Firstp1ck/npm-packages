import * as fs from "node:fs";
import * as path from "node:path";
import { buildSessionContext, formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import type { BuildSystemPromptOptions, ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  appendInitialPromptCalibrationRecord,
  buildInitialPromptCalibrationRecord,
  collectInitialPromptCalibration,
  estimateInitialPromptInput,
  estimatePromptInjectionTokens,
  estimateStableInitialPromptFromPiContext,
  estimateTokensFromCharCount,
  extractXmlTag,
  formatTokens,
  truncate,
  type InitialPromptCalibration,
  type InitialPromptEstimateSnapshot,
  type InitialPromptInputEstimate,
  type InitialPromptToolInfo,
} from "@firstpick/pi-utils";

type DayUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
  messages: number;
};

type UsageRecord = {
  day: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
  model: string;
  sessionFile: string;
  sessionId: string;
  sessionName?: string;
  sessionTitle?: string;
};

type Totals = DayUsage;

type PendingInitialPromptMeasurement = {
  estimate: InitialPromptInputEstimate;
  firstUserTokens: number;
  skipReason?: string;
};

type PromptInjectionSource = {
  label: string;
  chars: number;
};

type TokenBreakdownSource = {
  label: string;
  chars: number;
};

const DEFAULT_DAYS = 14;
const MAX_BAR_WIDTH = 24;
const COST_BAR_WIDTH = 10;
const FIRST_USER_MESSAGE_FRAMING_TOKENS = 16;
const CALIBRATION_PROMPT = "Calibration probe: reply with exactly `calibration-ok` and no other text.";
const WEBUI_STATS_STATUS_KEY = "stats-webui";
const WEBUI_STATS_PAYLOAD_TYPE = "firstpick.pi-extension-stats.overlay";
const WEBUI_STATS_PAYLOAD_VERSION = 1;

function addPromptSource(sources: PromptInjectionSource[], label: string, content: string | undefined): number {
  if (!content) return 0;
  const chars = content.length;
  if (chars <= 0) return 0;
  sources.push({ label, chars });
  return chars;
}

function buildPromptInjectionSourcesFromPrompt(systemPrompt: string): PromptInjectionSource[] {
  const sources: PromptInjectionSource[] = [];
  let attributedChars = 0;

  const addRange = (label: string, start: number, end: number) => {
    if (start < 0 || end <= start) return;
    attributedChars += addPromptSource(sources, label, systemPrompt.slice(start, end));
  };

  const toolsStart = systemPrompt.indexOf("Available tools:\n");
  const toolsEnd = toolsStart >= 0 ? systemPrompt.indexOf("\n\nIn addition to the tools above", toolsStart) : -1;
  if (toolsStart >= 0 && toolsEnd > toolsStart) {
    addRange("Tools", toolsStart, toolsEnd);
  }

  const appendStart = systemPrompt.indexOf("# APPEND_SYSTEM.md");
  const projectContextStart = systemPrompt.indexOf("\n\n# Project Context\n");
  const skillsStart = systemPrompt.indexOf("\n<available_skills>");
  const dateStart = systemPrompt.indexOf("\nCurrent date:");

  if (appendStart >= 0) {
    const appendEndCandidates = [projectContextStart, skillsStart, dateStart].filter((i) => i > appendStart);
    const appendEnd = appendEndCandidates.length > 0 ? Math.min(...appendEndCandidates) : systemPrompt.length;
    addRange("APPEND_SYSTEM.md file", appendStart, appendEnd);
  }

  if (projectContextStart >= 0) {
    const contextEndCandidates = [skillsStart, dateStart].filter((i) => i > projectContextStart);
    const contextEnd = contextEndCandidates.length > 0 ? Math.min(...contextEndCandidates) : systemPrompt.length;
    const contextBlock = systemPrompt.slice(projectContextStart, contextEnd);
    const headingRegex = /^## (.+)$/gm;
    const headings = Array.from(contextBlock.matchAll(headingRegex));

    if (headings.length === 0) {
      attributedChars += addPromptSource(sources, "Project context files", contextBlock);
    } else {
      for (let i = 0; i < headings.length; i++) {
        const heading = headings[i];
        const nextHeading = headings[i + 1];
        const start = heading.index;
        const end = nextHeading?.index ?? contextBlock.length;
        if (start === undefined) continue;

        const contextPath = heading[1]?.trim() ?? "unknown";
        const fileName = path.basename(contextPath);
        const label = /^AGENTS\.md$/i.test(fileName)
          ? `AGENTS.md: ${contextPath}`
          : /^CLAUDE\.md$/i.test(fileName)
            ? `CLAUDE.md: ${contextPath}`
            : `Context file: ${contextPath}`;
        attributedChars += addPromptSource(sources, label, contextBlock.slice(start, end));
      }
    }
  }

  if (skillsStart >= 0) {
    const skillsEnd = dateStart > skillsStart ? dateStart : systemPrompt.length;
    const skillsBlock = systemPrompt.slice(skillsStart, skillsEnd);
    const skillCount = (skillsBlock.match(/<skill>/g) ?? []).length;
    attributedChars += addPromptSource(sources, skillCount > 0 ? `Skills (${skillCount})` : "Skills", skillsBlock);
  }

  const piPromptChars = Math.max(0, systemPrompt.length - attributedChars);
  if (piPromptChars > 0) {
    sources.unshift({ label: "System prompt of Pi / metadata", chars: piPromptChars });
  }

  return sources.length > 0 ? sources : [{ label: "Current system prompt", chars: systemPrompt.length }];
}

function buildPromptInjectionSources(systemPrompt: string, options: BuildSystemPromptOptions | null): PromptInjectionSource[] {
  if (!options) {
    return buildPromptInjectionSourcesFromPrompt(systemPrompt);
  }

  const sources: PromptInjectionSource[] = [];
  let attributedChars = 0;

  const addSource = (label: string, content: string | undefined) => {
    attributedChars += addPromptSource(sources, label, content);
  };

  const selectedTools = options.selectedTools ?? ["read", "bash", "edit", "write"];
  const visibleTools = selectedTools.filter((name) => !!options.toolSnippets?.[name]);
  const toolsList = visibleTools.map((name) => `- ${name}: ${options.toolSnippets?.[name] ?? ""}`).join("\n");
  addSource("Tools", toolsList);

  if (options.skills && options.skills.length > 0) {
    addSource(`Skills (${options.skills.length})`, formatSkillsForPrompt(options.skills));
  }

  if (options.customPrompt) {
    addSource("Custom system prompt", options.customPrompt);
  }

  addSource("APPEND_SYSTEM.md / append-system", options.appendSystemPrompt);

  for (const contextFile of options.contextFiles ?? []) {
    const fileName = path.basename(contextFile.path);
    if (/^AGENTS\.md$/i.test(fileName)) {
      addSource(`AGENTS.md: ${contextFile.path}`, contextFile.content);
    } else if (/^CLAUDE\.md$/i.test(fileName)) {
      addSource(`CLAUDE.md: ${contextFile.path}`, contextFile.content);
    } else {
      addSource(`Context file: ${contextFile.path}`, contextFile.content);
    }
  }

  const piPromptChars = Math.max(0, systemPrompt.length - attributedChars);
  if (piPromptChars > 0) {
    sources.unshift({
      label: options.customPrompt ? "Pi prompt wrapper / metadata" : "System prompt of Pi",
      chars: piPromptChars,
    });
  }

  return sources;
}

function formatTokenCell(tokens: number): string {
  return tokens < 0 ? `-${formatTokens(Math.abs(tokens))}` : formatTokens(tokens);
}

function distributeCalibratedTokens<T extends { tokens: number }>(sources: T[], calibratedTotal: number): T[] {
  const uncalibratedTotal = sources.reduce((sum, source) => sum + source.tokens, 0);
  if (uncalibratedTotal <= 0 || calibratedTotal <= 0) return sources.map((source) => ({ ...source, tokens: 0 }));

  const exact = sources.map((source, index) => {
    const scaled = (source.tokens / uncalibratedTotal) * calibratedTotal;
    const tokens = Math.floor(scaled);
    return { index, tokens, remainder: scaled - tokens };
  });
  let remaining = calibratedTotal - exact.reduce((sum, source) => sum + source.tokens, 0);
  for (const source of [...exact].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (remaining <= 0) break;
    source.tokens += 1;
    remaining -= 1;
  }

  return sources.map((source, index) => ({ ...source, tokens: exact[index]?.tokens ?? 0 }));
}

function formatPromptInjectionLines(
  systemPrompt: string,
  options: BuildSystemPromptOptions | null,
  estimate: InitialPromptInputEstimate,
  metadata?: { source?: string; warning?: string },
): string[] {
  const promptSources = buildPromptInjectionSources(systemPrompt, options)
    .map((source) => ({
      ...source,
      tokens: systemPrompt.length > 0 ? Math.round((source.chars / systemPrompt.length) * estimate.promptText) : estimateTokensFromCharCount(source.chars),
    }))
    .sort((a, b) => b.tokens - a.tokens || b.chars - a.chars);
  const uncalibratedSources = [
    estimate.toolSchemas > 0
      ? { label: `Active tool schemas (${estimate.toolCount})`, chars: 0, tokens: estimate.toolSchemas }
      : null,
    estimate.framing > 0 ? { label: "Provider/request framing", chars: 0, tokens: estimate.framing } : null,
    ...promptSources,
  ].filter((source): source is { label: string; chars: number; tokens: number } => !!source && source.tokens !== 0);
  const sources = distributeCalibratedTokens(uncalibratedSources, estimate.total)
    .filter((source) => source.tokens !== 0)
    .sort((a, b) => Math.abs(b.tokens) - Math.abs(a.tokens) || b.chars - a.chars);
  const labelWidth = Math.max("Source".length, ...sources.map((source) => source.label.length));
  const tokenWidth = Math.max("Tokens".length, ...sources.map((source) => formatTokenCell(source.tokens).length));
  const percentWidth = "%".length;
  const separator = `├${"─".repeat(labelWidth + 2)}┼${"─".repeat(tokenWidth + 2)}┼${"─".repeat(percentWidth + 6)}┤`;
  const rows = sources.map((source) => {
    const percent = estimate.total > 0 ? `${((source.tokens / estimate.total) * 100).toFixed(1)}%` : "0.0%";
    return `│ ${source.label.padEnd(labelWidth)} │ ${formatTokenCell(source.tokens).padStart(tokenWidth)} │ ${percent.padStart(percentWidth + 4)} │`;
  });
  const range = estimate.low !== estimate.high ? ` · range ${formatTokens(estimate.low)}–${formatTokens(estimate.high)}` : "";

  const metadataLines = [
    metadata?.source ? `Source: ${metadata.source}` : null,
    metadata?.warning ? `Note: ${metadata.warning}` : null,
  ].filter((line): line is string => !!line);

  const confidenceLabel = estimate.confidence === "measured-after-call" ? "measured" : `${estimate.confidence} estimate`;

  return [
    `PI initial input: ~${formatTokens(estimate.total)} tok (${confidenceLabel}${range})`,
    ...metadataLines,
    `┌${"─".repeat(labelWidth + 2)}┬${"─".repeat(tokenWidth + 2)}┬${"─".repeat(percentWidth + 6)}┐`,
    `│ ${"Source".padEnd(labelWidth)} │ ${"Tokens".padStart(tokenWidth)} │ ${"%".padStart(percentWidth + 4)} │`,
    separator,
    ...rows,
    `└${"─".repeat(labelWidth + 2)}┴${"─".repeat(tokenWidth + 2)}┴${"─".repeat(percentWidth + 6)}┘`,
  ];
}


type PromptSkillDetail = {
  name: string;
  description?: string;
  location?: string;
};

type ToolPromptEntry = {
  name: string;
  snippet: string;
};

type ContextFileDetail = {
  path: string;
  chars?: number;
};

function formatCountedNames(names: string[], limit = 18): string {
  if (names.length === 0) return "none";
  const shown = names.slice(0, limit).join(", ");
  const remaining = names.length - limit;
  return remaining > 0 ? `${shown}, … +${remaining} more` : shown;
}

function extractAvailableToolPromptEntries(systemPrompt: string): ToolPromptEntry[] {
  const marker = "Available tools:\n";
  const start = systemPrompt.indexOf(marker);
  if (start < 0) return [];

  const tail = systemPrompt.slice(start + marker.length);
  const blockEnd = tail.search(/\n\n/);
  const block = blockEnd >= 0 ? tail.slice(0, blockEnd) : tail;
  const entries: ToolPromptEntry[] = [];
  const seen = new Set<string>();

  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^-\s+([^:\s]+):\s*(.*)$/);
    const name = match?.[1]?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    entries.push({ name, snippet: match?.[2]?.trim() ?? "" });
  }

  return entries;
}

function extractPromptSkills(systemPrompt: string, options: BuildSystemPromptOptions | null): PromptSkillDetail[] {
  const blockMatch = systemPrompt.match(/<available_skills>([\s\S]*?)<\/available_skills>/i);
  const block = blockMatch?.[1];
  if (block) {
    const skills: PromptSkillDetail[] = [];
    for (const match of block.matchAll(/<skill>([\s\S]*?)<\/skill>/gi)) {
      const skillBlock = match[1] ?? "";
      const name = extractXmlTag(skillBlock, "name");
      if (!name) continue;
      skills.push({
        name,
        description: extractXmlTag(skillBlock, "description"),
        location: extractXmlTag(skillBlock, "location"),
      });
    }
    if (skills.length > 0) return skills;
  }

  return (options?.skills ?? [])
    .filter((skill) => !skill.disableModelInvocation)
    .map((skill) => ({ name: skill.name, description: skill.description, location: skill.filePath }));
}

function extractPromptContextFiles(systemPrompt: string, options: BuildSystemPromptOptions | null): ContextFileDetail[] {
  if (options?.contextFiles && options.contextFiles.length > 0) {
    return options.contextFiles.map((file) => ({ path: file.path, chars: file.content.length }));
  }

  const projectContextStart = systemPrompt.indexOf("\n\n# Project Context\n");
  if (projectContextStart < 0) return [];

  const skillsStart = systemPrompt.indexOf("\n<available_skills>", projectContextStart);
  const dateStart = systemPrompt.indexOf("\nCurrent date:", projectContextStart);
  const endCandidates = [skillsStart, dateStart].filter((index) => index > projectContextStart);
  const projectContextEnd = endCandidates.length > 0 ? Math.min(...endCandidates) : systemPrompt.length;
  const contextBlock = systemPrompt.slice(projectContextStart, projectContextEnd);
  const contextFiles: ContextFileDetail[] = [];

  for (const match of contextBlock.matchAll(/^## (.+)$/gm)) {
    const contextPath = match[1]?.trim();
    if (contextPath) contextFiles.push({ path: contextPath });
  }

  return contextFiles;
}

function extractPromptLineValue(systemPrompt: string, label: string): string | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = systemPrompt.match(new RegExp(`^${escapedLabel}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim();
}

function getToolParameterSummary(parameters: unknown): string {
  const record = (parameters && typeof parameters === "object" ? parameters : {}) as Record<string, unknown>;
  const properties = record.properties && typeof record.properties === "object" ? Object.keys(record.properties as Record<string, unknown>).length : 0;
  const required = Array.isArray(record.required) ? record.required.length : 0;
  if (properties <= 0) return "no params";
  return `${properties} param${properties === 1 ? "" : "s"}${required > 0 ? `, ${required} required` : ""}`;
}

function estimateToolSchemaTokens(tool: InitialPromptToolInfo): number {
  return estimatePromptInjectionTokens(
    JSON.stringify({
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.parameters ?? {},
    }),
  );
}

function pushDetailSection(lines: string[], title: string, body: string[]): void {
  const cleanBody = body.filter((line) => line.trim().length > 0);
  if (cleanBody.length === 0) return;

  const ruleLength = 52;
  const heading = `╭─ ${title} ${"─".repeat(Math.max(3, ruleLength - title.length))}`;
  lines.push("", heading, ...cleanBody.map((line) => `│ ${line}`), `╰${"─".repeat(Math.max(3, heading.length - 1))}`);
}

function formatInitialPromptDetailedLines(
  promptEstimate: InitialPromptEstimateSnapshot,
  options: BuildSystemPromptOptions | null,
): string[] {
  const systemPrompt = promptEstimate.systemPrompt;
  const estimate = promptEstimate.estimate;
  const tools = promptEstimate.tools;
  const toolPromptEntries = extractAvailableToolPromptEntries(systemPrompt);
  const skills = extractPromptSkills(systemPrompt, options);
  const contextFiles = extractPromptContextFiles(systemPrompt, options);
  const currentDate = extractPromptLineValue(systemPrompt, "Current date");
  const cwd = extractPromptLineValue(systemPrompt, "Current working directory");
  const promptGuidelines = options?.promptGuidelines ?? [];
  const sourceLabel = promptEstimate.source === "export-html" ? "export HTML" : "live context fallback";
  const calibration = estimate.calibrationSamples > 0
    ? `×${estimate.calibrationMultiplier.toFixed(2)} (${estimate.calibrationSamples} sample${estimate.calibrationSamples === 1 ? "" : "s"})`
    : "none";
  const detailLines = ["Initial prompt details", "━━━━━━━━━━━━━━━━━━━━━━"];

  pushDetailSection(detailLines, "Snapshot", [
    `• source: ${sourceLabel}`,
    `• system prompt: ${systemPrompt.length.toLocaleString()} chars`,
    `• active tool schemas: ${tools.length}`,
    `• available-tool prompt entries: ${toolPromptEntries.length}`,
    `• skills in prompt: ${skills.length}`,
    `• context files: ${contextFiles.length}`,
  ]);

  pushDetailSection(detailLines, "Estimate components", [
    `• prompt text: ~${formatTokens(estimate.promptText)} tok`,
    `• tool schemas: ~${formatTokens(estimate.toolSchemas)} tok`,
    `• provider/request framing: ~${formatTokens(estimate.framing)} tok`,
    `• calibration: ${calibration}`,
  ]);

  const metadataParts = [currentDate ? `date: ${currentDate}` : null, cwd ? `cwd: ${cwd}` : null, promptGuidelines.length > 0 ? `extra guidelines: ${promptGuidelines.length}` : null].filter((part): part is string => !!part);
  pushDetailSection(detailLines, "Prompt metadata", metadataParts.map((part) => `• ${part}`));

  if (tools.length > 0) {
    const toolSummaries = tools
      .map((tool) => ({
        ...tool,
        tokens: estimateToolSchemaTokens(tool),
        parametersSummary: getToolParameterSummary(tool.parameters),
        description: truncate(tool.description ?? "", 72),
      }))
      .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
    const shown = toolSummaries.slice(0, 12);
    const remaining = toolSummaries.length - shown.length;
    const toolLines = shown.map((tool, index) => {
      const description = tool.description ? ` · ${tool.description}` : "";
      return `${String(index + 1).padStart(2, "0")}. ${tool.name} — ~${formatTokens(tool.tokens)} tok · ${tool.parametersSummary}${description}`;
    });
    if (remaining > 0) toolLines.push(`… ${remaining} more active schema${remaining === 1 ? "" : "s"}: ${formatCountedNames(toolSummaries.slice(shown.length).map((tool) => tool.name), 16)}`);
    pushDetailSection(detailLines, `Active tool schemas · top ${shown.length} by size`, toolLines);
  }

  pushDetailSection(
    detailLines,
    "Available-tools prompt entries",
    toolPromptEntries.length > 0 ? [`• ${formatCountedNames(toolPromptEntries.map((tool) => tool.name), 24)}`] : [],
  );

  if (skills.length > 0) {
    const shown = skills.slice(0, 10);
    const remaining = skills.length - shown.length;
    const skillLines = shown.map((skill) => {
      const description = skill.description ? ` — ${truncate(skill.description, 96)}` : "";
      return `• ${skill.name}${description}`;
    });
    if (remaining > 0) skillLines.push(`… ${remaining} more skill${remaining === 1 ? "" : "s"}: ${formatCountedNames(skills.slice(shown.length).map((skill) => skill.name), 16)}`);
    pushDetailSection(detailLines, `Skills in prompt · top ${shown.length}`, skillLines);
  }

  if (contextFiles.length > 0) {
    const shown = contextFiles.slice(0, 8);
    const remaining = contextFiles.length - shown.length;
    const contextLines = shown.map((file) => {
      const chars = typeof file.chars === "number" ? ` · ${file.chars.toLocaleString()} chars` : "";
      return `• ${file.path}${chars}`;
    });
    if (remaining > 0) contextLines.push(`… ${remaining} more context file${remaining === 1 ? "" : "s"}`);
    pushDetailSection(detailLines, `Context files · ${contextFiles.length}`, contextLines);
  }

  return detailLines;
}

function stringifyContextValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function summarizeMessageForTokenBreakdown(message: unknown): { label: string; chars: number } {
  const record = (message && typeof message === "object" ? message : {}) as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role : "message";
  const contentChars = stringifyContextValue(record.content).length;
  const toolCallsChars = stringifyContextValue(record.toolCalls ?? record.tool_calls).length;
  const nameChars = stringifyContextValue(record.name).length;
  const metadataChars = Math.max(0, stringifyContextValue(record).length - contentChars - toolCallsChars - nameChars);

  if (role === "assistant" && toolCallsChars > 2) {
    return { label: "Assistant messages + tool calls", chars: contentChars + toolCallsChars + metadataChars };
  }
  if (role === "tool" || role === "function") {
    return { label: "Tool results / command output", chars: stringifyContextValue(record).length };
  }
  if (role === "user") {
    return { label: "User messages / working context", chars: stringifyContextValue(record).length };
  }
  if (role === "assistant") {
    return { label: "Assistant messages", chars: stringifyContextValue(record).length };
  }
  return { label: "Other session context", chars: stringifyContextValue(record).length };
}

function buildCurrentContextTokenSources(systemPrompt: string, options: BuildSystemPromptOptions | null, ctx: { sessionManager: { getBranch(): unknown[]; getLeafId(): string | null } }): TokenBreakdownSource[] {
  const sources = new Map<string, TokenBreakdownSource>();
  const add = (label: string, chars: number) => {
    if (chars <= 0) return;
    const prev = sources.get(label);
    if (prev) {
      prev.chars += chars;
    } else {
      sources.set(label, { label, chars });
    }
  };

  for (const source of buildPromptInjectionSources(systemPrompt, options)) {
    add(source.label, source.chars);
  }

  try {
    const branch = ctx.sessionManager.getBranch() as never[];
    const sessionContext = buildSessionContext(branch, ctx.sessionManager.getLeafId());
    for (const message of sessionContext.messages) {
      const summary = summarizeMessageForTokenBreakdown(message);
      add(summary.label, summary.chars);
    }
  } catch {
    // Keep /stats tokens useful even if the session branch cannot be reconstructed.
  }

  return Array.from(sources.values());
}

function formatTokenBreakdownTable(title: string, sources: TokenBreakdownSource[], actualTotalTokens?: number | null): string[] {
  const rows = sources
    .map((source) => ({ ...source, tokens: estimateTokensFromCharCount(source.chars) }))
    .sort((a, b) => b.tokens - a.tokens || b.chars - a.chars);
  const estimatedTotalTokens = rows.reduce((sum, row) => sum + row.tokens, 0);
  const percentBase = actualTotalTokens && actualTotalTokens > 0 ? actualTotalTokens : estimatedTotalTokens;
  const labelWidth = Math.max("Source".length, ...rows.map((row) => row.label.length));
  const tokenWidth = Math.max("Tokens".length, ...rows.map((row) => formatTokens(row.tokens).length));
  const percentWidth = "%".length;
  const separator = `├${"─".repeat(labelWidth + 2)}┼${"─".repeat(tokenWidth + 2)}┼${"─".repeat(percentWidth + 6)}┤`;
  const totalLabel = actualTotalTokens && actualTotalTokens > 0 ? `${formatTokens(actualTotalTokens)} tok actual · ~${formatTokens(estimatedTotalTokens)} estimated` : `~${formatTokens(estimatedTotalTokens)} tok estimated`;

  return [
    `${title}: ${totalLabel}`,
    `┌${"─".repeat(labelWidth + 2)}┬${"─".repeat(tokenWidth + 2)}┬${"─".repeat(percentWidth + 6)}┐`,
    `│ ${"Source".padEnd(labelWidth)} │ ${"Tokens".padStart(tokenWidth)} │ ${"%".padStart(percentWidth + 4)} │`,
    separator,
    ...rows.map((row) => {
      const percent = percentBase > 0 ? `${((row.tokens / percentBase) * 100).toFixed(1)}%` : "0.0%";
      return `│ ${row.label.padEnd(labelWidth)} │ ${formatTokens(row.tokens).padStart(tokenWidth)} │ ${percent.padStart(percentWidth + 4)} │`;
    }),
    `└${"─".repeat(labelWidth + 2)}┴${"─".repeat(tokenWidth + 2)}┴${"─".repeat(percentWidth + 6)}┘`,
  ];
}

function formatCost(cost: number): string {
  if (cost <= 0) return "$0.000";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 10) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

function emptyUsage(): DayUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, messages: 0 };
}

function getDayKey(timestamp: string): string | null {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function parseDaysArg(args: string): { mode: "range"; days: number } | { mode: "all" } | null {
  const trimmed = args.trim().toLowerCase();
  if (!trimmed) return { mode: "range", days: DEFAULT_DAYS };
  if (trimmed === "all") return { mode: "all" };

  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 3650) return null;
  return { mode: "range", days: n };
}

function parseStatsWebuiArgs(args: string): { statsArgs: string; open: boolean } {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  let open = false;

  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (normalized === "webui" || normalized === "--webui" || normalized === "--webui-open") {
      open = true;
      continue;
    }
    kept.push(token);
  }

  return { statsArgs: kept.join(" "), open };
}

function parseStatsPiArg(args: string): { detailed: boolean } | null {
  const tokens = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { detailed: false };
  if (tokens.length === 1 && ["detailed", "detail", "details", "--detailed"].includes(tokens[0] ?? "")) {
    return { detailed: true };
  }
  return null;
}

function listSessionFiles(sessionDir: string): string[] {
  try {
    return fs
      .readdirSync(sessionDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
      .map((e) => path.join(sessionDir, e.name));
  } catch {
    return [];
  }
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        const record = part as Record<string, unknown>;
        if (typeof record.text === "string") return record.text;
        if (typeof record.content === "string") return record.content;
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function formatSessionTitle(text: string, maxLength = 72): string | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function collectUsageRecords(sessionFiles: string[]): UsageRecord[] {
  const records: UsageRecord[] = [];

  for (const file of sessionFiles) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const sessionId = path.basename(file, ".jsonl");
    const entries: any[] = [];

    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;

      try {
        entries.push(JSON.parse(line));
      } catch {
        continue;
      }
    }

    const sessionName = entries
      .filter((entry) => entry?.type === "session_info" && typeof entry?.name === "string" && entry.name.trim())
      .at(-1)?.name.trim();
    const firstUserText = entries
      .find((entry) => entry?.type === "message" && entry?.message?.role === "user")
      ?.message?.content;
    const sessionTitle = formatSessionTitle(extractMessageText(firstUserText));

    for (const entry of entries) {
      if (entry?.type !== "message") continue;
      if (entry?.message?.role !== "assistant") continue;

      const usage = entry?.message?.usage;
      if (!usage || typeof usage !== "object") continue;

      const day = getDayKey(entry?.timestamp ?? "");
      if (!day) continue;

      const input = Number(usage.input ?? 0) || 0;
      const output = Number(usage.output ?? 0) || 0;
      const cacheRead = Number(usage.cacheRead ?? 0) || 0;
      const cacheWrite = Number(usage.cacheWrite ?? 0) || 0;
      const total = Number(usage.totalTokens ?? input + output + cacheRead + cacheWrite) || 0;
      const cost = Number(usage?.cost?.total ?? 0) || 0;
      const provider = String(entry?.message?.provider ?? "unknown");
      const model = String(entry?.message?.responseModel ?? entry?.message?.model ?? "unknown");

      records.push({
        day,
        input,
        output,
        cacheRead,
        cacheWrite,
        total,
        cost,
        model: `${provider}/${model}`,
        sessionFile: file,
        sessionId,
        sessionName,
        sessionTitle,
      });
    }
  }

  return records;
}

function aggregateUsageByDay(records: UsageRecord[]): Map<string, DayUsage> {
  const byDay = new Map<string, DayUsage>();
  for (const r of records) {
    const prev = byDay.get(r.day) ?? emptyUsage();
    prev.input += r.input;
    prev.output += r.output;
    prev.cacheRead += r.cacheRead;
    prev.cacheWrite += r.cacheWrite;
    prev.total += r.total;
    prev.cost += r.cost;
    prev.messages += 1;
    byDay.set(r.day, prev);
  }
  return byDay;
}

function buildDayRange(days: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(d.toISOString().slice(0, 10));
  }

  return keys;
}

function getScopeDayKeys(byDay: Map<string, DayUsage>, args: { mode: "range"; days: number } | { mode: "all" }): string[] {
  return args.mode === "all"
    ? Array.from(byDay.keys()).sort((a, b) => a.localeCompare(b))
    : buildDayRange(args.days);
}

function sumUsage(byDay: Map<string, DayUsage>, dayKeys: string[]): Totals {
  return dayKeys.reduce((acc, day) => {
    const usage = byDay.get(day) ?? emptyUsage();
    acc.input += usage.input;
    acc.output += usage.output;
    acc.cacheRead += usage.cacheRead;
    acc.cacheWrite += usage.cacheWrite;
    acc.total += usage.total;
    acc.cost += usage.cost;
    acc.messages += usage.messages;
    return acc;
  }, emptyUsage());
}

function scopedRecords(records: UsageRecord[], dayKeys: string[]): UsageRecord[] {
  const daySet = new Set(dayKeys);
  return records.filter((r) => daySet.has(r.day));
}

function aggregateModelUsage(records: UsageRecord[], dayKeys: string[], limit = 10): Array<{ model: string; tokens: number; percent: number; cost: number; costPercent: number; avgCostPerMillion: number; avgOutputTokens: number; messages: number }> {
  const scoped = scopedRecords(records, dayKeys);
  const modelTotals = new Map<string, { tokens: number; output: number; cost: number; messages: number }>();
  const totalTokens = scoped.reduce((acc, r) => acc + r.total, 0);
  const totalCost = scoped.reduce((acc, r) => acc + r.cost, 0);

  for (const r of scoped) {
    const prev = modelTotals.get(r.model) ?? { tokens: 0, output: 0, cost: 0, messages: 0 };
    prev.tokens += r.total;
    prev.output += r.output;
    prev.cost += r.cost;
    prev.messages += 1;
    modelTotals.set(r.model, prev);
  }

  if (totalTokens <= 0) return [];

  return Array.from(modelTotals.entries())
    .map(([model, v]) => ({
      model,
      tokens: v.tokens,
      percent: (v.tokens / totalTokens) * 100,
      cost: v.cost,
      costPercent: totalCost > 0 ? (v.cost / totalCost) * 100 : 0,
      avgCostPerMillion: v.tokens > 0 ? (v.cost / v.tokens) * 1_000_000 : 0,
      avgOutputTokens: v.messages > 0 ? v.output / v.messages : 0,
      messages: v.messages,
    }))
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
    .slice(0, limit);
}

function aggregateExpensiveSessions(records: UsageRecord[], dayKeys: string[], limit = 10): Array<{ day: string; model: string; tokens: number; cost: number; sessionId: string; sessionName?: string; sessionTitle?: string; displayName: string }> {
  const sessions = new Map<string, { day: string; modelTokens: Map<string, number>; tokens: number; cost: number; sessionId: string; sessionName?: string; sessionTitle?: string }>();

  for (const r of scopedRecords(records, dayKeys)) {
    const prev = sessions.get(r.sessionFile) ?? { day: r.day, modelTokens: new Map(), tokens: 0, cost: 0, sessionId: r.sessionId, sessionName: r.sessionName, sessionTitle: r.sessionTitle };
    if (r.day < prev.day) prev.day = r.day;
    prev.tokens += r.total;
    prev.cost += r.cost;
    if (!prev.sessionName && r.sessionName) prev.sessionName = r.sessionName;
    if (!prev.sessionTitle && r.sessionTitle) prev.sessionTitle = r.sessionTitle;
    prev.modelTokens.set(r.model, (prev.modelTokens.get(r.model) ?? 0) + r.total);
    sessions.set(r.sessionFile, prev);
  }

  return Array.from(sessions.values())
    .map((s) => ({
      day: s.day,
      model: Array.from(s.modelTokens.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown",
      tokens: s.tokens,
      cost: s.cost,
      sessionId: s.sessionId,
      sessionName: s.sessionName,
      sessionTitle: s.sessionTitle,
      displayName: s.sessionName ? `"${s.sessionName}"` : s.sessionTitle ? `"${s.sessionTitle}"` : s.sessionId,
    }))
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
    .slice(0, limit);
}

function buildGraphLines(byDay: Map<string, DayUsage>, dayKeys: string[], omitZeroDays = false): string[] {
  if (dayKeys.length === 0) {
    return ["No usage data found yet."];
  }

  const data = dayKeys
    .map((day) => ({ day, usage: byDay.get(day) ?? emptyUsage() }))
    .filter((d) => !omitZeroDays || d.usage.total > 0 || d.usage.cost > 0);
  const maxTotal = Math.max(...data.map((d) => d.usage.total), 0);
  const maxCost = Math.max(...data.map((d) => d.usage.cost), 0);
  const lines: string[] = [];

  if (data.length === 0) {
    return ["No non-zero usage data found in selected range."];
  }

  for (const { day, usage } of data) {
    const tokenBarLen = usage.total <= 0 || maxTotal <= 0 ? 0 : Math.max(1, Math.round((usage.total / maxTotal) * MAX_BAR_WIDTH));
    const costBarLen = usage.cost <= 0 || maxCost <= 0 ? 0 : Math.max(1, Math.round((usage.cost / maxCost) * COST_BAR_WIDTH));
    const tokenBar = "█".repeat(tokenBarLen).padEnd(MAX_BAR_WIDTH, "·");
    const costBar = "$".repeat(costBarLen).padEnd(COST_BAR_WIDTH, "·");

    lines.push(
      `${day} ${tokenBar} ${formatTokens(usage.total)} tok ${costBar} ${formatCost(usage.cost)} (↑${formatTokens(usage.input)} ↓${formatTokens(usage.output)} R${formatTokens(usage.cacheRead)} W${formatTokens(usage.cacheWrite)})`,
    );
  }

  const totals = sumUsage(byDay, dayKeys);
  lines.push(
    "",
    `Σ ${formatTokens(totals.total)} tok (↑${formatTokens(totals.input)} ↓${formatTokens(totals.output)} R${formatTokens(totals.cacheRead)} W${formatTokens(totals.cacheWrite)}) · ${formatCost(totals.cost)}`,
  );

  return lines;
}

function buildCostTrendLines(byDay: Map<string, DayUsage>, dayKeys: string[]): string[] {
  const totals = sumUsage(byDay, dayKeys);
  const activeKeys = dayKeys.filter((d) => (byDay.get(d)?.cost ?? 0) > 0 || (byDay.get(d)?.total ?? 0) > 0);
  const calendarAvg = totals.cost / Math.max(dayKeys.length, 1);
  const activeAvg = totals.cost / Math.max(activeKeys.length, 1);
  const projectedMonthly = calendarAvg * 30;
  const highest = dayKeys
    .map((day) => ({ day, cost: byDay.get(day)?.cost ?? 0, tokens: byDay.get(day)?.total ?? 0 }))
    .sort((a, b) => b.cost - a.cost)[0];
  const lastActive = activeKeys.at(-1);
  const lastActiveCost = lastActive ? (byDay.get(lastActive)?.cost ?? 0) : 0;

  return [
    `Cost trend: avg/day ${formatCost(calendarAvg)} · active-day avg ${formatCost(activeAvg)} · projected 30d ${formatCost(projectedMonthly)} · highest ${highest && highest.cost > 0 ? `${highest.day} ${formatCost(highest.cost)} (${formatTokens(highest.tokens)} tok)` : "n/a"} · active days ${activeKeys.length}/${dayKeys.length}`,
    `Latest active day: ${lastActive ? `${lastActive} ${formatCost(lastActiveCost)} · ${formatTokens(byDay.get(lastActive)?.total ?? 0)} tok` : "n/a"}`,
  ];
}

function buildCacheEfficiencyLines(totals: Totals): string[] {
  const hitRate = totals.total > 0 ? (totals.cacheRead / totals.total) * 100 : 0;
  const nonCacheTokens = totals.input + totals.output + totals.cacheWrite;
  const inputShare = totals.total > 0 ? (totals.input / totals.total) * 100 : 0;
  const outputShare = totals.total > 0 ? (totals.output / totals.total) * 100 : 0;
  const avgCostPerNonCacheToken = nonCacheTokens > 0 && totals.cost > 0 ? totals.cost / nonCacheTokens : 0;
  const estimatedSavings = totals.cacheRead * avgCostPerNonCacheToken;
  const savingsPart = estimatedSavings > 0 ? ` · est. cache savings ${formatCost(estimatedSavings)}` : "";

  return [
    `Cache hit: ${hitRate.toFixed(1)}% · reads ${formatTokens(totals.cacheRead)} · writes ${formatTokens(totals.cacheWrite)}${savingsPart}`,
    `Token mix: input ${formatTokens(totals.input)} (${inputShare.toFixed(1)}%) · output ${formatTokens(totals.output)} (${outputShare.toFixed(1)}%) · non-cache ${formatTokens(nonCacheTokens)} · total ${formatTokens(totals.total)}`,
  ];
}

export default function statsExtension(pi: ExtensionAPI) {
  let latestSystemPromptOptions: BuildSystemPromptOptions | null = null;
  let pendingInitialPromptMeasurement: PendingInitialPromptMeasurement | null = null;

  const getToolEstimateInputs = (): { activeTools: string[]; allTools: InitialPromptToolInfo[] } => {
    let activeTools: string[] = [];
    let allTools: InitialPromptToolInfo[] = [];

    try {
      activeTools = pi.getActiveTools();
    } catch {
      activeTools = [];
    }

    try {
      allTools = pi.getAllTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
    } catch {
      allTools = [];
    }

    return { activeTools, allTools };
  };

  const getPromptCalibration = (ctx: ExtensionCommandContext): InitialPromptCalibration | null => {
    return collectInitialPromptCalibration(ctx.sessionManager.getSessionDir());
  };

  const estimateInitialPromptForContext = (systemPrompt: string, calibration?: InitialPromptCalibration | null): InitialPromptInputEstimate => {
    const { activeTools, allTools } = getToolEstimateInputs();
    return estimateInitialPromptInput({ systemPrompt, activeTools, allTools, calibration });
  };

  const branchHasAssistantUsage = (ctx: { sessionManager: { getBranch(): unknown[] } }): boolean => {
    try {
      return ctx.sessionManager.getBranch().some((entry) => {
        const record = (entry && typeof entry === "object" ? entry : {}) as Record<string, any>;
        return record.type === "message" && record.message?.role === "assistant" && !!record.message?.usage;
      });
    } catch {
      return true;
    }
  };

  const calibrateFromCurrentBranch = (ctx: ExtensionCommandContext): { ok: true; record: NonNullable<ReturnType<typeof buildInitialPromptCalibrationRecord>> } | { ok: false; reason: string } => {
    let firstUserTokens: number | null = null;
    let firstAssistantWithUsage: Record<string, any> | null = null;

    for (const entry of ctx.sessionManager.getBranch()) {
      const record = (entry && typeof entry === "object" ? entry : {}) as Record<string, any>;
      if (record.type !== "message") continue;

      const message = (record.message && typeof record.message === "object" ? record.message : {}) as Record<string, any>;
      if (message.role === "user" && firstUserTokens === null) {
        firstUserTokens = estimatePromptInjectionTokens(stringifyContextValue(message.content)) + FIRST_USER_MESSAGE_FRAMING_TOKENS;
      }
      if (message.role === "assistant" && message.usage) {
        firstAssistantWithUsage = message;
        break;
      }
    }

    if (firstUserTokens === null) return { ok: false, reason: "No initial user message found in the current branch." };
    if (!firstAssistantWithUsage) return { ok: false, reason: "No assistant response with usage data found yet. Run /calibrate after the first assistant response finishes." };

    const usage = firstAssistantWithUsage.usage as Record<string, unknown>;
    const actualInitialInputTokens =
      (Number(usage.input ?? 0) || 0) + (Number(usage.cacheRead ?? 0) || 0) + (Number(usage.cacheWrite ?? 0) || 0);
    if (actualInitialInputTokens <= 0) return { ok: false, reason: "The first assistant response has no input/cache token usage to calibrate from." };

    const estimate = estimateInitialPromptForContext(ctx.getSystemPrompt(), null);
    const record = buildInitialPromptCalibrationRecord({
      estimate,
      actualInitialInputTokens,
      firstUserTokens,
      provider: String(firstAssistantWithUsage.provider ?? ctx.model?.provider ?? "unknown"),
      model: String(firstAssistantWithUsage.responseModel ?? firstAssistantWithUsage.model ?? ctx.model?.id ?? "unknown"),
    });
    if (!record) return { ok: false, reason: "Calibration sample was outside the accepted sanity range (0.25×–4×)." };
    return { ok: true, record };
  };

  pi.on("session_start", async () => {
    pendingInitialPromptMeasurement = null;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    latestSystemPromptOptions = event.systemPromptOptions;

    if (!branchHasAssistantUsage(ctx)) {
      pendingInitialPromptMeasurement = {
        estimate: estimateInitialPromptForContext(event.systemPrompt, null),
        firstUserTokens: estimatePromptInjectionTokens(event.prompt) + FIRST_USER_MESSAGE_FRAMING_TOKENS,
        skipReason: event.images && event.images.length > 0 ? "image prompt" : undefined,
      };
    }
  });

  pi.on("agent_start", async (_event, ctx) => {
    if (!pendingInitialPromptMeasurement || pendingInitialPromptMeasurement.skipReason) return;
    pendingInitialPromptMeasurement.estimate = estimateInitialPromptForContext(ctx.getSystemPrompt(), null);
  });

  pi.on("message_end", async (event) => {
    if (!pendingInitialPromptMeasurement) return;
    const pending = pendingInitialPromptMeasurement;
    const message = (event.message && typeof event.message === "object" ? event.message : {}) as Record<string, any>;
    if (message.role !== "assistant" || !message.usage) return;
    pendingInitialPromptMeasurement = null;
    if (pending.skipReason) return;

    const usage = message.usage as Record<string, unknown>;
    const actualInitialInputTokens =
      (Number(usage.input ?? 0) || 0) + (Number(usage.cacheRead ?? 0) || 0) + (Number(usage.cacheWrite ?? 0) || 0);
    const record = buildInitialPromptCalibrationRecord({
      estimate: pending.estimate,
      actualInitialInputTokens,
      firstUserTokens: pending.firstUserTokens,
      provider: String(message.provider ?? "unknown"),
      model: String(message.responseModel ?? message.model ?? "unknown"),
    });
    if (record) appendInitialPromptCalibrationRecord(pi.appendEntry, record);
  });

  const showCurrentContextTokens = (ctx: ExtensionCommandContext) => {
    const usage = ctx.getContextUsage();
    const contextSources = buildCurrentContextTokenSources(ctx.getSystemPrompt(), latestSystemPromptOptions, ctx);
    const contextWindow = usage?.contextWindow ? ` / ${formatTokens(usage.contextWindow)} window` : "";
    const percent = usage?.percent !== null && usage?.percent !== undefined ? ` (${usage.percent.toFixed(1)}%)` : "";
    ctx.ui.notify(`${formatTokenBreakdownTable("Current context", contextSources, usage?.tokens).join("\n")}\nContext usage: ${usage?.tokens ? formatTokens(usage.tokens) : "?"}${contextWindow}${percent}`, "info");
  };

  pi.registerCommand("stats-tokens", {
    description: "Show current context token breakdown by source/type.",
    handler: async (_args, ctx) => {
      showCurrentContextTokens(ctx);
    },
  });

  const loadStatsData = (ctx: ExtensionCommandContext, parsedArgs: { mode: "range"; days: number } | { mode: "all" }) => {
    const sessionDir = ctx.sessionManager.getSessionDir();
    const files = listSessionFiles(sessionDir);
    const records = collectUsageRecords(files);
    const byDay = aggregateUsageByDay(records);
    const dayKeys = getScopeDayKeys(byDay, parsedArgs);
    const totals = sumUsage(byDay, dayKeys);
    const calibration = collectInitialPromptCalibration(sessionDir);
    const scopeLabel = parsedArgs.mode === "all" ? "all days" : `last ${parsedArgs.days} days`;
    return { files, records, byDay, dayKeys, totals, calibration, scopeLabel, scope: parsedArgs };
  };

  const parseStatsCommandArgs = (args: string, ctx: ExtensionCommandContext) => {
    const parsedArgs = parseDaysArg(args);
    if (!parsedArgs) {
      ctx.ui.notify("Usage: command [days|all]   e.g. /stats-last, /stats-last 30, /stats-last all", "warning");
      return null;
    }
    const data = loadStatsData(ctx, parsedArgs);
    if (data.files.length === 0) {
      ctx.ui.notify("No sessions found for this workspace yet.", "info");
      return null;
    }
    return data;
  };

  const formatModelComparisonLines = (records: UsageRecord[], dayKeys: string[], totals: Totals) => {
    const topModels = aggregateModelUsage(records, dayKeys, 20);
    return topModels.length === 0
      ? ["Model comparison: no model usage in selected range"]
      : [
          "Model comparison:",
          ...topModels.map((m, i) => {
            const costPart = totals.cost > 0 ? ` · ${m.costPercent.toFixed(1)}% spend` : "";
            return `${i + 1}. ${m.model} — ${m.percent.toFixed(1)}% tokens (${formatTokens(m.tokens)}) · ${formatCost(m.cost)}${costPart} · ${formatCost(m.avgCostPerMillion)}/1M tok · avg ↓${formatTokens(Math.round(m.avgOutputTokens))}/msg · ${m.messages} msgs`;
          }),
        ];
  };

  const formatExpensiveSessionLines = (records: UsageRecord[], dayKeys: string[]) => {
    const topSessions = aggregateExpensiveSessions(records, dayKeys, 20);
    return topSessions.length === 0
      ? ["Most expensive sessions: none in selected range"]
      : [
          "Most expensive sessions:",
          ...topSessions.map((s, i) => `${i + 1}. ${s.day} ${s.displayName} — ${formatCost(s.cost)} · ${formatTokens(s.tokens)} tok · ${s.model}`),
        ];
  };

  const buildWebuiStatsPayload = async (data: ReturnType<typeof loadStatsData>, ctx: ExtensionCommandContext, options: { open?: boolean } = {}) => {
    const promptSnapshot = await estimateStableInitialPromptFromPiContext(pi, ctx, getPromptCalibration);
    const systemPrompt = promptSnapshot.systemPrompt;
    const promptEstimate = promptSnapshot.estimate;
    const daily = data.dayKeys.map((day) => ({ day, ...(data.byDay.get(day) ?? emptyUsage()) }));
    const activeDays = daily.filter((day) => day.total > 0 || day.cost > 0);
    const highestDay = daily
      .filter((day) => day.total > 0 || day.cost > 0)
      .sort((a, b) => b.cost - a.cost || b.total - a.total)[0] ?? null;
    const cacheHitRate = data.totals.total > 0 ? (data.totals.cacheRead / data.totals.total) * 100 : 0;
    const nonCacheTokens = data.totals.input + data.totals.output + data.totals.cacheWrite;
    const calendarAvgCost = data.totals.cost / Math.max(data.dayKeys.length, 1);
    const activeAvgCost = data.totals.cost / Math.max(activeDays.length, 1);
    const contextUsage = ctx.getContextUsage();
    const contextSources = buildCurrentContextTokenSources(systemPrompt, latestSystemPromptOptions, ctx);
    const contextWindow = contextUsage?.contextWindow ? ` / ${formatTokens(contextUsage.contextWindow)} window` : "";
    const contextPercent = contextUsage?.percent !== null && contextUsage?.percent !== undefined ? ` (${contextUsage.percent.toFixed(1)}%)` : "";
    const contextUsageLine = `Context usage: ${contextUsage?.tokens ? formatTokens(contextUsage.tokens) : "?"}${contextWindow}${contextPercent}`;

    return {
      type: WEBUI_STATS_PAYLOAD_TYPE,
      version: WEBUI_STATS_PAYLOAD_VERSION,
      generatedAt: Date.now(),
      open: Boolean(options.open),
      scopeLabel: data.scopeLabel,
      scope: data.scope,
      sessionCount: data.files.length,
      dayCount: data.dayKeys.length,
      activeDayCount: activeDays.length,
      totals: data.totals,
      promptEstimate: {
        total: promptEstimate.total,
        low: promptEstimate.low,
        high: promptEstimate.high,
        confidence: promptEstimate.confidence,
        calibrationMultiplier: promptEstimate.calibrationMultiplier,
        calibrationSamples: promptEstimate.calibrationSamples,
        source: promptSnapshot.source,
        settled: promptSnapshot.settled,
        attempts: promptSnapshot.attempts,
        warning: promptSnapshot.warning,
        systemPromptChars: promptSnapshot.systemPrompt.length,
        activeToolSchemas: promptSnapshot.tools.length,
      },
      summary: {
        cacheHitRate,
        nonCacheTokens,
        calendarAvgCost,
        activeAvgCost,
        projected30DayCost: calendarAvgCost * 30,
        highestDay,
      },
      daily,
      models: aggregateModelUsage(data.records, data.dayKeys, 20),
      expensiveSessions: aggregateExpensiveSessions(data.records, data.dayKeys, 20),
      lines: {
        graph: buildGraphLines(data.byDay, data.dayKeys, true),
        promptInjection: formatPromptInjectionLines(systemPrompt, latestSystemPromptOptions, promptEstimate, {
          source: promptSnapshot.source === "export-html" ? "temporary Pi /export HTML session data" : "live context fallback",
          warning: promptSnapshot.warning,
        }),
        promptDetailed: formatInitialPromptDetailedLines(promptSnapshot, latestSystemPromptOptions),
        costTrend: buildCostTrendLines(data.byDay, data.dayKeys),
        cache: buildCacheEfficiencyLines(data.totals),
        modelComparison: formatModelComparisonLines(data.records, data.dayKeys, data.totals),
        expensiveSessions: formatExpensiveSessionLines(data.records, data.dayKeys),
        tokenBreakdown: [...formatTokenBreakdownTable("Current context", contextSources, contextUsage?.tokens), contextUsageLine],
      },
    };
  };

  const publishWebuiStatsPayload = async (ctx: ExtensionCommandContext, args: string, options: { open?: boolean } = {}) => {
    const parsedArgs = parseDaysArg(args);
    if (!parsedArgs) {
      ctx.ui.notify("Usage: /stats-webui [days|all]", "warning");
      return false;
    }

    const data = loadStatsData(ctx, parsedArgs);
    const payload = await buildWebuiStatsPayload(data, ctx, options);
    ctx.ui.setStatus(WEBUI_STATS_STATUS_KEY, JSON.stringify(payload));
    // Keep this WebUI transport status out of terminal footers after the browser receives it.
    ctx.ui.setStatus(WEBUI_STATS_STATUS_KEY, undefined);
    return true;
  };

  const registerScopedStatsCommand = (name: string, description: string, render: (data: ReturnType<typeof loadStatsData>, ctx: ExtensionCommandContext) => string[]) => {
    pi.registerCommand(name, {
      description,
      handler: async (args, ctx) => {
        const data = parseStatsCommandArgs(args, ctx);
        if (!data) return;
        ctx.ui.notify(render(data, ctx).join("\n"), "info");
      },
    });
  };

  registerScopedStatsCommand("stats-most-expense", "Show most expensive sessions. Usage: /stats-most-expense [days|all]", (data) =>
    formatExpensiveSessionLines(data.records, data.dayKeys),
  );

  registerScopedStatsCommand("stats-model-compare", "Show model token/cost comparison. Usage: /stats-model-compare [days|all]", (data) =>
    formatModelComparisonLines(data.records, data.dayKeys, data.totals),
  );

  registerScopedStatsCommand("stats-cost-trend", "Show cost trend and projections. Usage: /stats-cost-trend [days|all]", (data) =>
    buildCostTrendLines(data.byDay, data.dayKeys),
  );

  registerScopedStatsCommand("stats-cache", "Show cache efficiency and token mix. Usage: /stats-cache [days|all]", (data) =>
    buildCacheEfficiencyLines(data.totals),
  );

  registerScopedStatsCommand("stats-last", "Show non-zero daily usage graph. Usage: /stats-last [days|all]", (data, ctx) => {
    const promptEstimate = estimateInitialPromptForContext(ctx.getSystemPrompt(), data.calibration);
    return [`📊 Token stats (${data.scopeLabel}, ${data.files.length} sessions) · PI: ~${formatTokens(promptEstimate.total)} tok`, "", ...buildGraphLines(data.byDay, data.dayKeys, true)];
  });

  pi.registerCommand("stats-pi", {
    description: "Show export-backed estimated initial prompt input token breakdown. Usage: /stats-pi [detailed]",
    handler: async (args, ctx) => {
      const parsed = parseStatsPiArg(args);
      if (!parsed) {
        ctx.ui.notify("Usage: /stats-pi [detailed]", "warning");
        return;
      }

      const promptEstimate = await estimateStableInitialPromptFromPiContext(pi, ctx, getPromptCalibration);
      const lines = formatPromptInjectionLines(promptEstimate.systemPrompt, latestSystemPromptOptions, promptEstimate.estimate, {
        source: promptEstimate.source === "export-html" ? "temporary Pi /export HTML session data" : "live context fallback",
        warning: promptEstimate.warning,
      });
      if (parsed.detailed) {
        lines.push("", ...formatInitialPromptDetailedLines(promptEstimate, latestSystemPromptOptions));
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("calibrate", {
    description: "Start an isolated calibration turn to calibrate PI initial prompt token estimates.",
    handler: async (args, ctx) => {
      const mode = args.trim().toLowerCase();
      if (mode === "current" || mode === "here") {
        const result = calibrateFromCurrentBranch(ctx);
        if (!result.ok) {
          ctx.ui.notify(`Calibration failed: ${result.reason}`, "warning");
          return;
        }

        appendInitialPromptCalibrationRecord(pi.appendEntry, result.record);
        const calibration = getPromptCalibration(ctx);
        const estimate = estimateInitialPromptForContext(ctx.getSystemPrompt(), calibration);
        ctx.ui.notify(
          `Calibrated PI estimate: ~${formatTokens(estimate.total)} tok (scale ×${estimate.calibrationMultiplier.toFixed(2)}, ${estimate.calibrationSamples} samples). Run /stats-pi for details.`,
          "info",
        );
        return;
      }

      if (!ctx.isIdle()) {
        ctx.ui.notify("Calibration needs an idle agent so it can start a clean probe turn.", "warning");
        return;
      }

      ctx.ui.notify("Starting isolated calibration session…", "info");
      await ctx.newSession({
        withSession: async (newCtx) => {
          await newCtx.sendUserMessage(CALIBRATION_PROMPT);
        },
      });
    },
  });

  pi.registerCommand("stats-webui", {
    description: "Publish structured stats data for the Pi Web UI overlay. Usage: /stats-webui [days|all]",
    handler: async (args, ctx) => {
      await publishWebuiStatsPayload(ctx, args, { open: true });
    },
  });

  pi.registerCommand("stats", {
    description: "Show token usage dashboard. Usage: /stats, /stats 30, /stats all. Details: /stats-tokens, /stats-pi [detailed], /stats-last, /stats-most-expense, /stats-model-compare, /stats-cost-trend, /stats-cache",
    handler: async (args, ctx) => {
      const webuiArgs = parseStatsWebuiArgs(args);
      const trimmedArgs = webuiArgs.statsArgs.trim().toLowerCase();
      if (trimmedArgs === "tokens") {
        showCurrentContextTokens(ctx);
        return;
      }

      if (webuiArgs.open) {
        await publishWebuiStatsPayload(ctx, webuiArgs.statsArgs, { open: true });
        return;
      }

      const data = parseStatsCommandArgs(webuiArgs.statsArgs, ctx);
      if (!data) return;

      const systemPrompt = ctx.getSystemPrompt();
      const promptEstimate = estimateInitialPromptForContext(systemPrompt, data.calibration);
      const graphLines = buildGraphLines(data.byDay, data.dayKeys, true);
      const promptInjectionLines = formatPromptInjectionLines(systemPrompt, latestSystemPromptOptions, promptEstimate);
      const modelLines = formatModelComparisonLines(data.records, data.dayKeys, data.totals).slice(0, 7);
      const sessionLines = formatExpensiveSessionLines(data.records, data.dayKeys).slice(0, 7);
      const commandLines = [
        "Detailed commands:",
        "/stats-last · /stats-most-expense · /stats-model-compare · /stats-pi detailed · /stats-cost-trend · /stats-cache · /stats-tokens",
      ];

      ctx.ui.notify(
        `📊 Token stats (${data.scopeLabel}, ${data.files.length} sessions) · PI: ~${formatTokens(promptEstimate.total)} tok\n\n${graphLines.join("\n")}\n\n${promptInjectionLines.join("\n")}\n\n${buildCostTrendLines(data.byDay, data.dayKeys).join("\n")}\n${buildCacheEfficiencyLines(data.totals).join("\n")}\n\n${modelLines.join("\n")}\n\n${sessionLines.join("\n")}\n\n${commandLines.join("\n")}`,
        "info",
      );
    },
  });
}
