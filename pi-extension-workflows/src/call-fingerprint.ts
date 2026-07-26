import { canonicalJson, sha256 } from "./persistence-schema.ts";
import type { WorkflowAgentOptions } from "./script-runtime.ts";

export type WorkflowCallFingerprintInput = {
  phasePath: string[];
  label?: string;
  prompt: string;
  options: WorkflowAgentOptions | Record<string, unknown>;
  pipelineKey?: string;
};

export function normalizeWorkflowAgentOptions(options: WorkflowAgentOptions | Record<string, unknown>): Record<string, unknown> {
  const value = options as Record<string, unknown>;
  return {
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(Array.isArray(value.tools) ? { tools: [...value.tools].map(String).sort() } : {}),
    ...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}),
    ...(value.schema !== undefined ? { schema: value.schema } : {}),
    ...(typeof value.timeoutMs === "number" ? { timeoutMs: value.timeoutMs } : {}),
    ...(typeof value.maxTokens === "number" ? { maxTokens: value.maxTokens } : {}),
    ...(typeof value.maxTurns === "number" ? { maxTurns: value.maxTurns } : {}),
  };
}

export function workflowCallFingerprint(input: WorkflowCallFingerprintInput): string {
  return sha256(canonicalJson({
    phasePath: [...input.phasePath],
    label: input.label ?? null,
    prompt: input.prompt,
    options: normalizeWorkflowAgentOptions(input.options),
    pipelineKey: input.pipelineKey ?? null,
  }));
}
