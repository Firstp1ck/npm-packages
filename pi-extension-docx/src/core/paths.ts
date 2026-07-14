import fs from "node:fs/promises";
import path from "node:path";
import { resolveUserPath } from "../pi-utils.ts";
import { fail } from "../errors.ts";

const READABLE = new Set([".docx", ".dotx", ".docm", ".dotm"]);
export function samePath(a: string, b: string): boolean {
  const normalize = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(a) === normalize(b);
}
export async function requireOfficeFile(input: string, cwd: string): Promise<string> {
  const filePath = resolveUserPath(input, cwd);
  const extension = path.extname(filePath).toLowerCase();
  if (!READABLE.has(extension)) fail("INVALID_ARGUMENT", `Expected .docx, .dotx, .docm, or .dotm: ${filePath}`);
  const stat = await fs.lstat(filePath).catch(() => undefined);
  if (!stat?.isFile() || stat.isSymbolicLink()) fail("INVALID_ARGUMENT", `Source must be an existing regular non-symlink file: ${filePath}`);
  return fs.realpath(filePath);
}
export function requireMutableDocx(filePath: string): void {
  if (path.extname(filePath).toLowerCase() !== ".docx") fail("ACTIVE_CONTENT_BLOCKED", "P1 mutation is supported only for macro-free .docx files. Create a new .docx through an explicitly reviewed conversion workflow for other formats.");
}
export async function canonicalOutputPath(input: string, cwd: string): Promise<string> {
  const output = resolveUserPath(input, cwd);
  if (path.extname(output).toLowerCase() !== ".docx") fail("INVALID_ARGUMENT", "DOCX commits require a .docx destination; silent format conversion is forbidden.");
  const parent = path.dirname(output);
  const parentStat = await fs.stat(parent).catch(() => undefined);
  if (!parentStat?.isDirectory()) fail("INVALID_ARGUMENT", `Destination parent does not exist: ${parent}`);
  const realParent = await fs.realpath(parent);
  const canonical = path.join(realParent, path.basename(output));
  const stat = await fs.lstat(canonical).catch(() => undefined);
  if (stat?.isSymbolicLink()) fail("PERMISSION_DENIED", `Refusing symlink destination: ${canonical}`);
  return canonical;
}
export function defaultOutputPath(sourcePath: string): string {
  return sourcePath.slice(0, -path.extname(sourcePath).length) + ".pi-edited.docx";
}
export function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "document";
}
