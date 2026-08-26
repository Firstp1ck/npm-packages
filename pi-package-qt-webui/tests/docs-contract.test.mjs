import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const names = ["README.md", "TECHNICAL.md", "DEVELOPMENT.md"];
const documents = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(path.join(root, name), "utf8")])));

test("README has the package guide sections, exact install name, requirements, and technical link", () => {
  const readme = documents["README.md"];
  for (const heading of ["# Qt WebUI", "## What you can do", "## Install", "## How to use it", "## Before you start", "## Technical details"]) {
    assert(readme.includes(heading), `README should include ${heading}`);
  }
  assert.match(readme, /npm install -g @firstpick\/pi-package-qt-webui/);
  assert.match(readme, /pi install npm:@firstpick\/pi-package-qt-webui/);
  assert.match(readme, /\/qt-webui-start/);
  assert.match(readme, /npm run dev/);
  assert.match(readme, /Quickshell 0\.3 or newer/);
  assert.match(readme, /Linux.*Wayland|Wayland.*Linux/s);
  assert.match(readme, /active provider, model ID, and thinking effort/i);
  assert.match(readme, /\[TECHNICAL\.md\]\(TECHNICAL\.md\)/);
});

test("technical reference remains user-facing", () => {
  const technical = documents["TECHNICAL.md"];
  assert.match(technical, /Quickshell 0\.3 or newer/);
  assert.match(technical, /Linux on a Wayland desktop session/);
  assert.match(technical, /`qt-webui`/);
  assert.match(technical, /npm install -g @firstpick\/pi-package-qt-webui/);
  assert.match(technical, /pi install npm:@firstpick\/pi-package-qt-webui/);
  assert.match(technical, /`\/qt-webui-start`/);
  assert.match(technical, /`qt-webui dev`/);
  assert.match(technical, /`npm run dev`/);
  assert.match(technical, /provider and model ID followed by the thinking effort/i);
  assert.match(technical, /\[Back to README\]\(README\.md\)/);
  assert.match(technical, /\[Contributor guide\]\(DEVELOPMENT\.md\)/);
  for (const forbidden of [
    /\b(?:request|response|event) payload\b/i,
    /\b(?:JSON|RPC) schema\b/i,
    /\bsource layout\b/i,
    /(?:^|`)bin\//m,
    /(?:^|`)lib\//m,
    /(?:^|`)qml\//m,
    /npm test/,
    /node --check/,
  ]) {
    assert.doesNotMatch(technical, forbidden, `TECHNICAL.md contains contributor-only material: ${forbidden}`);
  }
});

test("development guide has required navigation and contributor contracts", () => {
  const development = documents["DEVELOPMENT.md"];
  assert.match(development, /^# Development guide: Qt WebUI/m);
  assert.match(development, /Contributor-only implementation, API, architecture, testing, and maintenance information\./);
  assert.match(development, /\[Back to README\]\(README\.md\) · \[Advanced user technical reference\]\(TECHNICAL\.md\)/);
  assert.match(development, /QT_WEBUI_CALLER_CWD/);
  assert.match(development, /model\.provider.*model\.id.*thinkingLevel/s);
  assert.match(development, /removes every inherited environment key whose name starts with `QT_WEBUI_`/);
  assert.match(development, /npm install --package-lock-only --ignore-scripts/);
  assert.match(development, /adds that prefix's bin directory to `PATH`/);
  assert.match(development, /invokes `qt-webui` by command name/);
});

test("relative Markdown links resolve", async () => {
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const [name, source] of Object.entries(documents)) {
    for (const match of source.matchAll(linkPattern)) {
      const target = match[1].split("#", 1)[0];
      if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
      await assert.doesNotReject(access(path.resolve(root, path.dirname(name), target)), `${name} link should resolve: ${target}`);
    }
  }
});
