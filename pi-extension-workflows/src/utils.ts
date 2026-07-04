import { randomUUID } from "node:crypto";
import { formatDurationBetween } from "@firstpick/pi-utils/text";

export async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(Math.trunc(concurrency), items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;

  let firstError: unknown;
  const workers = new Array(limit).fill(null).map(async () => {
    while (!firstError) {
      const current = nextIndex++;
      if (current >= items.length) return;
      try {
        results[current] = await fn(items[current], current);
      } catch (error) {
        firstError ??= error;
        return;
      }
    }
  });

  await Promise.all(workers);
  if (firstError) throw firstError;
  return results;
}

export function createRunId(): string {
  if (typeof randomUUID === "function") return `workflow-${randomUUID()}`;
  return `workflow-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function interpolateTemplate(template: string, input: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => stringifyInputValue(resolveInputPath(input, key)));
}

function resolveInputPath(input: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let current: unknown = input;
  for (const part of parts) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function stringifyInputValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  const trimmed = raw?.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("workflow input must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function splitFirstToken(input: string): { token: string; rest: string } {
  const trimmed = input.trim();
  if (!trimmed) return { token: "", rest: "" };
  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  return { token: match?.[1] ?? "", rest: match?.[2] ?? "" };
}

export function formatDuration(startIso: string, endIso = new Date().toISOString()): string {
  return formatDurationBetween(startIso, endIso, { invalidFallback: "unknown" });
}

export function truncateText(text: string, maxBytes = 50 * 1024): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let truncated = text.slice(0, maxBytes);
  while (Buffer.byteLength(truncated, "utf8") > maxBytes) truncated = truncated.slice(0, -1);
  return `${truncated}\n\n[Output truncated to ${maxBytes} bytes.]`;
}
