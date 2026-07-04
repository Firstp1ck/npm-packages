import fs from "node:fs";
import path from "node:path";

export type AtomicWriteOptions = {
  mode?: number;
  encoding?: BufferEncoding;
};

function atomicTempPath(filePath: string): string {
  return `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
}

export function readJsonFile<T = unknown>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function readJsonIfExists<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  return readJsonFile<T>(filePath);
}

export function writeJsonFile(filePath: string, data: unknown, options: { mode?: number } = {}): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: options.mode });
}

export function writeFileAtomicSync(filePath: string, data: string | NodeJS.ArrayBufferView, options: AtomicWriteOptions = {}): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpFile = atomicTempPath(filePath);
  try {
    fs.writeFileSync(tmpFile, data, { encoding: options.encoding ?? "utf8", mode: options.mode });
    if (options.mode !== undefined) fs.chmodSync(tmpFile, options.mode);
    fs.renameSync(tmpFile, filePath);
  } catch (error) {
    try { fs.rmSync(tmpFile, { force: true }); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

export function writeJsonFileAtomicSync(filePath: string, data: unknown, options: AtomicWriteOptions = {}): void {
  writeFileAtomicSync(filePath, `${JSON.stringify(data, null, 2)}\n`, { ...options, encoding: options.encoding ?? "utf8" });
}

export async function readJsonFileAsync<T = unknown>(filePath: string): Promise<T> {
  return JSON.parse(await fs.promises.readFile(filePath, "utf8")) as T;
}

export async function readJsonIfExistsAsync<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return await readJsonFileAsync<T>(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJsonFileAsync(filePath: string, data: unknown, options: { mode?: number } = {}): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: options.mode });
}

export async function writeFileAtomic(filePath: string, data: string | NodeJS.ArrayBufferView, options: AtomicWriteOptions = {}): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmpFile = atomicTempPath(filePath);
  try {
    await fs.promises.writeFile(tmpFile, data, { encoding: options.encoding ?? "utf8", mode: options.mode });
    if (options.mode !== undefined) await fs.promises.chmod(tmpFile, options.mode);
    await fs.promises.rename(tmpFile, filePath);
  } catch (error) {
    try { await fs.promises.rm(tmpFile, { force: true }); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

export async function writeJsonFileAtomic(filePath: string, data: unknown, options: AtomicWriteOptions = {}): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`, { ...options, encoding: options.encoding ?? "utf8" });
}
