# Technical reference: Refactoring Advisor

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A Pi skill for refactors, code smells, migrations, duplication removal, module splitting, API cleanup, or restructuring plans. Emphasizes small safe steps, behavior preservation, and verification after each change.

## Install

```bash
pi install npm:@firstpick/pi-skill-refactoring-advisor
```

## Configuration

No required configuration.

## Example view

```text
User: Plan a behavior-preserving split of this oversized module into small reviewable steps with tests and rollback points.
Agent: Produces an incremental refactor sequence that keeps the project verifiable after each step.
```
