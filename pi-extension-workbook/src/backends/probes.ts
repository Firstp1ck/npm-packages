import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runCommand } from "../pi-utils.ts";
import type { EngineCapabilities } from "../contracts.ts";

const unavailableOperations = [{ operation: "mutation", supported: false, fidelity: "unsupported" as const, reason: "Backend has not passed the workbook fidelity corpus." }];

export async function probeNativeExcel(): Promise<EngineCapabilities> {
  let executable: string | undefined;
  const workerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../workers/excel-native.ps1");
  const workerPresent = await fs.stat(workerPath).then((stat) => stat.isFile(), () => false);
  if (process.platform === "win32") {
    const result = await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$p=(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\excel.exe' -ErrorAction SilentlyContinue).'(default)'; if($p){$p}"], { timeoutMs: 5000, maxStdoutChars: 4000, maxStderrChars: 4000 });
    const candidate = result.stdout.trim().split(/\r?\n/).at(-1);
    if (candidate) {
      try { if ((await fs.stat(candidate)).isFile()) executable = path.resolve(candidate); } catch { /* unavailable */ }
    }
  }
  return {
    engine: "excel-native",
    available: Boolean(executable),
    formats: ["xlsx", "xlsm"],
    inspect: false, read: false, render: false, edit: false, diff: false, validate: false,
    operations: unavailableOperations,
    constraints: [
      executable ? `Excel detected at ${executable}.` : "Interactive Windows Excel was not detected.",
      workerPresent ? "Isolated native candidate worker is installed, but public mutation remains disabled after strict no-op fidelity failures; see the backend ADR." : "Native candidate worker is not installed.",
      "Unattended/server Office automation is not supported.",
      "Macros must be force-disabled before any future adapter opens a workbook.",
    ],
  };
}

export async function probeAspose(): Promise<EngineCapabilities> {
  const require = createRequire(import.meta.url);
  let installed = false;
  try { require.resolve("aspose.cells"); installed = true; } catch { /* optional dependency */ }
  return {
    engine: "aspose",
    available: installed,
    formats: ["xlsx", "xlsm"],
    inspect: false, read: false, render: false, edit: false, diff: false, validate: false,
    operations: unavailableOperations,
    constraints: [installed ? "Aspose.Cells is installed, but remains disabled pending license and fidelity validation." : "Aspose.Cells is not installed.", "A commercial license and Java/native deployment validation are required."],
  };
}

export async function probeAllBackends(ooxml: EngineCapabilities): Promise<EngineCapabilities[]> {
  const [native, aspose] = await Promise.all([probeNativeExcel(), probeAspose()]);
  return [ooxml, native, aspose];
}
