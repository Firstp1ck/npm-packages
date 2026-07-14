import path from "node:path";
import type { WorkbookFormat } from "../contracts.ts";
import { OoxmlPackage, type IntegrityComparison } from "./package.ts";

export type PackageValidation = {
  ok: boolean;
  format: WorkbookFormat;
  workbookPart: string;
  workbookContentType?: string;
  macroEnabled: boolean;
  hasVbaProject: boolean;
  protectedParts: string[];
  externalRelationships: number;
  errors: string[];
  warnings: string[];
  integrity?: IntegrityComparison;
};

function expectedFormat(filePath: string): WorkbookFormat {
  return path.extname(filePath).toLowerCase() === ".xlsm" ? "xlsm" : "xlsx";
}

export function validatePackage(pkg: OoxmlPackage, filePath: string, baseline?: OoxmlPackage, allowedChangedParts?: Set<string>): PackageValidation {
  const format = expectedFormat(filePath);
  const workbookContentType = pkg.contentTypeFor(pkg.workbookPart);
  const macroEnabled = Boolean(workbookContentType && /macroEnabled/i.test(workbookContentType));
  const hasVbaProject = pkg.relationships.some((relationship) => /\/vbaProject$/i.test(relationship.type) && Boolean(relationship.resolvedTarget));
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!/\.(?:xlsx|xlsm)$/i.test(filePath)) errors.push("Workbook extension must be .xlsx or .xlsm.");
  if (format === "xlsx" && (macroEnabled || hasVbaProject)) errors.push(".xlsx package unexpectedly contains macro-enabled workbook content.");
  if (format === "xlsm" && (!macroEnabled || !hasVbaProject)) errors.push(".xlsm package is missing its macro-enabled content type or VBA project.");
  if (!pkg.archive.get("_rels/.rels")) errors.push("Root relationship part is missing.");

  const integrity = baseline ? baseline.compareIntegrity(pkg, allowedChangedParts) : undefined;
  if (integrity && !integrity.ok) errors.push(...integrity.errors);
  const externalRelationships = pkg.relationships.filter((relationship) => relationship.targetMode?.toLowerCase() === "external").length;
  if (externalRelationships > 0) warnings.push(`${externalRelationships} external relationship(s) are present and were not refreshed.`);

  return {
    ok: errors.length === 0,
    format,
    workbookPart: pkg.workbookPart,
    workbookContentType,
    macroEnabled,
    hasVbaProject,
    protectedParts: [...pkg.protectedParts].sort(),
    externalRelationships,
    errors,
    warnings,
    ...(integrity ? { integrity } : {}),
  };
}
