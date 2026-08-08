# Technical reference: Repo Explorer

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

A Pi skill for use before modifying unfamiliar codebases, answering where/how something is implemented, tracing dependencies, mapping repo structure, or planning changes. Explores a repository and returns a strict JSON handoff with key files, symbols, risks, and evidence.

## Install

```bash
pi install npm:@firstpick/pi-skill-repo-explorer
```

## Configuration

No required configuration.

## Native-first usage

`repo_explorer_explore` is the routine exploration path. Agents should invoke it directly with the compact defaults instead of issuing Bash calls to refresh/build the index or run the extraction/validation helper sequence. A valid native result should not be duplicated with broad shell searches.

If a validated handoff explicitly reports a blocking limitation, error, or omission, first narrow or expand another native call. For a still-missing precise fact, use the specialized non-shell `read`, `grep`, `find`, or `ls` tool directly. Bash is diagnostic-only when the native tool is unavailable or an invocation fails; it is not a routine or targeted-search fallback.

## Storage

Index/cache state is stored under `~/.pi/agent/state/repo-explorer` (or the configured Pi agent directory). Every native exploration also writes an effectiveness report in the installed `skills/repo-explorer/` directory. Old effectiveness reports can be deleted when they are no longer needed; the next exploration recreates current tracking output.

## Tools

- `repo_explorer_explore`: the routine native path to build/refresh a local repo index, extract a budget-aware goal-focused handoff, validate it, write an effectiveness report with omitted counts, improvement signals, downstream feedback placeholders, and limitations, then return compact model-visible results. Defaults to `budget: "compact"` and no evidence snippets.

## Example view

```text
User: Map how authentication works in this repository. Return the key files, symbols, dependencies, risks, and evidence without broad shell exploration.
Agent: Calls `repo_explorer_explore` with compact defaults and returns the validated handoff plus effectiveness-report path.
```
