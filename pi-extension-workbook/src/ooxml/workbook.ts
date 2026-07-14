import { fail } from "../errors.ts";
import type { WorkbookLimits } from "../core/limits.ts";
import { OoxmlPackage } from "./package.ts";
import { containsCell, formatCellReference, formatRange, parseCellReference, parseRange, rangeCellCount, rangesOverlap, type RangeBounds } from "./cell-ref.ts";
import { NS, directChildren, elements, firstDirectChild, parseXml, textContent } from "./xml.ts";
import { StyleCatalog, type StyleDescriptor } from "./styles.ts";

export type SheetInfo = {
  name: string;
  sheetId: string;
  state: string;
  relationshipId: string;
  partPath: string;
};

export type CellData = {
  reference: string;
  row: number;
  column: number;
  value: string | number | boolean | null;
  displayedValue: string;
  rawValue?: string;
  formula?: string;
  styleId: number;
  type?: string;
  richTextRuns?: Array<{ text: string; properties: Record<string, unknown> }>;
  merge?: { range: string; owner: string };
  conditionalFormatRanges?: string[];
  dataValidationRanges?: string[];
};

export type SheetReadResult = {
  sheet: SheetInfo;
  range: string;
  cells: CellData[];
  styles: StyleDescriptor[];
  merges: Array<{ range: string; owner: string }>;
  rowDimensions: Array<{ row: number; height?: number; hidden: boolean; customHeight: boolean }>;
  columnDimensions: Array<{ startColumn: number; endColumn: number; width?: number; hidden: boolean; customWidth: boolean; styleId?: number }>;
  conditionalFormats: Array<{ ranges: string[]; rules: Array<{ type?: string; operator?: string; priority?: number; stopIfTrue: boolean; formulas: string[] }> }>;
  dataValidations: Array<{ ranges: string[]; type?: string; operator?: string; allowBlank: boolean; formulas: string[] }>;
  hyperlinks: Array<{ range: string; location?: string; relationshipId?: string; display?: string; tooltip?: string }>;
  truncated: boolean;
  warnings: string[];
};

function worksheetDimension(document: Document): RangeBounds | undefined {
  const dimension = elements(document, NS.spreadsheet, "dimension")[0]?.getAttribute("ref");
  if (!dimension) return undefined;
  try {
    return parseRange(dimension.includes(":") ? dimension : `${dimension}:${dimension}`);
  } catch {
    return undefined;
  }
}

function usedBounds(document: Document): RangeBounds {
  let startRow = Number.POSITIVE_INFINITY;
  let endRow = 1;
  let startColumn = Number.POSITIVE_INFINITY;
  let endColumn = 1;
  for (const cell of elements(document, NS.spreadsheet, "c")) {
    const reference = cell.getAttribute("r");
    if (!reference) continue;
    try {
      const address = parseCellReference(reference);
      startRow = Math.min(startRow, address.row);
      endRow = Math.max(endRow, address.row);
      startColumn = Math.min(startColumn, address.column);
      endColumn = Math.max(endColumn, address.column);
    } catch { /* validation reports malformed references separately */ }
  }
  return Number.isFinite(startRow) ? { startRow, endRow, startColumn, endColumn } : { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 };
}

function richText(element: Element): string {
  return elements(element, NS.spreadsheet, "t").map((item) => textContent(item)).join("");
}

function richTextRuns(element: Element): Array<{ text: string; properties: Record<string, unknown> }> {
  return directChildren(element, NS.spreadsheet, "r").map((run) => {
    const properties = firstDirectChild(run, NS.spreadsheet, "rPr");
    const descriptor: Record<string, unknown> = {};
    if (properties) {
      for (const child of Array.from(properties.childNodes).filter((node): node is Element => node.nodeType === 1)) {
        descriptor[child.localName] = child.getAttribute("val") ?? true;
        if (child.localName === "color") descriptor.color = Object.fromEntries(Array.from(child.attributes).map((attribute) => [attribute.name, attribute.value]));
      }
    }
    return { text: textContent(firstDirectChild(run, NS.spreadsheet, "t")), properties: descriptor };
  });
}

