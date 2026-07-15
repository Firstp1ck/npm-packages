# pi-extension-safety-guard

Interactive safety prompts for high-risk operations in Pi.

![Safety guard confirmation prompt](https://unpkg.com/@firstpick/pi-extension-safety-guard/images/safety_guard_v0.1.9.png)

## What it does

- Intercepts risky `bash` commands and requires confirmation.
- Intercepts `write`/`edit` on protected paths and requires confirmation.
- In non-interactive mode, blocks risky operations with explicit reasons.
- Has persistent setup through `/safety-guard-setup`, including per-category toggles and independent preview lines before/after matches.
- Can be toggled globally with `/safety-guard on|off|status`.
- Supports exact allow entries for the current session or permanently per cwd.

## Guarded command categories

### Git destruction / history rewriting

Examples:

- `git reset --hard`
- `git reset --soft`, `git reset --mixed`, `git reset --merge`, `git reset --keep`
- `git reset HEAD~...`, `git reset HEAD^...`, `git reset <commit>`
- `git clean -f`, including `git clean -fd` / `git clean -xdf`
- `git checkout -- <path>`, `git switch ...`, and `git restore ...`
- `git branch -d/-D`, `git tag -d`
- `git push --force`, `git push --force-with-lease`
- `git push --delete`, `git push :refs/heads/...`
- `git rebase`, including interactive rebases
- `git commit --amend`, `git commit --fixup`, `git commit --squash`
- `git filter-branch`, `git filter-repo`
- `git replace`, `git update-ref`
- `git notes remove`, `git notes prune`
- `git reflog expire`, `git gc --prune`, `git prune`

### Filesystem deletion / overwrite

Examples:

- recursive or force `rm`
- `rm` targeting `/`, `~`, `$HOME`, `.`, or globs
- `find ... -delete`
- `find ... -exec rm ...`
- `xargs ... rm`
- `truncate -s 0`
- `shred`
- `dd`
- `mkfs`, `wipefs`, `parted`, `fdisk`, `sfdisk`, `sgdisk`

### Docker / Podman destruction

Examples:

- `docker rm`, `docker rmi`
- `docker volume rm`, `docker volume prune`
- `docker system prune`
- `docker compose down -v` / `--volumes`
- `docker-compose down -v` / `--volumes`
- `podman rm`, `podman rmi`, `podman system prune`

### Package removal

Examples:

- `npm uninstall/remove/rm/prune`
- `pnpm remove/prune`
- `yarn remove/autoclean`
- `bun remove`
- `pip uninstall`, `uv remove`, `cargo remove`
- `pacman -R`, `paru -R`, `yay -R`
- `apt remove/purge/autoremove`, `dnf remove`

### System state / permissions

Examples:

- `sudo`
- `shutdown`, `reboot`, `poweroff`
- `systemctl stop/disable/mask/restart`
- `killall`, `pkill`, `kill -9`
- `mount`, `umount`, `swapon`, `swapoff`
- recursive `chmod` / `chown`
- `chmod 777`
- `setfacl`
- common fork-bomb signature

### Dangerous SQL

Examples:

- `DROP DATABASE`, `DROP SCHEMA`
- `DROP TABLE`, `DROP INDEX`
- `TRUNCATE` / `TRUNCATE TABLE`
- `DELETE FROM ...` without `WHERE`
- `UPDATE ... SET ...` without `WHERE`
- `ALTER TABLE ... DROP COLUMN/CONSTRAINT`

SQL rules are matched against the full bash command, including heredoc bodies, so database client calls like `psql <<SQL ... SQL` can still be guarded.

### Secret file access

Examples of commands that may reveal or copy secrets are prompted when targeting sensitive files:

- `cat`, `grep`, `rg`, `awk`, `sed`, `cp`
- `.env`, `.env.*`, `.git-credentials`, `auth.json`
- `id_rsa`, `id_ed25519`
- `.npmrc`, `.pypirc`, `.netrc`
- `.aws/credentials`, `.aws/config`, `.kube/config`
- `.config/gh/hosts.yml`, `.config/gcloud/...`
- `*.pem`, `*.key`, `*.p12`, `*.kdbx`

## Protected paths

`write` and `edit` prompts are triggered for sensitive paths including:

- `.ssh/`
- `.git-credentials`
- `auth.json`
- `id_rsa`, `id_ed25519`, and matching `.pub` files
- `.env`, `.env.*`, `.envrc`
- `.npmrc`, `.pypirc`, `.netrc`
- `.kube/config`
- `.aws/credentials`, `.aws/config`
- `.config/gh/hosts.yml`
- `.config/gcloud/`
- `*.pem`, `*.key`, `*.p12`, `*.kdbx`

## Install

```bash
pi install npm:@firstpick/pi-extension-safety-guard
```

## Configuration

No configuration is required. Run `/safety-guard-setup` to edit all persistent guard settings:

- master enabled state
- Git, filesystem, Docker/Podman, package, system, database, and secret-access command categories
- protected-path `write` and `edit` guards
- command-preview lines before and after each matched line (`0`-`20`, default `3` each)

Settings are stored globally in:

```text
~/.pi/agent/safety-guard.json
```

Set `PI_SAFETY_GUARD_CONFIG_FILE` to override that path. Invalid configuration fails safe: every guard is enabled with default context limits.

Permanent allows are stored separately in:

```text
~/.pi/agent/safety-guard-allow.json
```

Allow entries are exact matches scoped to the current working directory:

- bash: exact command string + cwd
- write/edit: resolved protected path + cwd

When a guard prompt appears, choose one of:

- `Block`
- `Allow once`
- `Allow for this session`
- `Always allow in this cwd`

## Commands

```text
/safety-guard-setup
/safety-guard status
/safety-guard on
/safety-guard off
/safety-guard allow-list
/safety-guard allow-clear-session
/safety-guard allow-clear-permanent
```

`/safety-guard-setup` opens a settings list in Pi's TUI. In Pi Web UI it opens a browser-native setup dialog with the same persisted settings.

When disabled, the status bar shows `🔓!`. The `on` and `off` commands update the global setup file.

`allow-list` shows both session and permanent entries. `allow-clear-session` clears only the in-memory list. `allow-clear-permanent` empties the persisted allow file.

## Tools

None.

## Example view

```text
!git reset --hard
Safety guard: high-risk git command detected
Allow this command?  No / Yes

edit .env
Safety guard: protected path detected (.env)
Allow edit?  No / Yes
```

The guard adds a pause before risky shell commands or sensitive file edits, while still letting you proceed intentionally.
