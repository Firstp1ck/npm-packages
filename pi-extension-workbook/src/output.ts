import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { WorkbookLimits } from "./core/limits.ts";
import { DEFAULT_LIMITS } from "./core/limits.ts";

export type TextToolResult<T = unknown> = {
  content: Array<{ type: "text"; text: string }>;
  details: T;
};

function compactSummary(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { type: typeof payload };
  const source = payload as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of ["sourcePath", "outputPath", "beforePath", "afterPath", "sourceSha256", "outputSha256", "beforeSha256", "afterSha256", "engine", "ok", "equal", "dryRun"]) {
    if (source[key] !== undefined) summary[key] = source[key];
  }
  for (const [key, value] of Object.entries(source)) if (Array.isArray(value)) summary[`${key}Count`] = value.length;
  return summary;
}

export async function boundedJsonResult(payload: unknown, label: string, maxChars = DEFAULT_LIMITS.maxVisibleOutputChars): Promise<TextToolResult<Record<string, unknown>>> {
  const json = JSON.stringify(payload, null, 2);
  if (json.length <= maxChars) return { content: [{ type: "text", text: json }], details: payload as Record<string, unknown> };
  const outputDir = path.join(os.tmpdir(), "pi-workbook-results", randomUUID());
  await fs.mkdir(outputDir, { recursive: true });
  const artifactPath = path.join(outputDir, `${label.replace(/[^A-Za-z0-9._-]+/g, "-")}.json`);
  await fs.writeFile(artifactPath, `${json}\n`, "utf8");
  const summary = compactSummary(payload);
  const text = JSON.stringify({ ...summary, truncated: true, artifactPath, omittedCharacters: json.length - maxChars }, null, 2);
  return { content: [{ type: "text", text }], details: { ...summary, truncated: true, artifactPath, fullOutputBytes: Buffer.byteLength(json) } };
}

export function renderImageResult(payload: Record<string, unknown> & { png: Uint8Array; outputPath: string }): {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  details: Record<string, unknown>;
} {
  const { png, ...details } = payload;
  const lines = [
    `Rendered workbook range with ${String(details.renderer)}: ${String(details.sourcePath)}`,
    `Sheet/range: ${String(details.sheet)}!${String(details.range)}`,
    `Image: ${details.width}x${details.height}`,
    `Saved PNG: ${details.outputPath}`,
  ];
  const warnings = Array.isArray(details.warnings) ? details.warnings : [];
  if (warnings.length) lines.push("Warnings:", ...warnings.slice(0, 10).map((warning) => `- ${String(warning)}`));
  return {
    content: [
      { type: "text", text: lines.join("\n") },
      { type: "image", mimeType: "image/png", data: Buffer.from(png).toString("base64") },
    ],
    details,
  };
}

export function visibleLimitFrom(input: { limits?: Partial<WorkbookLimits> }): number {
  return input.limits?.maxVisibleOutputChars ?? DEFAULT_LIMITS.maxVisibleOutputChars;
}
