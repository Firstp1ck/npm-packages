import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { syncDirectory } from "@firstpick/pi-utils/filesystem";
import { fail } from "../errors.ts";
export function recoveryPathFor(destination: string): string { const extension = path.extname(destination), stamp = new Date().toISOString().replace(/[:.]/g, "-"); return destination.slice(0, -extension.length) + `.pi-recovery-${stamp}` + extension; }
export async function durableAtomicReplace(destination: string, data: Uint8Array, options: { overwrite: boolean; permanentRecovery?: boolean }): Promise<{ recoveryPath?: string }> {
  const directory = path.dirname(destination), temp = path.join(directory, `.${path.basename(destination)}.pi-tmp-${randomUUID()}`);
  const existing = await fs.lstat(destination).catch(() => undefined);
  if (existing?.isSymbolicLink()) fail("PERMISSION_DENIED", `Refusing symlink destination: ${destination}`);
  if (existing && !options.overwrite) fail("DESTINATION_EXISTS", `Destination exists: ${destination}`);
  let recoveryPath: string | undefined;
  if (existing && options.permanentRecovery) {
    recoveryPath = recoveryPathFor(destination);
    await fs.copyFile(destination, recoveryPath, fs.constants.COPYFILE_EXCL);
    const recoveryHandle = await fs.open(recoveryPath, "r+");
    try { await recoveryHandle.sync(); } finally { await recoveryHandle.close(); }
  }
  const handle = await fs.open(temp, "wx", 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  let rollbackPath: string | undefined;
  try {
    if (!existing) await fs.rename(temp, destination);
    else {
      try { await fs.rename(temp, destination); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!new Set(["EEXIST", "EPERM", "EACCES", "ENOTEMPTY"]).has(code ?? "")) throw error;
        rollbackPath = path.join(directory, `.${path.basename(destination)}.pi-rollback-${randomUUID()}`);
        await fs.rename(destination, rollbackPath);
        try { await fs.rename(temp, destination); }
        catch (replaceError) { await fs.rename(rollbackPath, destination).catch(() => undefined); rollbackPath = undefined; throw replaceError; }
      }
    }
    await syncDirectory(directory);
    if (rollbackPath) await fs.rm(rollbackPath, { force: true });
    return { recoveryPath };
  } catch (error) {
    if (recoveryPath && !await fs.stat(destination).then(() => true, () => false)) await fs.copyFile(recoveryPath, destination).catch(() => undefined);
    throw error;
  } finally { await fs.rm(temp, { force: true }).catch(() => undefined); }
}
