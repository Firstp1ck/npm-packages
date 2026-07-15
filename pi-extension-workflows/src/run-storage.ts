import { appendFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAgentDir, isPathInside } from "@firstpick/pi-utils/paths";
import { WorkflowValidationError } from "./errors.ts";
import {
  canonicalJson,
  migrateWorkflowPersistenceRecord,
  sha256,
  validateWorkflowPersistenceRecord,
  type WorkflowCallRecordV1,
  type WorkflowEventRecordV1,
  type WorkflowResultRecordV1,
  type WorkflowRunRecordV1,
  type WorkflowUsageRecordV1,
} from "./persistence-schema.ts";

const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/;
let temporarySequence = 0;

export type WorkflowScriptSnapshot = {
  runDir: string;
  scriptPath: string;
  scriptHash: string;
};

export type WorkflowRunStorage = {
  readonly rootDir: string;
  readonly sessionId: string;
  runDirectory(runId: string): Promise<string>;
  snapshotScript(runId: string, source: string, expectedHash: string): Promise<WorkflowScriptSnapshot>;
  writePolicy(runId: string, policy: unknown): Promise<string>;
  writeRun(record: WorkflowRunRecordV1): Promise<string>;
  appendEvent(record: WorkflowEventRecordV1): Promise<string>;
  writeCall(record: WorkflowCallRecordV1): Promise<string>;
  appendUsage(record: WorkflowUsageRecordV1): Promise<string>;
  writeResult(record: WorkflowResultRecordV1, markdown: string): Promise<{ jsonPath: string; markdownPath: string }>;
  readRun(runId: string): Promise<WorkflowRunRecordV1>;
  readPolicy(runId: string): Promise<unknown>;
  readCalls(runId: string): Promise<WorkflowCallRecordV1[]>;
  readEvents(runId: string): Promise<WorkflowEventRecordV1[]>;
  readUsage(runId: string): Promise<WorkflowUsageRecordV1[]>;
  readResult(runId: string): Promise<WorkflowResultRecordV1 | undefined>;
  readScript(runId: string): Promise<string | undefined>;
  listRuns(): Promise<WorkflowRunRecordV1[]>;
};

export type WorkflowRunStorageOptions = {
  agentDir?: string;
  sessionId: string;
};

function safeSegment(value: string, label: string): string {
  if (!SAFE_SEGMENT.test(value)) throw new WorkflowValidationError([`${label} contains unsafe path characters.`]);
  return value;
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new WorkflowValidationError([`workflow storage path is not a private directory: ${directory}`]);
}

