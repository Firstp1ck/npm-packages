import path from "node:path";

const REFUSALS = Object.freeze({
  pnpm: "This package is owned by pnpm. Update it manually with the owning pnpm installation.",
  yarn: "This package is owned by Yarn. Update it manually with the owning Yarn installation.",
  source: "Source checkouts are never mutated automatically. Pull and rebuild this checkout manually.",
  linked: "Linked packages are never mutated automatically. Update the link target manually.",
  unknown: "Package ownership could not be proven. Update the package manually with its owning tool.",
  opaque: "The installation root is opaque or outside its declared owner root; automatic update is refused.",
  nested: "Only exact top-level packages may be updated automatically; transitive packages are refused.",
  optional: "Optional packages require explicit Pi-owned registration before automatic update.",
});

function bounded(value, max = 320) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function refusal(code, manager, detail = "") {
  return Object.freeze({
    accepted: false,
    code,
    manager: manager || "unknown",
    guidance: bounded(detail || REFUSALS[code] || REFUSALS.unknown),
  });
}

/** Fail-closed package ownership classification for exact top-level targets. */
export function classifyPackageOwner({
  manager = "unknown",
  packageRoot = "",
  ownerRoot = "",
  topLevel = true,
  linked = false,
  sourceCheckout = false,
  optional = false,
  piOwned = false,
} = {}) {
  const normalizedManager = String(manager || "unknown").trim().toLowerCase();
  if (sourceCheckout) return refusal("source", normalizedManager);
  if (linked) return refusal("linked", normalizedManager);
  if (!topLevel) return refusal("nested", normalizedManager);
  if (optional && !piOwned) return refusal("optional", normalizedManager);
  if (normalizedManager === "pnpm" || normalizedManager === "yarn") return refusal(normalizedManager, normalizedManager);
  if (!["npm", "bun", "pi"].includes(normalizedManager)) return refusal("unknown", normalizedManager);
  if (!packageRoot || !ownerRoot) return refusal("opaque", normalizedManager);
  try {
    if (!inside(ownerRoot, packageRoot)) return refusal("opaque", normalizedManager);
  } catch {
    return refusal("opaque", normalizedManager);
  }
  return Object.freeze({
    accepted: true,
    code: "owned",
    manager: normalizedManager,
    packageRoot: path.resolve(packageRoot),
    ownerRoot: path.resolve(ownerRoot),
    scope: optional ? "pi-owned-optional" : "core",
    topLevel: true,
  });
}

export function ownershipRefusalGuidance(code) {
  return bounded(REFUSALS[code] || REFUSALS.unknown);
}
