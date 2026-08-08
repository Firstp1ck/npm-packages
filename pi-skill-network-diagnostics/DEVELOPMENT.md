# Development guide: Network Diagnostics

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Additional implementation details

- Adds the `network-diagnostics` skill to Pi's skill library.
- Guides agents to invoke the skill for connectivity, DNS, Pi-hole, port reachability, routing, firewall reachability, TLS/network timeouts, or service access failures. Provides structured network troubleshooting commands and interpretation.
- Bundles `skills/network-diagnostics/SKILL.md` plus any supporting references, scripts, tests, fixtures, or assets used by the skill.
