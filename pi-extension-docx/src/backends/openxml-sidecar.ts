import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openXmlCapabilities } from "../capabilities.ts";
import { DOCX_CONTRACT_VERSION, type DocxEditRequest, type EngineCapabilities, type EngineRequest, type EngineResponse } from "../contracts.ts";
import { DocxError, fail } from "../errors.ts";
import { runCommand } from "../pi-utils.ts";
import { runOwnedProcess } from "../core/child-process.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
type Launch = { command: string; args: string[]; source: string };
async function exists(filePath: string): Promise<boolean> { return fs.stat(filePath).then((stat) => stat.isFile(), () => false); }
export async function resolveSidecar(): Promise<Launch | undefined> {
  const configured = process.env.PI_DOCX_ENGINE_PATH?.trim();
  if (configured) { const target = path.resolve(configured); if (!await exists(target)) fail("DEPENDENCY_MISSING", `PI_DOCX_ENGINE_PATH does not exist: ${target}`); return target.toLowerCase().endsWith(".dll") ? { command: "dotnet", args: [target], source: "environment-dll" } : { command: target, args: [], source: "environment-executable" }; }
  const names = process.platform === "win32" ? ["DocxEngine.exe"] : ["DocxEngine"];
  for (const name of names) { const candidate = path.join(packageRoot, "engine", "publish", name); if (await exists(candidate)) return { command: candidate, args: [], source: "packaged-executable" }; }
  const dllCandidates = [path.join(packageRoot, "engine", "publish", "DocxEngine.dll"), path.join(packageRoot, "engine", "DocxEngine", "bin", "Release", "net8.0", "DocxEngine.dll")];
  for (const candidate of dllCandidates) if (await exists(candidate)) { const dotnet = await runCommand("dotnet", ["--info"], { timeoutMs: 5000 }); if (dotnet.ok) return { command: "dotnet", args: [candidate], source: "framework-dependent-dll" }; }
  return undefined;
}
function parseResponse(stdout: string): EngineResponse { const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1); if (!line) fail("PROTOCOL_ERROR", "Open XML sidecar returned no JSON response."); try { return JSON.parse(line) as EngineResponse; } catch { fail("PROTOCOL_ERROR", "Open XML sidecar returned invalid JSON."); } }
export class OpenXmlSidecar {
  private negotiated?: { launch: Launch; version?: string };
  async probe(signal?: AbortSignal): Promise<EngineCapabilities> { try { const launch = await resolveSidecar(); if (!launch) return openXmlCapabilities(false); const response = await this.invoke(launch, { protocolVersion: DOCX_CONTRACT_VERSION, command: "version" }, signal, 15_000); if (!response.ok || response.protocolVersion !== DOCX_CONTRACT_VERSION) return openXmlCapabilities(false); this.negotiated = { launch, version: response.engineVersion }; return openXmlCapabilities(true, response.engineVersion); } catch { return openXmlCapabilities(false); } }
  private async invoke(launch: Launch, request: EngineRequest, signal?: AbortSignal, timeoutMs = 120_000): Promise<EngineResponse> { const result = await runOwnedProcess(launch.command, launch.args, { stdin: JSON.stringify(request), signal, timeoutMs }); if (result.code !== 0 && !result.stdout.trim()) fail("PROTOCOL_ERROR", `Open XML sidecar exited with code ${result.code}: ${result.stderr || "no stderr"}`); const response = parseResponse(result.stdout); if (response.protocolVersion !== DOCX_CONTRACT_VERSION) fail("PROTOCOL_ERROR", `Unsupported sidecar protocol ${response.protocolVersion}.`); if (!response.ok) { const code = response.error?.code ?? "VALIDATION_FAILED"; throw new DocxError(code as never, response.error?.message ?? "Open XML sidecar failed.", response.error?.details); } return response; }
  async request(command: EngineRequest["command"], input: { sourcePath?: string; outputPath?: string; operations?: DocxEditRequest["operations"] }, signal?: AbortSignal, timeoutMs = 120_000): Promise<EngineResponse> { let state = this.negotiated; if (!state) { const capabilities = await this.probe(signal); if (!capabilities.available || !this.negotiated) fail("DEPENDENCY_MISSING", "Open XML sidecar is unavailable. Build engine/DocxEngine or configure PI_DOCX_ENGINE_PATH."); state = this.negotiated; } return this.invoke(state.launch, { protocolVersion: DOCX_CONTRACT_VERSION, command, ...input }, signal, timeoutMs); }
}
