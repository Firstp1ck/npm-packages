export type ProviderUsageSource = "openai-codex" | "anthropic";

export type ProviderUsageHeaders = Readonly<Record<string, string | undefined>>;

export type ProviderUsageWindow = {
  /** Compact truthful label derived from provider metadata (for example 5h or weekly). */
  label: string;
  usedPercent: number;
  /** Provider-reported duration, when available. */
  windowMinutes?: number;
  /** Absolute reset time, normalized to Unix milliseconds. */
  resetAt?: number;
  /** Relative reset time when a provider supplies no usable absolute time. */
  resetAfterSeconds?: number;
};

export type ProviderUsageSnapshot = {
  provider: ProviderUsageSource;
  primary?: ProviderUsageWindow;
  secondary?: ProviderUsageWindow;
  plan?: string;
};

function parseFiniteNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function parsePercent(raw: string | undefined, scale: number): number | undefined {
  const value = parseFiniteNumber(raw);
  if (value === undefined || value < 0 || value > scale) return undefined;
  return (value * 100) / scale;
}

function parseNonNegativeNumber(raw: string | undefined): number | undefined {
  const value = parseFiniteNumber(raw);
  return value !== undefined && value >= 0 ? value : undefined;
}

function parseResetAt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    if (numeric < 0) return undefined;
    // Provider reset epochs are normally seconds, but tolerate milliseconds.
    return numeric < 100_000_000_000 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalText(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value ? value : undefined;
}

function parseWindowMinutes(raw: string | undefined): number | undefined {
  const value = parseFiniteNumber(raw);
  return value !== undefined && value > 0 ? value : undefined;
}

function formatCodexWindowLabel(windowMinutes: number | undefined, fallback: "primary" | "secondary"): string {
  if (windowMinutes === undefined) return fallback;
  if (windowMinutes === 300) return "5h";
  if (windowMinutes === 1_440) return "daily";
  if (windowMinutes === 10_080) return "weekly";
  if (windowMinutes === 43_200) return "monthly";
  if (windowMinutes === 525_600) return "annual";
  if (Number.isInteger(windowMinutes / 1_440)) return `${windowMinutes / 1_440}d`;
  if (Number.isInteger(windowMinutes / 60)) return `${windowMinutes / 60}h`;
  return `${windowMinutes}m`;
}

/** Parse Codex subscription usage from normalized response headers. */
export function parseCodexProviderUsage(headers: ProviderUsageHeaders): ProviderUsageSnapshot | undefined {
  const primaryPercent = parsePercent(headers["x-codex-primary-used-percent"], 100);
  const secondaryPercent = parsePercent(headers["x-codex-secondary-used-percent"], 100);
  if (primaryPercent === undefined && secondaryPercent === undefined) return undefined;

  const primaryWindowMinutes = parseWindowMinutes(headers["x-codex-primary-window-minutes"]);
  const secondaryWindowMinutes = parseWindowMinutes(headers["x-codex-secondary-window-minutes"]);
  const primaryResetAt = parseResetAt(headers["x-codex-primary-reset-at"]);
  const primaryResetAfterSeconds = parseNonNegativeNumber(headers["x-codex-primary-reset-after-seconds"]);
  const secondaryResetAt = parseResetAt(headers["x-codex-secondary-reset-at"]);
  const secondaryResetAfterSeconds = parseNonNegativeNumber(headers["x-codex-secondary-reset-after-seconds"]);
  const plan = optionalText(headers["x-codex-plan-type"]);

  return {
    provider: "openai-codex",
    ...(primaryPercent !== undefined
      ? {
          primary: {
            label: formatCodexWindowLabel(primaryWindowMinutes, "primary"),
            usedPercent: primaryPercent,
            ...(primaryWindowMinutes !== undefined ? { windowMinutes: primaryWindowMinutes } : {}),
            ...(primaryResetAt !== undefined ? { resetAt: primaryResetAt } : {}),
            ...(primaryResetAfterSeconds !== undefined ? { resetAfterSeconds: primaryResetAfterSeconds } : {}),
          },
        }
      : {}),
    ...(secondaryPercent !== undefined
      ? {
          secondary: {
            label: formatCodexWindowLabel(secondaryWindowMinutes, "secondary"),
            usedPercent: secondaryPercent,
            ...(secondaryWindowMinutes !== undefined ? { windowMinutes: secondaryWindowMinutes } : {}),
            ...(secondaryResetAt !== undefined ? { resetAt: secondaryResetAt } : {}),
            ...(secondaryResetAfterSeconds !== undefined ? { resetAfterSeconds: secondaryResetAfterSeconds } : {}),
          },
        }
      : {}),
    ...(plan !== undefined ? { plan } : {}),
  };
}

/** Parse Anthropic subscription usage from normalized response headers. */
export function parseAnthropicProviderUsage(headers: ProviderUsageHeaders): ProviderUsageSnapshot | undefined {
  const fiveHourPercent = parsePercent(headers["anthropic-ratelimit-unified-5h-utilization"], 1);
  const sevenDayPercent = parsePercent(headers["anthropic-ratelimit-unified-7d-utilization"], 1);
  if (fiveHourPercent === undefined || sevenDayPercent === undefined) return undefined;

  const fiveHourResetAt = parseResetAt(headers["anthropic-ratelimit-unified-5h-reset"]);
  const sevenDayResetAt = parseResetAt(headers["anthropic-ratelimit-unified-7d-reset"]);

  return {
    provider: "anthropic",
    primary: {
      label: "5h",
      usedPercent: fiveHourPercent,
      windowMinutes: 300,
      ...(fiveHourResetAt !== undefined ? { resetAt: fiveHourResetAt } : {}),
    },
    secondary: {
      label: "7d",
      usedPercent: sevenDayPercent,
      windowMinutes: 10_080,
      ...(sevenDayResetAt !== undefined ? { resetAt: sevenDayResetAt } : {}),
    },
  };
}

function formatPercent(value: number): string {
  return String(Math.round(value));
}

export function providerUsageWindows(usage: ProviderUsageSnapshot): ProviderUsageWindow[] {
  return [usage.primary, usage.secondary].filter((window): window is ProviderUsageWindow => window !== undefined);
}

/** Format the compact footer value. Parsed windows always contain finite percentages. */
export function formatProviderUsage(usage: ProviderUsageSnapshot): string {
  return providerUsageWindows(usage)
    .map((window) => `${window.label} ${formatPercent(window.usedPercent)}%`)
    .join(" · ");
}
