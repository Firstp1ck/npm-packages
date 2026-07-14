import path from "node:path";
import type { WorkbookOperation } from "../contracts.ts";
import { fail } from "../errors.ts";
import { formatRange, parseCellReference, parseRange } from "./cell-ref.ts";
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
import { NS, appendElement, directChildren, elements, firstDirectChild, parseXml, serializeXml, textContent } from "./xml.ts";

const posix = path.posix;
const XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const DRAWING = "http://schemas.openxmlformats.org/drawingml/2006/main";
const CHART = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const VML = "urn:schemas-microsoft-com:vml";
const OFFICE = "urn:schemas-microsoft-com:office:office";
const EXCEL = "urn:schemas-microsoft-com:office:excel";
const COMMENTS_REL = RELATIONSHIP_TYPES.comments;
const VML_REL = RELATIONSHIP_TYPES.vmlDrawing;
const VML_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.vmlDrawing";

function xmlDocument(xml: string, partPath: string, maxBytes: number): Document {
  return parseXml(new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${xml}`), partPath, maxBytes);
}

function resolveTarget(sourcePart: string, target: string): string {
  return posix.normalize(posix.join(posix.dirname(sourcePart), target.replace(/^\//, "")));
}

function currentRelationship(context: AdvancedEditContext, sourcePart: string, id: string): { type: string; target: string; resolvedTarget?: string; targetMode?: string } | undefined {
  const relsPart = relsPartForSource(sourcePart);
  const bytes = context.pkg.archive.get(relsPart);
  if (!bytes) return undefined;
  const document = parseXml(bytes, relsPart, context.pkg.archive.limits.maxXmlBytes);
  const item = elements(document, NS.relationships, "Relationship").find((relationship) => relationship.getAttribute("Id") === id);
  if (!item) return undefined;
  const target = item.getAttribute("Target") ?? "";
  const targetMode = item.getAttribute("TargetMode") ?? undefined;
  return { type: item.getAttribute("Type") ?? "", target, targetMode, ...(targetMode?.toLowerCase() === "external" ? {} : { resolvedTarget: resolveTarget(sourcePart, target) }) };
}

function relationshipByType(context: AdvancedEditContext, sourcePart: string, type: string): { id: string; target: string; resolvedTarget?: string } | undefined {
  const relsPart = relsPartForSource(sourcePart);
  const bytes = context.pkg.archive.get(relsPart);
  if (!bytes) return undefined;
  const document = parseXml(bytes, relsPart, context.pkg.archive.limits.maxXmlBytes);
  const item = elements(document, NS.relationships, "Relationship").find((relationship) => relationship.getAttribute("Type") === type);
  if (!item) return undefined;
  const target = item.getAttribute("Target") ?? "";
  return { id: item.getAttribute("Id") ?? "", target, resolvedTarget: resolveTarget(sourcePart, target) };
}

function relationshipId(element: Element): string | undefined {
  return element.getAttributeNS(NS.officeRelationships, "id") || element.getAttribute("r:id") || undefined;
}

function ancestor(element: Element, namespace: string, localName: string): Element | undefined {
  let current: Node | null = element;
  while (current) {
    if (current.nodeType === 1 && (current as Element).namespaceURI === namespace && (current as Element).localName === localName) return current as Element;
    current = current.parentNode;
  }
  return undefined;
}

function appendAnchorMarker(document: Document, parent: Element, name: "xdr:from" | "xdr:to", row: number, column: number): void {
  const marker = appendElement(document, parent, XDR, name);
  for (const [childName, value] of [["xdr:col", column - 1], ["xdr:colOff", 0], ["xdr:row", row - 1], ["xdr:rowOff", 0]] as const) {
    const child = appendElement(document, marker, XDR, childName);
    child.appendChild(document.createTextNode(String(value)));
  }
}

function updateAnchorMarkers(anchor: Element, bounds: ReturnType<typeof parseRange>): void {
  const document = anchor.ownerDocument!;
  for (const marker of [...directChildren(anchor, XDR, "from"), ...directChildren(anchor, XDR, "to")]) anchor.removeChild(marker);
  const first = anchor.firstChild;
  const from = document.createElementNS(XDR, "xdr:from");
  const appendMarkerContents = (marker: Element, row: number, column: number) => {
    for (const [name, value] of [["xdr:col", column - 1], ["xdr:colOff", 0], ["xdr:row", row - 1], ["xdr:rowOff", 0]] as const) {
      const child = document.createElementNS(XDR, name);
      child.appendChild(document.createTextNode(String(value)));
      marker.appendChild(child);
    }
  };
  appendMarkerContents(from, bounds.startRow, bounds.startColumn);
  const to = document.createElementNS(XDR, "xdr:to");
  appendMarkerContents(to, bounds.endRow + 1, bounds.endColumn + 1);
  if (first) { anchor.insertBefore(to, first); anchor.insertBefore(from, to); } else { anchor.appendChild(from); anchor.appendChild(to); }
}

function insertWorksheetChildBeforeObjects(sheet: SheetDocumentContext, child: Element): void {
  const root = sheet.document.documentElement;
  const before = directChildren(root, NS.spreadsheet, "legacyDrawing")[0]
    ?? directChildren(root, NS.spreadsheet, "legacyDrawingHF")[0]
    ?? directChildren(root, NS.spreadsheet, "picture")[0]
    ?? directChildren(root, NS.spreadsheet, "oleObjects")[0]
    ?? directChildren(root, NS.spreadsheet, "controls")[0]
    ?? directChildren(root, NS.spreadsheet, "tableParts")[0]
    ?? directChildren(root, NS.spreadsheet, "extLst")[0];
  if (before) root.insertBefore(child, before); else root.appendChild(child);
}

function ensureDrawing(context: AdvancedEditContext, sheet: SheetDocumentContext): { partPath: string; document: Document } {
  const drawingRef = firstDirectChild(sheet.document.documentElement, NS.spreadsheet, "drawing");
  if (drawingRef) {
    const id = relationshipId(drawingRef);
    const relationship = id ? currentRelationship(context, sheet.sheet.partPath, id) : undefined;
    if (!relationship?.resolvedTarget || relationship.type !== RELATIONSHIP_TYPES.drawing) fail("INVALID_PACKAGE", `Worksheet drawing relationship is invalid on ${sheet.sheet.name}.`);
    assertPartMutable(context.pkg, relationship.resolvedTarget, "Drawing mutation");
    return { partPath: relationship.resolvedTarget, document: parseXml(context.pkg.archive.require(relationship.resolvedTarget), relationship.resolvedTarget, context.pkg.archive.limits.maxXmlBytes) };
  }
  const partPath = nextPartPath(context.pkg, "xl/drawings", "drawing", "xml");
  ensureContentType(context.pkg, partPath, CONTENT_TYPES.drawing, context.allowedChangedParts);
  const relationship = addRelationship(context.pkg, sheet.sheet.partPath, RELATIONSHIP_TYPES.drawing, partPath, context.allowedChangedParts);
  const reference = sheet.document.createElementNS(NS.spreadsheet, "drawing");
  reference.setAttributeNS(NS.officeRelationships, "r:id", relationship.id);
  insertWorksheetChildBeforeObjects(sheet, reference);
  context.changedSheets.add(sheet.sheet.partPath);
  const document = xmlDocument(`<xdr:wsDr xmlns:xdr="${XDR}" xmlns:a="${DRAWING}" xmlns:r="${NS.officeRelationships}"/>`, partPath, context.pkg.archive.limits.maxXmlBytes);
  context.pkg.archive.set(partPath, serializeXml(document));
  context.allowedChangedParts.add(partPath);
  return { partPath, document };
}

function nextDrawingId(document: Document): number {
  return Math.max(0, ...elements(document, XDR, "cNvPr").map((item) => Number(item.getAttribute("id"))).filter(Number.isFinite)) + 1;
}

function findDrawingObject(document: Document, name: string): Element | undefined {
  return elements(document, XDR, "cNvPr").find((item) => item.getAttribute("name")?.toLowerCase() === name.toLowerCase());
}

function addImage(operation: Extract<WorkbookOperation, { type: "addImage" }>, context: AdvancedEditContext): AdvancedOperationResult {
  const sheet = context.documentFor(operation.sheet);
  const bounds = parseRange(operation.range);
  let png: Uint8Array;
  try { png = new Uint8Array(Buffer.from(operation.pngBase64, "base64")); } catch { fail("INVALID_ARGUMENT", "pngBase64 is not valid base64."); }
  if (png.byteLength < 8 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => png[index] === byte)) fail("INVALID_ARGUMENT", "addImage accepts PNG bytes only.");
  if (png.byteLength > context.pkg.archive.limits.maxEntryBytes) fail("LIMIT_EXCEEDED", "PNG exceeds workbook per-entry limit.");
  const drawing = ensureDrawing(context, sheet);
  const existing = findDrawingObject(drawing.document, operation.name);
  if (existing) {
    const pic = ancestor(existing, XDR, "pic");
    const anchor = pic ? ancestor(pic, XDR, "twoCellAnchor") : undefined;
    const blip = pic ? elements(pic, DRAWING, "blip")[0] : undefined;
    const id = blip?.getAttributeNS(NS.officeRelationships, "embed") || blip?.getAttribute("r:embed");
    const relationship = id ? currentRelationship(context, drawing.partPath, id) : undefined;
    if (!anchor || !relationship?.resolvedTarget || relationship.type !== RELATIONSHIP_TYPES.image) fail("UNSUPPORTED_FEATURE", `Drawing object ${operation.name} is not a replaceable image.`);
    assertPartMutable(context.pkg, relationship.resolvedTarget, "Image replacement");
    context.pkg.archive.set(relationship.resolvedTarget, png);
    context.allowedChangedParts.add(relationship.resolvedTarget);
    existing.setAttribute("descr", operation.altText ?? "");
    updateAnchorMarkers(anchor, bounds);
    context.pkg.archive.set(drawing.partPath, serializeXml(drawing.document));
    context.allowedChangedParts.add(drawing.partPath);
    return { sheet: sheet.sheet.name, target: `${operation.name}:${formatRange(bounds)}` };
  }
  const mediaPart = nextPartPath(context.pkg, "xl/media", "image", "png");
  ensureContentType(context.pkg, mediaPart, CONTENT_TYPES.png, context.allowedChangedParts, "png");
  context.pkg.archive.set(mediaPart, png);
  context.allowedChangedParts.add(mediaPart);
  const imageRelationship = addRelationship(context.pkg, drawing.partPath, RELATIONSHIP_TYPES.image, mediaPart, context.allowedChangedParts);
  const anchor = appendElement(drawing.document, drawing.document.documentElement, XDR, "xdr:twoCellAnchor");
  appendAnchorMarker(drawing.document, anchor, "xdr:from", bounds.startRow, bounds.startColumn);
  appendAnchorMarker(drawing.document, anchor, "xdr:to", bounds.endRow + 1, bounds.endColumn + 1);
  const pic = appendElement(drawing.document, anchor, XDR, "xdr:pic");
  const nv = appendElement(drawing.document, pic, XDR, "xdr:nvPicPr");
  const cNvPr = appendElement(drawing.document, nv, XDR, "xdr:cNvPr");
  cNvPr.setAttribute("id", String(nextDrawingId(drawing.document)));
  cNvPr.setAttribute("name", operation.name);
  if (operation.altText) cNvPr.setAttribute("descr", operation.altText);
  appendElement(drawing.document, nv, XDR, "xdr:cNvPicPr");
  const blipFill = appendElement(drawing.document, pic, XDR, "xdr:blipFill");
  const blip = appendElement(drawing.document, blipFill, DRAWING, "a:blip");
  blip.setAttributeNS(NS.officeRelationships, "r:embed", imageRelationship.id);
  const stretch = appendElement(drawing.document, blipFill, DRAWING, "a:stretch");
  appendElement(drawing.document, stretch, DRAWING, "a:fillRect");
  const shape = appendElement(drawing.document, pic, XDR, "xdr:spPr");
  const geometry = appendElement(drawing.document, shape, DRAWING, "a:prstGeom");
  geometry.setAttribute("prst", "rect");
  appendElement(drawing.document, geometry, DRAWING, "a:avLst");
  appendElement(drawing.document, anchor, XDR, "xdr:clientData");
  context.pkg.archive.set(drawing.partPath, serializeXml(drawing.document));
  context.allowedChangedParts.add(drawing.partPath);
  return { sheet: sheet.sheet.name, target: `${operation.name}:${formatRange(bounds)}` };
}

function absoluteRange(sheetName: string, range: string): string {
  const bounds = parseRange(range);
  const reference = formatRange(bounds).replace(/([A-Z]+)([0-9]+)/g, "$$$1$$$2");
  return `'${sheetName.replace(/'/g, "''")}'!${reference}`;
}

