import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import type { DocxRenderRequest, Warning } from "../contracts.ts";
import { assertNotAborted, fail } from "../errors.ts";
import { runCommand } from "../pi-utils.ts";
import { runOwnedProcess } from "../core/child-process.ts";
import { parsePageSelection, pdfPageCount, probeLiteParse, screenshotPdf } from "./liteparse-reader.ts";
import { WORKSPACE_ROOT } from "../core/workspace.ts";

const MAX_RENDERED_PAGES = 20;
const MAX_RENDERED_BYTES = 50 * 1024 * 1024;

async function commandCandidate(): Promise<string | undefined> {
  const configured = process.env.LIBREOFFICE_PATH?.trim();
  if (configured) return configured;
  for (const command of process.platform === "win32" ? ["soffice.exe", "soffice", "libreoffice"] : ["soffice", "libreoffice"]) {
    const result = await runCommand(command, ["--version"], { timeoutMs: 5000 });
    if (result.ok) return command;
  }
  const windows = ["C:/Program Files/LibreOffice/program/soffice.exe", "C:/Program Files (x86)/LibreOffice/program/soffice.exe"];
  for (const candidate of windows) if (await fs.stat(candidate).then((stat) => stat.isFile(), () => false)) return candidate;
  return undefined;
}

async function safeProfile(profile: string): Promise<void> {
  await fs.mkdir(path.join(profile, "user"), { recursive: true, mode: 0o700 });
  const xcu = `<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateLinks" oor:op="fuse"><value>0</value></prop></item></oor:items>`;
  await fs.writeFile(path.join(profile, "user", "registrymodifications.xcu"), xcu, { mode: 0o600 });
}

export async function probeRenderer(): Promise<Record<string, unknown>> {
  const command = await commandCandidate(), liteparse = await probeLiteParse();
  if (!command) return { available: false, engine: "libreoffice-renderer", liteparse, reason: "LibreOffice is not installed or configured." };
  const version = await runCommand(command, ["--version"], { timeoutMs: 5000 });
  return { available: version.ok && liteparse.available, engine: "libreoffice-renderer", command, version: version.stdout.trim(), liteparse, constraints: ["Unique private profile", "macro security level 3", "link updates disabled", "PDF export only", `${MAX_RENDERED_PAGES} page result limit`] };
}

export async function renderDocx(sourcePath: string, request: DocxRenderRequest, signal?: AbortSignal): Promise<{ pdfPath: string; pageCount: number; pages: Array<{ pageNum: number; width: number; height: number; outputPath: string; bytes: number; png: Buffer }>; renderer: Record<string, unknown>; warnings: Warning[]; workspace: string }> {
  assertNotAborted(signal);
  const command = await commandCandidate();
  if (!command) fail("DEPENDENCY_MISSING", "LibreOffice is required for page-faithful DOCX rendering. Configure LIBREOFFICE_PATH or install LibreOffice.");
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true, mode: 0o700 });
  const root = await fs.mkdtemp(path.join(WORKSPACE_ROOT, "render-"));
  try {
    const profile = path.join(root, "profile"), inputDir = path.join(root, "input"), outputDir = path.join(root, "output"), tempDir = path.join(root, "tmp");
    await Promise.all([fs.mkdir(inputDir, { mode: 0o700 }), fs.mkdir(outputDir, { mode: 0o700 }), fs.mkdir(tempDir, { mode: 0o700 })]);
    await safeProfile(profile);
    const inputCopy = path.join(inputDir, `${randomUUID()}.docx`);
    await fs.copyFile(sourcePath, inputCopy);
    const profileUri = pathToFileURL(profile).href;
    const args = [`-env:UserInstallation=${profileUri}`, "--headless", "--invisible", "--nologo", "--nodefault", "--norestore", "--nolockcheck", "--nofirststartwizard", "--convert-to", "pdf:writer_pdf_Export", "--outdir", outputDir, inputCopy];
    const result = await runOwnedProcess(command, args, { signal, timeoutMs: request.timeoutMs ?? 120_000, cwd: root, env: { ...process.env, HOME: root, USERPROFILE: root, TMPDIR: tempDir } });
    if (result.code !== 0) fail("RENDER_FAILED", `LibreOffice PDF export failed: ${result.stderr || result.stdout || `exit ${result.code}`}`);
    const pdfPath = path.join(outputDir, path.basename(inputCopy, ".docx") + ".pdf");
    if (!await fs.stat(pdfPath).then((stat) => stat.isFile(), () => false)) fail("RENDER_FAILED", "LibreOffice did not create the expected PDF.");
    const pageCount = await pdfPageCount(pdfPath), selectedPages = parsePageSelection(request.pages ?? "1");
    if (!selectedPages?.length) {
      if (pageCount > MAX_RENDERED_PAGES) fail("LIMIT_EXCEEDED", `Rendering all ${pageCount} pages exceeds the ${MAX_RENDERED_PAGES}-page tool-result limit; select a bounded page range.`);
    } else {
      if (selectedPages.length > MAX_RENDERED_PAGES) fail("LIMIT_EXCEEDED", `Page selection exceeds the ${MAX_RENDERED_PAGES}-page tool-result limit.`);
      if (selectedPages.at(-1)! > pageCount) fail("INVALID_ARGUMENT", `Requested page ${selectedPages.at(-1)} but the rendered document has ${pageCount} pages.`);
    }
    const rendered = await screenshotPdf(pdfPath, selectedPages, request.dpi ?? 150), pages = [];
    let totalBytes = 0;
    for (const page of rendered) {
      totalBytes += page.imageBuffer.length;
      if (totalBytes > MAX_RENDERED_BYTES) fail("LIMIT_EXCEEDED", `Rendered PNG output exceeds ${MAX_RENDERED_BYTES} bytes; reduce pages or DPI.`);
      const outputPath = path.join(outputDir, `page-${page.pageNum}.png`);
      await fs.writeFile(outputPath, page.imageBuffer, { mode: 0o600 });
      pages.push({ pageNum: page.pageNum, width: page.width, height: page.height, outputPath, bytes: page.imageBuffer.length, png: page.imageBuffer });
    }
    assertNotAborted(signal);
    const version = await runCommand(command, ["--version"], { timeoutMs: 5000 });
    const fontProbe = await runCommand("pdffonts", [pdfPath], { timeoutMs: 10_000, maxStdoutChars: 100_000, maxStderrChars: 10_000 });
    const fonts = fontProbe.ok ? [...new Set(fontProbe.stdout.split(/\r?\n/).slice(2).map((line) => line.trim().split(/\s+/)[0]).filter(Boolean))].sort() : [];
    return { pdfPath, pageCount, pages, renderer: { engine: "LibreOffice", version: version.stdout.trim(), exportFilter: "writer_pdf_Export", dpi: request.dpi ?? 150, profileIsolation: true, macroSecurityLevel: 3, linkUpdates: false, fonts, fontReportAvailable: fontProbe.ok }, warnings: [{ code: "LAYOUT_ENGINE_DIFFERENCE", message: "LibreOffice pagination and font metrics may differ from Microsoft Word.", severity: "warning" }, { code: "FONT_REPORT_LIMITED", message: "Font substitution reporting is host-dependent; visually compare layout-sensitive edits.", severity: "warning" }], workspace: root };
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
