import { inflateSync, zipSync } from "fflate";
import { WorkbookError, fail } from "../errors.ts";
import { mergeLimits, type WorkbookLimits } from "../core/limits.ts";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_U16 = 0xffff;
const ZIP64_U32 = 0xffffffff;

export type ZipEntryMetadata = {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  method: 0 | 8;
  flags: number;
  localOffset: number;
};

export type ZipEntry = ZipEntryMetadata & { data: Uint8Array };

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function findEocd(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset--) {
    if (u32(bytes, offset) === EOCD_SIGNATURE) return offset;
  }
  fail("INVALID_PACKAGE", "ZIP end-of-central-directory record was not found.");
}

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  try {
    return new TextDecoder(utf8 ? "utf-8" : "windows-1252", { fatal: true }).decode(bytes);
  } catch {
    fail("INVALID_PACKAGE", "ZIP entry name is not valid text.");
  }
}

function validatePartPath(raw: string): string {
  if (!raw || raw.includes("\0") || raw.includes("\\") || raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) {
    fail("INVALID_PACKAGE", `Unsafe ZIP entry path: ${JSON.stringify(raw)}.`);
  }
  const segments = raw.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) {
    fail("INVALID_PACKAGE", `ZIP entry path traversal or empty segment: ${JSON.stringify(raw)}.`);
  }
  return raw;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let k = 0; k < 8; k++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function parseCentralDirectory(bytes: Uint8Array, limits: WorkbookLimits): ZipEntryMetadata[] {
  const eocd = findEocd(bytes);
  const diskNumber = u16(bytes, eocd + 4);
  const centralDisk = u16(bytes, eocd + 6);
  const entriesOnDisk = u16(bytes, eocd + 8);
  const entryCount = u16(bytes, eocd + 10);
  const centralSize = u32(bytes, eocd + 12);
  const centralOffset = u32(bytes, eocd + 16);
  const commentLength = u16(bytes, eocd + 20);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    fail("UNSUPPORTED_FEATURE", "Multi-disk ZIP packages are not supported.");
  }
  if (entryCount === ZIP64_U16 || centralSize === ZIP64_U32 || centralOffset === ZIP64_U32) {
    fail("UNSUPPORTED_FEATURE", "ZIP64 workbook packages are not supported by the bounded OOXML engine.");
  }
  if (eocd + 22 + commentLength > bytes.length || centralOffset + centralSize > eocd) {
    fail("INVALID_PACKAGE", "ZIP central-directory bounds are invalid.");
  }
  if (entryCount > limits.maxEntries) {
    fail("LIMIT_EXCEEDED", `ZIP contains ${entryCount} entries; limit is ${limits.maxEntries}.`);
  }

  const entries: ZipEntryMetadata[] = [];
  const names = new Set<string>();
  let totalUncompressed = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > bytes.length || u32(bytes, offset) !== CENTRAL_SIGNATURE) {
      fail("INVALID_PACKAGE", `Invalid ZIP central-directory record at entry ${index}.`);
    }
    const flags = u16(bytes, offset + 8);
    const method = u16(bytes, offset + 10);
    const expectedCrc = u32(bytes, offset + 16);
    const compressedSize = u32(bytes, offset + 20);
    const uncompressedSize = u32(bytes, offset + 24);
    const nameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const entryCommentLength = u16(bytes, offset + 32);
    const localOffset = u32(bytes, offset + 42);
    const recordEnd = offset + 46 + nameLength + extraLength + entryCommentLength;
    if (recordEnd > bytes.length) fail("INVALID_PACKAGE", `Truncated ZIP central-directory entry ${index}.`);

    const rawName = decodeName(bytes.subarray(offset + 46, offset + 46 + nameLength), Boolean(flags & 0x0800));
    offset = recordEnd;
    if (rawName.endsWith("/")) continue;
    const path = validatePartPath(rawName);
    if (names.has(path)) fail("INVALID_PACKAGE", `Duplicate ZIP entry: ${path}.`);
    names.add(path);

    if (flags & 0x0001) fail("ENCRYPTED_PACKAGE", `Encrypted ZIP entry is not supported: ${path}.`);
    if (method !== 0 && method !== 8) fail("UNSUPPORTED_FEATURE", `ZIP method ${method} is unsupported for ${path}.`);
    if (compressedSize === ZIP64_U32 || uncompressedSize === ZIP64_U32 || localOffset === ZIP64_U32) {
      fail("UNSUPPORTED_FEATURE", `ZIP64 entry is unsupported: ${path}.`);
    }
    if (uncompressedSize > limits.maxEntryBytes) {
      fail("LIMIT_EXCEEDED", `ZIP entry ${path} expands to ${uncompressedSize} bytes; per-entry limit is ${limits.maxEntryBytes}.`);
    }
    if (compressedSize === 0 && uncompressedSize > 0 || compressedSize > 0 && uncompressedSize / compressedSize > limits.maxCompressionRatio) {
      fail("LIMIT_EXCEEDED", `ZIP entry ${path} exceeds compression-ratio limit ${limits.maxCompressionRatio}.`);
    }
    if (/\.(?:xml|rels)$/i.test(path) && uncompressedSize > limits.maxXmlBytes) {
      fail("LIMIT_EXCEEDED", `XML part ${path} is ${uncompressedSize} bytes; limit is ${limits.maxXmlBytes}.`);
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxUncompressedBytes) {
      fail("LIMIT_EXCEEDED", `ZIP expands beyond total limit ${limits.maxUncompressedBytes} bytes.`);
    }

    entries.push({ path, compressedSize, uncompressedSize, crc32: expectedCrc, method: method as 0 | 8, flags, localOffset });
  }
  if (offset !== centralOffset + centralSize) fail("INVALID_PACKAGE", "ZIP central-directory size does not match its records.");
  return entries;
}

