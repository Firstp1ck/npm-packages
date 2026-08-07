# Technical reference: Code Quality

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A Pi skill for code reviews, linting/formatting setup, maintainability checks, complexity concerns, warning cleanup, coding standards, or quality gates in Rust, TypeScript, Python, shell, and mixed repos.

## Install

```bash
pi install npm:@firstpick/pi-skill-code-quality
```

## Toolchains and side effects

The workflow may use project linters, type checkers, formatters, and test commands for Rust, TypeScript, Python, shell, and mixed repositories. Availability and exact behavior depend on the project toolchain.

A read-only review should not run modifying formatters such as `cargo fmt` or apply fixes. Request and approve those actions separately. Review history may be written to the host workspace’s `MEMORY.md`; ask for report-only output when persistence is not wanted.

## Example view

```text
User: Review this TypeScript change for maintainability and complexity. Run read-only checks only; do not format files or persist the review.
Agent: Reports evidence-backed quality findings without modifying files or workspace memory.
```
