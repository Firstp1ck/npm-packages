export type SafetyGuardCategory = "git" | "filesystem" | "docker" | "package" | "system" | "database" | "secrets";

export type SafetyGuardThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type SafetyGuardConfig = {
  version: 1;
  enabled: boolean;
  categories: Record<SafetyGuardCategory, boolean>;
  protectedPaths: {
    write: boolean;
    edit: boolean;
  };
  contextLines: {
    before: number;
    after: number;
  };
  autoReview: {
    enabled: boolean;
    model: {
      provider: string;
      modelId: string;
      thinkingLevel: SafetyGuardThinkingLevel;
    };
  };
};

export type SafetyGuardConfigPatch = Partial<Omit<SafetyGuardConfig, "categories" | "protectedPaths" | "contextLines" | "autoReview">> & {
  categories?: Partial<SafetyGuardConfig["categories"]>;
  protectedPaths?: Partial<SafetyGuardConfig["protectedPaths"]>;
  contextLines?: Partial<SafetyGuardConfig["contextLines"]>;
  autoReview?: Partial<Omit<SafetyGuardConfig["autoReview"], "model">> & {
    model?: Partial<SafetyGuardConfig["autoReview"]["model"]>;
  };
};

export const SAFETY_GUARD_CONFIG_VERSION: 1;
export const SAFETY_GUARD_CATEGORIES: readonly SafetyGuardCategory[];
export const SAFETY_GUARD_CONTEXT_LINES_MIN: number;
export const SAFETY_GUARD_CONTEXT_LINES_MAX: number;
export const SAFETY_GUARD_CONTEXT_LINES_DEFAULT: number;
export const SAFETY_GUARD_THINKING_LEVELS: readonly SafetyGuardThinkingLevel[];

export function defaultSafetyGuardConfig(): SafetyGuardConfig;
export function normalizeSafetyGuardConfig(value: unknown): SafetyGuardConfig;
export function mergeSafetyGuardConfig(current: unknown, patch: SafetyGuardConfigPatch): SafetyGuardConfig;
export function assertSafetyGuardConfigPatch(value: unknown): asserts value is SafetyGuardConfigPatch;
export function safetyGuardConfigFile(env?: Record<string, string | undefined>): string;
export function readSafetyGuardConfig(storageFile?: string): SafetyGuardConfig;
export function writeSafetyGuardConfig(patch: SafetyGuardConfigPatch, storageFile?: string): SafetyGuardConfig;
export function safetyGuardConfigSummary(value: unknown): string;
