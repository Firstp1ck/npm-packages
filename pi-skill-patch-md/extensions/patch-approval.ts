import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { parsePatchctlResult, runPatchApproval } from "../lib/patch-approval.mjs";

const patchctlPath = fileURLToPath(new URL("../skills/patch-md/scripts/patchctl.mjs", import.meta.url));

const PatchApprovalParams = Type.Object({
  patchPath: Type.String({ description: "Path to the reviewed PATCH.md. Relative paths resolve from the active working directory; leading @ is ignored." }),
  planHash: Type.String({
    description: "Exact lowercase SHA-256 plan hash produced by the reviewed fresh patchctl plan.",
    pattern: "^[a-f0-9]{64}$",
  }),
});

function cleanInputPath(value: string): string {
  return value.trim().replace(/^@+/u, "");
}

export default function patchApprovalExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "patch_apply_with_approval",
    label: "Approve and Apply Patch",
    description: "Recompute a reviewed PATCH.md v2 plan, show a native TUI/WebUI confirmation dialog bound to its exact plan hash, and apply only after the user explicitly approves. Refuses non-interactive execution, stale hashes, blocked plans, and changed plans.",
    promptSnippet: "Request native user confirmation and apply an exact reviewed PATCH.md plan hash",
    promptGuidelines: [
      "Use patch_apply_with_approval instead of bash patchctl apply when a reviewed PATCH.md plan needs explicit user approval in TUI or WebUI.",
      "Never claim patch approval from chat wording when patch_apply_with_approval is available; call the tool so the user sees the exact plan-bound native confirmation dialog.",
    ],
    parameters: PatchApprovalParams,
    executionMode: "sequential",

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!ctx.hasUI) throw new Error("Patch apply refused: no interactive UI is available for explicit confirmation");

      const patchPath = resolve(ctx.cwd, cleanInputPath(params.patchPath));
      const executePatchctl = async (action: "plan" | "apply", planHash?: string) => {
        const args = [patchctlPath, action, "--patch", patchPath];
        if (action === "apply") args.push("--plan-hash", String(planHash || ""));
        const result = await pi.exec(process.execPath, args, { cwd: ctx.cwd, timeout: 120_000, signal });
        return parsePatchctlResult(action, result);
      };

      const outcome = await runPatchApproval({
        patchPath,
        reviewedPlanHash: params.planHash,
        requestPlan: () => executePatchctl("plan"),
        requestApproval: ({ title, message }) => ctx.ui.confirm(title, message),
        applyPlan: (planHash) => executePatchctl("apply", planHash),
      });

      if (outcome.status === "declined") {
        return {
          content: [{ type: "text", text: "User declined the native patch approval dialog. No files were changed." }],
          details: { status: outcome.status, patchPath, planHash: outcome.plan.planHash, writes: 0 },
        };
      }
      if (outcome.status === "noop") {
        return {
          content: [{ type: "text", text: "The reviewed patch plan is already satisfied; no files were changed." }],
          details: { status: outcome.status, patchPath, planHash: outcome.plan.planHash, writes: 0 },
        };
      }

      const writes = Number(outcome.applied?.result?.writes ?? outcome.plan.writes ?? 0);
      return {
        content: [{ type: "text", text: `User approved the native dialog and patchctl applied the exact reviewed plan successfully (${writes} write${writes === 1 ? "" : "s"}).` }],
        details: {
          status: outcome.status,
          patchPath,
          planHash: outcome.plan.planHash,
          writes,
          receiptPath: outcome.applied?.receiptPath ?? null,
        },
      };
    },
  });
}
