# Technical reference: Server Audit

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A Pi skill for Linux server security reviews, SSH hardening, firewall/open-port audits, user/permission checks, exposed services, or host hardening requests. Produces severity-rated findings and practical remediation steps.

## Install

```bash
pi install npm:@firstpick/pi-skill-server-audit
```

## Configuration

No required configuration.

## Example view

```text
User: Audit this Linux server’s SSH, users, listeners, firewall exposure, permissions, and update posture using read-only checks first.
Agent: Produces severity-rated findings and separates remediation that requires approval.
```
