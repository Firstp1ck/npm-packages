import { WorkflowValidationError } from "./errors.ts";
import { parseWorkflowScript } from "./script-parser.ts";

export type ClaudeWorkflowImportReport = {
  supported: boolean;
  source?: string;
  warnings: string[];
  unsupported: string[];
};

export function formatWorkflowScript(source: string, sourcePath = "workflow.js"): string {
  parseWorkflowScript(source, { sourcePath });
  const formatted = `${source.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n").trim()}\n`;
  parseWorkflowScript(formatted, { sourcePath });
  return formatted;
}

export function importClaudeWorkflowScript(rawSource: string, sourcePath = "claude-workflow.js"): ClaudeWorkflowImportReport {
  const warnings: string[] = [];
  let source = rawSource.trim();
  const fence = source.match(/^```(?:javascript|js)?\s*([\s\S]*?)\s*```$/i);
  if (fence) {
    source = fence[1];
    warnings.push("Removed an outer Markdown code fence; workflow semantics were not rewritten.");
  }
  const unsupported: string[] = [];
  if (/\bimport\s*(?:\(|[\s{*])/.test(source)) unsupported.push("imports are unsupported");
  if (/\bexport\s+default\b/.test(source)) unsupported.push("export default is unsupported; use static export const meta");
  if (/\b(?:process|require|Bun|Deno)\b/.test(source)) unsupported.push("host runtime globals are unsupported");
  if (unsupported.length) return { supported: false, warnings, unsupported };
  try {
    const formatted = formatWorkflowScript(source, sourcePath);
    return { supported: true, source: formatted, warnings, unsupported: [] };
  } catch (error) {
    const details = error instanceof WorkflowValidationError ? error.issues : [(error as Error).message];
    return { supported: false, warnings, unsupported: details };
  }
}
