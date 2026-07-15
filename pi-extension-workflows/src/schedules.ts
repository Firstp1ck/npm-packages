import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAgentDir } from "@firstpick/pi-utils/paths";
import { WorkflowValidationError } from "./errors.ts";

export type WorkflowScheduleV1 = {
  schemaVersion: 1;
  scheduleId: string;
  workflowName: string;
  args: Record<string, unknown>;
  nextRunAt: string;
  intervalMs?: number;
  enabled: boolean;
  lastRunAt?: string;
};

function validateSchedule(value: unknown): WorkflowScheduleV1 {
  const schedule = value as Partial<WorkflowScheduleV1> | null;
  const issues: string[] = [];
  if (!schedule || typeof schedule !== "object") issues.push("schedule must be an object.");
  else {
    if (schedule.schemaVersion !== 1) issues.push("schedule schemaVersion must be 1.");
    for (const key of ["scheduleId", "workflowName", "nextRunAt"] as const) if (typeof schedule[key] !== "string" || !schedule[key]) issues.push(`${key} must be non-empty.`);
    if (!schedule.args || typeof schedule.args !== "object" || Array.isArray(schedule.args)) issues.push("schedule args must be an object.");
    if (typeof schedule.nextRunAt === "string" && !Number.isFinite(Date.parse(schedule.nextRunAt))) issues.push("nextRunAt must be an ISO date-time.");
    if (schedule.intervalMs !== undefined && (!Number.isInteger(schedule.intervalMs) || schedule.intervalMs < 1000)) issues.push("intervalMs must be an integer >= 1000.");
    if (typeof schedule.enabled !== "boolean") issues.push("enabled must be boolean.");
  }
  if (issues.length) throw new WorkflowValidationError(issues);
  return value as WorkflowScheduleV1;
}

export class WorkflowScheduleStore {
  readonly filePath: string;
  #records = new Map<string, WorkflowScheduleV1>();

  constructor(agentDir = getAgentDir()) {
    this.filePath = path.join(agentDir, "workflow-schedules.json");
  }

  async load(): Promise<WorkflowScheduleV1[]> {
    try {
      const value = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!Array.isArray(value)) throw new WorkflowValidationError(["workflow schedule store must be an array."]);
      this.#records = new Map(value.map((item) => { const schedule = validateSchedule(item); return [schedule.scheduleId, schedule]; }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
    return this.list();
  }

  list(): WorkflowScheduleV1[] {
    return [...this.#records.values()].map((record) => structuredClone(record)).sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
  }

  due(at = new Date()): WorkflowScheduleV1[] {
    return this.list().filter((record) => record.enabled && Date.parse(record.nextRunAt) <= at.getTime());
  }

  async upsert(record: WorkflowScheduleV1): Promise<void> {
    this.#records.set(record.scheduleId, validateSchedule(record));
    await this.#persist();
  }

  async remove(scheduleId: string): Promise<boolean> {
    const changed = this.#records.delete(scheduleId);
    if (changed) await this.#persist();
    return changed;
  }

  async markLaunched(scheduleId: string, at = new Date()): Promise<void> {
    const record = this.#records.get(scheduleId);
    if (!record) throw new WorkflowValidationError([`unknown schedule '${scheduleId}'.`]);
    record.lastRunAt = at.toISOString();
    if (record.intervalMs) record.nextRunAt = new Date(at.getTime() + record.intervalMs).toISOString();
    else record.enabled = false;
    await this.#persist();
  }

  async #persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, `${JSON.stringify(this.list(), null, 2)}\n`, { mode: 0o600, flag: "wx" });
    try { await rename(temporary, this.filePath); } catch (error) { await rm(temporary, { force: true }); throw error; }
  }
}
