#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRY = "https://registry.npmjs.org";
const SDK_SPEC = "@cursor/sdk@latest";
const COMMAND_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

function packageInstances(lockfile, packageName) {
	const suffix = `/node_modules/${packageName}`;
	return Object.entries(lockfile?.packages ?? {})
		.filter(([path, value]) => value && (path === `node_modules/${packageName}` || path.endsWith(suffix)))
		.map(([path, value]) => ({ path, version: String(value.version ?? "unknown") }))
		.sort((a, b) => a.path.localeCompare(b.path) || a.version.localeCompare(b.version));
}

function normalizedAdvisories(undiciAudit) {
	const advisories = (undiciAudit?.via ?? [])
		.filter((entry) => entry && typeof entry === "object")
		.map((entry) => ({
			id: String(entry.source ?? "unknown"),
			severity: String(entry.severity ?? "unknown"),
			title: String(entry.title ?? "unknown"),
			url: String(entry.url ?? "unknown"),
			range: String(entry.range ?? "unknown"),
		}));
	return advisories.sort((a, b) => a.id.localeCompare(b.id) || a.url.localeCompare(b.url));
}

function baseResult(lockfile) {
	return {
		schemaVersion: 1,
		checkedPackage: SDK_SPEC,
		registry: REGISTRY,
		resolved: {
			cursorSdk: packageInstances(lockfile, "@cursor/sdk"),
			connectNode: packageInstances(lockfile, "@connectrpc/connect-node"),
			undici: packageInstances(lockfile, "undici"),
		},
	};
}

export function analyzeLockAndAudit(lockfile, auditReport) {
	const base = baseResult(lockfile);
	if (base.resolved.cursorSdk.length !== 1) {
		return {
			...base,
			status: "indeterminate",
			upstreamSolved: null,
			exitCode: 2,
			reason: `Expected exactly one resolved @cursor/sdk package, found ${base.resolved.cursorSdk.length}.`,
			audit: null,
		};
	}
	if (!auditReport || typeof auditReport !== "object" || auditReport.error) {
		return {
			...base,
			status: "indeterminate",
			upstreamSolved: null,
			exitCode: 2,
			reason: "npm audit did not return a usable report.",
			audit: null,
		};
	}
	if (!auditReport.vulnerabilities || typeof auditReport.vulnerabilities !== "object") {
		return {
			...base,
			status: "indeterminate",
			upstreamSolved: null,
			exitCode: 2,
			reason: "npm audit report is missing the vulnerabilities object.",
			audit: null,
		};
	}

	const undiciAudit = auditReport.vulnerabilities.undici;
	const vulnerable = Boolean(undiciAudit);
	return {
		...base,
		status: vulnerable ? "vulnerable" : "solved",
		upstreamSolved: !vulnerable,
		exitCode: vulnerable ? 1 : 0,
		reason: vulnerable
			? "npm audit reports a vulnerable undici package in the isolated @cursor/sdk@latest production graph."
			: "npm audit reports no vulnerable undici package in the isolated @cursor/sdk@latest production graph.",
		audit: {
			undiciVulnerable: vulnerable,
			severity: vulnerable ? String(undiciAudit.severity ?? "unknown") : null,
			range: vulnerable ? String(undiciAudit.range ?? "unknown") : null,
			advisories: vulnerable ? normalizedAdvisories(undiciAudit) : [],
		},
	};
}

function resolvedVersion(instances, packageName) {
	if (!instances?.length) return `${packageName}: not present`;
	return instances.map((instance) => `${packageName}@${instance.version}`).join(", ");
}

function advisoryCountSummary(advisories) {
	if (!advisories.length) return "0";
	const counts = new Map();
	for (const advisory of advisories) counts.set(advisory.severity, (counts.get(advisory.severity) ?? 0) + 1);
	const orderedSeverities = ["critical", "high", "moderate", "low", "info", "unknown"];
	const details = orderedSeverities.filter((severity) => counts.has(severity)).map((severity) => `${counts.get(severity)} ${severity}`);
	return `${advisories.length} (${details.join(", ")})`;
}

