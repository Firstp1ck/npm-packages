export {};

declare global {
  const args: unknown;

  type WorkflowAgentOptions = {
    label?: string;
    model?: string;
    tools?: string[];
    cwd?: string;
    schema?: unknown;
    timeoutMs?: number;
  };

  function agent<T = string>(prompt: string, options?: WorkflowAgentOptions): Promise<T>;
  function phase<T>(name: string, work: () => T | Promise<T>): Promise<T>;
  function parallel<T>(work: Array<(() => T | Promise<T>) | Promise<T> | T>, options?: { concurrency?: number }): Promise<T[]>;
  function pipeline<T, R>(items: T[], worker: (item: T, index: number) => R | Promise<R>, options?: { concurrency?: number; key?: (item: T, index: number) => string }): Promise<R[]>;
}
