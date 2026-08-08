# Technical reference: Grill Me for Pi

Advanced user setup, configuration, compatibility, security, and troubleshooting information.

[Back to the human-friendly README](README.md) · [Contributor and implementation guide](DEVELOPMENT.md)

Deterministic `/grill-me` design interview workflow for Pi.

## What it does

- Adds `/grill-me [plan]` to start a rigorous design interview.
- Forces progress through structured tools instead of relying only on prompt text.
- Records each question, recommended answer, user answer, status, and notes.
- Persists session state in the active project at `.pi/grill-me/state.json`.
- Saves final results to Markdown inside the project directory.
- Refuses to write result files outside the current project directory.

## Install

```bash
pi install npm:@firstpick/pi-extension-grill-me
```

## Configuration

No required configuration.

## Commands

- `/grill-me [plan]` — initialize a grill session for the current project and start the interview.
  - If no plan is supplied, the agent asks you to paste or describe the plan first.

## Tools

- `grill_record_turn`
  - Records exactly one interview question at a time.
  - Captures the assistant recommendation, user answer, decision status, and notes.
  - Requires a non-empty `userAnswer` before a turn can be marked `resolved`; unresolved and codebase-check turns may omit it.
- `grill_save_results`
  - Writes the active interview state to Markdown.
  - Defaults to `GRILL-ME.md` in the project root.
  - Accepts a project-relative `path` override.

## Output files

```text
.pi/grill-me/state.json   # structured session state
GRILL-ME.md               # default rendered result file
```

## Example

```text
/grill-me Build a new plugin system for the app
```

Pi will ask one question at a time, provide a recommended answer, explore the codebase when possible, and save results when the interview is complete or when asked to stop/save.
