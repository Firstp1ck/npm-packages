import fs from "node:fs/promises";
import path from "node:path";
import { syncDirectory, syncFile } from "@firstpick/pi-utils/filesystem";
import { writeFileAtomic } from "../pi-utils.ts";

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
