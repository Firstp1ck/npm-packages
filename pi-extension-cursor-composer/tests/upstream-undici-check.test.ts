import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLockAndAudit, formatEvaluation } from "../scripts/check-cursor-sdk-upstream.mjs";

function lockfile({ sdk = "1.0.27", connect = "1.7.0", undici }: { sdk?: string; connect?: string | null; undici?: string | null } = {}) {
	return {
		packages: {
			"": { dependencies: { "@cursor/sdk": "latest" } },
			"node_modules/@cursor/sdk": { version: sdk },
			...(connect ? { "node_modules/@connectrpc/connect-node": { version: connect } } : {}),
			...(undici ? { "node_modules/undici": { version: undici } } : {}),
		},
	};
}

test("reports the upstream chain as vulnerable from npm audit evidence", () => {
	const result = analyzeLockAndAudit(lockfile({ undici: "5.29.0" }), {
		vulnerabilities: {
			undici: {
				severity: "high",
				range: "<=6.27.0",
				via: [
					{ source: 20, severity: "high", title: "second", url: "https://example.test/20", range: "<6.24.0" },
					{ source: 10, severity: "moderate", title: "first", url: "https://example.test/10", range: "<6.23.0" },
				],
			},
		},
	});

	assert.equal(result.status, "vulnerable");
	assert.equal(result.upstreamSolved, false);
	assert.equal(result.exitCode, 1);
	assert.deepEqual(result.resolved.undici, [{ path: "node_modules/undici", version: "5.29.0" }]);
	assert.deepEqual(result.audit?.advisories.map((advisory: { id: string }) => advisory.id), ["10", "20"]);

	const evaluation = formatEvaluation(result);
	assert.match(evaluation, /^Cursor SDK upstream check: NOT FIXED/m);
	assert.match(evaluation, /@cursor\/sdk@1\.0\.27/);
	assert.match(evaluation, /Advisories: 2 \(1 high, 1 moderate\)/);
	assert.match(evaluation, /Keep the current local @cursor\/sdk pin/);
	assert.doesNotMatch(evaluation, /^\s*\{/);
});

test("reports solved when npm audit has no undici finding", () => {
	const result = analyzeLockAndAudit(lockfile({ connect: "2.1.2", undici: null }), { vulnerabilities: {} });

	assert.equal(result.status, "solved");
	assert.equal(result.upstreamSolved, true);
	assert.equal(result.exitCode, 0);
	assert.deepEqual(result.resolved.undici, []);
	assert.deepEqual(result.audit?.advisories, []);
	assert.match(formatEvaluation(result), /^Cursor SDK upstream check: FIXED/m);
});

test("allows a present but patched undici version when audit is clean", () => {
	const result = analyzeLockAndAudit(lockfile({ undici: "6.28.0" }), { vulnerabilities: {} });

	assert.equal(result.status, "solved");
	assert.deepEqual(result.resolved.undici, [{ path: "node_modules/undici", version: "6.28.0" }]);
});

test("reports indeterminate for malformed audit output", () => {
	const result = analyzeLockAndAudit(lockfile({ undici: "5.29.0" }), { error: { code: "EAI_AGAIN" } });

	assert.equal(result.status, "indeterminate");
	assert.equal(result.upstreamSolved, null);
	assert.equal(result.exitCode, 2);
	assert.match(formatEvaluation(result), /^Cursor SDK upstream check: INDETERMINATE/m);
});

test("reports indeterminate when the SDK did not resolve exactly once", () => {
	const result = analyzeLockAndAudit({ packages: {} }, { vulnerabilities: {} });

	assert.equal(result.status, "indeterminate");
	assert.match(result.reason, /Expected exactly one resolved @cursor\/sdk/);
});
