import type { DocxLimits } from "./core/limits.ts";

export const DOCX_CONTRACT_VERSION = "1.0" as const;
export const ARTIFACT_SCHEMA = "pi.artifact/v1" as const;
export type StoryKind = "main" | "header" | "footer" | "footnote" | "endnote" | "comment" | "textbox";
export type Selector =
  | { kind: "paragraphId"; paragraphId: string; story?: StoryKind; expectedHash?: string }
  | { kind: "path"; story: StoryKind; path: string; expectedHash?: string }
  | { kind: "text"; text: string; story?: StoryKind; occurrence?: number; expectedCount?: number; before?: string; after?: string }
  | { kind: "bookmark"; name: string }
  | { kind: "contentControl"; tag?: string; title?: string }
  | { kind: "tableCell"; story?: StoryKind; table: number; row: number; cell: number; expectedHash?: string }
  | { kind: "tableRow"; story?: StoryKind; table: number; row: number; expectedHash?: string };

export type CharacterFormatting = { bold?: boolean; italic?: boolean; underline?: "none" | "single" | "double"; fontFamily?: string; fontSizePoints?: number; color?: string };
export type ParagraphFormatting = { style?: string; alignment?: "left" | "center" | "right" | "both"; spacingBeforePoints?: number; spacingAfterPoints?: number; lineSpacing?: number; indentLeftPoints?: number; indentRightPoints?: number; firstLineIndentPoints?: number };
export type DocxOperation =
  | { type: "replaceText"; find: string; replacement: string; story?: StoryKind; selector?: Selector; expectedCount: number }
  | { type: "insertParagraph"; selector: Selector; position: "before" | "after"; text: string; style?: string }
  | { type: "deleteParagraph"; selector: Selector; expectedText?: string }
  | { type: "setTableCellText"; selector: Extract<Selector, { kind: "tableCell" }>; text: string; expectedText?: string }
  | { type: "insertTableRow"; selector: Extract<Selector, { kind: "tableRow" }>; position: "before" | "after"; cells: string[] }
  | { type: "deleteTableRow"; selector: Extract<Selector, { kind: "tableRow" }> }
  | { type: "setCharacterFormatting"; selector: Selector; formatting: CharacterFormatting }
  | { type: "setParagraphFormatting"; selector: Selector; formatting: ParagraphFormatting }
  | { type: "setHyperlink"; selector: Selector; text: string; target: string; tooltip?: string }
  | { type: "removeHyperlink"; selector: Selector; text?: string }
  | { type: "setCoreProperties"; properties: { title?: string; subject?: string; creator?: string; keywords?: string; description?: string; category?: string } };

export type DocumentArtifact = { schema: typeof ARTIFACT_SCHEMA; kind: "document"; id: string; revisionId?: string; title: string; mimeType: string; pageCount?: number; manifestPath: string; downloadPath?: string; expiresAt: string };
export type Capability = { operation: string; supported: boolean; fidelity: "native" | "bounded" | "preservation-only" | "conversion-only" | "unsupported"; reason?: string };
export type EngineCapabilities = { engine: "openxml-sidecar" | "typescript-reader" | "libreoffice-renderer" | "onlyoffice-renderer" | "liteparse-reader"; available: boolean; version?: string; formats: string[]; operations: Capability[]; constraints: string[] };
export type Warning = { code: string; message: string; severity: "info" | "warning" | "error"; part?: string };

export type PathRequest = { path: string; limits?: Partial<DocxLimits> };
export type DocxInspectRequest = PathRequest & { includeHiddenData?: boolean };
export type DocxReadRequest = PathRequest & { stories?: StoryKind[]; selector?: Selector; query?: string; exact?: boolean; maxBlocks?: number; includeHiddenData?: boolean };
export type DocxRenderRequest = PathRequest & { pages?: string; dpi?: number; timeoutMs?: number };
export type DocxEditRequest = PathRequest & { schemaVersion?: typeof DOCX_CONTRACT_VERSION; expectedSourceSha256?: string; dryRun?: boolean; operations: DocxOperation[]; timeoutMs?: number };
export type DocxDiffRequest = { beforePath: string; afterPath: string; includeFormatting?: boolean; includePackageParts?: boolean; renderPages?: string; timeoutMs?: number; maxChanges?: number; limits?: Partial<DocxLimits> };
export type DocxValidateRequest = PathRequest & { baselinePath?: string; expectedChangedParts?: string[]; renderPages?: string; timeoutMs?: number };
export type DocxCommitRequest = { revisionId: string; destinationPath?: string; overwrite?: boolean; inPlace?: boolean; expectedSourceSha256: string; expectedDestinationSha256?: string };

export type EngineRequest = { protocolVersion: typeof DOCX_CONTRACT_VERSION; command: "version" | "inspect" | "plan" | "edit" | "validate"; sourcePath?: string; outputPath?: string; operations?: DocxOperation[]; limits?: Partial<DocxLimits> };
export type EngineResponse = { protocolVersion: string; ok: boolean; engineVersion?: string; result?: Record<string, unknown>; error?: { code: string; message: string; details?: Record<string, unknown> }; warnings?: Warning[] };
