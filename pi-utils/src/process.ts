import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export const ANSI_ESCAPE_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

export type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number;
  signal?: NodeJS.Signals | null;
  error?: string;
  timedOut?: boolean;
};

export type RunCommandOptions = {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  maxStdoutChars?: number;
  maxStderrChars?: number;
};

export type AbortableProcess = ChildProcessByStdio<null, Readable, Readable> & {
  abortProcessGroup?: () => void;
  abortReleaseStep?: () => void;
};

export type DetachableChildProcess = {
  stdout: Readable & { unref?: () => void };
  stderr: Readable & { unref?: () => void };
  unref: () => void;
};

export type ProcessTreeTarget = {
  pid?: number | null;
  kill?: (signal?: NodeJS.Signals | number) => boolean;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
};

export type KillTarget = number | {
  pid?: number | null;
  kill?: (signal?: NodeJS.Signals) => boolean;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
};

export type KillGracefullyOptions = {
  termSignal?: NodeJS.Signals;
  killSignal?: NodeJS.Signals;
  killAfterMs?: number;
  processGroup?: boolean;
};

export type ReadLinesOptions = {
  encoding?: BufferEncoding;
  emitFinalEmptyLine?: boolean;
};

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE_RE, "");
}

export function resolveExecutableFromPath(binName: string, envPath = process.env.PATH ?? ""): string | undefined {
  const candidates = os.platform() === "win32" && !binName.toLowerCase().endsWith(".exe") ? [binName, `${binName}.exe`] : [binName];
  for (const dir of envPath.split(path.delimiter).filter(Boolean)) {
    for (const name of candidates) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

export async function commandExists(command: string, args: string[] = ["--version"], timeoutMs = 3000): Promise<boolean> {
  const result = await runCommand(command, args, { timeoutMs });
  return result.ok;
}

function killTargetPid(target: KillTarget): number | undefined {
  return typeof target === "number" ? target : typeof target.pid === "number" ? target.pid : undefined;
}

function signalKillTarget(target: KillTarget, signal: NodeJS.Signals, processGroup: boolean): boolean {
  const pid = killTargetPid(target);
  if (processGroup && pid && pid > 0) {
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      // Fall through to direct child/PID signaling below.
    }
  }
  try {
    if (typeof target === "number") {
      process.kill(target, signal);
      return true;
    }
    return target.kill?.(signal) ?? false;
  } catch {
    return false;
  }
}

export function detachChildProcess(child: DetachableChildProcess): void {
  child.stdout.removeAllListeners("data");
  child.stderr.removeAllListeners("data");
  child.stdout.unref?.();
  child.stderr.unref?.();
  child.unref();
}

export function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid === 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function killTargetStillRunning(target: KillTarget, processGroup: boolean): boolean {
  if (typeof target !== "number" && (target.exitCode !== null && target.exitCode !== undefined || target.signalCode !== null && target.signalCode !== undefined)) return false;
  const pid = killTargetPid(target);
  if (!pid || pid === 0) return false;
  return isProcessRunning(processGroup && pid > 0 ? -pid : pid);
}

export function killGracefully(target: KillTarget, options: KillGracefullyOptions = {}): boolean {
  const termSignal = options.termSignal ?? "SIGTERM";
  const killSignal = options.killSignal ?? "SIGKILL";
  const killAfterMs = options.killAfterMs ?? 5000;
  const processGroup = options.processGroup ?? false;
  const signaled = signalKillTarget(target, termSignal, processGroup);
  if (killAfterMs > 0) {
    setTimeout(() => {
      if (killTargetStillRunning(target, processGroup)) signalKillTarget(target, killSignal, processGroup);
    }, killAfterMs).unref?.();
  }
  return signaled;
}

export function terminateChildProcess(child: AbortableProcess, options: KillGracefullyOptions = {}): boolean {
  const signaled = killGracefully(child, { ...options, killAfterMs: options.killAfterMs ?? 2000 });
  child.stdout.destroy();
  child.stderr.destroy();
  return signaled;
}

const WINDOWS_TREE_KILL_TIMEOUT_MS = 5_000;

/** Terminate a detached POSIX process group or a complete Windows process tree. */
export function terminateProcessTree(target: ProcessTreeTarget, signal: NodeJS.Signals = "SIGTERM"): boolean {
  if (target.exitCode !== null && target.exitCode !== undefined || target.signalCode !== null && target.signalCode !== undefined) return false;
  const pid = Number(target.pid);

  if (process.platform === "win32" && Number.isInteger(pid) && pid > 0) {
    try {
      const windowsRoot = process.env.SystemRoot || process.env.WINDIR;
      const command = windowsRoot ? path.join(windowsRoot, "System32", "taskkill.exe") : "taskkill.exe";
      const result = spawnSync(command, ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
        timeout: WINDOWS_TREE_KILL_TIMEOUT_MS,
      });
      if (!result.error && result.status === 0) return true;
    } catch {
      // Fall back to direct-child termination below.
    }
    try { return target.kill?.("SIGKILL") ?? false; } catch { return false; }
  }

  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      // Fall back when the child is not a process-group leader.
    }
  }
  try { return target.kill?.(signal) ?? false; } catch { return false; }
}

