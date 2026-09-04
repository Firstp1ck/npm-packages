import { describe, expect, test } from "bun:test";
import toolsExtension, { toolSourceLabel } from "../index";

describe("tool source presentation", () => {
  test("labels built-in, SDK, and extension tools", () => {
    expect(toolSourceLabel({ sourceInfo: { source: "builtin" } } as never)).toBe("Pi built-in");
    expect(toolSourceLabel({ sourceInfo: { source: "sdk" } } as never)).toBe("SDK custom tools");
    expect(toolSourceLabel({ sourceInfo: { source: "extension:npm:@firstpick/example" } } as never)).toBe("npm:@firstpick/example");
  });
});

describe("command ownership", () => {
  test("owns exactly one scoped /tools command", () => {
    const commands = new Map<string, { description?: string }>();
    toolsExtension({
      on() {},
      registerCommand(name: string, command: { description?: string }) {
        commands.set(name, command);
      },
    } as never);

    expect([...commands.keys()]).toEqual(["tools"]);
    expect(commands.get("tools")?.description).toContain("session, global, or exact-model");
  });
});
