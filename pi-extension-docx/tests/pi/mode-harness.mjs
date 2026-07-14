import assert from "node:assert/strict";
import docxExtension from "../../index.ts";

const tools = []; docxExtension({ registerTool(tool) { tools.push(tool); }, registerCommand() {}, on() {} });
assert.equal(tools.length, 7);
const commit = tools.find((tool) => tool.name === "docx_commit");
for (const mode of ["print", "json"]) await assert.rejects(commit.execute("id", { revisionId: "00000000-0000-0000-0000-000000000000", inPlace: true, overwrite: true, expectedSourceSha256: "0".repeat(64) }, undefined, undefined, { cwd: process.cwd(), mode, hasUI: false, ui: {} }), /interactive TUI\/RPC confirmation/);
console.log("Registration and non-interactive overwrite refusal passed for print/JSON mode harnesses. Real TUI/RPC session gates remain external.");
