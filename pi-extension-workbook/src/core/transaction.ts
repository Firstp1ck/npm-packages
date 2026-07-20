import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { samePath } from "@firstpick/pi-utils/paths";
import { canonicalWorkbookOutputPath, defaultOutputPath, requireWorkbookFile } from "./paths.ts";
import { durableAtomicWrite } from "./io.ts";
import { sha256Bytes, sha256File } from "./hash.ts";
import { assertNotAborted, fail } from "../errors.ts";
import { OoxmlPackage } from "../ooxml/package.ts";
import { applyWorkbookOperations } from "../ooxml/edit.ts";
import type { WorkbookEditRequest } from "../contracts.ts";
import { validatePackage } from "../ooxml/validate.ts";

export type MutationQueue = <T>(key: string, work: () => Promise<T>) => Promise<T>;

export type TransactionResult = {
  dryRun: boolean;
  sourcePath: string;
  outputPath: string;
  sourceSha256: string;
  outputSha256: string;
  recoveryPath?: string;
  engine: "ooxml-safe";
  operationSummary: ReturnType<typeof applyWorkbookOperations>["operationSummary"];
  changedParts: string[];
  protectedParts: string[];
  validation: ReturnType<typeof validatePackage>;
  warnings: string[];
};

function recoveryPathFor(sourcePath: string): string {
  const extension = path.extname(sourcePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return sourcePath.slice(0, -extension.length) + `.pi-recovery-${stamp}` + extension;
}

export async function executeEditTransaction(request: WorkbookEditRequest, cwd: string, queue: MutationQueue, signal?: AbortSignal): Promise<TransactionResult> {
  assertNotAborted(signal);
  const sourcePath = await requireWorkbookFile(request.path, cwd);
  const outputPath = await canonicalWorkbookOutputPath(request.outputPath ?? defaultOutputPath(sourcePath), cwd);
  if (path.extname(sourcePath).toLowerCase() !== path.extname(outputPath).toLowerCase()) fail("INVALID_ARGUMENT", "Output extension must match source extension; silent .xlsx/.xlsm conversion is forbidden.");
  const dryRun = request.dryRun ?? true;
  const sourceSha256 = await sha256File(sourcePath);
  if (!dryRun && !request.expectedSha256) fail("CONFLICT", "expectedSha256 is mandatory for every non-dry-run commit.", { actualSha256: sourceSha256 });
  if (request.expectedSha256 && request.expectedSha256.toLowerCase() !== sourceSha256) fail("CONFLICT", "Workbook changed since inspection/dry-run.", { expectedSha256: request.expectedSha256, actualSha256: sourceSha256 });

  const work = async (): Promise<TransactionResult> => {
    assertNotAborted(signal);
    const queuedSourceHash = await sha256File(sourcePath);
    if (queuedSourceHash !== sourceSha256) fail("CONFLICT", "Workbook changed while waiting for the destination mutation queue.", { expectedSha256: sourceSha256, actualSha256: queuedSourceHash });
    const destinationExists = await fs.stat(outputPath).then(() => true, () => false);
    if (destinationExists && !request.overwrite) fail("OUTPUT_EXISTS", `Destination exists; pass overwrite=true or choose another path: ${outputPath}`);
    if (samePath(sourcePath, outputPath) && !request.overwrite) fail("OUTPUT_EXISTS", "In-place editing requires overwrite=true.");

    const transactionDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-workbook-transaction-"));
    let recoveryPath: string | undefined;
    try {
      const stagedSource = path.join(transactionDir, `${randomUUID()}${path.extname(sourcePath)}`);
      await fs.copyFile(sourcePath, stagedSource);
      const sourceBytes = await fs.readFile(stagedSource);
      const baseline = OoxmlPackage.fromBytes(sourceBytes, request.limits);
      const applied = applyWorkbookOperations(baseline, outputPath, request.operations, signal);
      const outputSha256 = sha256Bytes(applied.bytes);
      const result: TransactionResult = {
        dryRun,
        sourcePath,
        outputPath,
        sourceSha256,
        outputSha256,
        engine: "ooxml-safe",
        operationSummary: applied.operationSummary,
        changedParts: applied.changedParts,
        protectedParts: [...baseline.protectedParts].sort(),
        validation: applied.validation,
        warnings: applied.warnings,
      };
      if (dryRun) return result;

      if (samePath(sourcePath, outputPath)) {
        recoveryPath = recoveryPathFor(sourcePath);
        await fs.copyFile(sourcePath, recoveryPath, fs.constants.COPYFILE_EXCL);
        result.recoveryPath = recoveryPath;
      }
      try {
        await durableAtomicWrite(outputPath, applied.bytes);
        const committedBytes = await fs.readFile(outputPath);
        if (sha256Bytes(committedBytes) !== outputSha256) fail("VALIDATION_FAILED", "Committed workbook hash differs from staged candidate hash.");
        const committed = OoxmlPackage.fromBytes(committedBytes, request.limits);
        const postCommit = validatePackage(committed, outputPath, baseline, new Set(applied.allowedChangedParts));
        if (!postCommit.ok) fail("VALIDATION_FAILED", `Post-commit validation failed: ${postCommit.errors.join("; ")}`);
        result.validation = postCommit;
        return result;
      } catch (error) {
        if (recoveryPath) await fs.copyFile(recoveryPath, sourcePath).catch(() => undefined);
        throw error;
      }
    } finally {
      await fs.rm(transactionDir, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  return queue(path.resolve(outputPath), work);
}
