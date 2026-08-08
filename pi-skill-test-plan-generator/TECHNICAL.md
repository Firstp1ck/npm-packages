# Technical reference: Test Plan Generator

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A Pi skill for tasks involving planning tests from specs, architecture docs, PRs, risky changes, new features, bug fixes, or release work. Generates prioritized unit, integration, E2E, regression, and edge-case coverage.

## Install

```bash
pi install npm:@firstpick/pi-skill-test-plan-generator
```

## Configuration

No required configuration.

## Example view

```text
User: Build a prioritized test plan from this combined plan, specification, architecture document, and completion report. Include failures, edge cases, and regressions.
Agent: Maps source requirements to unit, integration, end-to-end, manual, and regression coverage.
```
