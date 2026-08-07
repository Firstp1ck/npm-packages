# Performance Optimizer

Find what is actually making software slow or resource-heavy before changing it.

## Helpful when

- An app, page, or task feels slow.
- CPU, memory, or cost is unexpectedly high.
- You need to compare possible improvements.

## What to share with Pi

- What feels slow and how it is measured
- The relevant code or system
- Typical workload and acceptable performance

## Try asking

> Find why this endpoint is slow under normal load. Start with measurements, identify the main cause, and compare the safest fixes.

## What you’ll get

- A measurement and profiling plan
- The most likely bottlenecks with evidence
- Fix options and expected trade-offs

## Keep in mind

Optimization without measurement often makes code harder without making it faster. Results should be checked with a repeatable test.

## Install

```bash
pi install npm:@firstpick/pi-skill-performance-optimizer
```

Restart Pi if the skill does not appear in your current session.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-skill-performance-optimizer/TECHNICAL.md) for advanced usage, configuration, compatibility, and limitations.
