import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNativeCommandTrust,
  evaluateDispatchTrustGuards,
  evaluateTrustGuards,
  guardsForNativeCommand,
  isLocalAddress,
  isLocalRequest,
  LOCALHOST_ONLY_POST_ROUTES,
  remoteShellTrustWarning,
  requireLocalhost,
  requireLocalhostRoute,
  TRUST_GUARD_TYPES,
} from "../lib/trust-boundaries.mjs";
import {
  nativeCommandBlocked,
  nativeCommandResponse,
  nativeCommandUnavailable,
  nativeParitySurfaceForCommand,
  nativeSlashCommandEntries,
  NATIVE_COMMAND_STATUSES,
  NATIVE_REFRESH_TARGETS,
  parseSlashCommand,
  rpcSuccess,
} from "../lib/native-command-adapter.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parity = JSON.parse(await readFile(join(root, "lib", "WEBUI_TUI_NATIVE_PARITY.json"), "utf8"));

const localReq = { socket: { remoteAddress: "127.0.0.1" } };
const remoteReq = { socket: { remoteAddress: "192.168.1.50" } };

assert.equal(isLocalAddress("127.0.0.1"), true);
assert.equal(isLocalAddress("::ffff:127.0.0.1"), true);
assert.equal(isLocalAddress("::1"), true);
assert.equal(isLocalAddress("192.168.1.50"), false);
assert.equal(isLocalRequest(localReq), true);
assert.equal(isLocalRequest(remoteReq), false);

assert.throws(() => requireLocalhost(remoteReq, "blocked"), (error) => error.statusCode === 403);
assert.throws(() => requireLocalhostRoute(remoteReq, "/api/update"), (error) => error.statusCode === 403);
assert.doesNotThrow(() => requireLocalhostRoute(localReq, "/api/update"));

for (const pathname of LOCALHOST_ONLY_POST_ROUTES.keys()) {
  assert.match(pathname, /^\/api\//, `${pathname} should be an API route`);
}

for (const guard of parity.guardTaxonomy) {
  assert.ok(TRUST_GUARD_TYPES.has(guard), `trust-boundaries should know parity guard ${guard}`);
}

const exportGuards = guardsForNativeCommand("export", parity);
assert.ok(exportGuards.includes("localhost"), "export should declare localhost guard in parity matrix");

const exportDispatchLocal = evaluateDispatchTrustGuards(exportGuards, { isLocal: true, confirmed: false });
const exportDispatchRemote = evaluateDispatchTrustGuards(exportGuards, { isLocal: false, confirmed: false, networkOpen: true });
assert.equal(exportDispatchLocal.allowed, true);
assert.equal(exportDispatchRemote.allowed, false);
assert.ok(exportDispatchRemote.blocked.includes("localhost"));

const exportFullLocal = evaluateTrustGuards(exportGuards, { isLocal: true, confirmed: false });
assert.equal(exportFullLocal.allowed, false);
assert.ok(exportFullLocal.blocked.includes("confirmation"));

// Dispatch enforcement is guards-driven: every slash command declaring a
// localhost/trusted-context guard must block remote contexts, sensitive or not.
for (const surface of parity.surfaces) {
  if (surface.kind !== "slash-command") continue;
  const guards = guardsForNativeCommand(surface.command.name, parity);
  const dispatchGuarded = guards.some((guard) => guard === "localhost" || guard === "trusted-context");
  const remoteEvaluation = evaluateDispatchTrustGuards(guards, { isLocal: false, confirmed: true, networkOpen: true });
  assert.equal(
    remoteEvaluation.allowed,
    !dispatchGuarded,
    `/${surface.command.name} remote dispatch should be ${dispatchGuarded ? "blocked" : "allowed"} based on its guards`,
  );
  const localEvaluation = evaluateDispatchTrustGuards(guards, { isLocal: true, confirmed: true, networkOpen: false });
  assert.equal(localEvaluation.allowed, true, `/${surface.command.name} localhost dispatch should be allowed`);
}

assert.throws(
  () => assertNativeCommandTrust(remoteReq, "export", parity),
  (error) => error.statusCode === 403 && error.trust?.command === "export",
);

const parsedExport = parseSlashCommand("/export out.html", new Set(["export", "copy"]));
assert.deepEqual(parsedExport, { name: "export", args: "out.html", text: "/export out.html" });
assert.equal(parseSlashCommand("/copy", new Set(["export"])), undefined);

const success = nativeCommandResponse(
  "copy",
  { status: "succeeded", message: "Copied the last assistant message.", copyText: "hello" },
  parity,
);
assert.equal(success.command, "native_slash_command");
assert.equal(success.success, true);
assert.equal(success.data.command, "copy");
assert.equal(success.data.status, "succeeded");
assert.ok(Array.isArray(success.data.cards) && success.data.cards.length === 1);
assert.equal(success.data.cards[0].content, "Copied the last assistant message.");
assert.deepEqual(success.data.refresh, ["state"]);

const unavailable = nativeCommandUnavailable("import", {}, parity);
assert.equal(unavailable.data.status, "unavailable");
assert.ok(unavailable.data.message.includes("/import is not available"));
assert.ok(Array.isArray(unavailable.data.cards));

const blocked = nativeCommandBlocked("export", remoteReq, parity, { networkOpen: true });
assert.equal(blocked.data.status, "blocked");
assert.match(blocked.data.message, /blocked/i);

const hotkeysSurface = nativeParitySurfaceForCommand("hotkeys", parity);
assert.equal(hotkeysSurface.webStatus, "degraded");
const hotkeys = nativeCommandResponse("hotkeys", { status: "degraded", message: "keys" }, parity);
assert.equal(hotkeys.data.status, "degraded");

const reload = nativeCommandResponse("reload", { status: "succeeded", message: "ok", tab: { id: "t1" }, refresh: ["tabs", "state", "commands"] }, parity);
assert.deepEqual(reload.data.refresh, ["tabs", "state", "commands"]);

for (const status of ["succeeded", "degraded", "unavailable", "confirmation_required", "blocked"]) {
  assert.ok(NATIVE_COMMAND_STATUSES.has(status), `adapter should support status ${status}`);
}

for (const target of ["state", "tabs", "commands", "themes", "workspace"]) {
  assert.ok(NATIVE_REFRESH_TARGETS.has(target), `adapter should support refresh target ${target}`);
}

const slashCommands = nativeSlashCommandEntries(parity);
assert.equal(slashCommands.length, 24);
assert.equal(slashCommands[0].name, "settings");
assert.equal(slashCommands.at(-1).name, "quit");

const warning = remoteShellTrustWarning(remoteReq, true);
assert.match(warning, /not on localhost/i);
assert.equal(remoteShellTrustWarning(localReq, true), undefined);

assert.deepEqual(rpcSuccess("get_state", { ok: true }), {
  type: "response",
  command: "get_state",
  success: true,
  data: { ok: true },
});

console.log("native-parity-harness.test.mjs passed");
