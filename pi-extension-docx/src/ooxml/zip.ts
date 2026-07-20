import { inflateSync, zipSync } from "fflate";
import { crc32 } from "@firstpick/pi-utils/hash";
import { DocxError, fail } from "../errors.ts";
import { mergeLimits, type DocxLimits } from "../core/limits.ts";

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50, ZIP64_U16 = 0xffff, ZIP64_U32 = 0xffffffff;
export type ZipEntryMetadata = { path: string; compressedSize: number; uncompressedSize: number; crc32: number; method: 0 | 8; flags: number; localOffset: number };
export type ZipEntry = ZipEntryMetadata & { data: Uint8Array };
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
function findEocd(bytes: Uint8Array): number {
  for (let offset = bytes.length - 22, min = Math.max(0, bytes.length - 65_557); offset >= min; offset--) if (u32(bytes, offset) === EOCD) return offset;
  fail("INVALID_PACKAGE", "ZIP end-of-central-directory record was not found.");
}
function decodeName(bytes: Uint8Array, utf8: boolean): string {
  try { return new TextDecoder(utf8 ? "utf-8" : "windows-1252", { fatal: true }).decode(bytes); }
  catch { fail("INVALID_PACKAGE", "ZIP entry name is not valid text."); }
}
function canonicalPath(raw: string): string {
  if (!raw || raw.includes("\0") || raw.includes("\\") || raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) fail("INVALID_PACKAGE", `Unsafe ZIP entry path: ${JSON.stringify(raw)}.`);
  const segments = raw.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) fail("INVALID_PACKAGE", `ZIP path traversal or empty segment: ${JSON.stringify(raw)}.`);
  return raw;
}
export { crc32 };

