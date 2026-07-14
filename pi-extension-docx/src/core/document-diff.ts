import type { SemanticSnapshot } from "../ooxml/semantic.ts";
import type { OoxmlPackage } from "../ooxml/package.ts";
import { sha256Bytes } from "./hash.ts";

export function diffDocuments(beforePackage: OoxmlPackage, afterPackage: OoxmlPackage, before: SemanticSnapshot, after: SemanticSnapshot, maxChanges = 1000): Record<string, unknown> {
  const beforeParagraphs = before.stories.flatMap((s) => s.paragraphs.map((p) => ({ story: s.kind, path: p.path, text: p.text, hash: p.hash, style: p.style, alignment: p.alignment, runs: p.runs })));
  const afterParagraphs = after.stories.flatMap((s) => s.paragraphs.map((p) => ({ story: s.kind, path: p.path, text: p.text, hash: p.hash, style: p.style, alignment: p.alignment, runs: p.runs })));
  const changes: Array<Record<string, unknown>> = [], total = Math.max(beforeParagraphs.length, afterParagraphs.length);
  for (let index = 0; index < total && changes.length < maxChanges; index++) { const left = beforeParagraphs[index], right = afterParagraphs[index]; if (!left) changes.push({ kind: "paragraph-added", index, after: right }); else if (!right) changes.push({ kind: "paragraph-removed", index, before: left }); else if (left.text !== right.text || JSON.stringify(left.runs) !== JSON.stringify(right.runs) || left.style !== right.style || left.alignment !== right.alignment) changes.push({ kind: "paragraph-changed", index, before: left, after: right }); }
  const beforeParts = new Map([...beforePackage.archive.entries].map(([p, e]) => [p, sha256Bytes(e.data)])), afterParts = new Map([...afterPackage.archive.entries].map(([p, e]) => [p, sha256Bytes(e.data)]));
  const changedParts = [...new Set([...beforeParts.keys(), ...afterParts.keys()])].filter((p) => beforeParts.get(p) !== afterParts.get(p)).sort();
  const protectedChanged = changedParts.filter((p) => { const kind = beforePackage.classifications.get(p) ?? afterPackage.classifications.get(p); return kind !== "editable" && kind !== "preserved"; });
  const relationshipKey = (relationship: { sourcePart: string; id: string; type: string; target: string; targetMode?: string }) => JSON.stringify([relationship.sourcePart, relationship.id, relationship.type, relationship.target, relationship.targetMode ?? ""]);
  const beforeRelationships = new Map(beforePackage.relationships.map((relationship) => [relationshipKey(relationship), relationship])), afterRelationships = new Map(afterPackage.relationships.map((relationship) => [relationshipKey(relationship), relationship]));
  const relationshipChanges = { added: [...afterRelationships].filter(([key]) => !beforeRelationships.has(key)).map(([, relationship]) => relationship), removed: [...beforeRelationships].filter(([key]) => !afterRelationships.has(key)).map(([, relationship]) => relationship) };
  const beforeTables = new Map(before.stories.flatMap((story) => story.tables.map((table) => [`${story.kind}:${table.path}`, table] as const))), afterTables = new Map(after.stories.flatMap((story) => story.tables.map((table) => [`${story.kind}:${table.path}`, table] as const)));
  const tableChanges = [...new Set([...beforeTables.keys(), ...afterTables.keys()])].filter((key) => beforeTables.get(key)?.hash !== afterTables.get(key)?.hash).slice(0, maxChanges).map((key) => ({ key, before: beforeTables.get(key), after: afterTables.get(key) }));
  return { equal: changes.length === 0 && changedParts.length === 0, semanticChanges: changes, semanticChangesTruncated: changes.length >= maxChanges && total > maxChanges, tableChanges, relationshipChanges, changedParts, protectedPartsChanged: protectedChanged, beforeInventory: before.inventory, afterInventory: after.inventory };
}
