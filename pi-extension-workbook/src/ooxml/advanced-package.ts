import path from "node:path";
import type { WorkbookOperation } from "../contracts.ts";
import { fail } from "../errors.ts";
import { assertSafeFormula, formatRange, parseCellReference, parseRange, rangeCellCount } from "./cell-ref.ts";
import type { AdvancedEditContext, AdvancedOperationResult, SheetDocumentContext } from "./advanced-worksheet.ts";
import {
  addRelationship,
  assertPartMutable,
  CONTENT_TYPES,
  deletePart,
  ensureContentType,
  nextPartPath,
  RELATIONSHIP_TYPES,
  relsPartForSource,
  removeContentTypeOverride,
  removeRelationship,
} from "./package-edit.ts";
import type { SheetInfo } from "./workbook.ts";
import { NS, appendElement, directChildren, elements, firstDirectChild, parseXml, serializeXml, textContent } from "./xml.ts";

const WORKBOOK_CHILD_ORDER = ["fileVersion", "fileSharing", "workbookPr", "workbookProtection", "bookViews", "sheets", "functionGroups", "externalReferences", "definedNames", "calcPr", "oleSize", "customWorkbookViews", "pivotCaches", "smartTagPr", "smartTagTypes", "webPublishing", "fileRecoveryPr", "webPublishObjects", "extLst"];
const TABLE_RELATIONSHIP_TYPE = RELATIONSHIP_TYPES.table;
const THEME_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

function directElementChildren(parent: Element): Element[] {
  return Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1);
}

function orderedWorkbookChild(document: Document, name: string): Element {
  const root = document.documentElement;
  const existing = firstDirectChild(root, NS.spreadsheet, name);
  if (existing) return existing;
  const child = document.createElementNS(NS.spreadsheet, name);
  const desired = WORKBOOK_CHILD_ORDER.indexOf(name);
  const before = directElementChildren(root).find((candidate) => WORKBOOK_CHILD_ORDER.indexOf(candidate.localName) > desired);
  if (before) root.insertBefore(child, before); else root.appendChild(child);
  return child;
}

function bool(value: boolean): string {
  return value ? "1" : "0";
}