function rangeTokens(value: string | null): string[] {
  return (value ?? "").trim().split(/\s+/).filter(Boolean).map((token) => formatRange(parseRange(token)));
}

function localNameCount(document: Document, localName: string): number {
  return Array.from(document.getElementsByTagName("*")).filter((item) => item.localName === localName).length;
}

function redactedAttributes(element: Element | undefined): Record<string, string> | undefined {
  if (!element) return undefined;
  return Object.fromEntries(Array.from(element.attributes).filter((attribute) => !/(?:password|hash|salt|spinCount)/i.test(attribute.name)).map((attribute) => [attribute.name, attribute.value]));
}

function formulaFunctionNames(formula: string): string[] {
  const names = new Set<string>();
  const withoutStrings = formula.replace(/"(?:[^"]|"")*"/g, "");
  const pattern = /(?<![A-Za-z0-9_.])((?:(?:_xlfn|_xlws)\.)*[A-Za-z_\\][A-Za-z0-9_.\\]*)\s*\(/gi;
  for (const match of withoutStrings.matchAll(pattern)) names.add(match[1].toUpperCase());
  return [...names];
}

export class WorkbookModel {
  readonly pkg: OoxmlPackage;
  readonly limits: WorkbookLimits;
  readonly workbookDocument: Document;
  readonly sheets: SheetInfo[];
  readonly sharedStrings: string[];
  readonly styles?: StyleCatalog;
  readonly stylesPart?: string;

  constructor(pkg: OoxmlPackage) {
    this.pkg = pkg;
    this.limits = pkg.archive.limits;
    this.workbookDocument = parseXml(pkg.archive.require(pkg.workbookPart), pkg.workbookPart, this.limits.maxXmlBytes);
    const workbookRelationships = pkg.relationshipsFrom(pkg.workbookPart);
    const relationshipById = new Map(workbookRelationships.map((relationship) => [relationship.id, relationship]));
    this.sheets = elements(this.workbookDocument, NS.spreadsheet, "sheet").map((sheet) => {
      const relationshipId = sheet.getAttributeNS(NS.officeRelationships, "id") || sheet.getAttribute("r:id") || "";
      const relationship = relationshipById.get(relationshipId);
      if (!relationship?.resolvedTarget) fail("INVALID_PACKAGE", `Worksheet relationship ${relationshipId || "(missing)"} is invalid.`);
      return {
        name: sheet.getAttribute("name") ?? "",
        sheetId: sheet.getAttribute("sheetId") ?? "",
        state: sheet.getAttribute("state") ?? "visible",
        relationshipId,
        partPath: relationship.resolvedTarget,
      };
    });
    if (new Set(this.sheets.map((sheet) => sheet.name.toLowerCase())).size !== this.sheets.length) fail("INVALID_PACKAGE", "Worksheet names are not unique.");

    const shared = workbookRelationships.find((relationship) => /\/sharedStrings$/i.test(relationship.type));
    this.sharedStrings = shared?.resolvedTarget ? this.loadSharedStrings(shared.resolvedTarget) : [];
    const styles = workbookRelationships.find((relationship) => /\/styles$/i.test(relationship.type));
    this.stylesPart = styles?.resolvedTarget;
    this.styles = this.stylesPart ? new StyleCatalog(pkg.archive.require(this.stylesPart), this.stylesPart, this.limits.maxXmlBytes, this.limits.maxStyles) : undefined;
  }

  private loadSharedStrings(partPath: string): string[] {
    const document = parseXml(this.pkg.archive.require(partPath), partPath, this.limits.maxXmlBytes);
    const items = elements(document, NS.spreadsheet, "si");
    if (items.length > this.limits.maxSharedStrings) fail("LIMIT_EXCEEDED", `Shared string count ${items.length} exceeds limit ${this.limits.maxSharedStrings}.`);
    return items.map(richText);
  }

  sheet(name: string): SheetInfo {
    const sheet = this.sheets.find((candidate) => candidate.name === name) ?? this.sheets.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (!sheet) fail("INVALID_ARGUMENT", `Worksheet not found: ${name}. Available: ${this.sheets.map((item) => item.name).join(", ")}`);
    return sheet;
  }

