# Development guide: Code Security

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Additional implementation details

- Adds the `code-security` skill to Pi's skill library.
- Guides agents to invoke the skill for code security reviews, leaked secret checks, dependency risk, unsafe shell/Python/TypeScript/Rust patterns, auth/input-validation flaws, SAST-style audits, or supply-chain concerns in repositories.
- Bundles `skills/code-security/SKILL.md` plus any supporting references, scripts, tests, fixtures, or assets used by the skill.
