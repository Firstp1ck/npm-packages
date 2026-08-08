# Code Quality

Review code for clarity and maintainability, prioritizing practical problems over style-only recommendations.

## Helpful when

- A change is difficult to review.
- A project has duplication, warnings, or overly complicated parts.
- You want practical cleanup priorities.

## What to share with Pi

- The files, branch, or change to review
- The project’s coding rules if it has any
- Areas that are especially difficult to maintain

## Try asking

> Review this change for clarity and maintainability. Focus on problems that could cause mistakes or make future work harder.

## What you’ll get

- The most useful improvements first
- Examples tied to specific files
- Suggested checks to keep the code healthy

## Keep in mind

Not every style preference is a quality problem. Ask for a read-only review when you do not want formatters or fixes to modify files; persistence to workspace memory should also be explicitly approved.

## Install

```bash
pi install npm:@firstpick/pi-skill-code-quality
```

Restart Pi if the skill does not appear in your current session.

## Technical details

See [TECHNICAL.md](https://github.com/Firstp1ck/pi-coding-agent-forge/blob/main/pi-skill-code-quality/TECHNICAL.md) for advanced usage, configuration, compatibility, and limitations.
