import test from "node:test";
import assert from "node:assert/strict";
import { zipSync } from "fflate";
import { SafeZipArchive } from "../src/ooxml/zip.ts";
import { OoxmlPackage } from "../src/ooxml/package.ts";
import { WorkbookModel } from "../src/ooxml/workbook.ts";
import { workbookFixtureBytes } from "./fixture-builder.mjs";

const enc = new TextEncoder();

function markFirstZipEntryEncrypted(input) {
  const bytes = Buffer.from(input);
  let local = -1;
  let central = -1;
  for (let offset = 0; offset <= bytes.length - 4; offset++) {
    const signature = bytes.readUInt32LE(offset);
    if (signature === 0x04034b50 && local < 0) local = offset;
    if (signature === 0x02014b50 && central < 0) central = offset;
  }
  assert.notEqual(local, -1);
  assert.notEqual(central, -1);
  bytes.writeUInt16LE(bytes.readUInt16LE(local + 6) | 1, local + 6);
  bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | 1, central + 8);
  return bytes;
}

test("rejects ZIP path traversal before extraction", () => {
  const hostile = zipSync({ "../escape.txt": enc.encode("no") });
  assert.throws(() => SafeZipArchive.fromBytes(hostile), (error) => error?.code === "INVALID_PACKAGE" && /traversal/.test(error.message));
});

test("rejects encrypted ZIP entries before extraction", () => {
  const hostile = markFirstZipEntryEncrypted(workbookFixtureBytes());
  assert.throws(() => SafeZipArchive.fromBytes(hostile), (error) => error?.code === "ENCRYPTED_PACKAGE");
});

test("rejects entry-count, archive-size, and XML-size limit violations", () => {
  const fixture = workbookFixtureBytes();
  assert.throws(() => SafeZipArchive.fromBytes(fixture, { maxEntries: 1 }), (error) => error?.code === "LIMIT_EXCEEDED" && /entries/.test(error.message));
  assert.throws(() => SafeZipArchive.fromBytes(fixture, { maxArchiveBytes: 10 }), (error) => error?.code === "LIMIT_EXCEEDED" && /archive limit/.test(error.message));
  assert.throws(() => SafeZipArchive.fromBytes(fixture, { maxXmlBytes: 128 }), (error) => error?.code === "LIMIT_EXCEEDED" && /XML part/.test(error.message));
});

test("rejects excessive compression ratio before inflation", () => {
  const bomb = zipSync({ "xl/large.xml": new Uint8Array(100_000) }, { level: 9 });
  assert.throws(() => SafeZipArchive.fromBytes(bomb, { maxCompressionRatio: 2 }), (error) => error?.code === "LIMIT_EXCEEDED" && /compression-ratio/.test(error.message));
});

test("rejects DTD and entity declarations in worksheet XML", () => {
  const pkg = OoxmlPackage.fromBytes(workbookFixtureBytes({ dtdSheet: true }));
  assert.throws(() => new WorkbookModel(pkg).inspect(), (error) => error?.code === "INVALID_PACKAGE" && /DTD\/entity/.test(error.message));
});

test("rejects relationship targets that escape the package", () => {
  assert.throws(() => OoxmlPackage.fromBytes(workbookFixtureBytes({ relationshipTraversal: true })), (error) => error?.code === "INVALID_PACKAGE" && /Unsafe relationship target/.test(error.message));
});

test("rejects oversized style tables using configured limits", () => {
  const pkg = OoxmlPackage.fromBytes(workbookFixtureBytes(), { maxStyles: 1 });
  assert.throws(() => new WorkbookModel(pkg), (error) => error?.code === "LIMIT_EXCEEDED" && /style limit/.test(error.message));
});

test("bounded read truncates oversized requested ranges", () => {
  const model = new WorkbookModel(OoxmlPackage.fromBytes(workbookFixtureBytes(), { maxCellsPerRead: 10 }));
  const result = model.read("Sheet1", "A1:E10");
  assert.equal(result.truncated, true);
  assert.equal(result.range, "A1:E2");
});
