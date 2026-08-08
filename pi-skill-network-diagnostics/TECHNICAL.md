# Technical reference: Network Diagnostics

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A Pi skill for connectivity, DNS, Pi-hole, port reachability, routing, firewall reachability, TLS/network timeouts, or service access failures. Provides structured network troubleshooting commands and interpretation.

## Install

```bash
pi install npm:@firstpick/pi-skill-network-diagnostics
```

## Configuration

No required configuration.

## Example view

```text
User: Port 443 works locally but not from another host. Check DNS, routing, listeners, firewall reachability, and TLS using read-only commands first.
Agent: Proceeds layer by layer, reports the first failing boundary, and separates any corrective action that needs approval.
```
