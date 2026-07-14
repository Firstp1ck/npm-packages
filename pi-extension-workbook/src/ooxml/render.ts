import { deflateSync } from "node:zlib";
import { crc32 } from "./zip.ts";
import { parseRange, numberToColumn } from "./cell-ref.ts";
import type { SheetReadResult, CellData } from "./workbook.ts";
import type { StyleDescriptor } from "./styles.ts";

const FONT: Record<string, string[]> = {
  " ": ["00000","00000","00000","00000","00000","00000","00000"],
  "?": ["01110","10001","00001","00010","00100","00000","00100"],
  "0": ["01110","10001","10011","10101","11001","10001","01110"], "1": ["00100","01100","00100","00100","00100","00100","01110"],
  "2": ["01110","10001","00001","00010","00100","01000","11111"], "3": ["11110","00001","00001","01110","00001","00001","11110"],
  "4": ["00010","00110","01010","10010","11111","00010","00010"], "5": ["11111","10000","10000","11110","00001","00001","11110"],
  "6": ["01110","10000","10000","11110","10001","10001","01110"], "7": ["11111","00001","00010","00100","01000","01000","01000"],
  "8": ["01110","10001","10001","01110","10001","10001","01110"], "9": ["01110","10001","10001","01111","00001","00001","01110"],
  "A": ["01110","10001","10001","11111","10001","10001","10001"], "B": ["11110","10001","10001","11110","10001","10001","11110"],
  "C": ["01111","10000","10000","10000","10000","10000","01111"], "D": ["11110","10001","10001","10001","10001","10001","11110"],
  "E": ["11111","10000","10000","11110","10000","10000","11111"], "F": ["11111","10000","10000","11110","10000","10000","10000"],
  "G": ["01111","10000","10000","10111","10001","10001","01111"], "H": ["10001","10001","10001","11111","10001","10001","10001"],
  "I": ["01110","00100","00100","00100","00100","00100","01110"], "J": ["00001","00001","00001","00001","10001","10001","01110"],
  "K": ["10001","10010","10100","11000","10100","10010","10001"], "L": ["10000","10000","10000","10000","10000","10000","11111"],
  "M": ["10001","11011","10101","10101","10001","10001","10001"], "N": ["10001","11001","10101","10011","10001","10001","10001"],
  "O": ["01110","10001","10001","10001","10001","10001","01110"], "P": ["11110","10001","10001","11110","10000","10000","10000"],
  "Q": ["01110","10001","10001","10001","10101","10010","01101"], "R": ["11110","10001","10001","11110","10100","10010","10001"],
  "S": ["01111","10000","10000","01110","00001","00001","11110"], "T": ["11111","00100","00100","00100","00100","00100","00100"],
  "U": ["10001","10001","10001","10001","10001","10001","01110"], "V": ["10001","10001","10001","10001","10001","01010","00100"],
  "W": ["10001","10001","10001","10101","10101","11011","10001"], "X": ["10001","10001","01010","00100","01010","10001","10001"],
  "Y": ["10001","10001","01010","00100","00100","00100","00100"], "Z": ["11111","00001","00010","00100","01000","10000","11111"],
  ".": ["00000","00000","00000","00000","00000","00110","00110"], ",": ["00000","00000","00000","00000","00110","00110","00100"],
  ":": ["00000","00110","00110","00000","00110","00110","00000"], ";": ["00000","00110","00110","00000","00110","00110","00100"],
  "-": ["00000","00000","00000","11111","00000","00000","00000"], "+": ["00000","00100","00100","11111","00100","00100","00000"],
  "=": ["00000","00000","11111","00000","11111","00000","00000"], "/": ["00001","00010","00100","01000","10000","00000","00000"],
  "_": ["00000","00000","00000","00000","00000","00000","11111"], "%": ["11001","11010","00100","01000","10110","00110","00000"],
  "@": ["01110","10001","10111","10101","10111","10000","01110"], "#": ["01010","11111","01010","01010","11111","01010","00000"],
  "(": ["00010","00100","01000","01000","01000","00100","00010"], ")": ["01000","00100","00010","00010","00010","00100","01000"],
};

type Rgb = [number, number, number];

function colorFromStyle(style: StyleDescriptor | undefined): Rgb {
  const foreground = style?.fill?.foreground as Record<string, string> | undefined;
  const rgb = foreground?.rgb;
  if (!rgb || !/^[A-Fa-f0-9]{8}$/.test(rgb)) return [255, 255, 255];
  return [Number.parseInt(rgb.slice(2, 4), 16), Number.parseInt(rgb.slice(4, 6), 16), Number.parseInt(rgb.slice(6, 8), 16)];
}

