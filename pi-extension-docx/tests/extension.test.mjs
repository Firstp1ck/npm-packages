import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Value } from "typebox/value";
import docxExtension from "../index.ts";
import { writeFixture } from "./fixture-builder.mjs";

test("extension registers seven strict tools, doctor, and binary write guards", async (t) => { const tools = [], commands = [], handlers = new Map(); docxExtension({ registerTool(tool) { tools.push(tool); }, registerCommand(name, command) { commands.push({ name, command }); }, on(name, handler) { handlers.set(name, handler); } }); assert.deepEqual(tools.map((tool) => tool.name), ["docx_inspect", "docx_read", "docx_render", "docx_edit", "docx_diff", "docx_validate", "docx_commit"]); assert.deepEqual(commands.map((command) => command.name), ["docx-doctor"]); for (const tool of tools) { assert.ok(tool.parameters); assert.ok(tool.promptSnippet); assert.ok(tool.renderCall); assert.ok(tool.renderResult); }
  const edit = tools.find((tool) => tool.name === "docx_edit"); assert.equal(Value.Check(edit.parameters, { path: "fixture.docx", expectedSourceSha256: "a".repeat(64), operations: [{ type: "deleteParagraph", selector: { kind: "paragraphId", paragraphId: "A1B2C3D4", expectedHash: "b".repeat(16) } }] }), true); assert.equal(Value.Check(edit.parameters, { path: "fixture.docx", operations: [{ type: "setCharacterFormatting", selector: { kind: "path", story: "main", path: "/main/p[1]" }, formatting: {} }] }), false);
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi-docx-extension-")); t.after(() => fs.rm(cwd, { recursive: true, force: true })); const source = await writeFixture(path.join(cwd, "source.docx")); const inspect = tools.find((tool) => tool.name === "docx_inspect"), updates = []; const inspected = await inspect.execute("id", { path: source }, undefined, (update) => updates.push(update), { cwd }); assert.equal(inspected.details.sourcePath, source); assert.equal(inspected.details.features.tables, 1); assert.equal(updates.length, 1); const guard = handlers.get("tool_call"); assert.equal(guard({ toolName: "edit", input: { path: "@contract.docx" } }).block, true); assert.equal(guard({ toolName: "write", input: { path: "notes.md" } }), undefined); });
