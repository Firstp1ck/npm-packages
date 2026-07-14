import fs from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../pi-utils.ts";

async function syncFile(filePath: string): Promise<void> {
  const handle = await fs.open(filePath, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory: string): Promise<void> {
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

export async function durableAtomicWrite(filePath: string, data: Uint8Array): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const sibling = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.candidate`;
  try {
    await writeFileAtomic(sibling, data);
    await syncFile(sibling);
    await fs.rename(sibling, filePath);
    await syncDirectory(directory);
  } finally {
    await fs.rm(sibling, { force: true }).catch(() => undefined);
  }
}
