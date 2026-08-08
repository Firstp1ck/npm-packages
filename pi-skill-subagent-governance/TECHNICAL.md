# Technical reference: Subagent Governance

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Portable Agent Skill package for a parent orchestrator that is about to delegate work, replace a failed delegated run, or accept delegated results. It decides which delegation shapes are admissible and which evidence is required, without duplicating any harness's delegation mechanics or claiming runtime enforcement.

## Governance versus mechanics

This skill controls **admissibility**: whether delegation is allowed at all, how many children of which kinds may be declared, who may write, what a worker must be told, what a handoff must return, when a replacement launch is legal, and how a reviewer finding is dispositioned.

The harness's own delegation documentation controls **runtime mechanics**. In Pi, the installed `pi-subagents` skill remains canonical for tool schemas, actions, execution and context modes, authoring, configuration, and error handling. The two are complementary; this package neither restates nor overrides that skill.

## Install or enable

This package is intentionally **not installed or enabled automatically**. Creation, review, and packaging change no runtime configuration, no settings file, and no active prompt policy. Model-invoked guidance is also not a runtime guard: it does not block a tool call, and any existing enforcement in the host environment remains separate and authoritative. If a later explicit authorization approves installation, use the selected harness's package-install procedure. In Pi, that procedure is described in `skills/subagent-governance/references/PI-EXECUTION-ADAPTER.md`.
