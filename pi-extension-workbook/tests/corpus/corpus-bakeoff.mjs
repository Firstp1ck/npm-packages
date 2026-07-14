import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OoxmlSafeEngine } from "../../src/backends/ooxml-safe.ts";
import { sha256Bytes, sha256File } from "../../src/core/hash.ts";
import { OoxmlPackage } from "../../src/ooxml/package.ts";
import { validateWithExcelUi } from "./excel-ui-monitor.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const reportPath = path.join(here, "LAST-CORPUS-BAKEOFF.json");
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAE/wJ/lvRZ6QAAAABJRU5ErkJggg==", "base64");

function run(command, args, timeoutMs = 180_000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => {
      spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      finish({ ok: false, code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ ok: false, code: null, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => finish({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim(), timedOut: false }));
  });
}

function parsePayload(result) {
  for (const line of result.stdout.split(/\r?\n/).reverse()) {
    try { return JSON.parse(line.replace(/^\uFEFF/, "")); } catch { /* continue */ }
  }
  return undefined;
}

async function runPowerShell(script, args, timeoutMs) {
  const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args], timeoutMs);
  return { ...result, payload: parsePayload(result) };
}

function relevantParts(inspection) {
  const patterns = {
    styles: /^xl\/styles\.xml$/i,
    themes: /^xl\/theme\//i,
    charts: /^xl\/charts\//i,
    tables: /^xl\/tables\//i,
    pivots: /^xl\/(?:pivotTables|pivotCache)\//i,
    images: /^xl\/media\//i,
    externalLinks: /^xl\/externalLinks\//i,
    connections: /^xl\/connections\.xml$/i,
    vba: /vbaProject/i,
    signedVba: /vbaProjectSignature/i,
    activeX: /^xl\/activeX\//i,
    formControls: /^xl\/(?:ctrlProps|drawings\/vmlDrawing)/i,
    embeddings: /^xl\/embeddings\//i,
    customRibbon: /^customUI\//i,
  };
  return Object.fromEntries(Object.entries(patterns).map(([name, pattern]) => [name, inspection.manifest.parts.filter((part) => pattern.test(part.path)).map((part) => part.path)]));
}

async function noOpRoundTrip(sourcePath, outputPath) {
  const bytes = await fs.readFile(sourcePath);
  const before = OoxmlPackage.fromBytes(bytes);
  const started = performance.now();
  await fs.writeFile(outputPath, before.archive.toBytes());
  const elapsedMs = performance.now() - started;
  const after = OoxmlPackage.fromBytes(await fs.readFile(outputPath));
  const integrity = before.compareIntegrity(after, new Set());
  assert.equal(integrity.ok, true, integrity.errors.join("; "));
  return { elapsedMs, sourceSha256: sha256Bytes(bytes), outputSha256: await sha256File(outputPath), integrity };
}

async function editCorpus(engine, sourcePath, outputPath) {
  const inspect = await engine.inspect({ path: sourcePath });
  const operations = [
    { type: "setValue", sheet: "Data", range: "B2", value: 999 },
    { type: "setStyle", sheet: "Data", range: "B2", style: { font: { bold: true, color: "FFFFFF" }, fill: { foreground: "C00000" }, border: { diagonal: { style: "thin", color: "FFFFFF" }, diagonalUp: true }, alignment: { horizontal: "center", textRotation: 15 }, numberFormat: "#,##0.00" } },
    { type: "setComment", sheet: "Data", cell: "A3", author: "Pi", text: "Corpus edited note" },
    { type: "setPrintSettings", sheet: "Data", printArea: "A1:H20", orientation: "landscape", fitToWidth: 1, fitToHeight: 1 },
  ];
  const dryStart = performance.now();
  const dry = await engine.edit({ path: sourcePath, schemaVersion: "1.0", operations, outputPath, dryRun: true });
  const dryRunMs = performance.now() - dryStart;
  const commitStart = performance.now();
  const committed = await engine.edit({ path: sourcePath, schemaVersion: "1.0", operations, outputPath, dryRun: false, expectedSha256: inspect.sourceSha256 });
  const commitMs = performance.now() - commitStart;
  assert.equal(committed.validation.ok, true);
  assert.equal(committed.protectedParts.every((part) => !committed.changedParts.includes(part)), true);
  const validation = await engine.validate({ path: outputPath, baselinePath: sourcePath });
  assert.equal(validation.ok, true, validation.errors?.join("; "));
  const diff = await engine.diff({ beforePath: sourcePath, afterPath: outputPath, sheet: "Data", range: "A1:H20", maxChanges: 1000 });
  assert.equal(diff.protectedPartChanges.length, 0);
  assert.ok(diff.changedCells.some((cell) => cell.reference === "B2"));
  return { dryRunMs, commitMs, dry, committed, validation, diff: { equal: diff.equal, changedCells: diff.changedCells.length, changedParts: diff.changedParts, protectedPartChanges: diff.protectedPartChanges } };
}

