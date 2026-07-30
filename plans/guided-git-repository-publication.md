# Guided Git Repository Publication Plan

**Status:** Complete with documented package-wide validation caveats  
**Feature classification:** Complex  
**Integration owner:** Main Pi agent  
**Package:** `pi-package-webui`  
**Final report:** [`../reports/guided-git-repository-publication.html`](../reports/guided-git-repository-publication.html)

## Classification rationale

The preliminary `complex` classification is confirmed by repository evidence. The feature crosses the browser workflow state/UI (`public/app.js`), the POST/access-guarded server command API (`bin/pi-webui.mjs`), external GitHub CLI side effects, Git error classification, and both static and endpoint tests. It has separate backend and frontend/test slices plus material safety requirements around explicit visibility and final confirmation.

## Goal and measurable success criteria

When Guided Git runs `git push` in a repository with no configured destination, it offers an opt-in GitHub publication flow instead of ending with the raw fatal error.

Success requires:

1. A remote-less push is classified as `NO_REMOTE` with an actionable hint.
2. Guided Git asks whether the user wants to publish; declining performs no publication action.
3. The repository-name input defaults to the Git-root directory name and remains editable and validated.
4. The user must explicitly choose `public` or `private`; there is no visibility default.
5. A final confirmation summarizes repository name, visibility, branch, and resulting remote before any external mutation.
6. The server independently requires `confirmed: true` and validates all inputs.
7. Confirmed publication uses authenticated GitHub CLI credentials, creates the GitHub repository, configures `origin`, pushes the current branch, and sets upstream tracking.
8. Missing/unauthed `gh`, name conflicts, and command failures return useful process output without silent force-push or implicit visibility.
9. Existing Guided Git, init-repo, PR, and footer-sync behavior remains compatible.
10. Package syntax/tests pass and independent reviewers find no unresolved critical/high-severity issue.

## Scope

- Detect Git's no-push-destination failure.
- Add one guarded publication API operation.
- Add Guided Git publication prompts/dialog flow for standard push.
- Add backend, endpoint, and static UI tests.
- Document behavior, evidence, and residual risks in the final report.

## Non-goals

- Publishing to hosts other than GitHub.
- Managing GitHub tokens or running interactive authentication.
- Force-pushing, renaming the current branch, or changing an existing/misconfigured remote.
- Automatically publishing from Footer Sync, init-repo, or PR flows unless they explicitly reuse the new helper in a future change.
- Editing GitHub repository settings after creation.

## Approved decisions and invariants

- **Trigger:** classify `fatal: No configured push destination.` as `NO_REMOTE`. Do not reinterpret repositories that already have an invalid remote as remote-less.
- **Entry point:** the new guided recovery is attached to `pushGitWorkflow()`; other push surfaces keep their existing behavior.
- **Publication mechanism:** invoke non-interactive `gh repo create <name> --public|--private --source <root> --remote origin --push` through the existing single-flight `runGitHubWorkflowCommand()` runner. GitHub owner is the authenticated `gh` account.
- **Repository name:** default from the Git root basename; validate with the existing GitHub repository-name rules on client and server.
- **Visibility:** required explicit `public`/`private` selection with no preselected value.
- **Confirmation:** client shows a final summary; server rejects requests unless `body.confirmed === true`.
- **Branch:** publish the current branch without renaming it.
- **Safety:** register the endpoint in `GIT_WORKFLOW_MUTATING_PATHS`; preserve POST/access guards, `GH_PROMPT_DISABLED=1`, command timeout/cancel behavior, output bounds, and global single-flight execution.
- **Failure behavior:** never force-push. Surface gh stdout/stderr and actionable hints. A partially created GitHub repository may require manual recovery; do not mask this possibility.
- **Compatibility:** preserve the existing process-result envelope (`command`, `stdout`, `stderr`, exit/signal/timeout/cancel metadata).

## Execution DAG / waves

```text
Discovery + decisions
        |
        v
Plan (integration owner)
        |
        v
Wave 1: WS1 backend/API/tests
        |
        v
Wave 2: WS2 frontend UX/static tests
        |
        v
Integration owner inspection + combined checks
        |
        v
Two-provider independent review quorum
        |
        v
Accepted fixes + regression checks
        |
        v
Final HTML report
```

## Workstreams and ownership

### WS1 — Backend classification, publication API, endpoint tests

**Worker boundary**

