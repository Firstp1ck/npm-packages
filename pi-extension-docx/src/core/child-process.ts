import { spawn } from "node:child_process";
import { DocxError, redact } from "../errors.ts";

export type OwnedProcessResult = { stdout: string; stderr: string; code: number };
export async function runOwnedProcess(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; stdin?: string; timeoutMs?: number; signal?: AbortSignal; maxOutputChars?: number } = {}): Promise<OwnedProcessResult> {
  const timeoutMs = options.timeoutMs ?? 120_000, max = options.maxOutputChars ?? 1_000_000;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true });
    let stdout = "", stderr = "", settled = false, timedOut = false, aborted = false, forceTimer: NodeJS.Timeout | undefined;
    const terminate = () => { if (!child.pid) return; try { if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }); else process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } };
    const cleanup = () => { clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer); options.signal?.removeEventListener("abort", onAbort); };
    const finishError = (error: unknown) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const armForcedSettlement = (error: DocxError) => { if (forceTimer) return; forceTimer = setTimeout(() => finishError(error), 5000); forceTimer.unref?.(); };
    const onAbort = () => { if (settled || aborted) return; aborted = true; terminate(); armForcedSettlement(new DocxError("CANCELLED", "DOCX child process did not exit within the cancellation grace period.")); };
    const timer = setTimeout(() => { if (settled) return; timedOut = true; terminate(); armForcedSettlement(new DocxError("TIMEOUT", `Child process did not exit within 5 seconds after the ${timeoutMs}ms timeout.`)); }, timeoutMs); timer.unref?.();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    child.stdout.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(-max); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-max); });
    child.on("error", (error) => finishError(new DocxError("DEPENDENCY_MISSING", `Cannot start ${command}: ${error.message}`)));
    child.on("close", (code) => {
      if (settled) return;
      if (aborted) return finishError(new DocxError("CANCELLED", "DOCX child process was cancelled."));
      if (timedOut) return finishError(new DocxError("TIMEOUT", `Child process timed out after ${timeoutMs}ms.`));
      settled = true; cleanup(); resolve({ stdout, stderr: redact(stderr), code: code ?? 1 });
    });
    child.stdin.on("error", (error) => { if (!aborted && !timedOut) finishError(new DocxError("PROTOCOL_ERROR", `Cannot write child-process input: ${error.message}`)); });
    child.stdin.end(options.stdin ?? "");
  });
}