function chartTitle(document: Document, parent: Element, value: string): void {
  const title = appendElement(document, parent, CHART, "c:title");
  const tx = appendElement(document, title, CHART, "c:tx");
  const rich = appendElement(document, tx, CHART, "c:rich");
  appendElement(document, rich, DRAWING, "a:bodyPr");
  appendElement(document, rich, DRAWING, "a:lstStyle");
  const paragraph = appendElement(document, rich, DRAWING, "a:p");
  const run = appendElement(document, paragraph, DRAWING, "a:r");
  const properties = appendElement(document, run, DRAWING, "a:rPr");
  properties.setAttribute("lang", "en-US");
  const text = appendElement(document, run, DRAWING, "a:t");
  text.appendChild(document.createTextNode(value));
  appendElement(document, paragraph, DRAWING, "a:endParaRPr").setAttribute("lang", "en-US");
}

function valueElement(document: Document, parent: Element, name: string, value: string | number): Element {
  const element = appendElement(document, parent, CHART, name);
  element.setAttribute("val", String(value));
  return element;
}

function addSeries(document: Document, chart: Element, sheetName: string, categories: string, values: string): void {
  const series = appendElement(document, chart, CHART, "c:ser");
  valueElement(document, series, "c:idx", 0);
  valueElement(document, series, "c:order", 0);
  const tx = appendElement(document, series, CHART, "c:tx");
  appendElement(document, tx, CHART, "c:v").appendChild(document.createTextNode("Series 1"));
  const cat = appendElement(document, series, CHART, "c:cat");
  const strRef = appendElement(document, cat, CHART, "c:strRef");
  appendElement(document, strRef, CHART, "c:f").appendChild(document.createTextNode(absoluteRange(sheetName, categories)));
  const val = appendElement(document, series, CHART, "c:val");
  const numRef = appendElement(document, val, CHART, "c:numRef");
  appendElement(document, numRef, CHART, "c:f").appendChild(document.createTextNode(absoluteRange(sheetName, values)));
}

