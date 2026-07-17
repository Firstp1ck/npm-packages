#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const V2_SCHEMA_VERSION = "2.0";
const FIXED_V2_HEADINGS = [
  [1, /^PATCH\.md\s+—\s+.+$/u, "title"],
  [2, /^Purpose$/u, "purpose"],
  [3, /^Root cause$/u, "rootCause"],
  [3, /^Expected outcome$/u, "expectedOutcome"],
  [2, /^Lifecycle$/u, "lifecycle"],
  [2, /^Scope \(exact files changed\)$/u, "scope"],
  [2, /^Verification steps$/u, "verification"],
  [2, /^Rollback$/u, "rollback"],
  [2, /^Operational notes$/u, "operationalNotes"],
];

function parseArgs(argv) {
  const out = { patchPath: "", workspaceRoot: "", strict: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--patch" || arg === "--patchPath") out.patchPath = argv[++i] ?? "";
    else if (arg === "--workspace" || arg === "--workspaceRoot") out.workspaceRoot = argv[++i] ?? "";
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--no-strict" || arg === "--unstrict") out.strict = false;
  }
  if (!out.patchPath) throw new Error("Missing --patch <path-to-PATCH.md>");
  return out;
}

function addError(result, code, message, section = null) {
  result.errors.push({ code, message, section });
}

function addWarning(result, message) {
  result.warnings.push(message);
}

function normalizeBody(text) {
  return text
    .trim()
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "---")
    .join("\n")
    .trim();
}

