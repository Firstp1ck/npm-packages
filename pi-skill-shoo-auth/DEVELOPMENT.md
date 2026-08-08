# Development guide: Shoo Auth

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Test

```bash
npm test
```

## Additional implementation details

- Adds the `shoo-auth` skill to Pi's skill library.
- Guides agents through deterministic fit checks for Shoo versus other auth systems.
- Covers React (`@shoojs/react`), vanilla/framework-agnostic (`@shoojs/auth`), hosted `shoo.js`, Next.js callback routing, Convex custom JWT integration, session/revocation checks, and server-side `id_token` verification.
- Bundles `skills/shoo-auth/SKILL.md` and `skills/shoo-auth/references/shoo-docs-summary.md`.
