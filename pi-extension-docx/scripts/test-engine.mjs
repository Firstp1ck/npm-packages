import { spawnSync } from "node:child_process";
import process from "node:process";

const sdk = spawnSync("dotnet", ["--list-sdks"], { encoding: "utf8", windowsHide: true });
if (sdk.status !== 0 || !sdk.stdout.trim()) {
  console.log("SKIP: no .NET SDK is installed; engine source is present but the production engine gate remains open.");
  process.exit(0);
}
const result = spawnSync("dotnet", ["test", "engine/DocxEngine.sln", "--configuration", "Release"], { cwd: new URL("..", import.meta.url), stdio: "inherit", windowsHide: true });
process.exit(result.status ?? 1);
