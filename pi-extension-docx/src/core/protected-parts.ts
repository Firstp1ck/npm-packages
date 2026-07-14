export type PartClassification = "editable" | "preserved" | "protected" | "active-content" | "signed" | "unsupported";
export function classifyRelationshipType(type: string): PartClassification | undefined {
  if (/digital-signature|vbaProjectSignature/i.test(type)) return "signed";
  if (/(?:vbaProject|activeX|oleObject|attachedTemplate|ui\/extensibility|relationships\/package)$/i.test(type)) return "active-content";
  if (/(?:chart|diagram|customXml|altChunk|aFChunk|glossaryDocument)$/i.test(type)) return "protected";
  return undefined;
}
export function classifyPart(partPath: string, contentType?: string, relationshipTypes: string[] = []): PartClassification {
  const value = `${partPath}\n${contentType ?? ""}\n${relationshipTypes.join("\n")}`;
  if (/(?:^|\/)_(?:xml)?signatures?\/|digital-signature|origin\.sigs|vbaProjectSignature/i.test(value)) return "signed";
  if (/vbaProject|activeX|customUI|oleObject|embeddings\/|attachedTemplate|macroEnabled/i.test(value)) return "active-content";
  if (/word\/(?:charts|diagrams|embeddings|activeX)\/|customXml\/|altChunk|glossary/i.test(value)) return "protected";
  if (/^(?:word\/document\.xml|word\/(?:header|footer|footnotes|endnotes|comments)[0-9]*\.xml|word\/_rels\/document\.xml\.rels|docProps\/core\.xml)$/i.test(partPath)) return "editable";
  if (/\.bin$/i.test(partPath) || /unknown/i.test(contentType ?? "")) return "unsupported";
  return "preserved";
}
