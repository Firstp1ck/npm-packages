import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  WORKSPACE_SUMMARY_COMMAND_MAX_CHARS,
  WORKSPACE_SUMMARY_MAX_LIVE_BYTES,
  WORKSPACE_SUMMARY_PROTOCOL_VERSION,
  WORKSPACE_SUMMARY_TOOL_MAX_CHARS,
  canonicalizeWorkspaceCwd,
  createLiveSummaryPayload,
  discoverPersistedWorkspaceSummaries,
  formatWorkspaceSummariesForCommand,
  formatWorkspaceSummariesForTool,
  mergeWorkspaceSessionSummaries,
  normalizeLiveSummaryPayload,
  workspaceCwdsEqual,
} from "../lib/workspace-session-summaries.mjs";
import { SESSION_SUMMARY_STATE_TYPE } from "../lib/session-summary-core.mjs";

function summaryState(sessionId, summaryMarkdown, {
  title = "Workspace task",
  generatedAt = "2026-08-05T12:00:00.000Z",
  version = 1,
} = {}) {
  return {
    version,
    source: {
      sessionId,
      leafId: "leaf",
      fingerprint: "f".repeat(64),
      entryCount: 4,
    },
    result: { title, summaryMarkdown },
    generation: {
      provider: "test-provider",
      modelId: "test-model",
      thinkingLevel: "low",
      promptRevision: "session-summary-v1",
    },
    generatedAt,
    settledTurnOrdinal: 2,
  };
}

function sessionJsonl({ id, cwd, summary, name, headerVersion = 3, extraLines = [] }) {
  const entries = [
    { type: "session", version: headerVersion, id, timestamp: "2026-08-05T11:00:00.000Z", cwd },
    { type: "message", id: "raw00001", parentId: null, timestamp: "2026-08-05T11:01:00.000Z", message: { role: "user", content: "RAW_TRANSCRIPT_SECRET ghp_rawtranscript1234567890 /home/private/.pi/agent/sessions/private.jsonl" } },
    ...(name ? [{ type: "session_info", id: "name0001", parentId: "raw00001", timestamp: "2026-08-05T11:02:00.000Z", name }] : []),
    ...extraLines,
    { type: "custom", id: "sum00001", parentId: name ? "name0001" : "raw00001", timestamp: "2026-08-05T12:00:00.000Z", customType: SESSION_SUMMARY_STATE_TYPE, data: summary },
  ];
  return `${entries.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)).join("\n")}\n`;
}

function livePayload(cwd, sessionId, summaryMarkdown, generatedAt = "2026-08-05T13:00:00.000Z") {
  return {
    version: WORKSPACE_SUMMARY_PROTOCOL_VERSION,
    sessionId,
    cwd: canonicalizeWorkspaceCwd(cwd),
    title: `Title ${sessionId}`,
    summaryMarkdown,
    generatedAt,
    sessionName: `Session ${sessionId}`,
  };
}

