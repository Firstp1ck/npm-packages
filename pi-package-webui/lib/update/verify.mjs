function version(value) {
  return String(value ?? "").trim().replace(/^v/i, "");
}

function receipt(target, status, detail = {}) {
  return Object.freeze({
    targetId: String(target?.id || detail.targetId || ""),
    kind: String(target?.kind || detail.kind || "package"),
    status,
    beforeVersion: version(detail.beforeVersion ?? target?.currentVersion),
    expectedVersion: version(detail.expectedVersion ?? target?.targetVersion),
    afterVersion: version(detail.afterVersion),
    message: String(detail.message || ""),
    command: detail.command || null,
  });
}

/** Exit zero is insufficient: identity, exact promised version, and a change are mandatory. */
export function verifyTargetResult(target, { beforeIdentity, afterIdentity, beforeVersion, afterVersion, command } = {}) {
  const before = version(beforeVersion ?? target?.currentVersion);
  const after = version(afterVersion);
  const expected = version(target?.targetVersion);
  if (beforeIdentity?.canonicalId && afterIdentity?.canonicalId && beforeIdentity.canonicalId !== afterIdentity.canonicalId) {
    return receipt(target, "failed", { beforeVersion: before, afterVersion: after, command, message: "Runtime identity changed during verification." });
  }
  if (!after) return receipt(target, "failed", { beforeVersion: before, afterVersion: after, command, message: "The updated version could not be read." });
  if (after === before) return receipt(target, "failed", { beforeVersion: before, afterVersion: after, command, message: "The command completed without changing the installed version." });
  if (!expected || after !== expected) {
    return receipt(target, "failed", { beforeVersion: before, afterVersion: after, command, message: `Expected exact version ${expected || "unknown"}, found ${after}.` });
  }
  return receipt(target, "success", { beforeVersion: before, afterVersion: after, command, message: `Verified ${after}.` });
}

export function failedTargetReceipt(target, message, detail = {}) {
  return receipt(target, "failed", { ...detail, message });
}

export function rolledBackTargetReceipt(target, message, detail = {}) {
  return receipt(target, "rolled-back", { ...detail, message });
}

export function reduceUpdateReceipts(receipts = []) {
  const ordered = Object.freeze(receipts.map((item) => Object.freeze({ ...item })));
  const successes = ordered.filter((item) => item.status === "success").length;
  const rolledBack = ordered.filter((item) => item.status === "rolled-back").length;
  const failures = ordered.length - successes - rolledBack;
  let outcome = "failed";
  if (ordered.length > 0 && successes === ordered.length) outcome = "success";
  else if (successes > 0) outcome = "partial";
  else if (rolledBack > 0 && failures === 0) outcome = "rolled-back";
  return Object.freeze({ outcome, receipts: ordered, counts: Object.freeze({ success: successes, failed: failures, rolledBack }) });
}