export function formatEvaluation(result) {
	const heading = result.status === "solved" ? "FIXED" : result.status === "vulnerable" ? "NOT FIXED" : "INDETERMINATE";
	const action =
		result.status === "solved"
			? "Review the upstream release, then test removing the local @cursor/sdk pin."
			: result.status === "vulnerable"
				? "Keep the current local @cursor/sdk pin and run this check again after Cursor publishes a newer SDK."
				: "Keep the current local @cursor/sdk pin and retry the check later.";
	const lines = [
		`Cursor SDK upstream check: ${heading}`,
		"",
		`Evaluation: ${result.reason}`,
		"",
		"Resolved upstream dependency graph:",
		`  ${resolvedVersion(result.resolved?.cursorSdk, "@cursor/sdk")}`,
		`  ${resolvedVersion(result.resolved?.connectNode, "@connectrpc/connect-node")}`,
		`  ${resolvedVersion(result.resolved?.undici, "undici")}`,
	];
	if (result.audit) {
		lines.push(
			"",
			"Audit summary:",
			`  Highest severity: ${result.audit.severity ?? "none"}`,
			`  Advisories: ${advisoryCountSummary(result.audit.advisories ?? [])}`,
		);
	}
	lines.push("", `Recommended action: ${action}`, `Exit code: ${result.exitCode}`);
	return lines.join("\n");
}

function sanitizeMessage(value, temporaryDirectory) {
	return String(value ?? "unknown error")
		.replaceAll(temporaryDirectory, "<temporary-directory>")
		.replace(/\s+/g, " ")
		.trim();
}

function run(command, args, cwd) {
	return new Promise((resolveResult) => {
		execFile(
			command,
			args,
			{
				cwd,
				env: {
					...process.env,
					NO_UPDATE_NOTIFIER: "1",
					npm_config_audit: "false",
					npm_config_fund: "false",
					npm_config_update_notifier: "false",
				},
				timeout: COMMAND_TIMEOUT_MS,
				maxBuffer: MAX_OUTPUT_BYTES,
			},
			(error, stdout, stderr) => {
				resolveResult({
					exitCode: error ? (typeof error.code === "number" ? error.code : null) : 0,
					error,
					stdout: String(stdout ?? ""),
					stderr: String(stderr ?? ""),
				});
			},
		);
	});
}

function indeterminateResult(reason) {
	return {
		schemaVersion: 1,
		checkedPackage: SDK_SPEC,
		registry: REGISTRY,
		resolved: { cursorSdk: [], connectNode: [], undici: [] },
		status: "indeterminate",
		upstreamSolved: null,
		exitCode: 2,
		reason,
		audit: null,
	};
}

export async function checkUpstream() {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "cursor-sdk-upstream-check-"));
	const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
	try {
		await writeFile(
			join(temporaryDirectory, "package.json"),
			`${JSON.stringify({ name: "cursor-sdk-upstream-check", version: "0.0.0", private: true, dependencies: { "@cursor/sdk": "latest" } }, null, 2)}\n`,
		);

		const install = await run(
			npmCommand,
			["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--fund=false", `--registry=${REGISTRY}`],
			temporaryDirectory,
		);
		if (install.exitCode !== 0) {
			return indeterminateResult(`npm install failed: ${sanitizeMessage(install.stderr || install.error?.message, temporaryDirectory)}`);
		}

		const lockfile = JSON.parse(await readFile(join(temporaryDirectory, "package-lock.json"), "utf8"));
		const audit = await run(
			npmCommand,
			["audit", "--package-lock-only", "--omit=dev", "--json", `--registry=${REGISTRY}`],
			temporaryDirectory,
		);
		let auditReport;
		try {
			auditReport = JSON.parse(audit.stdout);
		} catch {
			return {
				...baseResult(lockfile),
				status: "indeterminate",
				upstreamSolved: null,
				exitCode: 2,
				reason: `npm audit returned invalid JSON: ${sanitizeMessage(audit.stderr || audit.error?.message, temporaryDirectory)}`,
				audit: null,
			};
		}
		return analyzeLockAndAudit(lockfile, auditReport);
	} catch (error) {
		return indeterminateResult(sanitizeMessage(error instanceof Error ? error.message : error, temporaryDirectory));
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

function printHelp() {
	console.log("Check whether @cursor/sdk@latest still resolves to an npm-audited vulnerable undici dependency.");
	console.log("Exit codes: 0=solved, 1=vulnerable, 2=indeterminate. Output is a concise plain-text evaluation.");
}

async function main() {
	if (process.argv.includes("--help") || process.argv.includes("-h")) {
		printHelp();
		return;
	}
	const result = await checkUpstream();
	console.log(formatEvaluation(result));
	process.exitCode = result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.log(formatEvaluation(indeterminateResult(error instanceof Error ? error.message : error)));
		process.exitCode = 2;
	});
}