function createChartDocument(operation: Extract<WorkbookOperation, { type: "addChart" }>, maxBytes: number, partPath: string): Document {
  const document = xmlDocument(`<c:chartSpace xmlns:c="${CHART}" xmlns:a="${DRAWING}" xmlns:r="${NS.officeRelationships}"/>`, partPath, maxBytes);
  const chartSpace = document.documentElement;
  valueElement(document, chartSpace, "c:style", operation.style ?? 2);
  const chart = appendElement(document, chartSpace, CHART, "c:chart");
  if (operation.title) chartTitle(document, chart, operation.title);
  const plotArea = appendElement(document, chart, CHART, "c:plotArea");
  appendElement(document, plotArea, CHART, "c:layout");
  const chartName = operation.chartType === "column" || operation.chartType === "bar" ? "barChart" : `${operation.chartType}Chart`;
  const chartElement = appendElement(document, plotArea, CHART, `c:${chartName}`);
  if (operation.chartType === "column" || operation.chartType === "bar") {
    valueElement(document, chartElement, "c:barDir", operation.chartType === "column" ? "col" : "bar");
    valueElement(document, chartElement, "c:grouping", "clustered");
    valueElement(document, chartElement, "c:varyColors", 0);
  } else if (operation.chartType === "line" || operation.chartType === "area") {
    valueElement(document, chartElement, "c:grouping", "standard");
    valueElement(document, chartElement, "c:varyColors", 0);
  } else valueElement(document, chartElement, "c:varyColors", 1);
  addSeries(document, chartElement, operation.sheet, operation.categoryRange, operation.valueRange);
  if (operation.chartType !== "pie") {
    valueElement(document, chartElement, "c:axId", 48650112);
    valueElement(document, chartElement, "c:axId", 48672768);
    const catAxis = appendElement(document, plotArea, CHART, "c:catAx");
    valueElement(document, catAxis, "c:axId", 48650112);
    const scaling = appendElement(document, catAxis, CHART, "c:scaling");
    valueElement(document, scaling, "c:orientation", "minMax");
    valueElement(document, catAxis, "c:delete", 0);
    valueElement(document, catAxis, "c:axPos", operation.chartType === "bar" ? "l" : "b");
    valueElement(document, catAxis, "c:tickLblPos", "nextTo");
    valueElement(document, catAxis, "c:crossAx", 48672768);
    valueElement(document, catAxis, "c:crosses", "autoZero");
    valueElement(document, catAxis, "c:auto", 1);
    valueElement(document, catAxis, "c:lblAlgn", "ctr");
    valueElement(document, catAxis, "c:lblOffset", 100);
    const valAxis = appendElement(document, plotArea, CHART, "c:valAx");
    valueElement(document, valAxis, "c:axId", 48672768);
    const valScaling = appendElement(document, valAxis, CHART, "c:scaling");
    valueElement(document, valScaling, "c:orientation", "minMax");
    valueElement(document, valAxis, "c:delete", 0);
    valueElement(document, valAxis, "c:axPos", operation.chartType === "bar" ? "b" : "l");
    valueElement(document, valAxis, "c:numFmt", "General").setAttribute("sourceLinked", "1");
    valueElement(document, valAxis, "c:tickLblPos", "nextTo");
    valueElement(document, valAxis, "c:crossAx", 48650112);
    valueElement(document, valAxis, "c:crosses", "autoZero");
    valueElement(document, valAxis, "c:crossBetween", "between");
  }
  valueElement(document, chart, "c:plotVisOnly", 1);
  valueElement(document, chart, "c:dispBlanksAs", "gap");
  valueElement(document, chart, "c:showDLblsOverMax", 0);
  return document;
}

