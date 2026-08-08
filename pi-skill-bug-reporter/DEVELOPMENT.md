# Development guide: Bug Reporter

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Additional implementation details

- Adds the `bug-reporter` skill to Pi's skill library.
- Guides agents to invoke the skill when defects, regressions, failed tests, unexpected behavior, or spec mismatches are found. Produces structured reproducible bug reports with severity, evidence, environment, and actionable next steps.
- Bundles `skills/bug-reporter/SKILL.md` plus any supporting references, scripts, tests, fixtures, or assets used by the skill.