const root = await mkdtemp(path.join(os.tmpdir(), "workspace-session-summaries-"));
try {
  const workspace = path.join(root, "workspace");
  const otherWorkspace = path.join(root, "other");
  const sessionDir = path.join(root, "sessions");
  await Promise.all([mkdir(workspace), mkdir(otherWorkspace), mkdir(sessionDir)]);

  assert.equal(canonicalizeWorkspaceCwd(path.join(workspace, ".")), workspace);
  assert.equal(workspaceCwdsEqual(workspace, path.join(workspace, "nested", "..")), true);
  assert.equal(canonicalizeWorkspaceCwd("\0unsafe"), undefined);
  if (process.platform !== "win32") {
    const alias = path.join(root, "workspace-alias");
    await symlink(workspace, alias, "dir");
    assert.equal(workspaceCwdsEqual(workspace, alias), true, "symlink and real CWD should canonicalize equally");
  }

  const currentId = "current-session";
  const sameId = "same-session";
  const otherId = "other-session";
  const invalidId = "invalid-session";
  await writeFile(path.join(sessionDir, "current.jsonl"), sessionJsonl({
    id: currentId,
    cwd: workspace,
    summary: summaryState(currentId, "Current persisted copy"),
  }));
  await writeFile(path.join(sessionDir, "same.jsonl"), sessionJsonl({
    id: sameId,
    cwd: workspace,
    name: "Same workspace",
    summary: summaryState(sameId, "Implement durable discovery."),
    extraLines: ["{malformed-json", "x".repeat(30 * 1024)],
  }));
  await writeFile(path.join(sessionDir, "other.jsonl"), sessionJsonl({
    id: otherId,
    cwd: otherWorkspace,
    summary: summaryState(otherId, "Must not cross CWD boundaries."),
  }));
  await writeFile(path.join(sessionDir, "invalid-version.jsonl"), sessionJsonl({
    id: invalidId,
    cwd: workspace,
    headerVersion: 2,
    summary: summaryState(invalidId, "Must not migrate or consume old formats."),
  }));
  await writeFile(path.join(sessionDir, "wrong-state-session.jsonl"), sessionJsonl({
    id: "header-session",
    cwd: workspace,
    summary: summaryState("forged-session", "Mismatched state identity."),
  }));

  const now = new Date("2026-08-05T14:00:00.000Z");
  await utimes(path.join(sessionDir, "same.jsonl"), now, now);
  const discovered = await discoverPersistedWorkspaceSummaries({ cwd: workspace, sessionDir, currentSessionId: currentId });
  assert.deepEqual(discovered.map((entry) => entry.sessionId), [sameId]);
  assert.equal(discovered[0].source, "persisted");
  assert.equal(discovered[0].sessionName, "Same workspace");
  assert.equal(Object.hasOwn(discovered[0], "sessionFile"), false);
  assert.equal(JSON.stringify(discovered).includes("RAW_TRANSCRIPT_SECRET"), false);
  assert.equal(JSON.stringify(discovered).includes(sessionDir), false);

  const oversizedFileId = "tail-session";
  await writeFile(path.join(sessionDir, "tail.jsonl"), sessionJsonl({
    id: oversizedFileId,
    cwd: workspace,
    summary: summaryState(oversizedFileId, "Found from a bounded tail read."),
    extraLines: [{ type: "message", id: "large001", parentId: "raw00001", timestamp: "2026-08-05T11:30:00.000Z", message: { role: "user", content: "z".repeat(80_000) } }],
  }));
  const tailDiscovered = await discoverPersistedWorkspaceSummaries({
    cwd: workspace,
    sessionDir,
    currentSessionId: currentId,
    maxFileBytes: 32 * 1024,
  });
  assert.equal(tailDiscovered.some((entry) => entry.sessionId === oversizedFileId), true, "bounded tail should retain a recent summary after an oversized line");
  const escapedSessionId = "escaped-session";
  await writeFile(path.join(sessionDir, "escaped.jsonl"), sessionJsonl({
    id: escapedSessionId,
    cwd: workspace,
    summary: summaryState(escapedSessionId, "\\".repeat(16_000)),
  }));
  const escapedDiscovered = await discoverPersistedWorkspaceSummaries({ cwd: workspace, sessionDir, currentSessionId: currentId });
  assert.equal(escapedDiscovered.some((entry) => entry.sessionId === escapedSessionId), true, "valid decoded summaries remain discoverable when JSON escaping expands the custom-entry line");

  const currentState = summaryState(currentId, "Current work summary.");
  const publication = createLiveSummaryPayload({ cwd: workspace, state: currentState, sessionName: "Current worker" });
  assert.ok(publication);
  assert.equal(Buffer.byteLength(JSON.stringify(publication)) <= WORKSPACE_SUMMARY_MAX_LIVE_BYTES, true);
  assert.equal(normalizeLiveSummaryPayload(publication)?.sessionId, currentId);
  const redactedPublication = createLiveSummaryPayload({
    cwd: workspace,
    state: summaryState(currentId, [
      "Token ghp_abcdefghijklmnopqrstuvwxyz123456 at /home/private/.pi/agent/sessions/private.jsonl",
      "Windows C:\\Users\\alice\\.pi\\agent\\sessions\\--repo--\\secret.jsonl",
      "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
      "npm_auth_token=npm_abcdefghijklmnopqrstuvwxyz123456",
      "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----",
    ].join("\n")),
    sessionName: "authorization: secret-value",
  });
  const redactedPublicationText = JSON.stringify(redactedPublication);
  for (const sensitive of ["ghp_abcdefghijklmnopqrstuvwxyz123456", "private.jsonl", "secret.jsonl", "AKIAIOSFODNN7EXAMPLE", "npm_abcdefghijklmnopqrstuvwxyz123456", "private-material", "secret-value"]) {
    assert.equal(redactedPublicationText.includes(sensitive), false, `live publication redacts ${sensitive} before transport`);
  }
  assert.equal(normalizeLiveSummaryPayload({ ...publication, transcript: "private" }), undefined, "unknown live fields should fail closed");
  assert.equal(normalizeLiveSummaryPayload({ ...publication, version: 2 }), undefined);
  assert.equal(normalizeLiveSummaryPayload({ ...publication, cwd: `${otherWorkspace}/nested/..` }), undefined, "non-canonical live CWD should fail");
  assert.equal(normalizeLiveSummaryPayload({ ...publication, summaryMarkdown: "x".repeat(13 * 1024) }), undefined);
  assert.equal(normalizeLiveSummaryPayload({ ...publication, generatedAt: "not-a-date" }), undefined);
  assert.equal(normalizeLiveSummaryPayload({ ...publication, sessionId: "a\tb" }), undefined, "control characters in identifiers fail closed instead of being normalized");
  assert.equal(createLiveSummaryPayload({ cwd: workspace, state: summaryState(currentId, "x".repeat(16 * 1024)) }).summaryMarkdown.length <= 12 * 1024, true);
  assert.equal(createLiveSummaryPayload({
    cwd: path.join(root, "w".repeat(3900)),
    state: summaryState(currentId, "x".repeat(16 * 1024)),
  }), undefined, "aggregate live payloads above the 15 KiB transport envelope fail closed");

  const liveSame = livePayload(workspace, sameId, "Newer live copy.");
  const liveDisconnected = livePayload(workspace, "disconnected", "Disconnected and stale.");
  const liveCrossCwd = livePayload(otherWorkspace, "cross-cwd", "Wrong workspace.");
  const liveSelf = livePayload(workspace, "self-live", "Self sender.");
  const snapshot = mergeWorkspaceSessionSummaries({
    cwd: workspace,
    currentSessionId: currentId,
    currentState,
    currentSessionName: "Current worker",
    selfSenderId: "sender-self",
    liveAvailable: true,
    connectedSessions: [
      { senderId: "sender-live", cwd: workspace },
      { senderId: "sender-cross", cwd: otherWorkspace },
      { senderId: "sender-self", cwd: workspace },
    ],
    livePeers: [
      { senderId: "sender-live", payload: liveSame, receivedAt: "2026-08-05T13:01:00.000Z" },
      { senderId: "sender-gone", payload: liveDisconnected },
      { senderId: "sender-cross", payload: liveCrossCwd },
      { senderId: "sender-self", payload: liveSelf },
    ],
    persisted: [
      ...discovered,
      { sessionId: "persisted-new", title: "Persisted", summaryMarkdown: "Historical work.", generatedAt: "2026-08-05T14:00:00.000Z", modifiedAt: "2026-08-05T14:00:00.000Z" },
      { sessionId: "persisted-old", title: "Persisted", summaryMarkdown: "Older historical work.", generatedAt: "2026-08-04T14:00:00.000Z", modifiedAt: "2026-08-04T14:00:00.000Z" },
    ],
  });
  assert.deepEqual(snapshot.entries.map((entry) => [entry.sessionId, entry.source]), [
    [currentId, "current"],
    [sameId, "live"],
    ["persisted-new", "persisted"],
    ["persisted-old", "persisted"],
  ]);
  assert.deepEqual(snapshot.counts, { current: 1, live: 1, persisted: 2, peers: 3 });
  assert.equal(snapshot.entries.some((entry) => entry.sessionId === "disconnected"), false);
  assert.equal(snapshot.entries.some((entry) => entry.sessionId === "cross-cwd"), false);
  const claimedIdCollision = mergeWorkspaceSessionSummaries({
    cwd: workspace,
    liveAvailable: true,
    connectedSessions: [{ id: "sender-a", cwd: workspace }, { id: "sender-b", cwd: workspace }],
    livePeers: [
      { senderId: "sender-a", payload: livePayload(workspace, "claimed", "Sender A") },
      { senderId: "sender-b", payload: livePayload(workspace, "claimed", "Sender B") },
    ],
  });
  assert.equal(claimedIdCollision.counts.live, 2, "authoritative live senders are not collapsed by a payload-declared Pi session ID");
  assert.deepEqual(new Set(claimedIdCollision.entries.map((entry) => entry.senderId)), new Set(["sender-a", "sender-b"]));

  const fallback = mergeWorkspaceSessionSummaries({
    cwd: workspace,
    currentSessionId: currentId,
    currentState,
    liveAvailable: false,
    connectedSessions: [{ senderId: "sender-live", cwd: workspace }],
    livePeers: [{ senderId: "sender-live", payload: liveSame }],
    persisted: discovered,
  });
  assert.equal(fallback.entries.find((entry) => entry.sessionId === sameId)?.source, "persisted");
  assert.equal(fallback.liveAvailable, false);

  const privateSnapshot = mergeWorkspaceSessionSummaries({
    cwd: workspace,
    currentSessionId: currentId,
    currentState: summaryState(currentId, [
      "Safe goal.",
      "/home/private/.pi/agent/sessions/--private--/secret.jsonl",
      "authorization: BearerValueThatMustNotAppear",
      "ghp_abcdefghijklmnopqrstuvwxyz123456",
    ].join("\n")),
    liveAvailable: false,
  });
  const toolText = formatWorkspaceSummariesForTool(privateSnapshot);
  const commandText = formatWorkspaceSummariesForCommand(privateSnapshot);
  for (const text of [toolText, commandText]) {
    assert.equal(text.includes("secret.jsonl"), false);
    assert.equal(text.includes("BearerValueThatMustNotAppear"), false);
    assert.equal(text.includes("ghp_abcdefghijklmnopqrstuvwxyz123456"), false);
    assert.match(text, /reference-only/i);
    assert.match(text, /intercom/i);
  }
  assert.equal(toolText.length <= WORKSPACE_SUMMARY_TOOL_MAX_CHARS, true);
  assert.equal(commandText.length <= WORKSPACE_SUMMARY_COMMAND_MAX_CHARS, true);

  const manyPersisted = Array.from({ length: 40 }, (_, index) => ({
    sessionId: `bounded-${String(index).padStart(2, "0")}`,
    title: `Bounded ${index}`,
    summaryMarkdown: "content ".repeat(1000),
    generatedAt: new Date(Date.UTC(2026, 7, 5, 10, index)).toISOString(),
    modifiedAt: new Date(Date.UTC(2026, 7, 5, 10, index)).toISOString(),
  }));
  const boundedSnapshot = mergeWorkspaceSessionSummaries({ cwd: workspace, persisted: manyPersisted, maxEntries: 3 });
  assert.deepEqual(boundedSnapshot.entries.map((entry) => entry.sessionId), ["bounded-39", "bounded-38", "bounded-37"]);
  const boundedToolText = formatWorkspaceSummariesForTool(boundedSnapshot, { maxChars: 1000 });
  const boundedCommandText = formatWorkspaceSummariesForCommand(boundedSnapshot, { maxChars: 700 });
  assert.equal(boundedToolText.length <= 1000, true);
  assert.equal(boundedCommandText.length <= 700, true);
  for (const text of [boundedToolText, boundedCommandText]) {
    assert.match(text, /untrusted|reference-only/i, "safety framing survives aggregate truncation");
    assert.match(text, /intercom/i, "coordination guidance survives aggregate truncation");
  }

  console.log("workspace-session-summaries tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
