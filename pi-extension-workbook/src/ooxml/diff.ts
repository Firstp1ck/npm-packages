import type { WorkbookDiffRequest } from "../contracts.ts";
import { OoxmlPackage } from "./package.ts";
import { WorkbookModel, type CellData } from "./workbook.ts";

export type CellDifference = {
  sheet: string;
  reference: string;
  before?: Pick<CellData, "value" | "formula" | "styleId">;
  after?: Pick<CellData, "value" | "formula" | "styleId">;
};

export type WorkbookDifference = {
  equal: boolean;
  beforeHash?: string;
  afterHash?: string;
  addedSheets: string[];
  removedSheets: string[];
  changedCells: CellDifference[];
  changedParts: string[];
  addedParts: string[];
  removedParts: string[];
  protectedPartChanges: string[];
  truncated: boolean;
  warnings: string[];
};

function comparable(cell: CellData | undefined): Pick<CellData, "value" | "formula" | "styleId"> | undefined {
  return cell ? { value: cell.value, ...(cell.formula !== undefined ? { formula: cell.formula } : {}), styleId: cell.styleId } : undefined;
}

export function diffWorkbookPackages(beforePackage: OoxmlPackage, afterPackage: OoxmlPackage, request: Pick<WorkbookDiffRequest, "sheet" | "range" | "maxChanges">): WorkbookDifference {
  const before = new WorkbookModel(beforePackage);
  const after = new WorkbookModel(afterPackage);
  const beforeSheets = new Set(before.sheets.map((sheet) => sheet.name));
  const afterSheets = new Set(after.sheets.map((sheet) => sheet.name));
  const addedSheets = [...afterSheets].filter((name) => !beforeSheets.has(name)).sort();
  const removedSheets = [...beforeSheets].filter((name) => !afterSheets.has(name)).sort();
  const changedCells: CellDifference[] = [];
  const warnings: string[] = [];
  const maximum = request.maxChanges ?? 500;
  let truncated = false;
  const sheetNames = request.sheet ? [request.sheet] : [...beforeSheets].filter((name) => afterSheets.has(name));

  for (const sheetName of sheetNames) {
    if (!beforeSheets.has(sheetName) || !afterSheets.has(sheetName)) continue;
    const beforeRead = before.read(sheetName, request.range, before.limits.maxCellsPerRead);
    const afterRead = after.read(sheetName, request.range, after.limits.maxCellsPerRead);
    if (beforeRead.truncated || afterRead.truncated) warnings.push(`Cell comparison for ${sheetName} was bounded by read limits.`);
    const beforeCells = new Map(beforeRead.cells.map((cell) => [cell.reference, cell]));
    const afterCells = new Map(afterRead.cells.map((cell) => [cell.reference, cell]));
    const references = new Set([...beforeCells.keys(), ...afterCells.keys()]);
    for (const reference of [...references].sort()) {
      const beforeValue = comparable(beforeCells.get(reference));
      const afterValue = comparable(afterCells.get(reference));
      if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;
      if (changedCells.length >= maximum) {
        truncated = true;
        break;
      }
      changedCells.push({ sheet: sheetName, reference, ...(beforeValue ? { before: beforeValue } : {}), ...(afterValue ? { after: afterValue } : {}) });
    }
    if (truncated) break;
  }

  const beforeManifest = new Map(beforePackage.manifest().parts.map((part) => [part.path, part]));
  const afterManifest = new Map(afterPackage.manifest().parts.map((part) => [part.path, part]));
  const changedParts = [...beforeManifest.keys()].filter((part) => afterManifest.has(part) && beforeManifest.get(part)!.sha256 !== afterManifest.get(part)!.sha256).sort();
  const addedParts = [...afterManifest.keys()].filter((part) => !beforeManifest.has(part)).sort();
  const removedParts = [...beforeManifest.keys()].filter((part) => !afterManifest.has(part)).sort();
  const protectedPartChanges = [...new Set([
    ...changedParts.filter((part) => beforePackage.protectedParts.has(part) || afterPackage.protectedParts.has(part)),
    ...removedParts.filter((part) => beforePackage.protectedParts.has(part)),
    ...addedParts.filter((part) => afterPackage.protectedParts.has(part)),
  ])].sort();

  const equal = addedSheets.length === 0 && removedSheets.length === 0 && changedCells.length === 0 && changedParts.length === 0 && addedParts.length === 0 && removedParts.length === 0;
  return { equal, addedSheets, removedSheets, changedCells, changedParts, addedParts, removedParts, protectedPartChanges, truncated, warnings };
}
