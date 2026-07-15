import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPathInside } from "@firstpick/pi-utils/paths";
import { DEFAULT_ALLOWED_TOOLS } from "./schema.ts";
import type { TaskContext, TaskResult, TaskRunner, WorkflowSubprocessEvent, WorkflowTask, WorkflowUsage } from "./types.ts";
import { truncateText } from "./utils.ts";

const DEFAULT_OUTPUT_CAP_BYTES = 50 * 1024;
const POLICY_GUARD_PATH = fileURLToPath(new URL("./subprocess-policy-guard.ts", import.meta.url));

type GenericMessage = {
  role?: string;
  content?: unknown;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
    cost?: { total?: number } | number;
  };
  stopReason?: string;
  errorMessage?: string;
  model?: string;
};

type SubprocessTaskRunnerOptions = {
  defaultTools?: string[];
  outputCapBytes?: number;
  terminationGraceMs?: number;
  invocation?: { command: string; argsPrefix?: string[] };
};

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) return { command: process.execPath, args };
  return { command: "pi", args };
}

function textFromMessage(message: GenericMessage): string {
  const parts = Array.isArray(message.content) ? message.content : [];
  const text: string[] = [];
  for (const part of parts) {
    if (typeof part === "object" && part !== null && (part as { type?: string }).type === "text") {
      const value = (part as { text?: unknown }).text;
      if (typeof value === "string" && value.trim()) text.push(value);
    }
  }
  return text.join("\n\n");
}

function addUsage(target: WorkflowUsage, message: GenericMessage): void {
  const usage = message.usage;
  if (!usage) return;
  target.input = (target.input ?? 0) + (usage.input ?? 0);
  target.output = (target.output ?? 0) + (usage.output ?? 0);
  target.cacheRead = (target.cacheRead ?? 0) + (usage.cacheRead ?? 0);
  target.cacheWrite = (target.cacheWrite ?? 0) + (usage.cacheWrite ?? 0);
  target.contextTokens = usage.totalTokens ?? target.contextTokens;
  if (typeof usage.cost === "number") target.cost = (target.cost ?? 0) + usage.cost;
  else target.cost = (target.cost ?? 0) + (usage.cost?.total ?? 0);
  target.turns = (target.turns ?? 0) + 1;
}

function safeTools(task: WorkflowTask, defaults: string[], context: TaskContext): string[] {
  const policyTools = context.agentPolicy?.allowedTools ?? [...DEFAULT_ALLOWED_TOOLS];
  const allowed = new Set(policyTools);
  const requested = task.tools && task.tools.length > 0 ? task.tools : defaults;
  return [...new Set(requested)].filter((tool) => allowed.has(tool));
}

function shellDisplayPart(part: string): string {
  return /^[A-Za-z0-9_/@%+=:,.-]+$/.test(part) ? part : JSON.stringify(part);
}

function formatInvocationForDisplay(command: string, args: string[]): string {
  return [command, ...args].map(shellDisplayPart).join(" ");
}

function emitSubprocessEvent(
  context: TaskContext,
  task: WorkflowTask,
  type: WorkflowSubprocessEvent["type"],
  fields: Partial<Omit<WorkflowSubprocessEvent, "type" | "timestamp" | "phaseId" | "phaseName" | "taskId" | "taskName">> = {},
): void {
  context.onSubprocessEvent?.({
    type,
    timestamp: new Date().toISOString(),
    phaseId: context.phase.id,
    phaseName: context.phase.name,
    taskId: task.id,
    taskName: task.name,
    ...fields,
  });
}

function contentText(content: unknown): string {
  const parts = Array.isArray(content) ? content : [];
  const text: string[] = [];
  for (const part of parts) {
    if (typeof part === "object" && part !== null && (part as { type?: string }).type === "text") {
      const value = (part as { text?: unknown }).text;
      if (typeof value === "string" && value.trim()) text.push(value);
    }
  }
  return text.join("\n\n");
}

function compactLine(value: unknown, maxLength = 520): string {
  const line = String(value ?? "").replace(/\s+/g, " ").trim();
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}

