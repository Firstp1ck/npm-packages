# Development guide: Guided Git workflow for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Architecture

`index.ts` owns Pi command registration, surface routing, native TUI orchestration, model calls, lifecycle cancellation, confirmations, and the short-lived screen loop. `src/core.ts` owns Git process execution, repository preflight, status parsing, staged fingerprints and snapshots, commit-message validation, and commit/push plans.

The extension registers exactly `git-guided-workflow`. After argument and idle-state checks, TUI mode enters the native workflow. Compatible RPC mode emits only the WebUI activation contract below and returns. Other modes fail closed.

Action screens use Pi TUI's native `SelectList`; direct model generation uses `BorderedLoader`; message entry uses the native editor; mutations use native confirmation dialogs. A screen completes its `ctx.ui.custom()` promise before another screen, editor, loader, or confirmation opens.

## WebUI activation contract

The extension exports these canonical values from `index.ts`:

```text
status key: git-guided-workflow:webui-start
payload type: firstpick.pi-extension-git-guided-workflow.start
payload version: 1
```

The exact closed JSON payload contains four fields:

```json
{
  "type": "firstpick.pi-extension-git-guided-workflow.start",
  "version": 1,
  "action": "start",
  "requestId": "<UUID-v4>"
}
```

Do not add a tab ID, cwd, repository path, Git data, preferences, model data, or success claim. The WebUI transport envelope owns the authoritative originating tab. A payload change requires a new version and coordinated WebUI support.

RPC activation calls `ctx.ui.setStatus(WEBUI_START_STATUS_KEY, payload)` and then immediately calls `ctx.ui.setStatus(WEBUI_START_STATUS_KEY, undefined)`. WebUI consumes the live non-empty request before generic status storage, ignores replayed requests, and treats the clear as a no-op. This is intentionally at-most-once: a disconnect may miss activation, but a reconnect must not restart stale work.

`setStatus` is fire-and-forget, so the extension can truthfully report only that activation was requested. A failed initial set gets one best-effort clear and no retry. A failed clear produces a warning that the request may have been delivered and must not be retried automatically.

The common idle guard runs before either supported surface. Busy sessions or sessions with pending messages emit no activation and enter no native workflow. RPC activation must never run Git, call a model, open a TUI component, edit a message, confirm a mutation, commit, or push.

The browser workflow remains implemented by `@firstpick/pi-package-webui`. Generated browser commit, branch, and PR text is provided by the prompt-only `@firstpick/pi-prompts-git-pr` dependency. The dependency is bundled into this package and its `prompts` directory is included through the Pi manifest; do not copy those prompt files into the extension source.

## Native state and safety contracts

The TUI command state is deliberately ephemeral and command-owned:

```text
Stage → Message → Commit → Push → Finish
```

The staged binding contains repository root, branch, pre-commit HEAD, and the package-domain staged fingerprint. Snapshot acquisition reads fingerprint A, the complete bounded diff, then fingerprint B. Commit planning repeats repository and fingerprint checks immediately before execution. Stage all separately repeats repository preflight after confirmation and refuses stale root, branch, operation, conflict, or material-count authorization before executing `git add --all --`.

Git commands are argv arrays and never shell strings. Ordinary hooks and signing are retained. On timeout or output overflow, the Git runner requests direct-child termination and waits for the child `close` barrier before settlement. A bounded secondary watchdog reports `GIT_TERMINATION_UNCONFIRMED`; commit orchestration treats that result as uncertain without reading HEAD or making retry available. This direct-child barrier does not claim descendant process-tree termination. Every confirmed-barrier commit outcome is followed by a HEAD read. Push planning requires the preserved created object ID to equal live HEAD and constructs an explicit `<created-oid>:refs/heads/<branch>` refspec without force options.

A session shutdown marks the TUI command context stale, aborts the command-owned direct model request, and independently settles the generation custom screen even if a provider promise ignores abort. Components are not reused after their custom screen completes.

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

- `index.ts` — Pi command, surface routing, WebUI activation constants, and native TUI workflow
- `src/core.ts` — dependency-free Git/state/message core
- `tests/core.test.mjs` — temporary-repository core and local bare-remote coverage
- `tests/tui.test.mjs` — stubbed Pi UI/model/status harness, workflow transitions, RPC activation, lifecycle, rendering, and package checks

## Validation

Run:

```bash
node --test tests/core.test.mjs
node --test tests/tui.test.mjs
npm test
npm run check
/usr/bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --skipLibCheck index.ts src/core.ts
npm pack --dry-run --json
```

Tests must use temporary repositories and local bare remotes only. They must not call a real model provider or network service. RPC tests must assert the exact status set/clear order and prove there are no Git, model, editor, confirmation, or custom-component side effects. Do not stage, commit, push, publish, install packages, or change Pi settings as part of repository validation.

Also run the repository documentation and whitespace check from the repository root:

```bash
git diff --check -- pi-extension-git-guided-workflow
```

## Package maintenance

The npm tarball includes the extension entry point, pure core, user documentation, contributor guide, license, and bundled `@firstpick/pi-prompts-git-pr` dependency. Test files are intentionally excluded. Keep the prompt package in `dependencies` and `bundledDependencies`, and keep its `node_modules/@firstpick/pi-prompts-git-pr/prompts` path in the Pi manifest so one extension install both installs and registers the prompt resources.

Keep user-visible behavior in README and TECHNICAL. Keep schemas, transport lifecycle, source seams, algorithms, tests, and package maintenance details in this contributor guide.