  sheetDocument(sheet: SheetInfo): Document {
    return parseXml(this.pkg.archive.require(sheet.partPath), sheet.partPath, this.limits.maxXmlBytes);
  }

  cellData(cell: Element): CellData | undefined {
    const reference = cell.getAttribute("r");
    if (!reference) return undefined;
    const address = parseCellReference(reference);
    const type = cell.getAttribute("t") ?? undefined;
    const styleId = Number(cell.getAttribute("s") ?? 0);
    const formula = textContent(firstDirectChild(cell, NS.spreadsheet, "f")) || undefined;
    const raw = textContent(firstDirectChild(cell, NS.spreadsheet, "v"));
    let value: CellData["value"] = null;
    const inline = firstDirectChild(cell, NS.spreadsheet, "is");
    if (type === "inlineStr") value = richText(inline ?? cell);
    else if (type === "s") value = this.sharedStrings[Number(raw)] ?? null;
    else if (type === "b") value = raw === "1";
    else if (type === "str" || type === "e") value = raw;
    else if (raw !== "") value = Number.isFinite(Number(raw)) ? Number(raw) : raw;
    const runs = inline ? richTextRuns(inline) : [];
    return { reference: formatCellReference(address.row, address.column), row: address.row, column: address.column, value, displayedValue: value === null ? "" : String(value), ...(raw !== "" ? { rawValue: raw } : {}), ...(formula ? { formula } : {}), styleId, ...(type ? { type } : {}), ...(runs.length ? { richTextRuns: runs } : {}) };
  }

