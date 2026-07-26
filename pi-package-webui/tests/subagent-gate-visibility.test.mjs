import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUBAGENT_GATE_RETENTION_MS,
  pruneDismissedSubagentGateKeys,
  subagentGateIsTerminal,
  subagentGateKey,
  visibleSubagentGates,
} from "../public/subagent-gate-visibility.mjs";

const now = 100_000;
const tab = {
  tabId: "tab-a",
  gates: [
    { id: "running", status: "running", endedAt: 1 },
    { id: "fresh", status: "failed", endedAt: now - SUBAGENT_GATE_RETENTION_MS + 1 },
    { id: "expired", status: "satisfied", endedAt: now - SUBAGENT_GATE_RETENTION_MS },
    { id: "updated", status: "cancelled", updatedAt: now - 1_000 },
    { id: "untimed", status: "failed" },
  ],
};

assert.equal(SUBAGENT_GATE_RETENTION_MS, 30_000, "terminal retry gates should remain readable for 30 seconds");
assert.equal(subagentGateKey("tab-a", "gate-a"), "tab-a:gate-a");
assert.equal(subagentGateKey("", "gate-a"), "");
assert.equal(subagentGateIsTerminal({ status: "running" }), false);
assert.equal(subagentGateIsTerminal({ status: "failed" }), true);

assert.deepEqual(
  visibleSubagentGates(tab, new Set(), now).map((gate) => gate.id),
  ["running", "fresh", "updated", "untimed"],
  "running gates should remain visible while terminal gates should expire after the retention window",
);

assert.deepEqual(
  visibleSubagentGates(tab, new Set(["tab-a:fresh"]), now).map((gate) => gate.id),
  ["running", "updated", "untimed"],
  "manual dismissal should hide a terminal gate immediately",
);

const dismissed = new Set(["tab-a:fresh", "tab-z:gone"]);
pruneDismissedSubagentGateKeys([tab], dismissed);
assert.deepEqual([...dismissed], ["tab-a:fresh"], "dismissal state should be pruned after its gate leaves the server snapshot");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [app, css, serviceWorker, server, pkgRaw] = await Promise.all([
  readFile(join(root, "public", "app.js"), "utf8"),
  readFile(join(root, "public", "styles.css"), "utf8"),
  readFile(join(root, "public", "service-worker.js"), "utf8"),
  readFile(join(root, "bin", "pi-webui.mjs"), "utf8"),
  readFile(join(root, "package.json"), "utf8"),
]);
const pkg = JSON.parse(pkgRaw);

assert.match(app, /from "\.\/subagent-gate-visibility\.mjs"/, "the browser should load the retry-gate visibility policy");
assert.match(app, /function subagentTabsWithRunningAgents\(\)[\s\S]*latestSubagents\?\.updatedAt[\s\S]*visibleSubagentGates\(tab, dismissedSubagentGateKeys, now\)/, "the side panel should use server time and filter expired or dismissed gates before deriving counts");
assert.match(app, /function renderSubagentGate\(tab, gate\)[\s\S]*subagentGateIsTerminal\(gate\)[\s\S]*Hide finished retry gate[\s\S]*dismissedSubagentGateKeys\.add\(key\)[\s\S]*renderSubagents\(\)[\s\S]*event\.detail === 0[\s\S]*focusTarget\?\.focus/, "terminal gate cards should expose an accessible hide button and preserve keyboard focus after rerendering");
assert.match(app, /pruneDismissedSubagentGateKeys\(latestSubagents\?\.tabs, dismissedSubagentGateKeys\)/, "polling should prune stale dismissal keys");
assert.match(css, /\.subagent-gate-actions[\s\S]*\.subagent-gate-close[\s\S]*min-width:\s*1\.75rem[\s\S]*\.subagent-gate-close:hover,[\s\S]*\.subagent-gate-close:focus-visible/, "the close control should remain compact and keyboard-visible");
assert.match(serviceWorker, /"\/subagent-gate-visibility\.mjs"/, "the PWA app shell should cache the visibility module");
assert.match(server, /"subagent-gate-visibility\.mjs"/, "the server static allowlist should serve the visibility module");
assert.match(pkg.scripts.check, /node --check public\/subagent-gate-visibility\.mjs/, "the package check should syntax-check the visibility module");

console.log("subagent gate visibility tests passed");
