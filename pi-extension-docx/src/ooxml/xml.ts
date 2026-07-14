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
const encoder = new TextEncoder();
export function decodeXml(bytes: Uint8Array, partPath: string, maxBytes: number): string {
  if (bytes.length > maxBytes) fail("LIMIT_EXCEEDED", `XML part ${partPath} exceeds ${maxBytes} bytes.`);
  try {
    const utf16le = bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0x3c && bytes[1] === 0x00, utf16be = bytes[0] === 0xfe && bytes[1] === 0xff || bytes[0] === 0x00 && bytes[1] === 0x3c;
    const encoding = utf16le ? "utf-16le" : utf16be ? "utf-16be" : "utf-8", text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    const declaration = text.match(/^\s*<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (declaration && !new Set(["utf-8", "utf8", "utf-16", "utf-16le", "utf-16be", "us-ascii"]).has(declaration)) fail("UNSUPPORTED_FEATURE", `Unsupported XML encoding ${declaration} in ${partPath}.`);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail("INVALID_PACKAGE", `DTD/entity declarations are forbidden in ${partPath}.`);
    return text;
  }
  catch (error) { if (error && typeof error === "object" && "code" in error) throw error; fail("INVALID_PACKAGE", `${partPath} is not valid UTF-8/UTF-16 XML.`); }
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
