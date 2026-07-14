import { spawn } from "node:child_process";
import { redact, fail } from "../errors.ts";

export type OwnedProcessResult = { stdout: string; stderr: string; code: number };
export async function runOwnedProcess(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; stdin?: string; timeoutMs?: number; signal?: AbortSignal; maxOutputChars?: number } = {}): Promise<OwnedProcessResult> {
  const timeoutMs = options.timeoutMs ?? 120_000, max = options.maxOutputChars ?? 1_000_000;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true });
    let stdout = "", stderr = "", settled = false, timedOut = false;
    const terminate = () => { if (!child.pid) return; try { if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }); else process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } };
    const finishError = (error: unknown) => { if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); reject(error); };
    const onAbort = () => { terminate(); finishError(Object.assign(new Error("DOCX child process cancelled."), { code: "CANCELLED" })); };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs); timer.unref?.();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(-max); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-max); });
    child.on("error", finishError);
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); if (timedOut) { try { fail("TIMEOUT", `Child process timed out after ${timeoutMs}ms.`); } catch (error) { reject(error); } return; } resolve({ stdout, stderr: redact(stderr), code: code ?? 1 }); });
    child.stdin.end(options.stdin ?? "");
  });
}
