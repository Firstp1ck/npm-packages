import type { DocxRenderRequest } from "../contracts.ts";
import { fail } from "../errors.ts";
import { probeRenderer as probeLibreOfficeRenderer, renderDocx as renderDocxWithLibreOffice } from "./libreoffice-renderer.ts";
import { probeOnlyOfficeRenderer, renderDocxWithOnlyOffice } from "./onlyoffice-renderer.ts";

export type RendererPreference = "onlyoffice" | "libreoffice" | "auto";
function preference(): RendererPreference {
  const value = process.env.PI_DOCX_RENDERER?.trim().toLowerCase() || "auto";
  if (value === "auto" || value === "onlyoffice" || value === "libreoffice") return value;
  fail("INVALID_ARGUMENT", "PI_DOCX_RENDERER must be auto, onlyoffice, or libreoffice.");
}
export async function probeRenderer(): Promise<Record<string, unknown>> {
  const selected = preference();
  if (selected === "onlyoffice") return probeOnlyOfficeRenderer();
  if (selected === "libreoffice") return probeLibreOfficeRenderer();
  const onlyoffice = await probeOnlyOfficeRenderer();
  if (onlyoffice.available === true) return { ...onlyoffice, selection: "auto", fallback: "libreoffice" };
  const libreoffice = await probeLibreOfficeRenderer();
  if (libreoffice.available === true) return { ...libreoffice, selection: "auto", fallback: "onlyoffice" };
  return { available: false, engine: "document-renderer", selection: "auto", candidates: { onlyoffice, libreoffice }, reason: "No supported DOCX-to-PDF renderer is available." };
}
export async function renderDocx(sourcePath: string, request: DocxRenderRequest, signal?: AbortSignal) {
  const selected = preference();
  if (selected === "onlyoffice") return renderDocxWithOnlyOffice(sourcePath, request, signal);
  if (selected === "libreoffice") return renderDocxWithLibreOffice(sourcePath, request, signal);
  const onlyoffice = await probeOnlyOfficeRenderer();
  if (onlyoffice.available === true) return renderDocxWithOnlyOffice(sourcePath, request, signal);
  const libreoffice = await probeLibreOfficeRenderer();
  if (libreoffice.available === true) return renderDocxWithLibreOffice(sourcePath, request, signal);
  fail("DEPENDENCY_MISSING", "No DOCX renderer is available. Install ONLYOFFICE Desktop Editors (preferred), configure ONLYOFFICE_X2T_PATH and ONLYOFFICE_ALL_FONTS_PATH, or install LibreOffice.", { onlyoffice, libreoffice });
}
