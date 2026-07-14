import { StringEnum } from "@earendil-works/pi-ai";
import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { OoxmlSafeEngine, OOXML_CAPABILITIES } from "./src/backends/ooxml-safe.ts";
import { probeAllBackends } from "./src/backends/probes.ts";
import type {
  WorkbookDiffRequest,
  WorkbookEditRequest,
  WorkbookInspectRequest,
  WorkbookReadRequest,
  WorkbookRenderRequest,
  WorkbookValidateRequest,
} from "./src/contracts.ts";
import { WORKBOOK_CONTRACT_VERSION } from "./src/contracts.ts";
import { DiffSchema, EditSchema, InspectSchema, ReadSchema, RenderSchema, ValidateSchema } from "./src/schemas.ts";
import { boundedJsonResult, renderImageResult, visibleLimitFrom } from "./src/output.ts";
import { formatDoctorReport, workbookDoctorReport } from "./src/doctor.ts";

const TOOL_GUIDELINES = [
  "Inspect unfamiliar workbooks before editing and use the returned SHA-256 as expectedSha256.",
  "Use dryRun=true first; every commit requires expectedSha256 and defaults to a new output file.",
  "Never claim macros were executed or edited. This package only inventories, preserves, and verifies active content.",
  "Render focused ranges when layout or formatting matters; use workbook_read for exact values and formulas.",
  "Validate and diff edited outputs before relying on them. Unsupported or lossy operations must fail closed.",
];

function status(onUpdate: ((result: { content: Array<{ type: "text"; text: string }>; details: Record<string, never> }) => void) | undefined, text: string): void {
  onUpdate?.({ content: [{ type: "text", text }], details: {} });
}

