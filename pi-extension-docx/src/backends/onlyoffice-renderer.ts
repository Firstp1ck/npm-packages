import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DocxRenderRequest, Warning } from "../contracts.ts";
import { assertNotAborted, fail } from "../errors.ts";
import { runCommand } from "../pi-utils.ts";
import { runOwnedProcess } from "../core/child-process.ts";
import { parsePageSelection, pdfPageCount, probeLiteParse, screenshotPdf } from "./liteparse-reader.ts";
import { WORKSPACE_ROOT } from "../core/workspace.ts";

const MAX_RENDERED_PAGES = 20;
const MAX_RENDERED_BYTES = 50 * 1024 * 1024;
type OnlyOfficeInstall = { command: string; workDir: string; allFontsPath: string; fontSelectionPath?: string };

async function executable(filePath: string): Promise<boolean> {
  return fs.access(filePath, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK).then(() => true, () => false);
}
async function regularFile(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then((stat) => stat.isFile(), () => false);
}
function x2tCandidates(): string[] {
  const configured = process.env.ONLYOFFICE_X2T_PATH?.trim();
  if (configured) return [configured];
  if (process.platform === "win32") return ["C:/Program Files/ONLYOFFICE/DesktopEditors/converter/x2t.exe", "C:/Program Files (x86)/ONLYOFFICE/DesktopEditors/converter/x2t.exe"];
  if (process.platform === "darwin") return ["/Applications/ONLYOFFICE.app/Contents/MacOS/converter/x2t"];
  return ["/opt/onlyoffice/desktopeditors/converter/x2t", "/usr/lib/onlyoffice/desktopeditors/converter/x2t"];
}
function allFontsCandidates(): string[] {
  const configured = process.env.ONLYOFFICE_ALL_FONTS_PATH?.trim();
  if (configured) return [configured];
  const candidates: string[] = [];
  if (process.platform === "linux") {
    const dataHome = process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share");
    candidates.push(path.join(dataHome, "onlyoffice", "desktopeditors", "data", "fonts", "AllFonts.js"));
  } else if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "ONLYOFFICE", "DesktopEditors", "data", "fonts", "AllFonts.js"));
  } else if (process.platform === "darwin") {
    candidates.push(path.join(os.homedir(), "Library", "Application Support", "asc.onlyoffice.ONLYOFFICE", "data", "fonts", "AllFonts.js"));
  }
  return candidates;
}
async function resolveOnlyOffice(): Promise<{ install?: OnlyOfficeInstall; reason?: string }> {
  const command = (await Promise.all(x2tCandidates().map(async (candidate) => await executable(candidate) ? candidate : undefined))).find(Boolean);
  if (!command) return { reason: process.env.ONLYOFFICE_X2T_PATH ? "Configured ONLYOFFICE_X2T_PATH is not executable." : "ONLYOFFICE Desktop Editors x2t converter was not found." };
  const allFontsPath = (await Promise.all(allFontsCandidates().map(async (candidate) => await regularFile(candidate) ? candidate : undefined))).find(Boolean);
  if (!allFontsPath) return { reason: process.env.ONLYOFFICE_ALL_FONTS_PATH ? "Configured ONLYOFFICE_ALL_FONTS_PATH is not a file." : "ONLYOFFICE font cache was not found; launch Desktop Editors once or configure ONLYOFFICE_ALL_FONTS_PATH." };
  const fontSelectionPath = path.join(path.dirname(allFontsPath), "font_selection.bin");
  return { install: { command, workDir: path.dirname(command), allFontsPath, fontSelectionPath: await regularFile(fontSelectionPath) ? fontSelectionPath : undefined } };
}
function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
export function buildOnlyOfficeTaskXml(inputPath: string, outputPath: string, allFontsPath: string, fontDir: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<TaskQueueDataConvert>\n<m_sFileFrom>${xmlEscape(inputPath)}</m_sFileFrom>\n<m_sFileTo>${xmlEscape(outputPath)}</m_sFileTo>\n<m_nFormatTo>513</m_nFormatTo>\n<m_sAllFontsPath>${xmlEscape(allFontsPath)}</m_sAllFontsPath>\n<m_sFontDir>${xmlEscape(fontDir)}</m_sFontDir>\n<m_bEmbeddedFonts>false</m_bEmbeddedFonts>\n<m_bDontSaveAdditional>true</m_bDontSaveAdditional>\n<m_bIsNoBase64>true</m_bIsNoBase64>\n</TaskQueueDataConvert>\n`;
}
export async function probeOnlyOfficeRenderer(): Promise<Record<string, unknown>> {
  const [{ install, reason }, liteparse] = await Promise.all([resolveOnlyOffice(), probeLiteParse()]);
  if (!install) return { available: false, engine: "onlyoffice-renderer", liteparse, reason };
  return { available: liteparse.available, engine: "onlyoffice-renderer", liteparse, constraints: ["Private conversion workspace and HOME", "generated x2t task XML", "local font-cache snapshot", "PDF export only", `${MAX_RENDERED_PAGES} page result limit`], reason: liteparse.available ? undefined : "LiteParse native PDF support is unavailable." };
}
export async function renderDocxWithOnlyOffice(sourcePath: string, request: DocxRenderRequest, signal?: AbortSignal): Promise<{ pdfPath: string; pageCount: number; pages: Array<{ pageNum: number; width: number; height: number; outputPath: string; bytes: number; png: Buffer }>; renderer: Record<string, unknown>; warnings: Warning[]; workspace: string }> {
  assertNotAborted(signal);
  const { install, reason } = await resolveOnlyOffice();
  if (!install) fail("DEPENDENCY_MISSING", reason ?? "ONLYOFFICE renderer is unavailable.");
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true, mode: 0o700 });
  const root = await fs.mkdtemp(path.join(WORKSPACE_ROOT, "render-onlyoffice-"));
  try {
    const inputDir = path.join(root, "input"), outputDir = path.join(root, "output"), tempDir = path.join(root, "tmp"), fontsDir = path.join(root, "fonts"), homeDir = path.join(root, "home");
    await Promise.all([inputDir, outputDir, tempDir, fontsDir, homeDir].map((directory) => fs.mkdir(directory, { mode: 0o700 })));
    const inputCopy = path.join(inputDir, `${randomUUID()}${path.extname(sourcePath).toLowerCase() || ".docx"}`), pdfPath = path.join(outputDir, "document.pdf"), stagedAllFonts = path.join(fontsDir, "AllFonts.js"), taskPath = path.join(root, "task.xml");
    await Promise.all([fs.copyFile(sourcePath, inputCopy), fs.copyFile(install.allFontsPath, stagedAllFonts)]);
    if (install.fontSelectionPath) await fs.copyFile(install.fontSelectionPath, path.join(fontsDir, "font_selection.bin"));
    await Promise.all([inputCopy, stagedAllFonts, install.fontSelectionPath ? path.join(fontsDir, "font_selection.bin") : undefined].filter((value): value is string => Boolean(value)).map((filePath) => fs.chmod(filePath, 0o600)));
    await fs.writeFile(taskPath, buildOnlyOfficeTaskXml(inputCopy, pdfPath, stagedAllFonts, fontsDir), { mode: 0o600 });
    const result = await runOwnedProcess(install.command, [taskPath], { signal, timeoutMs: request.timeoutMs ?? 120_000, cwd: install.workDir, env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, XDG_CONFIG_HOME: path.join(homeDir, ".config"), XDG_CACHE_HOME: path.join(homeDir, ".cache"), XDG_DATA_HOME: path.join(homeDir, ".local", "share"), TMPDIR: tempDir } });
    if (result.code !== 0) fail("RENDER_FAILED", `ONLYOFFICE PDF export failed: ${result.stderr || result.stdout || `exit ${result.code}`}`);
    const pdfStat = await fs.stat(pdfPath).catch(() => undefined), header = pdfStat?.isFile() ? await fs.readFile(pdfPath).then((bytes) => bytes.subarray(0, 5).toString("ascii")) : "";
    if (!pdfStat?.isFile() || !pdfStat.size || header !== "%PDF-") fail("RENDER_FAILED", "ONLYOFFICE did not create a valid PDF.");
    await fs.chmod(pdfPath, 0o600);
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
    const fontProbe = await runCommand("pdffonts", [pdfPath], { timeoutMs: 10_000, maxStdoutChars: 100_000, maxStderrChars: 10_000 });
    const fonts = fontProbe.ok ? [...new Set(fontProbe.stdout.split(/\r?\n/).slice(2).map((line) => line.trim().split(/\s+/)[0]).filter(Boolean))].sort() : [];
    return { pdfPath, pageCount, pages, renderer: { engine: "ONLYOFFICE x2t", exportFormat: "PDF", dpi: request.dpi ?? 150, workspaceIsolation: true, fontCacheSnapshot: true, fonts, fontReportAvailable: fontProbe.ok }, warnings: [{ code: "LAYOUT_ENGINE_DIFFERENCE", message: "ONLYOFFICE pagination and font metrics may differ from Microsoft Word.", severity: "warning" }, { code: "FONT_REPORT_LIMITED", message: "Font substitution reporting is host-dependent; visually compare layout-sensitive edits.", severity: "warning" }], workspace: root };
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
