const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function exactPackageSpec(packageName, version) {
  const name = String(packageName || "").trim();
  const exact = String(version || "").trim().replace(/^v/i, "");
  if (!name || !EXACT_VERSION.test(exact)) throw new TypeError("packageName and an exact version are required");
  return `${name}@${exact}`;
}

export function exactNpmInstallArgs({ installRoot, packageName, version, registry } = {}) {
  const root = String(installRoot || "").trim();
  const registryUrl = new URL(String(registry || ""));
  if (!root) throw new TypeError("installRoot is required");
  if (!/^https?:$/.test(registryUrl.protocol) || registryUrl.username || registryUrl.password || registryUrl.hash) {
    throw new TypeError("registry must be a credential-free HTTP(S) URL");
  }
  return [
    "install", "--prefix", root, "--ignore-scripts", "--no-save", "--package-lock=false",
    "--registry", registryUrl.href, exactPackageSpec(packageName, version),
  ];
}

export function updatePlanConfirmationText(plan) {
  if (!plan?.transactionId || !/^[a-f0-9]{64}$/.test(String(plan.digest || ""))) throw new TypeError("persisted update plan is required");
  const targets = (plan.targets || []).map((target) => `${target.id} ${target.currentVersion} → ${target.targetVersion}`);
  const refusals = (plan.refusals || []).map((item) => `${item.id}: ${item.guidance}`);
  return [
    targets.length ? `Exact targets: ${targets.join(" · ")}` : "No automatic targets were accepted.",
    refusals.length ? `Refused: ${refusals.join(" · ")}` : "",
    `Plan digest: ${plan.digest}`,
  ].filter(Boolean).join("\n");
}