async function writeImmutable(filePath: string, content: string): Promise<void> {
  try {
    const handle = await open(filePath, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
    const stat = await lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new WorkflowValidationError([`immutable snapshot path is not a regular file: ${filePath}`]);
    const existing = await readFile(filePath, "utf8");
    if (existing !== content) throw new WorkflowValidationError([`immutable workflow snapshot already exists with different bytes: ${filePath}`]);
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const temporary = `${filePath}.tmp-${process.pid}-${++temporarySequence}`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await rename(temporary, filePath);
  } catch (error) {
    try { await rm(temporary, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function createWorkflowRunStorage(options: WorkflowRunStorageOptions): WorkflowRunStorage {
  const sessionId = safeSegment(options.sessionId, "sessionId");
  const rootDir = path.resolve(options.agentDir ?? getAgentDir(), "workflow-runs");

  const runDirectory = async (runId: string): Promise<string> => {
    const safeRunId = safeSegment(runId, "runId");
    await ensurePrivateDirectory(rootDir);
    const sessionDir = path.join(rootDir, sessionId);
    await ensurePrivateDirectory(sessionDir);
    const runDir = path.join(sessionDir, safeRunId);
    await ensurePrivateDirectory(runDir);
    await ensurePrivateDirectory(path.join(runDir, "calls"));
    await ensurePrivateDirectory(path.join(runDir, "artifacts"));

    const resolvedRoot = await realpath(rootDir);
    const resolvedRun = await realpath(runDir);
    if (!isPathInside(resolvedRoot, resolvedRun)) throw new WorkflowValidationError(["workflow run directory escaped the configured storage root."]);
    return resolvedRun;
  };

  return {
    rootDir,
    sessionId,
    runDirectory,
    async snapshotScript(runId, source, expectedHash) {
      const actualHash = sha256(source);
      if (actualHash !== expectedHash) throw new WorkflowValidationError(["workflow source hash changed before snapshot persistence."]);
      const runDir = await runDirectory(runId);
      const scriptPath = path.join(runDir, "workflow.js");
      await writeImmutable(scriptPath, source);
      const persisted = await readFile(scriptPath, "utf8");
      const persistedHash = sha256(persisted);
      if (persistedHash !== expectedHash) throw new WorkflowValidationError(["persisted workflow snapshot hash does not match parsed source."]);
      return { runDir, scriptPath, scriptHash: persistedHash };
    },
    async writePolicy(runId, policy) {
      const filePath = path.join(await runDirectory(runId), "policy.json");
      await writeImmutable(filePath, `${canonicalJson(policy)}\n`);
      return filePath;
    },
    async writeRun(record) {
      const validated = validateWorkflowPersistenceRecord(record);
      if (validated.kind !== "run") throw new WorkflowValidationError(["writeRun requires a run record."]);
      if (validated.sessionId !== sessionId) throw new WorkflowValidationError(["run record sessionId does not match its storage namespace."]);
      const filePath = path.join(await runDirectory(validated.runId), "run.json");
      await atomicWrite(filePath, `${JSON.stringify(validated, null, 2)}\n`);
      return filePath;
    },
    async appendEvent(record) {
      const validated = validateWorkflowPersistenceRecord(record);
      if (validated.kind !== "event") throw new WorkflowValidationError(["appendEvent requires an event record."]);
      const filePath = path.join(await runDirectory(validated.runId), "events.jsonl");
      await appendFile(filePath, jsonLine(validated), { encoding: "utf8", mode: 0o600 });
      return filePath;
    },
    async writeCall(record) {
      const validated = validateWorkflowPersistenceRecord(record);
      if (validated.kind !== "call") throw new WorkflowValidationError(["writeCall requires a call record."]);
      const callId = safeSegment(validated.callId, "callId");
      const filePath = path.join(await runDirectory(validated.runId), "calls", `${callId}.json`);
      await atomicWrite(filePath, `${JSON.stringify(validated, null, 2)}\n`);
      return filePath;
    },
    async appendUsage(record) {
      const validated = validateWorkflowPersistenceRecord(record);
      if (validated.kind !== "usage") throw new WorkflowValidationError(["appendUsage requires a usage record."]);
      const filePath = path.join(await runDirectory(validated.runId), "usage.jsonl");
      await appendFile(filePath, jsonLine(validated), { encoding: "utf8", mode: 0o600 });
      return filePath;
    },
    async writeResult(record, markdown) {
      const validated = validateWorkflowPersistenceRecord(record);
      if (validated.kind !== "result") throw new WorkflowValidationError(["writeResult requires a result record."]);
      const runDir = await runDirectory(validated.runId);
      const jsonPath = path.join(runDir, "result.json");
      const markdownPath = path.join(runDir, "result.md");
      await atomicWrite(jsonPath, `${JSON.stringify(validated, null, 2)}\n`);
      await atomicWrite(markdownPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
      return { jsonPath, markdownPath };
    },
    async readRun(runId) {
      const filePath = path.join(await runDirectory(runId), "run.json");
      const record = migrateWorkflowPersistenceRecord(JSON.parse(await readFile(filePath, "utf8")));
      if (record.kind !== "run") throw new WorkflowValidationError([`run.json for '${runId}' is not a run record.`]);
      return record;
    },
    async readPolicy(runId) {
      return JSON.parse(await readFile(path.join(await runDirectory(runId), "policy.json"), "utf8")) as unknown;
    },
    async readCalls(runId) {
      const callsDir = path.join(await runDirectory(runId), "calls");
      const entries = await readdir(callsDir, { withFileTypes: true });
      const calls: WorkflowCallRecordV1[] = [];
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        try {
          const record = migrateWorkflowPersistenceRecord(JSON.parse(await readFile(path.join(callsDir, entry.name), "utf8")));
          if (record.kind === "call") calls.push(record);
        } catch { /* invalid or future call records fail closed */ }
      }
      return calls;
    },
    async readEvents(runId) {
      const filePath = path.join(await runDirectory(runId), "events.jsonl");
      try {
        const records: WorkflowEventRecordV1[] = [];
        for (const line of (await readFile(filePath, "utf8")).split("\n").filter(Boolean)) {
          try {
            const record = migrateWorkflowPersistenceRecord(JSON.parse(line));
            if (record.kind === "event") records.push(record);
          } catch { /* invalid or future event records fail closed */ }
        }
        return records.sort((a, b) => a.sequence - b.sequence);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
        throw error;
      }
    },
    async readUsage(runId) {
      const filePath = path.join(await runDirectory(runId), "usage.jsonl");
      try {
        const records: WorkflowUsageRecordV1[] = [];
        for (const line of (await readFile(filePath, "utf8")).split("\n").filter(Boolean)) {
          try {
            const record = migrateWorkflowPersistenceRecord(JSON.parse(line));
            if (record.kind === "usage") records.push(record);
          } catch { /* invalid or future usage records fail closed */ }
        }
        return records;
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
        throw error;
      }
    },
    async readResult(runId) {
      const filePath = path.join(await runDirectory(runId), "result.json");
      try {
        const record = migrateWorkflowPersistenceRecord(JSON.parse(await readFile(filePath, "utf8")));
        return record.kind === "result" ? record : undefined;
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
        throw error;
      }
    },
    async readScript(runId) {
      try { return await readFile(path.join(await runDirectory(runId), "workflow.js"), "utf8"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
        throw error;
      }
    },
    async listRuns() {
      await ensurePrivateDirectory(rootDir);
      const sessionDir = path.join(rootDir, sessionId);
      await ensurePrivateDirectory(sessionDir);
      const entries = await readdir(sessionDir, { withFileTypes: true });
      const records: WorkflowRunRecordV1[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || !SAFE_SEGMENT.test(entry.name)) continue;
        try { records.push(await this.readRun(entry.name)); } catch { /* skip incomplete or invalid run directories */ }
      }
      return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
  };
}
