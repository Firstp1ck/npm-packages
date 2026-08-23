# Guided Git workflow: technical reference

Advanced user guidance for the Pi TUI workflow, WebUI activation, safety checks, limits, and recovery.

[Back to README](README.md) · [Contributor guide](DEVELOPMENT.md)

## Requirements

- Pi with extension support
- Node.js 22.19 or newer
- Git available on `PATH` for the native workflow
- A normal, non-bare Git worktree on an attached branch for native Git actions
- A compatible WebUI RPC session for browser activation

The WebUI's generated commit, branch, and pull-request text continues to require `@firstpick/pi-prompts-git-pr`. This extension does not copy or replace that prompt package.

## Command and surfaces

```text
/git-guided-workflow
```

The command accepts no options and refuses to start while Pi is busy or while messages are queued.

In Pi's native TUI, its stages are always:

```text
Stage → Message → Commit → Push
```

Press Escape to cancel the current action list. Choose **Finish** to leave the workflow at a defined stopping point.

In a compatible WebUI RPC session, the command requests the existing browser Guided Git workflow for the originating tab. The activation itself runs no Git command, opens no native editor or confirmation, calls no model, and sends no repository path, staged diff, preferences, or Git state. The request is transient and is not an acknowledgement that the browser opened successfully. If delivery is uncertain, the extension does not retry automatically.

JSON, print, RPC sessions without compatible UI support, and other non-interactive modes remain unsupported. They perform no Git action and request no WebUI workflow.

## Stage behavior

The native Stage screen reports staged, unstaged, untracked, and conflicted counts. You can:

- preserve the current staged set; or
- confirm **Stage all changes**, which includes tracked changes, deletions, and untracked files.

Before staging and committing, the workflow rejects:

- a non-repository or bare repository;
- detached HEAD;
- unresolved conflicts; and
- merge, rebase, cherry-pick, revert, or bisect operations in progress.

Immediately after Stage all confirmation, the workflow repeats repository preflight before running `git add --all --`. If the repository root or branch changed, an operation or conflict appeared, or the material status counts changed, stale authorization is not used. Count changes return you to Stage for a fresh summary and confirmation.

The staged snapshot includes the complete staged diff and is bound to stable index evidence. If the staged state changes while it is read or before commit, the workflow returns to Stage rather than committing the old selection.

## Message behavior and privacy

Manual entry uses Pi's native editor and works with no active model.

Generation is optional. Only selecting **Generate short and long candidates** sends the complete staged diff to the active model provider. No staged content is sent merely by opening the workflow or choosing manual entry. Direct generation does not claim the same usage accounting or reasoning-effort behavior as a normal agent turn.

Generation is all-or-nothing. The complete staged diff must be valid UTF-8 and at most 1 MiB. Larger or non-UTF-8 diffs are not partially sent; use a manual message instead.

Generated subjects must:

- use one of `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, or `test`;
- follow Conventional Commit syntax; and
- be no longer than 72 characters.

The long candidate begins with the exact short subject. Manual subjects also have a 72-character limit, but do not have to use Conventional Commit syntax. A manual body must follow a blank line. Complete commit messages are limited to 16 KiB and cannot contain terminal escapes, unsafe control characters, or bidirectional formatting/isolate controls.

## Commit behavior

The native Commit screen shows the exact selected message and staged summary. Confirmation is required before Git runs.

The workflow rechecks repository root, branch, HEAD, operation state, and staged binding immediately before commit. Normal Git hooks and signing are enabled. Git cannot make the final staged comparison and commit atomic, and hooks may modify files or the index after that comparison.

HEAD is inspected after every commit command result, including errors and timeouts, only after the direct Git child reaches its terminal/close barrier. If direct-child termination cannot be confirmed within the bounded shutdown wait, the result is uncertain and retry is unavailable. This is not a guarantee that Git hook descendants or other descendant processes were terminated. If HEAD advanced after a confirmed barrier, the created object ID is preserved and the commit is not retried. If the result cannot be classified safely, the workflow stops and asks you to inspect the repository externally.

## Push behavior

Native push is available only while HEAD still equals the commit created by the current workflow. The destination is selected from:

1. a matching configured upstream;
2. the only configured remote; or
3. a remote you select explicitly when several exist.

A mismatched upstream is blocked. The workflow shows the exact remote, branch, and immutable object-ID-to-branch refspec (`<created-oid>:refs/heads/<branch>`) before confirmation, then executes that exact refspec. It never uses force options.

A push timeout, connection loss, or other failed push can leave the remote result uncertain. The workflow never retries automatically. Verify the remote state outside the workflow before deciding what to do next.

## Troubleshooting

### The browser workflow does not open

Confirm that the WebUI supports extension status requests, the command is loaded in the originating tab, and Pi is idle with no queued messages. Restart Pi and refresh the WebUI after installing or updating the extension. A browser disconnect can miss the one-shot request; the extension intentionally does not replay it later.

If browser generation controls report missing commands, install or update `@firstpick/pi-prompts-git-pr`. That package remains separate from the workflow launcher.

### The command says the repository is unsupported

Finish any merge, rebase, cherry-pick, revert, or bisect operation, resolve conflicts, and attach HEAD to a branch. Bare repositories are not supported.

### Generation is unavailable

Select an active model if you want native generation. Otherwise choose manual entry. If the diff exceeds 1 MiB or is not UTF-8, manual entry remains available.

### Push is unavailable

Check that a remote exists, the configured upstream matches the current branch, and HEAD still points to the commit created by this workflow. Complex or mismatched refspec setups must be handled with normal Git commands outside this extension.

### A commit or push result is uncertain

Do not repeat the operation blindly. Inspect local HEAD and the relevant remote branch with your normal Git tools. The extension deliberately avoids pull, fetch, merge, rebase, reset, amend, stash, and force-push recovery actions.

## Removal and recovery

Remove the extension with:

```bash
pi remove npm:@firstpick/pi-extension-git-guided-workflow
```

Restart Pi and refresh connected WebUI tabs afterward. Removing the extension does not undo local commits or remote pushes. Use repository-appropriate Git recovery for history already created or published.
