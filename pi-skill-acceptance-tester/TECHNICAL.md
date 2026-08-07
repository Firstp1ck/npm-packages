# Technical reference: Acceptance Tester

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A Pi skill for use as the final gate before release, handoff, or claiming completion for substantial changes. Runs acceptance/readiness checks, determines pass/fail, and gives a go/no-go recommendation.

## Install

```bash
pi install npm:@firstpick/pi-skill-acceptance-tester
```

## Inputs and default gates

Provide the agreed definition of done, requirements, test evidence, and any release constraints. When no project-specific coverage target is supplied, the workflow uses an 80% fallback target.

The skill can consume results from specification, security, and implementation reviews, but those companion packages are not bundled. Equivalent user-supplied evidence is acceptable; missing required evidence remains visible and may produce a no-go result.

## Example view

```text
User: Check this release against the attached definition of done, test report, and security review. Give me a go/no-go verdict and list every missing gate.
Agent: Maps the evidence to the acceptance gates, preserves unknowns, and reports a go/no-go decision.
```
