# Technical reference: Shoo Auth

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A Pi skill for evaluating, implementing, reviewing, and debugging Shoo auth (`shoo.dev`) Google sign-in in browser apps.

## Install

```bash
pi install npm:@firstpick/pi-skill-shoo-auth
```

## Configuration

No required Pi configuration.

Shoo implementation tasks may require project-specific app origins, callback paths, and a server runtime that can verify JWTs against Shoo's JWKS endpoint.

## Example view

```text
User: Add Shoo sign-in to this React app and verify tokens server-side.
Agent: Invokes the `shoo-auth` skill, chooses the React path, adds callback handling, and enforces server-side JWT verification.
```
