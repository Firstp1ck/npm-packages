import { sha256Bytes } from "./hash.ts";
import { fail } from "../errors.ts";
import { SafeZipArchive } from "../ooxml/zip.ts";
import { OoxmlPackage } from "../ooxml/package.ts";
export { OoxmlPackage } from "../ooxml/package.ts";
export type { PackageManifest, ManifestPart, PackageRelationship, IntegrityComparison } from "../ooxml/package.ts";

export function transplantAllowedParts(baseline: OoxmlPackage, candidate: OoxmlPackage, allowedChangedParts: Set<string>): { bytes: Uint8Array; transplantedParts: string[]; discardedSidecarChanges: string[] } {
  const entries = new Map<string, Uint8Array>([...baseline.archive.entries].map(([part, entry]) => [part, entry.data]));
  const transplantedParts: string[] = [];
  for (const part of allowedChangedParts) {
    const candidateEntry = candidate.archive.entries.get(part), baselineEntry = baseline.archive.entries.get(part);
    if (!candidateEntry) {
      if (baselineEntry) fail("UNSUPPORTED_FEATURE", `P1 operations cannot remove OOXML part ${part}.`);
      continue;
    }
    if (!baselineEntry || sha256Bytes(candidateEntry.data) !== sha256Bytes(baselineEntry.data)) {
      entries.set(part, candidateEntry.data);
      transplantedParts.push(part);
    }
  }
  const discardedSidecarChanges = [...new Set([...baseline.archive.entries.keys(), ...candidate.archive.entries.keys()])]
    .filter((part) => !allowedChangedParts.has(part) && sha256Bytes(baseline.archive.entries.get(part)?.data ?? new Uint8Array()) !== sha256Bytes(candidate.archive.entries.get(part)?.data ?? new Uint8Array()))
    .sort();
  const bytes = SafeZipArchive.fromEntries(entries, baseline.archive.limits).toBytes();
  return { bytes, transplantedParts: transplantedParts.sort(), discardedSidecarChanges };
}