function scanHeadings(markdown) {
  const headings = [];
  const lineRx = /[^\n]*(?:\n|$)/gu;
  let fence = null;
  let match;
  while ((match = lineRx.exec(markdown)) !== null) {
    if (!match[0]) break;
    const start = match.index;
    const rawLine = match[0].replace(/\r?\n$/u, "");
    const fenceMatch = rawLine.match(/^\s*(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const token = fenceMatch[1];
      if (!fence) fence = { char: token[0], length: token.length };
      else if (token[0] === fence.char && token.length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const headingMatch = rawLine.match(/^(#{1,6})\s+(.+?)\s*$/u);
    if (!headingMatch) continue;
    headings.push({
      start,
      end: start + match[0].length,
      level: headingMatch[1].length,
      text: headingMatch[2].trim(),
      raw: rawLine,
    });
  }
  return headings;
}

function headingMatches(headings, level, rx) {
  return headings.filter((heading) => heading.level === level && rx.test(heading.text));
}

function sectionBody(markdown, headings, heading) {
  if (!heading) return "";
  const next = headings.find((candidate) => candidate.start > heading.start && candidate.level <= heading.level);
  return normalizeBody(markdown.slice(heading.end, next?.start ?? markdown.length));
}

function bodyBetween(markdown, start, end) {
  if (!start) return "";
  return normalizeBody(markdown.slice(start.end, end?.start ?? markdown.length));
}

function validateStructure(markdown, headings, strict, result) {
  const titleMatches = headingMatches(headings, 1, /^PATCH\.md\s+—\s+.+$/u);
  if (titleMatches.length !== 1) {
    addError(result, titleMatches.length === 0 ? "MISSING_SECTION" : "DUPLICATE_SECTION", "PATCH.md title must exist exactly once", "title");
  }

  const required = strict
    ? FIXED_V2_HEADINGS.slice(1)
    : FIXED_V2_HEADINGS.slice(1).filter(([, , label]) => !["expectedOutcome", "lifecycle", "rollback"].includes(label));
  const ordered = titleMatches.length === 1 ? [titleMatches[0]] : [];
  for (const [level, rx, label] of required) {
    const matches = headingMatches(headings, level, rx);
    if (matches.length !== 1) {
      addError(result, matches.length === 0 ? "MISSING_SECTION" : "DUPLICATE_SECTION", `Required section ${label} must exist exactly once`, label);
    } else {
      ordered.push(matches[0]);
    }
  }

  const allFixedLabels = new Map(FIXED_V2_HEADINGS.slice(1).map(([level, rx, label]) => [label, headingMatches(headings, level, rx)]));
  if (!strict) {
    if ((allFixedLabels.get("expectedOutcome") ?? []).length === 0) addWarning(result, "Legacy v1 patch: missing ### Expected outcome");
    if ((allFixedLabels.get("lifecycle") ?? []).length === 0) addWarning(result, "Legacy v1 patch: no machine-readable lifecycle manifest; apply is not trusted");
    if ((allFixedLabels.get("rollback") ?? []).length === 0) addWarning(result, "Legacy v1 patch: no rollback section");
  }

  const changes = headingMatches(headings, 2, /^Change\s+\d+\s+—\s+.+$/u);
  if (changes.length === 0) addError(result, "MISSING_SECTION", "At least one Change N section is required", "change");

  if (result.errors.length > 0) return;
  const expectedOrder = [
    titleMatches[0],
    allFixedLabels.get("purpose")?.[0],
    allFixedLabels.get("rootCause")?.[0],
    allFixedLabels.get("expectedOutcome")?.[0],
    allFixedLabels.get("lifecycle")?.[0],
    allFixedLabels.get("scope")?.[0],
    changes[0],
    allFixedLabels.get("verification")?.[0],
    allFixedLabels.get("rollback")?.[0],
    allFixedLabels.get("operationalNotes")?.[0],
  ].filter(Boolean);
  for (let i = 1; i < expectedOrder.length; i++) {
    if (expectedOrder[i].start <= expectedOrder[i - 1].start) {
      addError(result, "OUT_OF_ORDER_SECTION", "Required sections are not in canonical order", null);
      break;
    }
  }

  const verification = allFixedLabels.get("verification")?.[0];
  const rollback = allFixedLabels.get("rollback")?.[0];
  const operational = allFixedLabels.get("operationalNotes")?.[0];
  if (verification && changes.some((change) => change.start >= verification.start)) {
    addError(result, "OUT_OF_ORDER_SECTION", "All Change N sections must precede Verification steps", "change");
  }
  if (strict && rollback && operational && !(verification.start < rollback.start && rollback.start < operational.start)) {
    addError(result, "OUT_OF_ORDER_SECTION", "Verification, Rollback, and Operational notes are out of order", null);
  }
}

function parsePathVariables(scopeBody) {
  const vars = {};
  const blockMatches = [
    scopeBody.match(/(?:^|\n)Path variables:\s*\n([\s\S]*?)(?:\n\n|$)/iu),
    scopeBody.match(/(?:^|\n)Assume:\s*\n([\s\S]*?)(?:\n\n|$)/iu),
    scopeBody.match(/(?:^|\n)###\s+Path variables\s*\n([\s\S]*?)(?:\n\n|$)/iu),
  ].filter(Boolean);
  for (const blockMatch of blockMatches) {
    const rx = /`([A-Z0-9_]+)=([^`]+)`/gu;
    let match;
    while ((match = rx.exec(blockMatch[1])) !== null) vars[match[1]] = match[2].trim();
  }
  return vars;
}

function parseScopeFiles(scopeBody) {
  return [...scopeBody.matchAll(/^\d+\.\s+`([^`]+)`\s*$/gmu)].map((match) => match[1].trim());
}

function expandVariables(input, pathVariables, stack = [], depth = 0) {
  if (depth > 32) return { output: input, unresolved: [], cycles: [stack.join(" -> ") || "maximum expansion depth"] };
  const unresolved = [];
  const cycles = [];
  const output = input.replace(/\$\{([A-Z0-9_]+)\}/gu, (whole, name) => {
    if (stack.includes(name)) {
      cycles.push([...stack, name].join(" -> "));
      return whole;
    }
    const raw = Object.prototype.hasOwnProperty.call(pathVariables, name) ? pathVariables[name] : process.env[name];
    if (raw === undefined || raw === "") {
      unresolved.push(name);
      return whole;
    }
    const nested = expandVariables(String(raw), pathVariables, [...stack, name], depth + 1);
    unresolved.push(...nested.unresolved);
    cycles.push(...nested.cycles);
    return nested.output;
  });
  return { output, unresolved: [...new Set(unresolved)], cycles: [...new Set(cycles)] };
}

function isLogicalTarget(value) {
  return /^[a-z][a-z0-9+.-]*:/iu.test(value) && !/^[A-Za-z]:[\\/]/u.test(value);
}

function resolveDocumentPath(input, pathVariables, workspaceRoot, result, section) {
  const expanded = expandVariables(input, pathVariables);
  for (const name of expanded.unresolved) addError(result, "UNRESOLVED_PATH_VARIABLE", `Unresolved path variable: ${name}`, section);
  for (const cycle of expanded.cycles) addError(result, "CYCLIC_PATH_VARIABLE", `Cyclic path variable expansion: ${cycle}`, section);
  if (expanded.unresolved.length > 0 || expanded.cycles.length > 0 || isLogicalTarget(expanded.output)) return expanded.output;
  const normalized = expanded.output.replace(/\\/gu, "/");
  if (!workspaceRoot || path.posix.isAbsolute(normalized) || /^[A-Za-z]:[\\/]/u.test(expanded.output)) return normalized;
  return path.posix.resolve(workspaceRoot.replace(/\\/gu, "/"), normalized);
}

function parseChangeFiles(body) {
  const single = body.match(/\*\*File:\*\*\s+`([^`]+)`/u);
  if (single) return [single[1].trim()];
  const marker = body.match(/\*\*Files:\*\*\s*\n([\s\S]*?)(?=\n###\s+What was changed\b)/u);
  if (!marker) return [];
  return [...marker[1].matchAll(/^-\s+`([^`]+)`\s*$/gmu)].map((match) => match[1].trim());
}

function parseChanges(markdown, headings, verificationStart, result) {
  const changeHeadings = headingMatches(headings, 2, /^Change\s+\d+\s+—\s+.+$/u).sort((a, b) => a.start - b.start);
  const changes = [];
  const seenIndexes = new Set();
  for (let i = 0; i < changeHeadings.length; i++) {
    const current = changeHeadings[i];
    const end = changeHeadings[i + 1]?.start ?? verificationStart;
    const body = normalizeBody(markdown.slice(current.end, end));
    const titleMatch = current.text.match(/^Change\s+(\d+)\s+—\s+(.+)$/u);
    const index = Number(titleMatch?.[1]);
    const title = titleMatch?.[2]?.trim() ?? "";
    const files = parseChangeFiles(body);
    const whatMatch = body.match(/(?:^|\n)###\s+What was changed\s*\n([\s\S]*?)(?=\n###\s+Why\b)/u);
    const whyMatch = body.match(/(?:^|\n)###\s+Why\s*\n([\s\S]*)$/u);
    if (!Number.isInteger(index) || !title || files.length === 0 || !whatMatch || !whyMatch) {
      addError(result, "INVALID_CHANGE_BLOCK", `Change ${Number.isInteger(index) ? index : i + 1} is missing required fields`, `Change ${index || i + 1}`);
      continue;
    }
    if (seenIndexes.has(index)) addError(result, "DUPLICATE_CHANGE_INDEX", `Duplicate Change index: ${index}`, `Change ${index}`);
    seenIndexes.add(index);
    changes.push({
      index,
      title,
      file: files[0],
      files,
      whatChanged: normalizeBody(whatMatch[1]),
      why: normalizeBody(whyMatch[1]),
    });
  }
  changes.sort((a, b) => a.index - b.index);
  for (let i = 0; i < changes.length; i++) {
    if (changes[i].index !== i + 1) addError(result, "NON_CONTIGUOUS_CHANGES", `Change indexes must be contiguous from 1; found ${changes[i].index} at position ${i + 1}`, "change");
  }
  return changes;
}

function extractShellBlocks(body) {
  const blocks = [];
  const rx = /^(`{3,}|~{3,})(bash|sh)\s*\r?\n([\s\S]*?)^\1\s*$/gimu;
  let match;
  while ((match = rx.exec(body)) !== null) {
    const script = match[3].replace(/\r\n/gu, "\n").trim();
    if (script) blocks.push(script);
  }
  return blocks;
}

function parseExpected(body) {
  const expected = [];
  const expectedMatch = body.match(/(?:^|\n)Expected:\s*\n([\s\S]*)$/iu);
  if (!expectedMatch) return expected;
  for (const match of expectedMatch[1].matchAll(/^-\s+(.+)$/gmu)) expected.push(match[1].trim());
  return expected;
}

function parseVerification(body) {
  const runFromMatch = body.match(/Run from\s+`([^`]+)`/iu);
  const commands = extractShellBlocks(body);
  return {
    runFrom: runFromMatch?.[1]?.trim() ?? "",
    commands,
    shellBlocks: commands,
    expected: parseExpected(body),
  };
}

function parseBulletNotes(body) {
  return [...body.matchAll(/^-\s+(.+)$/gmu)].map((match) => match[1].trim());
}

function parseLifecycle(body) {
  const manifestMatch = body.match(/\*\*Manifest:\*\*\s+`([^`]+)`/u);
  return { manifestPath: manifestMatch?.[1]?.trim() ?? "", resolvedManifestPath: "", manifest: null };
}

function resolveContainedFile(baseDir, requestedPath) {
  const candidate = path.resolve(baseDir, requestedPath);
  const relative = path.relative(baseDir, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Path escapes patch directory: ${requestedPath}`);
  return candidate;
}

function validateManifest(manifest, manifestPath) {
  const errors = [];
  const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return ["manifest must be an object"];
  if (manifest.schemaVersion !== V2_SCHEMA_VERSION) errors.push(`schemaVersion must be ${V2_SCHEMA_VERSION}`);
  for (const key of ["id", "version", "title", "description"]) if (!nonEmpty(manifest[key])) errors.push(`${key} must be a non-empty string`);
  if (!/^[a-z0-9][a-z0-9._-]+$/u.test(String(manifest.id || ""))) errors.push("id must contain only lowercase letters, digits, dots, underscores, and hyphens");

  const risk = manifest.risk;
  if (!risk || typeof risk !== "object" || Array.isArray(risk)) errors.push("risk object is required");
  else {
    if (!["low", "medium", "high", "critical"].includes(risk.level)) errors.push("risk.level is invalid");
    if (typeof risk.mutatesInstalledPackages !== "boolean") errors.push("risk.mutatesInstalledPackages must be boolean");
    if (!["none", "optional", "required"].includes(risk.network)) errors.push("risk.network is invalid");
    if (!["none", "optional", "possible"].includes(risk.billing)) errors.push("risk.billing is invalid");
  }

  if (!manifest.lifecycle || typeof manifest.lifecycle !== "object" || !nonEmpty(manifest.lifecycle.handler)) errors.push("lifecycle.handler is required");
  const support = manifest.support;
  if (!support || typeof support !== "object") errors.push("support object is required");
  else {
    const validPlatforms = new Set(["linux", "darwin", "win32"]);
    if (!Array.isArray(support.platforms) || support.platforms.length === 0 || support.platforms.some((item) => !validPlatforms.has(item))) errors.push("support.platforms must contain known platforms");
    if (!Array.isArray(support.packages) || support.packages.length === 0) errors.push("support.packages must be non-empty");
    else support.packages.forEach((entry, index) => {
      if (!entry || !nonEmpty(entry.name) || !nonEmpty(entry.range)) errors.push(`support.packages[${index}] requires name and range`);
    });
  }

  if (!Array.isArray(manifest.targets) || manifest.targets.length === 0) errors.push("targets must be a non-empty array");
  else {
    const targetIds = new Set();
    manifest.targets.forEach((target, index) => {
      if (!target || typeof target !== "object") { errors.push(`targets[${index}] must be an object`); return; }
      for (const key of ["id", "role", "package"]) if (!nonEmpty(target[key])) errors.push(`targets[${index}].${key} is required`);
      if (targetIds.has(target.id)) errors.push(`duplicate target id: ${target.id}`);
      targetIds.add(target.id);
      if (typeof target.required !== "boolean") errors.push(`targets[${index}].required must be boolean`);
      if (!target.discover || typeof target.discover !== "object") errors.push(`targets[${index}].discover is required`);
      if (!Array.isArray(target.fileCandidates) || target.fileCandidates.length === 0 || target.fileCandidates.some((item) => !nonEmpty(item))) errors.push(`targets[${index}].fileCandidates must be non-empty`);
      if (!Array.isArray(target.fingerprints) || target.fingerprints.length === 0 || target.fingerprints.some((item) => !nonEmpty(item))) errors.push(`targets[${index}].fingerprints must be non-empty`);
    });
  }

  if (!Array.isArray(manifest.verification) || manifest.verification.length === 0) errors.push("verification must be a non-empty array");
  else manifest.verification.forEach((step, index) => {
    if (!step || !nonEmpty(step.id)) errors.push(`verification[${index}].id is required`);
    if (!step || !["pre-apply", "post-apply", "manual"].includes(step.phase)) errors.push(`verification[${index}].phase is invalid`);
    if (!step || !["handler", "argv"].includes(step.runner)) errors.push(`verification[${index}].runner is invalid`);
    if (step?.runner === "argv" && (!Array.isArray(step.argv) || step.argv.length === 0 || step.argv.some((item) => typeof item !== "string"))) errors.push(`verification[${index}].argv is required for argv runner`);
    if (typeof step?.network !== "boolean" || typeof step?.billing !== "boolean") errors.push(`verification[${index}] requires network and billing booleans`);
  });
  if (!manifest.rollback || manifest.rollback.supported !== true || !["receipt-backup", "package-reinstall", "custom"].includes(manifest.rollback.strategy)) errors.push("rollback must be supported with a valid strategy");

  if (errors.length === 0) {
    const baseDir = path.dirname(manifestPath);
    try {
      const handler = resolveContainedFile(baseDir, manifest.lifecycle.handler);
      if (!fs.existsSync(handler)) errors.push(`lifecycle handler does not exist: ${manifest.lifecycle.handler}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return errors;
}

function loadLifecycleManifest(patchPath, lifecycle, result) {
  if (!lifecycle.manifestPath) {
    addError(result, "MISSING_MANIFEST", "Lifecycle section must declare **Manifest:** `./patch.manifest.json`", "lifecycle");
    return lifecycle;
  }
  let manifestPath;
  try {
    manifestPath = resolveContainedFile(path.dirname(patchPath), lifecycle.manifestPath);
  } catch (error) {
    addError(result, "MANIFEST_PATH_ESCAPE", error instanceof Error ? error.message : String(error), "lifecycle");
    return lifecycle;
  }
  lifecycle.resolvedManifestPath = manifestPath;
  if (!fs.existsSync(manifestPath)) {
    addError(result, "MANIFEST_NOT_FOUND", `Manifest not found: ${manifestPath}`, "lifecycle");
    return lifecycle;
  }
  try {
    lifecycle.manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    addError(result, "INVALID_MANIFEST", `Could not parse manifest JSON: ${error instanceof Error ? error.message : String(error)}`, "lifecycle");
    return lifecycle;
  }
  for (const message of validateManifest(lifecycle.manifest, manifestPath)) addError(result, "INVALID_MANIFEST", message, "lifecycle");
  return lifecycle;
}

function buildEmptyPatch() {
  return {
    title: "",
    purpose: "",
    rootCause: "",
    expectedOutcome: "",
    pathVariables: {},
    scopeFiles: [],
    changes: [],
    lifecycle: { manifestPath: "", resolvedManifestPath: "", manifest: null },
    verification: { runFrom: "", commands: [], shellBlocks: [], expected: [] },
    rollback: { commands: [], shellBlocks: [], notes: [] },
    operationalNotes: [],
  };
}

export function parsePatch(markdown, options = {}) {
  const strict = options.strict !== false;
  const patchPath = path.resolve(options.patchPath ?? "PATCH.md");
  const result = { schemaVersion: strict ? V2_SCHEMA_VERSION : "1.0-legacy", ok: false, patch: buildEmptyPatch(), errors: [], warnings: [] };
  const headings = scanHeadings(markdown);
  validateStructure(markdown, headings, strict, result);
  if (result.errors.length > 0) return result;

  const first = (level, rx) => headingMatches(headings, level, rx)[0];
  const titleHeading = first(1, /^PATCH\.md\s+—\s+.+$/u);
  const purposeHeading = first(2, /^Purpose$/u);
  const rootHeading = first(3, /^Root cause$/u);
  const expectedHeading = first(3, /^Expected outcome$/u);
  const lifecycleHeading = first(2, /^Lifecycle$/u);
  const scopeHeading = first(2, /^Scope \(exact files changed\)$/u);
  const firstChangeHeading = first(2, /^Change\s+\d+\s+—\s+.+$/u);
  const verificationHeading = first(2, /^Verification steps$/u);
  const rollbackHeading = first(2, /^Rollback$/u);
  const operationalHeading = first(2, /^Operational notes$/u);

  result.patch.title = titleHeading.text.replace(/^PATCH\.md\s+—\s+/u, "").trim();
  result.patch.purpose = bodyBetween(markdown, purposeHeading, rootHeading);
  result.patch.rootCause = bodyBetween(markdown, rootHeading, expectedHeading ?? lifecycleHeading ?? scopeHeading);
  result.patch.expectedOutcome = expectedHeading ? bodyBetween(markdown, expectedHeading, lifecycleHeading ?? scopeHeading) : "";

  if (lifecycleHeading) {
    result.patch.lifecycle = parseLifecycle(sectionBody(markdown, headings, lifecycleHeading));
    result.patch.lifecycle = loadLifecycleManifest(patchPath, result.patch.lifecycle, result);
  } else if (strict) {
    addError(result, "MISSING_MANIFEST", "Strict mode requires a Lifecycle manifest", "lifecycle");
  }

  const scopeBody = normalizeBody(markdown.slice(scopeHeading.end, firstChangeHeading.start));
  result.patch.pathVariables = parsePathVariables(scopeBody);
  result.patch.scopeFiles = parseScopeFiles(scopeBody);
  if (result.patch.scopeFiles.length === 0) addError(result, "EMPTY_SCOPE", "No files or logical targets listed in Scope", "scope");

  result.patch.changes = parseChanges(markdown, headings, verificationHeading.start, result);
  result.patch.verification = parseVerification(bodyBetween(markdown, verificationHeading, rollbackHeading ?? operationalHeading));
  if (result.patch.verification.commands.length === 0) addError(result, "EMPTY_VERIFICATION", "No complete bash/sh verification block listed", "verification");

  if (rollbackHeading) {
    const rollbackBody = bodyBetween(markdown, rollbackHeading, operationalHeading);
    const commands = extractShellBlocks(rollbackBody);
    result.patch.rollback = { commands, shellBlocks: commands, notes: parseBulletNotes(rollbackBody) };
    if (strict && commands.length === 0) addError(result, "EMPTY_ROLLBACK", "Strict v2 patches require a rollback command block", "rollback");
  }
  result.patch.operationalNotes = parseBulletNotes(sectionBody(markdown, headings, operationalHeading));

  result.patch.scopeFiles = result.patch.scopeFiles.map((entry) => resolveDocumentPath(entry, result.patch.pathVariables, options.workspaceRoot ?? "", result, "scope"));
  result.patch.changes = result.patch.changes.map((change) => {
    const files = change.files.map((entry) => resolveDocumentPath(entry, result.patch.pathVariables, options.workspaceRoot ?? "", result, `Change ${change.index}`));
    return { ...change, file: files[0], files };
  });

  if (strict) {
    const scope = new Set(result.patch.scopeFiles);
    const changed = new Set(result.patch.changes.flatMap((change) => change.files));
    for (const file of scope) if (!changed.has(file)) addError(result, "UNMAPPED_SCOPE_FILE", `Scoped target has no Change mapping: ${file}`, "scope");
    for (const file of changed) if (!scope.has(file)) addError(result, "CHANGE_OUTSIDE_SCOPE", `Change target is not listed in Scope: ${file}`, "change");
  }

  result.ok = result.errors.length === 0;
  return result;
}

export function parsePatchFile(patchPath, options = {}) {
  const absolute = path.resolve(patchPath);
  if (!fs.existsSync(absolute)) {
    const result = { schemaVersion: options.strict === false ? "1.0-legacy" : V2_SCHEMA_VERSION, ok: false, patch: buildEmptyPatch(), errors: [], warnings: [] };
    addError(result, "FILE_NOT_FOUND", `PATCH file not found: ${absolute}`, null);
    return result;
  }
  try {
    return parsePatch(fs.readFileSync(absolute, "utf8"), { ...options, patchPath: absolute });
  } catch (error) {
    const result = { schemaVersion: options.strict === false ? "1.0-legacy" : V2_SCHEMA_VERSION, ok: false, patch: buildEmptyPatch(), errors: [], warnings: [] };
    addError(result, "INVALID_MARKDOWN", error instanceof Error ? error.message : String(error), null);
    return result;
  }
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const result = parsePatchFile(options.patchPath, options);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
