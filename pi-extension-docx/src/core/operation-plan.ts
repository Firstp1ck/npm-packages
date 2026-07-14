import type { DocxOperation } from "../contracts.ts";
import { fail } from "../errors.ts";

const P1_OPERATION_TYPES = new Set(["replaceText", "insertParagraph", "deleteParagraph", "setTableCellText", "insertTableRow", "deleteTableRow", "setCharacterFormatting", "setParagraphFormatting", "setHyperlink", "removeHyperlink", "setCoreProperties"]);
export function relationshipPartFor(sourcePart: string): string { const slash = sourcePart.lastIndexOf("/"); const directory = slash >= 0 ? sourcePart.slice(0, slash + 1) : "", file = sourcePart.slice(slash + 1); return `${directory}_rels/${file}.rels`; }
export function allowedPartsForOperations(mainPart: string, operations: DocxOperation[]): Set<string> {
  const allowed = new Set<string>();
  for (const operation of operations) {
    if (operation.type === "setCoreProperties") allowed.add("docProps/core.xml");
    else {
      allowed.add(mainPart);
      if (operation.type === "setHyperlink" || operation.type === "removeHyperlink") allowed.add(relationshipPartFor(mainPart));
    }
  }
  return allowed;
}
export function planOperations(operations: DocxOperation[], maxOperations: number, mainPart = "word/document.xml"): { operationCount: number; operationTypes: string[]; expectedChangedParts: string[]; visualVerification: "recommended" | "mandatory" } {
  if (!operations.length) fail("INVALID_ARGUMENT", "At least one operation is required.");
  if (operations.length > maxOperations) fail("LIMIT_EXCEEDED", `Operation count exceeds ${maxOperations}.`);
  const unsupported = operations.map((operation) => operation?.type).filter((type) => !P1_OPERATION_TYPES.has(type)); if (unsupported.length) fail("UNSUPPORTED_FEATURE", `Unsupported operation type(s): ${[...new Set(unsupported)].join(", ")}.`);
  const types = [...new Set(operations.map((operation) => operation.type))];
  return { operationCount: operations.length, operationTypes: types, expectedChangedParts: [...allowedPartsForOperations(mainPart, operations)].sort(), visualVerification: types.some((type) => /Table|Formatting|Paragraph|Hyperlink/.test(type)) ? "mandatory" : "recommended" };
}
