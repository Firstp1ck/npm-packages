import { mkdirSync } from "node:fs";
import fs from "node:fs/promises";

export function ensureDir(directory: string, options: { mode?: number } = {}): void {
  mkdirSync(directory, { recursive: true, mode: options.mode });
}

export async function syncFile(filePath: string): Promise<void> {
  const handle = await fs.open(filePath, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Flush directory metadata where supported. Windows does not allow opening directories this way. */
export async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await fs.open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}