  read(sheetName: string, requestedRange?: string, maxCells?: number): SheetReadResult {
    const sheet = this.sheet(sheetName);
    const document = this.sheetDocument(sheet);
    let bounds = requestedRange ? parseRange(requestedRange) : worksheetDimension(document) ?? usedBounds(document);
    const effectiveLimit = Math.min(maxCells ?? this.limits.maxCellsPerRead, this.limits.maxCellsPerRead);
    let truncated = false;
    if (rangeCellCount(bounds) > effectiveLimit) {
      const columns = bounds.endColumn - bounds.startColumn + 1;
      const rows = Math.max(1, Math.floor(effectiveLimit / columns));
      bounds = { ...bounds, endRow: Math.min(bounds.endRow, bounds.startRow + rows - 1) };
      truncated = true;
    }
    const merges = elements(document, NS.spreadsheet, "mergeCell").flatMap((element) => {
      const reference = element.getAttribute("ref");
      if (!reference) return [];
      const mergeBounds = parseRange(reference);
      return rangesOverlap(bounds, mergeBounds) ? [{ range: formatRange(mergeBounds), owner: formatCellReference(mergeBounds.startRow, mergeBounds.startColumn), bounds: mergeBounds }] : [];
    });
    const rowDimensions = elements(document, NS.spreadsheet, "row").flatMap((row) => {
      const number = Number(row.getAttribute("r"));
      if (!Number.isInteger(number) || number < bounds.startRow || number > bounds.endRow) return [];
      const height = Number(row.getAttribute("ht"));
      return [{ row: number, ...(Number.isFinite(height) && height > 0 ? { height } : {}), hidden: /^(?:1|true)$/i.test(row.getAttribute("hidden") ?? ""), customHeight: /^(?:1|true)$/i.test(row.getAttribute("customHeight") ?? "") }];
    });
    const columnDimensions = elements(document, NS.spreadsheet, "col").flatMap((column) => {
      const startColumn = Number(column.getAttribute("min"));
      const endColumn = Number(column.getAttribute("max"));
      if (!Number.isInteger(startColumn) || !Number.isInteger(endColumn) || endColumn < bounds.startColumn || startColumn > bounds.endColumn) return [];
      const width = Number(column.getAttribute("width"));
      const styleId = Number(column.getAttribute("style"));
      return [{ startColumn, endColumn, ...(Number.isFinite(width) ? { width } : {}), hidden: /^(?:1|true)$/i.test(column.getAttribute("hidden") ?? ""), customWidth: /^(?:1|true)$/i.test(column.getAttribute("customWidth") ?? ""), ...(Number.isInteger(styleId) ? { styleId } : {}) }];
    });
    const conditionalFormats = elements(document, NS.spreadsheet, "conditionalFormatting").map((container) => ({
      ranges: rangeTokens(container.getAttribute("sqref")),
      rules: directChildren(container, NS.spreadsheet, "cfRule").map((rule) => ({
        type: rule.getAttribute("type") ?? undefined,
        operator: rule.getAttribute("operator") ?? undefined,
        priority: Number(rule.getAttribute("priority")) || undefined,
        stopIfTrue: /^(?:1|true)$/i.test(rule.getAttribute("stopIfTrue") ?? ""),
        formulas: directChildren(rule, NS.spreadsheet, "formula").map(textContent),
      })),
    })).filter((item) => item.ranges.some((range) => rangesOverlap(bounds, parseRange(range))));
    const dataValidations = elements(document, NS.spreadsheet, "dataValidation").map((validation) => ({
      ranges: rangeTokens(validation.getAttribute("sqref")),
      type: validation.getAttribute("type") ?? undefined,
      operator: validation.getAttribute("operator") ?? undefined,
      allowBlank: /^(?:1|true)$/i.test(validation.getAttribute("allowBlank") ?? ""),
      formulas: [textContent(firstDirectChild(validation, NS.spreadsheet, "formula1")), textContent(firstDirectChild(validation, NS.spreadsheet, "formula2"))].filter(Boolean),
    })).filter((item) => item.ranges.some((range) => rangesOverlap(bounds, parseRange(range))));
    const hyperlinks = elements(document, NS.spreadsheet, "hyperlink").flatMap((hyperlink) => {
      const reference = hyperlink.getAttribute("ref");
      if (!reference || !rangesOverlap(bounds, parseRange(reference))) return [];
      const relationshipId = hyperlink.getAttributeNS(NS.officeRelationships, "id") || hyperlink.getAttribute("r:id") || undefined;
      return [{ range: formatRange(parseRange(reference)), location: hyperlink.getAttribute("location") ?? undefined, relationshipId, display: hyperlink.getAttribute("display") ?? undefined, tooltip: hyperlink.getAttribute("tooltip") ?? undefined }];
    });
    const cells: CellData[] = [];
    const usedStyles = new Set<number>();
    for (const element of elements(document, NS.spreadsheet, "c")) {
      const cell = this.cellData(element);
      if (!cell || cell.row < bounds.startRow || cell.row > bounds.endRow || cell.column < bounds.startColumn || cell.column > bounds.endColumn) continue;
      const merge = merges.find((candidate) => containsCell(candidate.bounds, cell.row, cell.column));
      if (merge) cell.merge = { range: merge.range, owner: merge.owner };
      const cfRanges = conditionalFormats.flatMap((item) => item.ranges).filter((range) => containsCell(parseRange(range), cell.row, cell.column));
      const validationRanges = dataValidations.flatMap((item) => item.ranges).filter((range) => containsCell(parseRange(range), cell.row, cell.column));
      if (cfRanges.length) cell.conditionalFormatRanges = [...new Set(cfRanges)];
      if (validationRanges.length) cell.dataValidationRanges = [...new Set(validationRanges)];
      cells.push(cell);
      usedStyles.add(cell.styleId);
    }
    cells.sort((a, b) => a.row - b.row || a.column - b.column);
    const styles = this.styles ? [...usedStyles].sort((a, b) => a - b).map((id) => this.styles!.describe(id)) : [];
    const warnings: string[] = [];
    if (truncated) warnings.push(`Range was truncated to ${effectiveLimit} cells.`);
    if (sheet.state !== "visible") warnings.push(`Worksheet is ${sheet.state}.`);
    if (this.pkg.protectedParts.size > 0) warnings.push("Workbook contains protected active content; mutation requires byte-identical preservation.");
    if (this.pkg.relationships.some((relationship) => relationship.targetMode?.toLowerCase() === "external")) warnings.push("Workbook contains external relationships; they were not refreshed.");
    warnings.push("displayedValue is a deterministic approximation and does not evaluate Excel number formats or formulas.");
    return {
      sheet,
      range: formatRange(bounds),
      cells,
      styles,
      merges: merges.map(({ range, owner }) => ({ range, owner })),
      rowDimensions,
      columnDimensions,
      conditionalFormats,
      dataValidations,
      hyperlinks,
      truncated,
      warnings,
    };
  }