function addChart(operation: Extract<WorkbookOperation, { type: "addChart" }>, context: AdvancedEditContext): AdvancedOperationResult {
  const sheet = context.documentFor(operation.sheet);
  const drawing = ensureDrawing(context, sheet);
  if (findDrawingObject(drawing.document, operation.name)) fail("INVALID_ARGUMENT", `Drawing object already exists: ${operation.name}. Use updateChart for an existing chart.`);
  const chartPart = nextPartPath(context.pkg, "xl/charts", "chart", "xml");
  ensureContentType(context.pkg, chartPart, CONTENT_TYPES.chart, context.allowedChangedParts);
  const chartRelationship = addRelationship(context.pkg, drawing.partPath, RELATIONSHIP_TYPES.chart, chartPart, context.allowedChangedParts);
  const chartDocument = createChartDocument(operation, context.pkg.archive.limits.maxXmlBytes, chartPart);
  context.pkg.archive.set(chartPart, serializeXml(chartDocument));
  context.allowedChangedParts.add(chartPart);
  const bounds = parseRange(operation.range);
  const anchor = appendElement(drawing.document, drawing.document.documentElement, XDR, "xdr:twoCellAnchor");
  appendAnchorMarker(drawing.document, anchor, "xdr:from", bounds.startRow, bounds.startColumn);
  appendAnchorMarker(drawing.document, anchor, "xdr:to", bounds.endRow + 1, bounds.endColumn + 1);
  const frame = appendElement(drawing.document, anchor, XDR, "xdr:graphicFrame");
  frame.setAttribute("macro", "");
  const nv = appendElement(drawing.document, frame, XDR, "xdr:nvGraphicFramePr");
  const cNvPr = appendElement(drawing.document, nv, XDR, "xdr:cNvPr");
  cNvPr.setAttribute("id", String(nextDrawingId(drawing.document)));
  cNvPr.setAttribute("name", operation.name);
  appendElement(drawing.document, nv, XDR, "xdr:cNvGraphicFramePr");
  const transform = appendElement(drawing.document, frame, XDR, "xdr:xfrm");
  const off = appendElement(drawing.document, transform, DRAWING, "a:off"); off.setAttribute("x", "0"); off.setAttribute("y", "0");
  const ext = appendElement(drawing.document, transform, DRAWING, "a:ext"); ext.setAttribute("cx", "0"); ext.setAttribute("cy", "0");
  const graphic = appendElement(drawing.document, frame, DRAWING, "a:graphic");
  const data = appendElement(drawing.document, graphic, DRAWING, "a:graphicData");
  data.setAttribute("uri", CHART);
  const chart = appendElement(drawing.document, data, CHART, "c:chart");
  chart.setAttributeNS(NS.officeRelationships, "r:id", chartRelationship.id);
  appendElement(drawing.document, anchor, XDR, "xdr:clientData");
  context.pkg.archive.set(drawing.partPath, serializeXml(drawing.document));
  context.allowedChangedParts.add(drawing.partPath);
  return { sheet: sheet.sheet.name, target: `${operation.name}:${formatRange(bounds)}` };
}

