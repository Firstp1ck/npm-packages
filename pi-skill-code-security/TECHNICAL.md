# Technical reference: Code Security

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A Pi skill for code security reviews, leaked secret checks, dependency risk, unsafe shell/Python/TypeScript/Rust patterns, auth/input-validation flaws, SAST-style audits, or supply-chain concerns in repositories.

## Install

```bash
pi install npm:@firstpick/pi-skill-code-security
```

## Safe review mode

Secret scans can expose matching values in terminal or model output. Redact findings, avoid copying credentials into chat/logs, and rotate confirmed leaks through the owning service.

Read-only scanning may use project-provided tools. Installing scanners, running forced dependency fixes, updating lockfiles, writing findings to `MEMORY.md`, rewriting Git history, and force pushing are separate mutating actions that require explicit approval. Prefer a report-only pass before remediation.

## Example view

```text
User: Audit this authentication change and Git history for security issues. Redact secret values and do not install tools, rewrite history, or apply fixes.
Agent: Performs a read-only, redacted assessment and separates remediation that needs approval.
```
