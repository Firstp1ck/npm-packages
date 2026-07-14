import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { writeWorkbookFixture } from "../fixture-builder.mjs";
import { OoxmlSafeEngine } from "../../src/backends/ooxml-safe.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pi-workbook-excel-host-"));

function runPowerShell(script, args, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => {
      spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      finish({ ok: false, code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ ok: false, code: null, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => finish({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

try {
  if (process.platform !== "win32") {
    console.log(JSON.stringify({ status: "SKIP", reason: "Controlled Excel validation requires interactive Windows." }, null, 2));
    process.exit(0);
  }
  const sourceXlsx = await writeWorkbookFixture(path.join(temporary, "source.xlsx"));
  const engine = new OoxmlSafeEngine(temporary);
  const inspection = await engine.inspect({ path: sourceXlsx });
  const editedXlsx = path.join(temporary, "edited.xlsx");
  await engine.edit({
    path: sourceXlsx,
    schemaVersion: "1.0",
    operations: [
      { type: "setValue", sheet: "Sheet1", range: "A3", value: "Excel host validation" },
      { type: "setFormula", sheet: "Sheet1", range: "C3", formula: "B1*2" },
      { type: "setStyle", sheet: "Sheet1", range: "A1:C1", style: { font: { bold: true, color: "FFFFFF" }, fill: { foreground: "1F4E78" }, border: { bottom: { style: "thin", color: "FFFFFF" } }, alignment: { horizontal: "center", wrapText: true }, numberFormat: "0.00" } },
      { type: "setRowHeight", sheet: "Sheet1", startRow: 1, height: 24 },
      { type: "setColumnWidth", sheet: "Sheet1", startColumn: "A", endColumn: "C", width: 18 },
      { type: "unmerge", sheet: "Sheet1", range: "B2:C2" },
      { type: "merge", sheet: "Sheet1", range: "A3:B3" },
    ],
    outputPath: editedXlsx,
    dryRun: false,
    expectedSha256: inspection.sourceSha256,
  });

  const macroPath = path.join(temporary, "macro-sentinel.xlsm");
  const macroCreation = await runPowerShell(path.join(here, "create-excel-macro-fixture.ps1"), ["-OutputPath", macroPath]);
  const files = [sourceXlsx, editedXlsx];
  let macroStatus = { status: "SKIP", reason: "Macro fixture could not be generated without changing Excel Trust Center settings.", evidence: macroCreation };
  if (macroCreation.ok) {
    const macroInspection = await engine.inspect({ path: macroPath });
    const editedMacro = path.join(temporary, "macro-sentinel-edited.xlsm");
    const macroEdit = await engine.edit({ path: macroPath, schemaVersion: "1.0", operations: [{ type: "setValue", sheet: "Sentinel", range: "B2", value: 84 }], outputPath: editedMacro, dryRun: false, expectedSha256: macroInspection.sourceSha256 });
    files.push(macroPath, editedMacro);
    macroStatus = { status: "PASS", sourceSha256: macroInspection.sourceSha256, outputSha256: macroEdit.outputSha256, protectedParts: macroEdit.protectedParts };
  }

  const validation = await runPowerShell(path.join(here, "validate-with-excel.ps1"), ["-WorkbookPaths", files.join("|")], 90_000);
  let validationPayload;
  try { validationPayload = JSON.parse(validation.stdout.split(/\r?\n/).at(-1)); } catch { validationPayload = validation; }
  if (!validation.ok || validationPayload.ok !== true) throw new Error(`Excel validation failed: ${JSON.stringify(validationPayload)}`);
  if (validationPayload.results.length !== files.length) throw new Error(`Excel validator returned ${validationPayload.results.length} result(s) for ${files.length} files.`);
  if (validationPayload.results.some((result) => result.sentinelExecuted || !result.hashUnchanged)) throw new Error("Excel validation executed a macro sentinel or modified a source file.");

  const report = { status: macroStatus.status === "PASS" ? "PASS" : "PARTIAL", temporary, xlsx: "PASS", macro: macroStatus, excelValidation: validationPayload };
  const reportPath = path.join(root, "tests/corpus/LAST-EXCEL-HOST-REPORT.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
} finally {
  await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
}
