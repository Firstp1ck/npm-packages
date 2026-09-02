import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import setupSkillsExtension, { collectLoadedSkills, collectPackageSkillFiles, collectSkillFilesFromDir, hasNoSkillsFlag } from "../index";

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "setup-skills-test-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("CLI boundaries", () => {
  test("recognizes both no-skills flags", () => {
    expect(hasNoSkillsFlag(["--no-skills"])).toBe(true);
    expect(hasNoSkillsFlag(["-ns"])).toBe(true);
    expect(hasNoSkillsFlag(["--skill", "/tmp/example/SKILL.md"])).toBe(false);
    expect(hasNoSkillsFlag(["--", "--no-skills"])).toBe(false);
  });

  test("keeps loaded CLI skills available when discovery is disabled", () => {
    const root = makeTemporaryDirectory();
    const skillPath = join(root, "SKILL.md");
    writeFileSync(skillPath, "---\nname: explicit-skill\ndescription: Explicit CLI skill\n---\n");
    const runtimeCommands = [{
      name: "skill:explicit-skill",
      description: "Explicit CLI skill",
      source: "skill" as const,
      sourceInfo: { path: skillPath, source: "cli", scope: "temporary" as const, origin: "top-level" as const },
    }];

    expect(collectLoadedSkills(runtimeCommands).map((skill) => skill.name)).toEqual(["explicit-skill"]);

    const commands = new Map<string, unknown>();
    let hookCount = 0;
    setupSkillsExtension({
      getCommands() {
        return runtimeCommands;
      },
      on() {
        hookCount += 1;
      },
      registerCommand(name: string, command: unknown) {
        commands.set(name, command);
      },
    } as never, ["--no-skills", "--skill", skillPath]);

    expect(hookCount).toBeGreaterThan(0);
    expect([...commands.keys()]).toEqual(["skills"]);
  });
});

describe("skill discovery", () => {
  test("owns exactly one /skills command", () => {
    const commands = new Map<string, unknown>();
    setupSkillsExtension({
      on() {},
      registerCommand(name: string, command: unknown) {
        commands.set(name, command);
      },
    } as never);

    expect([...commands.keys()]).toEqual(["skills"]);
  });

  test("finds local skills without consulting their enabled state", () => {
    const root = makeTemporaryDirectory();
    const skillDirectory = join(root, "disabled-skill");
    mkdirSync(skillDirectory);
    const skillPath = join(skillDirectory, "SKILL.md");
    writeFileSync(skillPath, "---\nname: disabled-skill\ndescription: test\n---\n");

    expect(collectSkillFilesFromDir(root)).toEqual([skillPath]);
  });

  test("keeps disabled package resources in the selectable skill list", async () => {
    const packageDirectory = makeTemporaryDirectory();
    const enabledPath = join(packageDirectory, "skills", "enabled", "SKILL.md");
    const disabledPath = join(packageDirectory, "skills", "disabled", "SKILL.md");
    const packageManager = {
      resolveExtensionSources: async () => ({
        skills: [
          { path: enabledPath, enabled: true },
          { path: disabledPath, enabled: false },
        ],
      }),
    } as unknown as DefaultPackageManager;

    expect(await collectPackageSkillFiles(packageDirectory, packageManager)).toEqual([disabledPath, enabledPath]);
  });
});
