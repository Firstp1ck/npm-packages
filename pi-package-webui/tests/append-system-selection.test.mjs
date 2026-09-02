import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  APPEND_SYSTEM_DIAGNOSTIC_KINDS,
  APPEND_SYSTEM_DISCOVERY_LIMITS,
  discoverAppendSystemFiles,
  normalizeAppendSystemPromptPath,
  normalizeAppendSystemPromptRootPath,
  validateAppendSystemSelection,
  validateSavedAppendSystemSelection,
} from "../lib/append-system-selection.mjs";
import {
  normalizeWebuiSettings,
  readWebuiSettings,
  writeWebuiSettings,
} from "../lib/git-workflow-preferences.mjs";

const root = await mkdtemp(path.join(tmpdir(), "pi-webui-append-system-"));
const piRoot = path.join(root, ".pi");
const projectRoot = path.join(root, "project");

async function touch(file) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `fixture:${path.basename(path.dirname(file))}\n`, "utf8");
}

try {
  await mkdir(piRoot, { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  const piCandidate = path.join(piRoot, "APPEND_SYSTEM.md");
  const projectCandidate = path.join(projectRoot, "APPEND_SYSTEM.md");
  const depth10Directory = path.join(projectRoot, ...Array.from({ length: 10 }, (_, index) => `d${index + 1}`));
  const depth10Candidate = path.join(depth10Directory, "APPEND_SYSTEM.md");
  const depth11Candidate = path.join(depth10Directory, "d11", "APPEND_SYSTEM.md");
  await Promise.all([
    touch(piCandidate),
    touch(projectCandidate),
    touch(depth10Candidate),
    touch(depth11Candidate),
    touch(path.join(projectRoot, "append_system.md")),
    touch(path.join(projectRoot, "APPEND_SYSTEM.MD")),
  ]);

  const outside = path.join(root, "outside");
  const outsideCandidate = path.join(outside, "APPEND_SYSTEM.md");
  const differentlyNamedTarget = path.join(outside, "actual-prompt.txt");
  await Promise.all([touch(outsideCandidate), touch(differentlyNamedTarget)]);
  const linkedDirectory = path.join(projectRoot, "linked-directory");
  const linkedDirectoryCandidate = path.join(linkedDirectory, "APPEND_SYSTEM.md");
  const linkedFileCandidate = path.join(projectRoot, "linked-file", "APPEND_SYSTEM.md");
  const brokenLink = path.join(projectRoot, "broken", "APPEND_SYSTEM.md");
  let symlinksAvailable = true;
  try {
    await symlink(outside, linkedDirectory, process.platform === "win32" ? "junction" : "dir");
    await mkdir(path.dirname(linkedFileCandidate));
    await symlink(differentlyNamedTarget, linkedFileCandidate, "file");
    await mkdir(path.dirname(brokenLink));
    await symlink(path.join(root, "missing-target"), brokenLink, "file");
  } catch (error) {
    symlinksAvailable = false;
    if (!["EPERM", "EACCES", "EINVAL", "ENOTSUP", "ENOENT"].includes(error?.code)) throw error;
  }

  const discovered = await discoverAppendSystemFiles({ piRoot, cwd: projectRoot });
  const expectedCandidates = [piCandidate, projectCandidate, depth10Candidate];
  if (symlinksAvailable) expectedCandidates.push(linkedDirectoryCandidate, linkedFileCandidate);
  assert.deepEqual(discovered.candidates.map((candidate) => candidate.path), expectedCandidates.sort());
  assert.ok(discovered.candidates.every((candidate) => Object.keys(candidate).sort().join(",") === "path,rootLabel"));
  assert.equal(discovered.candidates.some(({ path: candidatePath }) => candidatePath === depth11Candidate), false, "depth 11 must be excluded");
  assert.equal(discovered.candidates.some(({ path: candidatePath }) => candidatePath === outsideCandidate), false, "candidate paths must retain their visible aliases");
  assert.equal(JSON.stringify(discovered).includes("fixture:"), false, "discovery must not return file contents");
  assert.equal(discovered.limits.maxDepth, 10);
  assert.equal(discovered.diagnostics.length <= APPEND_SYSTEM_DISCOVERY_LIMITS.maxDiagnostics, true);
  assert.ok(discovered.diagnostics.every(({ kind }) => APPEND_SYSTEM_DIAGNOSTIC_KINDS.includes(kind)), "diagnostic kinds must come from the bounded public catalog");
  if (symlinksAvailable) {
    assert.ok(discovered.diagnostics.some(({ kind, path: diagnosticPath }) => kind === "symlink-inaccessible" && diagnosticPath === brokenLink));
    assert.equal(discovered.candidates.some(({ path: candidatePath }) => candidatePath === brokenLink), false, "broken links must be omitted");
  }

  const overlapping = await discoverAppendSystemFiles({ piRoot: root, cwd: projectRoot });
  assert.equal(overlapping.candidates.filter(({ path: candidatePath }) => candidatePath === projectCandidate).length, 1, "overlapping roots must deduplicate candidates");
  assert.deepEqual(overlapping.candidates.map(({ path: candidatePath }) => candidatePath), [...new Set(overlapping.candidates.map(({ path: candidatePath }) => candidatePath))].sort(), "candidate output must be deterministic and sorted");

  const valid = await validateAppendSystemSelection(path.join(projectRoot, "d1", "..", "APPEND_SYSTEM.md"), { piRoot, cwd: projectRoot });
  assert.equal(valid?.path, projectCandidate, "selection validation must normalize a fresh visible candidate");
  assert.equal(valid?.rootPath, projectRoot, "selection validation must retain its lexical discovery root as provenance");
  const controlCharacterPaths = ["\n", "\r", "\t", "\u007f", "\0"].map((control) => `${projectRoot}${path.sep}unsafe${control}${path.sep}APPEND_SYSTEM.md`);
  for (const unsafePath of controlCharacterPaths) {
    assert.equal(normalizeAppendSystemPromptPath(unsafePath), null, "prompt path normalization must reject every tested control character");
    assert.equal(normalizeAppendSystemPromptRootPath(path.dirname(unsafePath)), null, "root path normalization must reject every tested control character");
    assert.equal(await validateAppendSystemSelection(unsafePath, { piRoot, cwd: projectRoot }), null, "fresh selection validation must reject control characters before filesystem lookup");
    assert.equal(await validateSavedAppendSystemSelection(unsafePath, projectRoot), null, "saved selection validation must reject control characters before filesystem lookup");
  }
  if (process.platform !== "win32") {
    const discoverableControlPaths = controlCharacterPaths.filter((candidatePath) => !candidatePath.includes("\0"));
    await Promise.all(discoverableControlPaths.map(touch));
    const controlDiscovery = await discoverAppendSystemFiles({ piRoot, cwd: projectRoot });
    assert.equal(controlDiscovery.candidates.some(({ path: candidatePath }) => /[\u0000-\u001f\u007f]/.test(candidatePath)), false, "control-character candidates must be omitted from discovery");
  }
  assert.equal(await validateAppendSystemSelection(outsideCandidate, { piRoot, cwd: projectRoot }), null, "arbitrary regular files outside the approved roots must be rejected");
  assert.equal(await validateAppendSystemSelection(depth11Candidate, { piRoot, cwd: projectRoot }), null, "depth 11 files must be rejected");
  assert.deepEqual(await validateSavedAppendSystemSelection(projectCandidate, projectRoot), { path: projectCandidate, rootPath: projectRoot });
  assert.equal(await validateSavedAppendSystemSelection(outsideCandidate, projectRoot), null, "saved paths lexically outside their root must be rejected");
  assert.equal(await validateSavedAppendSystemSelection(depth11Candidate, projectRoot), null, "saved paths beyond depth 10 must be rejected");
  assert.equal(await validateSavedAppendSystemSelection(path.join(projectRoot, "append_system.md"), projectRoot), null, "saved paths must retain the exact APPEND_SYSTEM.md basename");
  assert.equal(await validateSavedAppendSystemSelection(projectCandidate, projectCandidate), null, "saved roots must resolve to directories");
  if (symlinksAvailable) {
    assert.deepEqual(
      await validateSavedAppendSystemSelection(linkedFileCandidate, projectRoot),
      { path: linkedFileCandidate, rootPath: projectRoot },
      "saved exact-name file aliases may resolve to differently named external regular files",
    );
    assert.deepEqual(
      await validateSavedAppendSystemSelection(linkedDirectoryCandidate, projectRoot),
      { path: linkedDirectoryCandidate, rootPath: projectRoot },
      "saved directory aliases may resolve outside their lexical root",
    );
    assert.equal((await validateAppendSystemSelection(linkedFileCandidate, { piRoot, cwd: projectRoot }))?.path, linkedFileCandidate, "fresh validation must preserve the visible file alias");
    assert.equal(await validateSavedAppendSystemSelection(brokenLink, projectRoot), null, "broken saved aliases must be rejected");
    const nonRegularAlias = path.join(projectRoot, "non-regular", "APPEND_SYSTEM.md");
    await mkdir(path.dirname(nonRegularAlias));
    await symlink(outside, nonRegularAlias, process.platform === "win32" ? "junction" : "dir");
    assert.equal(await validateSavedAppendSystemSelection(nonRegularAlias, projectRoot), null, "saved aliases resolving to non-regular targets must be rejected");
  }

  const stalePath = path.join(projectRoot, "deleted", "APPEND_SYSTEM.md");
  const stale = await discoverAppendSystemFiles({ piRoot, cwd: projectRoot, savedPath: stalePath });
  assert.equal(stale.appendSystemPromptPath, stalePath, "a normalized stale selection remains visible");
  assert.ok(stale.diagnostics.some(({ kind, path: diagnosticPath }) => kind === "saved-selection-invalid" && diagnosticPath === stalePath));

  const cappedRoot = path.join(root, "capped");
  await mkdir(cappedRoot, { recursive: true });
  await Promise.all(Array.from({ length: APPEND_SYSTEM_DISCOVERY_LIMITS.maxCandidates + 1 }, (_, index) => touch(path.join(cappedRoot, `candidate-${String(index).padStart(3, "0")}`, "APPEND_SYSTEM.md"))));
  const cappedCandidates = await discoverAppendSystemFiles({ piRoot: cappedRoot, cwd: cappedRoot });
  assert.equal(cappedCandidates.candidates.length, APPEND_SYSTEM_DISCOVERY_LIMITS.maxCandidates);
  assert.equal(cappedCandidates.limits.truncated.candidates, true);
  assert.ok(cappedCandidates.diagnostics.some(({ kind }) => kind === "candidate-limit"));
  const candidateCrowdedOutPath = path.join(cappedRoot, `candidate-${APPEND_SYSTEM_DISCOVERY_LIMITS.maxCandidates}`, "APPEND_SYSTEM.md");
  assert.equal(cappedCandidates.candidates.some(({ path: candidatePath }) => candidatePath === candidateCrowdedOutPath), false);
  const excludedCandidatePath = path.join(cappedRoot, "candidate-000", "APPEND_SYSTEM.md");
  const cappedWithExclusion = await discoverAppendSystemFiles({
    piRoot: cappedRoot,
    cwd: cappedRoot,
    excludedPaths: [excludedCandidatePath],
  });
  assert.equal(cappedWithExclusion.candidates.length, APPEND_SYSTEM_DISCOVERY_LIMITS.maxCandidates, "an excluded candidate must not consume a candidate slot");
  assert.equal(cappedWithExclusion.candidates.some(({ path: candidatePath }) => candidatePath === excludedCandidatePath), false);
  assert.equal(cappedWithExclusion.candidates.some(({ path: candidatePath }) => candidatePath === candidateCrowdedOutPath), true, "the next eligible candidate must fill the excluded slot");
  assert.equal(cappedWithExclusion.limits.truncated.candidates, false, "exactly 256 eligible candidates must not report truncation");
  assert.deepEqual(
    await validateSavedAppendSystemSelection(candidateCrowdedOutPath, cappedRoot),
    { path: candidateCrowdedOutPath, rootPath: cappedRoot },
    "saved validation must not depend on the candidate discovery cap",
  );

  const directoryCapRoot = path.join(root, "directory-cap");
  await mkdir(directoryCapRoot, { recursive: true });
  await Promise.all(Array.from({ length: APPEND_SYSTEM_DISCOVERY_LIMITS.maxVisitedDirectories + 8 }, (_, index) => mkdir(path.join(directoryCapRoot, `directory-${String(index).padStart(4, "0")}`))));
  const directoryCrowdedOutPath = path.join(directoryCapRoot, "zz-saved", "APPEND_SYSTEM.md");
  await touch(directoryCrowdedOutPath);
  const fairProjectRoot = path.join(root, "fair-project");
  const fairProjectCandidate = path.join(fairProjectRoot, "APPEND_SYSTEM.md");
  await touch(fairProjectCandidate);
  const cappedDirectories = await discoverAppendSystemFiles({ piRoot: directoryCapRoot, cwd: fairProjectRoot });
  assert.equal(cappedDirectories.limits.visitedDirectories, APPEND_SYSTEM_DISCOVERY_LIMITS.maxVisitedDirectories);
  assert.equal(cappedDirectories.limits.truncated.directories, true);
  assert.ok(cappedDirectories.diagnostics.some(({ kind }) => kind === "directory-limit"));
  assert.ok(cappedDirectories.candidates.some(({ path: candidatePath }) => candidatePath === fairProjectCandidate), "the shared directory budget must not let the first root starve the active cwd root");
  assert.equal(cappedDirectories.candidates.some(({ path: candidatePath }) => candidatePath === directoryCrowdedOutPath), false);
  assert.deepEqual(
    await validateSavedAppendSystemSelection(directoryCrowdedOutPath, directoryCapRoot),
    { path: directoryCrowdedOutPath, rootPath: directoryCapRoot },
    "saved validation must not depend on the visited-directory cap",
  );

  if (symlinksAvailable) {
    const symlinkRootTarget = path.join(root, "symlink-root-target");
    const symlinkRootAlias = path.join(root, "symlink-root-alias");
    const symlinkRootCandidate = path.join(symlinkRootAlias, "APPEND_SYSTEM.md");
    await touch(path.join(symlinkRootTarget, "APPEND_SYSTEM.md"));
    await symlink(symlinkRootTarget, symlinkRootAlias, process.platform === "win32" ? "junction" : "dir");
    const symlinkRootDiscovery = await discoverAppendSystemFiles({ piRoot: symlinkRootAlias });
    assert.deepEqual(symlinkRootDiscovery.roots, [{ path: symlinkRootAlias, label: "Pi home" }]);
    assert.deepEqual(symlinkRootDiscovery.candidates.map(({ path: candidatePath }) => candidatePath), [symlinkRootCandidate]);
    assert.deepEqual(
      await validateSavedAppendSystemSelection(symlinkRootCandidate, symlinkRootAlias),
      { path: symlinkRootCandidate, rootPath: symlinkRootAlias },
      "a saved alias under a symlinked root must remain valid",
    );

    const duplicateRoot = path.join(root, "canonical-duplicate");
    const duplicateTarget = path.join(root, "canonical-duplicate-target");
    await touch(path.join(duplicateTarget, "APPEND_SYSTEM.md"));
    await mkdir(duplicateRoot);
    await symlink(duplicateTarget, path.join(duplicateRoot, "a-link"), process.platform === "win32" ? "junction" : "dir");
    await symlink(duplicateTarget, path.join(duplicateRoot, "b-link"), process.platform === "win32" ? "junction" : "dir");
    await symlink(duplicateRoot, path.join(duplicateTarget, "cycle"), process.platform === "win32" ? "junction" : "dir");
    const duplicateDiscovery = await discoverAppendSystemFiles({ piRoot: duplicateRoot });
    assert.deepEqual(
      duplicateDiscovery.candidates.map(({ path: candidatePath }) => candidatePath),
      [path.join(duplicateRoot, "a-link", "APPEND_SYSTEM.md")],
      "the first deterministic alias to a canonical directory must provide its visible candidate path",
    );
    assert.equal(duplicateDiscovery.limits.visitedDirectories, 2, "canonical duplicate aliases and cycles must not consume repeated scan turns");
    assert.equal(duplicateDiscovery.limits.truncated.directories, false, "a cycle must terminate without reaching the directory cap");

    const aliasDepthRoot = path.join(root, "alias-depth-root");
    const aliasDepthTarget = path.join(root, "alias-depth-target");
    const depth9Directory = path.join(aliasDepthTarget, ...Array.from({ length: 9 }, (_, index) => `a${index + 1}`));
    const aliasDepth10Candidate = path.join(aliasDepthRoot, "linked", ...Array.from({ length: 9 }, (_, index) => `a${index + 1}`), "APPEND_SYSTEM.md");
    const aliasDepth11Candidate = path.join(path.dirname(aliasDepth10Candidate), "a10", "APPEND_SYSTEM.md");
    await Promise.all([touch(path.join(depth9Directory, "APPEND_SYSTEM.md")), touch(path.join(depth9Directory, "a10", "APPEND_SYSTEM.md"))]);
    await mkdir(aliasDepthRoot);
    await symlink(aliasDepthTarget, path.join(aliasDepthRoot, "linked"), process.platform === "win32" ? "junction" : "dir");
    const aliasDepthDiscovery = await discoverAppendSystemFiles({ piRoot: aliasDepthRoot });
    assert.ok(aliasDepthDiscovery.candidates.some(({ path: candidatePath }) => candidatePath === aliasDepth10Candidate), "a directory alias must count as one edge and include depth 10");
    assert.equal(aliasDepthDiscovery.candidates.some(({ path: candidatePath }) => candidatePath === aliasDepth11Candidate), false, "depth 11 through a directory alias must be excluded");
    assert.equal(await validateSavedAppendSystemSelection(aliasDepth11Candidate, aliasDepthRoot), null, "saved alias depth must be measured lexically");

    const diagnosticCapRoot = path.join(root, "diagnostic-cap");
    await mkdir(diagnosticCapRoot, { recursive: true });
    await Promise.all(Array.from({ length: APPEND_SYSTEM_DISCOVERY_LIMITS.maxDiagnostics + 8 }, (_, index) => symlink(path.join(root, `missing-${index}`), path.join(diagnosticCapRoot, `link-${String(index).padStart(3, "0")}`), "file")));
    const cappedDiagnostics = await discoverAppendSystemFiles({ piRoot: diagnosticCapRoot, cwd: diagnosticCapRoot });
    assert.equal(cappedDiagnostics.diagnostics.length, APPEND_SYSTEM_DISCOVERY_LIMITS.maxDiagnostics);
    assert.equal(cappedDiagnostics.limits.truncated.diagnostics, true);
    assert.equal(cappedDiagnostics.diagnostics.at(-1)?.kind, "diagnostic-limit");
  }

  assert.equal(normalizeAppendSystemPromptPath(undefined), null);
  assert.equal(normalizeAppendSystemPromptPath("relative/APPEND_SYSTEM.md"), null);
  assert.equal(normalizeAppendSystemPromptPath(` ${projectCandidate} `), projectCandidate);
  assert.equal(normalizeAppendSystemPromptRootPath("relative/project"), null);
  assert.equal(normalizeAppendSystemPromptRootPath(` ${projectRoot} `), projectRoot);
  assert.equal(normalizeWebuiSettings({ appendSystemPromptPath: 42, appendSystemPromptRootPath: 42 }).appendSystemPromptPath, null);
  assert.equal(normalizeWebuiSettings({ appendSystemPromptPath: 42, appendSystemPromptRootPath: 42 }).appendSystemPromptRootPath, null);
  assert.equal(normalizeWebuiSettings({ appendSystemPromptPath: stalePath, appendSystemPromptRootPath: projectRoot }).appendSystemPromptPath, stalePath);
  assert.equal(normalizeWebuiSettings({ appendSystemPromptPath: stalePath, appendSystemPromptRootPath: projectRoot }).appendSystemPromptRootPath, projectRoot);

  const settingsFile = path.join(root, "settings.json");
  await writeFile(settingsFile, `${JSON.stringify({ version: 8, remoteAuthEnabled: true, futureField: { retained: true } })}\n`, "utf8");
  await writeWebuiSettings({ appendSystemPromptPath: projectCandidate, appendSystemPromptRootPath: projectRoot }, settingsFile);
  let persisted = JSON.parse(await readFile(settingsFile, "utf8"));
  assert.equal(persisted.appendSystemPromptPath, projectCandidate);
  assert.equal(persisted.appendSystemPromptRootPath, projectRoot);
  assert.equal(persisted.remoteAuthEnabled, true);
  assert.deepEqual(persisted.futureField, { retained: true }, "existing settings fields must survive selection updates");
  await writeWebuiSettings({ appendSystemPromptPath: null, appendSystemPromptRootPath: null }, settingsFile);
  persisted = JSON.parse(await readFile(settingsFile, "utf8"));
  assert.equal(persisted.appendSystemPromptPath, null, "clear must restore nullable default discovery state");
  assert.equal(persisted.appendSystemPromptRootPath, null);
  assert.deepEqual(persisted.futureField, { retained: true });
  assert.equal((await readWebuiSettings(settingsFile)).appendSystemPromptPath, null);

  console.log("append-system-selection.test.mjs passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