  inspect(): Record<string, unknown> {
    const manifest = this.pkg.manifest();
    const definedNames = elements(this.workbookDocument, NS.spreadsheet, "definedName").map((element) => ({ name: element.getAttribute("name"), localSheetId: element.getAttribute("localSheetId") ?? undefined, hidden: /^(?:1|true)$/i.test(element.getAttribute("hidden") ?? ""), comment: element.getAttribute("comment") ?? undefined, value: textContent(element) }));
    let formulaCount = 0;
    let arrayFormulaCount = 0;
    let sharedFormulaCount = 0;
    let dynamicFormulaCount = 0;
    let externalFormulaCount = 0;
    let cachedFormulaResultCount = 0;
    const functionCounts = new Map<string, number>();
    const sheets = this.sheets.map((sheet) => {
      const document = this.sheetDocument(sheet);
      const dimension = worksheetDimension(document) ?? usedBounds(document);
      const relationships = this.pkg.relationshipsFrom(sheet.partPath);
      const drawingRelationships = relationships.filter((relationship) => /\/drawing$/i.test(relationship.type) && relationship.resolvedTarget).flatMap((relationship) => this.pkg.relationshipsFrom(relationship.resolvedTarget!));
      const formulas = elements(document, NS.spreadsheet, "f");
      formulaCount += formulas.length;
      arrayFormulaCount += formulas.filter((formula) => formula.getAttribute("t") === "array").length;
      sharedFormulaCount += formulas.filter((formula) => formula.getAttribute("t") === "shared").length;
      dynamicFormulaCount += formulas.filter((formula) => /(?:_xlfn\.|_xlws\.|#)/i.test(textContent(formula)) || formula.getAttribute("aca") === "1").length;
      externalFormulaCount += formulas.filter((formula) => /\[[^\]]+\]|(?:https?|ftp):\/\//i.test(textContent(formula))).length;
      cachedFormulaResultCount += formulas.filter((formula) => formula.parentNode?.nodeType === 1 && Boolean(firstDirectChild(formula.parentNode as Element, NS.spreadsheet, "v"))).length;
      for (const formula of formulas) for (const name of formulaFunctionNames(textContent(formula))) functionCounts.set(name, (functionCounts.get(name) ?? 0) + 1);
      return {
        ...sheet,
        dimension: formatRange(dimension),
        merges: elements(document, NS.spreadsheet, "mergeCell").map((element) => element.getAttribute("ref")).filter(Boolean),
        conditionalFormats: elements(document, NS.spreadsheet, "conditionalFormatting").length,
        dataValidations: elements(document, NS.spreadsheet, "dataValidation").length,
        hyperlinks: elements(document, NS.spreadsheet, "hyperlink").length,
        tables: elements(document, NS.spreadsheet, "tablePart").length,
        drawings: elements(document, NS.spreadsheet, "drawing").length,
        images: drawingRelationships.filter((relationship) => /\/image$/i.test(relationship.type)).length,
        charts: drawingRelationships.filter((relationship) => /\/chart$/i.test(relationship.type)).length,
        comments: relationships.filter((relationship) => /\/comments$/i.test(relationship.type)).length,
        threadedComments: relationships.filter((relationship) => /threadedComment/i.test(relationship.type)).length,
        pivotTables: relationships.filter((relationship) => /\/pivotTable$/i.test(relationship.type)).length,
        slicers: relationships.filter((relationship) => /slicer/i.test(relationship.type)).length,
        timelines: relationships.filter((relationship) => /timeline/i.test(relationship.type)).length,
        sparklines: localNameCount(document, "sparklineGroup"),
        shapes: drawingRelationships.filter((relationship) => /\/image$|\/chart$/i.test(relationship.type) === false).length,
        formControls: elements(document, NS.spreadsheet, "controls").length,
        embeddedObjects: elements(document, NS.spreadsheet, "oleObject").length,
        autoFilter: elements(document, NS.spreadsheet, "autoFilter").length > 0,
        sheetProtection: { enabled: elements(document, NS.spreadsheet, "sheetProtection").length > 0, settings: redactedAttributes(elements(document, NS.spreadsheet, "sheetProtection")[0]) },
        printSettings: {
          printOptions: redactedAttributes(elements(document, NS.spreadsheet, "printOptions")[0]),
          pageMargins: redactedAttributes(elements(document, NS.spreadsheet, "pageMargins")[0]),
          pageSetup: redactedAttributes(elements(document, NS.spreadsheet, "pageSetup")[0]),
          headerFooter: elements(document, NS.spreadsheet, "headerFooter").length > 0,
        },
      };
    });
    const functions = [...functionCounts].sort(([left], [right]) => left.localeCompare(right)).map(([name, count]) => ({ name, count, future: name.startsWith("_XLFN.") || name.startsWith("_XLWS.") }));
    const calcPr = elements(this.workbookDocument, NS.spreadsheet, "calcPr")[0];
    const workbookProtection = elements(this.workbookDocument, NS.spreadsheet, "workbookProtection")[0];
    const vbaParts = manifest.parts.filter((part) => /vbaProject/i.test(part.contentType ?? "") || /vbaProject/i.test(part.path));
    const signatureParts = manifest.parts.filter((part) => /signature/i.test(part.contentType ?? "") || /vbaProjectSignature/i.test(part.path));
    return {
      workbookPart: this.pkg.workbookPart,
      workbookContentType: this.pkg.contentTypeFor(this.pkg.workbookPart),
      sheets,
      definedNames,
      calculation: {
        settings: redactedAttributes(calcPr),
        formulaCount,
        arrayFormulaCount,
        sharedFormulaCount,
        dynamicFormulaCount,
        externalFormulaCount,
        cachedFormulaResultCount,
        missingCachedResultCount: formulaCount - cachedFormulaResultCount,
        functions,
        futureFunctionNames: functions.filter((item) => item.future).map((item) => item.name),
        unsupportedFunctionNames: functions.map((item) => item.name),
        localEvaluator: "none",
        cachedResultPolicy: "preserve-existing; never recalculate or refresh external data",
        unsupportedFunctionPolicy: "all functions are preserved and inventoried because the OOXML backend has no local evaluator; _xlfn/_xlws markers are reported separately",
      },
      workbookProtection: { enabled: Boolean(workbookProtection), settings: redactedAttributes(workbookProtection) },
      sharedStringCount: this.sharedStrings.length,
      partCount: manifest.parts.length,
      protectedParts: manifest.protectedParts,
      externalRelationships: this.pkg.relationships.filter((relationship) => relationship.targetMode?.toLowerCase() === "external"),
      vba: {
        present: vbaParts.length > 0,
        parts: vbaParts.map((part) => ({ path: part.path, sha256: part.sha256, bytes: part.bytes })),
        signatures: signatureParts.map((part) => ({ path: part.path, sha256: part.sha256, bytes: part.bytes })),
        moduleMetadata: "unavailable-with-ooxml-safe",
        projectProtection: "unavailable-with-ooxml-safe",
        policy: "preserve-inventory-verify-only; never execute or extract source",
      },
      featurePolicies: {
        pivotTables: "preserve-only",
        pivotCaches: "preserve-only",
        slicers: "preserve-only",
        timelines: "preserve-only",
        sparklines: "preserve-only",
        shapes: "preserve-only",
        formControls: "preserve-only",
        activeX: "protected-preserve-only",
        embeddedObjects: "protected-preserve-only",
        threadedComments: "preserve-only",
        externalConnections: "preserve-only-never-refresh",
      },
      memoryPolicy: {
        ...this.pkg.archive.storageStats(),
        strategy: "lazy bounded ZIP inflation with focused worksheet reads; edit clones intentionally materialize all parts before mutation",
        maxArchiveBytes: this.limits.maxArchiveBytes,
        maxUncompressedBytes: this.limits.maxUncompressedBytes,
        maxEntryBytes: this.limits.maxEntryBytes,
        maxCellsPerRead: this.limits.maxCellsPerRead,
      },
      manifest,
    };
  }
}
