import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildOnlyOfficeTaskXml, probeOnlyOfficeRenderer } from "../src/backends/onlyoffice-renderer.ts";
import { DocumentService } from "../src/backends/document-service.ts";
import { fixtureBytes } from "./fixture-builder.mjs";

const priorRenderer = process.env.PI_DOCX_RENDERER;
test.after(() => { if (priorRenderer === undefined) delete process.env.PI_DOCX_RENDERER; else process.env.PI_DOCX_RENDERER = priorRenderer; });

test("ONLYOFFICE task XML escapes every path and fixes PDF output format", () => { const xml = buildOnlyOfficeTaskXml("/tmp/in<&\"'.docx", "/tmp/out<&\"'.pdf", "/tmp/fonts<&\"'.js", "/tmp/font<&\"'"); assert.match(xml, /<m_nFormatTo>513<\/m_nFormatTo>/); assert.match(xml, /in&lt;&amp;&quot;&apos;\.docx/); assert.match(xml, /out&lt;&amp;&quot;&apos;\.pdf/); assert.equal(xml.includes("/tmp/in<&\"'.docx"), false); });

test("render preflight blocks macro/active-content packages before backend launch", async () => { const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-docx-render-policy-")), source = path.join(root, "active.docm"); await fs.writeFile(source, fixtureBytes({ macro: true }), { mode: 0o600 }); try { await assert.rejects(() => new DocumentService(root).render({ path: source, pages: "1" }), (error) => error?.code === "ACTIVE_CONTENT_BLOCKED"); } finally { await fs.rm(root, { recursive: true, force: true }); } });

test("ONLYOFFICE renders a bounded synthetic DOCX when the local engine is available", async (t) => { const probe = await probeOnlyOfficeRenderer(); if (probe.available !== true) return t.skip(String(probe.reason ?? "ONLYOFFICE renderer unavailable")); process.env.PI_DOCX_RENDERER = "onlyoffice"; const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-docx-onlyoffice-test-")), source = path.join(root, "input.docx"); await fs.chmod(root, 0o700); await fs.writeFile(source, fixtureBytes(), { mode: 0o600 }); let result; try { result = await new DocumentService(root).render({ path: source, pages: "1", dpi: 72, timeoutMs: 60_000 }); assert.equal(result.renderer.engine, "ONLYOFFICE x2t"); assert.equal(result.pageCount, 1); assert.equal(result.pages.length, 1); assert.equal(result.pages[0].png.subarray(1, 4).toString("ascii"), "PNG"); assert.ok(result.pages[0].bytes > 100); assert.equal(result.artifact.schema, "pi.artifact/v1"); } finally { if (result?.workspace) await fs.rm(result.workspace, { recursive: true, force: true }); if (result?.artifact?.manifestPath) await fs.rm(path.dirname(result.artifact.manifestPath), { recursive: true, force: true }); await fs.rm(root, { recursive: true, force: true }); } });
