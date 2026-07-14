import path from "node:path";
import { sha256Bytes } from "../core/hash.ts";
import type { WorkbookLimits } from "../core/limits.ts";
import { fail } from "../errors.ts";
import { SafeZipArchive } from "./zip.ts";
import { NS, elements, parseXml } from "./xml.ts";

const posix = path.posix;

export type PackageRelationship = {
  relsPart: string;
  sourcePart: string;
  id: string;
  type: string;
  target: string;
  targetMode?: string;
  resolvedTarget?: string;
};

export type PackageManifestPart = {
  path: string;
  contentType?: string;
  bytes: number;
  crc32: string;
  sha256: string;
  relationshipTargets: string[];
  protected: boolean;
};

export type PackageManifest = {
  parts: PackageManifestPart[];
  protectedParts: string[];
  relationships: PackageRelationship[];
};

export type IntegrityComparison = {
  ok: boolean;
  errors: string[];
  changedParts: string[];
  addedParts: string[];
  removedParts: string[];
};

function sourcePartFromRels(relsPath: string): string | undefined {
  if (relsPath === "_rels/.rels") return "";
  const match = relsPath.match(/^(.*)\/_rels\/([^/]+)\.rels$/);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

function resolveRelationshipTarget(sourcePart: string, target: string): string | undefined {
  if (!target || target.startsWith("#") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return undefined;
  const base = sourcePart ? posix.dirname(sourcePart) : "";
  const resolved = posix.normalize(posix.join(base, target.replace(/^\//, "")));
  if (resolved === ".." || resolved.startsWith("../") || posix.isAbsolute(resolved)) return undefined;
  return resolved;
}

function activeRelationship(type: string): boolean {
  return /\/(?:vbaProject|vbaProjectSignature|activeXControl|activeXControlBinary|ctrlProp|oleObject|package|ui\/extensibility)$/i.test(type);
}

function activeContentType(contentType: string | undefined): boolean {
  return Boolean(contentType && /(?:vbaProject|vbaProjectSignature|activeX|ctrlProp|oleObject|ms-office\.activeX|customUI)/i.test(contentType));
}

function canonicalProtectedPath(partPath: string): boolean {
  return /^(?:xl\/(?:vbaProject(?:Signature)?\.bin|activeX\/|ctrlProps\/|embeddings\/)|customUI\/)/i.test(partPath);
}

export class OoxmlPackage {
  readonly archive: SafeZipArchive;
  readonly relationships: PackageRelationship[];
  readonly protectedParts: Set<string>;
  readonly contentTypes: Map<string, string>;
  readonly workbookPart: string;

  private constructor(archive: SafeZipArchive) {
    this.archive = archive;
    this.contentTypes = this.readContentTypes();
    this.relationships = this.readRelationships();
    this.workbookPart = this.findWorkbookPart();
    this.protectedParts = this.classifyProtectedParts();
    this.validateRelationshipTargets();
  }

  static fromBytes(bytes: Uint8Array, limits?: Partial<WorkbookLimits>): OoxmlPackage {
    return new OoxmlPackage(SafeZipArchive.fromBytes(bytes, limits));
  }

  static fromArchive(archive: SafeZipArchive): OoxmlPackage {
    return new OoxmlPackage(archive);
  }

  clone(): OoxmlPackage {
    return OoxmlPackage.fromArchive(this.archive.clone());
  }

  private readContentTypes(): Map<string, string> {
    const part = "[Content_Types].xml";
    const document = parseXml(this.archive.require(part), part, this.archive.limits.maxXmlBytes);
    if (document.documentElement.namespaceURI !== NS.contentTypes || document.documentElement.localName !== "Types") {
      fail("INVALID_PACKAGE", `${part} has an unexpected root element.`);
    }
    const defaults = new Map<string, string>();
    const overrides = new Map<string, string>();
    for (const element of elements(document, NS.contentTypes, "Default")) {
      const extension = element.getAttribute("Extension")?.toLowerCase();
      const contentType = element.getAttribute("ContentType");
      if (extension && contentType) defaults.set(extension, contentType);
    }
    for (const element of elements(document, NS.contentTypes, "Override")) {
      const partName = element.getAttribute("PartName")?.replace(/^\//, "");
      const contentType = element.getAttribute("ContentType");
      if (partName && contentType) overrides.set(partName, contentType);
    }
    const result = new Map<string, string>(overrides);
    for (const entry of this.archive.entries.keys()) {
      if (result.has(entry)) continue;
      const extension = posix.extname(entry).slice(1).toLowerCase();
      const contentType = defaults.get(extension);
      if (contentType) result.set(entry, contentType);
    }
    return result;
  }

  private readRelationships(): PackageRelationship[] {
    const result: PackageRelationship[] = [];
    for (const relsPart of this.archive.entries.keys()) {
      if (!relsPart.endsWith(".rels")) continue;
      const sourcePart = sourcePartFromRels(relsPart);
      if (sourcePart === undefined) continue;
      const document = parseXml(this.archive.require(relsPart), relsPart, this.archive.limits.maxXmlBytes);
      for (const element of elements(document, NS.relationships, "Relationship")) {
        const id = element.getAttribute("Id") ?? "";
        const type = element.getAttribute("Type") ?? "";
        const target = element.getAttribute("Target") ?? "";
        const targetMode = element.getAttribute("TargetMode") ?? undefined;
        if (!id || !type || !target) fail("INVALID_PACKAGE", `Incomplete relationship in ${relsPart}.`);
        const resolvedTarget = targetMode?.toLowerCase() === "external" ? undefined : resolveRelationshipTarget(sourcePart, target);
        if (targetMode?.toLowerCase() !== "external" && !resolvedTarget) fail("INVALID_PACKAGE", `Unsafe relationship target ${target} in ${relsPart}.`);
        result.push({ relsPart, sourcePart, id, type, target, targetMode, resolvedTarget });
      }
    }
    return result;
  }

  private findWorkbookPart(): string {
    const rootOfficeDocument = this.relationships.find((relationship) => relationship.sourcePart === "" && /\/officeDocument$/i.test(relationship.type));
    const candidate = rootOfficeDocument?.resolvedTarget ?? "xl/workbook.xml";
    if (!this.archive.get(candidate)) fail("INVALID_PACKAGE", `Workbook part is missing: ${candidate}.`);
    return candidate;
  }

  private classifyProtectedParts(): Set<string> {
    const result = new Set<string>();
    for (const partPath of this.archive.entries.keys()) {
      if (canonicalProtectedPath(partPath) || activeContentType(this.contentTypes.get(partPath))) result.add(partPath);
    }
    for (const relationship of this.relationships) {
      const targetType = relationship.resolvedTarget ? this.contentTypes.get(relationship.resolvedTarget) : undefined;
      if (activeRelationship(relationship.type) || activeContentType(targetType) || relationship.resolvedTarget && canonicalProtectedPath(relationship.resolvedTarget)) {
        result.add(relationship.relsPart);
        if (relationship.resolvedTarget) result.add(relationship.resolvedTarget);
      }
    }
    if (result.size > 0) result.add("[Content_Types].xml");
    return result;
  }

  private validateRelationshipTargets(): void {
    for (const relationship of this.relationships) {
      if (relationship.resolvedTarget && !this.archive.get(relationship.resolvedTarget)) {
        fail("INVALID_PACKAGE", `Relationship ${relationship.id} in ${relationship.relsPart} targets missing part ${relationship.resolvedTarget}.`);
      }
    }
  }

  contentTypeFor(partPath: string): string | undefined {
    return this.contentTypes.get(partPath);
  }

  relationshipsFrom(sourcePart: string): PackageRelationship[] {
    return this.relationships.filter((relationship) => relationship.sourcePart === sourcePart);
  }

  manifest(): PackageManifest {
    const targetsBySource = new Map<string, string[]>();
    for (const relationship of this.relationships) {
      const list = targetsBySource.get(relationship.sourcePart) ?? [];
      list.push(relationship.resolvedTarget ?? relationship.target);
      targetsBySource.set(relationship.sourcePart, list);
    }
    const parts = [...this.archive.entries.values()].map((entry) => ({
      path: entry.path,
      contentType: this.contentTypeFor(entry.path),
      bytes: entry.data.byteLength,
      crc32: entry.crc32.toString(16).padStart(8, "0"),
      sha256: sha256Bytes(entry.data),
      relationshipTargets: (targetsBySource.get(entry.path) ?? []).sort(),
      protected: this.protectedParts.has(entry.path),
    })).sort((a, b) => a.path.localeCompare(b.path));
    return { parts, protectedParts: [...this.protectedParts].sort(), relationships: this.relationships };
  }

  compareIntegrity(after: OoxmlPackage, allowedChangedParts: Set<string> = new Set()): IntegrityComparison {
    const errors: string[] = [];
    const changedParts: string[] = [];
    const addedParts: string[] = [];
    const removedParts: string[] = [];
    for (const [partPath, beforeEntry] of this.archive.entries) {
      const afterEntry = after.archive.entries.get(partPath);
      if (!afterEntry) {
        removedParts.push(partPath);
        if (this.protectedParts.has(partPath)) errors.push(`Protected part missing: ${partPath}`);
        else if (!allowedChangedParts.has(partPath)) errors.push(`Unexpected part removed: ${partPath}`);
        continue;
      }
      if (sha256Bytes(beforeEntry.data) !== sha256Bytes(afterEntry.data)) {
        changedParts.push(partPath);
        if (this.protectedParts.has(partPath)) errors.push(`Protected part changed: ${partPath}`);
        else if (!allowedChangedParts.has(partPath)) errors.push(`Unexpected part changed: ${partPath}`);
      }
    }
    for (const partPath of after.archive.entries.keys()) {
      if (!this.archive.entries.has(partPath)) {
        addedParts.push(partPath);
        if (!allowedChangedParts.has(partPath)) errors.push(`Unexpected part added: ${partPath}`);
      }
    }
    for (const partPath of this.protectedParts) {
      if (!after.archive.entries.has(partPath)) errors.push(`Protected part missing: ${partPath}`);
    }
    return { ok: errors.length === 0, errors, changedParts: changedParts.sort(), addedParts: addedParts.sort(), removedParts: removedParts.sort() };
  }
}
