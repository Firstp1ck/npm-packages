import assert from "node:assert/strict";
import path from "node:path";
import { classifyPackageOwner, ownershipRefusalGuidance } from "../lib/update/owners.mjs";

const ownerRoot = path.resolve("tmp", "agent", "npm", "node_modules");
const packageRoot = path.join(ownerRoot, "@firstpick", "pi-package-webui");
for (const manager of ["npm", "bun"]) {
  const owner = classifyPackageOwner({ manager, ownerRoot, packageRoot, topLevel: true });
  assert.equal(owner.accepted, true, `${manager} exact top-level ownership should be accepted`);
  assert.equal(owner.manager, manager);
}
const delegatedPi = classifyPackageOwner({ manager: "pi", ownerRoot: packageRoot, packageRoot, topLevel: true });
assert.equal(delegatedPi.accepted, true, "an exact verified Pi executable may own its delegated self-update");
assert.equal(delegatedPi.manager, "pi");
for (const manager of ["pnpm", "yarn", "unknown"]) {
  const owner = classifyPackageOwner({ manager, ownerRoot, packageRoot });
  assert.equal(owner.accepted, false);
  assert.equal(owner.code, manager === "unknown" ? "unknown" : manager);
  assert.ok(owner.guidance.length > 10 && owner.guidance.length <= 320);
}
assert.equal(classifyPackageOwner({ manager: "npm", ownerRoot, packageRoot, linked: true }).code, "linked");
assert.equal(classifyPackageOwner({ manager: "npm", ownerRoot, packageRoot, sourceCheckout: true }).code, "source");
assert.equal(classifyPackageOwner({ manager: "npm", ownerRoot, packageRoot, topLevel: false }).code, "nested");
assert.equal(classifyPackageOwner({ manager: "npm", ownerRoot, packageRoot, optional: true, piOwned: false }).code, "optional");
assert.equal(classifyPackageOwner({ manager: "npm", ownerRoot, packageRoot: path.resolve("tmp", "other") }).code, "opaque");
assert.match(ownershipRefusalGuidance("source"), /never mutated automatically/i);
console.log("update-owners.test.mjs passed");
