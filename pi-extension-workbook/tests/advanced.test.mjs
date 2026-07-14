import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OoxmlSafeEngine } from "../src/backends/ooxml-safe.ts";
import { OoxmlPackage } from "../src/ooxml/package.ts";
import { sha256Bytes } from "../src/core/hash.ts";
import { NS, elements, parseXml, textContent } from "../src/ooxml/xml.ts";
import { writeWorkbookFixture } from "./fixture-builder.mjs";

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAE/wJ/lvRZ6QAAAABJRU5ErkJggg==";

async function workspace(t) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi-workbook-advanced-"));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  return cwd;
}

async function commit(engine, source, output, operations) {
  const inspect = await engine.inspect({ path: source });
  const dry = await engine.edit({ path: source, schemaVersion: "1.0", operations, outputPath: output, dryRun: true });
  assert.equal(dry.validation.ok, true);
  return engine.edit({ path: source, schemaVersion: "1.0", operations, outputPath: output, dryRun: false, expectedSha256: inspect.sourceSha256 });
}

for (const format of ["xlsx", "xlsm"]) {
  test(`advanced formatting, metadata, print, and protection operations preserve ${format}`, async (t) => {
    const cwd = await workspace(t);
    const source = await writeWorkbookFixture(path.join(cwd, `source.${format}`), { macro: format === "xlsm", theme: true });
    const output = path.join(cwd, `advanced.${format}`);
    const engine = new OoxmlSafeEngine(cwd);
    const before = OoxmlPackage.fromBytes(await fs.readFile(source));
    const operations = [
      { type: "setRichText", sheet: "Sheet1", range: "A1", runs: [{ text: "Rich ", font: { bold: true, color: "FF0000" } }, { text: "Text", font: { italic: true, verticalAlign: "superscript" } }] },
      { type: "setStyle", sheet: "Sheet1", range: "A2", style: { font: { underline: "double", outline: true, scheme: "minor" }, fill: { pattern: "lightTrellis", foreground: "FFFF00", background: "0000FF" }, border: { diagonal: { style: "thin", color: "00FF00" }, diagonalUp: true, diagonalDown: true }, alignment: { horizontal: "distributed", vertical: "center", justifyLastLine: true, readingOrder: 1, relativeIndent: 1, textRotation: 45 }, numberFormat: "#,##0.000", protection: { locked: false, hidden: true } } },
      { type: "copyFormat", sourceSheet: "Sheet1", sourceRange: "A2", sheet: "Sheet1", targetRange: "B2" },
      { type: "setRowProperties", sheet: "Sheet1", startRow: 2, height: 31, hidden: false, outlineLevel: 1, collapsed: false },
      { type: "setColumnProperties", sheet: "Sheet1", startColumn: "B", endColumn: "C", width: 17, hidden: false, outlineLevel: 1, bestFit: true },
      { type: "autoFit", sheet: "Sheet1", range: "A1:C3", rows: true, columns: true, minColumnWidth: 4, maxColumnWidth: 30 },
      { type: "setFreezePanes", sheet: "Sheet1", rows: 1, columns: 1 },
      { type: "setConditionalFormatting", sheet: "Sheet1", range: "C2:C3", rules: [{ type: "cellIs", operator: "greaterThan", formulas: ["5"], stopIfTrue: true, style: { font: { bold: true, color: "9C0006" }, fill: { foreground: "FFC7CE" } } }] },
      { type: "setDataValidation", sheet: "Sheet1", range: "C2:C3", validationType: "whole", operator: "between", formula1: "1", formula2: "100", allowBlank: true, showErrorMessage: true, errorTitle: "Invalid", error: "Use 1-100" },
      { type: "setAutoFilter", sheet: "Sheet1", range: "A1:C3" },
      { type: "setSort", sheet: "Sheet1", range: "A1:C3", key: "B2:B3", descending: true },
      { type: "setDefinedName", name: "Rate", formula: "Sheet1!$B$1", comment: "Fixture rate" },
      { type: "setHyperlink", sheet: "Sheet1", range: "A3", target: "#Sheet1!A1", display: "Top" },
      { type: "setPrintSettings", sheet: "Sheet1", printArea: "A1:C3", printTitlesRows: "$1:$1", orientation: "landscape", fitToWidth: 1, fitToHeight: 1, marginLeft: 0.4, marginRight: 0.4, header: "&CAdvanced", footer: "&P / &N", horizontalCentered: true, rowBreaks: [3] },
      { type: "setThemeColor", slot: "accent1", color: "005A9C" },
      { type: "setSheetProtection", sheet: "Sheet1", enabled: true, password: "sheet-secret", selectLockedCells: true, autoFilter: true },
      { type: "setWorkbookProtection", enabled: true, password: "book-secret", lockStructure: true },
      { type: "setCalculationSettings", mode: "manual", iterate: true, iterateCount: 12, iterateDelta: 0.001, fullCalcOnLoad: false, forceFullCalc: false },
      { type: "setSheetProperties", sheet: "Sheet1", name: "Data", tabColor: "00AA55", showGridLines: false, zoomScale: 125 },
    ];
    const result = await commit(engine, source, output, operations);
    assert.equal(result.validation.ok, true);
    assert.ok(result.warnings.every((warning) => !warning.includes("sheet-secret") && !warning.includes("book-secret")));
    const read = await engine.read({ path: output, sheet: "Data", range: "A1:C3" });
    assert.equal(read.cells.find((cell) => cell.reference === "A1").value, "Rich Text");
    assert.equal(read.cells.find((cell) => cell.reference === "A1").richTextRuns.length, 2);
    assert.equal(read.cells.find((cell) => cell.reference === "A2").styleId, read.cells.find((cell) => cell.reference === "B2").styleId);
    assert.ok(read.conditionalFormats.some((item) => item.ranges.includes("C2:C3")));
    assert.ok(read.dataValidations.some((item) => item.ranges.includes("C2:C3")));
    assert.ok(read.hyperlinks.some((item) => item.range === "A3" && item.location === "Sheet1!A1"));
    const inspection = await engine.inspect({ path: output });
    assert.equal(inspection.workbookProtection.enabled, true);
    assert.equal(inspection.sheets[0].sheetProtection.enabled, true);
    assert.equal(inspection.calculation.settings.calcMode, "manual");
    assert.equal(JSON.stringify(inspection).includes("sheet-secret"), false);
    assert.equal(JSON.stringify(inspection).includes("book-secret"), false);
    if (format === "xlsm") {
      const after = OoxmlPackage.fromBytes(await fs.readFile(output));
      assert.equal(before.compareIntegrity(after, new Set(result.changedParts)).errors.some((error) => /Protected/.test(error)), false);
    }
  });
}

