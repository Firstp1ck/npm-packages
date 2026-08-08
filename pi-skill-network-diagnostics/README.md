# Network Diagnostics

Work out why a device or service cannot connect, one safe check at a time.

## Helpful when

- A website, server, or port cannot be reached.
- Names resolve incorrectly or not at all.
- A firewall, route, certificate, or local service may be involved.

## What to share with Pi

- What is trying to connect to what
- The error and when it started
- Relevant device, network, and service details

## Try asking

> This computer can find the server name but cannot connect to port 443. Diagnose it step by step and explain each result simply.

## What you’ll get

- A likely cause based on evidence
- Safe checks in a useful order
- Clear next steps and what each one proves

## Keep in mind

Diagnosis should begin with read-only checks. Changes to firewalls, routes, or services need your approval.

## Install

```bash
pi install npm:@firstpick/pi-skill-network-diagnostics
```

Restart Pi if the skill does not appear in your current session.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-skill-network-diagnostics/TECHNICAL.md) for advanced usage, configuration, compatibility, and limitations.
