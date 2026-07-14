import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { boundedJsonResult, renderImageResult } from "../src/output.ts";

test("large results are bounded and saved to a complete private artifact", async (t) => { const result = await boundedJsonResult({ sourcePath: "fixture.docx", blocks: Array.from({ length: 2000 }, (_, index) => ({ index, text: "x".repeat(80) })) }, "bounded", 1000); assert.equal(result.details.truncated, true); const full = JSON.parse(await fs.readFile(result.details.artifactPath, "utf8")); assert.equal(full.blocks.length, 2000); t.after(() => fs.rm(path.dirname(result.details.artifactPath), { recursive: true, force: true })); });

test("line-heavy results are truncated at Pi's 2000-line limit", async (t) => { const result = await boundedJsonResult({ lines: Array.from({ length: 2100 }, () => "x") }, "line-bounded", 100_000); assert.equal(result.details.truncated, true); assert.ok(result.details.fullOutputLines > 2000); t.after(() => fs.rm(path.dirname(result.details.artifactPath), { recursive: true, force: true })); });

test("render results expose PNG blocks without leaking private render paths", () => { const result = renderImageResult({ sourcePath: "fixture.docx", pdfPath: "/private/fixture.pdf", workspace: "/private/workspace", pageCount: 3, artifact: { schema: "pi.artifact/v1", kind: "document", id: "artifact-id", title: "fixture.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pageCount: 3, expiresAt: "2099-01-01T00:00:00.000Z" }, pages: [{ pageNum: 1, width: 10, height: 20, outputPath: "/private/page.png", bytes: 3, png: Buffer.from([1, 2, 3]) }] }); assert.equal(result.content[1].type, "image"); assert.equal(result.content[1].mimeType, "image/png"); assert.equal(result.details.pages[0].outputPath, undefined); assert.equal(result.details.pdfPath, undefined); assert.equal(result.details.workspace, undefined); assert.equal(JSON.stringify(result).includes("/private/"), false); });
