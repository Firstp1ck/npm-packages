import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

const [manifest, skill, readme, technical, development, license] = await Promise.all([
  read("package.json").then(JSON.parse),
  read("skills/frontend-design/SKILL.md"),
  read("README.md"),
  read("TECHNICAL.md"),
  read("DEVELOPMENT.md"),
  read("LICENSE"),
]);

const packagedFiles = [
  "skills/frontend-design/SKILL.md",
  "README.md",
  "TECHNICAL.md",
  "DEVELOPMENT.md",
  "LICENSE",
];

test("package metadata exposes one installable Pi skill", () => {
  assert.equal(manifest.name, "@firstpick/pi-skill-frontend-design");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.license, "Apache-2.0");
  assert(manifest.keywords.includes("pi-package"));
  assert.deepEqual(manifest.pi, { skills: ["./skills"] });
  assert.deepEqual(manifest.files, packagedFiles);
  assert.equal(manifest.scripts.test, "node --test tests/skill-contract.test.mjs");
});

test("skill frontmatter follows the Agent Skills contract", () => {
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert(frontmatter, "SKILL.md must begin with YAML frontmatter");

  assert.match(frontmatter[1], /^name: frontend-design$/m);
  assert.match(frontmatter[1], /^description: .+$/m);
  assert.match(frontmatter[1], /^license: Apache-2\.0$/m);
  assert.match(frontmatter[1], /^compatibility: .+$/m);

  const description = frontmatter[1].match(/^description: (.+)$/m)?.[1] ?? "";
  const compatibility = frontmatter[1].match(/^compatibility: (.+)$/m)?.[1] ?? "";
  assert(description.length <= 1024);
  assert(compatibility.length <= 500);
});

test("skill preserves the design workflow and quality floor", () => {
  assert.match(skill, /Name the subject, its audience, and the page's single job/);
  assert.match(skill, /four to six palette colors names and hex values/);
  assert.match(skill, /Use ASCII wireframes to compare ideas/);
  assert.match(skill, /Choose the one element people should remember/);
  assert.match(skill, /Ask whether each choice could appear unchanged in any similar project/);
  assert.match(skill, /Support mobile layouts, visible keyboard focus, and reduced-motion preferences/);
  assert.match(skill, /Write from the user's side of the screen/);
});

test("license and modification notice are present", () => {
  assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
  assert.match(skill, /## Modification notice/);
  assert.match(skill, /This file has been modified\./);
  assert.match(development, /keeps the complete terms in `LICENSE`/);
});

test("package documentation has working local links and no banned punctuation", async () => {
  const documents = [
    ["README.md", readme],
    ["TECHNICAL.md", technical],
    ["DEVELOPMENT.md", development],
    ["skills/frontend-design/SKILL.md", skill],
  ];

  for (const [relativePath, contents] of documents) {
    assert.doesNotMatch(contents, /[—–“”‘’]/u, `${relativePath} contains banned punctuation`);

    for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].split("#", 1)[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      await access(path.resolve(root, path.dirname(relativePath), target));
    }
  }

  assert.match(readme, /pi install npm:@firstpick\/pi-skill-frontend-design/);
});

test("every declared package file exists", async () => {
  await Promise.all(packagedFiles.map((relativePath) => access(path.join(root, relativePath))));
});
