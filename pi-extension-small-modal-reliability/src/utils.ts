import { createHash } from "node:crypto";
import { readJsonSafe, stripAnsi as stripAnsiBase, truncate as truncateBase, writeJsonFile as writeJsonFileBase } from "@firstpick/pi-utils";
import { redactSensitiveText } from "./redaction.ts";

export function nowIso(): string {
  return new Date().toISOString();
}

export function readJsonFile<T>(filePath: string): T | undefined {
  return readJsonSafe<T | undefined>(filePath, undefined);
}

export function writeJsonFile(filePath: string, value: unknown, mode = 0o600): void {
  writeJsonFileBase(filePath, value, { mode });
}

export function sanitizeText(value: string): string {
  return redactSensitiveText(value);
}

export function truncate(value: string, maxChars: number): string {
  const clean = sanitizeText(value.replace(/\s+/g, " ").trim());
  return truncateBase(clean, maxChars, { collapseWhitespace: false });
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function hashToolCall(tool: string, input: unknown): string {
  return createHash("sha256").update(`${tool}:${stableStringify(input)}`).digest("hex").slice(0, 16);
}

export function pushBounded<T>(items: T[], item: T | undefined, limit: number): void {
  if (item === undefined || item === null) return;
  if (typeof item === "string" && item.trim().length === 0) return;
  items.push(item);
  if (items.length > limit) items.splice(0, items.length - limit);
}

export function addUniqueBounded(items: string[], item: string | undefined, limit: number): void {
  const clean = item?.trim();
  if (!clean) return;
  const existing = items.findIndex((candidate) => candidate === clean);
  if (existing >= 0) items.splice(existing, 1);
  items.push(clean);
  if (items.length > limit) items.splice(0, items.length - limit);
}

export function firstLines(text: string, limit = 6): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, limit);
}

export function stripAnsi(value: string): string {
  return stripAnsiBase(value);
}

export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => {
    if (typeof block === "string") return block;
    if (!block || typeof block !== "object") return "";
    const record = block as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") return record.text;
    if (record.type === "image") return "[image]";
    return "";
  }).filter(Boolean).join("\n");
}

export function assistantText(message: unknown): string {
  const record = message && typeof message === "object" ? message as Record<string, unknown> : {};
  return contentToText(record.content);
}

export function assistantHasToolCall(message: unknown): boolean {
  const record = message && typeof message === "object" ? message as Record<string, unknown> : {};
  return Array.isArray(record.content) && record.content.some((block) => {
    const part = block && typeof block === "object" ? block as Record<string, unknown> : {};
    return part.type === "toolCall";
  });
}
