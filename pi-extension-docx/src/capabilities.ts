import type { EngineCapabilities } from "./contracts.ts";

const P1_OPERATIONS = ["replaceText", "insertParagraph", "deleteParagraph", "setTableCellText", "insertTableRow", "deleteTableRow", "setCharacterFormatting", "setParagraphFormatting", "setHyperlink", "removeHyperlink", "setCoreProperties"];
export function openXmlCapabilities(available: boolean, version?: string): EngineCapabilities {
  return {
    engine: "openxml-sidecar", available, version, formats: ["docx"],
    operations: P1_OPERATIONS.map((operation) => ({ operation, supported: available, fidelity: available ? "bounded" : "unsupported", reason: available ? "Open XML SDK edit with package-manifest preservation gates." : "Open XML sidecar is unavailable." })),
    constraints: ["Signed and macro-enabled documents are mutation-blocked.", "No macros, fields, links, OLE, or external relationships execute.", "Only declared OOXML parts may change."],
  };
}
export const TYPESCRIPT_READER_CAPABILITIES: EngineCapabilities = {
  engine: "typescript-reader", available: true, formats: ["docx", "dotx", "docm", "dotm"], operations: [
    { operation: "inspect", supported: true, fidelity: "native" }, { operation: "read", supported: true, fidelity: "bounded" },
    { operation: "diff", supported: true, fidelity: "bounded" }, { operation: "validate-package", supported: true, fidelity: "native" },
  ], constraints: ["Semantic inspection does not paginate.", "Hidden data is omitted unless explicitly requested."],
};
