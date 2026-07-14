import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CACHE_VERSION = "ooxml-safe-bitmap-v2";
const cacheRoot = path.join(os.tmpdir(), "pi-workbook-preview-cache", CACHE_VERSION);
const inFlight = new Map<string, Promise<{ png: Uint8Array; cachePath: string; cacheHit: boolean }>>();

function cacheKey(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify({ version: CACHE_VERSION, ...input })).digest("hex");
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
}

async function pruneCache(maxFiles = 256, maxBytes = 512 * 1024 * 1024): Promise<void> {
  const names = await fs.readdir(cacheRoot).catch(() => []);
  const files = (await Promise.all(names.filter((name) => name.endsWith(".png")).map(async (name) => {
    const filePath = path.join(cacheRoot, name);
    const stat = await fs.stat(filePath).catch(() => undefined);
    return stat ? { filePath, mtime: stat.mtimeMs, bytes: stat.size } : undefined;
  }))).filter((item): item is { filePath: string; mtime: number; bytes: number } => Boolean(item)).sort((a, b) => b.mtime - a.mtime);
  let total = 0;
  for (let index = 0; index < files.length; index++) {
    total += files[index].bytes;
    if (index >= maxFiles || total > maxBytes) await fs.rm(files[index].filePath, { force: true }).catch(() => undefined);
  }
}

export async function getOrCreatePreview(
  input: { workbookSha256: string; sheet: string; range: string; scale: number; renderer: string },
  render: () => Uint8Array,
): Promise<{ png: Uint8Array; cachePath: string; cacheHit: boolean; cacheKey: string }> {
  const key = cacheKey(input);
  const existing = inFlight.get(key);
  if (existing) return { ...(await existing), cacheKey: key };
  const work = (async () => {
    await fs.mkdir(cacheRoot, { recursive: true });
    const cachePath = path.join(cacheRoot, `${key}.png`);
    const cached = await fs.readFile(cachePath).catch(() => undefined);
    if (cached && isPng(cached)) {
      const now = new Date();
      await fs.utimes(cachePath, now, now).catch(() => undefined);
      return { png: new Uint8Array(cached), cachePath, cacheHit: true };
    }
    const png = render();
    if (!isPng(png)) throw new Error("Preview renderer returned invalid PNG bytes.");
    const temporary = path.join(cacheRoot, `.${key}.${randomUUID()}.tmp`);
    await fs.writeFile(temporary, png, { mode: 0o600 });
    try { await fs.rename(temporary, cachePath); }
    catch (error) {
      if (process.platform === "win32") {
        await fs.rm(cachePath, { force: true }).catch(() => undefined);
        await fs.rename(temporary, cachePath);
      } else throw error;
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
    void pruneCache();
    return { png: new Uint8Array(png), cachePath, cacheHit: false };
  })();
  inFlight.set(key, work);
  try { return { ...(await work), cacheKey: key }; }
  finally { inFlight.delete(key); }
}

export function previewCacheDirectory(): string {
  return cacheRoot;
}
