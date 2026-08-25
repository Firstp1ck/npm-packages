# Guided Git workflow: technical reference

Advanced user guidance for native generation, the Pi TUI workflow, WebUI activation, safety checks, limits, and recovery.

[Back to README](README.md) · [Contributor guide](DEVELOPMENT.md)

## Requirements

- Pi with extension support
- Node.js 22.19 or newer
- Git available on `PATH`
- A normal, non-bare Git worktree on an attached branch
- An active model for generation commands
- A compatible WebUI RPC session for browser activation

One extension provides the workflow launcher and all three generation commands. No additional prompt package is required.

## Commands

```text
/git-guided-workflow
/git-staged-msg [en|de] [auto|never|required]
/git-branch-name
/pr [en|de]
```

Unknown or extra arguments are rejected before repository data is read or a model is called. Generation commands require an idle Pi session with no queued messages and support Pi's interactive TUI and compatible RPC sessions.

`/git-staged-msg` defaults to English with automatic scope selection. It writes:

- `dev/COMMIT/staged-commit-short.txt`
- `dev/COMMIT/staged-commit-long.txt`

`/git-branch-name` accepts no arguments and writes `dev/COMMIT/staged-branch-name.txt`.

`/pr` defaults to English and writes one file under `dev/PR/`. The current branch is encoded as a single safe filename, so `feat/example` becomes `dev/PR/feat%2Fexample.md`.

The commands generate files only. They do not stage, commit, create or switch branches, push, or run GitHub CLI.

## Native generation and privacy

Each generation command calls the active Pi model directly. It does not expand a slash-prompt template, send a parent-agent message, or enter an agent tool loop. The command shows the active provider and model before sending data.

Only the complete bounded context needed for the artifact is sent:

- commit and branch generation send the complete staged diff;
- branch generation may also send the validated generated commit files when both exist; and
- PR generation sends the current branch/base identities, complete bounded commit list and diff, and an optional `.github/PULL_REQUEST_TEMPLATE.md`.

Git content, filenames, commit text, and templates are marked as untrusted data. They can still contain private information. Do not invoke generation unless sharing that context with the active model provider is acceptable.

Commit and branch input is all-or-nothing: the complete staged diff must be valid UTF-8 and at most 1 MiB. PR commit, diff, and template context has a combined 1 MiB cap; the optional template also has a 128 KiB cap. Oversized or invalid UTF-8 input is refused rather than truncated.

`/git-staged-msg` makes one direct model request normally. If that response fails closed-format parsing or a safety check, it makes exactly one correction request to the same model with the same staged snapshot, the validation feedback, and the failed response when it is safe and fits the 32 KiB correction bound. Oversized output and output containing unsafe control or bidirectional characters are omitted from the correction request. A second unsafe or structurally invalid response is terminal. Quality deviations do not start correction. Provider failures, cancellation, Git failures, source drift, and artifact-write failures do not start correction. Branch and PR generation do not use correction requests.

Only one native generation command can be active at a time, including its correction request. Session shutdown aborts the nested model request, including settling the command when a provider does not cooperate with cancellation. An aborted or failed command writes no new artifact and reports no stale success.

## Generated output guidance and checks

The commit model is asked to:

- use one of `build`, `change`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, or `test`;
- follow Conventional Commit syntax;
- satisfy the requested scope policy;
- keep the subject within 72 Unicode characters; and
- begin the long message with the short subject and use typed body bullets.

These are quality guidelines. A deviation does not discard the generated message or start correction. Commit output is rejected only when the closed response cannot be parsed, a subject or body is empty, an artifact exceeds its byte limit, or the content contains unsafe control or bidirectional characters.

Generated branch names use an allowed type, `/`, and two to five lowercase kebab-case words. Traversal and invalid Git-ref forms are rejected.

