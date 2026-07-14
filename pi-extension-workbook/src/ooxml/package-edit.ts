import path from "node:path";
import { fail } from "../errors.ts";
import { OoxmlPackage } from "./package.ts";
import { NS, appendElement, elements, parseXml, serializeXml } from "./xml.ts";

const posix = path.posix;
const RELS_CONTENT_TYPE = "application/vnd.openxmlformats-package.relationships+xml";

export function relsPartForSource(sourcePart: string): string {
  if (!sourcePart) return "_rels/.rels";
  return `${posix.dirname(sourcePart)}/_rels/${posix.basename(sourcePart)}.rels`;
}

export function assertPartMutable(pkg: OoxmlPackage, partPath: string, operation: string): void {
  if (pkg.protectedParts.has(partPath)) {
    fail("UNSUPPORTED_FEATURE", `${operation} would change protected OOXML part ${partPath}; the operation is rejected for this workbook.`);
  }
}

function relationshipTarget(sourcePart: string, targetPart: string): string {
  const base = sourcePart ? posix.dirname(sourcePart) : "";
  return posix.relative(base, targetPart).replace(/\\/g, "/") || posix.basename(targetPart);
}

function relationshipDocument(pkg: OoxmlPackage, sourcePart: string): { partPath: string; document: Document } {
  const partPath = relsPartForSource(sourcePart);
  const bytes = pkg.archive.get(partPath);
  if (bytes) {
    assertPartMutable(pkg, partPath, "Relationship mutation");
    return { partPath, document: parseXml(bytes, partPath, pkg.archive.limits.maxXmlBytes) };
  }
  const document = documentFromRoot(NS.relationships, "Relationships");
  return { partPath, document };
}

function documentFromRoot(namespace: string, rootName: string): Document {
  const bytes = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${rootName} xmlns="${namespace}"/>`);
  return parseXml(bytes, rootName, 4096);
}

export function addRelationship(
  pkg: OoxmlPackage,
  sourcePart: string,
  type: string,
  targetPart: string,
  allowedChangedParts: Set<string>,
  targetMode?: "External",
): { id: string; relsPart: string } {
  const { partPath, document } = relationshipDocument(pkg, sourcePart);
  const existing = elements(document, NS.relationships, "Relationship");
  const target = targetMode ? targetPart : relationshipTarget(sourcePart, targetPart);
  const duplicate = existing.find((item) => item.getAttribute("Type") === type && item.getAttribute("Target") === target && (item.getAttribute("TargetMode") || undefined) === targetMode);
  if (duplicate) return { id: duplicate.getAttribute("Id")!, relsPart: partPath };
  const used = new Set(existing.map((item) => item.getAttribute("Id") ?? ""));
  let index = 1;
  while (used.has(`rId${index}`)) index++;
  const id = `rId${index}`;
  const relationship = appendElement(document, document.documentElement, NS.relationships, "Relationship");
  relationship.setAttribute("Id", id);
  relationship.setAttribute("Type", type);
  relationship.setAttribute("Target", target);
  if (targetMode) relationship.setAttribute("TargetMode", targetMode);
  pkg.archive.set(partPath, serializeXml(document));
  allowedChangedParts.add(partPath);
  return { id, relsPart: partPath };
}

export function removeRelationship(pkg: OoxmlPackage, sourcePart: string, id: string, allowedChangedParts: Set<string>): void {
  const partPath = relsPartForSource(sourcePart);
  const bytes = pkg.archive.get(partPath);
  if (!bytes) return;
  assertPartMutable(pkg, partPath, "Relationship mutation");
  const document = parseXml(bytes, partPath, pkg.archive.limits.maxXmlBytes);
  for (const relationship of elements(document, NS.relationships, "Relationship")) {
    if (relationship.getAttribute("Id") === id) relationship.parentNode?.removeChild(relationship);
  }
  pkg.archive.set(partPath, serializeXml(document));
  allowedChangedParts.add(partPath);
}

export function ensureContentType(
  pkg: OoxmlPackage,
  partPath: string,
  contentType: string,
  allowedChangedParts: Set<string>,
  preferDefaultExtension?: string,
): void {
  const contentTypesPart = "[Content_Types].xml";
  assertPartMutable(pkg, contentTypesPart, `Adding ${partPath}`);
  const document = parseXml(pkg.archive.require(contentTypesPart), contentTypesPart, pkg.archive.limits.maxXmlBytes);
  const root = document.documentElement;
  if (preferDefaultExtension) {
    const extension = preferDefaultExtension.replace(/^\./, "").toLowerCase();
    const existing = elements(document, NS.contentTypes, "Default").find((item) => item.getAttribute("Extension")?.toLowerCase() === extension);
    if (existing) {
      if (existing.getAttribute("ContentType") !== contentType) fail("UNSUPPORTED_FEATURE", `Content type conflict for .${extension}.`);
      return;
    }
    const item = appendElement(document, root, NS.contentTypes, "Default");
    item.setAttribute("Extension", extension);
    item.setAttribute("ContentType", contentType);
  } else {
    const normalized = `/${partPath.replace(/^\//, "")}`;
    const existing = elements(document, NS.contentTypes, "Override").find((item) => item.getAttribute("PartName") === normalized);
    if (existing) {
      if (existing.getAttribute("ContentType") !== contentType) fail("UNSUPPORTED_FEATURE", `Content type conflict for ${partPath}.`);
      return;
    }
    const item = appendElement(document, root, NS.contentTypes, "Override");
    item.setAttribute("PartName", normalized);
    item.setAttribute("ContentType", contentType);
  }
  pkg.archive.set(contentTypesPart, serializeXml(document));
  allowedChangedParts.add(contentTypesPart);
}

export function removeContentTypeOverride(pkg: OoxmlPackage, partPath: string, allowedChangedParts: Set<string>): void {
  const contentTypesPart = "[Content_Types].xml";
  assertPartMutable(pkg, contentTypesPart, `Removing ${partPath}`);
  const document = parseXml(pkg.archive.require(contentTypesPart), contentTypesPart, pkg.archive.limits.maxXmlBytes);
  const normalized = `/${partPath.replace(/^\//, "")}`;
  let changed = false;
  for (const item of elements(document, NS.contentTypes, "Override")) {
    if (item.getAttribute("PartName") === normalized) {
      item.parentNode?.removeChild(item);
      changed = true;
    }
  }
  if (changed) {
    pkg.archive.set(contentTypesPart, serializeXml(document));
    allowedChangedParts.add(contentTypesPart);
  }
}

export function nextPartPath(pkg: OoxmlPackage, directory: string, stem: string, extension: string): string {
  let index = 1;
  while (pkg.archive.get(`${directory}/${stem}${index}.${extension}`)) index++;
  return `${directory}/${stem}${index}.${extension}`;
}

export function deletePart(pkg: OoxmlPackage, partPath: string): void {
  assertPartMutable(pkg, partPath, `Removing ${partPath}`);
  pkg.archive.delete(partPath);
}

export const RELATIONSHIP_TYPES = Object.freeze({
  worksheet: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
  comments: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
  vmlDrawing: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing",
  table: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/table",
  hyperlink: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
  drawing: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
  image: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  chart: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
  theme: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
});

export const CONTENT_TYPES = Object.freeze({
  relationships: RELS_CONTENT_TYPE,
  worksheet: "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
  comments: "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml",
  table: "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml",
  drawing: "application/vnd.openxmlformats-officedocument.drawing+xml",
  chart: "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
  png: "image/png",
  theme: "application/vnd.openxmlformats-officedocument.theme+xml",
});
