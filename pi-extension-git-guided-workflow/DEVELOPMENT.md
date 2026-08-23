# Development guide: Guided Git workflow for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Architecture

`index.ts` owns Pi command registration, native TUI orchestration, model calls, lifecycle cancellation, confirmations, and the short-lived screen loop. `src/core.ts` owns Git process execution, repository preflight, status parsing, staged fingerprints and snapshots, commit-message validation, and commit/push plans.

The extension registers exactly `git-guided-workflow`. Action screens use Pi TUI’s native `SelectList`; direct model generation uses `BorderedLoader`; message entry uses the native editor; mutations use native confirmation dialogs. A screen completes its `ctx.ui.custom()` promise before another screen, editor, loader, or confirmation opens.

## State and safety contracts

The command state is deliberately ephemeral and command-owned:

```text
Stage → Message → Commit → Push → Finish
```

The staged binding contains repository root, branch, pre-commit HEAD, and the package-domain staged fingerprint. Snapshot acquisition reads fingerprint A, the complete bounded diff, then fingerprint B. Commit planning repeats repository and fingerprint checks immediately before execution. Stage all separately repeats repository preflight after confirmation and refuses stale root, branch, operation, conflict, or material-count authorization before executing `git add --all --`.

Git commands are argv arrays and never shell strings. Ordinary hooks and signing are retained. On timeout or output overflow, the Git runner requests direct-child termination and waits for the child `close` barrier before settlement. A bounded secondary watchdog reports `GIT_TERMINATION_UNCONFIRMED`; commit orchestration treats that result as uncertain without reading HEAD or making retry available. This direct-child barrier does not claim descendant process-tree termination. Every confirmed-barrier commit outcome is followed by a HEAD read. Push planning requires the preserved created object ID to equal live HEAD and constructs an explicit `<created-oid>:refs/heads/<branch>` refspec without force options.

A session shutdown marks the command context stale, aborts the command-owned direct model request, and independently settles the generation custom screen even if a provider promise ignores abort. Components are not reused after their custom screen completes.

## Generation contract

The provider receives a system instruction declaring the diff untrusted and a user message containing the complete bounded staged diff. The response must use exactly:

```text
<<<SHORT>>>
<subject>
<<<LONG>>>
<same subject, optionally followed by a blank line and body>
<<<END>>>
```

The core parser is the authority for delimiters, supported Conventional Commit types, subject binding, length limits, and unsafe controls. Do not relax the prompt or parser independently.

## Source layout

- `index.ts` — Pi command and TUI workflow
- `src/core.ts` — dependency-free Git/state/message core
- `tests/core.test.mjs` — temporary-repository core and local bare-remote coverage
- `tests/tui.test.mjs` — stubbed Pi UI/model harness, workflow transitions, lifecycle, rendering, and package checks

## Validation

Run:

```bash
node --test tests/core.test.mjs
node --test tests/tui.test.mjs
npm test
npm run check
npm pack --dry-run --json
```

Tests must use temporary repositories and local bare remotes only. They must not call a real model provider or network service. Do not stage, commit, push, publish, install packages, or change Pi settings as part of repository validation.

Also run the repository documentation and whitespace check from the repository root:

```bash
git diff --check -- README.md pi-extension-git-guided-workflow
```

## Package maintenance

The npm tarball includes the extension entry point, pure core, user documentation, contributor guide, and license. Test files are intentionally excluded. The package has Pi API/TUI peer dependencies and no runtime dependency on the Git/PR prompt package.

Keep user-visible behavior in README and TECHNICAL. Keep schemas, source seams, algorithms, tests, and package maintenance details in this contributor guide.