Generated PR descriptions must be bounded Markdown with no unresolved common template placeholders, unsafe controls, empty sections, or unsupported claims that tests or checks ran. No execution evidence is supplied to `/pr`, so the description must use neutral verification wording.

All model responses use closed delimiters and are parsed before filesystem mutation. The first unsafe or structurally invalid commit response can enter the single correction path described above; every other unsafe or structurally invalid output is rejected.

## Artifact and snapshot safety

Commit and branch generation bind the canonical repository root, attached branch, HEAD, and stable staged fingerprint. PR generation binds the root, current branch, HEAD, resolved base, merge base, commit range, complete diff, and optional template. Source state is checked again around the write; drift restores the previous artifact where possible.

Artifact directories and destinations must remain inside the canonical repository root and may not be symlinks. Writes use private same-directory temporary files and backups through Pi's file-mutation queue. The two commit files are replaced as one coordinated transaction and roll back together on failure.

PR base resolution uses the first valid source in this order:

1. a distinct configured upstream base;
2. one unambiguous remote symbolic default;
3. local `main`;
4. local `master`.

The command does not invent a base. Detached HEAD, missing or ambiguous bases, unrelated histories, an empty range, or branch/base drift are rejected.

## Guided workflow surfaces

`/git-guided-workflow` accepts no options and refuses to start while Pi is busy or messages are queued.

In Pi's native TUI, its stages are:

```text
Stage → Message → Commit → Push
```

Press Escape to cancel the current action list. Choose **Finish** to stop without continuing. Stage all and every commit or push mutation require explicit confirmation. The workflow rejects conflicts, detached HEAD, bare repositories, and active merge, rebase, cherry-pick, revert, or bisect operations.

Manual message entry uses Pi's native editor and needs no model. Optional TUI generation sends the complete stable staged diff only after you select generation. The workflow rechecks root, branch, HEAD, operation state, and staged content before commit.

Push is available only while HEAD still equals the commit created by the workflow. The exact remote, branch, and immutable object-ID refspec are shown before confirmation. Force options are never used and uncertain push outcomes are never retried automatically.

In a compatible WebUI RPC session, `/git-guided-workflow` emits a one-shot activation request for the originating tab. The activation runs no Git command, calls no model, and includes no repository path or Git data. Browser generation requires the three RPC-capable extension commands from this package; same-named prompt templates are not accepted as the native generation path. The WebUI temporarily selects its configured generation model and effort, invokes the native command, verifies the correlated artifact, and restores the prior profile.

## Troubleshooting

### The browser workflow does not open

Confirm that the originating tab is idle, has no queued messages, and lists `/git-guided-workflow`, `/git-staged-msg`, `/git-branch-name`, and `/pr` as extension commands. Restart Pi and refresh WebUI after installing or updating the extension. A disconnected browser can miss the one-shot activation; it is not replayed automatically.

### Generation is unavailable

Select an active model and confirm that the session is idle. For commit or branch generation, stage at least one change. If input exceeds its complete-input cap or is not UTF-8, reduce the input or write the artifact manually.

### PR generation cannot find a base

Configure a distinct upstream base, fetch a remote symbolic default, or keep an existing local `main` or `master` branch. The command deliberately refuses ambiguous and unrelated histories.

### An artifact was not updated

Read the exact failure notification. Check for staged, HEAD, branch, base, or template drift; unsafe symlinks under `dev/`; invalid model output; or cancellation. Prior valid artifacts remain in place when rollback succeeds.

### A commit or push result is uncertain

Do not repeat the operation blindly. Inspect local HEAD and the remote branch with your normal Git tools. The extension deliberately avoids pull, fetch, merge, rebase, reset, amend, stash, and force-push recovery actions.

## Removal and recovery

Remove the extension with:

```bash
pi remove npm:@firstpick/pi-extension-git-guided-workflow
```

Restart Pi and refresh connected WebUI tabs afterward. Removing the extension does not delete generated files or undo commits and pushes.
