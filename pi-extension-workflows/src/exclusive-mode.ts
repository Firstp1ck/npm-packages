export const EXCLUSIVE_MODE_EVENT = "firstpick:exclusive-mode:v1";
export const WORKFLOW_EXCLUSIVE_MODE_ID = "workflow";

export type ExclusiveModeEvent = {
  version: 1;
  mode: string;
  enabled: boolean;
  updatedAt: string;
};

export function isExclusiveModeEvent(value: unknown): value is ExclusiveModeEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const event = value as Partial<ExclusiveModeEvent>;
  return event.version === 1
    && typeof event.mode === "string"
    && event.mode.length > 0
    && typeof event.enabled === "boolean"
    && typeof event.updatedAt === "string";
}

export function exclusiveModeEvent(mode: string, enabled: boolean): ExclusiveModeEvent {
  return { version: 1, mode, enabled, updatedAt: new Date().toISOString() };
}