- May edit:
  - `pi-package-webui/bin/pi-webui.mjs`
  - backend-focused tests, preferably a dedicated new `pi-package-webui/tests/*publication*.test.mjs` and/or bounded additions to `tests/http-endpoints-harness.test.mjs`
- Must not edit:
  - `pi-package-webui/public/app.js`
  - `pi-package-webui/public/index.html`
  - `pi-package-webui/public/styles.css`
  - this plan or the final report

**Deliverables**

- `NO_REMOTE` classification.
- POST-only `/api/git-workflow/publish` with validation, server confirmation, current-branch metadata, and gh command execution.
- Deterministic tests that do not contact GitHub (source/static assertions or a fake `gh` executable where practical).
- Handoff artifact: `.pi-subagents/artifacts/guided-git-publication/ws1-backend.md`.

### WS2 — Guided Git publication UX and static tests

**Prerequisite:** WS1 API contract is present and inspectable.

**Worker boundary**

- May edit:
  - `pi-package-webui/public/app.js`
  - `pi-package-webui/tests/mobile-static.test.mjs`
  - a dedicated frontend helper/test module only if it materially improves testability
- Must not edit:
  - `pi-package-webui/bin/pi-webui.mjs`
  - `pi-package-webui/public/index.html` or `styles.css` unless escalation establishes that native prompt/confirm primitives cannot satisfy the required flow
  - this plan or the final report

**Deliverables**

- Guided Git catches structured `NO_REMOTE` failures rather than losing the code in `gitWorkflowRequest()`.
- Ask-to-publish, editable default repository name, explicit visibility selection, final summary confirmation, confirmed API request, success/error state handling.
- Static tests covering durable UI/API wiring and no default visibility.
- Handoff artifact: `.pi-subagents/artifacts/guided-git-publication/ws2-frontend.md`.

## Interface contract

### `POST /api/git-workflow/publish`

Request:

```json
{
  "repoName": "directory-name",
  "visibility": "public",
  "confirmed": true
}
```

Rules:

- `repoName` must pass existing GitHub repository-name validation.
- `visibility` must be exactly `public` or `private`.
- `confirmed` must be exactly `true`.
- The selected Web UI tab determines the Git root; owner/authentication comes from `gh`.

Success data extends the standard command result with:

```json
{
  "repoName": "directory-name",
  "visibility": "public",
  "remote": "origin",
  "branch": "current-branch"
}
```

Failure preserves the standard process result and may include `code`/`hint`.

## Acceptance and validation checks

- `node --check pi-package-webui/bin/pi-webui.mjs`
- `node --check pi-package-webui/public/app.js`
- Targeted new/changed test files.
- `cd pi-package-webui && npm test`
- `cd pi-package-webui && npm run check`
- Inspect `git diff --check` and the final scoped diff.
- Verify no test invokes real GitHub publication.
- Verify endpoint GET returns 405 and unconfirmed/invalid requests fail closed.
- Verify no visibility default exists in code or UI behavior.

## Integration guidance

- Run workers sequentially in the shared worktree to preserve one-writer ownership and make WS1's contract available to WS2.
- Integration owner inspects each worker's actual diff, boundary compliance, tests, and handoff before accepting it.
- If WS2 requires an HTML dialog or CSS changes, stop and escalate before expanding ownership; prefer existing `window.prompt` plus `appConfirmText` for the smallest safe implementation.
- Keep the server authoritative for confirmation and input validation.

## Rollback guidance

Revert the frontend `NO_REMOTE` recovery branch, remove `/api/git-workflow/publish` from the mutating allowlist and dispatcher, and remove the new classifier/tests. This restores raw-error behavior without changing repository data formats or migrations. External GitHub repositories created during manual testing are outside local rollback and must never be created by automated tests.

## Risks

| Risk | Mitigation | Residual |
|---|---|---|
| External repo is created but push fails | Preserve gh output, avoid retries that might create another repo, document manual recovery | Partial remote state can require user cleanup |
| `gh` missing or unauthenticated | Existing spawn diagnostics plus publication-specific auth hint | User must fix CLI setup externally |
| Name collision | Validate locally and surface gh error | User chooses another name |
| Error code lost by `gitWorkflowRequest()` | Preserve structured failure on this path or use raw `api()` response | Requires frontend regression test |
| Accidental publication/default visibility | Separate opt-in, explicit visibility, client summary, server `confirmed` gate | None expected after tests |
| Existing remote misclassified | Match no-destination output only; do not offer publish for invalid configured remotes | Git message variants may evolve |

