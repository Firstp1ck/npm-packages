import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { createLocalBashOperations, type BashOperations, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveExecutableFromPath, shellQuote } from "@firstpick/pi-utils";

const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);

function truthyEnvDefaultTrue(value: string | undefined): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return !DISABLED_VALUES.has(normalized);
}

function resolveScriptPath(): string | undefined {
  if (os.platform() !== "linux") return undefined;

  const configured = process.env.PI_USER_BASH_SCRIPT_PATH?.trim();
  if (configured) {
    if (path.isAbsolute(configured) && fs.existsSync(configured)) return configured;

    const resolvedConfigured = resolveExecutableFromPath(configured);
    if (resolvedConfigured) return resolvedConfigured;
  }

  return resolveExecutableFromPath("script") ?? ["/usr/bin/script", "/bin/script"].find((p) => fs.existsSync(p));
}

function killProcessTree(pid: number): void {
  if (!pid) return;
  if (os.platform() === "win32") {
    try {
      spawn("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore", detached: true, windowsHide: true });
    } catch {
      // Ignore failed best-effort cleanup.
    }
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited.
    }
  }
}

function createPtyShellOperations(shellPath: string, scriptPath: string): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      if (!fs.existsSync(cwd)) throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
      if (signal?.aborted) throw new Error("aborted");

      const scriptCommand = `${shellQuote(shellPath)} -c ${shellQuote(command)}`;
      const child = spawn(scriptPath, ["-qefc", scriptCommand, "/dev/null"], {
        cwd,
        detached: os.platform() !== "win32",
        env: env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      let timedOut = false;
      let timeoutHandle: NodeJS.Timeout | undefined;
      const onAbort = () => {
        if (child.pid) killProcessTree(child.pid);
      };

      try {
        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            if (child.pid) killProcessTree(child.pid);
          }, timeout * 1000);
        }

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        if (signal) {
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }

        const exitCode = await new Promise<number | null>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code) => resolve(code));
        });

        if (signal?.aborted) throw new Error("aborted");
        if (timedOut) throw new Error(`timeout:${timeout}`);
        return { exitCode };
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (signal) signal.removeEventListener("abort", onAbort);
        child.stdout?.removeListener("data", onData);
        child.stderr?.removeListener("data", onData);
      }
    },
  };
}

function createUserShellOperations(shellPath: string): BashOperations {
  const scriptPath = truthyEnvDefaultTrue(process.env.PI_USER_BASH_USE_PTY) ? resolveScriptPath() : undefined;
  return scriptPath ? createPtyShellOperations(shellPath, scriptPath) : createLocalBashOperations({ shellPath });
}

function resolveShellPath(): string {
  const configured = process.env.PI_USER_BASH_SHELL_PATH?.trim();
  if (configured) {
    if (path.isAbsolute(configured) && fs.existsSync(configured)) return configured;

    const resolvedConfigured = resolveExecutableFromPath(configured);
    if (resolvedConfigured) return resolvedConfigured;
  }

  const fish =
    resolveExecutableFromPath("fish") ??
    ["/usr/bin/fish", "/bin/fish", "/usr/local/bin/fish", "/opt/homebrew/bin/fish"].find((p) => fs.existsSync(p));
  if (fish) return fish;

  const shellFromEnv = process.env.SHELL?.trim();
  if (shellFromEnv && path.isAbsolute(shellFromEnv) && fs.existsSync(shellFromEnv)) return shellFromEnv;

  const bash =
    resolveExecutableFromPath("bash") ??
    ["/bin/bash", "/usr/bin/bash", "C:\\Program Files\\Git\\bin\\bash.exe"].find((p) => fs.existsSync(p));
  if (bash) return bash;

  if (os.platform() === "win32") {
    const pwsh = resolveExecutableFromPath("pwsh") ?? resolveExecutableFromPath("powershell");
    if (pwsh) return pwsh;

    const comspec = process.env.ComSpec?.trim();
    if (comspec && fs.existsSync(comspec)) return comspec;
  }

  return process.execPath;
}

export default function fishUserBash(pi: ExtensionAPI) {
  const shellPath = resolveShellPath();

  pi.on("user_bash", (event) => {
    // Emit for companion extensions (e.g. bang autocomplete learning), because
    // user_bash short-circuits on first non-undefined handler result.
    pi.events.emit("fish-user-bash:executed", { command: event.command });

    return {
      operations: createUserShellOperations(shellPath),
    };
  });

  pi.registerCommand("user-bash-shell", {
    description: "Show configured shell path for !/!! commands",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        `user_bash shell: ${shellPath}${process.env.PI_USER_BASH_SHELL_PATH ? " (from PI_USER_BASH_SHELL_PATH)" : " (default)"}`,
        "info",
      );
    },
  });
}
