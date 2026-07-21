import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import workbookExtension from "../index.ts";
import { boundedJsonResult } from "../src/output.ts";
import { writeWorkbookFixture } from "./fixture-builder.mjs";

test("large tool output is bounded and written to a complete artifact", async (t) => {
  const result = await boundedJsonResult({ sourcePath: "fixture.xlsx", rows: Array.from({ length: 2000 }, (_, index) => ({ index, value: "x".repeat(40) })) }, "bounded-output-test", 1000);
  assert.equal(result.details.truncated, true);
  assert.ok(result.content[0].text.length < 1000);
  const artifact = result.details.artifactPath;
  const full = JSON.parse(await fs.readFile(artifact, "utf8"));
  assert.equal(full.rows.length, 2000);
  t.after(() => fs.rm(path.dirname(artifact), { recursive: true, force: true }));
});

test("extension registers six strict workbook tools and doctor command", async (t) => {
  const tools = [];
  const commands = [];
  workbookExtension({
    registerTool(tool) { tools.push(tool); },
    registerCommand(name, command) { commands.push({ name, command }); },
  });
  assert.deepEqual(tools.map((tool) => tool.name), ["workbook_inspect", "workbook_read", "workbook_render", "workbook_edit", "workbook_diff", "workbook_validate"]);
  assert.deepEqual(commands.map((command) => command.name), ["workbook-doctor"]);
  for (const tool of tools) {
    assert.ok(tool.parameters);
    assert.ok(tool.promptSnippet);
    assert.ok(Array.isArray(tool.promptGuidelines));
  }

  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi-workbook-extension-test-"));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const source = await writeWorkbookFixture(path.join(cwd, "source.xlsx"));
  const inspect = tools.find((tool) => tool.name === "workbook_inspect");
  const updates = [];
  const result = await inspect.execute("test", { path: source }, undefined, (update) => updates.push(update), { cwd });
  assert.equal(result.details.validation.ok, true);
  assert.ok(result.content[0].text.includes("sourceSha256"));
  assert.equal(updates.length, 1);

  const render = tools.find((tool) => tool.name === "workbook_render");
  const rendered = await render.execute("test", { path: source, sheet: "Sheet1", range: "A1:B2" }, undefined, undefined, { cwd });
  assert.equal(rendered.content[1].type, "image");
  assert.equal(rendered.content[1].mimeType, "image/png");
  assert.match(rendered.content[1].data, /^[A-Za-z0-9+/]+={0,2}$/);
  const renderedPng = Buffer.from(rendered.content[1].data, "base64");
  assert.equal(rendered.content[1].data, renderedPng.toString("base64"), "rendered image data should be canonical base64");
  assert.deepEqual([...renderedPng.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(rendered.details.outputPath.endsWith(".png"));

  const cachedRender = await render.execute("test", { path: source, sheet: "Sheet1", range: "A1:B2" }, undefined, undefined, { cwd });
  assert.equal(cachedRender.details.cacheHit, true);
  assert.equal(cachedRender.content[1].data, rendered.content[1].data, "cached previews should serialize to the same base64 PNG");
});
