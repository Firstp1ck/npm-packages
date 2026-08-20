import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { authProvidersPayload, createAuthContext } from "../lib/auth-actions.mjs";
import {
  collectOpenSessionFiles,
  deleteSessionFile,
  isSessionPathAllowed,
  renameSessionMetadata,
  validateSessionDelete,
} from "../lib/session-actions.mjs";
import { LOCALHOST_ONLY_POST_ROUTES } from "../lib/trust-boundaries.mjs";

function sessionHeaderLine(cwd, id = "sample-session") {
  return `${JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: new Date().toISOString(),
    cwd,
  })}\n`;
}

const tempDir = await mkdtemp(path.join(tmpdir(), "pi-webui-session-auth-"));
const outsideDir = await mkdtemp(path.join(tmpdir(), "pi-webui-session-outside-"));
try {
  const createdPath = path.join(tempDir, "sample.jsonl");
  await writeFile(createdPath, sessionHeaderLine(tempDir), "utf8");

  const renamed = await renameSessionMetadata(createdPath, "Live test session", tempDir);
  assert.equal(renamed.name, "Live test session");

  const reopened = SessionManager.open(createdPath, tempDir);
  assert.equal(reopened.getSessionName(), "Live test session");

  const openFiles = collectOpenSessionFiles([
    { sessionFile: createdPath },
    { lastState: { sessionFile: "/other/session.jsonl" } },
  ]);
  assert.ok(openFiles.has(path.resolve(createdPath)));

  const needsConfirm = validateSessionDelete(createdPath, {
    openSessionFiles: new Set(),
    currentSessionFile: undefined,
    confirmed: false,
  });
  assert.equal(needsConfirm.allowed, false);
  assert.equal(needsConfirm.reason, "confirmation_required");

  const blockedActive = validateSessionDelete(createdPath, {
    openSessionFiles: new Set(),
    currentSessionFile: createdPath,
    confirmed: true,
  });
  assert.equal(blockedActive.allowed, false);
  assert.equal(blockedActive.reason, "active_session");

  const blockedOpenTab = validateSessionDelete(createdPath, {
    openSessionFiles: new Set([path.resolve(createdPath)]),
    currentSessionFile: undefined,
    confirmed: true,
  });
  assert.equal(blockedOpenTab.allowed, false);
  assert.equal(blockedOpenTab.reason, "session_in_use");

  // Session-directory confinement (path traversal hardening).
  const outsidePath = path.join(outsideDir, "outside.jsonl");
  await writeFile(outsidePath, sessionHeaderLine(outsideDir, "outside-session"), "utf8");

  assert.equal(isSessionPathAllowed(createdPath, [tempDir]), true);
  assert.equal(isSessionPathAllowed(outsidePath, [tempDir]), false);
  assert.equal(isSessionPathAllowed(path.join(tempDir, "..", "escape.jsonl"), [tempDir]), false);
  assert.equal(isSessionPathAllowed(outsidePath, []), true, "empty allowedDirs must mean no confinement");

  // Symlinked session dir (e.g. ~/.pi -> dotfiles): a not-yet-created session
  // file must still canonicalize through the symlink, otherwise every fresh
  // session is rejected with "sessionPath must stay inside the Pi session
  // directory" until its file first exists on disk.
  const realSessionDir = await mkdtemp(path.join(tmpdir(), "pi-webui-real-sessions-"));
  const symlinkParent = await mkdtemp(path.join(tmpdir(), "pi-webui-link-parent-"));
  const symlinkedSessionDir = path.join(symlinkParent, "sessions-link");
  await symlink(realSessionDir, symlinkedSessionDir, "dir");
  const pendingSessionFile = path.join(symlinkedSessionDir, "not-created-yet.jsonl");
  assert.equal(
    isSessionPathAllowed(pendingSessionFile, [realSessionDir]),
    true,
    "non-existent session file under a symlinked session dir must be allowed",
  );
  assert.equal(
    isSessionPathAllowed(path.join(realSessionDir, "not-created-yet.jsonl"), [symlinkedSessionDir]),
    true,
    "real path target must be allowed when the configured dir is the symlink",
  );
  assert.equal(
    isSessionPathAllowed(path.join(symlinkedSessionDir, "..", "escape.jsonl"), [realSessionDir]),
    false,
    "traversal through a symlinked session dir must stay blocked",
  );

  const blockedOutside = validateSessionDelete(outsidePath, {
    openSessionFiles: new Set(),
    currentSessionFile: undefined,
    confirmed: true,
    allowedDirs: [tempDir],
  });
  assert.equal(blockedOutside.allowed, false);
  assert.equal(blockedOutside.reason, "outside_session_dir");

  const allowedInside = validateSessionDelete(createdPath, {
    openSessionFiles: new Set(),
    currentSessionFile: undefined,
    confirmed: true,
    allowedDirs: [tempDir],
  });
  assert.equal(allowedInside.allowed, true);

  await assert.rejects(
    renameSessionMetadata(outsidePath, "blocked rename", tempDir, { allowedDirs: [tempDir] }),
    /session directory/i,
    "rename outside the session dir must be rejected",
  );

  await assert.rejects(
    deleteSessionFile(outsidePath, { allowedDirs: [tempDir] }),
    /session directory/i,
    "delete outside the session dir must be rejected",
  );
  assert.ok(existsSync(outsidePath), "blocked delete must not remove the file");

  // Unlink fallback: force `trash` lookup failure via empty PATH, file must still go away.
  const deletablePath = path.join(tempDir, "deletable.jsonl");
  await writeFile(deletablePath, sessionHeaderLine(tempDir, "deletable-session"), "utf8");
  const savedPath = process.env.PATH;
  process.env.PATH = path.join(tempDir, "no-bin");
  let deleted;
  try {
    deleted = await deleteSessionFile(deletablePath, { allowedDirs: [tempDir] });
  } finally {
    process.env.PATH = savedPath;
  }
  assert.equal(deleted.method, "unlink");
  assert.equal(existsSync(deletablePath), false);

  const auth = await createAuthContext();
  const payload = await authProvidersPayload(auth.modelRuntime);
  assert.ok(Array.isArray(payload.loginProviders));
  assert.ok(Array.isArray(payload.logoutProviders));
  assert.equal(payload.browserLoginSupported, false);
  assert.match(payload.guidance, /Pi TUI/i);

  assert.ok(LOCALHOST_ONLY_POST_ROUTES.has("/api/session-delete"));
  assert.ok(LOCALHOST_ONLY_POST_ROUTES.has("/api/auth-logout"));
  assert.ok(
    LOCALHOST_ONLY_POST_ROUTES.has("/api/network/close"),
    "closing network access must be localhost-only like opening it",
  );
  assert.ok(
    LOCALHOST_ONLY_POST_ROUTES.has("/api/remote-auth/settings"),
    "remote PIN auth settings must be localhost-only",
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
}

console.log("session-auth-harness.test.mjs passed");
