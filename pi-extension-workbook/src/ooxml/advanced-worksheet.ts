import type { FontPatch, WorkbookOperation } from "../contracts.ts";
import { fail } from "../errors.ts";
import type { OoxmlPackage } from "./package.ts";
import type { WorkbookModel, SheetInfo } from "./workbook.ts";
import {
  assertSafeFormula,
  columnToNumber,
  formatCellReference,
  formatRange,
  iterateRange,
  numberToColumn,
  parseCellReference,
  parseRange,
  rangeCellCount,
  rangesOverlap,
  type RangeBounds,
} from "./cell-ref.ts";
import { addRelationship, RELATIONSHIP_TYPES, removeRelationship } from "./package-edit.ts";
import { NS, appendElement, directChildren, elements, firstDirectChild, textContent } from "./xml.ts";
import { assertRangeOutsideComplexFormulas } from "./formula-policy.ts";

const WORKSHEET_CHILD_ORDER = [
  "sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData", "sheetCalcPr", "sheetProtection",
  "protectedRanges", "scenarios", "autoFilter", "sortState", "dataConsolidate", "customSheetViews", "mergeCells",
  "phoneticPr", "conditionalFormatting", "dataValidations", "hyperlinks", "printOptions", "pageMargins", "pageSetup",
  "headerFooter", "rowBreaks", "colBreaks", "customProperties", "cellWatches", "ignoredErrors", "smartTags", "drawing",
  "legacyDrawing", "legacyDrawingHF", "picture", "oleObjects", "controls", "webPublishItems", "tableParts", "extLst",
];

export type SheetDocumentContext = { sheet: SheetInfo; document: Document; sheetData: Element };
export type AdvancedEditContext = {
  baseline: OoxmlPackage;
  pkg: OoxmlPackage;
  model: WorkbookModel;
  documents: Map<string, Document>;
  changedSheets: Set<string>;
  allowedChangedParts: Set<string>;
  warnings: string[];
  documentFor(sheetName: string): SheetDocumentContext;
  markWorkbookChanged(): void;
};

export type AdvancedOperationResult = { target: string; sheet?: string; cells?: number };

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

function booleanAttribute(value: boolean): string {
  return value ? "1" : "0";
}

