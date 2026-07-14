import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { fail } from "../errors.ts";

export const NS = Object.freeze({
  contentTypes: "http://schemas.openxmlformats.org/package/2006/content-types",
  relationships: "http://schemas.openxmlformats.org/package/2006/relationships",
  word: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  officeRelationships: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  word14: "http://schemas.microsoft.com/office/word/2010/wordml",
  core: "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
  dc: "http://purl.org/dc/elements/1.1/",
  dcterms: "http://purl.org/dc/terms/",
  extended: "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
});
const decoder = new TextDecoder("utf-8", { fatal: true }), encoder = new TextEncoder();
export function decodeXml(bytes: Uint8Array, partPath: string, maxBytes: number): string {
  if (bytes.length > maxBytes) fail("LIMIT_EXCEEDED", `XML part ${partPath} exceeds ${maxBytes} bytes.`);
  try { const text = decoder.decode(bytes); if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail("INVALID_PACKAGE", `DTD/entity declarations are forbidden in ${partPath}.`); return text; }
  catch (error) { if (error && typeof error === "object" && "code" in error) throw error; fail("INVALID_PACKAGE", `${partPath} is not valid UTF-8 XML.`); }
}
export function parseXml(bytes: Uint8Array, partPath: string, maxBytes: number): Document {
  const problems: string[] = []; const document = new DOMParser({ onError: (level: string, message: string) => { if (level === "error" || level === "fatalError") problems.push(message); } } as never).parseFromString(decodeXml(bytes, partPath, maxBytes), "application/xml");
  if (!document?.documentElement || problems.length || document.getElementsByTagName("parsererror").length) fail("INVALID_PACKAGE", `Malformed XML in ${partPath}${problems[0] ? `: ${problems[0]}` : "."}`);
  return document as unknown as Document;
}
export function serializeXml(document: Document): Uint8Array { const value = new XMLSerializer().serializeToString(document as never); return encoder.encode(value.startsWith("<?xml") ? value : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`); }
export function elements(parent: Document | Element, namespace: string, localName: string): Element[] { return Array.from(parent.getElementsByTagNameNS(namespace, localName)) as Element[]; }
export function directChildren(parent: Element | undefined, namespace: string, localName: string): Element[] { const result: Element[] = []; if (!parent) return result; for (let node = parent.firstChild; node; node = node.nextSibling) if (node.nodeType === 1 && (node as Element).namespaceURI === namespace && (node as Element).localName === localName) result.push(node as Element); return result; }
export function firstDirectChild(parent: Element | undefined, namespace: string, localName: string): Element | undefined { return directChildren(parent, namespace, localName)[0]; }
export function attr(element: Element | undefined, namespace: string | null, localName: string): string | undefined { return element?.getAttributeNS(namespace, localName) ?? element?.getAttribute(localName) ?? undefined; }
export function textOf(element: Element | undefined): string { return element?.textContent ?? ""; }