async function startSentinelServer() {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, at: new Date().toISOString() });
    response.writeHead(204);
    response.end();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  return { server, requests, url: `http://127.0.0.1:${address.port}/pi-no-refresh` };
}

if (process.platform !== "win32") {
  console.log(JSON.stringify({ status: "SKIP", reason: "Legal rich-corpus generation and UI-aware Excel validation require controlled interactive Windows with desktop Excel." }, null, 2));
  process.exit(0);
}

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pi-workbook-corpus-"));
const sentinel = await startSentinelServer();
try {
  const assets = path.join(temporary, "assets");
  const renders = path.join(temporary, "renders");
  await fs.mkdir(assets, { recursive: true });
  await fs.writeFile(path.join(assets, "logo.png"), PNG_1X1);
  await fs.writeFile(path.join(assets, "embedded.txt"), "Pi workbook legally generated embedded-object fixture.\n", "utf8");
  const sourceXlsx = path.join(temporary, "rich-source.xlsx");
  const sourceXlsm = path.join(temporary, "rich-source.xlsm");

  const macro = await runPowerShell(path.join(here, "create-excel-macro-fixture.ps1"), ["-OutputPath", sourceXlsm], 90_000);
  assert.equal(macro.ok && macro.payload?.ok, true, JSON.stringify(macro));
  const creation = await runPowerShell(path.join(here, "create-rich-excel-corpus.ps1"), ["-XlsxPath", sourceXlsx, "-XlsmPath", sourceXlsm, "-PngPath", path.join(assets, "logo.png"), "-EmbeddedPath", path.join(assets, "embedded.txt"), "-ConnectionUrl", sentinel.url], 180_000);
  assert.equal(creation.ok && creation.payload?.ok, true, JSON.stringify(creation));
  assert.equal(creation.payload.certificateStoreModified, false);
  assert.equal(creation.payload.trustCenterModified, false);
  sentinel.requests.length = 0;

  for (const workbookPath of [sourceXlsx, sourceXlsm]) {
    const injection = await run(process.execPath, [path.join(here, "inject-custom-ui.mjs"), workbookPath, "--connection-url", sentinel.url], 30_000);
    assert.equal(injection.ok, true, injection.stderr || injection.stdout);
  }

  const engine = new OoxmlSafeEngine(temporary);
  const sourceInspections = {};
  const featureInventory = {};
  for (const [format, workbookPath] of [["xlsx", sourceXlsx], ["xlsm", sourceXlsm]]) {
    const inspection = await engine.inspect({ path: workbookPath });
    assert.equal(inspection.validation.ok, true, inspection.validation.errors?.join("; "));
    sourceInspections[format] = inspection;
    const parts = relevantParts(inspection);
    featureInventory[format] = parts;
    for (const required of ["styles", "themes", "charts", "tables", "pivots", "images", "externalLinks", "connections", "activeX", "formControls", "embeddings", "customRibbon"]) assert.ok(parts[required].length > 0, `${format} missing ${required}`);
    const data = inspection.sheets.find((sheet) => sheet.name === "Data");
    assert.ok(data && data.tables > 0 && data.charts > 0 && data.images > 0 && data.comments > 0 && data.embeddedObjects > 0 && data.formControls > 0);
    assert.ok(inspection.sheets.some((sheet) => sheet.state === "hidden"));
    assert.ok(inspection.sheets.some((sheet) => sheet.state === "veryHidden"));
    assert.equal(inspection.workbookProtection.enabled, true);
    if (format === "xlsm") assert.ok(parts.vba.length > 0 && inspection.vba.present);
  }

  const noOpXlsx = path.join(temporary, "rich-noop.xlsx");
  const noOpXlsm = path.join(temporary, "rich-noop.xlsm");
  const editedXlsx = path.join(temporary, "rich-edited.xlsx");
  const editedXlsm = path.join(temporary, "rich-edited.xlsm");
  const noOp = {
    xlsx: await noOpRoundTrip(sourceXlsx, noOpXlsx),
    xlsm: await noOpRoundTrip(sourceXlsm, noOpXlsm),
  };
  const edits = {
    xlsx: await editCorpus(engine, sourceXlsx, editedXlsx),
    xlsm: await editCorpus(engine, sourceXlsm, editedXlsm),
  };

  const internalRenders = {};
  for (const [name, workbookPath] of Object.entries({ sourceXlsx, noOpXlsx, editedXlsx, sourceXlsm, noOpXlsm, editedXlsm })) {
    const rendered = await engine.render({ path: workbookPath, sheet: "Data", range: "A1:H20", scale: 1 });
    internalRenders[name] = { sha256: sha256Bytes(rendered.png), width: rendered.width, height: rendered.height, cacheHit: rendered.cacheHit };
  }
  assert.equal(internalRenders.sourceXlsx.sha256, internalRenders.noOpXlsx.sha256);
  assert.equal(internalRenders.sourceXlsm.sha256, internalRenders.noOpXlsm.sha256);
  assert.notEqual(internalRenders.sourceXlsx.sha256, internalRenders.editedXlsx.sha256);
  assert.notEqual(internalRenders.sourceXlsm.sha256, internalRenders.editedXlsm.sha256);

  const uiValidation = await validateWithExcelUi([sourceXlsx, noOpXlsx, editedXlsx, sourceXlsm, noOpXlsm, editedXlsm], renders, 180_000);
  assert.equal(uiValidation.status, "PASS");
  assert.equal(uiValidation.modalWindowsDetected, 0);
  assert.equal(uiValidation.processStillRunning, false);
  assert.equal(uiValidation.payload.results.every((result) => result.opened && result.readOnly && result.hashUnchanged && !result.sentinelExecuted), true);
  const chartRenders = {};
  for (const result of uiValidation.payload.results) {
    assert.ok(result.chartPath, `Excel chart render missing for ${result.path}`);
    const bytes = await fs.readFile(result.chartPath);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    chartRenders[path.basename(result.path)] = { path: result.chartPath, sha256: sha256Bytes(bytes), bytes: bytes.byteLength };
  }
  assert.equal(sentinel.requests.length, 0, `External connection sentinel was contacted: ${JSON.stringify(sentinel.requests)}`);

  const signedVbaPresent = featureInventory.xlsm.signedVba.length > 0;
  const report = {
    status: signedVbaPresent ? "PASS" : "PASS_WITH_SIGNED_VBA_BLOCKER",
    generatedAt: new Date().toISOString(),
    temporary,
    policy: {
      legallyGeneratedLocally: true,
      certificateStoreModified: false,
      trustCenterModified: false,
      macrosExecuted: false,
      externalConnectionsRefreshed: false,
      publicNativeMutationEnabled: false,
      aspose: "deferred",
    },
    creation: creation.payload,
    featureInventory,
    signedVba: signedVbaPresent ? { present: true, parts: featureInventory.xlsm.signedVba } : { present: false, blocker: "Creating and signing a test VBA project requires explicit approval for certificate-store and Office signing interaction. No store or Trust Center setting was changed." },
    noOp,
    edits: Object.fromEntries(Object.entries(edits).map(([format, result]) => [format, { dryRunMs: result.dryRunMs, commitMs: result.commitMs, changedParts: result.committed.changedParts, protectedParts: result.committed.protectedParts, protectedPartChanges: result.diff.protectedPartChanges, changedCells: result.diff.changedCells, validationOk: result.validation.ok }])),
    internalRenders,
    excelChartRenders: chartRenders,
    uiValidation,
    externalConnectionSentinel: { url: sentinel.url, requestsAfterGeneration: sentinel.requests, contactedDuringBakeoff: false },
    runtime: { node: process.versions.node, platform: process.platform, architecture: process.arch, backend: "ooxml-safe", licensing: "MIT package; no commercial workbook engine", nativeExcel: "validation-only controlled interactive host", aspose: "deferred" },
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: report.status, features: Object.fromEntries(Object.entries(featureInventory.xlsm).map(([name, parts]) => [name, parts.length])), uiValidation: uiValidation.status, externalRequests: sentinel.requests.length, reportPath }, null, 2));
} finally {
  await new Promise((resolve) => sentinel.server.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
}
