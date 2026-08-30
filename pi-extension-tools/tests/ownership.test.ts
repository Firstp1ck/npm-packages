import { describe, expect, test } from "bun:test";
import toolsExtension from "../index";

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