function extractEntry(bytes: Uint8Array, metadata: ZipEntryMetadata): Uint8Array {
  const offset = metadata.localOffset;
  if (offset + 30 > bytes.length || u32(bytes, offset) !== LOCAL_SIGNATURE) {
    fail("INVALID_PACKAGE", `Invalid local ZIP header for ${metadata.path}.`);
  }
  const flags = u16(bytes, offset + 6);
  const method = u16(bytes, offset + 8);
  const nameLength = u16(bytes, offset + 26);
  const extraLength = u16(bytes, offset + 28);
  if ((flags & 0x0001) !== 0 || method !== metadata.method) fail("INVALID_PACKAGE", `ZIP header mismatch for ${metadata.path}.`);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + metadata.compressedSize;
  if (dataEnd > bytes.length) fail("INVALID_PACKAGE", `Truncated ZIP data for ${metadata.path}.`);
  const compressed = bytes.subarray(dataStart, dataEnd);
  let data: Uint8Array;
  try {
    data = metadata.method === 0 ? new Uint8Array(compressed) : inflateSync(compressed, { out: new Uint8Array(metadata.uncompressedSize) });
  } catch (error) {
    throw new WorkbookError("INVALID_PACKAGE", `Cannot decompress ZIP entry ${metadata.path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (data.byteLength !== metadata.uncompressedSize) fail("INVALID_PACKAGE", `Uncompressed size mismatch for ${metadata.path}.`);
  if (crc32(data) !== metadata.crc32) fail("INVALID_PACKAGE", `CRC-32 mismatch for ${metadata.path}.`);
  return data;
}

export class SafeZipArchive {
  readonly entries: Map<string, ZipEntry>;
  readonly limits: WorkbookLimits;
  private readonly lazyState?: { archiveBytes: number; inflated: Set<string> };

  private constructor(entries: Map<string, ZipEntry>, limits: WorkbookLimits, lazyState?: { archiveBytes: number; inflated: Set<string> }) {
    this.entries = entries;
    this.limits = limits;
    this.lazyState = lazyState;
  }

  static fromBytes(input: Uint8Array, limitOverrides?: Partial<WorkbookLimits>): SafeZipArchive {
    const limits = mergeLimits(limitOverrides);
    if (input.byteLength > limits.maxArchiveBytes) {
      fail("LIMIT_EXCEEDED", `Workbook is ${input.byteLength} bytes; archive limit is ${limits.maxArchiveBytes}.`);
    }
    if (input.byteLength >= 8 && input[0] === 0xd0 && input[1] === 0xcf && input[2] === 0x11 && input[3] === 0xe0) {
      fail("ENCRYPTED_PACKAGE", "OLE compound/encrypted Office packages are not supported.");
    }
    const metadata = parseCentralDirectory(input, limits);
    const entries = new Map<string, ZipEntry>();
    const lazyState = { archiveBytes: input.byteLength, inflated: new Set<string>() };
    for (const item of metadata) {
      let cached: Uint8Array | undefined;
      const entry = { ...item } as ZipEntry;
      Object.defineProperty(entry, "data", {
        enumerable: true,
        get() {
          if (!cached) {
            cached = extractEntry(input, item);
            lazyState.inflated.add(item.path);
          }
          return cached;
        },
      });
      entries.set(item.path, entry);
    }
    return new SafeZipArchive(entries, limits, lazyState);
  }

  static fromEntries(input: Map<string, Uint8Array>, limitOverrides?: Partial<WorkbookLimits>): SafeZipArchive {
    const limits = mergeLimits(limitOverrides);
    const entries = new Map<string, ZipEntry>();
    let total = 0;
    for (const [rawPath, rawData] of input) {
      const path = validatePartPath(rawPath);
      const data = new Uint8Array(rawData);
      total += data.byteLength;
      if (data.byteLength > limits.maxEntryBytes || total > limits.maxUncompressedBytes) fail("LIMIT_EXCEEDED", `Entry limits exceeded while creating ${path}.`);
      entries.set(path, { path, data, compressedSize: data.byteLength, uncompressedSize: data.byteLength, crc32: crc32(data), method: 0, flags: 0, localOffset: 0 });
    }
    return new SafeZipArchive(entries, limits);
  }

  get(path: string): Uint8Array | undefined {
    return this.entries.get(path)?.data;
  }

  require(path: string): Uint8Array {
    const data = this.get(path);
    if (!data) fail("INVALID_PACKAGE", `Required OOXML part is missing: ${path}.`);
    return data;
  }

  set(path: string, data: Uint8Array): void {
    validatePartPath(path);
    if (data.byteLength > this.limits.maxEntryBytes) fail("LIMIT_EXCEEDED", `Updated part ${path} exceeds the per-entry limit.`);
    this.entries.set(path, { path, data: new Uint8Array(data), compressedSize: data.byteLength, uncompressedSize: data.byteLength, crc32: crc32(data), method: 0, flags: 0, localOffset: 0 });
  }

  delete(path: string): boolean {
    return this.entries.delete(path);
  }

  storageStats(): { archiveBytes?: number; entryCount: number; totalUncompressedBytes: number; inflatedEntryCount: number; lazy: boolean } {
    return {
      ...(this.lazyState ? { archiveBytes: this.lazyState.archiveBytes } : {}),
      entryCount: this.entries.size,
      totalUncompressedBytes: [...this.entries.values()].reduce((sum, entry) => sum + entry.uncompressedSize, 0),
      inflatedEntryCount: this.lazyState?.inflated.size ?? this.entries.size,
      lazy: Boolean(this.lazyState),
    };
  }

  clone(): SafeZipArchive {
    return SafeZipArchive.fromEntries(new Map([...this.entries].map(([path, entry]) => [path, entry.data])), this.limits);
  }

  toBytes(level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6): Uint8Array {
    const files = Object.create(null) as Record<string, Uint8Array>;
    for (const path of [...this.entries.keys()].sort()) files[path] = this.entries.get(path)!.data;
    const output = zipSync(files, { level });
    if (output.byteLength > this.limits.maxArchiveBytes) fail("LIMIT_EXCEEDED", `Output ZIP exceeds archive limit ${this.limits.maxArchiveBytes}.`);
    return output;
  }
}
