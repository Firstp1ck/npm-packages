# Technical reference: Feature Development Workflow

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Portable Agent Skill package for new feature implementation work. It helps an agent classify a requested feature as lightweight or complex, preserve blocking decision and completion gates, and use a proportionate workflow without treating model-invoked guidance as runtime enforcement.

## Install or enable

This package is not installed or enabled automatically. When installation is explicitly authorized, install the published package with:

```bash
pi install npm:@firstpick/pi-skill-feature-development-workflow
```

Creation, review, and packaging alone do not change runtime configuration. The skill has no npm runtime dependencies.