export default function workbookExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "workbook_inspect",
    label: "Inspect Workbook",
    description: "Inspect an XLSX/XLSM workbook's sheets, ranges, OOXML parts, links, protected active content, hashes, validation state, and safe-engine capabilities.",
    promptSnippet: "Inspect Excel workbook structure, formatting features, macros, links, and integrity before editing.",
    promptGuidelines: TOOL_GUIDELINES,
    parameters: InspectSchema,
    async execute(_id, rawParams, signal, onUpdate, ctx) {
      const params = rawParams as WorkbookInspectRequest;
      status(onUpdate, "Inspecting workbook package and protected parts…");
      const result = await new OoxmlSafeEngine(ctx.cwd).inspect(params, signal);
      return boundedJsonResult(result, "workbook-inspect", visibleLimitFrom(params));
    },
  });

  pi.registerTool({
    name: "workbook_read",
    label: "Read Workbook Range",
    description: "Read a bounded worksheet range with typed values, formulas, style IDs, normalized style descriptors, merges, and hidden-state metadata.",
    promptSnippet: "Read exact values, formulas, and styles from a focused Excel worksheet range.",
    promptGuidelines: TOOL_GUIDELINES,
    parameters: ReadSchema,
    async execute(_id, rawParams, signal, onUpdate, ctx) {
      const params = rawParams as WorkbookReadRequest;
      status(onUpdate, `Reading ${params.sheet}${params.range ? `!${params.range}` : ""}…`);
      const result = await new OoxmlSafeEngine(ctx.cwd).read(params, signal);
      return boundedJsonResult(result, "workbook-read", visibleLimitFrom(params));
    },
  });

  pi.registerTool({
    name: "workbook_render",
    label: "Render Workbook Range",
    description: "Render a focused worksheet range to a deterministic PNG image and return an image block plus the saved artifact path and fidelity metadata.",
    promptSnippet: "Render an Excel sheet or focused range to PNG for visual inspection.",
    promptGuidelines: TOOL_GUIDELINES,
    parameters: RenderSchema,
    async execute(_id, rawParams, signal, onUpdate, ctx) {
      const params = rawParams as WorkbookRenderRequest;
      status(onUpdate, `Rendering ${params.sheet}${params.range ? `!${params.range}` : ""}…`);
      const result = await new OoxmlSafeEngine(ctx.cwd).render(params, signal) as Record<string, unknown> & { png: Buffer; outputPath: string };
      return renderImageResult(result);
    },
  });

  pi.registerTool({
    name: "workbook_edit",
    label: "Edit Workbook",
    description: "Dry-run or transactionally apply ordered value, formula, rich-formatting, layout, structural, metadata, table, image, chart, print, and protection operations to XLSX/XLSM without changing protected active-content parts.",
    promptSnippet: "Safely dry-run or commit transactional Excel workbook edits with hash conflict protection.",
    promptGuidelines: TOOL_GUIDELINES,
    parameters: EditSchema,
    async execute(_id, rawParams, signal, onUpdate, ctx) {
      const params = { ...(rawParams as WorkbookEditRequest), schemaVersion: (rawParams as WorkbookEditRequest).schemaVersion ?? WORKBOOK_CONTRACT_VERSION };
      status(onUpdate, params.dryRun ?? true ? "Planning and validating workbook edit without committing…" : "Applying workbook edit in a queued transaction…");
      const engine = new OoxmlSafeEngine(ctx.cwd, withFileMutationQueue);
      const result = await engine.edit(params, signal);
      return boundedJsonResult(result, "workbook-edit", visibleLimitFrom(params));
    },
  });

  pi.registerTool({
    name: "workbook_diff",
    label: "Diff Workbooks",
    description: "Compare two XLSX/XLSM workbooks by sheets, bounded cell values/formulas/styles, OOXML part hashes, and protected active-content changes.",
    promptSnippet: "Diff workbook values, formulas, styles, package parts, and macro-protected content.",
    promptGuidelines: TOOL_GUIDELINES,
    parameters: DiffSchema,
    async execute(_id, rawParams, signal, onUpdate, ctx) {
      const params = rawParams as WorkbookDiffRequest;
      status(onUpdate, "Comparing workbook semantics and OOXML part hashes…");
      const result = await new OoxmlSafeEngine(ctx.cwd).diff(params, signal);
      return boundedJsonResult(result, "workbook-diff", visibleLimitFrom(params));
    },
  });

  pi.registerTool({
    name: "workbook_validate",
    label: "Validate Workbook",
    description: "Validate XLSX/XLSM package structure, extension/content types, relationships, macro state, and optional protected-part integrity against a baseline workbook.",
    promptSnippet: "Validate Excel package structure, macro preservation, and post-edit integrity.",
    promptGuidelines: TOOL_GUIDELINES,
    parameters: ValidateSchema,
    async execute(_id, rawParams, signal, onUpdate, ctx) {
      const params = rawParams as WorkbookValidateRequest;
      status(onUpdate, "Validating workbook package and protected-part integrity…");
      const result = await new OoxmlSafeEngine(ctx.cwd).validate(params, signal);
      return boundedJsonResult(result, "workbook-validate", visibleLimitFrom(params));
    },
  });

  pi.registerCommand("workbook-doctor", {
    description: "Report workbook backend, host, dependency, and safety capabilities without opening a workbook.",
    handler: async (_args, ctx) => {
      const report = await workbookDoctorReport(OOXML_CAPABILITIES);
      ctx.ui.notify(formatDoctorReport(report), report.ok ? "info" : "warning");
    },
  });
}

export { OoxmlSafeEngine, OOXML_CAPABILITIES } from "./src/backends/ooxml-safe.ts";
export { probeAllBackends } from "./src/backends/probes.ts";
export { workbookDoctorReport, formatDoctorReport } from "./src/doctor.ts";
export { WORKBOOK_CONTRACT_VERSION } from "./src/contracts.ts";
export const WorkbookBackendSchema = StringEnum(["ooxml-safe", "excel-native", "aspose"] as const);
export const WorkbookContractSchema = Type.Literal(WORKBOOK_CONTRACT_VERSION);