function parseDirectory(bytes: Uint8Array, limits: DocxLimits): ZipEntryMetadata[] {
  const eocd = findEocd(bytes);
  const disk = u16(bytes, eocd + 4), centralDisk = u16(bytes, eocd + 6), diskEntries = u16(bytes, eocd + 8), count = u16(bytes, eocd + 10);
  const centralSize = u32(bytes, eocd + 12), centralOffset = u32(bytes, eocd + 16), commentLength = u16(bytes, eocd + 20);
  if (disk || centralDisk || diskEntries !== count) fail("UNSUPPORTED_FEATURE", "Multi-disk ZIP packages are unsupported.");
  if (count === ZIP64_U16 || centralSize === ZIP64_U32 || centralOffset === ZIP64_U32) fail("UNSUPPORTED_FEATURE", "ZIP64 packages are unsupported by bounded intake.");
  if (eocd + 22 + commentLength !== bytes.length || centralOffset + centralSize > eocd) fail("INVALID_PACKAGE", "ZIP central-directory bounds or trailing data are invalid.");
  if (count > limits.maxEntries) fail("LIMIT_EXCEEDED", `ZIP has ${count} entries; limit is ${limits.maxEntries}.`);
  const entries: ZipEntryMetadata[] = [], names = new Set<string>(), folded = new Set<string>(); let total = 0, offset = centralOffset;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || u32(bytes, offset) !== CENTRAL) fail("INVALID_PACKAGE", `Invalid central-directory entry ${index}.`);
    const flags = u16(bytes, offset + 8), method = u16(bytes, offset + 10), expectedCrc = u32(bytes, offset + 16), compressedSize = u32(bytes, offset + 20), uncompressedSize = u32(bytes, offset + 24);
    const nameLength = u16(bytes, offset + 28), extraLength = u16(bytes, offset + 30), comment = u16(bytes, offset + 32), localOffset = u32(bytes, offset + 42), end = offset + 46 + nameLength + extraLength + comment;
    if (end > bytes.length) fail("INVALID_PACKAGE", `Truncated central-directory entry ${index}.`);
    const raw = decodeName(bytes.subarray(offset + 46, offset + 46 + nameLength), Boolean(flags & 0x0800)); offset = end;
    if (raw.endsWith("/")) continue;
    const partPath = canonicalPath(raw), fold = partPath.toLowerCase();
    if (names.has(partPath) || folded.has(fold)) fail("INVALID_PACKAGE", `Duplicate or conflicting ZIP entry: ${partPath}.`); names.add(partPath); folded.add(fold);
    if (flags & 1) fail("ENCRYPTED_PACKAGE", `Encrypted ZIP member is unsupported: ${partPath}.`);
    if (method !== 0 && method !== 8) fail("UNSUPPORTED_FEATURE", `ZIP method ${method} is unsupported for ${partPath}.`);
    if ([compressedSize, uncompressedSize, localOffset].includes(ZIP64_U32)) fail("UNSUPPORTED_FEATURE", `ZIP64 entry is unsupported: ${partPath}.`);
    if (uncompressedSize > limits.maxEntryBytes) fail("LIMIT_EXCEEDED", `${partPath} exceeds per-entry size limit.`);
    if ((compressedSize === 0 && uncompressedSize > 0) || (compressedSize > 0 && uncompressedSize / compressedSize > limits.maxCompressionRatio)) fail("LIMIT_EXCEEDED", `${partPath} exceeds compression-ratio limit.`);
    if (/\.(?:xml|rels)$/i.test(partPath) && uncompressedSize > limits.maxXmlBytes) fail("LIMIT_EXCEEDED", `${partPath} exceeds XML size limit.`);
    total += uncompressedSize; if (total > limits.maxUncompressedBytes) fail("LIMIT_EXCEEDED", "ZIP exceeds total uncompressed-size limit.");
    entries.push({ path: partPath, compressedSize, uncompressedSize, crc32: expectedCrc, method: method as 0 | 8, flags, localOffset });
  }
  if (offset !== centralOffset + centralSize) fail("INVALID_PACKAGE", "ZIP central-directory size mismatch.");
  return entries;
}
function extract(bytes: Uint8Array, meta: ZipEntryMetadata): Uint8Array {
  const o = meta.localOffset; if (o + 30 > bytes.length || u32(bytes, o) !== LOCAL) fail("INVALID_PACKAGE", `Invalid local ZIP header for ${meta.path}.`);
  const flags = u16(bytes, o + 6), method = u16(bytes, o + 8), nameLength = u16(bytes, o + 26), extraLength = u16(bytes, o + 28);
  const localName = decodeName(bytes.subarray(o + 30, o + 30 + nameLength), Boolean(flags & 0x0800));
  if (canonicalPath(localName) !== meta.path || (flags & 1) || method !== meta.method) fail("INVALID_PACKAGE", `ZIP header mismatch for ${meta.path}.`);
  const start = o + 30 + nameLength + extraLength, end = start + meta.compressedSize; if (end > bytes.length) fail("INVALID_PACKAGE", `Truncated ZIP data for ${meta.path}.`);
  try {
    const data = meta.method === 0 ? new Uint8Array(bytes.subarray(start, end)) : inflateSync(bytes.subarray(start, end), { out: new Uint8Array(meta.uncompressedSize) });
    if (data.byteLength !== meta.uncompressedSize || crc32(data) !== meta.crc32) fail("INVALID_PACKAGE", `ZIP integrity mismatch for ${meta.path}.`);
    return data;
  } catch (error) { if (error instanceof DocxError) throw error; fail("INVALID_PACKAGE", `Cannot decompress ${meta.path}.`); }
}
export class SafeZipArchive {
  readonly entries: Map<string, ZipEntry>; readonly limits: DocxLimits;
  private constructor(entries: Map<string, ZipEntry>, limits: DocxLimits) { this.entries = entries; this.limits = limits; }
  static fromBytes(input: Uint8Array, overrides?: Partial<DocxLimits>): SafeZipArchive {
    const limits = mergeLimits(overrides); if (input.byteLength > limits.maxArchiveBytes) fail("LIMIT_EXCEEDED", "DOCX archive exceeds size limit.");
    if (input.length >= 8 && input[0] === 0xd0 && input[1] === 0xcf && input[2] === 0x11 && input[3] === 0xe0) fail("ENCRYPTED_PACKAGE", "OLE/encrypted Office packages require an explicit password workflow that is not enabled.");
    const entries = new Map<string, ZipEntry>(); for (const meta of parseDirectory(input, limits)) { let cache: Uint8Array | undefined; const entry = { ...meta } as ZipEntry; Object.defineProperty(entry, "data", { enumerable: true, get() { return cache ??= extract(input, meta); } }); entries.set(meta.path, entry); }
    return new SafeZipArchive(entries, limits);
  }
  static fromEntries(input: Map<string, Uint8Array>, overrides?: Partial<DocxLimits>): SafeZipArchive { const limits = mergeLimits(overrides), entries = new Map<string, ZipEntry>(), folded = new Set<string>(); let total = 0; if (input.size > limits.maxEntries) fail("LIMIT_EXCEEDED", "ZIP entry count limit exceeded."); for (const [raw, value] of input) { const p = canonicalPath(raw), fold = p.toLowerCase(), data = new Uint8Array(value); if (folded.has(fold)) fail("INVALID_PACKAGE", `Duplicate or conflicting ZIP entry: ${p}.`); folded.add(fold); if (data.length > limits.maxEntryBytes || (/\.(?:xml|rels)$/i.test(p) && data.length > limits.maxXmlBytes)) fail("LIMIT_EXCEEDED", `Updated part is too large: ${p}.`); total += data.length; if (total > limits.maxUncompressedBytes) fail("LIMIT_EXCEEDED", "ZIP exceeds total uncompressed-size limit."); entries.set(p, { path: p, data, compressedSize: data.length, uncompressedSize: data.length, crc32: crc32(data), method: 0, flags: 0, localOffset: 0 }); } return new SafeZipArchive(entries, limits); }
  get(partPath: string): Uint8Array | undefined { return this.entries.get(partPath)?.data; }
  require(partPath: string): Uint8Array { const value = this.get(partPath); if (!value) fail("INVALID_PACKAGE", `Required OOXML part is missing: ${partPath}.`); return value; }
  set(partPath: string, data: Uint8Array): void { const p = canonicalPath(partPath); if (data.length > this.limits.maxEntryBytes) fail("LIMIT_EXCEEDED", `Updated part is too large: ${p}.`); this.entries.set(p, { path: p, data: new Uint8Array(data), compressedSize: data.length, uncompressedSize: data.length, crc32: crc32(data), method: 0, flags: 0, localOffset: 0 }); }
  toBytes(): Uint8Array { const files = Object.create(null) as Record<string, Uint8Array>; for (const p of [...this.entries.keys()].sort()) files[p] = this.entries.get(p)!.data; return zipSync(files, { level: 6 }); }
}
