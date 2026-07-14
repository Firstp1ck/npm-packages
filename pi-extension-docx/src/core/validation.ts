import fs from "node:fs/promises";
import type { DocxLimits } from "./limits.ts";
import { sha256File } from "./hash.ts";
import { OoxmlPackage } from "../ooxml/package.ts";
import { semanticSnapshot } from "../ooxml/semantic.ts";
import { OpenXmlSidecar } from "../backends/openxml-sidecar.ts";

export async function validateDocument(input: { path: string; baselinePath?: string; expectedChangedParts?: string[]; limits?: Partial<DocxLimits>; sidecar?: OpenXmlSidecar; signal?: AbortSignal; timeoutMs?: number }): Promise<Record<string, unknown>> {
  const bytes = await fs.readFile(input.path), sourceSha256 = await sha256File(input.path), pkg = OoxmlPackage.fromBytes(bytes, input.limits), snapshot = semanticSnapshot(pkg);
  const packageChecks = { zip: true, contentTypes: true, relationships: true, independentSemanticReopen: true, mainPart: pkg.mainDocumentPart };
  let preservation: Record<string, unknown> | undefined;
  if (input.baselinePath) { const baseline = OoxmlPackage.fromBytes(await fs.readFile(input.baselinePath), input.limits); preservation = baseline.compareIntegrity(pkg, new Set(input.expectedChangedParts ?? [])); }
  const sidecar = input.sidecar ?? new OpenXmlSidecar(), capabilities = await sidecar.probe(input.signal); let schema: Record<string, unknown>;
  if (capabilities.available) { const response = await sidecar.request("validate", { sourcePath: input.path }, input.signal, input.timeoutMs); schema = { available: true, valid: true, engineVersion: response.engineVersion, ...(response.result ?? {}) }; }
  else schema = { available: false, valid: false, reason: "Open XML sidecar unavailable; package-only validation is not a production commit gate." };
  const preservationOk = !preservation || preservation.ok === true, ok = preservationOk && schema.valid === true;
  return { ok, sourcePath: input.path, sourceSha256, packageChecks, schema, preservation, inventory: snapshot.inventory, manifest: pkg.manifest(sourceSha256), warnings: ok ? snapshot.warnings : [...snapshot.warnings, { code: "VALIDATION_INCOMPLETE", message: "Full Open XML validation did not pass; commit must remain blocked.", severity: "error" }] };
}
