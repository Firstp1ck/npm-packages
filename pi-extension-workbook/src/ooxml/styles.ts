import { XMLSerializer } from "@xmldom/xmldom";
import type { CellStylePatch } from "../contracts.ts";
import { fail } from "../errors.ts";
import { NS, appendElement, directChildren, firstDirectChild, parseXml, serializeXml } from "./xml.ts";

const STYLE_CHILD_ORDER = ["numFmts", "fonts", "fills", "borders", "cellStyleXfs", "cellXfs", "cellStyles", "dxfs", "tableStyles", "colors", "extLst"];

function boolAttr(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : value ? "1" : "0";
}

function normalizeColor(color: string): string {
  const normalized = color.replace(/^#/, "").toUpperCase();
  if (!/^(?:[A-F0-9]{6}|[A-F0-9]{8})$/.test(normalized)) fail("INVALID_ARGUMENT", `Invalid RGB/ARGB color: ${color}.`);
  return normalized.length === 6 ? `FF${normalized}` : normalized;
}

function elementKey(element: Element): string {
  return new XMLSerializer().serializeToString(element as never);
}

function setBooleanChild(document: Document, parent: Element, name: string, value: boolean | undefined): void {
  if (value === undefined) return;
  const existing = firstDirectChild(parent, NS.spreadsheet, name);
  if (!value) {
    if (existing) parent.removeChild(existing);
    return;
  }
  if (!existing) appendElement(document, parent, NS.spreadsheet, name);
}

function setValueChild(document: Document, parent: Element, name: string, attribute: string, value: string | number | undefined): void {
  if (value === undefined) return;
  const child = firstDirectChild(parent, NS.spreadsheet, name) ?? appendElement(document, parent, NS.spreadsheet, name);
  child.setAttribute(attribute, String(value));
}

export type StyleDescriptor = {
  id: number;
  font?: Record<string, unknown>;
  fill?: Record<string, unknown>;
  border?: Record<string, unknown>;
  alignment?: Record<string, string>;
  numberFormat?: string;
  protection?: Record<string, string>;
};

export class StyleCatalog {
  readonly partPath: string;
  readonly document: Document;
  private readonly maxStyles: number;
  private dirty = false;

  constructor(bytes: Uint8Array, partPath: string, maxXmlBytes: number, maxStyles: number) {
    this.partPath = partPath;
    this.maxStyles = maxStyles;
    this.document = parseXml(bytes, partPath, maxXmlBytes);
    if (this.document.documentElement.namespaceURI !== NS.spreadsheet || this.document.documentElement.localName !== "styleSheet") {
      fail("INVALID_PACKAGE", `${partPath} has an unexpected root element.`);
    }
    for (const [containerName, childName] of [["numFmts", "numFmt"], ["fonts", "font"], ["fills", "fill"], ["borders", "border"], ["cellXfs", "xf"], ["dxfs", "dxf"]] as const) {
      const count = this.children(containerName, childName).length;
      if (count > maxStyles) fail("LIMIT_EXCEEDED", `${partPath} contains ${count} ${childName} records; style limit is ${maxStyles}.`);
    }
  }

  private container(name: string, create = false): Element | undefined {
    const root = this.document.documentElement;
    const existing = firstDirectChild(root, NS.spreadsheet, name);
    if (existing || !create) return existing;
    const container = this.document.createElementNS(NS.spreadsheet, name);
    const desiredIndex = STYLE_CHILD_ORDER.indexOf(name);
    const rootChildren = Array.from(root.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).namespaceURI === NS.spreadsheet);
    const before = rootChildren.find((child) => STYLE_CHILD_ORDER.indexOf(child.localName) > desiredIndex);
    if (before) root.insertBefore(container, before);
    else root.appendChild(container);
    container.setAttribute("count", "0");
    return container;
  }

  private children(containerName: string, childName: string): Element[] {
    const container = this.container(containerName);
    return container ? directChildren(container, NS.spreadsheet, childName) : [];
  }

  private appendDeduplicated(containerName: string, childName: string, element: Element): number {
    const container = this.container(containerName, true)!;
    const children = directChildren(container, NS.spreadsheet, childName);
    const key = elementKey(element);
    const existing = children.findIndex((child) => elementKey(child) === key);
    if (existing >= 0) return existing;
    if (children.length >= this.maxStyles) fail("LIMIT_EXCEEDED", `Adding ${childName} would exceed style limit ${this.maxStyles}.`);
    container.appendChild(element);
    container.setAttribute("count", String(children.length + 1));
    this.dirty = true;
    return children.length;
  }

  private component(containerName: string, childName: string, index: number, fallbackName: string): Element {
    const existing = this.children(containerName, childName)[index];
    return existing ? existing.cloneNode(true) as Element : this.document.createElementNS(NS.spreadsheet, fallbackName);
  }

  private numberFormatCode(numFmtId: number): string | undefined {
    const custom = this.children("numFmts", "numFmt").find((element) => Number(element.getAttribute("numFmtId")) === numFmtId);
    if (custom) return custom.getAttribute("formatCode") ?? undefined;
    const builtins: Record<number, string> = { 0: "General", 1: "0", 2: "0.00", 9: "0%", 10: "0.00%", 14: "m/d/yy", 49: "@" };
    return builtins[numFmtId];
  }

  describe(styleId: number): StyleDescriptor {
    const xfs = this.children("cellXfs", "xf");
    const xf = xfs[styleId] ?? xfs[0];
    if (!xf) return { id: styleId };
    const font = this.children("fonts", "font")[Number(xf.getAttribute("fontId") ?? 0)];
    const fill = this.children("fills", "fill")[Number(xf.getAttribute("fillId") ?? 0)];
    const border = this.children("borders", "border")[Number(xf.getAttribute("borderId") ?? 0)];
    const describeColor = (element?: Element) => element ? Object.fromEntries(Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value])) : undefined;
    const descriptor: StyleDescriptor = { id: styleId };
    if (font) {
      descriptor.font = {
        name: firstDirectChild(font, NS.spreadsheet, "name")?.getAttribute("val") ?? undefined,
        size: Number(firstDirectChild(font, NS.spreadsheet, "sz")?.getAttribute("val") ?? 0) || undefined,
        bold: Boolean(firstDirectChild(font, NS.spreadsheet, "b")),
        italic: Boolean(firstDirectChild(font, NS.spreadsheet, "i")),
        underline: Boolean(firstDirectChild(font, NS.spreadsheet, "u")),
        strike: Boolean(firstDirectChild(font, NS.spreadsheet, "strike")),
        color: describeColor(firstDirectChild(font, NS.spreadsheet, "color")),
      };
    }
    if (fill) {
      const pattern = firstDirectChild(fill, NS.spreadsheet, "patternFill");
      descriptor.fill = pattern ? {
        pattern: pattern.getAttribute("patternType") ?? undefined,
        foreground: describeColor(firstDirectChild(pattern, NS.spreadsheet, "fgColor")),
        background: describeColor(firstDirectChild(pattern, NS.spreadsheet, "bgColor")),
      } : {};
    }
    if (border) {
      descriptor.border = Object.fromEntries(["left", "right", "top", "bottom", "diagonal"].map((side) => {
        const element = firstDirectChild(border, NS.spreadsheet, side);
        return [side, element ? { style: element.getAttribute("style") ?? undefined, color: describeColor(firstDirectChild(element, NS.spreadsheet, "color")) } : {}];
      }));
    }
    const alignment = firstDirectChild(xf, NS.spreadsheet, "alignment");
    if (alignment) descriptor.alignment = Object.fromEntries(Array.from(alignment.attributes).map((attribute) => [attribute.name, attribute.value]));
    descriptor.numberFormat = this.numberFormatCode(Number(xf.getAttribute("numFmtId") ?? 0));
    const protection = firstDirectChild(xf, NS.spreadsheet, "protection");
    if (protection) descriptor.protection = Object.fromEntries(Array.from(protection.attributes).map((attribute) => [attribute.name, attribute.value]));
    return descriptor;
  }

  applyPatch(baseStyleId: number, patch: CellStylePatch): number {
    const xfs = this.children("cellXfs", "xf");
    const base = (xfs[baseStyleId] ?? xfs[0]);
    if (!base) fail("INVALID_PACKAGE", "Workbook style table has no cellXfs records.");
    const xf = base.cloneNode(true) as Element;

    if (patch.font) {
      const font = this.component("fonts", "font", Number(xf.getAttribute("fontId") ?? 0), "font");
      setValueChild(this.document, font, "name", "val", patch.font.name);
      setValueChild(this.document, font, "sz", "val", patch.font.size);
      setBooleanChild(this.document, font, "b", patch.font.bold);
      setBooleanChild(this.document, font, "i", patch.font.italic);
      if (patch.font.underline !== undefined) {
        const underline = firstDirectChild(font, NS.spreadsheet, "u");
        if (patch.font.underline === false) {
          if (underline) font.removeChild(underline);
        } else {
          const element = underline ?? appendElement(this.document, font, NS.spreadsheet, "u");
          if (patch.font.underline === true || patch.font.underline === "single") element.removeAttribute("val");
          else element.setAttribute("val", patch.font.underline);
        }
      }
      setBooleanChild(this.document, font, "strike", patch.font.strike);
      setBooleanChild(this.document, font, "outline", patch.font.outline);
      setBooleanChild(this.document, font, "shadow", patch.font.shadow);
      setBooleanChild(this.document, font, "condense", patch.font.condense);
      setBooleanChild(this.document, font, "extend", patch.font.extend);
      setValueChild(this.document, font, "vertAlign", "val", patch.font.verticalAlign);
      setValueChild(this.document, font, "family", "val", patch.font.family);
      setValueChild(this.document, font, "charset", "val", patch.font.charset);
      if (patch.font.scheme !== undefined) {
        const scheme = firstDirectChild(font, NS.spreadsheet, "scheme");
        if (patch.font.scheme === "none") {
          if (scheme) font.removeChild(scheme);
        } else {
          (scheme ?? appendElement(this.document, font, NS.spreadsheet, "scheme")).setAttribute("val", patch.font.scheme);
        }
      }
      if (patch.font.color !== undefined) {
        const color = firstDirectChild(font, NS.spreadsheet, "color") ?? appendElement(this.document, font, NS.spreadsheet, "color");
        while (color.attributes.length) color.removeAttributeNode(color.attributes.item(0)!);
        color.setAttribute("rgb", normalizeColor(patch.font.color));
      }
      xf.setAttribute("fontId", String(this.appendDeduplicated("fonts", "font", font)));
      xf.setAttribute("applyFont", "1");
    }

    if (patch.fill) {
      const fill = this.component("fills", "fill", Number(xf.getAttribute("fillId") ?? 0), "fill");
      const pattern = firstDirectChild(fill, NS.spreadsheet, "patternFill") ?? appendElement(this.document, fill, NS.spreadsheet, "patternFill");
      if (patch.fill.pattern !== undefined) pattern.setAttribute("patternType", patch.fill.pattern);
      if (patch.fill.foreground !== undefined) {
        const color = firstDirectChild(pattern, NS.spreadsheet, "fgColor") ?? appendElement(this.document, pattern, NS.spreadsheet, "fgColor");
        while (color.attributes.length) color.removeAttributeNode(color.attributes.item(0)!);
        color.setAttribute("rgb", normalizeColor(patch.fill.foreground));
        if (!patch.fill.pattern) pattern.setAttribute("patternType", "solid");
      }
      if (patch.fill.background !== undefined) {
        const color = firstDirectChild(pattern, NS.spreadsheet, "bgColor") ?? appendElement(this.document, pattern, NS.spreadsheet, "bgColor");
        while (color.attributes.length) color.removeAttributeNode(color.attributes.item(0)!);
        color.setAttribute("rgb", normalizeColor(patch.fill.background));
      }
      xf.setAttribute("fillId", String(this.appendDeduplicated("fills", "fill", fill)));
      xf.setAttribute("applyFill", "1");
    }

    if (patch.border) {
      const border = this.component("borders", "border", Number(xf.getAttribute("borderId") ?? 0), "border");
      for (const name of ["left", "right", "top", "bottom", "diagonal", "vertical", "horizontal"] as const) {
        const sidePatch = patch.border[name];
        if (!sidePatch) continue;
        const side = firstDirectChild(border, NS.spreadsheet, name) ?? appendElement(this.document, border, NS.spreadsheet, name);
        if (sidePatch.style !== undefined) {
          if (sidePatch.style === "none") side.removeAttribute("style");
          else side.setAttribute("style", sidePatch.style);
        }
        if (sidePatch.color !== undefined) {
          const color = firstDirectChild(side, NS.spreadsheet, "color") ?? appendElement(this.document, side, NS.spreadsheet, "color");
          while (color.attributes.length) color.removeAttributeNode(color.attributes.item(0)!);
          color.setAttribute("rgb", normalizeColor(sidePatch.color));
        }
      }
      if (patch.border.diagonalUp !== undefined) border.setAttribute("diagonalUp", boolAttr(patch.border.diagonalUp)!);
      if (patch.border.diagonalDown !== undefined) border.setAttribute("diagonalDown", boolAttr(patch.border.diagonalDown)!);
      xf.setAttribute("borderId", String(this.appendDeduplicated("borders", "border", border)));
      xf.setAttribute("applyBorder", "1");
    }

    if (patch.numberFormat !== undefined) {
      let numFmtId = this.children("numFmts", "numFmt").find((item) => item.getAttribute("formatCode") === patch.numberFormat)?.getAttribute("numFmtId");
      if (!numFmtId) {
        const used = this.children("numFmts", "numFmt").map((item) => Number(item.getAttribute("numFmtId"))).filter(Number.isFinite);
        const next = Math.max(163, ...used) + 1;
        if (this.children("numFmts", "numFmt").length >= this.maxStyles) fail("LIMIT_EXCEEDED", `Adding numFmt would exceed style limit ${this.maxStyles}.`);
        const numFmt = this.document.createElementNS(NS.spreadsheet, "numFmt");
        numFmt.setAttribute("numFmtId", String(next));
        numFmt.setAttribute("formatCode", patch.numberFormat);
        const container = this.container("numFmts", true)!;
        container.appendChild(numFmt);
        container.setAttribute("count", String(this.children("numFmts", "numFmt").length));
        this.dirty = true;
        numFmtId = String(next);
      }
      xf.setAttribute("numFmtId", numFmtId);
      xf.setAttribute("applyNumberFormat", "1");
    }

    if (patch.alignment) {
      const alignment = firstDirectChild(xf, NS.spreadsheet, "alignment") ?? appendElement(this.document, xf, NS.spreadsheet, "alignment");
      const attributes: Record<string, string | number | boolean | undefined> = {
        horizontal: patch.alignment.horizontal,
        vertical: patch.alignment.vertical,
        wrapText: boolAttr(patch.alignment.wrapText),
        shrinkToFit: boolAttr(patch.alignment.shrinkToFit),
        justifyLastLine: boolAttr(patch.alignment.justifyLastLine),
        readingOrder: patch.alignment.readingOrder,
        indent: patch.alignment.indent,
        relativeIndent: patch.alignment.relativeIndent,
        textRotation: patch.alignment.textRotation,
      };
      for (const [name, value] of Object.entries(attributes)) if (value !== undefined) alignment.setAttribute(name, String(value));
      xf.setAttribute("applyAlignment", "1");
    }

    if (patch.protection) {
      const protection = firstDirectChild(xf, NS.spreadsheet, "protection") ?? appendElement(this.document, xf, NS.spreadsheet, "protection");
      if (patch.protection.locked !== undefined) protection.setAttribute("locked", boolAttr(patch.protection.locked)!);
      if (patch.protection.hidden !== undefined) protection.setAttribute("hidden", boolAttr(patch.protection.hidden)!);
      xf.setAttribute("applyProtection", "1");
    }

    return this.appendDeduplicated("cellXfs", "xf", xf);
  }

  addDifferentialStyle(patch: CellStylePatch): number {
    const dxf = this.document.createElementNS(NS.spreadsheet, "dxf");
    if (patch.font) {
      const font = appendElement(this.document, dxf, NS.spreadsheet, "font");
      setValueChild(this.document, font, "name", "val", patch.font.name);
      setValueChild(this.document, font, "sz", "val", patch.font.size);
      setBooleanChild(this.document, font, "b", patch.font.bold);
      setBooleanChild(this.document, font, "i", patch.font.italic);
      setBooleanChild(this.document, font, "strike", patch.font.strike);
      setBooleanChild(this.document, font, "outline", patch.font.outline);
      setBooleanChild(this.document, font, "shadow", patch.font.shadow);
      if (patch.font.underline) {
        const underline = appendElement(this.document, font, NS.spreadsheet, "u");
        if (patch.font.underline !== true && patch.font.underline !== "single") underline.setAttribute("val", patch.font.underline);
      }
      setValueChild(this.document, font, "vertAlign", "val", patch.font.verticalAlign);
      if (patch.font.color) appendElement(this.document, font, NS.spreadsheet, "color").setAttribute("rgb", normalizeColor(patch.font.color));
    }
    if (patch.fill) {
      const fill = appendElement(this.document, dxf, NS.spreadsheet, "fill");
      const pattern = appendElement(this.document, fill, NS.spreadsheet, "patternFill");
      pattern.setAttribute("patternType", patch.fill.pattern ?? (patch.fill.foreground ? "solid" : "none"));
      if (patch.fill.foreground) appendElement(this.document, pattern, NS.spreadsheet, "fgColor").setAttribute("rgb", normalizeColor(patch.fill.foreground));
      if (patch.fill.background) appendElement(this.document, pattern, NS.spreadsheet, "bgColor").setAttribute("rgb", normalizeColor(patch.fill.background));
    }
    if (patch.border) {
      const border = appendElement(this.document, dxf, NS.spreadsheet, "border");
      for (const name of ["left", "right", "top", "bottom", "diagonal", "vertical", "horizontal"] as const) {
        const sidePatch = patch.border[name];
        if (!sidePatch) continue;
        const side = appendElement(this.document, border, NS.spreadsheet, name);
        if (sidePatch.style && sidePatch.style !== "none") side.setAttribute("style", sidePatch.style);
        if (sidePatch.color) appendElement(this.document, side, NS.spreadsheet, "color").setAttribute("rgb", normalizeColor(sidePatch.color));
      }
      if (patch.border.diagonalUp !== undefined) border.setAttribute("diagonalUp", boolAttr(patch.border.diagonalUp)!);
      if (patch.border.diagonalDown !== undefined) border.setAttribute("diagonalDown", boolAttr(patch.border.diagonalDown)!);
    }
    if (patch.numberFormat !== undefined) {
      const numFmt = appendElement(this.document, dxf, NS.spreadsheet, "numFmt");
      numFmt.setAttribute("numFmtId", "0");
      numFmt.setAttribute("formatCode", patch.numberFormat);
    }
    if (patch.alignment) {
      const alignment = appendElement(this.document, dxf, NS.spreadsheet, "alignment");
      const attrs: Record<string, string | number | boolean | undefined> = {
        horizontal: patch.alignment.horizontal,
        vertical: patch.alignment.vertical,
        wrapText: boolAttr(patch.alignment.wrapText),
        shrinkToFit: boolAttr(patch.alignment.shrinkToFit),
        justifyLastLine: boolAttr(patch.alignment.justifyLastLine),
        readingOrder: patch.alignment.readingOrder,
        indent: patch.alignment.indent,
        relativeIndent: patch.alignment.relativeIndent,
        textRotation: patch.alignment.textRotation,
      };
      for (const [name, value] of Object.entries(attrs)) if (value !== undefined) alignment.setAttribute(name, String(value));
    }
    if (patch.protection) {
      const protection = appendElement(this.document, dxf, NS.spreadsheet, "protection");
      if (patch.protection.locked !== undefined) protection.setAttribute("locked", boolAttr(patch.protection.locked)!);
      if (patch.protection.hidden !== undefined) protection.setAttribute("hidden", boolAttr(patch.protection.hidden)!);
    }
    return this.appendDeduplicated("dxfs", "dxf", dxf);
  }

  toBytes(): Uint8Array {
    return serializeXml(this.document);
  }

  get changed(): boolean {
    return this.dirty;
  }
}