function normalizeColor(color: string): string {
  const value = color.replace(/^#/, "").toUpperCase();
  if (!/^(?:[A-F0-9]{6}|[A-F0-9]{8})$/.test(value)) fail("INVALID_ARGUMENT", `Invalid RGB/ARGB color: ${color}.`);
  return value.length === 8 ? value.slice(2) : value;
}

function quoteSheet(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceSheetReferences(value: string, oldName: string, newName: string): string {
  const quotedOld = `'${oldName.replace(/'/g, "''")}'!`;
  const bare = new RegExp(`(?<![A-Za-z0-9_.'])${escapeRegex(oldName)}!`, "gi");
  return value.split(/("(?:[^"]|"")*")/g).map((segment, index) => index % 2 === 1 ? segment : segment.replaceAll(quotedOld, `${quoteSheet(newName)}!`).replace(bare, `${quoteSheet(newName)}!`)).join("");
}

function validateSheetName(name: string): void {
  if (!name || name.length > 31 || /[\\/*?:\[\]]/.test(name) || /^'|'$/.test(name)) fail("INVALID_ARGUMENT", `Invalid worksheet name: ${JSON.stringify(name)}.`);
}

function workbookSheetElement(context: AdvancedEditContext, sheet: SheetInfo): Element {
  const element = elements(context.model.workbookDocument, NS.spreadsheet, "sheet").find((item) => {
    const id = item.getAttributeNS(NS.officeRelationships, "id") || item.getAttribute("r:id");
    return id === sheet.relationshipId;
  });
  if (!element) fail("INVALID_PACKAGE", `Workbook sheet entry is missing for ${sheet.name}.`);
  return element;
}

function visibleSheetCount(context: AdvancedEditContext): number {
  return context.model.sheets.filter((sheet) => sheet.state === "visible").length;
}

function setTabColor(sheetContext: SheetDocumentContext, color: string | undefined): void {
  if (color === undefined) return;
  const root = sheetContext.document.documentElement;
  let sheetPr = firstDirectChild(root, NS.spreadsheet, "sheetPr");
  if (!sheetPr) {
    sheetPr = sheetContext.document.createElementNS(NS.spreadsheet, "sheetPr");
    root.insertBefore(sheetPr, root.firstChild);
  }
  const existing = firstDirectChild(sheetPr, NS.spreadsheet, "tabColor") ?? appendElement(sheetContext.document, sheetPr, NS.spreadsheet, "tabColor");
  while (existing.attributes.length) existing.removeAttributeNode(existing.attributes.item(0)!);
  const normalized = color.replace(/^#/, "").toUpperCase();
  existing.setAttribute("rgb", normalized.length === 6 ? `FF${normalized}` : normalized);
}

function setSheetProperties(operation: Extract<WorkbookOperation, { type: "setSheetProperties" }>, context: AdvancedEditContext): AdvancedOperationResult {
  const sheet = context.model.sheet(operation.sheet);
  const sheetElement = workbookSheetElement(context, sheet);
  const sheetContext = context.documentFor(sheet.name);
  let finalName = sheet.name;
  if (operation.name !== undefined && operation.name.toLowerCase() !== sheet.name.toLowerCase()) {
    validateSheetName(operation.name);
    if (context.model.sheets.some((candidate) => candidate !== sheet && candidate.name.toLowerCase() === operation.name!.toLowerCase())) fail("INVALID_ARGUMENT", `Worksheet already exists: ${operation.name}.`);
    for (const candidate of context.model.sheets) {
      const documentContext = context.documentFor(candidate.name);
      let changed = false;
      for (const formula of elements(documentContext.document, NS.spreadsheet, "f")) {
        const before = textContent(formula);
        const after = replaceSheetReferences(before, sheet.name, operation.name);
        if (after !== before) { formula.textContent = after; changed = true; }
      }
      if (changed) context.changedSheets.add(candidate.partPath);
    }
    for (const name of elements(context.model.workbookDocument, NS.spreadsheet, "definedName")) name.textContent = replaceSheetReferences(textContent(name), sheet.name, operation.name);
    sheetElement.setAttribute("name", operation.name);
    sheet.name = operation.name;
    finalName = operation.name;
    context.markWorkbookChanged();
  }
  if (operation.state !== undefined) {
    if (operation.state !== "visible" && sheet.state === "visible" && visibleSheetCount(context) <= 1) fail("INVALID_ARGUMENT", "A workbook must keep at least one visible worksheet.");
    sheet.state = operation.state;
    if (operation.state === "visible") sheetElement.removeAttribute("state"); else sheetElement.setAttribute("state", operation.state);
    context.markWorkbookChanged();
  }
  if (operation.position !== undefined) {
    const sheetsElement = firstDirectChild(context.model.workbookDocument.documentElement, NS.spreadsheet, "sheets")!;
    const currentElements = directChildren(sheetsElement, NS.spreadsheet, "sheet");
    const clamped = Math.min(operation.position, currentElements.length - 1);
    sheetsElement.removeChild(sheetElement);
    const remaining = directChildren(sheetsElement, NS.spreadsheet, "sheet");
    if (remaining[clamped]) sheetsElement.insertBefore(sheetElement, remaining[clamped]); else sheetsElement.appendChild(sheetElement);
    const mutable = context.model.sheets as SheetInfo[];
    mutable.splice(mutable.indexOf(sheet), 1);
    mutable.splice(clamped, 0, sheet);
    const names = elements(context.model.workbookDocument, NS.spreadsheet, "definedName");
    for (const item of names) {
      const local = Number(item.getAttribute("localSheetId"));
      if (!Number.isInteger(local)) continue;
      const scopedSheet = currentElements[local];
      const scopedId = scopedSheet?.getAttribute("sheetId");
      const next = mutable.findIndex((candidate) => candidate.sheetId === scopedId);
      if (next >= 0) item.setAttribute("localSheetId", String(next));
    }
    context.markWorkbookChanged();
  }
  setTabColor(sheetContext, operation.tabColor);
  if (operation.tabColor !== undefined) context.changedSheets.add(sheet.partPath);
  if (operation.showGridLines !== undefined || operation.zoomScale !== undefined) {
    let views = firstDirectChild(sheetContext.document.documentElement, NS.spreadsheet, "sheetViews");
    if (!views) {
      views = sheetContext.document.createElementNS(NS.spreadsheet, "sheetViews");
      const before = firstDirectChild(sheetContext.document.documentElement, NS.spreadsheet, "sheetFormatPr") ?? firstDirectChild(sheetContext.document.documentElement, NS.spreadsheet, "sheetData");
      if (before) sheetContext.document.documentElement.insertBefore(views, before); else sheetContext.document.documentElement.appendChild(views);
    }
    const view = firstDirectChild(views, NS.spreadsheet, "sheetView") ?? appendElement(sheetContext.document, views, NS.spreadsheet, "sheetView");
    if (!view.hasAttribute("workbookViewId")) view.setAttribute("workbookViewId", "0");
    if (operation.showGridLines !== undefined) view.setAttribute("showGridLines", bool(operation.showGridLines));
    if (operation.zoomScale !== undefined) view.setAttribute("zoomScale", String(operation.zoomScale));
    context.changedSheets.add(sheet.partPath);
  }
  return { sheet: finalName, target: "sheet-properties" };
}

function xmlDocument(xml: string, partPath: string, maxBytes: number): Document {
  return parseXml(new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${xml}`), partPath, maxBytes);
}

function createSheet(operation: Extract<WorkbookOperation, { type: "createSheet" }>, context: AdvancedEditContext): AdvancedOperationResult {
  validateSheetName(operation.name);
  if (context.model.sheets.some((sheet) => sheet.name.toLowerCase() === operation.name.toLowerCase())) fail("INVALID_ARGUMENT", `Worksheet already exists: ${operation.name}.`);
  ensureContentType(context.pkg, "placeholder", CONTENT_TYPES.worksheet, context.allowedChangedParts); // proves [Content_Types].xml is mutable before package changes
  const partPath = nextPartPath(context.pkg, "xl/worksheets", "sheet", "xml");
  removeContentTypeOverride(context.pkg, "placeholder", context.allowedChangedParts);
  ensureContentType(context.pkg, partPath, CONTENT_TYPES.worksheet, context.allowedChangedParts);
  const relationship = addRelationship(context.pkg, context.pkg.workbookPart, RELATIONSHIP_TYPES.worksheet, partPath, context.allowedChangedParts);
  const tab = operation.tabColor ? `<sheetPr><tabColor rgb="${operation.tabColor.length === 6 ? `FF${operation.tabColor.toUpperCase()}` : operation.tabColor.toUpperCase()}"/></sheetPr>` : "";
  const document = xmlDocument(`<worksheet xmlns="${NS.spreadsheet}" xmlns:r="${NS.officeRelationships}">${tab}<dimension ref="A1"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData/></worksheet>`, partPath, context.pkg.archive.limits.maxXmlBytes);
  context.pkg.archive.set(partPath, serializeXml(document));
  context.allowedChangedParts.add(partPath);
  context.documents.set(partPath, document);
  context.changedSheets.add(partPath);
  const maxId = Math.max(0, ...context.model.sheets.map((sheet) => Number(sheet.sheetId)).filter(Number.isFinite));
  const sheet: SheetInfo = { name: operation.name, sheetId: String(maxId + 1), state: operation.state ?? "visible", relationshipId: relationship.id, partPath };
  const sheetsElement = orderedWorkbookChild(context.model.workbookDocument, "sheets");
  const element = context.model.workbookDocument.createElementNS(NS.spreadsheet, "sheet");
  element.setAttribute("name", sheet.name);
  element.setAttribute("sheetId", sheet.sheetId);
  element.setAttributeNS(NS.officeRelationships, "r:id", relationship.id);
  if (sheet.state !== "visible") element.setAttribute("state", sheet.state);
  const mutable = context.model.sheets as SheetInfo[];
  const position = Math.min(operation.position ?? mutable.length, mutable.length);
  const existing = directChildren(sheetsElement, NS.spreadsheet, "sheet");
  if (existing[position]) sheetsElement.insertBefore(element, existing[position]); else sheetsElement.appendChild(element);
  mutable.splice(position, 0, sheet);
  context.markWorkbookChanged();
  return { sheet: sheet.name, target: `position:${position}` };
}

function deleteSheet(operation: Extract<WorkbookOperation, { type: "deleteSheet" }>, context: AdvancedEditContext): AdvancedOperationResult {
  if (context.model.sheets.length <= 1) fail("INVALID_ARGUMENT", "Cannot delete the last worksheet.");
  const sheet = context.model.sheet(operation.sheet);
  const quoted = `${quoteSheet(sheet.name)}!`;
  const barePattern = new RegExp(`(?<![A-Za-z0-9_.'])${escapeRegex(sheet.name)}!`, "i");
  for (const candidate of context.model.sheets) {
    if (candidate === sheet) continue;
    const document = context.documentFor(candidate.name).document;
    if (elements(document, NS.spreadsheet, "f").some((formula) => textContent(formula).includes(quoted) || barePattern.test(textContent(formula)))) fail("UNSUPPORTED_FEATURE", `Cannot delete ${sheet.name}; formulas on ${candidate.name} reference it.`);
  }
  const relationshipPart = relsPartForSource(sheet.partPath);
  if (context.pkg.archive.get(relationshipPart)) fail("UNSUPPORTED_FEATURE", `Cannot delete worksheet ${sheet.name} while it owns related objects; remove them explicitly first.`);
  const sheetElement = workbookSheetElement(context, sheet);
  sheetElement.parentNode?.removeChild(sheetElement);
  removeRelationship(context.pkg, context.pkg.workbookPart, sheet.relationshipId, context.allowedChangedParts);
  removeContentTypeOverride(context.pkg, sheet.partPath, context.allowedChangedParts);
  deletePart(context.pkg, sheet.partPath);
  context.allowedChangedParts.add(sheet.partPath);
  const mutable = context.model.sheets as SheetInfo[];
  const removedIndex = mutable.indexOf(sheet);
  mutable.splice(removedIndex, 1);
  const namesContainer = firstDirectChild(context.model.workbookDocument.documentElement, NS.spreadsheet, "definedNames");
  if (namesContainer) for (const name of [...directChildren(namesContainer, NS.spreadsheet, "definedName")]) {
    const local = Number(name.getAttribute("localSheetId"));
    if (local === removedIndex) name.parentNode?.removeChild(name);
    else if (Number.isInteger(local) && local > removedIndex) name.setAttribute("localSheetId", String(local - 1));
    else if (textContent(name).includes(quoted) || barePattern.test(textContent(name))) fail("UNSUPPORTED_FEATURE", `Cannot delete ${sheet.name}; defined name ${name.getAttribute("name")} references it.`);
  }
  context.documents.delete(sheet.partPath);
  context.changedSheets.delete(sheet.partPath);
  context.markWorkbookChanged();
  return { sheet: sheet.name, target: "deleted" };
}

function definedNamesContainer(context: AdvancedEditContext, create: boolean): Element | undefined {
  const root = context.model.workbookDocument.documentElement;
  const existing = firstDirectChild(root, NS.spreadsheet, "definedNames");
  if (existing || !create) return existing;
  return orderedWorkbookChild(context.model.workbookDocument, "definedNames");
}

function nameScope(context: AdvancedEditContext, sheetName: string | undefined): number | undefined {
  if (sheetName === undefined) return undefined;
  const index = context.model.sheets.findIndex((sheet) => sheet.name.toLowerCase() === sheetName.toLowerCase());
  if (index < 0) fail("INVALID_ARGUMENT", `Worksheet not found for defined name: ${sheetName}.`);
  return index;
}

function setDefinedName(operation: Extract<WorkbookOperation, { type: "setDefinedName" }>, context: AdvancedEditContext): AdvancedOperationResult {
  if (!/^[A-Za-z_\\][A-Za-z0-9_.\\]*$/.test(operation.name) || /^[A-Za-z]{1,3}[1-9][0-9]*$/.test(operation.name)) fail("INVALID_ARGUMENT", `Invalid defined name: ${operation.name}.`);
  const container = definedNamesContainer(context, true)!;
  const scope = nameScope(context, operation.sheet);
  let item = directChildren(container, NS.spreadsheet, "definedName").find((candidate) => candidate.getAttribute("name")?.toLowerCase() === operation.name.toLowerCase() && (candidate.getAttribute("localSheetId") ?? undefined) === (scope === undefined ? undefined : String(scope)));
  if (!item) item = appendElement(context.model.workbookDocument, container, NS.spreadsheet, "definedName");
  while (item.firstChild) item.removeChild(item.firstChild);
  item.setAttribute("name", operation.name);
  if (scope === undefined) item.removeAttribute("localSheetId"); else item.setAttribute("localSheetId", String(scope));
  if (operation.hidden !== undefined) item.setAttribute("hidden", bool(operation.hidden));
  if (operation.comment !== undefined) item.setAttribute("comment", operation.comment);
  item.appendChild(context.model.workbookDocument.createTextNode(assertSafeFormula(operation.formula)));
  context.markWorkbookChanged();
  return { sheet: operation.sheet, target: operation.name };
}

function deleteDefinedName(operation: Extract<WorkbookOperation, { type: "deleteDefinedName" }>, context: AdvancedEditContext): AdvancedOperationResult {
  const container = definedNamesContainer(context, false);
  if (!container) return { sheet: operation.sheet, target: operation.name };
  const scope = nameScope(context, operation.sheet);
  for (const item of [...directChildren(container, NS.spreadsheet, "definedName")]) {
    if (item.getAttribute("name")?.toLowerCase() === operation.name.toLowerCase() && (item.getAttribute("localSheetId") ?? undefined) === (scope === undefined ? undefined : String(scope))) item.parentNode?.removeChild(item);
  }
  if (directChildren(container, NS.spreadsheet, "definedName").length === 0) container.parentNode?.removeChild(container);
  context.markWorkbookChanged();
  return { sheet: operation.sheet, target: operation.name };
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

function setWorkbookProtection(operation: Extract<WorkbookOperation, { type: "setWorkbookProtection" }>, context: AdvancedEditContext): AdvancedOperationResult {
  const root = context.model.workbookDocument.documentElement;
  const existing = firstDirectChild(root, NS.spreadsheet, "workbookProtection");
  if (!operation.enabled) {
    existing?.parentNode?.removeChild(existing);
    context.warnings.push("Workbook protection was explicitly disabled; this is a destructive protection change.");
  } else {
    const protection = existing ?? orderedWorkbookChild(context.model.workbookDocument, "workbookProtection");
    for (const attribute of Array.from(protection.attributes)) protection.removeAttributeNode(attribute);
    protection.setAttribute("lockStructure", bool(operation.lockStructure ?? true));
    if (operation.lockWindows !== undefined) protection.setAttribute("lockWindows", bool(operation.lockWindows));
    if (operation.password !== undefined) protection.setAttribute("workbookPassword", legacyPasswordHash(operation.password));
    context.warnings.push(operation.password === undefined ? "Workbook protection enabled without a password." : "Workbook protection password was hashed in memory and redacted from results.");
  }
  context.markWorkbookChanged();
  return { target: "workbook-protection" };
}

function setCalculationSettings(operation: Extract<WorkbookOperation, { type: "setCalculationSettings" }>, context: AdvancedEditContext): AdvancedOperationResult {
  const calc = orderedWorkbookChild(context.model.workbookDocument, "calcPr");
  calc.setAttribute("calcMode", operation.mode);
  if (operation.iterate !== undefined) calc.setAttribute("iterate", bool(operation.iterate));
  if (operation.iterateCount !== undefined) calc.setAttribute("iterateCount", String(operation.iterateCount));
  if (operation.iterateDelta !== undefined) calc.setAttribute("iterateDelta", String(operation.iterateDelta));
  if (operation.fullCalcOnLoad !== undefined) calc.setAttribute("fullCalcOnLoad", bool(operation.fullCalcOnLoad));
  if (operation.forceFullCalc !== undefined) calc.setAttribute("forceFullCalc", bool(operation.forceFullCalc));
  context.warnings.push("Formula caches are preserved; the OOXML backend does not recalculate formulas or refresh external data.");
  context.markWorkbookChanged();
  return { target: "calculation-settings" };
}

function tableNameFromPart(context: AdvancedEditContext, partPath: string): string | undefined {
  const bytes = context.pkg.archive.get(partPath);
  if (!bytes) return undefined;
  const document = parseXml(bytes, partPath, context.pkg.archive.limits.maxXmlBytes);
  return document.documentElement.getAttribute("name") ?? document.documentElement.getAttribute("displayName") ?? undefined;
}

function cellAt(sheet: SheetDocumentContext, rowNumber: number, column: number): Element | undefined {
  const row = directChildren(sheet.sheetData, NS.spreadsheet, "row").find((item) => Number(item.getAttribute("r")) === rowNumber);
  return row ? directChildren(row, NS.spreadsheet, "c").find((cell) => {
    const reference = cell.getAttribute("r");
    return reference ? parseCellReference(reference).column === column : false;
  }) : undefined;
}

function addTable(operation: Extract<WorkbookOperation, { type: "addTable" }>, context: AdvancedEditContext): AdvancedOperationResult {
  if (!/^[A-Za-z_\\][A-Za-z0-9_.\\]*$/.test(operation.name) || /^[A-Za-z]{1,3}[1-9][0-9]*$/.test(operation.name)) fail("INVALID_ARGUMENT", `Invalid table name: ${operation.name}.`);
  for (const part of context.pkg.archive.entries.keys()) if (/^xl\/tables\/[^/]+\.xml$/i.test(part) && tableNameFromPart(context, part)?.toLowerCase() === operation.name.toLowerCase()) fail("INVALID_ARGUMENT", `Table name already exists: ${operation.name}.`);
  const bounds = parseRange(operation.range);
  if (bounds.endRow <= bounds.startRow) fail("INVALID_ARGUMENT", "A table requires a header row and at least one data row.");
  const sheet = context.documentFor(operation.sheet);
  const tablePart = nextPartPath(context.pkg, "xl/tables", "table", "xml");
  ensureContentType(context.pkg, tablePart, CONTENT_TYPES.table, context.allowedChangedParts);
  const relationship = addRelationship(context.pkg, sheet.sheet.partPath, TABLE_RELATIONSHIP_TYPE, tablePart, context.allowedChangedParts);
  const tableParts = (() => {
    let existing = firstDirectChild(sheet.document.documentElement, NS.spreadsheet, "tableParts");
    if (!existing) {
      existing = sheet.document.createElementNS(NS.spreadsheet, "tableParts");
      sheet.document.documentElement.appendChild(existing);
    }
    return existing;
  })();
  const tableRef = appendElement(sheet.document, tableParts, NS.spreadsheet, "tablePart");
  tableRef.setAttributeNS(NS.officeRelationships, "r:id", relationship.id);
  tableParts.setAttribute("count", String(directChildren(tableParts, NS.spreadsheet, "tablePart").length));
  const existingIds: number[] = [];
  for (const part of context.pkg.archive.entries.keys()) if (/^xl\/tables\/[^/]+\.xml$/i.test(part)) {
    const bytes = context.pkg.archive.get(part)!;
    const document = parseXml(bytes, part, context.pkg.archive.limits.maxXmlBytes);
    existingIds.push(Number(document.documentElement.getAttribute("id")) || 0);
  }
  const id = Math.max(0, ...existingIds) + 1;
  const tableDocument = xmlDocument(`<table xmlns="${NS.spreadsheet}" id="${id}" name="${operation.name}" displayName="${operation.displayName ?? operation.name}" ref="${formatRange(bounds)}" totalsRowShown="0"><autoFilter ref="${formatRange(bounds)}"/><tableColumns count="${bounds.endColumn - bounds.startColumn + 1}"/><tableStyleInfo name="${operation.styleName ?? "TableStyleMedium2"}" showFirstColumn="${bool(operation.showFirstColumn ?? false)}" showLastColumn="${bool(operation.showLastColumn ?? false)}" showRowStripes="${bool(operation.showRowStripes ?? true)}" showColumnStripes="${bool(operation.showColumnStripes ?? false)}"/></table>`, tablePart, context.pkg.archive.limits.maxXmlBytes);
  const columns = firstDirectChild(tableDocument.documentElement, NS.spreadsheet, "tableColumns")!;
  const usedHeaders = new Set<string>();
  for (let column = bounds.startColumn; column <= bounds.endColumn; column++) {
    const data = cellAt(sheet, bounds.startRow, column);
    const raw = data ? context.model.cellData(data)?.value : undefined;
    let header = raw === null || raw === undefined || String(raw).trim() === "" ? `Column${column - bounds.startColumn + 1}` : String(raw).slice(0, 255);
    let suffix = 2;
    const base = header;
    while (usedHeaders.has(header.toLowerCase())) header = `${base}_${suffix++}`.slice(0, 255);
    usedHeaders.add(header.toLowerCase());
    const item = appendElement(tableDocument, columns, NS.spreadsheet, "tableColumn");
    item.setAttribute("id", String(column - bounds.startColumn + 1));
    item.setAttribute("name", header);
  }
  context.pkg.archive.set(tablePart, serializeXml(tableDocument));
  context.allowedChangedParts.add(tablePart);
  context.changedSheets.add(sheet.sheet.partPath);
  return { sheet: sheet.sheet.name, target: operation.name, cells: rangeCellCount(bounds) };
}

function removeTable(operation: Extract<WorkbookOperation, { type: "removeTable" }>, context: AdvancedEditContext): AdvancedOperationResult {
  const sheet = context.documentFor(operation.sheet);
  const tableParts = firstDirectChild(sheet.document.documentElement, NS.spreadsheet, "tableParts");
  if (!tableParts) fail("INVALID_ARGUMENT", `Table not found: ${operation.name}.`);
  const relationships = context.baseline.relationshipsFrom(sheet.sheet.partPath).filter((relationship) => relationship.type === TABLE_RELATIONSHIP_TYPE);
  const match = relationships.find((relationship) => relationship.resolvedTarget && tableNameFromPart(context, relationship.resolvedTarget)?.toLowerCase() === operation.name.toLowerCase());
  if (!match?.resolvedTarget) fail("INVALID_ARGUMENT", `Table not found: ${operation.name}.`);
  const tableRef = directChildren(tableParts, NS.spreadsheet, "tablePart").find((item) => (item.getAttributeNS(NS.officeRelationships, "id") || item.getAttribute("r:id")) === match.id);
  tableRef?.parentNode?.removeChild(tableRef);
  const remaining = directChildren(tableParts, NS.spreadsheet, "tablePart").length;
  if (remaining === 0) tableParts.parentNode?.removeChild(tableParts); else tableParts.setAttribute("count", String(remaining));
  removeRelationship(context.pkg, sheet.sheet.partPath, match.id, context.allowedChangedParts);
  removeContentTypeOverride(context.pkg, match.resolvedTarget, context.allowedChangedParts);
  deletePart(context.pkg, match.resolvedTarget);
  context.allowedChangedParts.add(match.resolvedTarget);
  context.changedSheets.add(sheet.sheet.partPath);
  return { sheet: sheet.sheet.name, target: operation.name };
}

function setThemeColor(operation: Extract<WorkbookOperation, { type: "setThemeColor" }>, context: AdvancedEditContext): AdvancedOperationResult {
  const themeRelationship = context.baseline.relationshipsFrom(context.pkg.workbookPart).find((relationship) => relationship.type === RELATIONSHIP_TYPES.theme);
  const themePart = themeRelationship?.resolvedTarget ?? [...context.pkg.contentTypes.entries()].find(([, contentType]) => contentType === CONTENT_TYPES.theme)?.[0];
  if (!themePart) fail("UNSUPPORTED_FEATURE", "Workbook has no editable theme part; adding a theme implicitly is not supported.");
  assertPartMutable(context.pkg, themePart, "Theme editing");
  const document = parseXml(context.pkg.archive.require(themePart), themePart, context.pkg.archive.limits.maxXmlBytes);
  const scheme = elements(document, THEME_NS, "clrScheme")[0];
  if (!scheme) fail("INVALID_PACKAGE", `Theme part ${themePart} has no color scheme.`);
  const names: Record<typeof operation.slot, string> = { dark1: "dk1", light1: "lt1", dark2: "dk2", light2: "lt2", accent1: "accent1", accent2: "accent2", accent3: "accent3", accent4: "accent4", accent5: "accent5", accent6: "accent6", hyperlink: "hlink", followedHyperlink: "folHlink" };
  const slot = directChildren(scheme, THEME_NS, names[operation.slot])[0];
  if (!slot) fail("INVALID_PACKAGE", `Theme color slot is missing: ${operation.slot}.`);
  while (slot.firstChild) slot.removeChild(slot.firstChild);
  const color = appendElement(document, slot, THEME_NS, "a:srgbClr");
  color.setAttribute("val", normalizeColor(operation.color));
  context.pkg.archive.set(themePart, serializeXml(document));
  context.allowedChangedParts.add(themePart);
  return { target: `theme:${operation.slot}` };
}

export function applyAdvancedPackageOperation(operation: WorkbookOperation, context: AdvancedEditContext): AdvancedOperationResult | undefined {
  switch (operation.type) {
    case "setSheetProperties": return setSheetProperties(operation, context);
    case "createSheet": return createSheet(operation, context);
    case "deleteSheet": return deleteSheet(operation, context);
    case "setDefinedName": return setDefinedName(operation, context);
    case "deleteDefinedName": return deleteDefinedName(operation, context);
    case "setWorkbookProtection": return setWorkbookProtection(operation, context);
    case "setCalculationSettings": return setCalculationSettings(operation, context);
    case "addTable": return addTable(operation, context);
    case "removeTable": return removeTable(operation, context);
    case "setThemeColor": return setThemeColor(operation, context);
    default: return undefined;
  }
}
