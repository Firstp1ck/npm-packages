import { WorkflowCancelledError, WorkflowError } from "./errors.ts";
import { HARD_MAX_CONCURRENCY } from "./schema.ts";

export type WorkflowSchedulerSnapshot = {
  maxConcurrency: number;
  active: number;
  queued: number;
  pausedRuns: string[];
};

export type WorkflowScheduleOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  runId?: string;
  callId?: string;
};

type Waiter = {
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  runId?: string;
  onAbort?: () => void;
};

export class WorkflowAgentScheduler {
  readonly maxConcurrency: number;
  #active = 0;
  #waiters: Waiter[] = [];
  #pausedRuns = new Set<string>();

  constructor(maxConcurrency = HARD_MAX_CONCURRENCY) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > HARD_MAX_CONCURRENCY) {
      throw new RangeError(`scheduler maxConcurrency must be between 1 and ${HARD_MAX_CONCURRENCY}.`);
    }
    this.maxConcurrency = maxConcurrency;
  }

  snapshot(): WorkflowSchedulerSnapshot {
    return { maxConcurrency: this.maxConcurrency, active: this.#active, queued: this.#waiters.length, pausedRuns: [...this.#pausedRuns].sort() };
  }

  pauseRun(runId: string): boolean {
    if (!runId.trim()) throw new RangeError("runId must be non-empty.");
    const changed = !this.#pausedRuns.has(runId);
    this.#pausedRuns.add(runId);
    return changed;
  }

  resumeRun(runId: string): boolean {
    const changed = this.#pausedRuns.delete(runId);
    if (changed) this.#drain();
    return changed;
  }

  isRunPaused(runId: string): boolean {
    return this.#pausedRuns.has(runId);
  }

  async #acquire(signal?: AbortSignal, runId?: string): Promise<() => void> {
    if (signal?.aborted) throw signal.reason ?? new WorkflowCancelledError();
    if (this.#active < this.maxConcurrency && !(runId && this.#pausedRuns.has(runId))) return this.#grant();

    return await new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal, runId };
      waiter.onAbort = () => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        reject(signal?.reason ?? new WorkflowCancelledError());
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      this.#waiters.push(waiter);
    });
  }

  #grant(): () => void {
    this.#active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active--;
      this.#drain();
    };
  }

  #drain(): void {
    while (this.#active < this.maxConcurrency && this.#waiters.length > 0) {
      const index = this.#waiters.findIndex((candidate) => !(candidate.runId && this.#pausedRuns.has(candidate.runId)));
      if (index < 0) return;
      const [waiter] = this.#waiters.splice(index, 1);
      waiter.signal?.removeEventListener("abort", waiter.onAbort as EventListener);
      if (waiter.signal?.aborted) {
        waiter.reject(waiter.signal.reason ?? new WorkflowCancelledError());
        continue;
      }
      waiter.resolve(this.#grant());
    }
  }

  async schedule<T>(options: WorkflowScheduleOptions, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const parentAbort = () => controller.abort(options.signal?.reason ?? new WorkflowCancelledError());
    if (options.signal?.aborted) parentAbort();
    else options.signal?.addEventListener("abort", parentAbort, { once: true });

    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs !== undefined) {
      if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) throw new RangeError("scheduled timeoutMs must be a positive integer.");
      timeout = setTimeout(() => {
        const identity = options.callId ? ` for ${options.callId}` : "";
        controller.abort(new WorkflowError("timeout", `Agent timeout${identity} exceeded ${options.timeoutMs}ms.`));
      }, options.timeoutMs);
    }

    let release: (() => void) | undefined;
    try {
      release = await this.#acquire(controller.signal, options.runId);
      if (controller.signal.aborted) throw controller.signal.reason ?? new WorkflowCancelledError();
      const result = await work(controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason ?? new WorkflowCancelledError();
      return result;
    } finally {
      release?.();
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", parentAbort);
    }
  }
}

export const globalWorkflowAgentScheduler = new WorkflowAgentScheduler();
