import type { WorkbookOperation } from "../contracts.ts";
import { assertNotAborted, fail } from "../errors.ts";
import { OoxmlPackage, type IntegrityComparison } from "./package.ts";
import { WorkbookModel, type SheetInfo } from "./workbook.ts";
import {
  assertSafeFormula,
  columnToNumber,
  formatCellReference,
  formatRange,
  iterateRange,
  parseCellReference,
  parseRange,
  rangeCellCount,
  rangesOverlap,
  translateFormula,
  type RangeBounds,
} from "./cell-ref.ts";
import { NS, appendElement, directChildren, elements, firstDirectChild, serializeXml } from "./xml.ts";
import { validatePackage, type PackageValidation } from "./validate.ts";
import { assertRangeOutsideComplexFormulas } from "./formula-policy.ts";
import { applyAdvancedWorksheetOperation, type AdvancedEditContext } from "./advanced-worksheet.ts";
import { applyAdvancedPackageOperation } from "./advanced-package.ts";
import { applyAdvancedObjectOperation } from "./advanced-objects.ts";

const WORKSHEET_CHILD_ORDER = [
  "sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData", "sheetCalcPr", "sheetProtection",
  "protectedRanges", "scenarios", "autoFilter", "sortState", "dataConsolidate", "customSheetViews", "mergeCells",
  "phoneticPr", "conditionalFormatting", "dataValidations", "hyperlinks", "printOptions", "pageMargins", "pageSetup",
  "headerFooter", "rowBreaks", "colBreaks", "customProperties", "cellWatches", "ignoredErrors", "smartTags", "drawing",
  "legacyDrawing", "legacyDrawingHF", "picture", "oleObjects", "controls", "webPublishItems", "tableParts", "extLst",
];

export type EditApplication = {
  pkg: OoxmlPackage;
  bytes: Uint8Array;
  changedParts: string[];
  allowedChangedParts: string[];
  operationSummary: Array<{ index: number; type: string; sheet: string; target: string; cells?: number }>;
  warnings: string[];
  integrity: IntegrityComparison;
  validation: PackageValidation;
};

function directElementChildren(parent: Element): Element[] {
  return Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1);
}

function orderedWorksheetChild(document: Document, name: string): Element {
  const root = document.documentElement;
  const existing = firstDirectChild(root, NS.spreadsheet, name);
  if (existing) return existing;
  const child = document.createElementNS(NS.spreadsheet, name);
  const desired = WORKSHEET_CHILD_ORDER.indexOf(name);
  const before = directElementChildren(root).find((candidate) => WORKSHEET_CHILD_ORDER.indexOf(candidate.localName) > desired);
  if (before) root.insertBefore(child, before);
  else root.appendChild(child);
  return child;
}

function numericAttribute(element: Element, name: string, fallback = 0): number {
  const value = Number(element.getAttribute(name));
  return Number.isFinite(value) ? value : fallback;
}

function findCell(row: Element, column: number): Element | undefined {
  return directChildren(row, NS.spreadsheet, "c").find((cell) => {
    const reference = cell.getAttribute("r");
    return reference ? parseCellReference(reference).column === column : false;
  });
}

function getOrCreateRow(document: Document, sheetData: Element, rowNumber: number): Element {
  const rows = directChildren(sheetData, NS.spreadsheet, "row");
  const existing = rows.find((row) => numericAttribute(row, "r") === rowNumber);
  if (existing) return existing;
  const row = document.createElementNS(NS.spreadsheet, "row");
  row.setAttribute("r", String(rowNumber));
  const before = rows.find((candidate) => numericAttribute(candidate, "r") > rowNumber);
  if (before) sheetData.insertBefore(row, before);
  else sheetData.appendChild(row);
  return row;
}

function getOrCreateCell(document: Document, sheetData: Element, rowNumber: number, column: number): Element {
  const row = getOrCreateRow(document, sheetData, rowNumber);
  const existing = findCell(row, column);
  if (existing) return existing;
  const cell = document.createElementNS(NS.spreadsheet, "c");
  cell.setAttribute("r", formatCellReference(rowNumber, column));
  const before = directChildren(row, NS.spreadsheet, "c").find((candidate) => {
    const reference = candidate.getAttribute("r");
    return reference ? parseCellReference(reference).column > column : false;
  });
  if (before) row.insertBefore(cell, before);
  else row.appendChild(cell);
  return cell;
}

