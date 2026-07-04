import * as fs from "node:fs";
import { resolve } from "node:path";
import type { InitialPromptCalibration, InitialPromptInputEstimate } from "./tokens.ts";

export const INITIAL_PROMPT_CALIBRATION_CUSTOM_TYPE = "stats_initial_prompt_estimate";

export type InitialPromptCalibrationSample = {
  ratio: number;
  timestamp: string;
};

export type InitialPromptCalibrationRecord = {
  version: 1;
  ratio: number;
  estimatedUncalibratedTokens: number;
  estimatedFinalTokens: number;
  actualInitialInputTokens: number;
  actualInjectedTokens: number;
  firstUserTokens: number;
  provider: string;
  model: string;
  createdAt: string;
};

type AppendEntryLike = <T = unknown>(customType: string, data?: T) => void;

function listSessionFiles(sessionDir: string): string[] {
  try {
    return fs
      .readdirSync(sessionDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => resolve(sessionDir, entry.name));
  } catch {
    return [];
  }
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower] ?? 1;
  const weight = pos - lower;
  return (sorted[lower] ?? 1) * (1 - weight) + (sorted[upper] ?? 1) * weight;
}

export function collectInitialPromptCalibrationSamples(sessionDir: string, maxSamples = 100): InitialPromptCalibrationSample[] {
  const samples: InitialPromptCalibrationSample[] = [];

  for (const file of listSessionFiles(sessionDir)) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry?.type !== "custom" || entry?.customType !== INITIAL_PROMPT_CALIBRATION_CUSTOM_TYPE) continue;
        const ratio = Number(entry?.data?.ratio);
        if (!Number.isFinite(ratio) || ratio <= 0.25 || ratio >= 4) continue;
        samples.push({ ratio, timestamp: String(entry?.timestamp ?? entry?.data?.createdAt ?? "") });
      } catch {
        continue;
      }
    }
  }

  return samples.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-maxSamples);
}

export function collectInitialPromptCalibration(sessionDir: string, maxSamples = 100): InitialPromptCalibration | null {
  const ratios = collectInitialPromptCalibrationSamples(sessionDir, maxSamples).map((sample) => sample.ratio);
  if (ratios.length === 0) return null;

  const median = quantile(ratios, 0.5);
  const q25 = quantile(ratios, 0.25);
  const q75 = quantile(ratios, 0.75);
  return {
    multiplier: median,
    lowMultiplier: Math.min(q25, median * 0.95),
    highMultiplier: Math.max(q75, median * 1.05),
    samples: ratios.length,
  };
}

export function buildInitialPromptCalibrationRecord(args: {
  estimate: InitialPromptInputEstimate;
  actualInitialInputTokens: number;
  firstUserTokens: number;
  provider: string;
  model: string;
  createdAt?: string;
}): InitialPromptCalibrationRecord | null {
  const actualInjectedTokens = Math.max(0, args.actualInitialInputTokens - args.firstUserTokens);
  const ratio = args.estimate.uncalibratedTotal > 0 ? actualInjectedTokens / args.estimate.uncalibratedTotal : 0;
  if (!Number.isFinite(ratio) || ratio <= 0.25 || ratio >= 4) return null;

  return {
    version: 1,
    ratio,
    estimatedUncalibratedTokens: args.estimate.uncalibratedTotal,
    estimatedFinalTokens: args.estimate.total,
    actualInitialInputTokens: args.actualInitialInputTokens,
    actualInjectedTokens,
    firstUserTokens: args.firstUserTokens,
    provider: args.provider,
    model: args.model,
    createdAt: args.createdAt ?? new Date().toISOString(),
  };
}

export function appendInitialPromptCalibrationRecord(appendEntry: AppendEntryLike, record: InitialPromptCalibrationRecord): boolean {
  try {
    appendEntry(INITIAL_PROMPT_CALIBRATION_CUSTOM_TYPE, record);
    return true;
  } catch {
    return false;
  }
}
