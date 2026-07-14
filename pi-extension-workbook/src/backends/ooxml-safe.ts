import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveUserPath } from "../pi-utils.ts";
import type {
  EngineCapabilities,
  WorkbookDiffRequest,
  WorkbookEditRequest,
  WorkbookInspectRequest,
  WorkbookReadRequest,
  WorkbookRenderRequest,
  WorkbookValidateRequest,
} from "../contracts.ts";
import { CORE_EDIT_OPERATIONS } from "./interface.ts";
import { assertNotAborted } from "../errors.ts";
import { requireWorkbookFile } from "../core/paths.ts";
import { sha256File } from "../core/hash.ts";
import { executeEditTransaction, type MutationQueue } from "../core/transaction.ts";
import { OoxmlPackage } from "../ooxml/package.ts";
import { WorkbookModel } from "../ooxml/workbook.ts";
import { validatePackage } from "../ooxml/validate.ts";
import { renderSheetRange } from "../ooxml/render.ts";
import { getOrCreatePreview } from "../ooxml/preview-cache.ts";
import { diffWorkbookPackages } from "../ooxml/diff.ts";

export const OOXML_CAPABILITIES: EngineCapabilities = {
  engine: "ooxml-safe",
  available: true,
  formats: ["xlsx", "xlsm"],
  inspect: true,
  read: true,
  render: true,
  edit: true,
  diff: true,
  validate: true,
  operations: CORE_EDIT_OPERATIONS.map((operation) => ({ operation, supported: true, fidelity: "bounded" as const, reason: "OOXML-surgical implementation changes only operation-declared parts and verifies every protected part; per-file protected/ambiguous parts still fail closed." })),
  constraints: [
    "No macro execution, source editing, or recalculation.",
    "No external-data refresh or external-data formulas.",
    "Declared table/image/chart/note operations require mutable package parts; all other advanced objects are preservation-only.",
    "Shared, array, data-table, and spill formula regions are preservation-only for content edits.",
    "ZIP64 and encrypted workbooks are rejected.",
  ],
};

export class OoxmlSafeEngine {
  readonly id = "ooxml-safe" as const;
  readonly cwd: string;
  readonly queue: MutationQueue;

  constructor(cwd: string, queue: MutationQueue = async (_key, work) => work()) {
    this.cwd = cwd;
    this.queue = queue;
  }

  async probe(): Promise<EngineCapabilities> {
    return OOXML_CAPABILITIES;
  }

  private async load(request: WorkbookInspectRequest, signal?: AbortSignal): Promise<{ filePath: string; hash: string; pkg: OoxmlPackage; model: WorkbookModel }> {
    assertNotAborted(signal);
    const filePath = await requireWorkbookFile(request.path, this.cwd);
    const [bytes, hash] = await Promise.all([fs.readFile(filePath), sha256File(filePath)]);
    assertNotAborted(signal);
    const pkg = OoxmlPackage.fromBytes(bytes, request.limits);
    return { filePath, hash, pkg, model: new WorkbookModel(pkg) };
  }

  async inspect(request: WorkbookInspectRequest, signal?: AbortSignal): Promise<unknown> {
    const loaded = await this.load(request, signal);
    return { sourcePath: loaded.filePath, sourceSha256: loaded.hash, engine: this.id, capabilities: OOXML_CAPABILITIES, validation: validatePackage(loaded.pkg, loaded.filePath), ...loaded.model.inspect() };
  }

  async read(request: WorkbookReadRequest, signal?: AbortSignal): Promise<unknown> {
    const loaded = await this.load(request, signal);
    const result = loaded.model.read(request.sheet, request.range, request.maxCells);
    if (request.includeFormulas === false) for (const cell of result.cells) delete cell.formula;
    if (request.includeStyles === false) result.styles = [];
    return { sourcePath: loaded.filePath, sourceSha256: loaded.hash, engine: this.id, ...result };
  }

  async render(request: WorkbookRenderRequest, signal?: AbortSignal): Promise<unknown> {
    const loaded = await this.load(request, signal);
    const result = loaded.model.read(request.sheet, request.range, loaded.pkg.archive.limits.maxRenderedCells);
    const scale = request.scale ?? 1;
    const cached = await getOrCreatePreview({ workbookSha256: loaded.hash, sheet: result.sheet.name, range: result.range, scale, renderer: "ooxml-safe-bitmap" }, () => renderSheetRange(result, scale).png);
    assertNotAborted(signal);
    const safeSheet = result.sheet.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "sheet";
    let outputPath = cached.cachePath;
    if (request.outputDir) {
      const outputDir = resolveUserPath(request.outputDir, this.cwd);
      await fs.mkdir(outputDir, { recursive: true });
      outputPath = path.join(outputDir, `${safeSheet}-${result.range.replace(/[:$]/g, "-")}.png`);
      await fs.writeFile(outputPath, cached.png);
    }
    const width = (cached.png[16] << 24 | cached.png[17] << 16 | cached.png[18] << 8 | cached.png[19]) >>> 0;
    const height = (cached.png[20] << 24 | cached.png[21] << 16 | cached.png[22] << 8 | cached.png[23]) >>> 0;
    return { sourcePath: loaded.filePath, sourceSha256: loaded.hash, engine: this.id, renderer: "ooxml-safe-bitmap", fidelity: "bounded", cacheHit: cached.cacheHit, cacheKey: cached.cacheKey, sheet: result.sheet.name, range: result.range, width, height, outputPath, png: cached.png, warnings: [...result.warnings, "Preview uses a deterministic bitmap grid and does not render charts, shapes, conditional formatting, rich text, or Excel font metrics."] };
  }

  async edit(request: WorkbookEditRequest, signal?: AbortSignal): Promise<unknown> {
    return executeEditTransaction({ ...request, schemaVersion: request.schemaVersion ?? "1.0" }, this.cwd, this.queue, signal);
  }

  async diff(request: WorkbookDiffRequest, signal?: AbortSignal): Promise<unknown> {
    assertNotAborted(signal);
    const beforePath = await requireWorkbookFile(request.beforePath, this.cwd);
    const afterPath = await requireWorkbookFile(request.afterPath, this.cwd);
    const [beforeBytes, afterBytes, beforeSha256, afterSha256] = await Promise.all([fs.readFile(beforePath), fs.readFile(afterPath), sha256File(beforePath), sha256File(afterPath)]);
    const before = OoxmlPackage.fromBytes(beforeBytes, request.limits);
    const after = OoxmlPackage.fromBytes(afterBytes, request.limits);
    return { beforePath, afterPath, beforeSha256, afterSha256, engine: this.id, ...diffWorkbookPackages(before, after, request) };
  }

  async validate(request: WorkbookValidateRequest, signal?: AbortSignal): Promise<unknown> {
    const loaded = await this.load(request, signal);
    let baseline: OoxmlPackage | undefined;
    if (request.baselinePath) {
      const baselinePath = await requireWorkbookFile(request.baselinePath, this.cwd);
      baseline = OoxmlPackage.fromBytes(await fs.readFile(baselinePath), request.limits);
    }
    const allowed = baseline ? new Set([...baseline.archive.entries.keys()].filter((part) => !baseline!.protectedParts.has(part))) : undefined;
    return { sourcePath: loaded.filePath, sourceSha256: loaded.hash, engine: this.id, ...validatePackage(loaded.pkg, loaded.filePath, baseline, allowed) };
  }
}
