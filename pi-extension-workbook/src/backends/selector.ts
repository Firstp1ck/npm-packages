import type { EngineCapabilities, WorkbookBackendId, WorkbookOperation } from "../contracts.ts";
import { fail } from "../errors.ts";

export function selectMutationBackend(capabilities: EngineCapabilities[], operations: WorkbookOperation[], requested?: WorkbookBackendId): WorkbookBackendId {
  const candidates = requested ? capabilities.filter((capability) => capability.engine === requested) : capabilities;
  for (const candidate of candidates) {
    if (!candidate.available || !candidate.edit) continue;
    const operationSupport = new Map(candidate.operations.map((operation) => [operation.operation, operation.supported]));
    if (operations.every((operation) => operationSupport.get(operation.type) === true)) return candidate.engine;
  }
  fail("BACKEND_UNAVAILABLE", `No enabled backend can perform all requested operations without loss${requested ? ` (requested ${requested})` : ""}.`);
}
