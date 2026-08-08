# Technical reference: Spec Vs Impl Checker

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A Pi skill for tasks involving a spec, plan, README, issue, or requirement must be verified against implementation. Traces requirements to code, checks interface contracts, and reports gaps or mismatches.

## Install

```bash
pi install npm:@firstpick/pi-skill-spec-vs-impl-checker
```

## Configuration

No required configuration.

## Example view

```text
User: Compare this authentication specification with the current implementation and tests. Trace each requirement and mark complete, partial, missing, or contradicted.
Agent: Builds a requirement registry with code/test evidence and reports every gap.
```
