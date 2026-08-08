# Server Audit

Review a Linux server for avoidable exposure and practical ways to make it safer.

## Helpful when

- You are preparing a new server.
- You want to check remote access and open services.
- The server has not had a security review recently.

## What to share with Pi

- The server’s purpose and who should access it
- Available configuration or command output
- Changes you are allowed to make

## Try asking

> Audit this server’s remote access, users, firewall, open ports, and exposed services. Show the most important risks first.

## What you’ll get

- A simple security overview
- Findings ordered by seriousness
- Practical fixes with verification steps

## Keep in mind

The audit should start read-only. Firewall, account, package, and service changes require explicit approval.

## Install

```bash
pi install npm:@firstpick/pi-skill-server-audit
```

Restart Pi if the skill does not appear in your current session.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-skill-server-audit/TECHNICAL.md) for advanced usage, configuration, compatibility, and limitations.
