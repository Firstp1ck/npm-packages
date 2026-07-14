import type { DocxOperation } from "../contracts.ts";
import { fail } from "../errors.ts";

export function allowedPartsForOperations(mainPart: string, operations: DocxOperation[]): Set<string> {
  const allowed = new Set<string>();
  for (const operation of operations) {
    if (operation.type === "setCoreProperties") allowed.add("docProps/core.xml");
    else {
      allowed.add(mainPart);
      if (operation.type === "setHyperlink" || operation.type === "removeHyperlink") allowed.add("word/_rels/document.xml.rels");
    }
  }
  return allowed;
}
export function planOperations(operations: DocxOperation[], maxOperations: number, mainPart = "word/document.xml"): { operationCount: number; operationTypes: string[]; expectedChangedParts: string[]; visualVerification: "recommended" | "mandatory" } {
  if (!operations.length) fail("INVALID_ARGUMENT", "At least one operation is required.");
  if (operations.length > maxOperations) fail("LIMIT_EXCEEDED", `Operation count exceeds ${maxOperations}.`);
  const types = [...new Set(operations.map((operation) => operation.type))];
  return { operationCount: operations.length, operationTypes: types, expectedChangedParts: [...allowedPartsForOperations(mainPart, operations)].sort(), visualVerification: types.some((type) => /Table|Formatting|Paragraph|Hyperlink/.test(type)) ? "mandatory" : "recommended" };
}
