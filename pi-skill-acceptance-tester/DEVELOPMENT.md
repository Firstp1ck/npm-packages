# Development guide: Acceptance Tester

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Additional implementation details

- Adds the `acceptance-tester` skill to Pi's skill library.
- Guides agents to invoke the skill as the final gate before release, handoff, or claiming completion for substantial changes. Runs acceptance/readiness checks, determines pass/fail, and gives a go/no-go recommendation.
- Bundles `skills/acceptance-tester/SKILL.md` plus any supporting references, scripts, tests, fixtures, or assets used by the skill.
