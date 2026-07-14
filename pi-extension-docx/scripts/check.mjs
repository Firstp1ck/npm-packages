import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const required = ["index.ts", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "skills/docx-editor/SKILL.md", "src/contracts.ts", "src/schemas.ts", "src/ooxml/zip.ts", "src/ooxml/package.ts", "src/core/transaction.ts", "engine/DocxEngine.sln", "engine/DocxEngine/Program.cs"];
for (const relative of required) await fs.access(path.join(root, relative));
const index = await fs.readFile(path.join(root, "index.ts"), "utf8");
for (const tool of ["docx_inspect", "docx_read", "docx_render", "docx_edit", "docx_diff", "docx_validate", "docx_commit"]) if (!index.includes(`name: \"${tool}\"`)) throw new Error(`Missing tool registration: ${tool}`);
if (!index.includes("withFileMutationQueue")) throw new Error("Commit mutation queue is missing.");
const skill = await fs.readFile(path.join(root, "skills/docx-editor/SKILL.md"), "utf8");
if (!skill.startsWith("---\nname: docx-editor\n") || !skill.includes("description:")) throw new Error("Invalid skill frontmatter.");
for (const file of required) { const text = await fs.readFile(path.join(root, file), "utf8"); if (/TODO|REPLACE_ME|__PLACEHOLDER__/i.test(text)) throw new Error(`Unreplaced placeholder in ${file}`); }
console.log("DOCX package structure, tool registrations, queue guard, and skill checks passed.");
