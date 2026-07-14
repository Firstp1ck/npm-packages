import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { fail } from "../errors.ts";

export const NS = Object.freeze({
  contentTypes: "http://schemas.openxmlformats.org/package/2006/content-types",
  relationships: "http://schemas.openxmlformats.org/package/2006/relationships",
  spreadsheet: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  officeRelationships: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
});

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

export function decodeXml(bytes: Uint8Array, partPath: string, maxBytes: number): string {
  if (bytes.byteLength > maxBytes) fail("LIMIT_EXCEEDED", `XML part ${partPath} exceeds ${maxBytes} bytes.`);
  try {
    const text = decoder.decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail("INVALID_PACKAGE", `DTD/entity declarations are forbidden in OOXML part ${partPath}.`);
    return text;
  } catch (error) {
    if (error instanceof Error && error.name === "WorkbookError") throw error;
    fail("INVALID_PACKAGE", `OOXML part ${partPath} is not valid UTF-8 XML.`);
  }
}

export function parseXml(bytes: Uint8Array, partPath: string, maxBytes: number): Document {
  const text = decodeXml(bytes, partPath, maxBytes);
  const problems: string[] = [];
  const parser = new DOMParser({
    onError: (level: string, message: string) => {
      if (level === "error" || level === "fatalError") problems.push(message);
    },
  } as never);
  const document = parser.parseFromString(text, "application/xml");
  if (!document?.documentElement || problems.length > 0 || document.getElementsByTagName("parsererror").length > 0) {
    fail("INVALID_PACKAGE", `Malformed XML in ${partPath}${problems.length ? `: ${problems[0]}` : "."}`);
  }
  return document as unknown as Document;
}

export function serializeXml(document: Document): Uint8Array {
  const serialized = new XMLSerializer().serializeToString(document as never);
  return encoder.encode(serialized.startsWith("<?xml") ? serialized : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${serialized}`);
}

export function elements(parent: Document | Element, namespace: string, localName: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS(namespace, localName)) as Element[];
}

export function directChildren(parent: Element, namespace: string, localName: string): Element[] {
  const result: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1 && (node as Element).namespaceURI === namespace && (node as Element).localName === localName) result.push(node as Element);
  }
  return result;
}

export function firstDirectChild(parent: Element, namespace: string, localName: string): Element | undefined {
  return directChildren(parent, namespace, localName)[0];
}

export function appendElement(document: Document, parent: Element, namespace: string, qualifiedName: string): Element {
  const element = document.createElementNS(namespace, qualifiedName);
  parent.appendChild(element);
  return element;
}

export function textContent(element: Element | undefined): string {
  return element?.textContent ?? "";
}
