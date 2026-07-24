# @firstpick/pi-extension-cd

Pi extension that adds `/cd` for changing the active Pi session working directory with ranked suggestions, persistent history, and aliases.

## Features

- `/cd` opens a picker with sane suggestions: aliases, previous directories, `..`, `~`, and child directories.
- `/cd <dir>` changes to a directory and preserves the conversation by forking the session into the target cwd.
- Successful directory changes are saved to `~/.pi/agent/state/cd-history.json` and ranked higher next time.
- `/cd --add <name> [dir]` creates aliases so `/cd <name>` jumps fast.
- Argument completions suggest aliases/history/directories while typing `/cd ...`.

## Commands

```text
/cd [dir|alias]
/cd
/cd --add <name> [dir]
/cd --remove <name>
/cd --list
/cd --status
/cd --clear-history
/cd-refresh
```

Examples:

```text
/cd ..
/cd ~/code/my-app
/cd --add npm /home/firstpick/pi-coding-agent-forge
/cd npm
/cd --remove npm
```

## Install / test locally

From this repository:

```bash
pi -e ./pi-extension-cd
```

Or install as a local Pi package:

```bash
pi install ./pi-extension-cd
```

## Configuration

- `PI_CD_HISTORY_STORE_PATH=/path/to/store.json` overrides the history/alias store.
- `PI_CODING_AGENT_DIR=/path/to/agent-dir` changes the default base directory used for the store.

## Notes

Pi binds cwd to sessions. This extension implements `/cd` by creating a target-cwd session and switching to it. When a persisted current session exists, the target session is forked from it so conversation context is preserved.
