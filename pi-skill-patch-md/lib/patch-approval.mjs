const PLAN_HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_CONFIRMATION_TARGETS = 12;
const MAX_CONFIRMATION_RISKS = 8;
const MAX_LINE_LENGTH = 240;

function boundedLine(value) {
  const text = String(value ?? "").replace(/[\r\n\t]+/gu, " ").trim();
  return text.length <= MAX_LINE_LENGTH ? text : `${text.slice(0, MAX_LINE_LENGTH - 1)}…`;
}

function requirePlan(plan) {
  if (!plan || typeof plan !== "object") throw new Error("patchctl plan returned no structured plan");
  if (plan.ok !== true) throw new Error("patchctl plan did not report ok=true");
  if (plan.blocked === true) throw new Error("Patch plan is blocked; no approval dialog was opened");
  if (!PLAN_HASH_PATTERN.test(String(plan.planHash || ""))) throw new Error("patchctl plan returned an invalid plan hash");
  return plan;
}

export function formatPatchApprovalMessage(plan, patchPath) {
  const targets = Array.isArray(plan.targets) ? plan.targets : [];
  const risks = Array.isArray(plan.risks) ? plan.risks : [];
  const lines = [
    `Patch: ${boundedLine(plan.patchId)} v${boundedLine(plan.patchVersion)}`,
    `PATCH.md: ${boundedLine(patchPath)}`,
    `Planned writes: ${Number(plan.writes) || 0}`,
    `Plan hash: ${boundedLine(plan.planHash)}`,
    "",
    "Files/runtime targets:",
  ];

  for (const target of targets.slice(0, MAX_CONFIRMATION_TARGETS)) {
    const roles = Array.isArray(target.roles) ? target.roles.map(boundedLine).filter(Boolean).join(", ") : "runtime";
    const version = target.packageVersion ? ` v${boundedLine(target.packageVersion)}` : "";
    const status = target.status ? ` [${boundedLine(target.status)}]` : "";
    lines.push(`• ${roles}${version}${status}: ${boundedLine(target.file || target.path || target.id)}`);
  }
  if (targets.length > MAX_CONFIRMATION_TARGETS) lines.push(`• …and ${targets.length - MAX_CONFIRMATION_TARGETS} more target(s)`);

  if (risks.length > 0) {
    lines.push("", "Risks:");
    for (const risk of risks.slice(0, MAX_CONFIRMATION_RISKS)) lines.push(`• ${boundedLine(risk)}`);
    if (risks.length > MAX_CONFIRMATION_RISKS) lines.push(`• …and ${risks.length - MAX_CONFIRMATION_RISKS} more risk(s)`);
  }

  lines.push(
    "",
    "Approval applies only to this exact plan hash. patchctl will recompute the plan and refuse if anything changed.",
    "This action may modify installed package files and create local backups/receipts. It does not install packages or run live provider verification.",
    "",
    "Apply this reviewed patch now?",
  );
  return lines.join("\n");
}

export async function runPatchApproval({
  patchPath,
  reviewedPlanHash,
  requestPlan,
  requestApproval,
  applyPlan,
}) {
  if (!patchPath || typeof patchPath !== "string") throw new Error("patchPath is required");
  if (!PLAN_HASH_PATTERN.test(String(reviewedPlanHash || ""))) throw new Error("reviewedPlanHash must be a 64-character lowercase SHA-256 hash");
  if (typeof requestPlan !== "function" || typeof requestApproval !== "function" || typeof applyPlan !== "function") {
    throw new Error("Patch approval dependencies are incomplete");
  }

  const plan = requirePlan(await requestPlan());
  if (plan.planHash !== reviewedPlanHash) {
    throw new Error(`Plan hash changed; reviewed ${reviewedPlanHash}, current ${plan.planHash}. Review the fresh plan before applying.`);
  }

  if (plan.noop === true || Number(plan.writes) === 0) {
    return { status: "noop", plan, applied: null };
  }

  const approved = await requestApproval({
    title: "Apply reviewed patch now?",
    message: formatPatchApprovalMessage(plan, patchPath),
  });
  if (approved !== true) return { status: "declined", plan, applied: null };

  const applied = await applyPlan(plan.planHash);
  if (!applied || applied.ok !== true || applied.action !== "apply") throw new Error("patchctl apply did not report a successful apply result");
  if (applied.planHash !== plan.planHash) throw new Error("patchctl apply returned a different plan hash");
  return { status: applied.noop === true ? "noop" : "applied", plan, applied };
}

export function parsePatchctlResult(action, result) {
  let payload;
  try {
    payload = JSON.parse(String(result?.stdout || ""));
  } catch {
    const detail = boundedLine(result?.stderr || result?.stdout || "no output");
    throw new Error(`patchctl ${action} returned invalid JSON: ${detail}`);
  }
  if (result?.code !== 0 || payload?.ok === false) {
    const detail = boundedLine(payload?.error || result?.stderr || result?.stdout || `exit ${result?.code}`);
    throw new Error(`patchctl ${action} failed: ${detail}`);
  }
  return payload;
}
