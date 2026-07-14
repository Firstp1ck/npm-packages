import fs from "node:fs/promises";
import path from "node:path";
import { resolveUserPath } from "../pi-utils.ts";
import { fail } from "../errors.ts";

export function resolveWorkbookPath(input: string, cwd: string): string {
  const resolved = resolveUserPath(input, cwd);
  const extension = path.extname(resolved).toLowerCase();
  if (extension !== ".xlsx" && extension !== ".xlsm") fail("INVALID_ARGUMENT", `Workbook path must end in .xlsx or .xlsm: ${resolved}`);
  return resolved;
}

export async function requireWorkbookFile(input: string, cwd: string): Promise<string> {
  const resolved = resolveWorkbookPath(input, cwd);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    fail("NOT_FOUND", `Workbook not found: ${resolved}`);
  }
  if (!stat.isFile()) fail("INVALID_ARGUMENT", `Workbook path is not a file: ${resolved}`);
  return fs.realpath(resolved);
}

export async function canonicalWorkbookOutputPath(input: string, cwd: string): Promise<string> {
  const resolved = resolveWorkbookPath(input, cwd);
  try {
    return await fs.realpath(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const missingSegments: string[] = [];
  let cursor = resolved;
  while (true) {
    const parent = path.dirname(cursor);
    missingSegments.push(path.basename(cursor));
    try {
      const realParent = await fs.realpath(parent);
      return path.join(realParent, ...missingSegments.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || parent === cursor) throw error;
      cursor = parent;
    }
  }
}

export function defaultOutputPath(sourcePath: string): string {
  const extension = path.extname(sourcePath);
  return sourcePath.slice(0, -extension.length) + ".pi-edited" + extension;
}