## Decision record

- **2026-07-30:** Confirmed complex classification based on cross-component API/UI/external-side-effect scope.
- **2026-07-30:** Selected GitHub CLI because the package already uses `gh`, has no token-management layer, and `gh repo create` supports non-interactive visibility/source/remote/push flags.
- **2026-07-30:** Selected Guided Git standard push as the feature entry point; Footer Sync remains unchanged to keep scope aligned with the request.
- **2026-07-30:** No blocking user question remains: GitHub follows established package semantics; public/private is explicitly chosen at runtime; repository name is editable with the directory name as default.

## Progress and evidence record

- **Discovery:** Repo Explorer indexed 201 package files. Effectiveness report: `C:/Users/hdlea/.pi/agent/npm/node_modules/@firstpick/pi-skill-repo-explorer/skills/repo-explorer/repo-explorer-effectiveness-2026-07-30T10-59-03-399Z-pi-package-webui-42646be517.md`.
- **Discovery specialist:** Scout run `9d73b6dc-5503-4466-b1c8-f0c93af5e786`, output `.pi-subagents/artifacts/outputs/9d73b6dc-5503-4466-b1c8-f0c93af5e786/parallel-0/0-scout/context.md`.
- **Design specialist:** Context handoff at `.pi-subagents/artifacts/outputs/9d73b6dc-5503-4466-b1c8-f0c93af5e786/parallel-0/1-context-builder/context.md`; its launcher reported a tool-allowlist failure after producing the artifact, so the integration owner independently verified cited code before using it.
- **External reference:** GitHub CLI manual confirms non-interactive `gh repo create` requires a repository name and one of `--public`, `--private`, or `--internal`: <https://cli.github.com/manual/gh_repo_create>.

## Worker outcomes

### WS1 — Backend/API/tests

- **Run:** `194a1502-c8a2-4f3d-bc34-82eb02757737`, step 1, `openai-codex/gpt-5.6-sol:high`.
- **Result:** Accepted after integration-owner diff inspection.
- **Feature files:** `pi-package-webui/bin/pi-webui.mjs`, `pi-package-webui/tests/http-endpoints-harness.test.mjs`, and new `pi-package-webui/tests/guided-git-publication-backend-static.test.mjs`.
- **Evidence:** Exact `NO_REMOTE` classification, POST-only publish route, input/confirmation/existing-remote gates, approved `gh repo create` argv, failure hints, and backend/static endpoint contracts.
- **Handoff:** `.pi-subagents/artifacts/outputs/194a1502-c8a2-4f3d-bc34-82eb02757737/.pi-subagents/artifacts/guided-git-publication/ws1-backend.md`.
- **Boundary:** Compliant; no frontend, plan, report, or manifest edits.

### WS2 — Frontend UX/static tests

- **Run:** `194a1502-c8a2-4f3d-bc34-82eb02757737`, step 2, `anthropic/claude-opus-5:medium`.
- **Result:** Accepted after integration-owner diff inspection and one review-driven correction.
- **Feature files:** `pi-package-webui/public/app.js` and `pi-package-webui/tests/mobile-static.test.mjs`.
- **Evidence:** Structured error preservation; ordered ask/name/visibility/final-confirm flow; confirmed publish request; success metadata; no-default visibility assertions.
- **Review-driven integration fix:** Repository-name default now resolves from the publishing tab, and final confirmation prefers the backend-reported branch from the failed push envelope.
- **Handoff:** `.pi-subagents/artifacts/outputs/194a1502-c8a2-4f3d-bc34-82eb02757737/.pi-subagents/artifacts/guided-git-publication/ws2-frontend.md`.
- **Boundary:** Compliant; no backend, HTML, CSS, plan, report, or manifest edits.

## Independent review quorum and finding dispositions

The qualifying quorum consists of two fresh, read-only reviewer runs from distinct model-author provider families, both distinct from the primary OpenAI implementation provider:

1. **Google reviewer** — run `846340b3-a29b-4da8-a3af-6361b0bac85f`, `openrouter/google/gemini-3.6-flash:high`; verdict **approve**. Artifact: `.pi-subagents/artifacts/outputs/846340b3-a29b-4da8-a3af-6361b0bac85f/.pi-subagents/artifacts/guided-git-publication/review-google.md`.
2. **Moonshot reviewer** — run `a92aa724-4639-46c8-9f22-7b6cb5969604`, `openrouter/moonshotai/kimi-k3:high`; verdict **approve with low-risk follow-up**. Artifact: `.pi-subagents/artifacts/outputs/a92aa724-4639-46c8-9f22-7b6cb5969604/.pi-subagents/artifacts/guided-git-publication/review-kimi.md`.

