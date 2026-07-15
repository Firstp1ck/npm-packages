import {
  WORKFLOW_APPROVAL_ENTRY_TYPE,
  approvalMatches,
  createWorkflowApprovalRecord,
  validateWorkflowPersistenceRecord,
  type WorkflowApprovalRecordV1,
  type WorkflowApprovalScope,
} from "./persistence-schema.ts";

export type WorkflowApprovalKey = {
  projectId: string;
  scriptHash: string;
  policyHash: string;
};

type EntryLike = {
  type?: string;
  customType?: string;
  data?: unknown;
};

type AppendEntry = (customType: string, data?: unknown) => void;

export type WorkflowApprovalStore = {
  approve(key: WorkflowApprovalKey, scope: WorkflowApprovalScope): WorkflowApprovalRecordV1;
  isApproved(key: WorkflowApprovalKey): boolean;
  consume(key: WorkflowApprovalKey): boolean;
  restoreFromEntries(entries: EntryLike[]): number;
  records(): WorkflowApprovalRecordV1[];
};

export function createWorkflowApprovalStore(pi?: { appendEntry?: AppendEntry }): WorkflowApprovalStore {
  const remembered = new Map<string, WorkflowApprovalRecordV1>();
  const once = new Map<string, WorkflowApprovalRecordV1>();

  const find = (key: WorkflowApprovalKey): WorkflowApprovalRecordV1 | undefined => {
    for (const record of [...once.values(), ...remembered.values()]) {
      if (approvalMatches(record, key)) return record;
    }
    return undefined;
  };

  return {
    approve(key, scope) {
      const record = createWorkflowApprovalRecord({ ...key, scope });
      if (scope === "once") once.set(record.approvalId, record);
      else {
        remembered.set(record.approvalId, record);
        pi?.appendEntry?.(WORKFLOW_APPROVAL_ENTRY_TYPE, record);
      }
      return record;
    },
    isApproved(key) {
      return find(key) !== undefined;
    },
    consume(key) {
      const record = find(key);
      if (!record) return false;
      if (record.scope === "once") once.delete(record.approvalId);
      return true;
    },
    restoreFromEntries(entries) {
      remembered.clear();
      for (const entry of entries) {
        if (entry.type !== "custom" || entry.customType !== WORKFLOW_APPROVAL_ENTRY_TYPE) continue;
        try {
          const record = validateWorkflowPersistenceRecord(entry.data);
          if (record.kind === "approval" && record.scope === "remembered") remembered.set(record.approvalId, record);
        } catch {
          // Invalid or future-version records fail closed and are ignored.
        }
      }
      return remembered.size;
    },
    records() {
      return [...remembered.values(), ...once.values()].map((record) => structuredClone(record));
    },
  };
}