function replaceChartTitle(document: Document, title: string | undefined): void {
  if (title === undefined) return;
  const chart = elements(document, CHART, "chart")[0];
  if (!chart) fail("INVALID_PACKAGE", "Chart part has no chart element.");
  const existing = firstDirectChild(chart, CHART, "title");
  existing?.parentNode?.removeChild(existing);
  if (title) {
    const plotArea = firstDirectChild(chart, CHART, "plotArea");
    const placeholder = document.createElementNS(CHART, "c:placeholder");
    if (plotArea) chart.insertBefore(placeholder, plotArea); else chart.appendChild(placeholder);
    chartTitle(document, chart, title);
    const inserted = firstDirectChild(chart, CHART, "title")!;
    chart.removeChild(inserted);
    chart.insertBefore(inserted, placeholder);
    chart.removeChild(placeholder);
  }
}

function updateChart(operation: Extract<WorkbookOperation, { type: "updateChart" }>, context: AdvancedEditContext): AdvancedOperationResult {
  const sheet = context.documentFor(operation.sheet);
  const drawing = ensureDrawing(context, sheet);
  const named = findDrawingObject(drawing.document, operation.name);
  const frame = named ? ancestor(named, XDR, "graphicFrame") : undefined;
  const chartRef = frame ? elements(frame, CHART, "chart")[0] : undefined;
  const id = chartRef?.getAttributeNS(NS.officeRelationships, "id") || chartRef?.getAttribute("r:id");
  const relationship = id ? currentRelationship(context, drawing.partPath, id) : undefined;
  if (!relationship?.resolvedTarget || relationship.type !== RELATIONSHIP_TYPES.chart) fail("INVALID_ARGUMENT", `Chart not found: ${operation.name}.`);
  assertPartMutable(context.pkg, relationship.resolvedTarget, "Chart update");
  const document = parseXml(context.pkg.archive.require(relationship.resolvedTarget), relationship.resolvedTarget, context.pkg.archive.limits.maxXmlBytes);
  if (operation.style !== undefined) {
    const style = elements(document, CHART, "style")[0] ?? document.documentElement.insertBefore(document.createElementNS(CHART, "c:style"), document.documentElement.firstChild) as Element;
    style.setAttribute("val", String(operation.style));
  }
  replaceChartTitle(document, operation.title);
  if (operation.categoryRange !== undefined) {
    const cat = elements(document, CHART, "cat")[0];
    const formula = cat ? elements(cat, CHART, "f")[0] : undefined;
    if (!formula) fail("UNSUPPORTED_FEATURE", "Chart has no editable category formula.");
    formula.textContent = absoluteRange(sheet.sheet.name, operation.categoryRange);
  }
  if (operation.valueRange !== undefined) {
    const val = elements(document, CHART, "val")[0];
    const formula = val ? elements(val, CHART, "f")[0] : undefined;
    if (!formula) fail("UNSUPPORTED_FEATURE", "Chart has no editable value formula.");
    formula.textContent = absoluteRange(sheet.sheet.name, operation.valueRange);
  }
  context.pkg.archive.set(relationship.resolvedTarget, serializeXml(document));
  context.allowedChangedParts.add(relationship.resolvedTarget);
  return { sheet: sheet.sheet.name, target: operation.name };
}

