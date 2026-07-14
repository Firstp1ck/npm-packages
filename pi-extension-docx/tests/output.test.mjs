import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { boundedJsonResult, renderImageResult } from "../src/output.ts";

test("large results are bounded and saved to a complete private artifact", async (t) => { const result = await boundedJsonResult({ sourcePath: "fixture.docx", blocks: Array.from({ length: 2000 }, (_, index) => ({ index, text: "x".repeat(80) })) }, "bounded", 1000); assert.equal(result.details.truncated, true); const full = JSON.parse(await fs.readFile(result.details.artifactPath, "utf8")); assert.equal(full.blocks.length, 2000); t.after(() => fs.rm(path.dirname(result.details.artifactPath), { recursive: true, force: true })); });

test("render results expose generic PNG image blocks", () => { const result = renderImageResult({ sourcePath: "fixture.docx", pdfPath: "fixture.pdf", pages: [{ pageNum: 1, width: 10, height: 20, outputPath: "page.png", bytes: 3, png: Buffer.from([1, 2, 3]) }] }); assert.equal(result.content[1].type, "image"); assert.equal(result.content[1].mimeType, "image/png"); assert.equal(result.details.pages[0].outputPath, "page.png"); });
