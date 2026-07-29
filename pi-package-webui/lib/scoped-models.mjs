import { resolveModelScopeWithDiagnostics } from "@earendil-works/pi-coding-agent";

/**
 * Resolve WebUI scoped-model patterns with Pi's canonical matching semantics.
 * The RPC model list is already Pi's authenticated/available model catalog.
 */
export async function resolveScopedModelsFromPatterns(patterns, models) {
  const safePatterns = Array.isArray(patterns)
    ? patterns.filter((pattern) => typeof pattern === "string" && pattern.trim())
    : [];
  const availableModels = Array.isArray(models)
    ? models.filter((model) => model?.provider && model?.id)
    : [];
  if (!safePatterns.length || !availableModels.length) return [];

  const modelRuntime = { getAvailable: async () => availableModels };
  const { scopedModels } = await resolveModelScopeWithDiagnostics(safePatterns, modelRuntime);
  return scopedModels.map(({ model }) => model);
}
