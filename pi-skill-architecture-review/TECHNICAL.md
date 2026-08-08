# Technical reference: Architecture Review

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A Pi skill for architecture reviews, module boundaries, dependency direction, coupling/cohesion, SOLID concerns, system design trade-offs, layering, service boundaries, or design decisions before implementation.

## Install

```bash
pi install npm:@firstpick/pi-skill-architecture-review
```

## Storage and optional integrations

Architecture decisions may be appended to the host workspace’s `MEMORY.md`. Ask for a report-only review when you do not want persistent notes.

The workflow can consult a sibling security workspace and flag security-related findings to another reviewer when those integrations exist. They are optional host integrations and are not bundled with this package.

## Example view

```text
User: Review this service split for dependency direction, ownership boundaries, and migration risk. Do not write to workspace memory.
Agent: Produces a report-only architecture review with evidence and explicit trade-offs.
```
