# Technical reference: Design Patterns

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A Pi skill for tasks involving choosing patterns, designing traits/interfaces/components, deciding abstraction boundaries, evaluating dependency injection/callbacks, or comparing implementation approaches in Rust, TypeScript/React, or Django/Python.

## Install

```bash
pi install npm:@firstpick/pi-skill-design-patterns
```

## Storage and optional integrations

Pattern decisions may be appended to the host workspace’s `MEMORY.md`. Ask for report-only recommendations when you do not want persistent notes.

Architecture Review and Refactoring Advisor are optional companion skills referenced by the workflow; they are not bundled dependencies.

## Example view

```text
User: Compare a strategy object, callbacks, and dependency injection for this Rust boundary. Recommend the simplest fit and do not persist the decision.
Agent: Scores the alternatives against the stated constraints and returns a report-only recommendation.
```
