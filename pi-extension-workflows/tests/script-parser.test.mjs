import assert from "node:assert/strict";
import { WorkflowValidationError } from "../src/errors.ts";
import { parseWorkflowScript } from "../src/script-parser.ts";

const source = `// Comments may precede metadata.
export const meta = {
  name: "audit-routes",
  description: "Audit routes",
  phases: ["discover", "verify"],
  pi: { maxConcurrency: 2, permissions: { write: false } }
}

const first = await agent("Find routes", { label: "discover" })
return await phase("verify", async () => ({ first, args }))
`;

const parsed = parseWorkflowScript(source, { sourcePath: "/tmp/audit-routes.js", enforceFilename: true });
assert.equal(parsed.meta.name, "audit-routes");
assert.equal(parsed.meta.pi.maxConcurrency, 2);
assert.deepEqual(parsed.meta.phases, ["discover", "verify"]);
assert.match(parsed.body, /const first = await agent/);
assert.doesNotMatch(parsed.body, /export const meta/);
assert.match(parsed.sourceHash, /^[a-f0-9]{64}$/);
assert.equal(parseWorkflowScript(source).sourceHash, parsed.sourceHash, "hash must be deterministic");

const rejected = [
  ["missing metadata", `return "no meta"`, "first statement"],
  ["dynamic metadata", `export const meta = makeMeta()\nreturn 1`, "static literals"],
  ["import", `export const meta = {name:"x",description:"x"}\nimport fs from "node:fs"\nreturn 1`, "imports are not available"],
  ["dynamic import", `export const meta = {name:"x",description:"x"}\nreturn import("node:fs")`, "imports are not available"],
  ["process", `export const meta = {name:"x",description:"x"}\nreturn process.env`, "identifier 'process'"],
  ["eval", `export const meta = {name:"x",description:"x"}\nreturn eval("1")`, "identifier 'eval'"],
  ["secondary export", `export const meta = {name:"x",description:"x"}\nexport const nope = 1\nreturn nope`, "only the first"],
];

for (const [name, invalid, issue] of rejected) {
  assert.throws(
    () => parseWorkflowScript(invalid),
    (error) => error instanceof WorkflowValidationError && error.issues.some((entry) => entry.includes(issue)),
    name,
  );
}

assert.throws(
  () => parseWorkflowScript(source, { sourcePath: "/tmp/other.js", enforceFilename: true }),
  (error) => error instanceof WorkflowValidationError && error.issues.some((issue) => issue.includes("must match filename")),
);

console.log("script parser tests passed");