function summarizeTextLines(label: string, text: string, maxLines = 12): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim()).slice(0, maxLines);
  return lines.map((line, index) => `${index === 0 ? `${label}:` : "  "} ${compactLine(line, 1200)}`);
}

function eventSummaryLines(event: any): string[] {
  if (!event || typeof event !== "object") return [];
  if (event.type === "agent_start") return ["agent started"];
  if (event.type === "agent_end") return ["agent completed"];
  if (event.type === "tool_execution_start") return [`tool ${event.toolName || "unknown"} started`];
  if (event.type === "tool_execution_end") {
    const content = compactLine(contentText(event.result?.content));
    return [`${event.isError ? "tool failed" : "tool completed"}: ${event.toolName || "unknown"}${content ? ` — ${content}` : ""}`];
  }
  if (event.type === "message_end" && event.message) {
    const message = event.message as GenericMessage;
    if (message.role !== "assistant") return [];
    const text = textFromMessage(message);
    if (text.trim()) return summarizeTextLines("assistant", text);
    return message.stopReason ? [`assistant stopped: ${message.stopReason}`] : [];
  }
  if (event.type === "extension_error") return [`extension error: ${compactLine(event.error)}`];
  if (event.type === "auto_retry_start") return [`auto retry ${event.attempt}/${event.maxAttempts} in ${event.delayMs}ms: ${compactLine(event.errorMessage)}`];
  if (event.type === "auto_retry_end") return [`auto retry ${event.success ? "succeeded" : "failed"}: attempt ${event.attempt}`];
  if (event.type === "compaction_start") return [`compaction started: ${event.reason || "manual"}`];
  if (event.type === "compaction_end") return [`compaction ${event.aborted ? "aborted" : event.errorMessage ? "failed" : "completed"}`];
  return [];
}