function clearCellContents(cell: Element): void {
  for (const name of ["f", "v", "is"]) {
    for (const child of directChildren(cell, NS.spreadsheet, name)) cell.removeChild(child);
  }
  cell.removeAttribute("t");
}

function removeCellIfEmpty(cell: Element): void {
  if (cell.hasAttribute("s") || cell.hasAttribute("cm") || cell.hasAttribute("vm") || cell.hasAttribute("ph") || directElementChildren(cell).length > 0) return;
  const row = cell.parentNode as Element | null;
  row?.removeChild(cell);
  if (row && directChildren(row, NS.spreadsheet, "c").length === 0 && row.attributes.length === 1 && row.hasAttribute("r")) row.parentNode?.removeChild(row);
}

function setCellValue(document: Document, cell: Element, value: string | number | boolean | null): void {
  clearCellContents(cell);
  if (value === null) {
    removeCellIfEmpty(cell);
    return;
  }
  if (typeof value === "string") {
    cell.setAttribute("t", "inlineStr");
    const inline = appendElement(document, cell, NS.spreadsheet, "is");
    const text = appendElement(document, inline, NS.spreadsheet, "t");
    if (/^\s|\s$/.test(value)) text.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
    text.appendChild(document.createTextNode(value));
    return;
  }
  const stored = appendElement(document, cell, NS.spreadsheet, "v");
  if (typeof value === "boolean") {
    cell.setAttribute("t", "b");
    stored.appendChild(document.createTextNode(value ? "1" : "0"));
  } else {
    if (!Number.isFinite(value)) fail("INVALID_ARGUMENT", `Excel numeric value must be finite: ${value}.`);
    stored.appendChild(document.createTextNode(String(value)));
  }
}

function setCellFormula(document: Document, cell: Element, formulaInput: string): void {
  const formula = assertSafeFormula(formulaInput);
  clearCellContents(cell);
  const element = appendElement(document, cell, NS.spreadsheet, "f");
  element.appendChild(document.createTextNode(formula));
}

function cellAt(document: Document, row: number, column: number): Element | undefined {
  const sheetData = elements(document, NS.spreadsheet, "sheetData")[0];
  if (!sheetData) return undefined;
  const rowElement = directChildren(sheetData, NS.spreadsheet, "row").find((candidate) => numericAttribute(candidate, "r") === row);
  return rowElement ? findCell(rowElement, column) : undefined;
}

function copyCellPayload(document: Document, target: Element, source: Element | undefined, include: "all" | "values" | "styles", rowDelta: number, columnDelta: number): void {
  if (include === "all" || include === "values") {
    clearCellContents(target);
    if (source) {
      const type = source.getAttribute("t");
      if (type) target.setAttribute("t", type);
      for (const name of ["f", "v", "is"]) {
        for (const child of directChildren(source, NS.spreadsheet, name)) {
          const clone = child.cloneNode(true) as Element;
          if (name === "f") {
            const formulaType = clone.getAttribute("t");
            if (formulaType && formulaType !== "normal") fail("UNSUPPORTED_FEATURE", `Cannot safely copy ${formulaType} formula cells.`);
            clone.textContent = translateFormula(clone.textContent ?? "", rowDelta, columnDelta);
          }
          target.appendChild(clone);
        }
      }
    }
  }
  if (include === "all" || include === "styles") {
    const style = source?.getAttribute("s");
    if (style) target.setAttribute("s", style);
    else target.removeAttribute("s");
  }
  removeCellIfEmpty(target);
}

function recalculateDimension(document: Document): void {
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = 1;
  let minColumn = Number.POSITIVE_INFINITY;
  let maxColumn = 1;
  const include = (bounds: RangeBounds) => {
    minRow = Math.min(minRow, bounds.startRow);
    maxRow = Math.max(maxRow, bounds.endRow);
    minColumn = Math.min(minColumn, bounds.startColumn);
    maxColumn = Math.max(maxColumn, bounds.endColumn);
  };
  for (const cell of elements(document, NS.spreadsheet, "c")) {
    const reference = cell.getAttribute("r");
    if (reference) {
      const address = parseCellReference(reference);
      include({ startRow: address.row, endRow: address.row, startColumn: address.column, endColumn: address.column });
    }
  }
  for (const merge of elements(document, NS.spreadsheet, "mergeCell")) {
    const reference = merge.getAttribute("ref");
    if (reference) include(parseRange(reference));
  }
  const dimension = orderedWorksheetChild(document, "dimension");
  dimension.setAttribute("ref", Number.isFinite(minRow) ? formatRange({ startRow: minRow, endRow: maxRow, startColumn: minColumn, endColumn: maxColumn }) : "A1");
}

