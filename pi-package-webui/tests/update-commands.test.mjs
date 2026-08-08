import assert from "node:assert/strict";
import { exactNpmInstallArgs, exactPackageSpec, updatePlanConfirmationText } from "../lib/update-commands.mjs";

assert.equal(exactPackageSpec("@firstpick/pi-package-webui", "v1.2.3"), "@firstpick/pi-package-webui@1.2.3");
for (const version of ["latest", "next", "1", "1.2", "", "1.2.x"]) assert.throws(() => exactPackageSpec("pkg", version), /exact version/);
const args = exactNpmInstallArgs({ installRoot: "/agent/webui/runtimes/1.2.3", packageName: "@firstpick/pi-package-webui", version: "1.2.3", registry: "https://registry.npmjs.org" });
assert.deepEqual(args, [
  "install", "--prefix", "/agent/webui/runtimes/1.2.3", "--ignore-scripts", "--no-save", "--package-lock=false",
  "--registry", "https://registry.npmjs.org/", "@firstpick/pi-package-webui@1.2.3",
]);
assert.doesNotMatch(args.join(" "), /@latest|--all|--extensions|min-release-age/);
assert.throws(() => exactNpmInstallArgs({ installRoot: "/tmp", packageName: "pkg", version: "1.2.3", registry: "https://user:secret@example.test" }), /credential-free/);
const digest = "f".repeat(64);
const confirmation = updatePlanConfirmationText({ transactionId: "tx", digest, targets: [{ id: "pi", currentVersion: "1.0.0", targetVersion: "1.1.0" }], refusals: [{ id: "webui", guidance: "Source checkouts are never mutated automatically." }] });
assert.match(confirmation, /pi 1\.0\.0 → 1\.1\.0/);
assert.match(confirmation, /Source checkouts/);
assert.match(confirmation, new RegExp(digest));
console.log("update command planning tests passed");