function ensureComments(context: AdvancedEditContext, sheet: SheetDocumentContext): { commentsPart: string; comments: Document; vmlPart: string; vml: Document } {
  const relsPart = relsPartForSource(sheet.sheet.partPath);
  const relBytes = context.pkg.archive.get(relsPart);
  if (relBytes) {
    const relDocument = parseXml(relBytes, relsPart, context.pkg.archive.limits.maxXmlBytes);
    if (elements(relDocument, NS.relationships, "Relationship").some((item) => /threadedComment/i.test(item.getAttribute("Type") ?? ""))) fail("UNSUPPORTED_FEATURE", "Threaded comments are preservation-only; note mutation is rejected on this worksheet.");
  }
  let commentsRel = relationshipByType(context, sheet.sheet.partPath, COMMENTS_REL);
  let vmlRel = relationshipByType(context, sheet.sheet.partPath, VML_REL);
  if (!commentsRel?.resolvedTarget) {
    const commentsPart = nextPartPath(context.pkg, "xl", "comments", "xml");
    ensureContentType(context.pkg, commentsPart, CONTENT_TYPES.comments, context.allowedChangedParts);
    const added = addRelationship(context.pkg, sheet.sheet.partPath, COMMENTS_REL, commentsPart, context.allowedChangedParts);
    commentsRel = { id: added.id, target: commentsPart, resolvedTarget: commentsPart };
    const comments = xmlDocument(`<comments xmlns="${NS.spreadsheet}"><authors/><commentList/></comments>`, commentsPart, context.pkg.archive.limits.maxXmlBytes);
    context.pkg.archive.set(commentsPart, serializeXml(comments));
    context.allowedChangedParts.add(commentsPart);
  }
  if (!vmlRel?.resolvedTarget) {
    const vmlPart = nextPartPath(context.pkg, "xl/drawings", "vmlDrawing", "vml");
    ensureContentType(context.pkg, vmlPart, VML_CONTENT_TYPE, context.allowedChangedParts, "vml");
    const added = addRelationship(context.pkg, sheet.sheet.partPath, VML_REL, vmlPart, context.allowedChangedParts);
    vmlRel = { id: added.id, target: vmlPart, resolvedTarget: vmlPart };
    const vml = xmlDocument(`<xml xmlns:v="${VML}" xmlns:o="${OFFICE}" xmlns:x="${EXCEL}"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype></xml>`, vmlPart, context.pkg.archive.limits.maxXmlBytes);
    context.pkg.archive.set(vmlPart, serializeXml(vml));
    context.allowedChangedParts.add(vmlPart);
    const legacy = sheet.document.createElementNS(NS.spreadsheet, "legacyDrawing");
    legacy.setAttributeNS(NS.officeRelationships, "r:id", added.id);
    insertWorksheetChildBeforeObjects(sheet, legacy);
    context.changedSheets.add(sheet.sheet.partPath);
  }
  if (!commentsRel?.resolvedTarget || !vmlRel?.resolvedTarget) fail("INVALID_PACKAGE", "Comment relationships could not be created.");
  const commentsPart = commentsRel.resolvedTarget;
  const vmlPart = vmlRel.resolvedTarget;
  return {
    commentsPart,
    comments: parseXml(context.pkg.archive.require(commentsPart), commentsPart, context.pkg.archive.limits.maxXmlBytes),
    vmlPart,
    vml: parseXml(context.pkg.archive.require(vmlPart), vmlPart, context.pkg.archive.limits.maxXmlBytes),
  };
}

