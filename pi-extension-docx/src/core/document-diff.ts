import type { SemanticSnapshot } from "../ooxml/semantic.ts";
import type { OoxmlPackage } from "../ooxml/package.ts";
import { sha256Bytes } from "./hash.ts";

export type DocumentDiffOptions = { maxChanges?: number; includeFormatting?: boolean; includePackageParts?: boolean };

export function diffDocuments(beforePackage: OoxmlPackage, afterPackage: OoxmlPackage, before: SemanticSnapshot, after: SemanticSnapshot, options: DocumentDiffOptions = {}): Record<string, unknown> {
  const maxChanges = options.maxChanges ?? 1000, includeFormatting = options.includeFormatting !== false, includePackageParts = options.includePackageParts !== false;
  const paragraphs = (snapshot: SemanticSnapshot) => snapshot.stories.flatMap((story) => story.paragraphs.map((paragraph) => ({ key: paragraph.selector.kind === "paragraphId" ? `${story.kind}:id:${String(paragraph.selector.paragraphId)}` : `${story.kind}:path:${paragraph.path}`, story: story.kind, path: paragraph.path, selector: paragraph.selector, text: paragraph.text, hash: paragraph.hash, style: paragraph.style, alignment: paragraph.alignment, runs: paragraph.runs })));
  const beforeParagraphs = new Map(paragraphs(before).map((paragraph) => [paragraph.key, paragraph])), afterParagraphs = new Map(paragraphs(after).map((paragraph) => [paragraph.key, paragraph]));
  const semanticChanges: Array<Record<string, unknown>> = [];
  for (const key of [...new Set([...beforeParagraphs.keys(), ...afterParagraphs.keys()])]) {
    const left = beforeParagraphs.get(key), right = afterParagraphs.get(key);
    if (!left) semanticChanges.push({ kind: "paragraph-added", key, after: right });
    else if (!right) semanticChanges.push({ kind: "paragraph-removed", key, before: left });
    else {
      const formattingChanged = includeFormatting && (JSON.stringify(left.runs) !== JSON.stringify(right.runs) || left.style !== right.style || left.alignment !== right.alignment);
      if (left.text !== right.text || formattingChanged) semanticChanges.push({ kind: "paragraph-changed", key, textChanged: left.text !== right.text, formattingChanged, before: left, after: right });
    }
  }
  const beforeParts = new Map([...beforePackage.archive.entries].map(([part, entry]) => [part, sha256Bytes(entry.data)])), afterParts = new Map([...afterPackage.archive.entries].map(([part, entry]) => [part, sha256Bytes(entry.data)]));
  const changedParts = [...new Set([...beforeParts.keys(), ...afterParts.keys()])].filter((part) => beforeParts.get(part) !== afterParts.get(part)).sort();
  const protectedChanged = changedParts.filter((part) => { const kind = beforePackage.classifications.get(part) ?? afterPackage.classifications.get(part); return kind !== "editable" && kind !== "preserved"; });
  const relationshipKey = (relationship: { sourcePart: string; id: string; type: string; target: string; targetMode?: string }) => JSON.stringify([relationship.sourcePart, relationship.id, relationship.type, relationship.target, relationship.targetMode ?? ""]);
  const beforeRelationships = new Map(beforePackage.relationships.map((relationship) => [relationshipKey(relationship), relationship])), afterRelationships = new Map(afterPackage.relationships.map((relationship) => [relationshipKey(relationship), relationship]));
  const relationshipChanges = { added: [...afterRelationships].filter(([key]) => !beforeRelationships.has(key)).map(([, relationship]) => relationship), removed: [...beforeRelationships].filter(([key]) => !afterRelationships.has(key)).map(([, relationship]) => relationship) };
  const beforeTables = new Map(before.stories.flatMap((story) => story.tables.map((table) => [`${story.kind}:${table.path}`, table] as const))), afterTables = new Map(after.stories.flatMap((story) => story.tables.map((table) => [`${story.kind}:${table.path}`, table] as const)));
  const allTableChanges = [...new Set([...beforeTables.keys(), ...afterTables.keys()])].filter((key) => beforeTables.get(key)?.hash !== afterTables.get(key)?.hash).map((key) => ({ key, before: beforeTables.get(key), after: afterTables.get(key) }));
  const equal = semanticChanges.length === 0 && changedParts.length === 0;
  return {
    equal,
    semanticChanges: semanticChanges.slice(0, maxChanges),
    semanticChangeCount: semanticChanges.length,
    semanticChangesTruncated: semanticChanges.length > maxChanges,
    tableChanges: allTableChanges.slice(0, maxChanges),
    tableChangeCount: allTableChanges.length,
    tableChangesTruncated: allTableChanges.length > maxChanges,
    relationshipChanges,
    ...(includePackageParts ? { changedParts, protectedPartsChanged: protectedChanged } : { changedPartCount: changedParts.length, protectedPartChangeCount: protectedChanged.length }),
    beforeInventory: before.inventory,
    afterInventory: after.inventory,
  };
}
