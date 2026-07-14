import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeExcelCandidate } from "../../src/backends/excel-native.ts";
import { OoxmlSafeEngine } from "../../src/backends/ooxml-safe.ts";
import { runCommand } from "../../src/pi-utils.ts";
import { sha256Bytes } from "../../src/core/hash.ts";
import { OoxmlPackage } from "../../src/ooxml/package.ts";
import { diffWorkbookPackages } from "../../src/ooxml/diff.ts";
import { validatePackage } from "../../src/ooxml/validate.ts";
import { writeWorkbookFixture } from "../fixture-builder.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const reportPath = path.join(here, "LAST-NATIVE-BAKEOFF.json");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pi-workbook-native-bakeoff-"));

function parseLastJson(stdout) {
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  return line ? JSON.parse(line) : undefined;
}

async function createMacroFixture(outputPath) {
  const result = await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(here, "create-excel-macro-fixture.ps1"), "-OutputPath", outputPath], { timeoutMs: 60_000, maxStdoutChars: 12_000, maxStderrChars: 12_000 });
  return { command: result, payload: parseLastJson(result.stdout) };
}

async function packageEvidence(beforePath, afterPath) {
  const before = OoxmlPackage.fromBytes(await fs.readFile(beforePath));
  const after = OoxmlPackage.fromBytes(await fs.readFile(afterPath));
  const allowedNonProtected = new Set([...before.archive.entries.keys()].filter((part) => !before.protectedParts.has(part)));
  const integrity = before.compareIntegrity(after, allowedNonProtected);
  const difference = diffWorkbookPackages(before, after, { maxChanges: 2000 });
  const validation = validatePackage(after, afterPath);
  const protectedHashes = Object.fromEntries([...before.protectedParts].sort().map((part) => [part, {
    before: sha256Bytes(before.archive.require(part)),
    after: after.archive.get(part) ? sha256Bytes(after.archive.require(part)) : null,
  }]));
  return {
    validation,
    integrity,
    semantic: {
      addedSheets: difference.addedSheets,
      removedSheets: difference.removedSheets,
      changedCells: difference.changedCells,
      protectedPartChanges: difference.protectedPartChanges,
    },
    packageChanges: {
      changedParts: difference.changedParts,
      addedParts: difference.addedParts,
      removedParts: difference.removedParts,
    },
    protectedHashes,
  };
}

async function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const result = await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `if(Get-Process -Id ${pid} -ErrorAction SilentlyContinue){exit 0}else{exit 3}`], { timeoutMs: 5000 });
  return result.ok;
}

