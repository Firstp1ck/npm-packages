import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(extensionDir);
const skillDir = join(packageRoot, "skills", "skill-creator");
const scriptsDir = join(skillDir, "scripts");
const libraryUrl = pathToFileURL(join(scriptsDir, "skill_creator_lib.mjs")).href;

const Reusability = Type.Union([
  Type.Literal("repeated-3-plus"),
  Type.Literal("expensive"),
  Type.Literal("strategic-reuse"),
  Type.Literal("confirmed"),
  Type.Literal("unknown"),
], { description: "Why this workflow deserves a reusable skill. 'unknown' blocks creation." });

const Invocation = Type.Union([
  Type.Literal("model"),
  Type.Literal("user"),
], { description: "Whether the generated draft should be model-discoverable or user-invoked only." });

const BaseDraftParams = {
  name: Type.String({ description: "Draft skill name. Will be normalized to Agent Skills lowercase-hyphen format." }),
  description: Type.Optional(Type.String({ description: "Optional routing description for the generated skill." })),
  invocation: Type.Optional(Invocation),
  leadingWords: Type.Optional(Type.Array(Type.String({ description: "Leading word that should anchor invocation/execution behavior." }))),
  branches: Type.Optional(Type.Array(Type.String({ description: "Distinct trigger branch this skill should handle." }))),
  shouldTrigger: Type.Optional(Type.Array(Type.String({ description: "Positive routing example for the generated skill." }))),
  shouldNotTrigger: Type.Optional(Type.Array(Type.String({ description: "Negative routing example for the generated skill." }))),
  discloseReference: Type.Optional(Type.Boolean({ description: "Write sanitized source notes to references/source-reference.md when useful for progressive disclosure." })),
  qualityPass: Type.Optional(Type.Boolean({ description: "Record that a predictability/pruning quality pass was requested." })),
  outputDir: Type.Optional(Type.String({ description: "Draft skill directory, or package root when packageSkeleton=true. Relative paths resolve from cwd." })),
  reusability: Reusability,
  reusabilityEvidence: Type.String({ description: "Concrete evidence that this is repeated, expensive, strategically reusable, or human-confirmed reusable." }),
  reuseCount: Type.Optional(Type.Number({ minimum: 1, maximum: 100, description: "Observed number of successful uses, when known." })),
  packageSkeleton: Type.Optional(Type.Boolean({ description: "If true, create pi-skill-<name>/ package skeleton instead of a standalone draft skill dir." })),
  withTests: Type.Optional(Type.Boolean({ description: "Add generated contract tests and sanitized fixture when possible." })),
  runEvaluator: Type.Optional(Type.Boolean({ description: "Try skill_eval_run after writing the draft if available." })),
  localOnly: Type.Optional(Type.Boolean({ description: "Mark the draft as Pi-local when portability is intentionally not required." })),
  overwrite: Type.Optional(Type.Boolean({ description: "Overwrite existing generated files." })),
  allowDiscoveredOutput: Type.Optional(Type.Boolean({ description: "Allow writing under Pi's auto-discovered skill root only after explicit user approval." })),
};

const DraftParams = Type.Object({
  ...BaseDraftParams,
  sourceNotes: Type.Optional(Type.String({ description: "Inline source notes or successful trajectory text." })),
  sourceNotesPath: Type.Optional(Type.String({ description: "Path to successful trajectory notes. Relative paths resolve from cwd; leading @ is ignored." })),
  sourcePatchPath: Type.Optional(Type.String({ description: "Path to PATCH.md-style source artifact. Relative paths resolve from cwd; leading @ is ignored." })),
});

const NotesParams = Type.Object({
  ...BaseDraftParams,
  sourceNotesPath: Type.String({ description: "Path to successful trajectory notes. Relative paths resolve from cwd; leading @ is ignored." }),
});

const PatchParams = Type.Object({
  ...BaseDraftParams,
  sourcePatchPath: Type.String({ description: "Path to PATCH.md-style source artifact. Relative paths resolve from cwd; leading @ is ignored." }),
});

type SkillCreatorLib = {
  createDraft(options: Record<string, unknown>): Promise<Record<string, unknown>>;
};

async function loadLibrary(): Promise<SkillCreatorLib> {
  return await import(libraryUrl) as SkillCreatorLib;
}

