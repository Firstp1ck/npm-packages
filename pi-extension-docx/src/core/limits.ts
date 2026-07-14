export type DocxLimits = {
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxUncompressedBytes: number;
  maxCompressionRatio: number;
  maxXmlBytes: number;
  maxParagraphs: number;
  maxTables: number;
  maxRuns: number;
  maxSearchMatches: number;
  maxVisibleOutputChars: number;
  maxOperations: number;
};

export const DEFAULT_LIMITS: DocxLimits = Object.freeze({
  maxArchiveBytes: 100 * 1024 * 1024,
  maxEntries: 10_000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxUncompressedBytes: 512 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxXmlBytes: 64 * 1024 * 1024,
  maxParagraphs: 20_000,
  maxTables: 2_000,
  maxRuns: 200_000,
  maxSearchMatches: 1_000,
  maxVisibleOutputChars: 40_000,
  maxOperations: 1_000,
});

export function mergeLimits(input?: Partial<DocxLimits>): DocxLimits {
  const result = { ...DEFAULT_LIMITS, ...(input ?? {}) };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid DOCX limit ${name}.`);
  }
  return result;
}