function normalizeColor(color: string): string {
  const value = color.replace(/^#/, "").toUpperCase();
  if (!/^(?:[A-F0-9]{6}|[A-F0-9]{8})$/.test(value)) fail("INVALID_ARGUMENT", `Invalid RGB/ARGB color: ${color}.`);
  return value.length === 6 ? `FF${value}` : value;
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
  for (const name of ["f", "v", "is"]) for (const child of directChildren(cell, NS.spreadsheet, name)) cell.removeChild(child);
  cell.removeAttribute("t");
}

function appendRunFont(document: Document, parent: Element, font: FontPatch): void {
  const valueChild = (name: string, value: string | number | undefined) => {
    if (value === undefined) return;
    const child = appendElement(document, parent, NS.spreadsheet, name);
    child.setAttribute("val", String(value));
  };
  const boolChild = (name: string, value: boolean | undefined) => {
    if (value) appendElement(document, parent, NS.spreadsheet, name);
  };
  valueChild("rFont", font.name);
  valueChild("sz", font.size);
  boolChild("b", font.bold);
  boolChild("i", font.italic);
  boolChild("strike", font.strike);
  boolChild("outline", font.outline);
  boolChild("shadow", font.shadow);
  boolChild("condense", font.condense);
  boolChild("extend", font.extend);
  if (font.underline) {
    const underline = appendElement(document, parent, NS.spreadsheet, "u");
    if (font.underline !== true && font.underline !== "single") underline.setAttribute("val", font.underline);
  }
  valueChild("vertAlign", font.verticalAlign);
  valueChild("family", font.family);
  valueChild("charset", font.charset);
  if (font.scheme && font.scheme !== "none") valueChild("scheme", font.scheme);
  if (font.color) appendElement(document, parent, NS.spreadsheet, "color").setAttribute("rgb", normalizeColor(font.color));
}

function setRichText(document: Document, cell: Element, runs: Array<{ text: string; font?: FontPatch }>): void {
  clearCellContents(cell);
  cell.setAttribute("t", "inlineStr");
  const inline = appendElement(document, cell, NS.spreadsheet, "is");
  for (const runInput of runs) {
    const run = appendElement(document, inline, NS.spreadsheet, "r");
    if (runInput.font) appendRunFont(document, appendElement(document, run, NS.spreadsheet, "rPr"), runInput.font);
    const text = appendElement(document, run, NS.spreadsheet, "t");
    if (/^\s|\s$/.test(runInput.text)) text.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
    text.appendChild(document.createTextNode(runInput.text));
  }
}

function setRowProperties(document: Document, sheetData: Element, start: number, end: number, operation: Extract<WorkbookOperation, { type: "setRowProperties" }>): void {
  if (end < start) fail("INVALID_ARGUMENT", "setRowProperties endRow must be greater than or equal to startRow.");
  for (let rowNumber = start; rowNumber <= end; rowNumber++) {
    const row = getOrCreateRow(document, sheetData, rowNumber);
    if (operation.height !== undefined) {
      row.setAttribute("ht", String(operation.height));
      row.setAttribute("customHeight", "1");
    }
    if (operation.hidden !== undefined) row.setAttribute("hidden", booleanAttribute(operation.hidden));
    if (operation.outlineLevel !== undefined) row.setAttribute("outlineLevel", String(operation.outlineLevel));
    if (operation.collapsed !== undefined) row.setAttribute("collapsed", booleanAttribute(operation.collapsed));
  }
}

function applyColumnProperties(document: Document, start: number, end: number, patch: { width?: number; hidden?: boolean; outlineLevel?: number; collapsed?: boolean; bestFit?: boolean }): void {
  const cols = orderedWorksheetChild(document, "cols");
  const existing = directChildren(cols, NS.spreadsheet, "col");
  const intervals = existing.map((element) => ({ element, min: numericAttribute(element, "min"), max: numericAttribute(element, "max") }));
  const sorted = [...intervals].sort((a, b) => a.min - b.min);
  for (let index = 1; index < sorted.length; index++) if (sorted[index].min <= sorted[index - 1].max) fail("UNSUPPORTED_FEATURE", "Overlapping existing column definitions cannot be edited safely.");
  const replacements: Element[] = [];
  const covered: Array<{ min: number; max: number }> = [];
  const patched = (source: Element | undefined, min: number, max: number): Element => {
    const element = source ? source.cloneNode(true) as Element : document.createElementNS(NS.spreadsheet, "col");
    element.setAttribute("min", String(min));
    element.setAttribute("max", String(max));
    if (patch.width !== undefined) {
      element.setAttribute("width", String(patch.width));
      element.setAttribute("customWidth", "1");
    }
    if (patch.hidden !== undefined) element.setAttribute("hidden", booleanAttribute(patch.hidden));
    if (patch.outlineLevel !== undefined) element.setAttribute("outlineLevel", String(patch.outlineLevel));
    if (patch.collapsed !== undefined) element.setAttribute("collapsed", booleanAttribute(patch.collapsed));
    if (patch.bestFit !== undefined) element.setAttribute("bestFit", booleanAttribute(patch.bestFit));
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
    replacements.push(patched(interval.element, overlap.min, overlap.max));
    covered.push(overlap);
    if (interval.max > end) {
      const right = interval.element.cloneNode(true) as Element;
      right.setAttribute("min", String(end + 1));
      replacements.push(right);
    }
  }
  let cursor = start;
  for (const interval of covered.sort((a, b) => a.min - b.min)) {
    if (cursor < interval.min) replacements.push(patched(undefined, cursor, interval.min - 1));
    cursor = Math.max(cursor, interval.max + 1);
  }
  if (cursor <= end) replacements.push(patched(undefined, cursor, end));
  replacements.sort((a, b) => numericAttribute(a, "min") - numericAttribute(b, "min"));
  while (cols.firstChild) cols.removeChild(cols.firstChild);
  for (const item of replacements) cols.appendChild(item);
}

function cellDisplayLength(model: WorkbookModel, cell: Element): { width: number; lines: number } {
  const data = model.cellData(cell);
  const value = data?.value === null || data?.value === undefined ? "" : String(data.value);
  const lines = value.split(/\r?\n/);
  return { width: Math.max(0, ...lines.map((line) => [...line].length)), lines: Math.max(1, lines.length) };
}

function autoFit(model: WorkbookModel, document: Document, bounds: RangeBounds, rows: boolean, columns: boolean, minWidth: number, maxWidth: number): void {
  const sheetData = elements(document, NS.spreadsheet, "sheetData")[0];
  if (!sheetData) return;
  const columnWidths = new Map<number, number>();
  const rowLines = new Map<number, number>();
  for (const cell of elements(sheetData, NS.spreadsheet, "c")) {
    const reference = cell.getAttribute("r");
    if (!reference) continue;
    const address = parseCellReference(reference);
    if (address.row < bounds.startRow || address.row > bounds.endRow || address.column < bounds.startColumn || address.column > bounds.endColumn) continue;
    const measure = cellDisplayLength(model, cell);
    columnWidths.set(address.column, Math.max(columnWidths.get(address.column) ?? 0, measure.width));
    rowLines.set(address.row, Math.max(rowLines.get(address.row) ?? 1, measure.lines));
  }
  if (columns) for (let column = bounds.startColumn; column <= bounds.endColumn; column++) applyColumnProperties(document, column, column, { width: Math.min(maxWidth, Math.max(minWidth, (columnWidths.get(column) ?? 0) * 1.1 + 2)), bestFit: true });
  if (rows) for (let row = bounds.startRow; row <= bounds.endRow; row++) {
    const element = getOrCreateRow(document, sheetData, row);
    element.setAttribute("ht", String(Math.min(409, Math.max(15, (rowLines.get(row) ?? 1) * 15))));
    element.setAttribute("customHeight", "1");
  }
}

function setFreezePanes(document: Document, rows: number, columns: number): void {
  const views = orderedWorksheetChild(document, "sheetViews");
  const view = firstDirectChild(views, NS.spreadsheet, "sheetView") ?? appendElement(document, views, NS.spreadsheet, "sheetView");
  if (!view.hasAttribute("workbookViewId")) view.setAttribute("workbookViewId", "0");
  for (const pane of directChildren(view, NS.spreadsheet, "pane")) view.removeChild(pane);
  if (rows === 0 && columns === 0) return;
  const pane = document.createElementNS(NS.spreadsheet, "pane");
  if (columns > 0) pane.setAttribute("xSplit", String(columns));
  if (rows > 0) pane.setAttribute("ySplit", String(rows));
  pane.setAttribute("topLeftCell", formatCellReference(rows + 1, columns + 1));
  pane.setAttribute("activePane", rows > 0 && columns > 0 ? "bottomRight" : rows > 0 ? "bottomLeft" : "topRight");
  pane.setAttribute("state", "frozen");
  view.insertBefore(pane, view.firstChild);
}

function exactRangeElement(document: Document, name: string, range: string): Element | undefined {
  return elements(document, NS.spreadsheet, name).find((item) => item.getAttribute("sqref")?.trim() === range);
}

function assertNoOverlappingSqref(document: Document, name: string, bounds: RangeBounds, exact?: Element): void {
  for (const item of elements(document, NS.spreadsheet, name)) {
    if (item === exact) continue;
    for (const token of (item.getAttribute("sqref") ?? "").trim().split(/\s+/).filter(Boolean)) {
      if (rangesOverlap(bounds, parseRange(token))) fail("UNSUPPORTED_FEATURE", `${name} operation overlaps existing non-identical range ${token}; split/normalization is required before editing.`);
    }
  }
}

function setConditionalFormatting(operation: Extract<WorkbookOperation, { type: "setConditionalFormatting" }>, context: SheetDocumentContext, model: WorkbookModel): void {
  const normalized = formatRange(parseRange(operation.range));
  const existing = exactRangeElement(context.document, "conditionalFormatting", normalized);
  assertNoOverlappingSqref(context.document, "conditionalFormatting", parseRange(normalized), existing);
  const container = operation.mode === "append" && existing ? existing : (() => {
    if (existing) existing.parentNode?.removeChild(existing);
    const created = context.document.createElementNS(NS.spreadsheet, "conditionalFormatting");
    created.setAttribute("sqref", normalized);
    const root = context.document.documentElement;
    const before = directElementChildren(root).find((candidate) => WORKSHEET_CHILD_ORDER.indexOf(candidate.localName) > WORKSHEET_CHILD_ORDER.indexOf("conditionalFormatting"));
    if (before) root.insertBefore(created, before); else root.appendChild(created);
    return created;
  })();
  const usedPriorities = elements(context.document, NS.spreadsheet, "cfRule").map((rule) => Number(rule.getAttribute("priority"))).filter(Number.isFinite);
  let nextPriority = Math.max(0, ...usedPriorities) + 1;
  for (const ruleInput of operation.rules) {
    if (ruleInput.type === "cellIs" && !ruleInput.operator) fail("INVALID_ARGUMENT", "cellIs conditional formatting requires operator.");
    if (!model.styles || !model.stylesPart) fail("UNSUPPORTED_FEATURE", "Conditional formatting styles require an editable styles part.");
    const rule = appendElement(context.document, container, NS.spreadsheet, "cfRule");
    rule.setAttribute("type", ruleInput.type);
    rule.setAttribute("priority", String(ruleInput.priority ?? nextPriority++));
    if (ruleInput.operator) rule.setAttribute("operator", ruleInput.operator);
    if (ruleInput.stopIfTrue !== undefined) rule.setAttribute("stopIfTrue", booleanAttribute(ruleInput.stopIfTrue));
    if (ruleInput.style) rule.setAttribute("dxfId", String(model.styles.addDifferentialStyle(ruleInput.style)));
    for (const formula of ruleInput.formulas) {
      const element = appendElement(context.document, rule, NS.spreadsheet, "formula");
      element.appendChild(context.document.createTextNode(assertSafeFormula(formula)));
    }
  }
}

function clearConditionalFormatting(operation: Extract<WorkbookOperation, { type: "clearConditionalFormatting" }>, document: Document): void {
  const normalized = formatRange(parseRange(operation.range));
  const exact = exactRangeElement(document, "conditionalFormatting", normalized);
  assertNoOverlappingSqref(document, "conditionalFormatting", parseRange(normalized), exact);
  exact?.parentNode?.removeChild(exact);
}

function setDataValidation(operation: Extract<WorkbookOperation, { type: "setDataValidation" }>, document: Document): void {
  const normalized = formatRange(parseRange(operation.range));
  const container = orderedWorksheetChild(document, "dataValidations");
  const existing = directChildren(container, NS.spreadsheet, "dataValidation").find((item) => item.getAttribute("sqref")?.trim() === normalized);
  for (const item of directChildren(container, NS.spreadsheet, "dataValidation")) {
    if (item === existing) continue;
    for (const token of (item.getAttribute("sqref") ?? "").split(/\s+/).filter(Boolean)) if (rangesOverlap(parseRange(token), parseRange(normalized))) fail("UNSUPPORTED_FEATURE", `Data-validation operation overlaps existing non-identical range ${token}.`);
  }
  const validation = existing ?? appendElement(document, container, NS.spreadsheet, "dataValidation");
  while (validation.firstChild) validation.removeChild(validation.firstChild);
  for (const attribute of Array.from(validation.attributes)) validation.removeAttributeNode(attribute);
  validation.setAttribute("sqref", normalized);
  validation.setAttribute("type", operation.validationType);
  if (operation.operator) validation.setAttribute("operator", operation.operator);
  for (const [name, value] of Object.entries({ allowBlank: operation.allowBlank, showInputMessage: operation.showInputMessage, showErrorMessage: operation.showErrorMessage })) if (value !== undefined) validation.setAttribute(name, booleanAttribute(value));
  for (const [name, value] of Object.entries({ promptTitle: operation.promptTitle, prompt: operation.prompt, errorTitle: operation.errorTitle, error: operation.error, errorStyle: operation.errorStyle })) if (value !== undefined) validation.setAttribute(name, value);
  for (const [name, value] of [["formula1", operation.formula1], ["formula2", operation.formula2]] as const) if (value !== undefined) {
    const element = appendElement(document, validation, NS.spreadsheet, name);
    element.appendChild(document.createTextNode(assertSafeFormula(value)));
  }
  container.setAttribute("count", String(directChildren(container, NS.spreadsheet, "dataValidation").length));
}

function clearDataValidation(operation: Extract<WorkbookOperation, { type: "clearDataValidation" }>, document: Document): void {
  const normalized = formatRange(parseRange(operation.range));
  const container = firstDirectChild(document.documentElement, NS.spreadsheet, "dataValidations");
  if (!container) return;
  const exact = directChildren(container, NS.spreadsheet, "dataValidation").find((item) => item.getAttribute("sqref")?.trim() === normalized);
  for (const item of directChildren(container, NS.spreadsheet, "dataValidation")) {
    if (item === exact) continue;
    for (const token of (item.getAttribute("sqref") ?? "").split(/\s+/).filter(Boolean)) if (rangesOverlap(parseRange(token), parseRange(normalized))) fail("UNSUPPORTED_FEATURE", `Data-validation removal overlaps existing non-identical range ${token}.`);
  }
  exact?.parentNode?.removeChild(exact);
  const remaining = directChildren(container, NS.spreadsheet, "dataValidation").length;
  if (remaining === 0) container.parentNode?.removeChild(container); else container.setAttribute("count", String(remaining));
}

function setSort(operation: Extract<WorkbookOperation, { type: "setSort" }>, document: Document): void {
  const bounds = parseRange(operation.range);
  const key = parseRange(operation.key);
  if (key.startRow < bounds.startRow || key.endRow > bounds.endRow || key.startColumn < bounds.startColumn || key.endColumn > bounds.endColumn) fail("INVALID_ARGUMENT", "Sort key must be contained in sort range.");
  const existing = firstDirectChild(document.documentElement, NS.spreadsheet, "sortState");
  if (existing) existing.parentNode?.removeChild(existing);
  const state = orderedWorksheetChild(document, "sortState");
  state.setAttribute("ref", formatRange(bounds));
  if (operation.caseSensitive !== undefined) state.setAttribute("caseSensitive", booleanAttribute(operation.caseSensitive));
  const condition = appendElement(document, state, NS.spreadsheet, "sortCondition");
  condition.setAttribute("ref", formatRange(key));
  if (operation.descending !== undefined) condition.setAttribute("descending", booleanAttribute(operation.descending));
}

function legacyPasswordHash(password: string): string {
  let hash = 0;
  for (let index = password.length - 1; index >= 0; index--) {
    hash = ((hash >> 14) & 1) | ((hash << 1) & 0x7fff);
    hash ^= password.charCodeAt(index);
  }
  hash = ((hash >> 14) & 1) | ((hash << 1) & 0x7fff);
  hash ^= password.length;
  hash ^= 0xce4b;
  return (hash & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

function setSheetProtection(operation: Extract<WorkbookOperation, { type: "setSheetProtection" }>, document: Document, warnings: string[]): void {
  const root = document.documentElement;
  const existing = firstDirectChild(root, NS.spreadsheet, "sheetProtection");
  if (!operation.enabled) {
    existing?.parentNode?.removeChild(existing);
    warnings.push("Sheet protection was explicitly disabled; this is a destructive protection change.");
    return;
  }
  const protection = existing ?? orderedWorksheetChild(document, "sheetProtection");
  for (const attribute of Array.from(protection.attributes)) protection.removeAttributeNode(attribute);
  protection.setAttribute("sheet", "1");
  if (operation.password !== undefined) protection.setAttribute("password", legacyPasswordHash(operation.password));
  for (const [name, value] of Object.entries({
    selectLockedCells: operation.selectLockedCells,
    selectUnlockedCells: operation.selectUnlockedCells,
    formatCells: operation.formatCells,
    formatColumns: operation.formatColumns,
    formatRows: operation.formatRows,
    insertColumns: operation.insertColumns,
    insertRows: operation.insertRows,
    deleteColumns: operation.deleteColumns,
    deleteRows: operation.deleteRows,
    sort: operation.sort,
    autoFilter: operation.autoFilter,
    pivotTables: operation.pivotTables,
  })) if (value !== undefined) protection.setAttribute(name, booleanAttribute(value));
  warnings.push(operation.password === undefined ? "Sheet protection enabled without a password." : "Sheet protection password was hashed in memory and redacted from results.");
}

function setBreaks(document: Document, name: "rowBreaks" | "colBreaks", values: number[] | undefined): void {
  if (values === undefined) return;
  const existing = firstDirectChild(document.documentElement, NS.spreadsheet, name);
  existing?.parentNode?.removeChild(existing);
  if (values.length === 0) return;
  const container = orderedWorksheetChild(document, name);
  container.setAttribute("count", String(values.length));
  container.setAttribute("manualBreakCount", String(values.length));
  for (const value of values) {
    const item = appendElement(document, container, NS.spreadsheet, "brk");
    item.setAttribute("id", String(value));
    item.setAttribute("min", "0");
    item.setAttribute("max", name === "rowBreaks" ? "16383" : "1048575");
    item.setAttribute("man", "1");
  }
}

function quoteSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function setDefinedNameInternal(context: AdvancedEditContext, name: string, formula: string, sheetName?: string, hidden?: boolean, comment?: string): void {
  const root = context.model.workbookDocument.documentElement;
  let container = firstDirectChild(root, NS.spreadsheet, "definedNames");
  if (!container) {
    container = context.model.workbookDocument.createElementNS(NS.spreadsheet, "definedNames");
    const sheets = firstDirectChild(root, NS.spreadsheet, "sheets");
    if (sheets?.nextSibling) root.insertBefore(container, sheets.nextSibling); else root.appendChild(container);
  }
  const localSheetId = sheetName === undefined ? undefined : context.model.sheets.findIndex((sheet) => sheet.name.toLowerCase() === sheetName.toLowerCase());
  if (localSheetId !== undefined && localSheetId < 0) fail("INVALID_ARGUMENT", `Worksheet not found for defined name: ${sheetName}.`);
  let item = directChildren(container, NS.spreadsheet, "definedName").find((candidate) => candidate.getAttribute("name")?.toLowerCase() === name.toLowerCase() && (candidate.getAttribute("localSheetId") ?? undefined) === (localSheetId === undefined ? undefined : String(localSheetId)));
  if (!item) item = appendElement(context.model.workbookDocument, container, NS.spreadsheet, "definedName");
  while (item.firstChild) item.removeChild(item.firstChild);
  item.setAttribute("name", name);
  if (localSheetId !== undefined) item.setAttribute("localSheetId", String(localSheetId)); else item.removeAttribute("localSheetId");
  if (hidden !== undefined) item.setAttribute("hidden", booleanAttribute(hidden));
  if (comment !== undefined) item.setAttribute("comment", comment);
  item.appendChild(context.model.workbookDocument.createTextNode(assertSafeFormula(formula)));
  context.markWorkbookChanged();
}

function setPrintSettings(operation: Extract<WorkbookOperation, { type: "setPrintSettings" }>, context: AdvancedEditContext, sheetContext: SheetDocumentContext): void {
  const document = sheetContext.document;
  if (operation.horizontalCentered !== undefined || operation.verticalCentered !== undefined) {
    const options = orderedWorksheetChild(document, "printOptions");
    if (operation.horizontalCentered !== undefined) options.setAttribute("horizontalCentered", booleanAttribute(operation.horizontalCentered));
    if (operation.verticalCentered !== undefined) options.setAttribute("verticalCentered", booleanAttribute(operation.verticalCentered));
  }
  if ([operation.marginLeft, operation.marginRight, operation.marginTop, operation.marginBottom, operation.marginHeader, operation.marginFooter].some((value) => value !== undefined)) {
    const margins = orderedWorksheetChild(document, "pageMargins");
    const defaults = { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
    for (const [name, value] of Object.entries({ left: operation.marginLeft, right: operation.marginRight, top: operation.marginTop, bottom: operation.marginBottom, header: operation.marginHeader, footer: operation.marginFooter })) margins.setAttribute(name, String(value ?? numericAttribute(margins, name, defaults[name as keyof typeof defaults])));
  }
  if ([operation.orientation, operation.paperSize, operation.fitToWidth, operation.fitToHeight, operation.scale].some((value) => value !== undefined)) {
    const setup = orderedWorksheetChild(document, "pageSetup");
    if (operation.orientation !== undefined) setup.setAttribute("orientation", operation.orientation);
    if (operation.paperSize !== undefined) setup.setAttribute("paperSize", String(operation.paperSize));
    if (operation.fitToWidth !== undefined) setup.setAttribute("fitToWidth", String(operation.fitToWidth));
    if (operation.fitToHeight !== undefined) setup.setAttribute("fitToHeight", String(operation.fitToHeight));
    if (operation.scale !== undefined) setup.setAttribute("scale", String(operation.scale));
  }
  if (operation.header !== undefined || operation.footer !== undefined) {
    const headerFooter = orderedWorksheetChild(document, "headerFooter");
    if (operation.header !== undefined) {
      const header = firstDirectChild(headerFooter, NS.spreadsheet, "oddHeader") ?? appendElement(document, headerFooter, NS.spreadsheet, "oddHeader");
      header.textContent = operation.header;
    }
    if (operation.footer !== undefined) {
      const footer = firstDirectChild(headerFooter, NS.spreadsheet, "oddFooter") ?? appendElement(document, headerFooter, NS.spreadsheet, "oddFooter");
      footer.textContent = operation.footer;
    }
  }
  setBreaks(document, "rowBreaks", operation.rowBreaks);
  setBreaks(document, "colBreaks", operation.columnBreaks);
  if (operation.printArea !== undefined) setDefinedNameInternal(context, "_xlnm.Print_Area", `${quoteSheetName(sheetContext.sheet.name)}!${formatRange(parseRange(operation.printArea)).replace(/([A-Z]+)(\d+)/g, "$$$1$$$2")}`, sheetContext.sheet.name, true);
  if (operation.printTitlesRows !== undefined || operation.printTitlesColumns !== undefined) {
    const pieces: string[] = [];
    if (operation.printTitlesColumns) {
      if (!/^\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}$/.test(operation.printTitlesColumns)) fail("INVALID_ARGUMENT", "printTitlesColumns must look like $A:$C.");
      pieces.push(`${quoteSheetName(sheetContext.sheet.name)}!${operation.printTitlesColumns}`);
    }
    if (operation.printTitlesRows) {
      if (!/^\$?[1-9][0-9]*:\$?[1-9][0-9]*$/.test(operation.printTitlesRows)) fail("INVALID_ARGUMENT", "printTitlesRows must look like $1:$2.");
      pieces.push(`${quoteSheetName(sheetContext.sheet.name)}!${operation.printTitlesRows}`);
    }
    setDefinedNameInternal(context, "_xlnm.Print_Titles", pieces.join(","), sheetContext.sheet.name, true);
  }
}

function transformBounds(bounds: RangeBounds, axis: "row" | "column", start: number, count: number, deletion: boolean): RangeBounds | undefined {
  const a = axis === "row" ? bounds.startRow : bounds.startColumn;
  const b = axis === "row" ? bounds.endRow : bounds.endColumn;
  let nextA: number;
  let nextB: number;
  if (!deletion) {
    nextA = a >= start ? a + count : a;
    nextB = b >= start ? b + count : b;
  } else {
    const deletedEnd = start + count - 1;
    if (b < start) { nextA = a; nextB = b; }
    else if (a > deletedEnd) { nextA = a - count; nextB = b - count; }
    else {
      const first = a < start ? a : b > deletedEnd ? start : undefined;
      const last = b > deletedEnd ? b - count : a < start ? start - 1 : undefined;
      if (first === undefined || last === undefined || first > last) return undefined;
      nextA = first; nextB = last;
    }
  }
  return axis === "row" ? { ...bounds, startRow: nextA, endRow: nextB } : { ...bounds, startColumn: nextA, endColumn: nextB };
}

function transformSqref(value: string, axis: "row" | "column", start: number, count: number, deletion: boolean): string {
  const result: string[] = [];
  for (const token of value.trim().split(/\s+/).filter(Boolean)) {
    const transformed = transformBounds(parseRange(token), axis, start, count, deletion);
    if (transformed) result.push(formatRange(transformed));
  }
  return result.join(" ");
}

function normalizedSheetPrefix(prefix: string): string {
  const raw = prefix.slice(0, -1);
  return (raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw).toLowerCase();
}

function shiftFormula(formula: string, targetSheet: string, formulaSheet: string, axis: "row" | "column", start: number, count: number, deletion: boolean): string {
  if (/\[[^\]]+\]/.test(formula)) fail("UNSUPPORTED_FEATURE", "Structural edits cannot safely rewrite formulas containing external workbook references.");
  const segments = formula.split(/("(?:[^"]|"")*")/g);
  return segments.map((segment, index) => {
    if (index % 2 === 1) return segment;
    return segment.replace(/(?<![A-Za-z0-9_.])((?:'[^']+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?)([A-Z]{1,3})(\$?)([1-9][0-9]{0,6})(?![A-Za-z0-9_])/g,
      (match, prefix: string | undefined, columnAbsolute: string, columnText: string, rowAbsolute: string, rowText: string) => {
        const applies = prefix ? normalizedSheetPrefix(prefix) === targetSheet.toLowerCase() : formulaSheet.toLowerCase() === targetSheet.toLowerCase();
        if (!applies) return match;
        const row = Number(rowText);
        const column = columnToNumber(columnText);
        const coordinate = axis === "row" ? row : column;
        if (deletion && coordinate >= start && coordinate < start + count) return "#REF!";
        const shifted = !deletion ? (coordinate >= start ? coordinate + count : coordinate) : (coordinate >= start + count ? coordinate - count : coordinate);
        const nextRow = axis === "row" ? shifted : row;
        const nextColumn = axis === "column" ? shifted : column;
        if (nextRow < 1 || nextRow > 1048576 || nextColumn < 1 || nextColumn > 16384) return "#REF!";
        return `${prefix ?? ""}${columnAbsolute}${numberToColumn(nextColumn)}${rowAbsolute}${nextRow}`;
      });
  }).join("");
}

function assertStructureSafe(document: Document, axis: "row" | "column", start: number, count: number, deletion: boolean): void {
  for (const name of ["drawing", "legacyDrawing", "legacyDrawingHF", "oleObjects", "controls", "tableParts", "extLst"]) {
    if (elements(document, NS.spreadsheet, name).length > 0) fail("UNSUPPORTED_FEATURE", `Structural ${axis} edits are rejected when worksheet ${name} objects are present.`);
  }
  if (!deletion) return;
  const deleted: RangeBounds = axis === "row"
    ? { startRow: start, endRow: start + count - 1, startColumn: 1, endColumn: 16384 }
    : { startRow: 1, endRow: 1048576, startColumn: start, endColumn: start + count - 1 };
  for (const [name, attribute] of [["mergeCell", "ref"], ["conditionalFormatting", "sqref"], ["dataValidation", "sqref"], ["hyperlink", "ref"], ["autoFilter", "ref"], ["sortState", "ref"]] as const) {
    for (const item of elements(document, NS.spreadsheet, name)) for (const token of (item.getAttribute(attribute) ?? "").split(/\s+/).filter(Boolean)) if (rangesOverlap(parseRange(token), deleted)) fail("UNSUPPORTED_FEATURE", `Deletion intersects ${name} range ${token}; remove or update that feature explicitly first.`);
  }
}

function shiftWorksheetStructure(operation: Extract<WorkbookOperation, { type: "insertRows" | "deleteRows" | "insertColumns" | "deleteColumns" }>, context: AdvancedEditContext, sheetContext: SheetDocumentContext): void {
  const rowAxis = operation.type === "insertRows" || operation.type === "deleteRows";
  const deletion = operation.type === "deleteRows" || operation.type === "deleteColumns";
  const axis = rowAxis ? "row" : "column";
  const start = "startRow" in operation ? operation.startRow : columnToNumber(operation.startColumn);
  const count = operation.count;
  const maximum = rowAxis ? 1048576 : 16384;
  if (!deletion && start + count - 1 > maximum) fail("LIMIT_EXCEEDED", `Inserted ${axis}s exceed Excel limits.`);
  assertStructureSafe(sheetContext.document, axis, start, count, deletion);
  const sheetData = sheetContext.sheetData;
  const rows = directChildren(sheetData, NS.spreadsheet, "row");
  if (rowAxis) {
    for (const row of rows) {
      const number = numericAttribute(row, "r");
      if (deletion && number >= start && number < start + count) { row.parentNode?.removeChild(row); continue; }
      const next = !deletion ? (number >= start ? number + count : number) : (number >= start + count ? number - count : number);
      row.setAttribute("r", String(next));
      for (const cell of directChildren(row, NS.spreadsheet, "c")) {
        const reference = cell.getAttribute("r");
        if (reference) cell.setAttribute("r", `${reference.match(/^\$?[A-Z]+/)?.[0]?.replace(/\$/g, "") ?? "A"}${next}`);
      }
    }
  } else {
    for (const row of rows) {
      for (const cell of [...directChildren(row, NS.spreadsheet, "c")]) {
        const reference = cell.getAttribute("r");
        if (!reference) continue;
        const address = parseCellReference(reference);
        if (deletion && address.column >= start && address.column < start + count) { cell.parentNode?.removeChild(cell); continue; }
        const next = !deletion ? (address.column >= start ? address.column + count : address.column) : (address.column >= start + count ? address.column - count : address.column);
        cell.setAttribute("r", formatCellReference(address.row, next));
      }
    }
    const cols = firstDirectChild(sheetContext.document.documentElement, NS.spreadsheet, "cols");
    if (cols) for (const col of [...directChildren(cols, NS.spreadsheet, "col")]) {
      const bounds: RangeBounds = { startRow: 1, endRow: 1, startColumn: numericAttribute(col, "min"), endColumn: numericAttribute(col, "max") };
      const transformed = transformBounds(bounds, "column", start, count, deletion);
      if (!transformed) col.parentNode?.removeChild(col); else { col.setAttribute("min", String(transformed.startColumn)); col.setAttribute("max", String(transformed.endColumn)); }
    }
  }
  for (const sheet of context.model.sheets) {
    const candidate = context.documentFor(sheet.name);
    let formulasChanged = false;
    for (const formula of elements(candidate.document, NS.spreadsheet, "f")) {
      const kind = formula.getAttribute("t");
      if (kind && kind !== "normal") fail("UNSUPPORTED_FEATURE", `Structural edits cannot safely rewrite ${kind} formulas.`);
      const before = textContent(formula);
      const after = shiftFormula(before, sheetContext.sheet.name, sheet.name, axis, start, count, deletion);
      if (after !== before) { formula.textContent = after; formulasChanged = true; }
    }
    if (formulasChanged) context.changedSheets.add(sheet.partPath);
  }
  for (const [name, attribute] of [["mergeCell", "ref"], ["conditionalFormatting", "sqref"], ["dataValidation", "sqref"], ["hyperlink", "ref"], ["autoFilter", "ref"], ["sortState", "ref"]] as const) {
    for (const item of elements(sheetContext.document, NS.spreadsheet, name)) {
      const value = item.getAttribute(attribute);
      if (!value) continue;
      const shifted = transformSqref(value, axis, start, count, deletion);
      if (!shifted) item.parentNode?.removeChild(item); else item.setAttribute(attribute, shifted);
    }
  }
  for (const definedName of elements(context.model.workbookDocument, NS.spreadsheet, "definedName")) {
    const before = textContent(definedName);
    const after = shiftFormula(before, sheetContext.sheet.name, "", axis, start, count, deletion);
    if (after !== before) { definedName.textContent = after; context.markWorkbookChanged(); }
  }
}

function setHyperlink(operation: Extract<WorkbookOperation, { type: "setHyperlink" }>, context: AdvancedEditContext, sheetContext: SheetDocumentContext): void {
  const normalized = formatRange(parseRange(operation.range));
  const container = orderedWorksheetChild(sheetContext.document, "hyperlinks");
  let item = directChildren(container, NS.spreadsheet, "hyperlink").find((candidate) => candidate.getAttribute("ref") === normalized);
  if (!item) item = appendElement(sheetContext.document, container, NS.spreadsheet, "hyperlink");
  const oldId = item.getAttributeNS(NS.officeRelationships, "id") || item.getAttribute("r:id");
  if (oldId) removeRelationship(context.pkg, sheetContext.sheet.partPath, oldId, context.allowedChangedParts);
  for (const attribute of Array.from(item.attributes)) item.removeAttributeNode(attribute);
  item.setAttribute("ref", normalized);
  if (operation.target.startsWith("#")) item.setAttribute("location", operation.target.slice(1));
  else {
    const relationship = addRelationship(context.pkg, sheetContext.sheet.partPath, RELATIONSHIP_TYPES.hyperlink, operation.target, context.allowedChangedParts, "External");
    item.setAttributeNS(NS.officeRelationships, "r:id", relationship.id);
  }
  if (operation.display !== undefined) item.setAttribute("display", operation.display);
  if (operation.tooltip !== undefined) item.setAttribute("tooltip", operation.tooltip);
}

function removeHyperlink(operation: Extract<WorkbookOperation, { type: "removeHyperlink" }>, context: AdvancedEditContext, sheetContext: SheetDocumentContext): void {
  const normalized = formatRange(parseRange(operation.range));
  const container = firstDirectChild(sheetContext.document.documentElement, NS.spreadsheet, "hyperlinks");
  if (!container) return;
  const item = directChildren(container, NS.spreadsheet, "hyperlink").find((candidate) => candidate.getAttribute("ref") === normalized);
  if (!item) return;
  const id = item.getAttributeNS(NS.officeRelationships, "id") || item.getAttribute("r:id");
  if (id) removeRelationship(context.pkg, sheetContext.sheet.partPath, id, context.allowedChangedParts);
  item.parentNode?.removeChild(item);
  if (directChildren(container, NS.spreadsheet, "hyperlink").length === 0) container.parentNode?.removeChild(container);
}

export function applyAdvancedWorksheetOperation(operation: WorkbookOperation, context: AdvancedEditContext): AdvancedOperationResult | undefined {
  switch (operation.type) {
    case "setRichText": {
      const sheet = context.documentFor(operation.sheet);
      const bounds = parseRange(operation.range);
      assertRangeOutsideComplexFormulas(sheet.document, bounds, operation.type);
      for (const address of iterateRange(bounds)) setRichText(sheet.document, getOrCreateCell(sheet.document, sheet.sheetData, address.row, address.column), operation.runs);
      context.changedSheets.add(sheet.sheet.partPath);
      return { sheet: sheet.sheet.name, target: formatRange(bounds), cells: rangeCellCount(bounds) };
    }
    case "copyFormat": {
      const source = context.documentFor(operation.sourceSheet);
      const target = context.documentFor(operation.sheet);
      const sourceBounds = parseRange(operation.sourceRange);
      const targetBounds = parseRange(operation.targetRange);
      if (sourceBounds.endRow - sourceBounds.startRow !== targetBounds.endRow - targetBounds.startRow || sourceBounds.endColumn - sourceBounds.startColumn !== targetBounds.endColumn - targetBounds.startColumn) fail("INVALID_ARGUMENT", "copyFormat source and target ranges must have identical dimensions.");
      for (const address of iterateRange(targetBounds)) {
        const sourceAddress = { row: sourceBounds.startRow + address.row - targetBounds.startRow, column: sourceBounds.startColumn + address.column - targetBounds.startColumn };
        const sourceRow = directChildren(source.sheetData, NS.spreadsheet, "row").find((row) => numericAttribute(row, "r") === sourceAddress.row);
        const sourceCell = sourceRow ? findCell(sourceRow, sourceAddress.column) : undefined;
        const targetCell = getOrCreateCell(target.document, target.sheetData, address.row, address.column);
        const style = sourceCell?.getAttribute("s");
        if (style) targetCell.setAttribute("s", style); else targetCell.removeAttribute("s");
      }
      context.changedSheets.add(target.sheet.partPath);
      return { sheet: target.sheet.name, target: formatRange(targetBounds), cells: rangeCellCount(targetBounds) };
    }
    case "setRowProperties": {
      const sheet = context.documentFor(operation.sheet);
      const end = operation.endRow ?? operation.startRow;
      setRowProperties(sheet.document, sheet.sheetData, operation.startRow, end, operation);
      context.changedSheets.add(sheet.sheet.partPath);
      return { sheet: sheet.sheet.name, target: `${operation.startRow}:${end}` };
    }
    case "setColumnProperties": {
      const sheet = context.documentFor(operation.sheet);
      const start = columnToNumber(operation.startColumn);
      const end = columnToNumber(operation.endColumn ?? operation.startColumn);
      if (end < start) fail("INVALID_ARGUMENT", "setColumnProperties endColumn must be greater than or equal to startColumn.");
      applyColumnProperties(sheet.document, start, end, operation);
      context.changedSheets.add(sheet.sheet.partPath);
      return { sheet: sheet.sheet.name, target: `${numberToColumn(start)}:${numberToColumn(end)}` };
    }
    case "autoFit": {
      const sheet = context.documentFor(operation.sheet);
      const bounds = operation.range ? parseRange(operation.range) : parseRange(elements(sheet.document, NS.spreadsheet, "dimension")[0]?.getAttribute("ref") ?? "A1");
      const doRows = operation.rows ?? operation.columns === undefined;
      const doColumns = operation.columns ?? operation.rows === undefined;
      autoFit(context.model, sheet.document, bounds, doRows, doColumns, operation.minColumnWidth ?? 2, operation.maxColumnWidth ?? 80);
      context.warnings.push("autoFit uses deterministic text-length estimates; verify exact font metrics with desktop Excel.");
      context.changedSheets.add(sheet.sheet.partPath);
      return { sheet: sheet.sheet.name, target: formatRange(bounds), cells: rangeCellCount(bounds) };
    }
    case "insertRows": case "deleteRows": case "insertColumns": case "deleteColumns": {
      const sheet = context.documentFor(operation.sheet);
      shiftWorksheetStructure(operation, context, sheet);
      context.changedSheets.add(sheet.sheet.partPath);
      return { sheet: sheet.sheet.name, target: "startRow" in operation ? `${operation.startRow}:${operation.count}` : `${operation.startColumn}:${operation.count}` };
    }
    case "setFreezePanes": {
      const sheet = context.documentFor(operation.sheet);
      setFreezePanes(sheet.document, operation.rows ?? 0, operation.columns ?? 0);
      context.changedSheets.add(sheet.sheet.partPath);
      return { sheet: sheet.sheet.name, target: formatCellReference((operation.rows ?? 0) + 1, (operation.columns ?? 0) + 1) };
    }
    case "setConditionalFormatting": {
      const sheet = context.documentFor(operation.sheet);
      setConditionalFormatting(operation, sheet, context.model);
      context.changedSheets.add(sheet.sheet.partPath);
      return { sheet: sheet.sheet.name, target: formatRange(parseRange(operation.range)) };
    }
    case "clearConditionalFormatting": {
      const sheet = context.documentFor(operation.sheet);
      clearConditionalFormatting(operation, sheet.document);
      context.changedSheets.add(sheet.sheet.partPath);
      return { sheet: sheet.sheet.name, target: formatRange(parseRange(operation.range)) };
    }
    case "setDataValidation": {
      const sheet = context.documentFor(operation.sheet);
      setDataValidation(operation, sheet.document);
      context.changedSheets.add(sheet.sheet.partPath);
      return { sheet: sheet.sheet.name, target: formatRange(parseRange(operation.range)) };
    }
    case "clearDataValidation": {
      const sheet = context.documentFor(operation.sheet);
      clearDataValidation(operation, sheet.document);
      context.changedSheets.add(sheet.sheet.partPath);
      return { sheet: sheet.sheet.name, target: formatRange(parseRange(operation.range)) };
    }
    case "setAutoFilter": {
      const sheet = context.documentFor(operation.sheet);
      const filter = orderedWorksheetChild(sheet.document, "autoFilter");
      filter.setAttribute("ref", formatRange(parseRange(operation.range)));
      context.changedSheets.add(sheet.sheet.partPath);
      return { sheet: sheet.sheet.name, target: filter.getAttribute("ref")! };
    }
    case "clearAutoFilter": {
      const sheet = context.documentFor(operation.sheet);
      firstDirectChild(sheet.document.documentElement, NS.spreadsheet, "autoFilter")?.parentNode?.removeChild(firstDirectChild(sheet.document.documentElement, NS.spreadsheet, "autoFilter")!);
      context.changedSheets.add(sheet.sheet.partPath);
      return { sheet: sheet.sheet.name, target: "autoFilter" };
    }
    case "setSort": {
      const sheet = context.documentFor(operation.sheet);
      setSort(operation, sheet.document);
      context.changedSheets.add(sheet.sheet.partPath);
      return { sheet: sheet.sheet.name, target: formatRange(parseRange(operation.range)) };
    }
    case "setHyperlink": {
      const sheet = context.documentFor(operation.sheet);
      setHyperlink(operation, context, sheet);
      context.changedSheets.add(sheet.sheet.partPath);
      return { sheet: sheet.sheet.name, target: formatRange(parseRange(operation.range)) };
    }
    case "removeHyperlink": {
      const sheet = context.documentFor(operation.sheet);
      removeHyperlink(operation, context, sheet);
      context.changedSheets.add(sheet.sheet.partPath);
      return { sheet: sheet.sheet.name, target: formatRange(parseRange(operation.range)) };
    }
    case "setPrintSettings": {
      const sheet = context.documentFor(operation.sheet);
      setPrintSettings(operation, context, sheet);
      context.changedSheets.add(sheet.sheet.partPath);
      return { sheet: sheet.sheet.name, target: "print-settings" };
    }
    case "setSheetProtection": {
      const sheet = context.documentFor(operation.sheet);
      setSheetProtection(operation, sheet.document, context.warnings);
      context.changedSheets.add(sheet.sheet.partPath);
      return { sheet: sheet.sheet.name, target: "sheet-protection" };
    }
    default:
      return undefined;
  }
}
