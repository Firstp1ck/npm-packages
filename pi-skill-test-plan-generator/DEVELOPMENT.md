# Development guide: Test Plan Generator

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Additional implementation details

- Adds the `test-plan-generator` skill to Pi's skill library.
- Guides agents to invoke the skill when planning tests from specs, architecture docs, PRs, risky changes, new features, bug fixes, or release work. Generates prioritized unit, integration, E2E, regression, and edge-case coverage.
- Bundles `skills/test-plan-generator/SKILL.md` plus any supporting references, scripts, tests, fixtures, or assets used by the skill.
