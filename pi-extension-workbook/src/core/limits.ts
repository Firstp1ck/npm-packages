export type WorkbookLimits = {
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxUncompressedBytes: number;
  maxCompressionRatio: number;
  maxXmlBytes: number;
  maxSharedStrings: number;
  maxStyles: number;
  maxCellsPerRead: number;
  maxCellsPerEdit: number;
  maxRenderedCells: number;
  maxVisibleOutputChars: number;
};

export const DEFAULT_LIMITS: Readonly<WorkbookLimits> = Object.freeze({
  maxArchiveBytes: 256 * 1024 * 1024,
  maxEntries: 10_000,
  maxEntryBytes: 128 * 1024 * 1024,
  maxUncompressedBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxXmlBytes: 32 * 1024 * 1024,
  maxSharedStrings: 2_000_000,
  maxStyles: 250_000,
  maxCellsPerRead: 20_000,
  maxCellsPerEdit: 100_000,
  maxRenderedCells: 4_000,
  maxVisibleOutputChars: 45_000,
});

export function mergeLimits(overrides?: Partial<WorkbookLimits>): WorkbookLimits {
  const merged = { ...DEFAULT_LIMITS, ...(overrides ?? {}) };
  for (const [name, value] of Object.entries(merged)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid workbook limit ${name}: ${value}`);
  }
  return merged;
}
