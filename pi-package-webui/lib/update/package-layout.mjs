import path from "node:path";

function pathApi(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function exactPathInside(api, root, candidate) {
  const relative = api.relative(api.resolve(root), api.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${api.sep}`) && relative !== ".." && !api.isAbsolute(relative));
}

function sameExactPath(api, left, right) {
  return exactPathInside(api, left, right) && exactPathInside(api, right, left);
}

/** Return the installation root that owns the nearest node_modules containing a package. */
export function packageOwnerRoot(packageRoot, { platform = process.platform } = {}) {
  const api = pathApi(platform);
  const resolved = api.resolve(String(packageRoot || ""));
  if (!packageRoot) return "";
  let cursor = resolved;
  while (true) {
    if (api.basename(cursor).toLowerCase() === "node_modules") return api.dirname(cursor);
    const parent = api.dirname(cursor);
    if (parent === cursor) return resolved;
    cursor = parent;
  }
}

/**
 * Prove that a resolver-selected bundled package belongs to the Web UI package
 * installation. Supports both package-local nesting and npm's normal hoisted
 * sibling layout while refusing explicit, PATH, unrelated, and opaque roots.
 */
export function bundledPackageOwnership({ hostPackageRoot = "", packageRoot = "", source = "" } = {}, { platform = process.platform } = {}) {
  if (source !== "bundled" || !hostPackageRoot || !packageRoot) return null;
  const api = pathApi(platform);
  const hostRoot = api.resolve(hostPackageRoot);
  const bundledRoot = api.resolve(packageRoot);
  const nested = exactPathInside(api, api.join(hostRoot, "node_modules"), bundledRoot);
  const hostOwnerRoot = packageOwnerRoot(hostRoot, { platform });
  const bundledOwnerRoot = packageOwnerRoot(bundledRoot, { platform });
  const hoisted = Boolean(hostOwnerRoot && bundledOwnerRoot && sameExactPath(api, hostOwnerRoot, bundledOwnerRoot));
  if (!nested && !hoisted) return null;
  return Object.freeze({
    ownerRoot: bundledOwnerRoot,
    packageRoot: bundledRoot,
    layout: nested ? "nested" : "hoisted",
  });
}
