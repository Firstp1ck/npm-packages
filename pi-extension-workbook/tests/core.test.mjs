import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OoxmlSafeEngine } from "../src/backends/ooxml-safe.ts";
import { OoxmlPackage } from "../src/ooxml/package.ts";
import { sha256Bytes } from "../src/core/hash.ts";
import { writeWorkbookFixture } from "./fixture-builder.mjs";

async function workspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "pi-workbook-test-"));
}

test("inspect, read, render, edit, validate, and diff an xlsx transaction", async (t) => {
  const cwd = await workspace();
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const source = await writeWorkbookFixture(path.join(cwd, "source.xlsx"));
  const output = path.join(cwd, "edited.xlsx");
  const engine = new OoxmlSafeEngine(cwd);

  const inspection = await engine.inspect({ path: source });
  assert.equal(inspection.validation.ok, true);
  assert.equal(inspection.sheets[0].name, "Sheet1");
  assert.match(inspection.sourceSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(inspection.calculation.functions, [{ name: "SUM", count: 1, future: false }]);
  assert.equal(inspection.calculation.cachedFormulaResultCount, 1);
  assert.deepEqual(inspection.calculation.unsupportedFunctionNames, ["SUM"]);

  const read = await engine.read({ path: source, sheet: "Sheet1", range: "A1:C2" });
  assert.equal(read.cells.find((cell) => cell.reference === "A1").value, "Hello");
  assert.equal(read.cells.find((cell) => cell.reference === "B1").value, 42);
  assert.equal(read.cells.find((cell) => cell.reference === "C1").formula, "SUM(B1,8)");
  assert.deepEqual(read.merges, [{ range: "B2:C2", owner: "B2" }]);
  assert.equal(read.rowDimensions.find((row) => row.row === 2).hidden, true);
  assert.equal(read.columnDimensions.find((column) => column.startColumn === 1).hidden, true);
  assert.equal(read.styles.length, 2);

  const rendered = await engine.render({ path: source, sheet: "Sheet1", range: "A1:C2" });
  assert.deepEqual([...rendered.png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal((await fs.stat(rendered.outputPath)).isFile(), true);

  const operations = [
    { type: "setValue", sheet: "Sheet1", range: "A1", value: "=literal-not-formula" },
    { type: "setFormula", sheet: "Sheet1", range: "C3", formula: "B1*2" },
    { type: "setStyle", sheet: "Sheet1", range: "A1:C1", style: { font: { bold: true, color: "FFFFFF" }, fill: { foreground: "1F4E78" }, alignment: { horizontal: "center", wrapText: true }, numberFormat: "0.00" } },
    { type: "setRowHeight", sheet: "Sheet1", startRow: 1, height: 24 },
    { type: "setColumnWidth", sheet: "Sheet1", startColumn: "A", endColumn: "C", width: 18 },
    { type: "unmerge", sheet: "Sheet1", range: "B2:C2" },
    { type: "merge", sheet: "Sheet1", range: "A3:B3" },
  ];
  const dryRun = await engine.edit({ path: source, schemaVersion: "1.0", operations, outputPath: output, dryRun: true });
  assert.equal(dryRun.dryRun, true);
  assert.equal(await fs.stat(output).then(() => true, () => false), false);
  assert.equal(dryRun.validation.ok, true);

  const committed = await engine.edit({ path: source, schemaVersion: "1.0", operations, outputPath: output, dryRun: false, expectedSha256: dryRun.sourceSha256 });
  assert.equal(committed.dryRun, false);
  assert.equal(committed.validation.ok, true);
  assert.equal(committed.recoveryPath, undefined);
  assert.equal((await fs.stat(output)).isFile(), true);

  const edited = await engine.read({ path: output, sheet: "Sheet1", range: "A1:C3" });
  const a1 = edited.cells.find((cell) => cell.reference === "A1");
  assert.equal(a1.value, "=literal-not-formula");
  assert.equal(a1.formula, undefined);
  assert.equal(edited.cells.find((cell) => cell.reference === "C3").formula, "B1*2");

  const validation = await engine.validate({ path: output, baselinePath: source });
  assert.equal(validation.ok, true);
  const difference = await engine.diff({ beforePath: source, afterPath: output, sheet: "Sheet1", range: "A1:C3" });
  assert.equal(difference.equal, false);
  assert.equal(difference.protectedPartChanges.length, 0);
  assert.ok(difference.changedCells.some((cell) => cell.reference === "A1"));
});

test("commits require current expectedSha256 and reject external-data formulas", async (t) => {
  const cwd = await workspace();
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const source = await writeWorkbookFixture(path.join(cwd, "source.xlsx"));
  const engine = new OoxmlSafeEngine(cwd);
  const operations = [{ type: "setValue", sheet: "Sheet1", range: "A1", value: "safe" }];

  await assert.rejects(
    engine.edit({ path: source, schemaVersion: "1.0", operations, outputPath: path.join(cwd, "missing-hash.xlsx"), dryRun: false }),
    (error) => error?.code === "CONFLICT" && /mandatory/.test(error.message),
  );
  await assert.rejects(
    engine.edit({ path: source, schemaVersion: "1.0", operations, outputPath: path.join(cwd, "stale.xlsx"), dryRun: false, expectedSha256: "0".repeat(64) }),
    (error) => error?.code === "CONFLICT" && /changed since/.test(error.message),
  );
  await assert.rejects(
    engine.edit({ path: source, schemaVersion: "1.0", operations: [{ type: "setFormula", sheet: "Sheet1", range: "A1", formula: "WEBSERVICE(\"https://example.invalid\")" }], dryRun: true }),
    (error) => error?.code === "UNSUPPORTED_FEATURE" && /external-data/.test(error.message),
  );
});

test("complex array/shared formula regions fail closed for value edits", async (t) => {
  const cwd = await workspace();
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const source = await writeWorkbookFixture(path.join(cwd, "array.xlsx"), { complexFormula: true });
  const engine = new OoxmlSafeEngine(cwd);
  const inspection = await engine.inspect({ path: source });
  assert.equal(inspection.calculation.arrayFormulaCount, 1);
  await assert.rejects(
    engine.edit({ path: source, schemaVersion: "1.0", operations: [{ type: "setValue", sheet: "Sheet1", range: "C2", value: 7 }], dryRun: true }),
    (error) => error?.code === "UNSUPPORTED_FEATURE" && /array formula region C1:C2/.test(error.message),
  );
  await assert.rejects(
    engine.edit({ path: source, schemaVersion: "1.0", operations: [{ type: "copyRange", sheet: "Sheet1", sourceRange: "C1:C2", targetRange: "D1:D2" }], dryRun: true }),
    (error) => error?.code === "UNSUPPORTED_FEATURE" && /copyRange source/.test(error.message),
  );
  const styleOnly = await engine.edit({ path: source, schemaVersion: "1.0", operations: [{ type: "setStyle", sheet: "Sheet1", range: "C2", style: { font: { bold: true } } }], dryRun: true });
  assert.equal(styleOnly.validation.ok, true);
});

test("non-canonical VBA relationship target remains byte-identical through xlsm edit", async (t) => {
  const cwd = await workspace();
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const vbaPart = "xl/macroStore/project.dat";
  const source = await writeWorkbookFixture(path.join(cwd, "source.xlsm"), { macro: true, vbaPart });
  const output = path.join(cwd, "edited.xlsm");
  const baselineBytes = await fs.readFile(source);
  const baselinePackage = OoxmlPackage.fromBytes(baselineBytes);
  assert.ok(baselinePackage.protectedParts.has(vbaPart));
  assert.ok(baselinePackage.protectedParts.has("xl/_rels/workbook.xml.rels"));
  const beforeVbaHash = sha256Bytes(baselinePackage.archive.require(vbaPart));

  const engine = new OoxmlSafeEngine(cwd);
  const inspect = await engine.inspect({ path: source });
  assert.equal(inspect.validation.ok, true);
  assert.equal(inspect.validation.hasVbaProject, true);
  const result = await engine.edit({
    path: source,
    schemaVersion: "1.0",
    operations: [{ type: "setValue", sheet: "Sheet1", range: "B1", value: 99 }],
    outputPath: output,
    dryRun: false,
    expectedSha256: inspect.sourceSha256,
  });
  assert.equal(result.validation.ok, true);
  const afterPackage = OoxmlPackage.fromBytes(await fs.readFile(output));
  assert.equal(sha256Bytes(afterPackage.archive.require(vbaPart)), beforeVbaHash);
  assert.equal(baselinePackage.compareIntegrity(afterPackage, new Set(["xl/worksheets/sheet1.xml"])).ok, true);
});

test("honors cancellation before inspection and inside the mutation queue", async (t) => {
  const cwd = await workspace();
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const source = await writeWorkbookFixture(path.join(cwd, "source.xlsx"));
  const output = path.join(cwd, "cancelled.xlsx");
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(new OoxmlSafeEngine(cwd).inspect({ path: source }, alreadyAborted.signal), (error) => error?.code === "ABORTED");

  const controller = new AbortController();
  const inspected = await new OoxmlSafeEngine(cwd).inspect({ path: source });
  const queued = new OoxmlSafeEngine(cwd, async (_key, work) => {
    controller.abort();
    return work();
  });
  await assert.rejects(queued.edit({
    path: source,
    schemaVersion: "1.0",
    operations: [{ type: "setValue", sheet: "Sheet1", range: "A1", value: "must-not-commit" }],
    outputPath: output,
    dryRun: false,
    expectedSha256: inspected.sourceSha256,
  }, controller.signal), (error) => error?.code === "ABORTED");
  assert.equal(await fs.stat(output).then(() => true, () => false), false);
});

test("holds the canonical destination mutation queue through commit", async (t) => {
  const cwd = await workspace();
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const source = await writeWorkbookFixture(path.join(cwd, "source.xlsx"));
  const output = path.join(cwd, "queued.xlsx");
  const events = [];
  let queueKey;
  const engine = new OoxmlSafeEngine(cwd, async (key, work) => {
    queueKey = key;
    events.push("entered");
    const result = await work();
    assert.equal((await fs.stat(output)).isFile(), true);
    events.push("committed");
    return result;
  });
  const inspected = await engine.inspect({ path: source });
  await engine.edit({
    path: source,
    schemaVersion: "1.0",
    operations: [{ type: "setValue", sheet: "Sheet1", range: "A1", value: "queued" }],
    outputPath: output,
    dryRun: false,
    expectedSha256: inspected.sourceSha256,
  });
  assert.deepEqual(events, ["entered", "committed"]);
  assert.equal(queueKey, path.resolve(output));
});

test("in-place overwrite creates a recovery copy", async (t) => {
  const cwd = await workspace();
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const source = await writeWorkbookFixture(path.join(cwd, "source.xlsx"));
  const engine = new OoxmlSafeEngine(cwd);
  const inspect = await engine.inspect({ path: source });
  const result = await engine.edit({
    path: source,
    schemaVersion: "1.0",
    operations: [{ type: "setValue", sheet: "Sheet1", range: "A1", value: "changed" }],
    outputPath: source,
    dryRun: false,
    overwrite: true,
    expectedSha256: inspect.sourceSha256,
  });
  assert.ok(result.recoveryPath);
  assert.equal((await fs.stat(result.recoveryPath)).isFile(), true);
  const recovery = await engine.read({ path: result.recoveryPath, sheet: "Sheet1", range: "A1" });
  assert.equal(recovery.cells[0].value, "Hello");
});
