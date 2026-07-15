export type WorkflowInput = Record<string, unknown>;
export type WorkflowArgs = unknown;

export type WorkflowModeState = {
  schemaVersion: 1;
  enabled: boolean;
  behavior: "persistent" | "once";
  phase: "off" | "armed" | "running";
  updatedAt: string;
};

export type WorkflowScriptPermissions = {
  write: boolean;
  shell: boolean;
  network: boolean;
};

export type WorkflowScriptPolicy = {
  version: 1;
  inputSchema?: unknown;
  maxConcurrency: number;
  maxAgents: number;
  timeoutMs: number;
  permissions: WorkflowScriptPermissions;
};

export type WorkflowScriptMeta = {
  name: string;
  description: string;
  phases?: string[];
  pi: WorkflowScriptPolicy;
};

export type WorkflowScriptDefinition = {
  meta: WorkflowScriptMeta;
  source: string;
  body: string;
  sourceHash: string;
};

export type WorkflowDefinition = {
  schemaVersion: 1;
  key: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
  defaults?: {
    maxConcurrency?: number;
    maxTasks?: number;
  };
  phases: WorkflowPhase[];
};

export type WorkflowPhase = {
  id: string;
  name: string;
  description?: string;
  mode: "sequential" | "parallel";
  maxConcurrency?: number;
  tasks: WorkflowTask[];
};

export type WorkflowTask = {
  id: string;
  name: string;
  agent?: string;
  prompt: string;
  tools?: string[];
  model?: string;
  cwd?: string;
  timeoutMs?: number;
};

export type WorkflowRunStatus = "queued" | "validating" | "awaiting_approval" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type PhaseRunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type TaskRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type WorkflowUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  contextTokens?: number;
  turns?: number;
};

export type WorkflowSubprocessEventType = "start" | "event" | "stdout" | "stderr" | "exit";

export type WorkflowSubprocessEvent = {
  type: WorkflowSubprocessEventType;
  timestamp: string;
  phaseId: string;
  phaseName: string;
  taskId: string;
  taskName: string;
  command?: string;
  cwd?: string;
  line?: string;
  eventType?: string;
  exitCode?: number;
};

export type WorkflowRun = {
  runId: string;
  workflowKey: string;
  workflowName: string;
  sourcePath?: string;
  status: WorkflowRunStatus;
  input: WorkflowInput;
  phases: PhaseRun[];
  pipelineItems?: PipelineItemRun[];
  startedAt: string;
  finishedAt?: string;
  summary?: string;
  error?: string;
  sourceType?: "json" | "javascript";
  scriptHash?: string;
  policyHash?: string;
  projectId?: string;
  snapshotPath?: string;
  resumedFromRunId?: string;
  resumeWarnings?: string[];
  result?: unknown;
  usage?: WorkflowUsage;
  updatedAt?: string;
};

export type PipelineItemRun = {
  pipelineId: string;
  index: number;
  key: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  error?: string;
};

export type PhaseRun = {
  phaseId: string;
  name: string;
  status: PhaseRunStatus;
  tasks: TaskRun[];
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

export type TaskRun = {
  taskId: string;
  name: string;
  callIndex?: number;
  status: TaskRunStatus;
  output?: string;
  error?: string;
  usage?: WorkflowUsage;
  prompt?: string;
  promptHash?: string;
  fingerprint?: string;
  pipelineKey?: string;
  options?: Record<string, unknown>;
  result?: unknown;
  startedAt?: string;
  finishedAt?: string;
};

export type WorkflowSourceScope = "bundled" | "user" | "project" | "inline";

export type WorkflowJsonSource = {
  path: string;
  scope: WorkflowSourceScope;
  sourceType: "json";
  definition: WorkflowDefinition;
};

export type WorkflowJavaScriptSource = {
  path: string;
  scope: WorkflowSourceScope;
  sourceType: "javascript";
  script: WorkflowScriptDefinition;
};

export type WorkflowSource = WorkflowJsonSource | WorkflowJavaScriptSource;

export type TaskResult = {
  ok: boolean;
  output: string;
  error?: string;
  usage?: WorkflowUsage;
  raw?: unknown;
};

export type TaskContext = {
  cwd: string;
  input: WorkflowInput;
  run: WorkflowRun;
  phase: WorkflowPhase;
  priorOutputs: string;
  signal?: AbortSignal;
  onSubprocessEvent?: (event: WorkflowSubprocessEvent) => void;
};

export type TaskRunner = {
  runTask(task: WorkflowTask, context: TaskContext): Promise<TaskResult>;
};
