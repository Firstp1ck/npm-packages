import assert from "node:assert/strict";
import path from "node:path";
import { bundledPackageOwnership, packageOwnerRoot } from "../lib/update/package-layout.mjs";

const posixInstall = "/opt/pi-runtime";
const posixWebui = path.posix.join(posixInstall, "node_modules", "@firstpick", "pi-package-webui");
const posixPi = path.posix.join(posixInstall, "node_modules", "@earendil-works", "pi-coding-agent");
assert.equal(packageOwnerRoot(posixWebui, { platform: "linux" }), posixInstall);
assert.deepEqual(bundledPackageOwnership({ hostPackageRoot: posixWebui, packageRoot: posixPi, source: "bundled" }, { platform: "linux" }), {
  ownerRoot: posixInstall,
  packageRoot: posixPi,
  layout: "hoisted",
}, "npm-hoisted sibling packages should share one proven installation owner");

const nestedPi = path.posix.join(posixWebui, "node_modules", "@earendil-works", "pi-coding-agent");
assert.deepEqual(bundledPackageOwnership({ hostPackageRoot: posixWebui, packageRoot: nestedPi, source: "bundled" }, { platform: "linux" }), {
  ownerRoot: posixWebui,
  packageRoot: nestedPi,
  layout: "nested",
}, "package-local bundled Pi remains supported");

for (const source of ["explicit", "path", ""]) {
  assert.equal(bundledPackageOwnership({ hostPackageRoot: posixWebui, packageRoot: posixPi, source }, { platform: "linux" }), null, `${source || "empty"} identities must not inherit bundled npm ownership`);
}
assert.equal(bundledPackageOwnership({
  hostPackageRoot: posixWebui,
  packageRoot: "/other/node_modules/@earendil-works/pi-coding-agent",
  source: "bundled",
}, { platform: "linux" }), null, "unrelated package roots must fail closed");

const windowsInstall = "C:\\Users\\dev\\.pi\\agent\\webui\\runtimes\\txn-1";
const windowsWebui = path.win32.join(windowsInstall, "node_modules", "@firstpick", "pi-package-webui");
const windowsPi = path.win32.join(windowsInstall.toUpperCase(), "node_modules", "@earendil-works", "pi-coding-agent");
const windowsOwnership = bundledPackageOwnership({ hostPackageRoot: windowsWebui, packageRoot: windowsPi, source: "bundled" }, { platform: "win32" });
assert.equal(windowsOwnership?.layout, "hoisted");
assert.equal(windowsOwnership?.ownerRoot.toLowerCase(), windowsInstall.toLowerCase(), "Windows ownership comparison should tolerate path casing differences");

console.log("update-package-layout.test.mjs passed");