export async function readLines(stream: AsyncIterable<Buffer | string>, onLine: (line: string) => void | Promise<void>, options: ReadLinesOptions = {}): Promise<void> {
  const encoding = options.encoding ?? "utf8";
  let buffer = "";
  for await (const chunk of stream) {
    buffer += typeof chunk === "string" ? chunk : chunk.toString(encoding);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) await onLine(line);
  }
  if (buffer || options.emitFinalEmptyLine) await onLine(buffer);
}

function trimBuffer(value: string, maxChars: number | undefined): string {
  if (!maxChars || value.length <= maxChars) return value;
  return value.slice(-maxChars);
}

export function runCommand(command: string, args: string[] = [], options: RunCommandOptions = {}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = execFile(command, args, { cwd: options.cwd, env: options.env, timeout: options.timeoutMs }, (error, stdout, stderr) => {
      const exitCode = error && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
      resolve({
        ok: !error,
        stdout: trimBuffer(String(stdout ?? ""), options.maxStdoutChars),
        stderr: trimBuffer(String(stderr ?? ""), options.maxStderrChars),
        exitCode,
        signal: error && "signal" in error ? (error.signal as NodeJS.Signals | null) : null,
        error: error instanceof Error ? error.message : undefined,
        timedOut: error && "killed" in error ? Boolean(error.killed) : false,
      });
    });
    child.on("error", (error) => {
      resolve({ ok: false, stdout: "", stderr: "", error: error.message, exitCode: 1 });
    });
  });
}

export function runShellCommand(cwd: string, command: string, options: RunCommandOptions = {}): Promise<CommandResult> {
  return runCommand("bash", ["-lc", command], { ...options, cwd });
}

export function runLiveShellCommand(args: {
  cwd: string;
  command: string;
  onChunk: (chunk: string) => void;
  onChild?: (child: AbortableProcess) => void;
  timeoutMs?: number;
  detached?: boolean;
}): Promise<CommandResult & { output: string; aborted: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", args.command], {
      cwd: args.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: args.detached ?? true,
    }) as AbortableProcess;
    let output = "";
    let aborted = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const abort = () => {
      aborted = true;
      try {
        if (child.pid && child.pid > 0) process.kill(-child.pid, "SIGINT");
      } catch {
        child.kill("SIGINT");
      }
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            if (child.pid && child.pid > 0) process.kill(-child.pid, "SIGTERM");
          } catch {
            child.kill("SIGTERM");
          }
        }
      }, 1500).unref();
    };
    child.abortProcessGroup = abort;
    child.abortReleaseStep = abort;

    const finish = (result: CommandResult & { output: string; aborted: boolean }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    if (args.timeoutMs && args.timeoutMs > 0) {
      timer = setTimeout(() => {
        abort();
        finish({ ok: false, stdout: output, stderr: "", output, aborted: true, timedOut: true });
      }, args.timeoutMs);
    }

    args.onChild?.(child);
    child.stdout.on("data", (d) => {
      const chunk = String(d);
      output += chunk;
      args.onChunk(chunk);
    });
    child.stderr.on("data", (d) => {
      const chunk = String(d);
      output += chunk;
      args.onChunk(chunk);
    });
    child.on("error", (error) => finish({ ok: false, stdout: output, stderr: error.message, output, aborted, error: error.message }));
    child.on("close", (code, signal) => finish({ ok: code === 0 && !aborted, stdout: output, stderr: "", output, aborted, exitCode: code ?? undefined, signal }));
  });
}
