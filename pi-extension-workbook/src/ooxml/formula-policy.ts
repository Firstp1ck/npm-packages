import { fail } from "../errors.ts";
import { formatRange, parseCellReference, parseRange, rangesOverlap, type RangeBounds } from "./cell-ref.ts";
import { NS, elements } from "./xml.ts";

export type ComplexFormulaRegion = {
  bounds: RangeBounds;
  kind: string;
  anchor: string;
};

function formulaCellReference(formula: Element): string | undefined {
  const cell = formula.parentNode;
  return cell?.nodeType === 1 ? (cell as Element).getAttribute("r") ?? undefined : undefined;
}

/**
 * Return formula regions that cannot be partially rewritten by the surgical backend.
 * Shared, array, data-table, and spill formulas are preservation-only until a
 * dedicated operation can update the complete formula group atomically.
 */
export function complexFormulaRegions(document: Document): ComplexFormulaRegion[] {
  const regions: ComplexFormulaRegion[] = [];
  for (const formula of elements(document, NS.spreadsheet, "f")) {
    const kind = formula.getAttribute("t") ?? "normal";
    const reference = formula.getAttribute("ref") ?? formulaCellReference(formula);
    if (!reference) continue;
    const dynamic = formula.getAttribute("aca") === "1" || formula.getAttribute("bx") === "1";
    const complex = kind !== "normal" || dynamic || formula.hasAttribute("ref");
    if (!complex) continue;
    regions.push({ bounds: parseRange(reference), kind: dynamic && kind === "normal" ? "dynamic-array" : kind, anchor: formulaCellReference(formula) ?? reference });
  }
  return regions;
}

export function assertRangeOutsideComplexFormulas(document: Document, bounds: RangeBounds, operation: string): void {
  const overlap = complexFormulaRegions(document).find((region) => rangesOverlap(region.bounds, bounds));
  if (!overlap) return;
  fail(
    "UNSUPPORTED_FEATURE",
    `${operation} intersects preservation-only ${overlap.kind} formula region ${formatRange(overlap.bounds)} (anchor ${overlap.anchor}).`,
  );
}