function addVmlCommentShape(vml: Document, row: number, column: number): void {
  if (elements(vml, EXCEL, "ClientData").some((data) => Number(textContent(firstDirectChild(data, EXCEL, "Row"))) === row - 1 && Number(textContent(firstDirectChild(data, EXCEL, "Column"))) === column - 1)) return;
  const shape = appendElement(vml, vml.documentElement, VML, "v:shape");
  const id = 1024 + elements(vml, VML, "shape").length;
  shape.setAttribute("id", `_x0000_s${id}`);
  shape.setAttribute("type", "#_x0000_t202");
  shape.setAttribute("style", "position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:108pt;height:59.25pt;z-index:1;visibility:hidden");
  shape.setAttribute("fillcolor", "#ffffe1");
  shape.setAttributeNS(OFFICE, "o:insetmode", "auto");
  const fill = appendElement(vml, shape, VML, "v:fill"); fill.setAttribute("color2", "#ffffe1");
  const shadow = appendElement(vml, shape, VML, "v:shadow"); shadow.setAttribute("on", "t"); shadow.setAttribute("color", "black"); shadow.setAttribute("obscured", "t");
  appendElement(vml, shape, VML, "v:path").setAttributeNS(OFFICE, "o:connecttype", "none");
  const textbox = appendElement(vml, shape, VML, "v:textbox"); textbox.setAttribute("style", "mso-direction-alt:auto");
  appendElement(vml, textbox, "http://www.w3.org/1999/xhtml", "div").setAttribute("style", "text-align:left");
  const data = appendElement(vml, shape, EXCEL, "x:ClientData"); data.setAttribute("ObjectType", "Note");
  appendElement(vml, data, EXCEL, "x:MoveWithCells");
  appendElement(vml, data, EXCEL, "x:SizeWithCells");
  appendElement(vml, data, EXCEL, "x:Anchor").appendChild(vml.createTextNode(`${column - 1}, 15, ${row - 1}, 2, ${column + 1}, 15, ${row + 3}, 4`));
  appendElement(vml, data, EXCEL, "x:AutoFill").appendChild(vml.createTextNode("False"));
  appendElement(vml, data, EXCEL, "x:Row").appendChild(vml.createTextNode(String(row - 1)));
  appendElement(vml, data, EXCEL, "x:Column").appendChild(vml.createTextNode(String(column - 1)));
}

