# Technical reference: Prompts Code Workflows for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Reusable prompt templates for code review, debugging, issue planning, and incident triage in any repository.

## Install

```bash
pi install npm:@firstpick/pi-prompts-code-workflows
```

For local testing from this repository root:

```bash
pi install ./pi-package-prompts-code-workflows
```

## Configuration

No required configuration. After installation, type `/` in Pi to autocomplete the prompt templates.

`/recomended` uses the agent's latest relevant response as its source. Every argument is an exclusion and may be a recommendation number, label, or short description:

```text
/recomended 2 "skip the database migration"
```

Run it without arguments to implement all actionable recommendations. If the source recommendations or an exclusion are ambiguous, the prompt tells the agent to ask before making changes.

## Dependencies

No repository-local Pi extensions, tools, skills, or other prompt packages are required. This bundle only contributes prompt templates through `pi.prompts`.
