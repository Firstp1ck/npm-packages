import path from "node:path";
import { pathExists } from "./paths.ts";
import { runCommand } from "./process.ts";

export type GitInfoOptions = {
  timeoutMs?: number;
};

export async function gitRevision(repoPath: string, options: GitInfoOptions & { short?: boolean } = {}): Promise<string | undefined> {
  if (!await pathExists(path.join(repoPath, ".git"))) return undefined;
  const result = await runCommand("git", ["rev-parse", options.short === false ? "HEAD" : "--short", "HEAD"], {
    cwd: repoPath,
    timeoutMs: options.timeoutMs ?? 120000,
  });
  return result.ok ? result.stdout.trim() || undefined : undefined;
}

export async function gitRemote(repoPath: string, remote = "origin", options: GitInfoOptions = {}): Promise<string | undefined> {
  if (!await pathExists(path.join(repoPath, ".git"))) return undefined;
  const result = await runCommand("git", ["remote", "get-url", remote], {
    cwd: repoPath,
    timeoutMs: options.timeoutMs ?? 120000,
  });
  return result.ok ? result.stdout.trim() || undefined : undefined;
}