try {
  if (process.platform !== "win32") {
    const report = { status: "SKIP", reason: "Native Excel bakeoff requires interactive Windows.", timestamp: new Date().toISOString() };
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
    process.exit(0);
  }

  const candidate = new NativeExcelCandidate();
  const ooxml = new OoxmlSafeEngine(temporary);
  const probe = await candidate.probe();
  assert.equal(probe.ok, true);
  assert.equal(probe.ownedExcelProcess, true);
  assert.equal(probe.automationSecurity, "ForceDisable");

  const sourceXlsx = await writeWorkbookFixture(path.join(temporary, "source.xlsx"));
  const roundtripXlsx = path.join(temporary, "native-roundtrip.xlsx");
  const editedXlsx = path.join(temporary, "native-edited.xlsx");
  const xlsxRoundtripWorker = await candidate.roundTrip(sourceXlsx, roundtripXlsx);
  const xlsxEditWorker = await candidate.edit(sourceXlsx, editedXlsx, [
    { type: "setValue", sheet: "Sheet1", range: "A3", value: "=native-literal" },
    { type: "setFormula", sheet: "Sheet1", range: "C3", formula: "B1*3" },
    { type: "setStyle", sheet: "Sheet1", range: "A1:C1", style: { font: { bold: true, color: "FFFFFF" }, fill: { foreground: "1F4E78" }, border: { bottom: { style: "thin", color: "FFFFFF" } }, alignment: { horizontal: "center", wrapText: true }, numberFormat: "0.00" } },
    { type: "setRowHeight", sheet: "Sheet1", startRow: 1, height: 24 },
    { type: "setColumnWidth", sheet: "Sheet1", startColumn: "A", endColumn: "C", width: 18 },
    { type: "unmerge", sheet: "Sheet1", range: "B2:C2" },
    { type: "merge", sheet: "Sheet1", range: "A3:B3" },
  ]);
  const xlsxRoundtripEvidence = await packageEvidence(sourceXlsx, roundtripXlsx);
  const xlsxEditEvidence = await packageEvidence(sourceXlsx, editedXlsx);
  const xlsxRead = await ooxml.read({ path: editedXlsx, sheet: "Sheet1", range: "A1:C3" });
  const nativeLiteral = xlsxRead.cells.find((cell) => cell.reference === "A3");
  assert.equal(nativeLiteral?.value, "=native-literal");
  assert.equal(nativeLiteral?.formula, undefined);
  assert.equal(xlsxRead.cells.find((cell) => cell.reference === "C3")?.formula, "B1*3");

  const sourceXlsm = path.join(temporary, "macro-sentinel.xlsm");
  const macroCreation = await createMacroFixture(sourceXlsm);
  if (!macroCreation.command.ok || macroCreation.payload?.ok !== true) throw new Error(`Real XLSM fixture generation failed without changing Trust Center settings: ${JSON.stringify(macroCreation)}`);
  const roundtripXlsm = path.join(temporary, "native-roundtrip.xlsm");
  const editedXlsm = path.join(temporary, "native-edited.xlsm");
  const xlsmRoundtripWorker = await candidate.roundTrip(sourceXlsm, roundtripXlsm);
  const xlsmEditWorker = await candidate.edit(sourceXlsm, editedXlsm, [
    { type: "setValue", sheet: "Sentinel", range: "B2", value: "=native-literal" },
    { type: "setFormula", sheet: "Sentinel", range: "C2", formula: "A2*2" },
    { type: "setStyle", sheet: "Sentinel", range: "A1:C2", style: { font: { bold: true }, fill: { foreground: "D9EAD3" }, alignment: { horizontal: "center" } } },
  ]);
  const xlsmRoundtripEvidence = await packageEvidence(sourceXlsm, roundtripXlsm);
  const xlsmEditEvidence = await packageEvidence(sourceXlsm, editedXlsm);
  const xlsmRead = await ooxml.read({ path: editedXlsm, sheet: "Sentinel", range: "A1:C2" });
  const macroLiteral = xlsmRead.cells.find((cell) => cell.reference === "B2");
  assert.equal(macroLiteral?.value, "=native-literal");
  assert.equal(macroLiteral?.formula, undefined);

  const validationResults = [];
  for (const workbookPath of [sourceXlsx, roundtripXlsx, editedXlsx, sourceXlsm, roundtripXlsm, editedXlsm]) {
    const result = await candidate.validate(workbookPath);
    validationResults.push({ path: path.basename(workbookPath), ...result });
    if (result.sentinelExecuted || result.sourceHashBefore !== result.sourceHashAfter) throw new Error(`Unsafe validation result for ${workbookPath}`);
  }

  let timeoutEvidence;
  try {
    await candidate.exerciseTimeout(2500);
    throw new Error("Native hang action did not time out.");
  } catch (error) {
    if (error?.code !== "BACKEND_UNAVAILABLE" || !/timed out/.test(error.message)) throw error;
    const cleanup = error.details?.cleanup;
    assert.equal(cleanup?.excelKillAttempted, true);
    assert.equal(cleanup?.excelKilled, true);
    const excelPid = cleanup?.control?.excelPid;
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(await processExists(excelPid), false);
    timeoutEvidence = { error: error.message, cleanup, excelProcessStillRunning: false };
  }

  const xlsxNoOpQualified = xlsxRoundtripEvidence.validation.ok
    && xlsxRoundtripEvidence.semantic.addedSheets.length === 0
    && xlsxRoundtripEvidence.semantic.removedSheets.length === 0
    && xlsxRoundtripEvidence.semantic.changedCells.length === 0;
  const xlsmNoOpQualified = xlsmRoundtripEvidence.validation.ok
    && xlsmRoundtripEvidence.integrity.ok
    && xlsmRoundtripEvidence.semantic.protectedPartChanges.length === 0
    && xlsmRoundtripEvidence.semantic.changedCells.length === 0;
  const xlsmEditQualified = xlsmEditEvidence.validation.ok
    && xlsmEditEvidence.integrity.ok
    && xlsmEditEvidence.semantic.protectedPartChanges.length === 0;

  const report = {
    status: "PASS",
    timestamp: new Date().toISOString(),
    policy: {
      certificateStoreModified: false,
      trustCenterModified: false,
      aspose: "deferred",
      publicNativeMutationEnabled: false,
    },
    probe,
    qualification: {
      xlsxNoOp: xlsxNoOpQualified,
      xlsxCandidateEdit: xlsxEditEvidence.validation.ok,
      xlsmNoOp: xlsmNoOpQualified,
      xlsmCandidateEdit: xlsmEditQualified,
      decision: xlsxNoOpQualified && xlsmNoOpQualified && xlsmEditQualified
        ? "Candidate passed this bounded corpus; keep disabled until the full P0 corpus and repair-dialog gate pass."
        : "Candidate failed one or more fidelity gates and remains disabled for the affected format.",
    },
    workers: { xlsxRoundtripWorker, xlsxEditWorker, xlsmRoundtripWorker, xlsmEditWorker },
    evidence: { xlsxRoundtripEvidence, xlsxEditEvidence, xlsmRoundtripEvidence, xlsmEditEvidence, validationResults, timeoutEvidence },
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: report.status, qualification: report.qualification, reportPath }, null, 2));
} catch (error) {
  const report = {
    status: "FAIL",
    timestamp: new Date().toISOString(),
    policy: { certificateStoreModified: false, trustCenterModified: false, aspose: "deferred", publicNativeMutationEnabled: false },
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(JSON.stringify({ ...report, reportPath }, null, 2));
  process.exitCode = 1;
} finally {
  await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
}