function setPixel(data: Uint8Array, width: number, height: number, x: number, y: number, color: Rgb): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * 4;
  data[offset] = color[0]; data[offset + 1] = color[1]; data[offset + 2] = color[2]; data[offset + 3] = 255;
}

function fillRect(data: Uint8Array, width: number, height: number, x: number, y: number, w: number, h: number, color: Rgb): void {
  for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx++) setPixel(data, width, height, xx, yy, color);
  }
}

function drawText(data: Uint8Array, width: number, height: number, x: number, y: number, text: string, color: Rgb, scale: number, maxWidth: number): void {
  let cursor = x;
  const pixel = Math.max(1, Math.round(scale));
  for (const character of text.toUpperCase()) {
    if (cursor + 6 * pixel > x + maxWidth) break;
    const glyph = FONT[character] ?? FONT["?"];
    for (let row = 0; row < 7; row++) {
      for (let column = 0; column < 5; column++) if (glyph[row][column] === "1") fillRect(data, width, height, cursor + column * pixel, y + row * pixel, pixel, pixel, color);
    }
    cursor += 6 * pixel;
  }
}

function pngChunk(name: string, payload: Uint8Array): Buffer {
  const type = Buffer.from(name, "ascii");
  const length = Buffer.alloc(4); length.writeUInt32BE(payload.byteLength);
  const body = Buffer.concat([type, Buffer.from(payload)]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row++) {
    const target = row * (width * 4 + 1);
    scanlines[target] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + row * width * 4, width * 4).copy(scanlines, target + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function displayCell(cell: CellData): string {
  if (cell.formula) return `=${cell.formula}`;
  if (cell.value === null) return "";
  return String(cell.value);
}

export function renderSheetRange(result: SheetReadResult, requestedScale = 1): { png: Buffer; width: number; height: number } {
  const scale = Math.max(0.5, Math.min(3, requestedScale));
  const bounds = parseRange(result.range);
  const rows = bounds.endRow - bounds.startRow + 1;
  const columns = bounds.endColumn - bounds.startColumn + 1;
  const rowHeader = Math.round(42 * scale);
  const columnHeader = Math.round(22 * scale);
  const cellWidth = Math.round(110 * scale);
  const cellHeight = Math.round(24 * scale);
  const width = Math.min(4096, rowHeader + columns * cellWidth + 1);
  const height = Math.min(4096, columnHeader + rows * cellHeight + 1);
  const data = new Uint8Array(width * height * 4);
  fillRect(data, width, height, 0, 0, width, height, [255, 255, 255]);
  fillRect(data, width, height, 0, 0, width, columnHeader, [235, 239, 244]);
  fillRect(data, width, height, 0, 0, rowHeader, height, [235, 239, 244]);

  const styles = new Map(result.styles.map((style) => [style.id, style]));
  const cellMap = new Map(result.cells.map((cell) => [`${cell.row}:${cell.column}`, cell]));
  const grid: Rgb = [198, 205, 214];
  const text: Rgb = [25, 31, 38];

  for (let columnOffset = 0; columnOffset < columns; columnOffset++) {
    const x = rowHeader + columnOffset * cellWidth;
    drawText(data, width, height, x + 4, 5, numberToColumn(bounds.startColumn + columnOffset), text, scale, cellWidth - 8);
  }
  for (let rowOffset = 0; rowOffset < rows; rowOffset++) {
    const y = columnHeader + rowOffset * cellHeight;
    drawText(data, width, height, 4, y + 6, String(bounds.startRow + rowOffset), text, scale, rowHeader - 8);
    for (let columnOffset = 0; columnOffset < columns; columnOffset++) {
      const x = rowHeader + columnOffset * cellWidth;
      const cell = cellMap.get(`${bounds.startRow + rowOffset}:${bounds.startColumn + columnOffset}`);
      if (cell) fillRect(data, width, height, x + 1, y + 1, cellWidth - 1, cellHeight - 1, colorFromStyle(styles.get(cell.styleId)));
      if (cell) drawText(data, width, height, x + 4, y + 6, displayCell(cell), text, scale, cellWidth - 8);
    }
  }
  for (let column = 0; column <= columns; column++) fillRect(data, width, height, rowHeader + column * cellWidth, columnHeader, 1, rows * cellHeight + 1, grid);
  for (let row = 0; row <= rows; row++) fillRect(data, width, height, rowHeader, columnHeader + row * cellHeight, columns * cellWidth + 1, 1, grid);
  fillRect(data, width, height, rowHeader - 1, 0, 1, height, grid);
  fillRect(data, width, height, 0, columnHeader - 1, width, 1, grid);
  return { png: encodePng(width, height, data), width, height };
}
