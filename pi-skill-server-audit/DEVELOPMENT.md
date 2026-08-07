# Development guide: Server Audit

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Additional implementation details

- Adds the `server-audit` skill to Pi's skill library.
- Guides agents to invoke the skill for Linux server security reviews, SSH hardening, firewall/open-port audits, user/permission checks, exposed services, or host hardening requests. Produces severity-rated findings and practical remediation steps.
- Bundles `skills/server-audit/SKILL.md` plus any supporting references, scripts, tests, fixtures, or assets used by the skill.