export function createSubprocessTaskRunner(options: SubprocessTaskRunnerOptions = {}): TaskRunner {
  const defaultTools = options.defaultTools ?? [...DEFAULT_ALLOWED_TOOLS];
  const outputCapBytes = options.outputCapBytes ?? DEFAULT_OUTPUT_CAP_BYTES;
  const terminationGraceMs = options.terminationGraceMs ?? 5000;
  if (!Number.isInteger(terminationGraceMs) || terminationGraceMs < 0) throw new RangeError("terminationGraceMs must be a non-negative integer.");

  return {
    async runTask(task: WorkflowTask, context: TaskContext): Promise<TaskResult> {
      if (context.signal?.aborted) {
        return { ok: false, output: "", error: "Task was aborted before it started." };
      }

      const args = ["--mode", "json", "-p", "--no-session"];
      if (context.agentPolicy) args.unshift("-e", POLICY_GUARD_PATH);
      if (task.model) args.push("--model", task.model);
      const tools = safeTools(task, defaultTools, context);
      if (tools.length > 0) args.push("--tools", tools.join(","));
      args.push(task.prompt);

      const invocation = options.invocation
        ? { command: options.invocation.command, args: [...(options.invocation.argsPrefix ?? []), ...args] }
        : getPiInvocation(args);
      const cwd = task.cwd ? path.resolve(context.cwd, task.cwd) : context.cwd;
      if (!isPathInside(context.cwd, cwd)) {
        return { ok: false, output: "", error: `Task cwd escapes the workflow root: ${task.cwd}` };
      }
      const outputs: string[] = [];
      const rawEvents: unknown[] = [];
      const usage: WorkflowUsage = {};
      let stderr = "";
      let stopReason: string | undefined;
      let errorMessage: string | undefined;
      let aborted = false;
      let stdoutBuffer = "";
      let stderrBuffer = "";

      emitSubprocessEvent(context, task, "start", {
        command: formatInvocationForDisplay(invocation.command, invocation.args),
        cwd,
      });

      const exitCode = await new Promise<number>((resolve) => {
        const useProcessGroup = process.platform !== "win32";
        const proc = spawn(invocation.command, invocation.args, {
          cwd,
          shell: false,
          detached: useProcessGroup,
          stdio: ["ignore", "pipe", "pipe"],
          env: context.agentPolicy ? { ...process.env, PI_WORKFLOW_AGENT_POLICY: JSON.stringify(context.agentPolicy) } : process.env,
        });
        let abortListener: (() => void) | undefined;
        let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

        const processLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          let event: any;
          try {
            event = JSON.parse(trimmed);
          } catch {
            emitSubprocessEvent(context, task, "stdout", { line: trimmed });
            return;
          }
          rawEvents.push(event);
          for (const summary of eventSummaryLines(event)) {
            emitSubprocessEvent(context, task, "event", { eventType: event.type, line: summary });
          }

          if (event.type === "message_end" && event.message) {
            const message = event.message as GenericMessage;
            if (message.role === "assistant") {
              const text = textFromMessage(message);
              if (text) outputs.push(text);
              addUsage(usage, message);
              if (message.stopReason) stopReason = message.stopReason;
              if (message.errorMessage) errorMessage = message.errorMessage;
            }
          }
        };

        const processStderrLine = (line: string) => {
          const trimmed = line.trimEnd().replace(/\r$/, "");
          if (!trimmed.trim()) return;
          emitSubprocessEvent(context, task, "stderr", { line: trimmed });
        };

        proc.stdout.on("data", (data) => {
          stdoutBuffer += data.toString();
          const lines = stdoutBuffer.split("\n");
          stdoutBuffer = lines.pop() ?? "";
          for (const line of lines) processLine(line);
        });

        proc.stderr.on("data", (data) => {
          const chunk = data.toString();
          stderr += chunk;
          stderrBuffer += chunk;
          const lines = stderrBuffer.split("\n");
          stderrBuffer = lines.pop() ?? "";
          for (const line of lines) processStderrLine(line);
        });

        proc.on("close", (code) => {
          if (abortListener && context.signal) context.signal.removeEventListener("abort", abortListener);
          if (aborted) signalProcessTree("SIGKILL");
          if (forceKillTimer) clearTimeout(forceKillTimer);
          const finalCode = code ?? 0;
          if (stdoutBuffer.trim()) processLine(stdoutBuffer);
          if (stderrBuffer.trim()) processStderrLine(stderrBuffer);
          emitSubprocessEvent(context, task, "exit", {
            exitCode: finalCode,
            line: aborted ? "subprocess cancelled" : finalCode === 0 ? "subprocess completed" : `subprocess exited with code ${finalCode}`,
          });
          resolve(finalCode);
        });

        proc.on("error", (error) => {
          stderr += error.message;
          emitSubprocessEvent(context, task, "stderr", { line: error.message });
          resolve(1);
        });

        const signalProcessTree = (signal: NodeJS.Signals) => {
          try {
            if (useProcessGroup && proc.pid) process.kill(-proc.pid, signal);
            else proc.kill(signal);
          } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code !== "ESRCH") {
              emitSubprocessEvent(context, task, "stderr", { line: `failed to send ${signal}: ${(error as Error).message}` });
            }
          }
        };

        const killProc = () => {
          if (aborted) return;
          aborted = true;
          signalProcessTree("SIGTERM");
          forceKillTimer = setTimeout(() => signalProcessTree("SIGKILL"), terminationGraceMs);
        };

        if (context.signal) {
          abortListener = killProc;
          if (context.signal.aborted) killProc();
          else context.signal.addEventListener("abort", abortListener, { once: true });
        }
      });

      const output = truncateText(outputs.join("\n\n").trim() || "(no output)", outputCapBytes);
      if (aborted) return { ok: false, output, error: "Task was aborted.", usage, raw: rawEvents };
      if (exitCode !== 0) {
        return {
          ok: false,
          output,
          error: stderr.trim() || errorMessage || `Pi subprocess exited with code ${exitCode}.`,
          usage,
          raw: rawEvents,
        };
      }
      if (stopReason === "error" || errorMessage) {
        return { ok: false, output, error: errorMessage || "Assistant task stopped with an error.", usage, raw: rawEvents };
      }
      return { ok: true, output, usage, raw: rawEvents };
    },
  };
}

export function createEchoTaskRunner(): TaskRunner {
  return {
    async runTask(task: WorkflowTask): Promise<TaskResult> {
      return { ok: true, output: task.prompt };
    },
  };
}
