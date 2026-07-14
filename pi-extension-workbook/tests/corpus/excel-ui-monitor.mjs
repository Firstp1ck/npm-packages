import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function runPowerShell(script, args, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => {
      spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      finish({ ok: false, code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ ok: false, code: null, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => finish({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

function parseLastJson(stdout) {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    try { return JSON.parse(line.replace(/^\uFEFF/, "")); } catch { /* continue */ }
  }
  return undefined;
}

async function stopOwnedExcel(owner) {
  if (!owner?.pid || !owner.startTime) return { attempted: false, killed: false };
  const script = [
    "$ErrorActionPreference='Stop'",
    `$p=Get-Process -Id ${Number(owner.pid)} -ErrorAction SilentlyContinue`,
    "if($null -eq $p){Write-Output 'already-stopped';exit 0}",
    `$expected=[DateTime]::Parse('${String(owner.startTime).replace(/'/g, "''")}').ToUniversalTime()`,
    "if([Math]::Abs(($p.StartTime.ToUniversalTime()-$expected).TotalSeconds)-gt 1){Write-Error 'PID start time mismatch';exit 6}",
    "$p | Stop-Process -Force",
    "Write-Output 'owned-excel-stopped'",
  ].join(";");
  const result = await new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
  return { attempted: true, killed: result.code === 0, ...result };
}

export async function validateWithExcelUi(workbookPaths, renderDirectory, timeoutMs = 120_000) {
  if (process.platform !== "win32") return { status: "SKIP", reason: "UI-aware Excel validation requires interactive Windows." };
  const stateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-workbook-excel-ui-"));
  const ownerPath = path.join(stateDirectory, "owner.json");
  await fs.mkdir(renderDirectory, { recursive: true });
  const workerScript = path.join(here, "validate-with-excel-ui.ps1");
  const windowScript = path.join(here, "list-process-windows.ps1");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", workerScript, "-WorkbookPaths", workbookPaths.join("|"), "-OwnerPath", ownerPath, "-RenderDirectory", renderDirectory], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  let owner;
  let modalWindow;
  let timedOut = false;
  const started = Date.now();
  let childClosed = false;
  let childCode;
  child.on("close", (code) => { childClosed = true; childCode = code; });
  try {
    while (!childClosed && Date.now() - started < timeoutMs) {
      if (!owner) owner = await fs.readFile(ownerPath, "utf8").then((text) => JSON.parse(text.replace(/^\uFEFF/, "")), () => undefined);
      if (owner?.pid) {
        const inventory = await runPowerShell(windowScript, ["-TargetProcessId", String(owner.pid)], 10_000);
        const windows = parseLastJson(inventory.stdout);
        const list = Array.isArray(windows) ? windows : windows ? [windows] : [];
        modalWindow = list.find((window) => window.visible && window.className !== "XLMAIN" && window.className !== "EXCEL7" && (window.title || /#32770|NUIDialog|bosa_sdm/i.test(window.className)));
        if (modalWindow) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    timedOut = !childClosed && !modalWindow;
    if (modalWindow || timedOut) {
      spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      await stopOwnedExcel(owner);
      throw new Error(modalWindow ? `Excel modal/repair window detected: ${JSON.stringify(modalWindow)}` : `Excel UI validator timed out after ${timeoutMs} ms.`);
    }
    const payload = parseLastJson(stdout);
    if (childCode !== 0 || payload?.ok !== true) throw new Error(`Excel UI validation failed: ${JSON.stringify({ childCode, payload, stderr })}`);
    const processStillRunning = owner?.pid ? await new Promise((resolve) => {
      const probe = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `if(Get-Process -Id ${Number(owner.pid)} -ErrorAction SilentlyContinue){exit 1}else{exit 0}`], { windowsHide: true, stdio: "ignore" });
      probe.on("close", (code) => resolve(code !== 0));
    }) : false;
    if (processStillRunning) throw new Error(`Owned Excel PID ${owner.pid} remained after clean UI validation.`);
    return { status: "PASS", modalWindowsDetected: 0, timedOut: false, owner, processStillRunning, displayAlerts: true, payload };
  } finally {
    if (!childClosed) {
      spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      await stopOwnedExcel(owner).catch(() => undefined);
    }
    await fs.rm(stateDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = process.argv.slice(2);
  const result = await validateWithExcelUi(paths, path.join(os.tmpdir(), "pi-workbook-excel-ui-renders"));
  console.log(JSON.stringify(result, null, 2));
}