function applyColumnWidth(document: Document, start: number, end: number, width: number): void {
  const cols = orderedWorksheetChild(document, "cols");
  const existing = directChildren(cols, NS.spreadsheet, "col");
  const intervals = existing.map((element) => ({ element, min: numericAttribute(element, "min"), max: numericAttribute(element, "max") }));
  const sorted = [...intervals].sort((a, b) => a.min - b.min);
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index].min <= sorted[index - 1].max) fail("UNSUPPORTED_FEATURE", "Overlapping existing column definitions cannot be edited safely.");
  }
  const replacements: Element[] = [];
  const covered: Array<{ min: number; max: number }> = [];
  const resized = (source: Element | undefined, min: number, max: number): Element => {
    const element = source ? source.cloneNode(true) as Element : document.createElementNS(NS.spreadsheet, "col");
    element.setAttribute("min", String(min));
    element.setAttribute("max", String(max));
    element.setAttribute("width", String(width));
    element.setAttribute("customWidth", "1");
    return element;
  };
  for (const interval of intervals) {
    if (interval.max < start || interval.min > end) {
      replacements.push(interval.element.cloneNode(true) as Element);
      continue;
    }
    if (interval.min < start) {
      const left = interval.element.cloneNode(true) as Element;
      left.setAttribute("max", String(start - 1));
      replacements.push(left);
    }
    const overlap = { min: Math.max(start, interval.min), max: Math.min(end, interval.max) };
    replacements.push(resized(interval.element, overlap.min, overlap.max));
    covered.push(overlap);
    if (interval.max > end) {
      const right = interval.element.cloneNode(true) as Element;
      right.setAttribute("min", String(end + 1));
      replacements.push(right);
    }
  }
  let cursor = start;
  for (const interval of covered.sort((a, b) => a.min - b.min)) {
    if (cursor < interval.min) replacements.push(resized(undefined, cursor, interval.min - 1));
    cursor = Math.max(cursor, interval.max + 1);
  }
  if (cursor <= end) replacements.push(resized(undefined, cursor, end));
  replacements.sort((a, b) => numericAttribute(a, "min") - numericAttribute(b, "min"));
  while (cols.firstChild) cols.removeChild(cols.firstChild);
  for (const item of replacements) cols.appendChild(item);
}

function mergeCells(document: Document, bounds: RangeBounds): void {
  const normalized = formatRange(bounds);
  const container = orderedWorksheetChild(document, "mergeCells");
  const existing = directChildren(container, NS.spreadsheet, "mergeCell");
  for (const merge of existing) {
    const reference = merge.getAttribute("ref");
    if (!reference) continue;
    const other = parseRange(reference);
    if (formatRange(other) === normalized) return;
    if (rangesOverlap(bounds, other)) fail("INVALID_ARGUMENT", `Merge ${normalized} overlaps existing merge ${formatRange(other)}.`);
  }
  const merge = document.createElementNS(NS.spreadsheet, "mergeCell");
  merge.setAttribute("ref", normalized);
  container.appendChild(merge);
  container.setAttribute("count", String(existing.length + 1));
}

function unmergeCells(document: Document, bounds: RangeBounds): void {
  const normalized = formatRange(bounds);
  const container = elements(document, NS.spreadsheet, "mergeCells")[0];
  if (!container) return;
  const matches = directChildren(container, NS.spreadsheet, "mergeCell").filter((merge) => {
    const reference = merge.getAttribute("ref");
    return reference && formatRange(parseRange(reference)) === normalized;
  });
  for (const match of matches) container.removeChild(match);
  const remaining = directChildren(container, NS.spreadsheet, "mergeCell").length;
  if (remaining === 0) container.parentNode?.removeChild(container);
  else container.setAttribute("count", String(remaining));
}

