import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OoxmlSafeEngine } from "../../src/backends/ooxml-safe.ts";
import { sha256File } from "../../src/core/hash.ts";
import { OoxmlPackage } from "../../src/ooxml/package.ts";
import { validateWithExcelUi } from "./excel-ui-monitor.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const reportPath = path.join(here, "LAST-SIGNED-VBA-REPORT.json");
const vendoredFixturePath = path.join(here, "fixtures", "signed-vba", "xlsxwriter-macro04.xlsm");
const suppliedFixtureArgument = process.argv[2] || process.env.PI_WORKBOOK_SIGNED_XLSM_FIXTURE;
const sourcePath = suppliedFixtureArgument ? path.resolve(suppliedFixtureArgument) : vendoredFixturePath;
const fixtureProvenance = suppliedFixtureArgument
  ? { kind: "user-supplied", redistributed: false }
  : {
      kind: "vendored-open-source-test-fixture",
      repository: "https://github.com/jmcnamara/XlsxWriter",
      commit: "cf3fe78d3eab5e4c7d825d4451af3a60e2a04011",
      upstreamPath: "xlsxwriter/test/comparison/xlsx_files/macro04.xlsm",
      license: "BSD-2-Clause",
      expectedSha256: "d49e30414b59e66446689d77119fa5b9f4f99fa86dbcade003f4d3fe1b8e225d",
    };
assert.equal(path.extname(sourcePath).toLowerCase(), ".xlsm", "Signed VBA fixture must use the .xlsm extension.");
assert.equal((await fs.stat(sourcePath)).isFile(), true, `Signed VBA fixture is not a file: ${sourcePath}`);

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pi-workbook-signed-vba-"));
try {
  const engine = new OoxmlSafeEngine(temporary);
  const sourceSha256 = await sha256File(sourcePath);
  if ("expectedSha256" in fixtureProvenance) {
    assert.equal(sourceSha256, fixtureProvenance.expectedSha256, "Vendored signed-VBA fixture hash does not match its pinned provenance.");
  }
  const inspection = await engine.inspect({ path: sourcePath });
  assert.equal(inspection.validation.ok, true, inspection.validation.errors?.join("; "));
  assert.equal(inspection.vba.present, true, "Fixture does not contain a VBA project.");
  assert.ok(inspection.vba.signatures.length > 0, "Fixture does not expose a VBA signature part through content types or relationships.");

  const noOpPath = path.join(temporary, "signed-noop.xlsm");
  const baseline = OoxmlPackage.fromBytes(await fs.readFile(sourcePath));
  await fs.writeFile(noOpPath, baseline.archive.toBytes());
  const noOp = OoxmlPackage.fromBytes(await fs.readFile(noOpPath));
  const noOpIntegrity = baseline.compareIntegrity(noOp, new Set());
  assert.equal(noOpIntegrity.ok, true, noOpIntegrity.errors.join("; "));

  const editedPath = path.join(temporary, "signed-edited.xlsm");
  const sheet = inspection.sheets.find((item) => item.state === "visible") ?? inspection.sheets[0];
  assert.ok(sheet, "Fixture contains no worksheet.");
  const operations = [{ type: "setRowHeight", sheet: sheet.name, startRow: 1, height: 19 }];
  const dryRun = await engine.edit({ path: sourcePath, schemaVersion: "1.0", operations, outputPath: editedPath, dryRun: true });
  const committed = await engine.edit({ path: sourcePath, schemaVersion: "1.0", operations, outputPath: editedPath, dryRun: false, expectedSha256: sourceSha256 });
  const validation = await engine.validate({ path: editedPath, baselinePath: sourcePath });
  const difference = await engine.diff({ beforePath: sourcePath, afterPath: editedPath, sheet: sheet.name, range: "A1:A1", maxChanges: 10 });
  assert.equal(dryRun.validation.ok, true);
  assert.equal(committed.validation.ok, true);
  assert.equal(validation.ok, true, validation.errors?.join("; "));
  assert.deepEqual(difference.protectedPartChanges, []);
  assert.equal(await sha256File(sourcePath), sourceSha256, "Signed source fixture changed during bakeoff.");

  const uiValidation = process.platform === "win32"
    ? await validateWithExcelUi([sourcePath, noOpPath, editedPath], path.join(temporary, "renders"), 180_000)
    : { status: "SKIP", reason: "Excel repair-dialog validation requires controlled interactive Windows." };
  if (process.platform === "win32") {
    assert.equal(uiValidation.status, "PASS");
    assert.equal(uiValidation.modalWindowsDetected, 0);
    assert.equal(uiValidation.payload.results.every((result) => result.opened && result.readOnly && result.hashUnchanged && !result.sentinelExecuted), true);
  }

  const report = {
    status: uiValidation.status === "PASS" ? "PASS" : "PASS_PACKAGE_ONLY",
    generatedAt: new Date().toISOString(),
    fixture: { sourcePath, sourceSha256, legalProvenance: fixtureProvenance },
    policy: { certificateStoreModified: false, trustCenterModified: false, macrosExecuted: false, sourceModified: false },
    signatures: inspection.vba.signatures,
    protectedParts: inspection.protectedParts,
    noOp: { outputSha256: await sha256File(noOpPath), integrity: noOpIntegrity },
    edit: { outputSha256: await sha256File(editedPath), changedParts: committed.changedParts, protectedPartChanges: difference.protectedPartChanges, validationOk: validation.ok },
    uiValidation,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: report.status, signatureParts: report.signatures.length, protectedPartChanges: 0, uiValidation: uiValidation.status, reportPath }, null, 2));
} finally {
  await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
}