function setComment(operation: Extract<WorkbookOperation, { type: "setComment" }>, context: AdvancedEditContext): AdvancedOperationResult {
  const address = parseCellReference(operation.cell);
  const sheet = context.documentFor(operation.sheet);
  const bundle = ensureComments(context, sheet);
  const authors = firstDirectChild(bundle.comments.documentElement, NS.spreadsheet, "authors")!;
  const authorElements = directChildren(authors, NS.spreadsheet, "author");
  let authorId = authorElements.findIndex((item) => textContent(item) === operation.author);
  if (authorId < 0) {
    const author = appendElement(bundle.comments, authors, NS.spreadsheet, "author");
    author.appendChild(bundle.comments.createTextNode(operation.author));
    authorId = authorElements.length;
  }
  const list = firstDirectChild(bundle.comments.documentElement, NS.spreadsheet, "commentList")!;
  const reference = operation.cell.toUpperCase();
  let comment = directChildren(list, NS.spreadsheet, "comment").find((item) => item.getAttribute("ref")?.toUpperCase() === reference);
  if (!comment) comment = appendElement(bundle.comments, list, NS.spreadsheet, "comment");
  while (comment.firstChild) comment.removeChild(comment.firstChild);
  comment.setAttribute("ref", reference);
  comment.setAttribute("authorId", String(authorId));
  const text = appendElement(bundle.comments, comment, NS.spreadsheet, "text");
  const value = appendElement(bundle.comments, text, NS.spreadsheet, "t");
  if (/^\s|\s$/.test(operation.text)) value.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
  value.appendChild(bundle.comments.createTextNode(operation.text));
  addVmlCommentShape(bundle.vml, address.row, address.column);
  context.pkg.archive.set(bundle.commentsPart, serializeXml(bundle.comments));
  context.pkg.archive.set(bundle.vmlPart, serializeXml(bundle.vml));
  context.allowedChangedParts.add(bundle.commentsPart);
  context.allowedChangedParts.add(bundle.vmlPart);
  return { sheet: sheet.sheet.name, target: reference };
}

function removeComment(operation: Extract<WorkbookOperation, { type: "removeComment" }>, context: AdvancedEditContext): AdvancedOperationResult {
  const sheet = context.documentFor(operation.sheet);
  const commentsRel = relationshipByType(context, sheet.sheet.partPath, COMMENTS_REL);
  const vmlRel = relationshipByType(context, sheet.sheet.partPath, VML_REL);
  if (!commentsRel?.resolvedTarget) return { sheet: sheet.sheet.name, target: operation.cell.toUpperCase() };
  const document = parseXml(context.pkg.archive.require(commentsRel.resolvedTarget), commentsRel.resolvedTarget, context.pkg.archive.limits.maxXmlBytes);
  const list = firstDirectChild(document.documentElement, NS.spreadsheet, "commentList")!;
  for (const comment of directChildren(list, NS.spreadsheet, "comment")) if (comment.getAttribute("ref")?.toUpperCase() === operation.cell.toUpperCase()) comment.parentNode?.removeChild(comment);
  if (vmlRel?.resolvedTarget && context.pkg.archive.get(vmlRel.resolvedTarget)) {
    const address = parseCellReference(operation.cell);
    const vml = parseXml(context.pkg.archive.require(vmlRel.resolvedTarget), vmlRel.resolvedTarget, context.pkg.archive.limits.maxXmlBytes);
    for (const data of elements(vml, EXCEL, "ClientData")) if (Number(textContent(firstDirectChild(data, EXCEL, "Row"))) === address.row - 1 && Number(textContent(firstDirectChild(data, EXCEL, "Column"))) === address.column - 1) ancestor(data, VML, "shape")?.parentNode?.removeChild(ancestor(data, VML, "shape")!);
    context.pkg.archive.set(vmlRel.resolvedTarget, serializeXml(vml));
    context.allowedChangedParts.add(vmlRel.resolvedTarget);
  }
  if (directChildren(list, NS.spreadsheet, "comment").length === 0) {
    removeRelationship(context.pkg, sheet.sheet.partPath, commentsRel.id, context.allowedChangedParts);
    removeContentTypeOverride(context.pkg, commentsRel.resolvedTarget, context.allowedChangedParts);
    deletePart(context.pkg, commentsRel.resolvedTarget);
    context.allowedChangedParts.add(commentsRel.resolvedTarget);
  } else {
    context.pkg.archive.set(commentsRel.resolvedTarget, serializeXml(document));
    context.allowedChangedParts.add(commentsRel.resolvedTarget);
  }
  return { sheet: sheet.sheet.name, target: operation.cell.toUpperCase() };
}

export function applyAdvancedObjectOperation(operation: WorkbookOperation, context: AdvancedEditContext): AdvancedOperationResult | undefined {
  switch (operation.type) {
    case "addImage": return addImage(operation, context);
    case "addChart": return addChart(operation, context);
    case "updateChart": return updateChart(operation, context);
    case "setComment": return setComment(operation, context);
    case "removeComment": return removeComment(operation, context);
    default: return undefined;
  }
}
