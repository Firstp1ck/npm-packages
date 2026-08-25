# Development guide: Guided Git workflow for Pi

Contributor-only implementation, API, architecture, testing, and maintenance information.

[Back to README](README.md) · [Advanced user technical reference](TECHNICAL.md)

## Architecture

`index.ts` owns four Pi command registrations, surface routing, active nested-model lifecycle, session-shutdown cancellation, native TUI orchestration, WebUI activation, and user notifications.

`src/core.ts` owns shell-free bounded Git execution, repository preflight, status parsing, staged fingerprints and snapshots, commit-message validation, and commit/push plans.

`src/native-generation.ts` owns strict command argument parsing, staged/branch/PR generation contexts, base resolution, untrusted model requests, closed-output parsers, artifact naming, snapshot revalidation, and secure transactional writes.

The registered commands are:

```text
git-staged-msg
git-branch-name
pr
git-guided-workflow
```

The three generation handlers parse arguments before repository or model work, require an interactive TUI or RPC surface, require an idle session and active model, and share one active-generation slot. The existing guided TUI command retains its Stage → Message → Commit → Push state machine.

## Native model lifecycle

A generation handler captures one immutable context, builds the corresponding `NativeModelRequest`, and calls:

```text
ctx.modelRegistry.complete(ctx.model, request, { signal })
```

It concatenates text response parts only, rejects aborted/error responses, parses the exact closed output, then passes the parsed value and the original context to the matching write helper. It never calls `pi.sendUserMessage`, expands prompt templates, registers an LLM-callable helper tool, or asks an agent loop to inspect the repository.

Commit generation may make one additional direct completion only when `parseNativeCommitOutput` rejects the first response for unsafe content or invalid closed framing. `buildCommitCorrectionModelRequest` reuses the original immutable staged snapshot and the standalone prompt's staged-only language, scope, type, length, body, and format guidance as native instructions. It adds the bounded first response and validation code/message as untrusted JSON. A first response above the 32 KiB output cap or containing unsafe control or bidirectional characters is omitted rather than copied into the correction request. The corrected response passes through the same parser, with no third call. Quality deviations bypass correction and remain in the artifacts. Provider, cancellation, Git, context, and transaction failures also bypass correction. Branch and PR commands remain single-completion operations.

The command API returns `Promise<void>` and has no nested-completion usage return channel. Provider usage remains present on each model response, but Pi's current extension-command API exposes no supported accounting sink for attaching it to the parent session. Do not invent transcript entries or agent turns as an accounting workaround. The user receives a warning before the one correction call so its extra provider work is visible.

Each active native call has one `AbortController`. The completion is raced against its abort signal so session shutdown settles the command even when a provider ignores cancellation. The controller remains active through parsing and artifact transaction completion. A `finally` block aborts and clears ownership. A conflicting generation is refused before context acquisition.

The user receives a provider/privacy notice before context acquisition and a completion notification only after exact artifact verification. Bounded sanitized failures distinguish cancellation from error and never claim a write succeeded. In RPC mode, every command failure is also thrown through Pi's command response; returning normally after an error notification would make WebUI treat the command as successful and misreport an unchanged artifact. Only direct provider/model failures carry the stable fallback-eligibility marker.

## Generation contexts and output contracts

Commit generation binds canonical root, attached branch, HEAD, stable staged fingerprint, and the complete `--cached --binary` diff. Branch generation adds an optional validated pair of generated commit artifacts. PR generation binds current branch, HEAD, resolved base ref/OID, merge base, complete commit list and binary diff, plus an optional safe PR template.

Model-facing repository data is JSON-serialized inside named untrusted blocks. System instructions define language, commit quality guidance, closed delimiters, and safety constraints. Repository data never becomes trusted instructions or shell text.

Accepted closed response shapes are:

```text
<<<SHORT>>>
<subject>
<<<LONG>>>
<long commit message>
<<<END>>>
```

```text
<<<BRANCH>>>
<type>/<two-to-five-lowercase-kebab-words>
<<<END_BRANCH>>>
```

```text
<<<PR_BODY>>>
<reviewer-focused Markdown>
<<<END_PR_BODY>>>
```

