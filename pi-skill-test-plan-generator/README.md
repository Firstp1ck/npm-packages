# Test Plan Generator

Turn a project plan and its supporting specification and architecture documents into a practical list of tests, ordered by risk and value.

## Helpful when

- A feature needs test coverage.
- A bug fix could cause regressions.
- You need to decide what to test manually and automatically.

## What to share with Pi

- The combined project plan (the primary source of truth)
- The original specification and architecture document
- The existing completion report, important user journeys, risks, platforms, and time limits

## Try asking

> Using this combined plan, specification, architecture document, and completion report, create a prioritized test plan. Include normal use, failures, edge cases, and regression checks.

## What you’ll get

- Tests grouped by type and priority
- Expected results and important test data
- Coverage gaps and suggested order

## Keep in mind

The plan describes what should be tested; it does not prove the tests were run or passed.

## Install

```bash
pi install npm:@firstpick/pi-skill-test-plan-generator
```

Restart Pi if the skill does not appear in your current session.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-skill-test-plan-generator/TECHNICAL.md) for advanced usage, configuration, compatibility, and limitations.
