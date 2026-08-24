export type SlugifyOptions = {
  maxLength?: number;
  fallback?: string;
};

export type TruncateOptions = {
  ellipsis?: string;
  collapseWhitespace?: boolean;
  trimEnd?: boolean;
};

export type TruncateResult = {
  text: string;
  truncated: boolean;
};

export type FormatBytesOptions = {
  binary?: boolean;
  precision?: number;
  trimTrailingZeros?: boolean;
};

export type FormatDurationOptions = {
  maxParts?: number;
  includeMsBelowSecond?: boolean;
  invalidFallback?: string;
};

export function slugify(input: string, options: SlugifyOptions = {}): string {
  const maxLength = options.maxLength ?? 80;
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
  return slug || options.fallback || "";
}

export function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function decodeXmlEntities(value: string): string {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function extractXmlTag(block: string, tag: string): string | undefined {
  const escapedTag = escapeRegExp(tag);
  const match = String(block).match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i"));
  const value = match?.[1]?.trim();
  return value ? decodeXmlEntities(value) : undefined;
}

export function stripHtml(html: string | undefined): string {
  return decodeXmlEntities(String(html ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function truncateWithFlag(value: unknown, maxChars: number, options: TruncateOptions = {}): TruncateResult {
  const ellipsis = options.ellipsis ?? "…";
  const limit = Math.max(0, Math.trunc(maxChars));
  let text = String(value ?? "");
  if (options.collapseWhitespace ?? true) text = text.replace(/\s+/g, " ").trim();
  if (limit === 0) return { text: "", truncated: text.length > 0 };
  if (text.length <= limit) return { text, truncated: false };
  const trimEnd = options.trimEnd ?? true;
  if (!ellipsis) {
    const sliced = text.slice(0, limit);
    return { text: trimEnd ? sliced.trimEnd() : sliced, truncated: true };
  }
  if (ellipsis.length >= limit) return { text: ellipsis.slice(0, limit), truncated: true };
  const sliced = text.slice(0, limit - ellipsis.length);
  return { text: `${trimEnd ? sliced.trimEnd() : sliced}${ellipsis}`, truncated: true };
}

export function truncate(value: unknown, maxChars: number, options: TruncateOptions = {}): string {
  return truncateWithFlag(value, maxChars, options).text;
}

export const truncateText = truncate;

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

export function pluralSuffix(count: number, suffix = "s"): string {
  return count === 1 ? "" : suffix;
}

export function capitalize(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "";
}

export function titleCaseFromSlug(slug: string): string {
  return String(slug).split(/[-_\s]+/).filter(Boolean).map(capitalize).join(" ");
}

export function stripQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === '"' && last === '"') || (first === "'" && last === "'") ? value.slice(1, -1) : value;
}

export function formatBytes(bytes: number, options: FormatBytesOptions = {}): string {
  const value = Number(bytes);
  if (!Number.isFinite(value)) return "0 B";
  const sign = value < 0 ? "-" : "";
  let size = Math.abs(value);
  const base = options.binary ? 1024 : 1000;
  const units = options.binary ? ["B", "KiB", "MiB", "GiB", "TiB"] : ["B", "KB", "MB", "GB", "TB"];
  let unit = 0;
  while (size >= base && unit < units.length - 1) {
    size /= base;
    unit += 1;
  }
  const precision = options.precision ?? (unit === 0 ? 0 : 1);
  let formatted = unit === 0 ? String(Math.round(size)) : size.toFixed(precision);
  if (options.trimTrailingZeros ?? true) formatted = formatted.replace(/\.0+$/, "");
  return `${sign}${formatted} ${units[unit]}`;
}

export function formatDuration(ms: number, options: FormatDurationOptions = {}): string {
  const value = Number(ms);
  if (!Number.isFinite(value)) return "0ms";
  const sign = value < 0 ? "-" : "";
  let remaining = Math.max(0, Math.round(Math.abs(value)));
  if (remaining < 1000 && (options.includeMsBelowSecond ?? true)) return `${sign}${remaining}ms`;

  const units: Array<[string, number]> = [
    ["d", 86_400_000],
    ["h", 3_600_000],
    ["m", 60_000],
    ["s", 1000],
  ];
  const parts: string[] = [];
  for (const [label, unitMs] of units) {
    const amount = Math.floor(remaining / unitMs);
    if (amount > 0 || parts.length > 0 || label === "s") {
      if (amount > 0 || label === "s") parts.push(`${amount}${label}`);
      remaining -= amount * unitMs;
    }
    if (parts.length >= (options.maxParts ?? 2)) break;
  }
  return `${sign}${parts.join(" ")}`;
}

export function formatDurationBetween(startIso: string, endIso = new Date().toISOString(), options: FormatDurationOptions = {}): string {
  const started = new Date(startIso).getTime();
  const ended = new Date(endIso).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return options.invalidFallback ?? "0ms";
  return formatDuration(ended - started, options);
}
