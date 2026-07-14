import { fail } from "../errors.ts";

export type CellAddress = { row: number; column: number; absoluteRow: boolean; absoluteColumn: boolean };
export type RangeBounds = { startRow: number; endRow: number; startColumn: number; endColumn: number };

export function columnToNumber(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 1 || value > 16_384) fail("INVALID_ARGUMENT", `Invalid Excel column number: ${value}.`);
    return value;
  }
  const normalized = value.trim().replace(/^\$/, "").toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(normalized)) fail("INVALID_ARGUMENT", `Invalid Excel column: ${value}.`);
  let column = 0;
  for (const character of normalized) column = column * 26 + character.charCodeAt(0) - 64;
  if (column > 16_384) fail("INVALID_ARGUMENT", `Excel column is beyond XFD: ${value}.`);
  return column;
}

export function numberToColumn(column: number): string {
  if (!Number.isInteger(column) || column < 1 || column > 16_384) fail("INVALID_ARGUMENT", `Invalid Excel column number: ${column}.`);
  let value = column;
  let output = "";
  while (value > 0) {
    value--;
    output = String.fromCharCode(65 + value % 26) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

export function parseCellReference(reference: string): CellAddress {
  const match = reference.trim().match(/^(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]{0,6})$/);
  if (!match) fail("INVALID_ARGUMENT", `Invalid A1 cell reference: ${reference}.`);
  const row = Number(match[4]);
  const column = columnToNumber(match[2]);
  if (row > 1_048_576) fail("INVALID_ARGUMENT", `Excel row exceeds 1048576: ${reference}.`);
  return { column, row, absoluteColumn: match[1] === "$", absoluteRow: match[3] === "$" };
}

export function formatCellReference(row: number, column: number, absoluteRow = false, absoluteColumn = false): string {
  if (!Number.isInteger(row) || row < 1 || row > 1_048_576) fail("INVALID_ARGUMENT", `Invalid Excel row: ${row}.`);
  return `${absoluteColumn ? "$" : ""}${numberToColumn(column)}${absoluteRow ? "$" : ""}${row}`;
}

export function parseRange(reference: string): RangeBounds {
  const trimmed = reference.trim();
  if (trimmed.includes("!")) fail("INVALID_ARGUMENT", `Pass sheet separately; range must not contain '!': ${reference}.`);
  const [startText, endText, extra] = trimmed.split(":");
  if (extra !== undefined) fail("INVALID_ARGUMENT", `Invalid A1 range: ${reference}.`);
  const start = parseCellReference(startText);
  const end = parseCellReference(endText ?? startText);
  return {
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endColumn: Math.max(start.column, end.column),
  };
}

export function formatRange(bounds: RangeBounds): string {
  const start = formatCellReference(bounds.startRow, bounds.startColumn);
  const end = formatCellReference(bounds.endRow, bounds.endColumn);
  return start === end ? start : `${start}:${end}`;
}

export function rangeCellCount(bounds: RangeBounds): number {
  return (bounds.endRow - bounds.startRow + 1) * (bounds.endColumn - bounds.startColumn + 1);
}

export function* iterateRange(bounds: RangeBounds): Generator<{ row: number; column: number; reference: string }> {
  for (let row = bounds.startRow; row <= bounds.endRow; row++) {
    for (let column = bounds.startColumn; column <= bounds.endColumn; column++) {
      yield { row, column, reference: formatCellReference(row, column) };
    }
  }
}

export function containsCell(bounds: RangeBounds, row: number, column: number): boolean {
  return row >= bounds.startRow && row <= bounds.endRow && column >= bounds.startColumn && column <= bounds.endColumn;
}

export function rangesOverlap(a: RangeBounds, b: RangeBounds): boolean {
  return a.startRow <= b.endRow && b.startRow <= a.endRow && a.startColumn <= b.endColumn && b.startColumn <= a.endColumn;
}

export function translateFormula(formula: string, rowDelta: number, columnDelta: number): string {
  const segments = formula.split(/("(?:[^"]|"")*")/g);
  return segments.map((segment, index) => {
    if (index % 2 === 1) return segment;
    return segment.replace(/(?<![A-Za-z0-9_.])((?:'[^']+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?)([A-Z]{1,3})(\$?)([1-9][0-9]{0,6})(?![A-Za-z0-9_])/g,
      (match, sheetPrefix: string | undefined, columnAbsolute: string, columnText: string, rowAbsolute: string, rowText: string) => {
        const column = columnToNumber(columnText);
        const row = Number(rowText);
        const translatedColumn = columnAbsolute ? column : column + columnDelta;
        const translatedRow = rowAbsolute ? row : row + rowDelta;
        if (translatedColumn < 1 || translatedColumn > 16_384 || translatedRow < 1 || translatedRow > 1_048_576) return "#REF!";
        return `${sheetPrefix ?? ""}${columnAbsolute}${numberToColumn(translatedColumn)}${rowAbsolute}${translatedRow}`;
      });
  }).join("");
}

export function assertSafeFormula(input: string): string {
  const formula = input.startsWith("=") ? input.slice(1) : input;
  if (!formula.trim()) fail("INVALID_ARGUMENT", "Formula must not be empty.");
  const unsafe = [
    /\bWEBSERVICE\s*\(/i,
    /\bFILTERXML\s*\(/i,
    /\bRTD\s*\(/i,
    /(?:https?|ftp):\/\//i,
    /\[[^\]]+\][^!]*!/,
    /(?:^|[^A-Za-z0-9_])[^,;()]+\|[^!]+!/, // DDE-style server|topic!item
  ];
  if (unsafe.some((pattern) => pattern.test(formula))) {
    fail("UNSUPPORTED_FEATURE", "Formula contains an external-data or DDE construct that the safe backend will not store.");
  }
  return formula;
}
