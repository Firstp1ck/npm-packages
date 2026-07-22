import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  gitMessageArtifactPairReadiness,
  readStableGitMessageArtifactPair,
  sameGitMessageArtifactPair,
  sameGitMessageArtifactVersion,
} from "../lib/git-message-artifacts.mjs";

const root = await mkdtemp(path.join(tmpdir(), "pi-webui-git-messages-"));
const commitDir = path.join(root, "dev", "COMMIT");
const paths = {
  shortPath: path.join(commitDir, "staged-commit-short.txt"),
  longPath: path.join(commitDir, "staged-commit-long.txt"),
};

try {
  await mkdir(commitDir, { recursive: true });

  const missingBaseline = await readStableGitMessageArtifactPair(paths);
  assert.equal(missingBaseline.short.exists, false);
  assert.equal(missingBaseline.long.exists, false);
  assert.equal(gitMessageArtifactPairReadiness(missingBaseline, missingBaseline).ready, false, "missing files must not be ready");

  await writeFile(paths.shortPath, "feat: correlated message\n", "utf8");
  await writeFile(paths.longPath, "feat: correlated message\n\n- feat: load both files\n", "utf8");
  const firstPair = await readStableGitMessageArtifactPair(paths);
  assert.equal(gitMessageArtifactPairReadiness(missingBaseline, firstPair).ready, true, "two new non-empty files should be ready");
  assert.equal(sameGitMessageArtifactPair(firstPair, await readStableGitMessageArtifactPair(paths)), true, "unchanged stable pairs should compare equal");

  await writeFile(paths.shortPath, "fix: only short changed\n", "utf8");
  const partialPair = await readStableGitMessageArtifactPair(paths);
  const partialReadiness = gitMessageArtifactPairReadiness(firstPair, partialPair);
  assert.equal(partialReadiness.ready, false, "one stale member must keep the pair pending");
  assert.deepEqual(partialReadiness.unchanged, ["long"]);

  await new Promise((resolve) => setTimeout(resolve, 10));
  await writeFile(paths.shortPath, firstPair.short.text, "utf8");
  await writeFile(paths.longPath, firstPair.long.text, "utf8");
  const identicalRewrite = await readStableGitMessageArtifactPair(paths);
  assert.equal(identicalRewrite.short.sha256, firstPair.short.sha256, "test setup keeps identical short content");
  assert.equal(identicalRewrite.long.sha256, firstPair.long.sha256, "test setup keeps identical long content");
  assert.equal(sameGitMessageArtifactVersion(firstPair.short, identicalRewrite.short), false, "metadata must identify an identical-content rewrite");
  assert.equal(sameGitMessageArtifactVersion(firstPair.long, identicalRewrite.long), false, "both identical-content rewrites must be fresh");
  assert.equal(gitMessageArtifactPairReadiness(firstPair, identicalRewrite).ready, true, "identical generated text is valid when both files were rewritten");

  await writeFile(paths.shortPath, "", "utf8");
  await writeFile(paths.longPath, "fix: long is present\n", "utf8");
  const emptyPair = await readStableGitMessageArtifactPair(paths);
  const emptyReadiness = gitMessageArtifactPairReadiness(identicalRewrite, emptyPair);
  assert.equal(emptyReadiness.ready, false, "empty generated files must remain pending");
  assert.deepEqual(emptyReadiness.empty, ["short"]);

  console.log("git message artifact tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