test("structural and sheet operations update bounded references transactionally", async (t) => {
  const cwd = await workspace(t);
  const source = await writeWorkbookFixture(path.join(cwd, "source.xlsx"));
  const output = path.join(cwd, "structure.xlsx");
  const engine = new OoxmlSafeEngine(cwd);
  const operations = [
    { type: "insertRows", sheet: "Sheet1", startRow: 2, count: 1 },
    { type: "insertColumns", sheet: "Sheet1", startColumn: "B", count: 1 },
    { type: "deleteRows", sheet: "Sheet1", startRow: 20, count: 1 },
    { type: "deleteColumns", sheet: "Sheet1", startColumn: "Z", count: 1 },
    { type: "createSheet", name: "Summary", position: 0, tabColor: "4472C4" },
    { type: "setValue", sheet: "Summary", range: "A1", value: "Created" },
    { type: "copyRange", sourceSheet: "Sheet1", sourceRange: "A1:D3", sheet: "Summary", targetRange: "A2:D4", include: "all" },
    { type: "createSheet", name: "Temporary" },
    { type: "deleteSheet", sheet: "Temporary" },
    { type: "setSheetProperties", sheet: "Summary", state: "visible", showGridLines: false },
  ];
  const result = await commit(engine, source, output, operations);
  assert.equal(result.validation.ok, true);
  const inspect = await engine.inspect({ path: output });
  assert.deepEqual(inspect.sheets.map((sheet) => sheet.name), ["Summary", "Sheet1"]);
  const summary = await engine.read({ path: output, sheet: "Summary", range: "A1:D4" });
  assert.equal(summary.cells.find((cell) => cell.reference === "A1").value, "Created");
  assert.equal(summary.cells.find((cell) => cell.reference === "A2").value, "Hello");
  assert.equal(summary.cells.find((cell) => cell.reference === "D2").formula, "SUM(C2,8)");
  const shifted = await engine.read({ path: output, sheet: "Sheet1", range: "A1:D4" });
  assert.equal(shifted.cells.find((cell) => cell.reference === "D1").formula, "SUM(C1,8)");
});

