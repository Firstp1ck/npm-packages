import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { InitialPromptCalibration, InitialPromptInputEstimate, InitialPromptToolInfo } from "./tokens.ts";
import { estimateInitialPromptInput } from "./tokens.ts";

export type ExportBackedInitialPromptEstimate = {
  estimate: InitialPromptInputEstimate;
  systemPrompt: string;
  /** Active tool schemas used for the estimate, preferably decoded from the temporary export HTML. */
  tools: InitialPromptToolInfo[];
  source: "export-html" | "direct";
  warning?: string;
};

type ExportSessionData = {
  systemPrompt?: unknown;
  tools?: unknown;
};

type ExportSessionToHtml = (
  sm: ExtensionContext["sessionManager"],
  state?: { systemPrompt?: string; tools?: InitialPromptToolInfo[] },
  options?: { outputPath?: string; themeName?: string } | string,
) => Promise<string>;

type PromptEstimatePiApi = Pick<ExtensionAPI, "getActiveTools" | "getAllTools">;
type PromptEstimateContext = Pick<ExtensionContext, "getSystemPrompt" | "sessionManager">;

let exportSessionToHtmlPromise: Promise<ExportSessionToHtml | null> | null = null;

function resolvePiExportHtmlModuleUrl(): string | null {
  try {
    const basePath = typeof __filename === "string" && path.isAbsolute(__filename) ? __filename : path.join(process.cwd(), "package.json");
    const requireFromHere = createRequire(basePath);
    const candidateDirs = requireFromHere.resolve.paths("@earendil-works/pi-coding-agent") ?? [];
    for (const dir of candidateDirs) {
      const candidate = path.join(dir, "@earendil-works", "pi-coding-agent", "dist", "core", "export-html", "index.js");
      if (fs.existsSync(candidate)) return pathToFileURL(candidate).href;
    }
    return null;
  } catch {
    return null;
  }
}

function loadPiExportSessionToHtml(): Promise<ExportSessionToHtml | null> {
  exportSessionToHtmlPromise ??= (async () => {
    try {
      const exportModuleUrl = resolvePiExportHtmlModuleUrl();
      if (!exportModuleUrl) return null;
      const mod = (await import(exportModuleUrl)) as { exportSessionToHtml?: unknown };
      return typeof mod.exportSessionToHtml === "function" ? (mod.exportSessionToHtml as ExportSessionToHtml) : null;
    } catch {
      return null;
    }
  })();
  return exportSessionToHtmlPromise;
}

function makeTempExportPath(sessionId: string | undefined): string {
  const safeSessionId = (sessionId || "session").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return path.join(os.tmpdir(), `pi-prompt-estimate-export-${safeSessionId}-${nonce}.html`);
}

function decodeSessionDataFromExportHtml(html: string): ExportSessionData | null {
  const match = html.match(/<script[^>]*id=["']session-data["'][^>]*>([^<]*)<\/script>/i);
  const encoded = match?.[1]?.trim();
  if (!encoded) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as ExportSessionData) : null;
  } catch {
    return null;
  }
}

function normalizeExportedTools(tools: unknown): InitialPromptToolInfo[] {
  if (!Array.isArray(tools)) return [];

  const seen = new Set<string>();
  const normalized: InitialPromptToolInfo[] = [];
  for (const tool of tools) {
    const record = (tool && typeof tool === "object" ? tool : {}) as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    normalized.push({
      name,
      description: typeof record.description === "string" ? record.description : undefined,
      parameters: record.parameters,
    });
  }
  return normalized;
}

export function getActiveInitialPromptToolInfos(pi: PromptEstimatePiApi): InitialPromptToolInfo[] {
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

  if (allTools.length === 0) return [];

  const toolsByName = new Map<string, InitialPromptToolInfo>();
  for (const tool of allTools) {
    if (tool.name && !toolsByName.has(tool.name)) toolsByName.set(tool.name, tool);
  }

  const orderedNames = activeTools.length > 0 ? activeTools : Array.from(toolsByName.keys()).sort();
  return orderedNames.map((name) => toolsByName.get(name)).filter((tool): tool is InitialPromptToolInfo => !!tool);
}

export function estimateInitialPromptForPiContext(
  pi: PromptEstimatePiApi,
  systemPrompt: string,
  calibration?: InitialPromptCalibration | null,
  exportedTools?: InitialPromptToolInfo[],
): InitialPromptInputEstimate {
  const tools = exportedTools ?? getActiveInitialPromptToolInfos(pi);
  return estimateInitialPromptInput({
    systemPrompt,
    activeTools: tools.map((tool) => tool.name),
    allTools: tools,
    calibration,
  });
}

export async function estimateInitialPromptFromPiExport(
  pi: PromptEstimatePiApi,
  ctx: PromptEstimateContext,
  calibration?: InitialPromptCalibration | null,
): Promise<ExportBackedInitialPromptEstimate> {
  const fallbackSystemPrompt = ctx.getSystemPrompt();
  const fallbackTools = getActiveInitialPromptToolInfos(pi);
  const exportSessionToHtml = await loadPiExportSessionToHtml();
  if (!exportSessionToHtml) {
    return {
      estimate: estimateInitialPromptForPiContext(pi, fallbackSystemPrompt, calibration, fallbackTools),
      systemPrompt: fallbackSystemPrompt,
      tools: fallbackTools,
      source: "direct",
      warning: "Pi HTML export API unavailable; used live context fallback.",
    };
  }

  const outputPath = makeTempExportPath(ctx.sessionManager.getSessionId());
  let writtenPath = outputPath;
  try {
    writtenPath = await exportSessionToHtml(
      ctx.sessionManager,
      { systemPrompt: fallbackSystemPrompt, tools: fallbackTools },
      { outputPath },
    );
    const html = fs.readFileSync(writtenPath, "utf8");
    const sessionData = decodeSessionDataFromExportHtml(html);
    const exportedSystemPrompt = typeof sessionData?.systemPrompt === "string" ? sessionData.systemPrompt : fallbackSystemPrompt;
    const exportedTools = normalizeExportedTools(sessionData?.tools);
    const tools = exportedTools.length > 0 ? exportedTools : fallbackTools;
    const estimate = estimateInitialPromptForPiContext(pi, exportedSystemPrompt, calibration, tools);
    return { estimate, systemPrompt: exportedSystemPrompt, tools, source: "export-html" };
  } catch (error) {
    return {
      estimate: estimateInitialPromptForPiContext(pi, fallbackSystemPrompt, calibration, fallbackTools),
      systemPrompt: fallbackSystemPrompt,
      tools: fallbackTools,
      source: "direct",
      warning: `Pi HTML export failed; used live context fallback (${error instanceof Error ? error.message : String(error)}).`,
    };
  } finally {
    for (const filePath of new Set([outputPath, writtenPath])) {
      try {
        fs.rmSync(filePath, { force: true });
      } catch {
        // Best-effort cleanup only.
      }
    }
  }
}