The Anthropic subscription route was attempted twice through the retry gate and once with Haiku, but all attempts returned account rate-limit errors before producing output. LM Studio was also attempted and unavailable. OpenRouter was therefore used for two distinct eligible model-author provider families, consistent with the configured provider-selection fallback.

### Finding dispositions

| Finding | Severity | Disposition | Evidence / rationale |
|---|---:|---|---|
| Publishing-tab repository-name prefill could use the active tab | Low | **Accepted and fixed** | `promptGitPublishRepoName(tabId)` now resolves the target tab and calls `defaultGitInitRepoName(targetTab)`; static coverage updated. |
| Final summary could show an active-tab branch | Low | **Accepted and fixed** | The summary now prefers `failure.data.branch`, populated server-side before the failed push is classified. |
| Detached HEAD is rejected only after publication prompts | Low | **Rejected** | `/api/git-workflow/push` calls `currentGitBranch(root)` before running `git push`; detached HEAD cannot produce the `NO_REMOTE` recovery trigger. |
| Empty repository can leave partial GitHub state | Low | **Deferred / accepted residual** | Explicitly documented plan risk; output is preserved, no retry/force/masking occurs. A no-commit preflight is a separate enhancement. |
| Existing-remote 409 and successful fake-gh path lack dynamic coverage | Low | **Deferred** | Guard ordering and exact argv are statically pinned; remote-less classification and confirmation/validation are dynamically exercised. Automated tests never contact GitHub. |
| Logical validation failures use HTTP 200 envelopes | Note | **Rejected as feature issue** | Existing API-family convention; browser checks `response.ok` from the JSON envelope and behavior is unchanged. |
| Missing `gh` hint lacks a dedicated error code | Low | **Deferred** | The actionable installation hint is preserved and displayed; no current client behavior requires an additional code. |

A supplementary Amazon-model output was rejected in full because it cited nonexistent `src/services/gitService.ts`, `src/api/gitApi.ts`, and React wizard files, misidentified its provider, and did not inspect the actual implementation. It is not part of the quorum and none of its findings were implemented.

## Final validation

### Passed feature-scoped checks

- `node --check pi-package-webui/bin/pi-webui.mjs`
- `node --check pi-package-webui/public/app.js`
- `node --check pi-package-webui/tests/http-endpoints-harness.test.mjs`
- `node --check pi-package-webui/tests/mobile-static.test.mjs`
- `node --check pi-package-webui/tests/guided-git-publication-backend-static.test.mjs`
- `node pi-package-webui/tests/mobile-static.test.mjs` — `mobile static checks passed`.
- `node pi-package-webui/tests/guided-git-publication-backend-static.test.mjs` — `guided git publication backend static tests passed`.
- `git diff --check` — passed.
- `reports/guided-git-repository-publication.html` validated with the HTML-report strict validator — PASS, zero warnings/errors; 4 accessible tabs, 1 overview table, 1 process diagram, no local/remote dependencies.

### Endpoint harness result

`http-endpoints-harness.test.mjs` executed the new assertions successfully: GET publish refusal, `NO_REMOTE` code/hint/process output, confirmation gate, visibility validation, repository-name validation, and unchanged remote state. On Windows it then failed only in final teardown with `EBUSY` while removing the temporary repository because test-scoped RPC supervisor/fake-Pi descendants retained the fixture working directory. Those orphan test processes were identified and cleaned up; no feature assertion failed.

### Package-wide caveats

A package-wide non-harness test pass was attempted. Feature tests passed, while five unrelated Windows/environment tests failed: ConPTY availability, durable RPC-supervisor termination marker, Unix-socket `EACCES`, symlink `EPERM`, and an existing subagent-launch-slot cwd expectation. In addition, concurrent unrelated Control Deck width persistence edits appeared in the same worktree during validation (`lib/git-workflow-preferences.mjs`, server interface-preference routes, app side-panel helpers, and associated tests). They were not modified, reviewed, or attributed to this feature. Consequently, no clean package-wide green claim is made; completion relies on the passed feature-scoped checks and independent review evidence above.

### Remaining manual/live check

No real repository was published during testing. A live smoke test requires an authenticated `gh` account and would create an external repository; it remains an explicit user-operated check rather than an automated validation step.