test("tables, comments, images, and charts are added and updated in xlsx", async (t) => {
  const cwd = await workspace(t);
  const source = await writeWorkbookFixture(path.join(cwd, "source.xlsx"));
  const output = path.join(cwd, "objects.xlsx");
  const engine = new OoxmlSafeEngine(cwd);
  const operations = [
    { type: "setValue", sheet: "Sheet1", range: "A3", value: "Item" },
    { type: "setValue", sheet: "Sheet1", range: "B3", value: 7 },
    { type: "addTable", sheet: "Sheet1", range: "A1:C3", name: "DataTable", styleName: "TableStyleMedium4" },
    { type: "setComment", sheet: "Sheet1", cell: "B1", author: "Pi", text: "Reviewed" },
    { type: "addImage", sheet: "Sheet1", range: "E1:F4", name: "Logo", pngBase64: PNG_1X1, altText: "Fixture logo" },
    { type: "addImage", sheet: "Sheet1", range: "E2:G5", name: "Logo", pngBase64: PNG_1X1, altText: "Updated logo" },
    { type: "addChart", sheet: "Sheet1", range: "H1:N12", name: "SalesChart", chartType: "column", categoryRange: "A2:A3", valueRange: "B2:B3", title: "Sales", style: 10 },
    { type: "updateChart", sheet: "Sheet1", name: "SalesChart", categoryRange: "A1:A3", valueRange: "B1:B3", title: "Updated Sales", style: 12 },
  ];
  const result = await commit(engine, source, output, operations);
  assert.equal(result.validation.ok, true);
  const inspect = await engine.inspect({ path: output });
  assert.equal(inspect.sheets[0].tables, 1);
  assert.equal(inspect.sheets[0].comments, 1);
  assert.equal(inspect.sheets[0].images, 1);
  assert.equal(inspect.sheets[0].charts, 1);
  const pkg = OoxmlPackage.fromBytes(await fs.readFile(output));
  const chartPart = [...pkg.archive.entries.keys()].find((part) => /^xl\/charts\/chart\d+\.xml$/.test(part));
  const commentPart = [...pkg.archive.entries.keys()].find((part) => /^xl\/comments\d+\.xml$/.test(part));
  assert.ok(chartPart);
  assert.ok(commentPart);
  const chart = parseXml(pkg.archive.require(chartPart), chartPart, pkg.archive.limits.maxXmlBytes);
  assert.ok(elements(chart, "http://schemas.openxmlformats.org/drawingml/2006/main", "t").some((element) => textContent(element) === "Updated Sales"));
  const comments = parseXml(pkg.archive.require(commentPart), commentPart, pkg.archive.limits.maxXmlBytes);
  assert.ok(elements(comments, NS.spreadsheet, "t").some((element) => textContent(element) === "Reviewed"));
});

test("part-adding operations fail closed for xlsm when content types are protected", async (t) => {
  const cwd = await workspace(t);
  const source = await writeWorkbookFixture(path.join(cwd, "source.xlsm"), { macro: true });
  const engine = new OoxmlSafeEngine(cwd);
  await assert.rejects(engine.edit({ path: source, schemaVersion: "1.0", operations: [{ type: "addTable", sheet: "Sheet1", range: "A1:C3", name: "BlockedTable" }], dryRun: true }), (error) => error?.code === "UNSUPPORTED_FEATURE" && /protected OOXML part/.test(error.message));
  await assert.rejects(engine.edit({ path: source, schemaVersion: "1.0", operations: [{ type: "addImage", sheet: "Sheet1", range: "E1:F2", name: "BlockedImage", pngBase64: PNG_1X1 }], dryRun: true }), (error) => error?.code === "UNSUPPORTED_FEATURE" && /protected OOXML part/.test(error.message));
});

test("formatting renders match the reviewed deterministic golden on xlsx and xlsm", async (t) => {
  const cwd = await workspace(t);
  const engine = new OoxmlSafeEngine(cwd);
  const hashes = [];
  for (const format of ["xlsx", "xlsm"]) {
    const source = await writeWorkbookFixture(path.join(cwd, `golden-source.${format}`), { macro: format === "xlsm" });
    const output = path.join(cwd, `golden-output.${format}`);
    await commit(engine, source, output, [
      { type: "setValue", sheet: "Sheet1", range: "A3", value: "Golden" },
      { type: "setStyle", sheet: "Sheet1", range: "A1", style: { fill: { foreground: "1F4E78" }, font: { bold: true, color: "FFFFFF" } } },
      { type: "setStyle", sheet: "Sheet1", range: "A2:C2", style: { fill: { pattern: "solid", foreground: "FFF2CC" }, border: { bottom: { style: "double", color: "7F6000" } }, alignment: { horizontal: "center", textRotation: 30 } } },
    ]);
    const semantic = await engine.read({ path: output, sheet: "Sheet1", range: "A1:C3" });
    assert.equal(semantic.cells.find((cell) => cell.reference === "A3").value, "Golden");
    const rendered = await engine.render({ path: output, sheet: "Sheet1", range: "A1:C3", scale: 1 });
    hashes.push(sha256Bytes(rendered.png));
  }
  assert.deepEqual(hashes, [
    "f4de4e1d5ce278da9a0ca86ab9bd493ef246accfbdbe9b0eaa388c4f0e2c742d",
    "f4de4e1d5ce278da9a0ca86ab9bd493ef246accfbdbe9b0eaa388c4f0e2c742d",
  ]);
});

test("deterministic preview cache is reused by workbook hash and render options", async (t) => {
  const cwd = await workspace(t);
  const source = await writeWorkbookFixture(path.join(cwd, "source.xlsx"));
  const engine = new OoxmlSafeEngine(cwd);
  const first = await engine.render({ path: source, sheet: "Sheet1", range: "A1:C3", scale: 1.25 });
  const second = await engine.render({ path: source, sheet: "Sheet1", range: "A1:C3", scale: 1.25 });
  assert.equal(second.cacheHit, true);
  assert.equal(first.cacheKey, second.cacheKey);
  assert.equal(first.outputPath, second.outputPath);
});
