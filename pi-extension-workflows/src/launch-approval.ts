import type { WorkflowApprovalKey, WorkflowApprovalStore } from "./approval.ts";
import { WorkflowCancelledError, WorkflowValidationError } from "./errors.ts";
import type { WorkflowUIContext } from "./ui.ts";

const RUN_ONCE = "Run once";
const REMEMBER = "Remember approval for this exact script and policy";
const VIEW_SOURCE = "View raw workflow script";
const CANCEL = "Cancel";
const MAX_SOURCE_PREVIEW_CHARS = 200_000;

export type WorkflowLaunchApprovalResult = {
  approved: true;
  source: "remembered" | "once";
};

export async function requestWorkflowLaunchApproval(options: {
  approvals: WorkflowApprovalStore;
  key: WorkflowApprovalKey;
  workflowName: string;
  source: string;
  plan?: string;
  ctx: WorkflowUIContext;
}): Promise<WorkflowLaunchApprovalResult> {
  if (options.approvals.consume(options.key)) return { approved: true, source: "remembered" };
  if (options.ctx.hasUI === false || !options.ctx.ui?.select) {
    throw new WorkflowValidationError(["Workflow launch requires interactive approval or a remembered exact-script approval."]);
  }

  while (true) {
    const choice = await options.ctx.ui.select(
      [`Approve workflow '${options.workflowName}'?`, options.plan].filter(Boolean).join("\n"),
      [RUN_ONCE, REMEMBER, VIEW_SOURCE, CANCEL],
    );
    if (choice === RUN_ONCE) {
      options.approvals.approve(options.key, "once");
      if (!options.approvals.consume(options.key)) throw new WorkflowValidationError(["one-shot workflow approval could not be consumed."]);
      return { approved: true, source: "once" };
    }
    if (choice === REMEMBER) {
      options.approvals.approve(options.key, "remembered");
      return { approved: true, source: "remembered" };
    }
    if (choice === VIEW_SOURCE) {
      const truncated = options.source.length > MAX_SOURCE_PREVIEW_CHARS
        ? `${options.source.slice(0, MAX_SOURCE_PREVIEW_CHARS)}\n\n… source preview truncated …`
        : options.source;
      options.ctx.ui.notify?.(truncated, "info");
      continue;
    }
    throw new WorkflowCancelledError("Workflow launch approval was cancelled.");
  }
}