Commit prompts intentionally ask for stricter quality than commit parsers enforce. Parsers keep only the closed framing, non-empty content, byte bounds, and unsafe-character checks as blockers. Branch and PR parsers retain their documented validation contracts.

## Artifact transaction contract

Canonical destinations are:

```text
dev/COMMIT/staged-commit-short.txt
dev/COMMIT/staged-commit-long.txt
dev/COMMIT/staged-branch-name.txt
dev/PR/<encodeURIComponent(current-branch)>.md
```

`index.ts` injects Pi's `withFileMutationQueue` into every write helper. Transactions verify canonical non-symlink parents and regular destinations, prepare private same-directory files with `wx`, preserve same-directory backups, install by rename, verify exact nonempty bytes, and revalidate the bound source state. Commit short/long writes roll back together. If rollback itself fails, recoverable backups are preserved and `ARTIFACT_ROLLBACK_FAILED` is returned.

## WebUI activation contract

The extension exports these canonical values:

```text
status key: git-guided-workflow:webui-start
payload type: firstpick.pi-extension-git-guided-workflow.start
payload version: 1
```

The exact JSON payload is:

```json
{
  "type": "firstpick.pi-extension-git-guided-workflow.start",
  "version": 1,
  "action": "start",
  "requestId": "<UUID-v4>"
}
```

Do not add tab ID, cwd, repository path, Git data, preferences, model data, or a success claim. The WebUI transport envelope owns the originating tab.

RPC activation calls `ctx.ui.setStatus` with the payload and immediately clears it. This is intentionally at-most-once. The browser requires RPC-capable extension provenance for all three native generation commands; a same-named prompt command is not a valid fallback. Browser-selected model and reasoning effort remain active while the extension command invokes `ctx.modelRegistry.complete`, after which the WebUI restores the prior profile and verifies the generation-correlated artifact.

The PR filename contract is encoded as one path segment. WebUI and extension code must both map `feat/native` to `dev/PR/feat%2Fnative.md`; do not independently reintroduce branch path separators.

## Native TUI state and safety

The TUI workflow state is ephemeral and command-owned:

```text
Stage → Message → Commit → Push → Finish
```

Action screens use Pi TUI's native `SelectList`; optional TUI message generation uses `BorderedLoader`; manual entry uses the native editor; mutations use native confirmation dialogs. Screens do not overlap.

Git commands are argv arrays, never shell strings. Normal hooks and signing remain enabled. Timeouts wait for the direct child close barrier; unconfirmed termination and ambiguous commit or push outcomes stop without automatic retry. Push uses an explicit immutable object-ID refspec and no force option.

## Source layout

- `index.ts` — four commands, direct completion integration, cancellation, TUI workflow, and WebUI activation
- `src/core.ts` — Git/state/message core
- `src/native-generation.ts` — native generation contexts, parsers, and artifact transactions
- `tests/core.test.mjs` — temporary-repository Git and commit/push coverage
- `tests/native-generation.test.mjs` — context, parser, drift, path, and rollback coverage
- `tests/tui.test.mjs` — command registration, direct model calls, RPC behavior, shutdown, TUI transitions, and documentation contract
- `tests/package.test.mjs` — manifest dependency, registration, allowlist, and bundle contract

## Validation

Run:

```bash
npm test
npm run check
/usr/bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --skipLibCheck index.ts src/core.ts src/native-generation.ts
npm pack --dry-run --json
```

Inspect the pack JSON and confirm that `src/native-generation.ts` is present while no nested prompt package or prompt directory is included. Tests use temporary repositories and local bare remotes only; they must not call a real provider or network service.

From the repository root, run the owned-file whitespace check without staging files:

```bash
git diff --check -- pi-extension-git-guided-workflow plans/handoffs/guided-git-native-generation-integration.md
```

## Package maintenance

The npm tarball includes the extension entry point, both source modules, user documentation, contributor guide, and license. Tests are intentionally excluded. The manifest registers only `./index.ts` as an extension resource. Keep generation native: do not add a prompt dependency, bundled dependency, `pi.prompts` registration, copied prompt Markdown, or reverse dependency.