function cleanPath(value: unknown, cwd: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const cleaned = value.trim().replace(/^@+/, "");
  if (cleaned.startsWith("~") || cleaned.startsWith("/")) return cleaned;
  return resolve(cwd, cleaned);
}

function toOptions(params: Record<string, unknown>, cwd: string): Record<string, unknown> {
  return {
    ...params,
    cwd,
    sourceText: typeof params.sourceNotes === "string" ? params.sourceNotes : undefined,
    sourceNotesPath: cleanPath(params.sourceNotesPath, cwd),
    sourcePatchPath: cleanPath(params.sourcePatchPath, cwd),
    outputDir: cleanPath(params.outputDir, cwd),
  };
}

function formatResult(result: Record<string, any>): string {
  const lines = [
    `Draft skill: ${result.name}`,
    `SKILL.md: ${result.skillPath}`,
    `Package skeleton: ${result.packageSkeleton ? "yes" : "no"}`,
    result.enablement ?? "Draft was not enabled automatically.",
  ];
  if (Array.isArray(result.warnings) && result.warnings.length > 0) {
    lines.push("", "Warnings:", ...result.warnings.map((warning: string) => `- ${warning}`));
  }
  if (result.validation && Array.isArray(result.validation.errors) && result.validation.errors.length > 0) {
    lines.push("", "Validation errors:", ...result.validation.errors.map((error: string) => `- ${error}`));
  }
  if (result.evaluator?.attempted) {
    lines.push("", `Evaluator: ${result.evaluator.available ? `exit ${result.evaluator.code}` : "not available"}`);
  }
  return lines.join("\n");
}

export default function skillCreatorExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "skill_create_draft",
    label: "Skill Create Draft",
    description: "Create a disabled draft Agent Skill from reusable source notes, with optional tests and evaluator run.",
    promptSnippet: "Draft a reusable Pi/Agent Skill from successful trajectory notes without auto-enabling it.",
    promptGuidelines: [
      "Use skill_create_draft only after confirming the workflow is repeated, expensive, strategically reusable, or explicitly confirmed reusable.",
      "Choose invocation=model for autonomous routing and invocation=user for human-invoked reference/manual skills.",
      "Provide leadingWords, branches, and should/should-not trigger examples when known so the draft is predictable rather than merely structurally valid.",
      "Do not use skill_create_draft to auto-enable generated skills; ask the user before enabling.",
    ],
    parameters: DraftParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const lib = await loadLibrary();
      const result = await lib.createDraft(toOptions(params as Record<string, unknown>, ctx.cwd));
      return { content: [{ type: "text", text: formatResult(result) }], details: result };
    },
  });

  pi.registerTool({
    name: "skill_create_from_notes",
    label: "Skill Create From Notes",
    description: "Create a disabled draft Agent Skill from a successful-trajectory notes file.",
    promptSnippet: "Draft a reusable skill from a successful trajectory notes file.",
    promptGuidelines: [
      "Use skill_create_from_notes when a notes file describes a successful reusable workflow.",
      "Set invocation, leadingWords, branches, and routing examples when the notes imply them.",
      "Do not enable generated skill drafts without explicit user confirmation.",
    ],
    parameters: NotesParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const lib = await loadLibrary();
      const result = await lib.createDraft(toOptions(params as Record<string, unknown>, ctx.cwd));
      return { content: [{ type: "text", text: formatResult(result) }], details: result };
    },
  });

  pi.registerTool({
    name: "skill_create_from_patch",
    label: "Skill Create From Patch",
    description: "Create a disabled draft Agent Skill from a PATCH.md-style successful source artifact.",
    promptSnippet: "Draft a reusable skill from a PATCH.md-style workflow artifact.",
    promptGuidelines: [
      "Use skill_create_from_patch when a PATCH.md documents a reusable successful workflow.",
      "Use discloseReference for long or branch-specific PATCH context instead of bloating SKILL.md.",
      "Do not enable generated skill drafts without explicit user confirmation.",
    ],
    parameters: PatchParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const lib = await loadLibrary();
      const result = await lib.createDraft(toOptions(params as Record<string, unknown>, ctx.cwd));
      return { content: [{ type: "text", text: formatResult(result) }], details: result };
    },
  });
}