export function applyWorkbookOperations(baseline: OoxmlPackage, filePath: string, operations: WorkbookOperation[], signal?: AbortSignal): EditApplication {
  const pkg = baseline.clone();
  const model = new WorkbookModel(pkg);
  const documents = new Map<string, Document>();
  const changedSheets = new Set<string>();
  const allowedChangedParts = new Set<string>();
  const operationSummary: EditApplication["operationSummary"] = [];
  const warnings: string[] = [];
  let touchedCells = 0;
  let workbookChanged = false;

  const documentFor = (sheetName: string): { sheet: SheetInfo; document: Document; sheetData: Element } => {
    const sheet = model.sheet(sheetName);
    let document = documents.get(sheet.partPath);
    if (!document) {
      document = model.sheetDocument(sheet);
      documents.set(sheet.partPath, document);
    }
    const sheetData = elements(document, NS.spreadsheet, "sheetData")[0];
    if (!sheetData) fail("INVALID_PACKAGE", `Worksheet ${sheet.name} has no sheetData element.`);
    return { sheet, document, sheetData };
  };

  const advancedContext: AdvancedEditContext = {
    baseline,
    pkg,
    model,
    documents,
    changedSheets,
    allowedChangedParts,
    warnings,
    documentFor,
    markWorkbookChanged: () => { workbookChanged = true; },
  };

  for (let index = 0; index < operations.length; index++) {
    assertNotAborted(signal);
    const operation = operations[index];
    const advanced = applyAdvancedWorksheetOperation(operation, advancedContext)
      ?? applyAdvancedPackageOperation(operation, advancedContext)
      ?? applyAdvancedObjectOperation(operation, advancedContext);
    if (advanced) {
      if (advanced.cells !== undefined) touchedCells += advanced.cells;
      if (touchedCells > model.limits.maxCellsPerEdit) fail("LIMIT_EXCEEDED", `Edit touches more than ${model.limits.maxCellsPerEdit} cells.`);
      operationSummary.push({ index, type: operation.type, sheet: advanced.sheet ?? "(workbook)", target: advanced.target, ...(advanced.cells !== undefined ? { cells: advanced.cells } : {}) });
      continue;
    }
    if (!("sheet" in operation) || typeof operation.sheet !== "string") fail("UNSUPPORTED_FEATURE", `Unsupported workbook-level operation: ${operation.type}.`);
    const { sheet, document, sheetData } = documentFor(operation.sheet);
    let target = "";
    let cells: number | undefined;

    if (operation.type === "setValue" || operation.type === "setFormula" || operation.type === "clear" || operation.type === "setStyle") {
      const bounds = parseRange(operation.range);
      cells = rangeCellCount(bounds);
      touchedCells += cells;
      if (operation.type !== "setStyle") assertRangeOutsideComplexFormulas(document, bounds, operation.type);
      for (const address of iterateRange(bounds)) {
        assertNotAborted(signal);
        const cell = getOrCreateCell(document, sheetData, address.row, address.column);
        if (operation.type === "setValue") setCellValue(document, cell, operation.value);
        else if (operation.type === "setFormula") setCellFormula(document, cell, operation.formula);
        else if (operation.type === "clear") {
          if ((operation.mode ?? "contents") === "all") {
            cell.parentNode?.removeChild(cell);
          } else {
            clearCellContents(cell);
            removeCellIfEmpty(cell);
          }
        } else {
          if (!model.styles || !model.stylesPart) fail("UNSUPPORTED_FEATURE", "Workbook has no editable styles part.");
          const baseStyle = Number(cell.getAttribute("s") ?? 0);
          cell.setAttribute("s", String(model.styles.applyPatch(baseStyle, operation.style)));
        }
      }
      target = formatRange(bounds);
    } else if (operation.type === "copyRange" || operation.type === "fillRange") {
      const sourceBounds = parseRange(operation.type === "copyRange" ? operation.sourceRange : operation.sourceCell);
      if (operation.type === "fillRange" && rangeCellCount(sourceBounds) !== 1) fail("INVALID_ARGUMENT", "fillRange sourceCell must identify exactly one cell.");
      const targetBounds = parseRange(operation.targetRange);
      if (operation.type === "copyRange" && (sourceBounds.endRow - sourceBounds.startRow !== targetBounds.endRow - targetBounds.startRow || sourceBounds.endColumn - sourceBounds.startColumn !== targetBounds.endColumn - targetBounds.startColumn)) {
        fail("INVALID_ARGUMENT", "copyRange sourceRange and targetRange must have identical dimensions.");
      }
      const sourceSheetName = operation.type === "copyRange" ? operation.sourceSheet ?? operation.sheet : operation.sheet;
      const sourceDocument = sourceSheetName.toLowerCase() === operation.sheet.toLowerCase() ? document : documentFor(sourceSheetName).document;
      cells = rangeCellCount(targetBounds);
      touchedCells += cells;
      const include = operation.include ?? "all";
      if (include !== "styles") {
        assertRangeOutsideComplexFormulas(sourceDocument, sourceBounds, `${operation.type} source`);
        assertRangeOutsideComplexFormulas(document, targetBounds, `${operation.type} target`);
      }
      const snapshots = new Map<string, Element | undefined>();
      for (const address of iterateRange(sourceBounds)) {
        assertNotAborted(signal);
        snapshots.set(`${address.row}:${address.column}`, cellAt(sourceDocument, address.row, address.column)?.cloneNode(true) as Element | undefined);
      }
      for (const targetAddress of iterateRange(targetBounds)) {
        assertNotAborted(signal);
        const sourceRow = operation.type === "fillRange" ? sourceBounds.startRow : sourceBounds.startRow + (targetAddress.row - targetBounds.startRow);
        const sourceColumn = operation.type === "fillRange" ? sourceBounds.startColumn : sourceBounds.startColumn + (targetAddress.column - targetBounds.startColumn);
        const source = snapshots.get(`${sourceRow}:${sourceColumn}`);
        const targetCell = getOrCreateCell(document, sheetData, targetAddress.row, targetAddress.column);
        copyCellPayload(document, targetCell, source, include, targetAddress.row - sourceRow, targetAddress.column - sourceColumn);
      }
      target = formatRange(targetBounds);
    } else if (operation.type === "setRowHeight") {
      const end = operation.endRow ?? operation.startRow;
      if (end < operation.startRow) fail("INVALID_ARGUMENT", "setRowHeight endRow must be greater than or equal to startRow.");
      for (let rowNumber = operation.startRow; rowNumber <= end; rowNumber++) {
        assertNotAborted(signal);
        const row = getOrCreateRow(document, sheetData, rowNumber);
        row.setAttribute("ht", String(operation.height));
        row.setAttribute("customHeight", "1");
      }
      target = `${operation.startRow}:${end}`;
    } else if (operation.type === "setColumnWidth") {
      const start = columnToNumber(operation.startColumn);
      const end = columnToNumber(operation.endColumn ?? operation.startColumn);
      if (end < start) fail("INVALID_ARGUMENT", "setColumnWidth endColumn must be greater than or equal to startColumn.");
      applyColumnWidth(document, start, end, operation.width);
      target = `${start}:${end}`;
    } else if (operation.type === "merge" || operation.type === "unmerge") {
      const bounds = parseRange(operation.range);
      if (rangeCellCount(bounds) < 2) fail("INVALID_ARGUMENT", `${operation.type} requires a multi-cell range.`);
      if (operation.type === "merge") assertRangeOutsideComplexFormulas(document, bounds, "merge");
      if (operation.type === "merge") mergeCells(document, bounds);
      else unmergeCells(document, bounds);
      target = formatRange(bounds);
    } else {
      fail("UNSUPPORTED_FEATURE", `Unsupported operation: ${operation.type}.`);
    }

    if (touchedCells > model.limits.maxCellsPerEdit) fail("LIMIT_EXCEEDED", `Edit touches more than ${model.limits.maxCellsPerEdit} cells.`);
    changedSheets.add(sheet.partPath);
    operationSummary.push({ index, type: operation.type, sheet: sheet.name, target, ...(cells !== undefined ? { cells } : {}) });
  }

  for (const partPath of changedSheets) {
    const document = documents.get(partPath)!;
    recalculateDimension(document);
    pkg.archive.set(partPath, serializeXml(document));
    allowedChangedParts.add(partPath);
  }
  if (workbookChanged) {
    pkg.archive.set(pkg.workbookPart, serializeXml(model.workbookDocument));
    allowedChangedParts.add(pkg.workbookPart);
  }
  if (model.styles?.changed && model.stylesPart) {
    pkg.archive.set(model.stylesPart, model.styles.toBytes());
    allowedChangedParts.add(model.stylesPart);
  }

  const reopened = OoxmlPackage.fromBytes(pkg.archive.toBytes(), pkg.archive.limits);
  const integrity = baseline.compareIntegrity(reopened, allowedChangedParts);
  const validation = validatePackage(reopened, filePath, baseline, allowedChangedParts);
  if (!integrity.ok || !validation.ok) fail("VALIDATION_FAILED", `Edited workbook failed integrity validation: ${[...integrity.errors, ...validation.errors].join("; ")}`);
  const bytes = reopened.archive.toBytes();
  return {
    pkg: reopened,
    bytes,
    changedParts: integrity.changedParts,
    allowedChangedParts: [...allowedChangedParts].sort(),
    operationSummary,
    warnings,
    integrity,
    validation,
  };
}
